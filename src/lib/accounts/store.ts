/**
 * Accounts store: the three built-in accounts, user-created accounts, the active account and every local addition
 * (snapped receipts today; imported / manual transactions, trades and profile edits in the next phase).
 *
 * Hydration-safe: the module starts with the built-in accounts and Barlas active, which is exactly what the server
 * renders. `hydrateAccounts()` reads localStorage after mount; subscribers then re-render with the stored state.
 * Every storage access is wrapped in try/catch: without storage the app simply works in memory.
 *
 * See docs/ACCOUNTS.md for the API.
 */
import { PROFILES, takeHomeMonth } from "@/lib/data/profiles";
import { monthlySpend, withDerivedBehavior } from "@/lib/finance/investBehavior";
import type { InvestmentTrade, Profile, Transaction } from "@/lib/finance/types";
import type { TransactionCategory } from "@/lib/finance/types";
import { merchantKey } from "@/lib/import/text";
import { isUbsId, loadUbsProfile } from "@/lib/ubs/load";
import type { Account, AccountRecord, AccountsState, ImportInput, ImportRecord, LocalData, NewAccountInput, ProfileFields } from "./types";

export const ACTIVE_KEY = "doppel:account";
export const DATA_KEY = "doppel:accounts:v1";

interface Persisted {
  v: 1;
  local: Record<string, LocalData>;
  /** User-created accounts: their original data (transactions and trades included). */
  users: Profile[];
  /** UBS synthetic profiles opened from the picker, in opening order (their data is loaded from the bundle). */
  ubs?: string[];
}

const BUILT_IN = new Map(PROFILES.map((p) => [p.id, p]));
export const DEFAULT_ACCOUNT_ID = PROFILES[0].id;

const emptyLocal = (): LocalData => ({
  receipts: [],
  txAdded: [],
  txEdited: {},
  txDeleted: [],
  tradesAdded: [],
  tradesEdited: {},
  tradesDeleted: [],
  profile: {},
  imports: [],
  categoryOverrides: {},
});

// ---------------- materialization (pure) ----------------

/** Stable ids for an account's original records: "tx-0", "tx-1", … and "tr-0", … */
function records<T>(prefix: string, base: T[], added: AccountRecord<T>[], edited: Record<string, Partial<T>>, deleted: string[]): AccountRecord<T>[] {
  const gone = new Set(deleted);
  return [...base.map((value, i) => ({ id: `${prefix}-${i}`, value })), ...added]
    .filter((r) => !gone.has(r.id))
    .map((r) => (edited[r.id] ? { id: r.id, value: { ...r.value, ...edited[r.id] } } : r));
}

export function transactionRecords(base: Profile, local: LocalData): AccountRecord<Transaction>[] {
  return records("tx", base.transactions, local.txAdded, local.txEdited, local.txDeleted);
}

export function tradeRecords(base: Profile, local: LocalData): AccountRecord<InvestmentTrade>[] {
  return records("tr", base.trades, local.tradesAdded, local.tradesEdited, local.tradesDeleted);
}

/** Original data + local additions → the profile the engine runs on. Pure and deterministic. */
export function materialize(base: Profile, local: LocalData): Profile {
  const touched =
    local.txAdded.length + Object.keys(local.txEdited).length + local.txDeleted.length +
    local.tradesAdded.length + Object.keys(local.tradesEdited).length + local.tradesDeleted.length +
    Object.keys(local.profile).length;
  if (!touched) return base;
  const transactions = transactionRecords(base, local).map((r) => r.value);
  const trades = tradeRecords(base, local).map((r) => r.value);
  const f = local.profile;
  const spend = monthlySpend(transactions);
  const txChanged = local.txAdded.length + Object.keys(local.txEdited).length + local.txDeleted.length > 0;
  const incomeChanged = f.grossIncomeYear !== undefined || f.marginalTaxRate !== undefined;
  const { investShare, contributes3a, ...fields } = f;
  const merged: Profile = {
    ...base,
    ...fields,
    transactions,
    trades,
    expensesMonth: f.expensesMonth ?? (txChanged && spend.months ? Math.round(spend.average / 10) * 10 : base.expensesMonth),
    rentMonth: f.rentMonth ?? (txChanged && spend.rent ? Math.round(spend.rent) : base.rentMonth),
    netIncomeMonth:
      f.netIncomeMonth ?? (incomeChanged ? takeHomeMonth(f.grossIncomeYear ?? base.grossIncomeYear, f.marginalTaxRate ?? base.marginalTaxRate) : base.netIncomeMonth),
  };
  // Without any trades there is nothing to derive the investing inputs from: keep the base profile's
  // (identical for the built-in accounts, whose values were derived from the same empty list).
  const derived = trades.length || base.trades.length ? withDerivedBehavior(merged) : merged;
  return {
    ...derived,
    ...(investShare !== undefined ? { investShare } : {}),
    ...(contributes3a !== undefined ? { contributes3a } : {}),
  };
}

