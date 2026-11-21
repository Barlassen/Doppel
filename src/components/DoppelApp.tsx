"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addReceipt,
  deleteAccount,
  getAccount,
  hydrateAccounts,
  resetAccount,
  setActiveAccount,
  useAccounts,
  type Account,
  type AccountsState,
} from "@/lib/accounts";
import { simulate } from "@/lib/finance/monteCarlo";
import { analyzeBehavior } from "@/lib/finance/behavioralEngine";
import { solveGoal, type Recipe, type SolverResult } from "@/lib/finance/goalSolver";
import { checkAffordability } from "@/lib/finance/swissRules";
import {
  baseScenario,
  costOfWaiting,
  effectiveProfile,
  habitCosts,
  simInputFor,
  type HabitCosts,
  type WaitingCost,
} from "@/lib/finance/scenario";
import { GOAL_DEFINITION, type Profile, type RiskProfile, type Scenario, type SimResult } from "@/lib/finance/types";
import {
  applyScenarioOps,
  compactEvents,
  describeOps,
  extractionToUpdate,
  localParseCommand,
  validateOps,
  validateLocalOps,
  type Op,
} from "@/lib/twin/actions";
import { callTwin } from "@/lib/llm";
import { entryFromCommand, entryFromNarrate, entryFromSnap, type LedgerEntry } from "@/lib/frugal/ledger";
import type { SnapResult, Usage } from "@/lib/snap/types";
import {
  applyChartToProfile,
  applyChartVisionResult,
  withChartInsight,
  type ChartTwinPatch,
  type FloorPlanVerification,
} from "@/lib/snap/vision";
import { pct } from "@/lib/format";
import { LOCALES, LOCALE_NAMES, LOCALE_TAGS, msg, translate, translateText, type Locale, type Msg, type Text } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { ConeChart } from "./ConeChart";
import { CommandBar } from "./CommandBar";
import { SnapPanel, type SnapItem } from "./SnapPanel";
import { FrugalBadge, Inspector } from "./Inspector";
import { AffordabilityCard, BankerCard, BehaviorCard, RecipesCard, Timeline } from "./Cards";
import { RetirementCard } from "./RetirementCard";
import { PlanCompare, type PinnedPlan } from "./PlanCompare";
import { InvestControls, TaxTip, WaitingStrip } from "./InvestControls";
import { Hero } from "./Hero";
import { CardHeader, Section } from "./ui";
import { AccountSwitcher } from "./AccountSwitcher";
import { AccountWizard } from "./AccountWizard";
import { ImportPanel } from "./ImportPanel";
import { TransactionsPanel } from "./TransactionsPanel";

const uid = () => Math.random().toString(36).slice(2, 10);
/** Cantons whose city names are French (for the `lang` attribute of the hero line). */
const FRENCH_CANTONS = new Set(["GE", "VD", "NE", "JU"]);

// ---------------- deterministic engine helpers (0 tokens) ----------------

/** Cache key of a simulation: the account's data version (id included), the scenario and any chart-scan portfolio overlay. */
const keyOf = (accountVersion: string, s: Scenario, portfolioOverride?: number) =>
  JSON.stringify([accountVersion, s, portfolioOverride ?? null]);

const activeOf = (st: AccountsState): Account => st.accounts.find((a) => a.id === st.activeId) ?? st.accounts[0];

/** An account's starting scenario: its profile, plus its saved snapped receipts as "this month". */
const baseScenarioFor = (a: Account): Scenario => ({ ...baseScenario(a.profile), extraTx: [...a.receipts] });

/** Bounded insertion-order cache. */
function remember<V>(cache: Map<string, V>, key: string, value: V, max = 30) {
  cache.set(key, value);
  if (cache.size > max) cache.delete(cache.keys().next().value!);
}

function runPair(base: Profile, s: Scenario) {
  const b = analyzeBehavior(effectiveProfile(base, s), s.extraTx);
  return { ideal: simulate(simInputFor(base, s)), real: simulate(simInputFor(base, s, b.params)) };
}

function runReal(base: Profile, s: Scenario) {
  const b = analyzeBehavior(effectiveProfile(base, s), s.extraTx);
  return simulate(simInputFor(base, s, b.params));
}

