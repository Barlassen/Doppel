"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  addReceipt,
  deleteAccount,
  getAccount,
  hydrateAccounts,
  listImports,
  resetAccount,
  setProfileFields,
  setActiveAccount,
  useAccounts,
  type Account,
  type AccountsState,
} from "@/lib/accounts";
import { ASSUMPTIONS, EQUITY_WEIGHT, simulate } from "@/lib/finance/monteCarlo";
import { analyzeBehavior } from "@/lib/finance/behavioralEngine";
import { solveGoal, type Recipe, type SolverResult } from "@/lib/finance/goalSolver";
import { checkAffordability } from "@/lib/finance/swissRules";
import { ECONOMIES } from "@/lib/finance/economy";
import { compileLife } from "@/lib/finance/life";
import { outlook, type Outlook } from "@/lib/finance/outlook";
import { netWorthOf, totalDebt } from "@/lib/finance/debt";
import {
  baseScenario,
  costOfWaiting,
  effectiveProfile,
  habitCosts,
  simInputFor,
  type HabitCosts,
  type WaitingCost,
} from "@/lib/finance/scenario";
import { GOAL_DEFINITION, type LifeEvent, type Profile, type RiskProfile, type Scenario, type SimResult } from "@/lib/finance/types";
import {
  applyScenarioOps,
  BOUNDS,
  compactEvents,
  describeOps,
  extractionToUpdate,
  localParseCommand,
  validateOps,
  validateLocalOps,
  type Op,
} from "@/lib/twin/actions";
import { orderedParsers } from "@/lib/twin/intents";
import { eventLabel } from "@/lib/twin/intents/shared";
import { askErrorMsg, askTwin, callTwin, twinStatus, type AskFacts, type TwinStatus } from "@/lib/llm";
import { entryFromAsk, entryFromCommand, entryFromNarrate, entryFromSnap, usageBasisMsg, type LedgerEntry } from "@/lib/frugal/ledger";
import { summaryAskFacts, type InferredFact } from "@/lib/import";
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
import { AskCard, type AssistantReply } from "./AskCard";
import { ConeChart, type ChartMarker } from "./ConeChart";
import { DecisionsCard, eventIcon, markerIcon } from "./Decisions";
import { EconomyNote, EconomySelect, economyIdOf } from "./EconomyControl";
import { learnedFrom } from "./Learned";
import { OutlookCard } from "./OutlookCard";
import { useStatementMemory } from "./statementMemory";
import type { IncomingStatement } from "./ImportPanel";
import { CommandBar } from "./CommandBar";
import { SnapPanel, type SnapItem } from "./SnapPanel";
import { FrugalBadge, Inspector } from "./Inspector";
import { AffordabilityCard, BehaviorCard, RecipesCard } from "./Cards";
import { RetirementCard } from "./RetirementCard";
import { PlanCompare, type PinnedPlan } from "./PlanCompare";
import { InvestControls, TaxTip, WaitingStrip } from "./InvestControls";
import { defaultHealthPremium } from "@/lib/finance/canton";
import { CHILD } from "@/lib/finance/params";
import { cantonLine } from "./CantonLine";
import { Hero } from "./Hero";
import { CardHeader, Section } from "./ui";
import { AccountSwitcher } from "./AccountSwitcher";
import { SiteNav } from "./SiteNav";
import { AccountWizard } from "./AccountWizard";
import { ImportPanel } from "./ImportPanel";
import { TransactionsPanel } from "./TransactionsPanel";
import { DebtCard, GoalsCard, UbsSourceNote, startDate } from "./UbsCards";
import { ALEXIA_ID } from "@/lib/ubs/types";
import { clearPath, pathLabel, type AlexiaPathId } from "@/lib/ubs/path";