function countChanges(local: LocalData): number {
  return (
    local.receipts.length + local.txAdded.length + Object.keys(local.txEdited).length + local.txDeleted.length +
    local.tradesAdded.length + Object.keys(local.tradesEdited).length + local.tradesDeleted.length +
    Object.keys(local.profile).length
  );
}

// Receipts, the import history and category overrides do not change the profile, so they are not in the version.
const withoutReceipts = (local: LocalData) => JSON.stringify({ ...local, receipts: undefined, imports: undefined, categoryOverrides: undefined });
const EMPTY = withoutReceipts(emptyLocal());

/** Short deterministic hash (djb2) of the profile-changing local data; receipts are excluded on purpose. */
function versionOf(id: string, local: LocalData): string {
  const text = withoutReceipts(local);
  if (text === EMPTY) return `${id}:0`;
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) ^ text.charCodeAt(i)) >>> 0;
  return `${id}:${h.toString(36)}`;
}

// ---------------- store state ----------------

let persisted: Persisted = { v: 1, local: {}, users: [] };
let activeId = DEFAULT_ACCOUNT_ID;
const accountCache = new Map<string, { local: LocalData; base: Profile; account: Account }>();
/** Loaded base data of the opened UBS profiles. */
const ubsBases = new Map<string, Profile>();
/** A stored active UBS account whose data is still loading. */
let pendingActive: string | null = null;

function baseOf(id: string): Profile | undefined {
  return BUILT_IN.get(id) ?? persisted.users.find((u) => u.id === id) ?? ubsBases.get(id);
}

function buildAccount(base: Profile, builtIn: boolean, ubs = false): Account {
  const local = persisted.local[base.id] ?? emptyLocal();
  const cached = accountCache.get(base.id);
  if (cached && cached.local === local && cached.base === base) return cached.account;
  const account: Account = {
    id: base.id,
    builtIn,
    ...(ubs ? { ubs: true } : {}),
    profile: materialize(base, local),
    receipts: local.receipts,
    localChanges: countChanges(local),
    version: versionOf(base.id, local),
  };
  accountCache.set(base.id, { local, base, account });
  return account;
}

function buildState(hydrated: boolean): AccountsState {
  const ubs = (persisted.ubs ?? []).flatMap((id) => {
    const base = ubsBases.get(id);
    return base ? [buildAccount(base, false, true)] : [];
  });
  const accounts = [...PROFILES.map((p) => buildAccount(p, true)), ...persisted.users.map((u) => buildAccount(u, false)), ...ubs];
  const active = accounts.some((a) => a.id === activeId) ? activeId : DEFAULT_ACCOUNT_ID;
  return { hydrated, activeId: active, accounts };
}

const SERVER_STATE: AccountsState = buildState(false);
let state: AccountsState = SERVER_STATE;
const listeners = new Set<() => void>();

function emit() {
  state = buildState(state.hydrated);
  for (const l of listeners) l();
}

function save() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(persisted));
  } catch {
    // Storage full or blocked: keep working in memory.
  }
}