interface MainResults {
  key: string;
  ideal: SimResult;
  real: SimResult;
}
interface Extras {
  key: string;
  profileId: string;
  habits: HabitCosts | null;
  waiting: WaitingCost[] | null;
}
interface Impact {
  label: Text;
  before: number;
  after: number;
}
interface PendingImpact {
  label: Text;
  beforeKey: string;
  afterKey: string;
  snapId?: string;
}
/** Everything that belongs to one account while the app is open; restored when switching back. */
interface Session {
  version: string;
  scenario: Scenario;
  pin: (PinnedPlan & { scenario: Scenario }) | null;
  snaps: SnapItem[];
  ledger: LedgerEntry[];
  impact: Impact | null;
}

export default function DoppelApp() {
  const { locale, setLocale, t, tm } = useI18n();
  const accountsState = useAccounts();
  // The account the screens show. Server render and first client render: the built-in default (Barlas);
  // the stored account is loaded after mount (see the hydration effect below).
  const [account, setAccount] = useState<Account>(() => activeOf(accountsState));
  // A confirmed chart scan overlays the portfolio value (and adds a drawdown insight) for this session.
  const [chartPatch, setChartPatch] = useState<ChartTwinPatch | null>(null);
  const chartPatchRef = useRef<ChartTwinPatch | null>(null);
  const base = useMemo(() => applyChartToProfile(account.profile, chartPatch), [account.profile, chartPatch]);
  const profileId = account.id;
  const accountRef = useRef(account);
  const sessions = useRef(new Map<string, Session>());

  const [scenario, setScenario] = useState<Scenario>(() => baseScenarioFor(account));
  const [pin, setPin] = useState<(PinnedPlan & { scenario: Scenario }) | null>(null);
  const [snaps, setSnaps] = useState<SnapItem[]>([]);
  const [floorPlan, setFloorPlan] = useState<FloorPlanVerification | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [inspector, setInspector] = useState(false);
  const [cmdBusy, setCmdBusy] = useState(false);
  const [cmdMsg, setCmdMsg] = useState<Msg>();
  const [narrative, setNarrative] = useState<{
    loading: boolean;
    fallback: Msg[];
    cloud?: { locale: Locale; text: string };
  } | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [importOpenToken, setImportOpenToken] = useState(0);
  const pendingDataChange = useRef<{ accountId: string; label: Text; before: number } | null>(null);

  // Account-scoped request revision: async results that resolve after an account switch are ignored.
  const [profileRev, setProfileRev] = useState(0);
  const profileRevRef = useRef(0);
  // Always-current copies for async callbacks (no stale closures).
  const scenarioRef = useRef(scenario);
  const pinRef = useRef(pin);
  const snapsRef = useRef(snaps);
  const ledgerRef = useRef(ledger);
  const impactRef = useRef(impact);
  useEffect(() => {
    snapsRef.current = snaps;
    ledgerRef.current = ledger;
    impactRef.current = impact;
  }, [snaps, ledger, impact]);

  // Results. The first render is computed synchronously (deterministic → identical on server and client);
  // later recomputations are debounced and split into chunks so the page stays responsive.
  const [main, setMain] = useState<MainResults>(() => {
    const s = baseScenarioFor(account);
    return { key: keyOf(account.version, s), ...runPair(account.profile, s) };
  });
  const [planA, setPlanA] = useState<{ key: string; result: SimResult } | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [solver, setSolver] = useState<{ key: string; profileId: string; result: SolverResult } | null>(null);
  const mainRef = useRef(main);
  const probCache = useRef(new Map<string, number>([[main.key, main.real.successProb]]));
  const pendingImpacts = useRef<PendingImpact[]>([]);
  // Solver and habit results per scenario key, so switching back to an account restores them instantly.
  const solverCache = useRef(new Map<string, SolverResult>());
  const extrasCache = useRef(new Map<string, Extras>());

  function commitScenario(next: Scenario) {
    scenarioRef.current = next;
    setScenario(next);
  }
  function commitPin(next: (PinnedPlan & { scenario: Scenario }) | null) {
    pinRef.current = next;
    setPin(next);
  }

  /** Ledger entries go to the account that started the call, even if the user switched meanwhile. */
  function addLedger(accountId: string, entry: LedgerEntry) {
    if (accountId === accountRef.current.id) setLedger((l) => [...l, entry]);
    else {
      const saved = sessions.current.get(accountId);
      if (saved) sessions.current.set(accountId, { ...saved, ledger: [...saved.ledger, entry] });
    }
  }

  /**
   * Loads an account into every screen: its saved session (scenario, Plan A, snaps, ledger) when it was open
   * before with the same data, otherwise a fresh start from its data. `fresh` forces the fresh start.
   */
  function loadAccount(next: Account, fresh = false) {
    const prev = accountRef.current;
    if (prev.id !== next.id) {
      sessions.current.set(prev.id, {
        version: prev.version,
        scenario: scenarioRef.current,
        pin: pinRef.current,
        snaps: snapsRef.current,
        ledger: ledgerRef.current,
        impact: impactRef.current,
      });
    }
    const sameAccountEdit = prev.id === next.id && !fresh;
    const saved = fresh ? undefined : sessions.current.get(next.id);
    const session = saved && saved.version === next.version ? saved : null;
    if (fresh) sessions.current.delete(next.id);
    profileRevRef.current += 1;
    setProfileRev(profileRevRef.current);
    accountRef.current = next;
    setAccount(next);
    const s = session?.scenario ?? baseScenarioFor(next);
    commitScenario(s);
    // An account switch or data edit is a full context change: compute its headline synchronously (no stale flash).
    const key = keyOf(next.version, s);
    const m = mainRef.current.key === key ? mainRef.current : { key, ...runPair(next.profile, s) };
    mainRef.current = m;
    probCache.current.set(m.key, m.real.successProb);
    setMain(m);
    commitPin(session?.pin ?? null);
    pendingImpacts.current = [];
    const dc = pendingDataChange.current;
    if (dc && dc.accountId === next.id) {
      pendingDataChange.current = null;
      setImpact({ label: dc.label, before: dc.before, after: m.real.successProb });
    } else {
      setImpact(session?.impact ?? null);
    }
    if (!sameAccountEdit) {
      setSnaps(session?.snaps ?? []);
      setLedger(session?.ledger ?? []);
      setFloorPlan(null);
      chartPatchRef.current = null;
      setChartPatch(null);
    }
    setNarrative(null);
    setCmdMsg(undefined);
  }

  function onDataChange(label: Text) {
    pendingDataChange.current = {
      accountId: accountRef.current.id,
      label,
      before: mainRef.current.real.successProb,
    };
  }

  function onDeleteAccount(id: string) {
    deleteAccount(id);
    sessions.current.delete(id);
  }

  function onResetAccount(id: string) {
    resetAccount(id);
    sessions.current.delete(id);
    const fresh = getAccount(id);
    if (fresh && id === accountRef.current.id) loadAccount(fresh, true);
  }

  // Hydration: read the stored accounts after mount, then follow the store's active account.
  useEffect(() => {
    hydrateAccounts();
  }, []);
  const storeActive = activeOf(accountsState);
  const loadedStored = useRef(false);
  useEffect(() => {
    const cur = accountRef.current;
    if (accountsState.hydrated && !loadedStored.current) {
      loadedStored.current = true;
      if (storeActive.id !== cur.id || storeActive.version !== cur.version || storeActive.receipts.length) loadAccount(storeActive, true);
      return;
    }
    if (storeActive.id !== cur.id || storeActive.version !== cur.version) loadAccount(storeActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAccount only reads refs and state setters
  }, [accountsState.hydrated, storeActive]);

  /**
   * Every change to the twin goes through here. Plan A is auto-pinned to the state right before the change
   * (unless the user pinned one), and the odds delta is shown once the new futures are simulated.
   */
  function mutate(
    fn: (s: Scenario) => Scenario,
    opts: { label: Text; autoPin?: boolean; snapId?: string; nextPortfolio?: number },
  ) {
    const prev = scenarioRef.current;
    const next = fn(prev);
    const version = accountRef.current.version;
    const prevPort = chartPatchRef.current?.portfolioChf;
    const nextPort = opts.nextPortfolio !== undefined ? opts.nextPortfolio : prevPort;
    const beforeKey = keyOf(version, prev, prevPort);
    const afterKey = keyOf(version, next, nextPort);
    if (beforeKey === afterKey) {
      const p = probCache.current.get(beforeKey);
      if (p !== undefined) resolveImpact({ label: opts.label, beforeKey, afterKey, snapId: opts.snapId }, p, p);
      return;
    }
    if (opts.autoPin !== false && !pinRef.current?.manual) commitPin({ scenario: prev, label: msg("plan.before", { label: opts.label }), manual: false });
    pendingImpacts.current.push({ label: opts.label, beforeKey, afterKey, snapId: opts.snapId });
    commitScenario(next);
    setNarrative(null);
  }

  function resolveImpact(pi: PendingImpact, before: number, after: number) {
    setImpact({ label: pi.label, before, after });
    if (pi.snapId) {
    const odds = before === after ? msg("snap.oddsUnchanged", { p: after }) : msg("snap.oddsChanged", { before, after });
    setSnaps((items) => items.map((it) => (it.id === pi.snapId ? { ...it, odds } : it)));
    }
  }

  const effProfile = useMemo(() => effectiveProfile(base, scenario), [base, scenario]);
  const behavior = useMemo(
    () => withChartInsight(analyzeBehavior(effProfile, scenario.extraTx), chartPatch),
    [effProfile, scenario.extraTx, chartPatch],
  );
  const inputsKey = useMemo(() => keyOf(account.version, scenario, chartPatch?.portfolioChf), [account.version, scenario, chartPatch]);
  const pinKey = useMemo(() => (pin ? keyOf(account.version, pin.scenario) : null), [account.version, pin]);

  // ---------------- debounced, chunked recomputation ----------------
  const jobRef = useRef(0);
  const planAKeyRef = useRef<string | null>(null);
  const extrasKeyRef = useRef<string | null>(null);
  const solverKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const job = ++jobRef.current;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const step = (fn: () => void, ms = 0) =>
      timers.push(
        setTimeout(() => {
          if (job === jobRef.current) fn();
        }, ms),
      );
    const acc = accountRef.current;
    const prof = applyChartToProfile(acc.profile, chartPatchRef.current);
    const s = scenarioRef.current;
    const pinned = pinRef.current;
    const key = keyOf(acc.version, s, chartPatchRef.current?.portfolioChf);
    const input = () => simInputFor(prof, s, analyzeBehavior(effectiveProfile(prof, s), s.extraTx).params);

    // Resolve "28% → 11%" deltas once the futures before and after the change are both known.
    const resolvePending = () => {
      pendingImpacts.current = pendingImpacts.current
        .filter((pi) => {
          const b = probCache.current.get(pi.beforeKey);
          const a = probCache.current.get(pi.afterKey);
          if (a === undefined || b === undefined) return true;
          resolveImpact(pi, b, a);
          return false;
        })
        .slice(-5);
    };

    const afterMain = () => {
      resolvePending();
      const aKey = pinned ? keyOf(acc.version, pinned.scenario) : null;
      if (aKey !== planAKeyRef.current) {
        step(() => {
          if (pinned && aKey !== key) {
            const result = runReal(prof, pinned.scenario);
            probCache.current.set(aKey!, result.successProb);
            setPlanA({ key: aKey!, result });
          } else setPlanA(null);
          planAKeyRef.current = aKey;
          resolvePending();
        });
      }
      if (extrasKeyRef.current !== key) {
        const cached = extrasCache.current.get(key);
        if (cached) {
          setExtras(cached);
          extrasKeyRef.current = key;
        } else
          step(() => {
            const habits = habitCosts(input());
            step(() => {
              const e = { key, profileId: prof.id, habits, waiting: costOfWaiting(input()) };
              remember(extrasCache.current, key, e);
              setExtras(e);
              extrasKeyRef.current = key;
            });
          });
      }
      if (solverKeyRef.current !== key) {
        const cached = solverCache.current.get(key);
        if (cached) {
          setSolver({ key, profileId: prof.id, result: cached });
          solverKeyRef.current = key;
        } else
          step(() => {
            const b = analyzeBehavior(effectiveProfile(prof, s), s.extraTx);
            const result = solveGoal(simInputFor(prof, s, b.params), { spendTip: b.spendTip });
            remember(solverCache.current, key, result);
            setSolver({ key, profileId: prof.id, result });
            solverKeyRef.current = key;
          });
      }
    };

    if (mainRef.current.key === key) afterMain();
    else
      step(() => {
        const ideal = simulate(simInputFor(prof, s));
        step(() => {
          const real = simulate(input());
          const m = { key, ideal, real };
          mainRef.current = m;
          probCache.current.set(key, real.successProb);
          if (probCache.current.size > 40) probCache.current.delete(probCache.current.keys().next().value!);
          setMain(m);
          afterMain();
        });
      }, 80);
    return () => timers.forEach(clearTimeout);
  }, [inputsKey, pinKey]);

  const { ideal, real } = main;
  const fresh = main.key === inputsKey;
  const solving = !solver || solver.key !== inputsKey;
  const recipes = solver?.profileId === profileId ? solver.result.recipes : [];
  const sameProfileExtras = extras?.profileId === profileId ? extras : null;
  const planAResult = pin && planA && planA.key === pinKey && pinKey !== main.key ? planA.result : pin && pinKey === main.key ? real : null;

  // Affordability card: the bank test on the simulator's median future at the purchase date.
  const house = real.house;
  const affordability = useMemo(
    () =>
      house
        ? checkAffordability({
            price: house.price,
            grossIncomeYear: house.grossAtPurchase,
            hardEquityAvailable: house.medianHardEquity,
            pillar2Available: house.medianPillar2,
            closingRate: house.closingRate,
          })
        : null,
    [house],
  );

  const behaviorCost = ideal.medianAtGoal - real.medianAtGoal;
  const netWorthToday = effProfile.cash + effProfile.portfolio + effProfile.pillar2 + effProfile.pillar3a;
  const stateChars = useMemo(() => JSON.stringify({ profile: effProfile, events: scenario.events }).length, [effProfile, scenario.events]);

  // ---------------- multimodal snap ----------------
  const renderRev = profileRev;
  const renderAccountId = account.id;
  function onSnap(name: Text, r: SnapResult) {
    addLedger(renderAccountId, entryFromSnap(name, r));
    if (renderRev !== profileRevRef.current) return; // snap started for another account
    const cur = scenarioRef.current;
    const id = uid();
    const label = msg("change.snap", { name });

    if (r.extraction.vision?.kind === "chart") {
      const applied = applyChartVisionResult(r.extraction.vision.chart, {
        scenario: cur,
        portfolioChf: base.portfolio,
      });
      setSnaps((s) => [...s, { id, name, result: r, summary: applied.patch.summary }]);
      mutate(() => applied.scenario, {
        label,
        snapId: id,
        nextPortfolio: applied.patch.portfolioChf,
      });
      chartPatchRef.current = applied.patch;
      setChartPatch(applied.patch);
      return;
    }

    if (r.extraction.vision?.kind === "floorplan") setFloorPlan(r.extraction.vision.floorPlan);
    else if (r.extraction.kind === "listing") setFloorPlan(null);
    const update = extractionToUpdate(r.extraction, cur.events, new Date(), {
      transactions: base.transactions,
      recurring: cur.recurring,
      marginalTaxRate: base.marginalTaxRate,
      income: { grossIncomeYear: base.grossIncomeYear, netIncomeMonth: base.netIncomeMonth },
    });
    setSnaps((s) => [...s, { id, name, result: r, summary: update.summary }]);
    switch (update.kind) {
      case "event":
        mutate((s) => applyScenarioOps(s, validateLocalOps(update.ops, s.events), "snap"), { label, snapId: id });
        break;
      case "transaction":
        mutate((s) => ({ ...s, extraTx: [...s.extraTx, update.tx] }), { label, snapId: id, autoPin: false });
        addReceipt(renderAccountId, update.tx); // kept for this account across reloads
        break;
      case "recurring":
        mutate((s) => ({ ...s, recurring: [...s.recurring, update.expense], extraTx: [...s.extraTx, update.tx] }), { label, snapId: id });
        break;
      case "income":
        mutate(
          (s) => ({
            ...s,
            income: { grossIncomeYear: update.grossIncomeYear, netIncomeMonth: update.netIncomeMonth, label: msg("pill.payslip", { net: update.payslipNet }) },
          }),
          { label, snapId: id },
        );
        break;
      default:
        break;
    }
  }

  // ---------------- what-if commands ----------------
  async function onCommand(text: string) {
    const rev = profileRevRef.current;
    const accountId = accountRef.current.id;
    setCmdBusy(true);
    setCmdMsg(undefined);
    const t0 = performance.now();
    const local = localParseCommand(text, scenarioRef.current.events, new Date(), locale, effProfile.retirementAge);
    let ops: Op[] | null = local;
    let status: Msg;

    if (local) {
      addLedger(
        accountId,
        entryFromCommand({
          text,
          tier: "local-parser",
          usage: { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "regex intent parser (local)", mode: "local" },
          payload: { sentToCloud: null, ops: local },
          ms: performance.now() - t0,
          stateChars,
        }),
      );
      status = msg("cmd.parsedLocally");
    } else {
      const now = new Date().toISOString().slice(0, 7);
      const r = await callTwin<{ ops: unknown }>({ task: "command", text, now, events: compactEvents(scenarioRef.current.events) });
      if (r.ok && r.data) {
        addLedger(
          accountId,
          entryFromCommand({
            text,
            tier: "llm",
            usage: { ...r.usage!, mode: "llm" },
            payload: { request: r.request, response: r.data },
            ms: performance.now() - t0,
            stateChars,
          }),
        );
        // Validate against the CURRENT events (the twin may have changed while the model was thinking).
        ops = validateOps(r.data.ops, scenarioRef.current.events);
        status = ops.length ? msg("cmd.parsedBy", { model: r.usage?.model ?? "LLM" }) : msg("cmd.noValidChange");
      } else {
        ops = null;
        status = r.offline ? msg("cmd.offline") : msg("cmd.llmError", { error: r.error ?? "" });
      }
    }

    if (rev !== profileRevRef.current) {
      setCmdBusy(false);
      return; // account switched while parsing — don't apply to the wrong twin
    }
    if (ops && ops.length) {
      const valid = ops;
      mutate((s) => applyScenarioOps(s, valid, "command"), { label: text });
      status = msg("cmd.result", { status, ops: describeOps(valid) });
    }
    setCmdMsg(status);
    setCmdBusy(false);
  }

  // ---------------- private banker narration ----------------
  async function narrate() {
    const rev = profileRevRef.current;
    const accountId = accountRef.current.id;
    setNarrative({ fallback: [], loading: true });
    const top = recipes[0];
    const ret = real.retirement;
    const fallback = templateNarrative({
      goal: effProfile.goal.label,
      odds: real.successProb,
      ideal: ideal.successProb,
      home: affordability,
      habit: behavior.insights[0]?.title,
      habitCost: Math.max(0, behaviorCost),
      retirement: ret,
      best: top,
    });
    const facts = {
      client: `${effProfile.name}, ${effProfile.age}, ${effProfile.city}`,
      goal: `${translateText("en", effProfile.goal.label)} (${GOAL_DEFINITION})`,
      odds_with_habits: pct(real.successProb),
      odds_disciplined: pct(ideal.successProb),
      habit_cost_chf: Math.round(Math.max(0, behaviorCost)),
      top_habit: translateText("en", behavior.insights[0]?.title) || undefined,
      cash_crunch_risk: pct(real.crunchProb),
      home: affordability && house
        ? { price: house.price, passes: affordability.pass, cost_to_income: pct(affordability.costToIncome, 1), max_price_at_purchase: affordability.maxPrice, bought_in: pct(house.boughtProb) }
        : null,
      retirement: ret ? { age: ret.age, savings_last_to_90: pct(ret.lastsTo90Prob), pension_income_month: Math.round(ret.monthlyIncomeAtRetirement) } : null,
      best_move: top ? `${translate("en", "narr.bestMove", { title: top.title, odds: top.newProb })}` : null,
    };
    const t0 = performance.now();
    const request = { task: "narrate", lang: locale, facts };
    const r = await callTwin<string>(request);
    let cloud: { locale: Locale; text: string } | undefined;
    let usage: Usage;
    if (r.ok && typeof r.data === "string") {
      cloud = { locale, text: r.data };
      usage = { ...r.usage!, mode: "llm" };
    } else {
      usage = { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "template (offline)", mode: "offline" };
    }
    addLedger(accountId, entryFromNarrate({ usage, payload: r.request ?? { wouldSend: request }, ms: performance.now() - t0, stateChars }));
    if (rev !== profileRevRef.current) return;
    setNarrative({ fallback, cloud, loading: false });
  }

  function applyRecipe(r: Recipe) {
    if (solving) return;
    const a = r.apply;
    mutate(
      (s) => {
        if (a.kind === "expenseDelta") return { ...s, expenseDelta: a.value };
        if (a.kind === "optimize") return { ...s, optimize: true };
        const shifted = applyScenarioOps(s, [{ op: "shift", id: a.eventId, months: a.months }], "solver");
        return a.kind === "combo" ? { ...shifted, expenseDelta: a.expenseDelta } : shifted;
      },
      { label: r.title },
    );
  }

  const set = (ops: Op[], label: Text) => mutate((s) => applyScenarioOps(s, validateOps(ops, s.events)), { label });

  const hasOverrides =
    scenario.expenseDelta !== 0 || scenario.optimize || !!scenario.income || scenario.recurring.length > 0;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 sm:grid-cols-[auto_1fr_auto_auto] sm:gap-3 sm:py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold text-white">D</span>
            <span className="font-serif text-2xl leading-none">Doppel</span>
          </div>
          <div className="flex items-center justify-self-end rounded-full border border-line p-0.5" role="group" aria-label={t("lang.switcher")}>
            {LOCALES.map((option) => (
              <button
                key={option}
                type="button"
                lang={LOCALE_TAGS[option]}
                aria-label={LOCALE_NAMES[option]}
                aria-pressed={locale === option}
                onClick={() => setLocale(option)}
                className={`rounded-full px-2 py-1 text-[11px] font-medium ${locale === option ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
          {/* Mobile: own full-width row; from sm the two items join the header grid (`contents`). */}
          <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 sm:contents">
            <AccountSwitcher
              accounts={accountsState.accounts}
              activeId={account.id}
              onSelect={setActiveAccount}
              onReset={onResetAccount}
              onDelete={onDeleteAccount}
              onNewAccount={() => setWizardOpen(true)}
            />
            <div className="shrink-0 justify-self-end">
              <FrugalBadge entries={ledger} onClick={() => setInspector(true)} />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-8 pb-24">
        {/* Hero: identity, headline, one supporting line, settings row */}
        <Hero
          name={effProfile.name}
          age={effProfile.age}
          city={effProfile.city}
          cityLang={FRENCH_CANTONS.has(effProfile.canton) ? "fr-CH" : "de-CH"}
          tagline={effProfile.tagline}
          goal={effProfile.goal.label}
          odds={real.successProb}
          ideal={ideal.successProb}
          fresh={fresh}
          netWorth={netWorthToday}
          crunch={real.crunchProb}
          sim={{ paths: real.paths, ms: real.ms }}
          impact={impact}
          taxTip={effProfile.contributes3a || scenario.optimize ? undefined : <TaxTip marginalTaxRate={effProfile.marginalTaxRate} />}
        >
          <InvestControls
            risk={effProfile.riskProfile}
            onRisk={(r: RiskProfile) => set([{ op: "set", key: "riskProfile", value: r }], msg("change.riskProfile", { risk: msg(`risk.${r}`) }))}
            contributes3a={effProfile.contributes3a || scenario.optimize}
            on3a={(v) => set([{ op: "set", key: "contributes3a", value: v }], msg(v ? "change.max3a" : "change.stop3a"))}
            monthlyInvest={scenario.monthlyInvest}
            onClearInvest={() => set([{ op: "set", key: "monthlyInvest", value: 0 }], msg("change.stopStandingOrder"))}
            panicHistory={effProfile.history.soldInDrawdown}
            marginalTaxRate={effProfile.marginalTaxRate}
          >
            <PlanCompare
              plan={pin}
              a={planAResult}
              b={real}
              goalAge={effProfile.goal.age}
              onPin={() => commitPin({ scenario: scenarioRef.current, label: msg("plan.pinned"), manual: true })}
              onUnpin={() => commitPin(null)}
            />
          </InvestControls>
        </Hero>

        <div className="mt-6 mb-6">
          <CommandBar onSubmit={onCommand} busy={cmdBusy} message={cmdMsg} />
        </div>

        {/* Your future: the chart next to the snap input that changes it */}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="card p-4 sm:p-6">
            <CardHeader title={t("chart.title")} />
            <ConeChart
              real={real}
              ideal={ideal}
              goal={effProfile.goal}
              planA={planAResult && planAResult !== real ? planAResult : null}
              retirementAge={effProfile.retirementAge}
              eventAges={scenario.events.map((e) => ({ age: effProfile.age + Math.floor(e.month / 12), id: e.id }))}
            />
            <div className="mt-5">
              <Timeline
                events={scenario.events}
                age={effProfile.age}
                onShift={(id, m) => {
                  const e = scenario.events.find((x) => x.id === id);
                  set([{ op: "shift", id, months: m }], msg("change.shiftEvent", { label: e?.labelMsg ?? e?.label ?? msg("change.eventFallback"), months: m }));
                }}
                onRemove={(id) => {
                  const e = scenario.events.find((x) => x.id === id);
                  set([{ op: "remove", id }], msg("change.removeItem", { label: e?.labelMsg ?? e?.label ?? msg("change.removeEventFallback") }));
                }}
              />
            </div>
            {hasOverrides && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {scenario.expenseDelta !== 0 && (
                  <Pill label={msg("pill.spending", { amount: scenario.expenseDelta })}
                    onClear={() => mutate((s) => ({ ...s, expenseDelta: 0 }), { label: msg("change.resetSpending") })} />
                )}
                {scenario.optimize && (
                  <Pill label={msg("pill.optimize")}
                    onClear={() => mutate((s) => ({ ...s, optimize: false }), { label: msg("change.stopIdle") })} />
                )}
                {scenario.income && (
                  <Pill label={msg("pill.income", { label: scenario.income.label, gross: scenario.income.grossIncomeYear, net: scenario.income.netIncomeMonth })}
                    onClear={() => mutate((s) => ({ ...s, income: null }), { label: msg("change.removePayslip") })} />
                )}
                {scenario.recurring.map((r) => (
                  <Pill key={r.id} label={msg("pill.recurring", { label: r.label, amount: r.monthly })}
                    onClear={() => mutate((s) => ({ ...s, recurring: s.recurring.filter((x) => x.id !== r.id) }), { label: msg("change.removeItem", { label: r.label }) })} />
                ))}
              </div>
            )}
          </section>
          <SnapPanel key={profileId} onResult={onSnap} items={snaps} />
        </div>

        <div className="mt-14 space-y-14">
          <Section title={t("layout.decisions")}>
            <div className="grid items-start gap-5 lg:grid-cols-2">
              {affordability && house && (
                <AffordabilityCard
                  result={affordability}
                  label={house.labelMsg ?? house.label}
                  month={house.month}
                  boughtProb={house.boughtProb}
                  floorPlan={floorPlan}
                />
              )}
              <RetirementCard
                stats={real.retirement}
                retirementAge={effProfile.retirementAge}
                disabled={!fresh}
                onChangeAge={(age) => set([{ op: "set", key: "retirementAge", value: age }], msg("change.retireAt", { age }))}
              />
            </div>
          </Section>

          <Section title={t("layout.nextSteps")}>
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <RecipesCard recipes={recipes} loading={solving} baseProb={real.successProb} onApply={applyRecipe} />
              <BankerCard
                started={!!narrative}
                loading={!!narrative?.loading}
                text={narrative && !narrative.loading
                  ? narrative.cloud?.locale === locale ? narrative.cloud.text : narrative.fallback.map(tm).join(" ")
                  : undefined}
                onExplain={narrate}
              />
            </div>
          </Section>

          <Section title={t("layout.habits")}>
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <BehaviorCard
                behavior={behavior}
                costChf={behaviorCost}
                habitCosts={extras?.key === inputsKey ? extras.habits : null}
                crunchProb={real.crunchProb}
                goalAge={effProfile.goal.age}
              />
              <WaitingStrip items={sameProfileExtras ? sameProfileExtras.waiting : undefined} loading={extras?.key !== inputsKey} />
            </div>
          </Section>

          <Section title={t("data.sectionTitle")}>
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <ImportPanel
                account={account}
                onLedger={(entry) => addLedger(account.id, entry)}
                onDataChange={onDataChange}
                openToken={importOpenToken}
              />
              <TransactionsPanel account={account} onDataChange={onDataChange} />
            </div>
          </Section>
        </div>
      </main>

      <AccountWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(id, withImport) => {
          setWizardOpen(false);
          setActiveAccount(id);
          if (withImport) setImportOpenToken((n) => n + 1);
        }}
      />
      <Inspector entries={ledger} open={inspector} onClose={() => setInspector(false)} />
    </div>
  );
}

function Pill({ label, onClear }: { label: Msg; onClear: () => void }) {
  const { t, tm } = useI18n();
  return (
    <span className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3">
      {tm(label)}
      <button onClick={onClear} aria-label={t("pill.clear", { label })} className="rounded-full px-1.5 text-ink-3 hover:text-ink">
        ✕
      </button>
    </span>
  );
}

function templateNarrative(facts: {
  goal: Msg;
  odds: number;
  ideal: number;
  home: { pass: boolean; maxPrice: number } | null;
  habit?: Msg;
  habitCost: number;
  retirement?: SimResult["retirement"];
  best?: Recipe;
}): Msg[] {
  const { goal, odds, ideal, home, habit, habitCost, retirement, best } = facts;
  const parts = [msg("narr.goal", { goal, odds, ideal })];
  if (home && !home.pass) parts.push(msg("narr.homeFails", { max: home.maxPrice }));
  else if (habit) parts.push(msg("narr.topHabit", { habit, cost: habitCost }));
  if (retirement) parts.push(msg("narr.retirement", { age: retirement.age, odds: retirement.lastsTo90Prob }));
  if (best) parts.push(msg("narr.nextStep", { move: msg("narr.bestMove", { title: best.title, odds: best.newProb }) }));
  return parts;
}
