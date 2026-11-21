"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PROFILES } from "@/lib/data/profiles";
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
  type Op,
} from "@/lib/twin/actions";
import { callTwin } from "@/lib/llm";
import type { LedgerEntry } from "@/lib/frugal/ledger";
import { naiveReasoning, naiveSnap } from "@/lib/frugal/tokens";
import type { SnapResult, Usage } from "@/lib/snap/types";
import { chf, monthToLabel, pct } from "@/lib/format";
import { ConeChart } from "./ConeChart";
import { CommandBar } from "./CommandBar";
import { SnapPanel, type SnapItem } from "./SnapPanel";
import { FrugalBadge, Inspector } from "./Inspector";
import { AffordabilityCard, BehaviorCard, RecipesCard, Timeline } from "./Cards";
import { RetirementCard } from "./RetirementCard";
import { PlanCompare, type PinnedPlan } from "./PlanCompare";
import { InvestControls, WaitingStrip } from "./InvestControls";

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------- deterministic engine helpers (0 tokens) ----------------

const keyOf = (profileId: string, s: Scenario) => JSON.stringify([profileId, s]);

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
  habits: HabitCosts | null;
  waiting: WaitingCost[] | null;
}
interface Impact {
  label: string;
  before: number;
  after: number;
}
interface PendingImpact {
  label: string;
  beforeKey: string;
  afterKey: string;
  snapId?: string;
}