function update(id: string, fn: (local: LocalData) => LocalData) {
  if (!baseOf(id)) throw new Error(`Unknown account: ${id}`);
  const next = fn(persisted.local[id] ?? emptyLocal());
  persisted = { ...persisted, local: { ...persisted.local, [id]: next } };
  save();
  emit();
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------- React plumbing ----------------

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getSnapshot = (): AccountsState => state;
/** Server render and hydration: built-in data only, Barlas active. */
export const getServerSnapshot = (): AccountsState => SERVER_STATE;

/** Reads localStorage once (call after mount). Safe to call repeatedly. */
export function hydrateAccounts(): void {
  if (state.hydrated) return;
  try {
    const raw = localStorage.getItem(DATA_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Persisted>) : null;
    if (parsed && parsed.v === 1) {
      const local: Record<string, LocalData> = {};
      for (const [id, l] of Object.entries(parsed.local ?? {})) local[id] = { ...emptyLocal(), ...l };
      const ubs = Array.isArray(parsed.ubs) ? [...new Set(parsed.ubs.filter((id): id is string => typeof id === "string" && isUbsId(id)))] : [];
      persisted = { v: 1, local, users: Array.isArray(parsed.users) ? parsed.users : [], ...(ubs.length ? { ubs } : {}) };
    }
  } catch {
    // Corrupt or blocked storage: start from the original data.
  }
  try {
    const stored = localStorage.getItem(ACTIVE_KEY);
    if (stored && baseOf(stored)) activeId = stored;
    else if (stored && persisted.ubs?.includes(stored)) pendingActive = stored;
  } catch {
    // ignore
  }
  state = buildState(true);
  for (const l of listeners) l();
  // Opened UBS profiles: load their data (one small chunk each), then show them.
  for (const id of persisted.ubs ?? []) {
    loadUbsProfile(id)
      .then((p) => {
        ubsBases.set(id, p);
        if (pendingActive === id) {
          activeId = id;
          pendingActive = null;
        }
        emit();
      })
      .catch(() => {
        // Unknown id (data changed): drop it from the list.
        persisted = { ...persisted, ubs: (persisted.ubs ?? []).filter((x) => x !== id) };
        save();
        emit();
      });
  }
}

/**
 * Opens a UBS synthetic profile as a read-only base account (its local layer works like any account's) and keeps
 * it in the stored list. Resolves with the account id (= the UBS profile id). Does not activate it.
 */
export async function openUbsProfile(ubsId: string): Promise<string> {
  const p = await loadUbsProfile(ubsId);
  ubsBases.set(ubsId, p);
  if (!persisted.ubs?.includes(ubsId)) {
    persisted = { ...persisted, ubs: [...(persisted.ubs ?? []), ubsId] };
    save();
  }
  emit();
  return p.id;
}

/** UBS profiles opened in this browser, in opening order. */
export const openedUbsProfiles = (): string[] => [...(persisted.ubs ?? [])];

// ---------------- public API ----------------

export const listAccounts = (): Account[] => state.accounts;
export const getAccount = (id: string): Account | undefined => state.accounts.find((a) => a.id === id);
export const getActiveAccount = (): Account => getAccount(state.activeId) ?? state.accounts[0];

export function setActiveAccount(id: string): void {
  if (!baseOf(id)) throw new Error(`Unknown account: ${id}`);
  activeId = id;
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
  emit();
}

/** A snapped receipt (counted in "this month", not in the multi-month baseline). */
export function addReceipt(accountId: string, tx: Transaction): void {
  update(accountId, (l) => ({ ...l, receipts: [...l.receipts, { ...tx }] }));
}

export function listTransactions(accountId: string): AccountRecord<Transaction>[] {
  const base = baseOf(accountId);
  return base ? transactionRecords(base, persisted.local[accountId] ?? emptyLocal()) : [];
}

export function addTransaction(accountId: string, tx: Transaction): string {
  const id = newId("tx");
  update(accountId, (l) => ({ ...l, txAdded: [...l.txAdded, { id, value: { ...tx } }] }));
  return id;
}

/** Adds many transactions in one write (e.g. a bank statement import). Returns their ids. */
export function addTransactions(accountId: string, txs: Transaction[]): string[] {
  const added = txs.map((value, i) => ({ id: `${newId("tx")}-${i}`, value: { ...value } }));
  update(accountId, (l) => ({ ...l, txAdded: [...l.txAdded, ...added] }));
  return added.map((a) => a.id);
}

export function updateTransaction(accountId: string, recordId: string, patch: Partial<Transaction>): void {
  const base = baseOf(accountId);
  update(accountId, (l) => {
    const i = l.txAdded.findIndex((r) => r.id === recordId);
    const baseIndex = recordId.startsWith("tx-") ? Number(recordId.slice(3)) : -1;
    const prev = i >= 0 ? l.txAdded[i].value : base && Number.isInteger(baseIndex) && baseIndex >= 0 ? base.transactions[baseIndex] : undefined;
    const merchant = patch.merchant ?? prev?.merchant;
    const categoryOverrides =
      patch.category && patch.category !== "investing" && merchant
        ? { ...l.categoryOverrides, [merchantKey(merchant)]: patch.category }
        : l.categoryOverrides;
    if (i >= 0) {
      return {
        ...l,
        txAdded: l.txAdded.map((r, j) => (j === i ? { id: r.id, value: { ...r.value, ...patch } } : r)),
        categoryOverrides,
      };
    }
    return { ...l, txEdited: { ...l.txEdited, [recordId]: { ...l.txEdited[recordId], ...patch } }, categoryOverrides };
  });
}

export function deleteTransaction(accountId: string, recordId: string): void {
  update(accountId, (l) =>
    l.txAdded.some((r) => r.id === recordId)
      ? { ...l, txAdded: l.txAdded.filter((r) => r.id !== recordId) }
      : { ...l, txDeleted: [...new Set([...l.txDeleted, recordId])] },
  );
}

export function listTrades(accountId: string): AccountRecord<InvestmentTrade>[] {
  const base = baseOf(accountId);
  return base ? tradeRecords(base, persisted.local[accountId] ?? emptyLocal()) : [];
}

export function addTrade(accountId: string, trade: InvestmentTrade): string {
  const id = newId("tr");
  update(accountId, (l) => ({ ...l, tradesAdded: [...l.tradesAdded, { id, value: { ...trade } }] }));
  return id;
}

export function addTrades(accountId: string, trades: InvestmentTrade[]): string[] {
  const added = trades.map((value, i) => ({ id: `${newId("tr")}-${i}`, value: { ...value } }));
  update(accountId, (l) => ({ ...l, tradesAdded: [...l.tradesAdded, ...added] }));
  return added.map((a) => a.id);
}

export function updateTrade(accountId: string, recordId: string, patch: Partial<InvestmentTrade>): void {
  update(accountId, (l) => {
    const i = l.tradesAdded.findIndex((r) => r.id === recordId);
    if (i >= 0) return { ...l, tradesAdded: l.tradesAdded.map((r, j) => (j === i ? { id: r.id, value: { ...r.value, ...patch } } : r)) };
    return { ...l, tradesEdited: { ...l.tradesEdited, [recordId]: { ...l.tradesEdited[recordId], ...patch } } };
  });
}

export function deleteTrade(accountId: string, recordId: string): void {
  update(accountId, (l) =>
    l.tradesAdded.some((r) => r.id === recordId)
      ? { ...l, tradesAdded: l.tradesAdded.filter((r) => r.id !== recordId) }
      : { ...l, tradesDeleted: [...new Set([...l.tradesDeleted, recordId])] },
  );
}

/** Sets profile fields; `undefined` values remove an earlier override (back to original / derived). */
export function setProfileFields(accountId: string, fields: ProfileFields): void {
  update(accountId, (l) => {
    const profile: Record<string, unknown> = { ...l.profile };
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) delete profile[k];
      else profile[k] = v;
    }
    return { ...l, profile: profile as ProfileFields };
  });
}