// Loaded on demand: the picker carries the 1'200-profile search summary, the path card only shows for Alexia.
const UbsPicker = dynamic(() => import("./UbsPicker"), { ssr: false });
const AlexiaPaths = dynamic(() => import("./AlexiaPaths"), { ssr: false });

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
    cloud?: { locale: Locale; text: string; model: string };
  } | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  // The assistant: whether one is connected (asked once after mount), and the last question with its answer.
  const [assistant, setAssistant] = useState<TwinStatus | undefined | "checking">("checking");
  const [ask, setAsk] = useState<{ question: string; loading: boolean; text?: string; error?: Msg; model?: string; usage?: AssistantReply["usage"] } | null>(null);
  // A decision to open in the form: a what-if or a confirmed statement fact that still needs inputs.
  const [decisionSeed, setDecisionSeed] = useState<{ token: number; op: Extract<Op, { op: "add" }> } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [ubsPickerOpen, setUbsPickerOpen] = useState(false);
  const [incomingStatement, setIncomingStatement] = useState<IncomingStatement | null>(null);
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
  // "What happens next": the engine's outlook of the current plan against the account's own plan.
  const [outlookState, setOutlookState] = useState<{ key: string; profileId: string; result: Outlook } | null>(null);
  const outlookCache = useRef(new Map<string, Outlook>());
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
    setAsk(null);
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

  // The <title> follows the language. React owns the server-rendered <title> and writes the English text back when
  // it re-renders the head, so the localized title is re-applied whenever that element changes.
  useEffect(() => {
    const want = t("ux.docTitle");
    const apply = () => {
      if (document.title !== want) document.title = want;
    };
    apply();
    const el = document.querySelector("head > title");
    if (!el) return;
    const observer = new MutationObserver(apply);
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` changes with the locale
  }, [locale]);

  useEffect(() => {
    let alive = true;
    void twinStatus().then((status) => {
      if (alive) setAssistant(status);
    });
    return () => {
      alive = false;
    };
  }, []);

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
    setAsk(null);
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
  const outlookKeyRef = useRef<string | null>(null);
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
      if (outlookKeyRef.current !== key) {
        const cached = outlookCache.current.get(key);
        if (cached) {
          setOutlookState({ key, profileId: prof.id, result: cached });
          outlookKeyRef.current = key;
        } else
          step(() => {
            const b = analyzeBehavior(effectiveProfile(prof, s), s.extraTx);
            // Before = the account's own plan in the same economy, so the difference is the decisions.
            const own = baseScenarioFor(acc);
            const { economy, ...plan } = s;
            const unchanged = JSON.stringify(plan) === JSON.stringify(own);
            const result = outlook(prof, s, { baseline: unchanged ? null : own, behavior: b.params, ...(economy ? { economy } : {}) });
            remember(outlookCache.current, key, result, 8);
            setOutlookState({ key, profileId: prof.id, result });
            outlookKeyRef.current = key;
          }, 20);
      }
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
            ...(house.medianOtherDebtYear ? { otherDebtYear: house.medianOtherDebtYear } : {}),
          })
        : null,
    [house],
  );

  const behaviorCost = ideal.medianAtGoal - real.medianAtGoal;
  // Net worth = assets − liabilities (hero, switcher, chart and solver all use the same definition).
  const netWorthToday = netWorthOf(effProfile);
  const debtToday = totalDebt(effProfile);
  const start = startDate(effProfile);
  const accountStart = useMemo(() => baseScenarioFor(account), [account]);
  const goalIsNetWorth = (effProfile.goal.metric ?? "netWorth") === "netWorth";

  function setDebtExtra(value: number) {
    mutate(
      (s) => {
        const { debtExtra: _old, ...rest } = s;
        void _old;
        return value > 0 ? { ...rest, debtExtra: value } : rest;
      },
      { label: value > 0 ? msg("ubs.changeDebtExtra", { amount: value }) : msg("ubs.changeDebtStop") },
    );
  }
  function applyAlexiaPath(next: Scenario, id: AlexiaPathId) {
    mutate(() => next, { label: msg("ubs.changePath", { label: pathLabel(id) }) });
  }
  function pinAlexiaPath(next: Scenario, id: AlexiaPathId) {
    commitPin({ scenario: next, label: pathLabel(id), manual: true });
  }
  // The outlook of this account: the fresh one, or the previous one (dimmed) while the next is computed.
  const outlookShown = outlookState?.profileId === profileId ? outlookState.result : null;
  const outlookFresh = outlookState?.key === inputsKey ? outlookState.result : null;
  const economyId = economyIdOf(scenario.economy);
  const planStart = useMemo(() => start ?? new Date(), [start]);
  // Chart markers: the outlook's dated markers (birth, daycare, car bought, …); the plan's events until it is ready.
  const chartMarkers = useMemo<ChartMarker[]>(() => {
    if (!outlookFresh) {
      return scenario.events.map((e) => ({ id: e.id, age: effProfile.age + Math.floor(e.month / 12), icon: eventIcon(e), label: e.labelMsg ?? e.label, rank: 0 }));
    }
    const seen = new Set<string>();
    return outlookFresh.markers
      .filter((m) => m.kind !== "goal" && m.kind !== "retirement" && m.kind !== "ahv")
      .map((m, i) => {
        const first = !!m.eventId && !seen.has(m.eventId);
        if (m.eventId) seen.add(m.eventId);
        return { id: `${m.kind}-${m.month}-${i}`, age: m.age, icon: markerIcon(m.kind), label: m.label, rank: first ? 0 : m.eventId ? 1 : 2 };
      });
  }, [outlookFresh, scenario.events, effProfile.age]);
  // The "before" line: a manually pinned Plan A, else the account's own plan from the outlook.
  const manualPlanA = pin?.manual && planAResult && planAResult !== real ? planAResult : null;
  const chartBefore = manualPlanA ?? outlookFresh?.baselineSim ?? null;
  const memory = useStatementMemory(account.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the account version changes with every import
  const importIds = useMemo(() => listImports(account.id).map((r) => r.id), [account.id, account.version]);
  const learned = useMemo(() => learnedFrom(account, memory.income, importIds), [account, memory.income, importIds]);

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
  /**
   * Why the local parsers produced no valid change, when the reason is known: the what-if was understood but cannot
   * apply (a retirement age outside the engine's range, or "delay the home" with no home on the timeline). The
   * parsers return raw ops; only the validation dropped them, so no parser change is needed for these two messages.
   */
  function whyNotApplied(text: string): Msg | null {
    const events = scenarioRef.current.events;
    const ctx = { text, events, now: new Date(), retirementAge: effProfile.retirementAge, house: events.find((e) => e.type === "house") };
    const parsers = orderedParsers(locale);
    const [minAge, maxAge] = BOUNDS.retirementAge;
    for (const op of parsers.flatMap((parser) => parser.parse(ctx))) {
      if (op.op === "set" && op.key === "retirementAge" && typeof op.value === "number" && (op.value < minAge || op.value > maxAge)) {
        return msg("ux.cmdRetireRange", { min: minAge, max: maxAge });
      }
    }
    if (!ctx.house) {
      const probe: LifeEvent = { id: "probe-home", type: "house", label: "", month: 0, amount: 0 };
      const withHome = parsers.flatMap((parser) => parser.parse({ ...ctx, events: [...events, probe], house: probe }));
      if (withHome.some((op) => op.op === "shift" && op.id === probe.id)) return msg("ux.cmdNoHome");
    }
    return null;
  }

  /** The first decision among `ops` for which the engine still lacks an input it cannot source (e.g. the new rent of a move). */
  function decisionLackingInputs(ops: Op[]): Extract<Op, { op: "add" }> | null {
    const months = (ASSUMPTIONS.endAge - effProfile.age) * 12;
    const retireMonth = Math.max(0, (effProfile.retirementAge - effProfile.age) * 12);
    for (const o of ops) {
      if (o.op !== "add" || !o.decision) continue;
      const probe: LifeEvent = { id: "probe-decision", type: o.type, label: o.label, month: o.month, amount: 0, decision: o.decision };
      if (compileLife(effProfile, [...scenarioRef.current.events, probe], months, retireMonth).inputsNeeded.some((n) => n.eventId === probe.id)) return o;
    }
    return null;
  }

  /** Decisions from the picker (and edits): the same ops as a what-if, applied through the same path. */
  function applyDecision(ops: Op[], label: Text) {
    mutate((s) => applyScenarioOps(s, validateOps(ops, s.events), "command", { profile: base }), { label });
  }

  /** A life fact read from the statement was confirmed: what it means for the profile or the plan. */
  function onFact(fact: InferredFact) {
    const id = accountRef.current.id;
    const amount = Math.round(fact.monthlyAmount);
    const seed = (op: Extract<Op, { op: "add" }>) => setDecisionSeed((prev) => ({ token: (prev?.token ?? 0) + 1, op }));
    switch (fact.id) {
      case "salary":
        if (amount > 0) {
          onDataChange(msg("ux.learned.did.salary", { amount }));
          setProfileFields(id, { netIncomeMonth: amount });
        }
        break;
      case "tenant":
        if (amount > 0) {
          onDataChange(msg("ux.learned.did.tenant", { amount }));
          setProfileFields(id, { rentMonth: amount });
        }
        break;
      case "pillar3a":
        onDataChange(msg("ux.learned.did.pillar3a", { amount }));
        setProfileFields(id, { contributes3a: true });
        break;
      case "car": {
        // The car is already in the spending: the decision starts today and names that spending as replaced.
        const lease = learned.summary?.fixed.items.find((item) => item.kind === "leasing");
        seed({
          op: "add", type: "expense", ...eventLabel({ key: lease ? "life.event.carLease" : "life.event.car" }), month: 0, amount: 0,
          decision: { kind: "car", mode: lease ? "leased" : "owned", ...(lease ? { leaseMonthly: Math.round(lease.monthlyAmount) } : {}), ...(amount > 0 ? { replacesMonthly: amount } : {}) },
        });
        break;
      }
      case "child": {
        const daycare = learned.summary?.fixed.items.find((item) => item.kind === "childcare");
        const days = CHILD.kitaDaysPerWeek.value;
        seed({
          op: "add", type: "child", ...eventLabel({ key: "event.baby" }), month: 0, amount: 0,
          decision: { kind: "child", ...(daycare ? { ageYears: 2, kitaDaysPerWeek: days, kitaDailyChf: Math.round(daycare.monthlyAmount / (days * CHILD.kitaWeeksPerMonth.value)) } : {}) },
        });
        break;
      }
      default:
        break; // owner, debt, investor: remembered as confirmed; the profile already carries what they imply
    }
  }

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
    } else if (whyNotApplied(text)) {
      // Understood locally, but it cannot apply: say why instead of sending it to a model.
      setCmdMsg(whyNotApplied(text) ?? undefined);
      setCmdBusy(false);
      return;
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
    const lacking = ops && ops.length ? decisionLackingInputs(ops) : null;
    if (lacking) {
      // Understood, but the engine has no sourced value for part of it: the form opens with what was said.
      setDecisionSeed((prev) => ({ token: (prev?.token ?? 0) + 1, op: lacking }));
      status = msg("ux.cmdNeedsInputs", { label: lacking.labelMsg ?? lacking.label });
    } else if (ops && ops.length) {
      const valid = ops;
      mutate((s) => applyScenarioOps(s, valid, "command", { profile: base }), { label: text });
      status = msg("cmd.result", { status, ops: describeOps(valid) });
    }
    setCmdMsg(status);
    setCmdBusy(false);
  }

  // ---------------- private banker narration ----------------
  async function narrate() {
    const rev = profileRevRef.current;
    const accountId = accountRef.current.id;
    setAsk(null);
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
    let cloud: { locale: Locale; text: string; model: string } | undefined;
    let usage: Usage;
    if (r.ok && typeof r.data === "string") {
      cloud = { locale, text: r.data, model: r.usage?.model ?? "LLM" };
      usage = { ...r.usage!, mode: "llm" };
    } else {
      usage = { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "template (offline)", mode: "offline" };
    }
    addLedger(accountId, entryFromNarrate({ usage, payload: r.request ?? { wouldSend: request }, ms: performance.now() - t0, stateChars }));
    if (rev !== profileRevRef.current) return;
    setNarrative({ fallback, cloud, loading: false });
  }

  /** The engine's current figures, as the flat facts an answer may quote (percent as numbers, money in CHF). */
  function askFactsNow(): AskFacts {
    const pctOf = (share: number) => Math.round(share * 1000) / 10;
    const chfOf = (amount: number) => Math.round(amount);
    const goalBand = real.bands.find((b) => b.age === effProfile.goal.age);
    const ret = real.retirement;
    const top = recipes[0];
    const decisions = scenario.events.map((e) => translateText("en", e.labelMsg ?? e.label)).join(", ");
    return {
      client: effProfile.name,
      age: effProfile.age,
      city: effProfile.city,
      canton: effProfile.canton,
      risk_profile: effProfile.riskProfile,
      goal: translateText("en", effProfile.goal.label),
      goal_amount_chf: effProfile.goal.target,
      horizon_years: Math.max(0, effProfile.goal.age - effProfile.age),
      net_worth_chf: chfOf(netWorthToday),
      liquid_savings_chf: chfOf(effProfile.cash),
      investments_chf: chfOf(effProfile.portfolio),
      pillar3a_chf: chfOf(effProfile.pillar3a),
      pension_fund_chf: chfOf(effProfile.pillar2),
      ...(debtToday > 0 ? { debt_chf: chfOf(debtToday) } : {}),
      monthly_net_income_chf: chfOf(effProfile.netIncomeMonth),
      monthly_expenses_chf: chfOf(effProfile.expensesMonth),
      monthly_savings_chf: chfOf(effProfile.netIncomeMonth - effProfile.expensesMonth),
      ...(effProfile.netIncomeMonth > 0 ? { savings_rate_pct: pctOf((effProfile.netIncomeMonth - effProfile.expensesMonth) / effProfile.netIncomeMonth) } : {}),
      contributes_3a: effProfile.contributes3a,
      odds_with_habits_pct: pctOf(real.successProb),
      odds_disciplined_pct: pctOf(ideal.successProb),
      cash_crunch_risk_pct: pctOf(real.crunchProb),
      habit_cost_chf: chfOf(Math.max(0, behaviorCost)),
      ...(behavior.insights[0] ? { top_habit: translateText("en", behavior.insights[0].title) } : {}),
      ...(goalBand ? { net_worth_p10_chf: chfOf(goalBand.p10), net_worth_median_chf: chfOf(goalBand.p50), net_worth_p90_chf: chfOf(goalBand.p90) } : {}),
      ...(top ? { best_move: translateText("en", top.title), best_move_odds_pct: pctOf(top.newProb) } : {}),
      ...(affordability && house
        ? { home_price_chf: chfOf(house.price), home_affordable: affordability.pass, home_cost_to_income_pct: pctOf(affordability.costToIncome), home_max_price_chf: chfOf(affordability.maxPrice), home_bought_pct: pctOf(house.boughtProb) }
        : {}),
      ...(ret
        ? { retirement_age: ret.age, retirement_income_month_chf: chfOf(ret.monthlyIncomeAtRetirement), retirement_gap_month_chf: chfOf(Math.max(0, ret.monthlySpending - ret.monthlyIncomeAtRetirement)), savings_last_to_90_pct: pctOf(ret.lastsTo90Prob) }
        : {}),
      ...(learned.summary ? summaryAskFacts(learned.summary) : {}),
      scenario: [translate("en", `economy.name.${economyId}`) + " economy", decisions ? "decisions: " + decisions : "no added decisions"].join("; "),
      assumptions: translate("en", "ux.assumptions", {
        equity: ASSUMPTIONS.equity.mu, equityVol: ASSUMPTIONS.equity.sigma, bonds: ASSUMPTIONS.bonds.mu, bondsVol: ASSUMPTIONS.bonds.sigma, cash: ASSUMPTIONS.cashRate,
        inflation: ASSUMPTIONS.inflation, wages: ASSUMPTIONS.wageGrowth, overdraft: ASSUMPTIONS.overdraftRate, share: EQUITY_WEIGHT[effProfile.riskProfile],
      }),
      ...(outlookFresh ? { note: `lowest cash point CHF ${chfOf(outlookFresh.cashLow.median.amount)} in ${outlookFresh.cashLow.median.year}; monthly surplus CHF ${chfOf(outlookFresh.budget.after.surplus)}` } : {}),
    };
  }

  // ---------------- ask your twin ----------------
  async function onAsk(question: string) {
    const rev = profileRevRef.current;
    const accountId = accountRef.current.id;
    setAsk({ question, loading: true });
    const facts = askFactsNow();
    const t0 = performance.now();
    const r = await askTwin(question, facts, locale);
    const ms = r.ms ?? performance.now() - t0;
    const answered = r.ok && typeof r.data === "string" && r.data.trim() !== "";
    const usage: Usage = r.usage
      ? { ...r.usage, mode: "llm" }
      : { promptTokens: 0, completionTokens: 0, costUsd: 0, model: r.offline ? "not connected" : "assistant", mode: r.offline ? "offline" : "llm" };
    addLedger(accountId, entryFromAsk({ question, usage, payload: r.request ?? { question, facts }, ms, stateChars, usageKnown: r.usageKnown, outcome: answered ? "ok" : "failed" }));
    if (rev !== profileRevRef.current) return;
    setAsk(answered
      ? { question, loading: false, text: r.data!.trim(), model: usage.model, usage: { tokens: usage.promptTokens + usage.completionTokens, costUsd: usage.costUsd, basis: usageBasisMsg(usage) } }
      : { question, loading: false, error: askErrorMsg(r) });
  }

  function applyRecipe(r: Recipe) {
    if (solving) return;
    const a = r.apply;
    mutate(
      (s) => {
        if (a.kind === "expenseDelta") return { ...s, expenseDelta: a.value };
        if (a.kind === "optimize") return { ...s, optimize: true };
        if (a.kind === "debtExtra") return { ...s, debtExtra: a.value };
        const shifted = applyScenarioOps(s, [{ op: "shift", id: a.eventId, months: a.months }], "solver");
        return a.kind === "combo" ? { ...shifted, expenseDelta: a.expenseDelta } : shifted;
      },
      { label: r.title },
    );
  }

  const set = (ops: Op[], label: Text) => mutate((s) => applyScenarioOps(s, validateOps(ops, s.events)), { label });

  const hasOverrides =
    scenario.expenseDelta !== 0 || scenario.optimize || !!scenario.income || scenario.recurring.length > 0 || !!scenario.path || !!scenario.debtExtra;

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-ink focus:px-3 focus:py-1.5 focus:text-xs focus:font-medium focus:text-bg">
        {t("ux.skip")}
      </a>
      {/* Header. Below `sm`: logo + page nav + a compact language select on the first row, account + tokens on the second. */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 sm:grid-cols-[auto_1fr_auto_auto] sm:gap-3 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-sm font-bold text-white">D</span>
            <span className="hidden font-serif text-2xl leading-none min-[360px]:inline">Doppel</span>
            <SiteNav current="dashboard" />
          </div>
          <div className="justify-self-end">
            <select
              aria-label={t("lang.switcher")}
              data-testid="lang-select"
              value={locale}
              onChange={(e) => setLocale(e.currentTarget.value as Locale)}
              className="min-h-7 rounded-full border border-line bg-surface px-2 text-[11px] font-medium text-ink sm:hidden"
            >
              {LOCALES.map((option) => (
                <option key={option} value={option} lang={LOCALE_TAGS[option]} aria-label={LOCALE_NAMES[option]}>
                  {option.toUpperCase()}
                </option>
              ))}
            </select>
            <div className="hidden items-center rounded-full border border-line p-0.5 sm:flex" role="group" aria-label={t("lang.switcher")}>
              {LOCALES.map((option) => (
                <button
                  key={option}
                  type="button"
                  lang={LOCALE_TAGS[option]}
                  aria-label={LOCALE_NAMES[option]}
                  aria-pressed={locale === option}
                  onClick={() => setLocale(option)}
                  className={`min-h-6 rounded-full px-2 py-1 text-[11px] font-medium ${locale === option ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
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
              onOpenUbs={() => setUbsPickerOpen(true)}
            />
            <div className="shrink-0 justify-self-end">
              <FrugalBadge entries={ledger} onClick={() => setInspector(true)} />
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pt-8 pb-24">
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
          economy={t("ux.econ.chip", { name: ECONOMIES[economyId].label })}
          impact={impact}
          taxTip={effProfile.contributes3a || scenario.optimize || effProfile.retirementAge <= effProfile.age ? undefined : <TaxTip marginalTaxRate={effProfile.marginalTaxRate} />}
          notes={
            <>
              {debtToday > 0 && <li>{t("ubs.heroDebt", { debt: debtToday })}</li>}
              <li data-testid="assumptions">
                {t("ux.assumptions", {
                  equity: ASSUMPTIONS.equity.mu,
                  equityVol: ASSUMPTIONS.equity.sigma,
                  bonds: ASSUMPTIONS.bonds.mu,
                  bondsVol: ASSUMPTIONS.bonds.sigma,
                  cash: ASSUMPTIONS.cashRate,
                  inflation: ASSUMPTIONS.inflation,
                  wages: ASSUMPTIONS.wageGrowth,
                  overdraft: ASSUMPTIONS.overdraftRate,
                  share: EQUITY_WEIGHT[effProfile.riskProfile],
                })}
              </li>
              <li>
                {cantonLine(t, effProfile.canton, effProfile.healthPremiumMonth ?? defaultHealthPremium(effProfile))}
                {effProfile.healthPremiumMonth === undefined && <> {t("ux.premiumAssumed")}</>}
              </li>
              {!effProfile.origin && (
                <li>
                  {t(account.builtIn ? "ux.inputsDemo" : "ux.inputsOwn", { transactions: effProfile.transactions.length, trades: effProfile.trades.length })}
                </li>
              )}
              <li>{t("ux.notAdvice")}</li>
            </>
          }
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
            no3a={effProfile.retirementAge <= effProfile.age}
            economy={
              <EconomySelect
                value={economyId}
                onChange={(id) => set([{ op: "set", key: "economy", value: id }], msg("economy.opSet", { value: ECONOMIES[id].label }))}
              />
            }
            note={<EconomyNote value={economyId} />}
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
        <UbsSourceNote profile={effProfile} />

        <div className="mt-6 mb-6">
          <CommandBar onSubmit={onCommand} busy={cmdBusy} message={cmdMsg} hasHome={scenario.events.some((e) => e.type === "house")} />
        </div>

        {/* Your future: the chart, next to the data that feeds it (bank statement first, other documents second) */}
        <h2 className="sr-only">{t("ux.futureTitle")}</h2>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="card p-4 sm:p-6">
            <CardHeader title={t("chart.title")} />
            <ConeChart
              real={real}
              ideal={ideal}
              goal={effProfile.goal}
              before={chartBefore}
              beforeLabel={manualPlanA && pin ? t("plan.label", { marker: "", label: pin.label }) : t("ux.chart.legendBefore")}
              cashLow={outlookFresh?.cashLow}
              retirementAge={effProfile.retirementAge}
              markers={chartMarkers}
              targetLine={goalIsNetWorth}
              netWorthToday={netWorthToday}
              footnote={economyId !== "baseline" ? tm(ECONOMIES[economyId].summary) : undefined}
            />
            {!goalIsNetWorth && <p className="mt-2 text-xs text-ink-2">{t("ubs.chartMetricNote")}</p>}
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
                {scenario.path && (
                  <Pill label={msg("ubs.pillPath", { label: scenario.path.label })}
                    onClear={() => mutate((s) => clearPath(s), { label: msg("ubs.changeClearPath") })} />
                )}
                {!!scenario.debtExtra && (
                  <Pill label={msg("ubs.pillDebt", { amount: scenario.debtExtra })} onClear={() => setDebtExtra(0)} />
                )}
                {scenario.recurring.map((r) => (
                  <Pill key={r.id} label={msg("pill.recurring", { label: r.label, amount: r.monthly })}
                    onClear={() => mutate((s) => ({ ...s, recurring: s.recurring.filter((x) => x.id !== r.id) }), { label: msg("change.removeItem", { label: r.label }) })} />
                ))}
              </div>
            )}
          </section>
          <ImportPanel
            account={account}
            onFact={onFact}
            onLedger={(entry) => addLedger(account.id, entry)}
            onDataChange={onDataChange}
            incoming={incomingStatement}
          >
            <SnapPanel key={profileId} onResult={onSnap} items={snaps} />
          </ImportPanel>
        </div>

        <div className="mt-14 space-y-14">
          <Section title={t("layout.decisions")}>
            {/* Extension point "decisions": every big decision is one card in this grid (home, retirement, debt, …).
                New life decisions from the engine go here as further cards, in the same CardHeader style. */}
            <div className="grid items-start gap-5 lg:grid-cols-2" data-slot="decisions">
              <DecisionsCard
                profile={effProfile}
                events={scenario.events}
                start={planStart}
                outlooks={outlookFresh?.decisions}
                needs={outlookFresh?.inputsNeeded}
                seed={decisionSeed}
                onApply={applyDecision}
                onShift={(id, m) => {
                  const e = scenario.events.find((x) => x.id === id);
                  set([{ op: "shift", id, months: m }], msg("change.shiftEvent", { label: e?.labelMsg ?? e?.label ?? msg("change.eventFallback"), months: m }));
                }}
                onRemove={(id) => {
                  const e = scenario.events.find((x) => x.id === id);
                  set([{ op: "remove", id }], msg("change.removeItem", { label: e?.labelMsg ?? e?.label ?? msg("change.removeEventFallback") }));
                }}
              />
              <OutlookCard outlook={outlookShown} loading={!outlookFresh} start={start} />
              {account.id === ALEXIA_ID && (
                <AlexiaPaths base={base} scenario={accountStart} activePath={scenario.path?.id} onApply={applyAlexiaPath} onPin={pinAlexiaPath} />
              )}
              {effProfile.goals && effProfile.goals.length > 0 && (
                <GoalsCard goals={effProfile.goals} stats={real.goals} fresh={fresh} />
              )}
              {effProfile.liabilities && effProfile.liabilities.length > 0 && (
                <DebtCard liabilities={effProfile.liabilities} extra={scenario.debtExtra ?? 0} onExtra={setDebtExtra} start={start} disabled={!fresh} />
              )}
              {affordability && house && (
                <AffordabilityCard
                  result={affordability}
                  label={house.labelMsg ?? house.label}
                  month={house.month}
                  boughtProb={house.boughtProb}
                  floorPlan={floorPlan}
                  start={start}
                />
              )}
              <RetirementCard
                stats={real.retirement}
                retirementAge={effProfile.retirementAge}
                disabled={!fresh}
                alreadyRetired={effProfile.retirementAge <= effProfile.age}
                onChangeAge={(age) => set([{ op: "set", key: "retirementAge", value: age }], msg("change.retireAt", { age }))}
              />
            </div>
          </Section>

          <Section title={t("layout.nextSteps")}>
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <RecipesCard recipes={recipes} loading={solving} baseProb={real.successProb} onApply={applyRecipe} />
              <AskCard
                status={assistant}
                busy={!!ask?.loading || !!narrative?.loading}
                reply={
                  ask && !ask.loading
                    ? { question: ask.question, text: ask.text, error: ask.error, source: ask.model ? { model: ask.model } : undefined, usage: ask.usage }
                    : !ask && narrative && !narrative.loading
                      ? {
                          text: narrative.cloud?.locale === locale ? narrative.cloud.text : narrative.fallback.map(tm).join(" "),
                          source: narrative.cloud?.locale === locale ? { model: narrative.cloud.model } : "template",
                        }
                      : null
                }
                onAsk={onAsk}
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
            <TransactionsPanel account={account} onDataChange={onDataChange} />
          </Section>
        </div>
      </main>

      <AccountWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(id, statement) => {
          setWizardOpen(false);
          setActiveAccount(id);
          if (statement) setIncomingStatement((prev) => ({ id: (prev?.id ?? 0) + 1, accountId: id, ...statement }));
        }}
      />
      {ubsPickerOpen && (
        <UbsPicker
          open={ubsPickerOpen}
          onClose={() => setUbsPickerOpen(false)}
          onOpened={(id) => {
            setUbsPickerOpen(false);
            setActiveAccount(id);
          }}
        />
      )}
      <Inspector entries={ledger} open={inspector} onClose={() => setInspector(false)} />
    </div>
  );
}

function Pill({ label, onClear }: { label: Msg; onClear: () => void }) {
  const { t, tm } = useI18n();
  return (
    <span className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3">
      {tm(label)}
      <button type="button" onClick={onClear} aria-label={t("pill.clear", { label })} className="grid min-h-6 min-w-6 place-items-center rounded-full text-ink-3 hover:text-ink">
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