export default function DoppelApp() {
  const [profileId, setProfileId] = useState(PROFILES[0].id);
  const base = PROFILES.find((p) => p.id === profileId)!;

  const [scenario, setScenario] = useState<Scenario>(() => baseScenario(PROFILES[0]));
  const [pin, setPin] = useState<(PinnedPlan & { scenario: Scenario }) | null>(null);
  const [snaps, setSnaps] = useState<SnapItem[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [inspector, setInspector] = useState(false);
  const [cmdBusy, setCmdBusy] = useState(false);
  const [cmdMsg, setCmdMsg] = useState<string>();
  const [narrative, setNarrative] = useState<{ text: string; loading: boolean } | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [mounted, setMounted] = useState(false);

  // Profile-scoped request revision: async results that resolve after a profile switch are ignored.
  const [profileRev, setProfileRev] = useState(0);
  const profileRevRef = useRef(0);
  // Always-current copies for async callbacks (no stale closures).
  const scenarioRef = useRef(scenario);
  const pinRef = useRef(pin);
  const profileIdRef = useRef(profileId);

  // Results. The first render is computed synchronously (deterministic → identical on server and client);
  // later recomputations are debounced and split into chunks so the page stays responsive.
  const [main, setMain] = useState<MainResults>(() => {
    const p = PROFILES[0];
    const s = baseScenario(p);
    return { key: keyOf(p.id, s), ...runPair(p, s) };
  });
  const [planA, setPlanA] = useState<{ key: string; result: SimResult } | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [solver, setSolver] = useState<{ key: string; result: SolverResult } | null>(null);
  const mainRef = useRef(main);
  const probCache = useRef(new Map<string, number>([[main.key, main.real.successProb]]));
  const pendingImpacts = useRef<PendingImpact[]>([]);

  useEffect(() => setMounted(true), []);

  function commitScenario(next: Scenario) {
    scenarioRef.current = next;
    setScenario(next);
  }
  function commitPin(next: (PinnedPlan & { scenario: Scenario }) | null) {
    pinRef.current = next;
    setPin(next);
  }

  function switchProfile(id: string) {
    const p = PROFILES.find((x) => x.id === id)!;
    profileRevRef.current += 1;
    setProfileRev(profileRevRef.current);
    profileIdRef.current = id;
    setProfileId(id);
    commitScenario(baseScenario(p));
    commitPin(null);
    pendingImpacts.current = [];
    setImpact(null);
    setSnaps([]);
    setNarrative(null);
    setCmdMsg(undefined);
  }

  /**
   * Every change to the twin goes through here. Plan A is auto-pinned to the state right before the change
   * (unless the user pinned one), and the odds delta is shown once the new futures are simulated.
   */
  function mutate(fn: (s: Scenario) => Scenario, opts: { label: string; autoPin?: boolean; snapId?: string }) {
    const prev = scenarioRef.current;
    const next = fn(prev);
    const pid = profileIdRef.current;
    const beforeKey = keyOf(pid, prev);
    const afterKey = keyOf(pid, next);
    if (beforeKey === afterKey) {
      const p = probCache.current.get(beforeKey);
      if (p !== undefined) resolveImpact({ label: opts.label, beforeKey, afterKey, snapId: opts.snapId }, p, p);
      return;
    }
    if (opts.autoPin !== false && !pinRef.current?.manual) commitPin({ scenario: prev, label: `before “${opts.label}”`, manual: false });
    pendingImpacts.current.push({ label: opts.label, beforeKey, afterKey, snapId: opts.snapId });
    commitScenario(next);
    setNarrative(null);
  }

  function resolveImpact(pi: PendingImpact, before: number, after: number) {
    setImpact({ label: pi.label, before, after });
    if (pi.snapId) {
      const note = before === after ? ` · odds unchanged (${pct(after)})` : ` · odds ${pct(before)} → ${pct(after)}`;
      setSnaps((items) => items.map((it) => (it.id === pi.snapId ? { ...it, summary: it.summary + note } : it)));
    }
  }

  const effProfile = useMemo(() => effectiveProfile(base, scenario), [base, scenario]);
  const behavior = useMemo(() => analyzeBehavior(effProfile, scenario.extraTx), [effProfile, scenario.extraTx]);
  const inputsKey = useMemo(() => keyOf(profileId, scenario), [profileId, scenario]);
  const pinKey = useMemo(() => (pin ? keyOf(profileId, pin.scenario) : null), [profileId, pin]);

  // ---------------- debounced, chunked recomputation ----------------
  const jobRef = useRef(0);
  useEffect(() => {
    const job = ++jobRef.current;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const step = (fn: () => void, ms = 0) =>
      timers.push(
        setTimeout(() => {
          if (job === jobRef.current) fn();
        }, ms),
      );
    const prof = PROFILES.find((p) => p.id === profileIdRef.current)!;
    const s = scenarioRef.current;
    const pinned = pinRef.current;
    const key = keyOf(prof.id, s);
    const input = () => simInputFor(prof, s, analyzeBehavior(effectiveProfile(prof, s), s.extraTx).params);

    const afterMain = () => {
      // Resolve "28% → 11%" deltas whose before/after futures are both known.
      pendingImpacts.current = pendingImpacts.current.filter((pi) => {
        const b = probCache.current.get(pi.beforeKey);
        const a = probCache.current.get(pi.afterKey);
        if (a === undefined) return true;
        if (b !== undefined) resolveImpact(pi, b, a);
        return false;
      });
      step(() => {
        if (pinned && keyOf(prof.id, pinned.scenario) !== key) {
          const result = runReal(prof, pinned.scenario);
          probCache.current.set(keyOf(prof.id, pinned.scenario), result.successProb);
          setPlanA({ key: keyOf(prof.id, pinned.scenario), result });
        } else setPlanA(null);
      });
      step(() => setExtras({ key, habits: habitCosts(input()), waiting: costOfWaiting(input()) }));
      step(() => {
        const b = analyzeBehavior(effectiveProfile(prof, s), s.extraTx);
        setSolver({ key, result: solveGoal(simInputFor(prof, s, b.params), { spendTip: b.spendTip }) });
      });
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
  const recipes = solver?.result.recipes ?? [];
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
  function onSnap(name: string, r: SnapResult) {
    setLedger((l) => [...l, ledgerSnapEntry(name, r)]);
    if (renderRev !== profileRevRef.current) return; // snap started for another profile
    const cur = scenarioRef.current;
    const update = extractionToUpdate(r.extraction, cur.events, new Date(), {
      transactions: base.transactions,
      recurring: cur.recurring,
      marginalTaxRate: base.marginalTaxRate,
      income: { grossIncomeYear: base.grossIncomeYear, netIncomeMonth: base.netIncomeMonth },
    });
    const id = uid();
    setSnaps((s) => [...s, { id, name, result: r, summary: update.summary }]);
    const label = `Snap · ${name}`;
    switch (update.kind) {
      case "event":
        mutate((s) => applyScenarioOps(s, validateOps(update.ops, s.events), "snap"), { label, snapId: id });
        break;
      case "transaction":
        mutate((s) => ({ ...s, extraTx: [...s.extraTx, update.tx] }), { label, snapId: id, autoPin: false });
        break;
      case "recurring":
        mutate((s) => ({ ...s, recurring: [...s.recurring, update.expense], extraTx: [...s.extraTx, update.tx] }), { label, snapId: id });
        break;
      case "income":
        mutate(
          (s) => ({
            ...s,
            income: { grossIncomeYear: update.grossIncomeYear, netIncomeMonth: update.netIncomeMonth, label: `Payslip ${chf(update.payslipNet)} net` },
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
    setCmdBusy(true);
    setCmdMsg(undefined);
    const t0 = performance.now();
    const local = localParseCommand(text, scenarioRef.current.events);
    let ops: Op[] | null = local;
    let msg: string | undefined;

    if (local) {
      setLedger((l) => [
        ...l,
        ledgerCommandEntry({
          text,
          tier: "local-parser",
          usage: { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "regex intent parser (local)", mode: "local" },
          payload: { sentToCloud: null, ops: local },
          ms: performance.now() - t0,
          stateChars,
        }),
      ]);
      msg = "Parsed locally · 0 tokens";
    } else {
      const now = new Date().toISOString().slice(0, 7);
      const r = await callTwin<{ ops: unknown }>({ task: "command", text, now, events: compactEvents(scenarioRef.current.events) });
      if (r.ok && r.data) {
        setLedger((l) => [
          ...l,
          ledgerCommandEntry({
            text,
            tier: "llm",
            usage: { ...r.usage!, mode: "llm" },
            payload: { request: r.request, response: r.data },
            ms: performance.now() - t0,
            stateChars,
          }),
        ]);
        // Validate against the CURRENT events (the twin may have changed while the model was thinking).
        ops = validateOps(r.data.ops, scenarioRef.current.events);
        msg = ops.length ? `Parsed by ${r.usage?.model ?? "LLM"}` : "The model's answer contained no valid change.";
      } else {
        ops = null;
        msg = r.offline ? "I couldn't parse that offline. Add an OPENROUTER_API_KEY to handle free-form questions." : `LLM error: ${r.error}`;
      }
    }

    if (rev !== profileRevRef.current) {
      setCmdBusy(false);
      return; // profile switched while parsing — don't apply to the wrong twin
    }
    if (ops && ops.length) {
      const valid = ops;
      mutate((s) => applyScenarioOps(s, validateOps(valid, s.events), "command"), { label: text });
      msg = `${msg} · ${describeOps(valid)}`;
    }
    setCmdMsg(msg);
    setCmdBusy(false);
  }

  // ---------------- private banker narration ----------------
  async function narrate() {
    const rev = profileRevRef.current;
    setNarrative({ text: "", loading: true });
    const top = recipes[0];
    const ret = real.retirement;
    const facts = {
      client: `${effProfile.name}, ${effProfile.age}, ${effProfile.city}`,
      goal: `${effProfile.goal.label} (${GOAL_DEFINITION})`,
      odds_with_habits: pct(real.successProb),
      odds_disciplined: pct(ideal.successProb),
      habit_cost_chf: Math.round(Math.max(0, behaviorCost)),
      top_habit: behavior.insights[0]?.title,
      cash_crunch_risk: pct(real.crunchProb),
      home: affordability && house
        ? { price: house.price, passes: affordability.pass, cost_to_income: pct(affordability.costToIncome, 1), max_price_at_purchase: affordability.maxPrice, bought_in: pct(house.boughtProb) }
        : null,
      retirement: ret ? { age: ret.age, savings_last_to_90: pct(ret.lastsTo90Prob), pension_income_month: Math.round(ret.monthlyIncomeAtRetirement) } : null,
      best_move: top ? `${top.title} → ${pct(top.newProb)}` : null,
    };
    const t0 = performance.now();
    const r = await callTwin<string>({ task: "narrate", facts });
    let text: string;
    let usage: Usage;
    if (r.ok && typeof r.data === "string") {
      text = r.data;
      usage = { ...r.usage!, mode: "llm" };
    } else {
      text = templateNarrative(facts);
      usage = { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "template (offline)", mode: "offline" };
    }
    setLedger((l) => [...l, ledgerNarrateEntry({ usage, payload: r.request ?? { wouldSend: facts }, ms: performance.now() - t0, stateChars })]);
    if (rev !== profileRevRef.current) return;
    setNarrative({ text, loading: false });
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

  const set = (ops: Op[], label: string) => mutate((s) => applyScenarioOps(s, validateOps(ops, s.events)), { label });

  const probColor = real.successProb >= 0.8 ? "text-good" : real.successProb >= 0.5 ? "text-warn" : "text-bad";
  const hasOverrides =
    scenario.expenseDelta !== 0 || scenario.optimize || !!scenario.income || scenario.recurring.length > 0;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold text-white">D</span>
            <span className="font-serif text-2xl leading-none">Doppel</span>
          </div>
          <div className="ml-2 hidden rounded-full border border-line p-0.5 sm:flex">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                onClick={() => switchProfile(p.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${p.id === profileId ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <FrugalBadge entries={ledger} onClick={() => setInspector(true)} />
          </div>
        </div>
        <div className="flex gap-1 px-4 pb-2 sm:hidden">
          {PROFILES.map((p) => (
            <button
              key={p.id}
              onClick={() => switchProfile(p.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${p.id === profileId ? "bg-ink text-bg" : "border border-line text-ink-2"}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-24">
        {/* Hero */}
        <div className="mb-6">
          <div className="label">
            {effProfile.name}, {effProfile.age} · {effProfile.city} · {effProfile.tagline}
          </div>
          <h1 className="mt-1 font-serif text-4xl leading-tight sm:text-5xl">
            {effProfile.goal.label}:{" "}
            <span className={`num ${probColor} ${fresh ? "" : "opacity-60"}`}>{pct(real.successProb)}</span>
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            Disciplined you would be at <b className="num text-ink">{pct(ideal.successProb)}</b>. Net worth today{" "}
            <b className="num text-ink">{chf(netWorthToday)}</b> <span className="text-ink-3">(incl. pillar 2 &amp; 3a; the goal also counts home equity)</span>.
            Cash-crunch risk <b className="num text-ink">{pct(real.crunchProb)}</b>.{" "}
            {mounted && (
              <>
                {real.paths.toLocaleString("en")} futures to age 90 simulated in <span className="num">{Math.round(real.ms)}</span> ms, in your
                browser.
              </>
            )}
          </p>
          {impact && (
            <p className="mt-1 text-sm">
              <span className="text-ink-3">↳ {impact.label}: </span>
              <b className="num">
                {pct(impact.before)} → {pct(impact.after)}
              </b>{" "}
              <span className={`num text-xs ${impact.after > impact.before ? "text-good" : impact.after < impact.before ? "text-bad" : "text-ink-3"}`}>
                ({impact.after >= impact.before ? "+" : "−"}
                {Math.abs(Math.round((impact.after - impact.before) * 100))} pp)
              </span>
            </p>
          )}
          <div className="mt-4 flex flex-col gap-3">
            <InvestControls
              risk={effProfile.riskProfile}
              onRisk={(r: RiskProfile) => set([{ op: "set", key: "riskProfile", value: r }], `${r} portfolio`)}
              contributes3a={effProfile.contributes3a || scenario.optimize}
              on3a={(v) => set([{ op: "set", key: "contributes3a", value: v }], v ? "Max out 3a" : "Stop 3a")}
              monthlyInvest={scenario.monthlyInvest}
              onClearInvest={() => set([{ op: "set", key: "monthlyInvest", value: 0 }], "Stop standing order")}
              panicHistory={effProfile.history.soldInDrawdown}
              marginalTaxRate={effProfile.marginalTaxRate}
            />
            <div>
              <PlanCompare
                plan={pin}
                a={planAResult}
                b={real}
                goalAge={effProfile.goal.age}
                onPin={() => commitPin({ scenario: scenarioRef.current, label: "pinned plan", manual: true })}
                onUnpin={() => commitPin(null)}
              />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <CommandBar onSubmit={onCommand} busy={cmdBusy} message={cmdMsg} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* Left column */}
          <div className="space-y-5">
            <section className="card p-4 sm:p-5">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <div className="label">Net worth incl. pension &amp; home equity, today&apos;s CHF</div>
                <span className="text-[11px] text-ink-3">Monte Carlo · deterministic engine · 0 tokens</span>
              </div>
              <ConeChart
                real={real}
                ideal={ideal}
                goal={effProfile.goal}
                planA={planAResult && planAResult !== real ? planAResult : null}
                retirementAge={effProfile.retirementAge}
                eventAges={scenario.events.map((e) => ({ age: effProfile.age + Math.floor(e.month / 12), label: e.label }))}
              />
              <div className="mt-4 border-t border-line pt-4">
                <Timeline
                  events={scenario.events}
                  age={effProfile.age}
                  onShift={(id, m) => {
                    const e = scenario.events.find((x) => x.id === id);
                    set([{ op: "shift", id, months: m }], `${e?.label ?? "Event"} ${m > 0 ? "+" : "−"}${Math.abs(m)} months`);
                  }}
                  onRemove={(id) => {
                    const e = scenario.events.find((x) => x.id === id);
                    set([{ op: "remove", id }], `Remove ${e?.label ?? "event"}`);
                  }}
                />
              </div>
              {hasOverrides && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {scenario.expenseDelta !== 0 && (
                    <Pill onClear={() => mutate((s) => ({ ...s, expenseDelta: 0 }), { label: "Reset spending" })}>
                      Spending {scenario.expenseDelta > 0 ? "+" : "−"}
                      {chf(Math.abs(scenario.expenseDelta))}/mo
                    </Pill>
                  )}
                  {scenario.optimize && (
                    <Pill onClear={() => mutate((s) => ({ ...s, optimize: false }), { label: "Stop investing idle cash" })}>
                      Idle cash invested + 3a maxed
                    </Pill>
                  )}
                  {scenario.income && (
                    <Pill onClear={() => mutate((s) => ({ ...s, income: null }), { label: "Remove payslip" })}>
                      {scenario.income.label} → gross {chf(scenario.income.grossIncomeYear)}/yr, take-home {chf(scenario.income.netIncomeMonth)}/mo
                    </Pill>
                  )}
                  {scenario.recurring.map((r) => (
                    <Pill key={r.id} onClear={() => mutate((s) => ({ ...s, recurring: s.recurring.filter((x) => x.id !== r.id) }), { label: `Remove ${r.label}` })}>
                      {r.label} +{chf(r.monthly)}/mo
                    </Pill>
                  ))}
                </div>
              )}
            </section>

            <section className="card p-4 sm:p-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="label">Your private banker</div>
                <button
                  onClick={narrate}
                  disabled={narrative?.loading}
                  className="rounded-full border border-line px-3 py-1 text-xs font-medium transition hover:border-ink-3 disabled:opacity-50"
                >
                  {narrative ? "Refresh" : "Explain my situation"}
                </button>
              </div>
              {narrative?.loading && <p className="pulse-soft text-sm text-ink-3">Reading the numbers…</p>}
              {narrative && !narrative.loading && <p className="font-serif text-xl leading-snug">“{narrative.text}”</p>}
              {!narrative && (
                <p className="text-sm text-ink-3">
                  One short call with only the final numbers (~150 tokens). The model explains; it never calculates.
                </p>
              )}
            </section>

            <BehaviorCard
              behavior={behavior}
              costChf={behaviorCost}
              habitCosts={extras?.key === inputsKey ? extras.habits : null}
              crunchProb={real.crunchProb}
              goalAge={effProfile.goal.age}
            />
            <WaitingStrip items={extras ? extras.waiting : undefined} loading={extras?.key !== inputsKey} />
          </div>

          {/* Right column */}
          <div className="space-y-5">
            <SnapPanel key={profileId} onResult={onSnap} items={snaps} />
            {affordability && house && (
              <AffordabilityCard
                result={affordability}
                label={house.label}
                when={monthToLabel(house.month, effProfile.age).split(" · ")[0]}
                boughtProb={house.boughtProb}
              />
            )}
            <RetirementCard
              stats={real.retirement}
              retirementAge={effProfile.retirementAge}
              disabled={!fresh}
              onChangeAge={(age) => set([{ op: "set", key: "retirementAge", value: age }], `Retire at ${age}`)}
            />
            <RecipesCard recipes={recipes} loading={solving} baseProb={solver?.result.baseProb ?? real.successProb} onApply={applyRecipe} />
          </div>
        </div>
      </main>

      <Inspector entries={ledger} open={inspector} onClose={() => setInspector(false)} />
    </div>
  );
}

function Pill({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3">
      {children}
      <button onClick={onClear} className="rounded-full px-1.5 text-ink-3 hover:text-ink">
        ✕
      </button>
    </span>
  );
}

function templateNarrative(f: {
  goal: string;
  odds_with_habits: string;
  odds_disciplined: string;
  habit_cost_chf: number;
  top_habit?: string;
  home: { passes: boolean; max_price_at_purchase: number } | null;
  retirement: { age: number; savings_last_to_90: string } | null;
  best_move: string | null;
}) {
  const parts = [`Your goal (${f.goal}) currently has a ${f.odds_with_habits} chance; with steadier habits it would be ${f.odds_disciplined}.`];
  if (f.home && !f.home.passes)
    parts.push(`The home does not pass the bank's test yet — at the purchase date you could finance up to ${chf(f.home.max_price_at_purchase)}.`);
  else if (f.top_habit) parts.push(`The biggest drag is “${f.top_habit}”, worth about ${chf(f.habit_cost_chf)} by your goal date.`);
  if (f.retirement) parts.push(`Retiring at ${f.retirement.age}, your savings last to 90 in ${f.retirement.savings_last_to_90} of futures.`);
  if (f.best_move) parts.push(`Next step: ${f.best_move}.`);
  return parts.join(" ");
}

// =====================================================================================
// LEDGER (frugal accounting) — kept in one block so it can be swapped for the shared
// builders in src/lib/frugal/ledger.ts (entryFromSnap / entryFromCommand / entryFromNarrate).
// =====================================================================================

function ledgerSnapEntry(name: string, r: SnapResult): LedgerEntry {
  return {
    id: uid(),
    at: Date.now(),
    kind: "snap",
    title: `Snap · ${name}`,
    tier: r.tier,
    ms: r.steps.reduce((s, x) => s + x.ms, 0),
    usage: r.usage,
    naive: naiveSnap(Math.max(r.imageSize.width, 1600), Math.max(r.imageSize.height, 1200)),
    payload: r.payload,
    steps: r.steps,
    preview: r.preview,
  };
}

function ledgerCommandEntry(c: {
  text: string;
  tier: "local-parser" | "llm";
  usage: Usage;
  payload: unknown;
  ms: number;
  stateChars: number;
}): LedgerEntry {
  return {
    id: uid(),
    at: Date.now(),
    kind: "command",
    title: `What-if · “${c.text}”`,
    tier: c.tier,
    ms: c.ms,
    usage: c.usage,
    naive: naiveReasoning(c.stateChars),
    payload: c.payload,
  };
}

function ledgerNarrateEntry(c: { usage: Usage; payload: unknown; ms: number; stateChars: number }): LedgerEntry {
  return {
    id: uid(),
    at: Date.now(),
    kind: "narrate",
    title: "Private banker summary",
    tier: "llm",
    ms: c.ms,
    usage: c.usage,
    naive: naiveReasoning(c.stateChars, 450),
    payload: c.payload,
  };
}