/** Creates a user account from scratch and returns its id. It is not activated automatically. */
export function createAccount(input: NewAccountInput): string {
  const id = newId("user");
  const transactions = input.transactions ?? [];
  const spend = monthlySpend(transactions);
  const goalAge = Math.max(50, input.age + 10);
  const profile: Profile = {
    id,
    name: input.name.trim() || "Account",
    age: input.age,
    city: input.city,
    canton: input.canton.toUpperCase(),
    tagline: { key: "profile.user.tagline" },
    grossIncomeYear: input.grossIncomeYear,
    netIncomeMonth: input.netIncomeMonth ?? takeHomeMonth(input.grossIncomeYear, input.marginalTaxRate),
    expensesMonth: input.expensesMonth ?? Math.round(spend.average / 10) * 10,
    rentMonth: input.rentMonth ?? Math.round(spend.rent),
    cash: input.cash ?? 0,
    portfolio: input.portfolio ?? 0,
    pillar2: input.pillar2 ?? 0,
    pillar3a: input.pillar3a ?? 0,
    contributes3a: false,
    investShare: 0,
    marginalTaxRate: input.marginalTaxRate,
    riskProfile: input.riskProfile ?? "balanced",
    retirementAge: input.retirementAge ?? 65,
    goal: input.goal ?? { label: { key: "profile.goalK", params: { target: 500_000, age: goalAge } }, target: 500_000, age: goalAge },
    events: input.events ?? [],
    transactions,
    trades: input.trades ?? [],
    history: { soldInDrawdown: false, drawdownSellPct: 0 },
  };
  persisted = { ...persisted, users: [...persisted.users, withDerivedBehavior(profile)] };
  save();
  emit();
  return id;
}

/** Deletes a user-created account or closes an opened UBS profile (built-in accounts can only be reset). */
export function deleteAccount(id: string): void {
  if (BUILT_IN.has(id)) throw new Error("Built-in accounts cannot be deleted; use resetAccount()");
  const { [id]: _gone, ...local } = persisted.local;
  void _gone;
  const ubs = persisted.ubs?.filter((x) => x !== id);
  persisted = { ...persisted, local, users: persisted.users.filter((u) => u.id !== id), ...(ubs ? { ubs } : {}) };
  ubsBases.delete(id);
  if (activeId === id) setActiveAccount(DEFAULT_ACCOUNT_ID);
  save();
  emit();
}

// ---------------- statement imports (docs/ACCOUNTS.md → "Imports") ----------------

/**
 * Writes a confirmed import in ONE step (one version change, one recomputation): the same records
 * `addTransactions()` / `addTrades()` would add, plus a history entry for "undo this import" and the review's
 * category corrections. Returns the history entry.
 */
export function addImport(accountId: string, input: ImportInput): ImportRecord {
  const stamp = newId("imp");
  const tx = input.transactions.map((value, i) => ({ id: `tx-${stamp.slice(4)}-${i}`, value: { ...value } }));
  const trades = input.trades.map((value, i) => ({ id: `tr-${stamp.slice(4)}-${i}`, value: { ...value } }));
  const refs: Record<string, string> = {};
  input.refs?.forEach((ref, i) => {
    if (ref && tx[i]) refs[tx[i].id] = ref;
  });
  const record: ImportRecord = {
    id: stamp,
    fileName: input.fileName.slice(0, 120),
    at: new Date().toISOString(),
    format: input.format,
    profile: input.profile,
    counts: { ...input.counts },
    txIds: tx.map((r) => r.id),
    tradeIds: trades.map((r) => r.id),
    refs,
  };
  update(accountId, (l) => ({
    ...l,
    txAdded: [...l.txAdded, ...tx],
    tradesAdded: [...l.tradesAdded, ...trades],
    imports: [...l.imports, record],
    categoryOverrides: { ...l.categoryOverrides, ...input.overrides },
  }));
  return record;
}

/** "Undo this import": removes the import's transactions and trades (also if edited since) and its history entry. */
export function undoImport(accountId: string, importId: string): void {
  update(accountId, (l) => {
    const record = l.imports.find((r) => r.id === importId);
    if (!record) return l;
    const tx = new Set(record.txIds);
    const tr = new Set(record.tradeIds);
    const edited = <T>(m: Record<string, T>, gone: Set<string>) => Object.fromEntries(Object.entries(m).filter(([id]) => !gone.has(id)));
    return {
      ...l,
      txAdded: l.txAdded.filter((r) => !tx.has(r.id)),
      txEdited: edited(l.txEdited, tx),
      tradesAdded: l.tradesAdded.filter((r) => !tr.has(r.id)),
      tradesEdited: edited(l.tradesEdited, tr),
      imports: l.imports.filter((r) => r.id !== importId),
    };
  });
}

export function listImports(accountId: string): ImportRecord[] {
  return persisted.local[accountId]?.imports ?? [];
}

/** Bank references of imported transactions that still exist (for dedupe). */
export function importedRefs(accountId: string): Set<string> {
  const local = persisted.local[accountId];
  if (!local) return new Set();
  const alive = new Set(local.txAdded.map((r) => r.id));
  const refs = new Set<string>();
  for (const record of local.imports) for (const [id, ref] of Object.entries(record.refs)) if (alive.has(id)) refs.add(ref);
  return refs;
}

export function categoryOverrides(accountId: string): Record<string, TransactionCategory> {
  return persisted.local[accountId]?.categoryOverrides ?? {};
}

/** Stores (or with `undefined` removes) a merchant → category correction; `merchant` is a `merchantKey()`. */
export function setCategoryOverride(accountId: string, merchant: string, category: TransactionCategory | undefined): void {
  update(accountId, (l) => {
    const next = { ...l.categoryOverrides };
    if (category) next[merchant] = category;
    else delete next[merchant];
    return { ...l, categoryOverrides: next };
  });
}

/** "Reset to original data": drops every local addition and edit of this account. */
export function resetAccount(id: string): void {
  if (!baseOf(id)) throw new Error(`Unknown account: ${id}`);
  const { [id]: _gone, ...local } = persisted.local;
  void _gone;
  persisted = { ...persisted, local };
  save();
  emit();
}
