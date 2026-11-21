"use client";

import { useEffect, useMemo, useState } from "react";
import { PROFILES } from "@/lib/data/profiles";
import { simulate } from "@/lib/finance/monteCarlo";
import { analyzeBehavior } from "@/lib/finance/behavioralEngine";
import { solveGoal, type Recipe } from "@/lib/finance/goalSolver";
import { checkAffordability, projectedGross, projectedHardEquity } from "@/lib/finance/swissRules";
import type { LifeEvent, Transaction } from "@/lib/finance/types";
import { applyOps, compactEvents, extractionToUpdate, localParseCommand, type Op } from "@/lib/twin/actions";
import { callTwin } from "@/lib/llm";
import type { LedgerEntry } from "@/lib/frugal/ledger";
import { naiveReasoning, naiveSnap } from "@/lib/frugal/tokens";
import type { SnapResult } from "@/lib/snap/types";
import { chf, monthToLabel, pct } from "@/lib/format";
import { ConeChart } from "./ConeChart";
import { CommandBar } from "./CommandBar";
import { SnapPanel, type SnapItem } from "./SnapPanel";
import { FrugalBadge, Inspector } from "./Inspector";
import { AffordabilityCard, BehaviorCard, RecipesCard, Timeline } from "./Cards";

const uid = () => Math.random().toString(36).slice(2, 10);

export default function DoppelApp() {
  const [profileId, setProfileId] = useState(PROFILES[0].id);
  const base = PROFILES.find((p) => p.id === profileId)!;

  const [events, setEvents] = useState<LifeEvent[]>(base.events);
  const [extraTx, setExtraTx] = useState<Transaction[]>([]);
  const [netOverride, setNetOverride] = useState<number | null>(null);
  const [expenseDelta, setExpenseDelta] = useState(0);
  const [optimize, setOptimize] = useState(false);
  const [snaps, setSnaps] = useState<SnapItem[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [inspector, setInspector] = useState(false);
  const [cmdBusy, setCmdBusy] = useState(false);
  const [cmdMsg, setCmdMsg] = useState<string>();
  const [narrative, setNarrative] = useState<{ text: string; loading: boolean } | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [solving, setSolving] = useState(false);

  function switchProfile(id: string) {
    const p = PROFILES.find((x) => x.id === id)!;
    setProfileId(id);
    setEvents(p.events);
    setExtraTx([]);
    setNetOverride(null);
    setExpenseDelta(0);
    setOptimize(false);
    setSnaps([]);
    setNarrative(null);
  }

  const profile = useMemo(() => ({ ...base, netIncomeMonth: netOverride ?? base.netIncomeMonth }), [base, netOverride]);

  // ---------------- deterministic engine (0 tokens) ----------------
  const behavior = useMemo(() => analyzeBehavior(profile, extraTx), [profile, extraTx]);
  const ideal = useMemo(
    () => simulate({ profile, events, expenseDelta, optimizeIdleCash: optimize }),
    [profile, events, expenseDelta, optimize],
  );
  const real = useMemo(
    () => simulate({ profile, events, behavior: behavior.params, expenseDelta, optimizeIdleCash: optimize }),
    [profile, events, behavior, expenseDelta, optimize],
  );
  const house = events.find((e) => e.type === "house");
  const affordability = useMemo(
    () =>
      house
        ? checkAffordability({
            price: house.amount,
            grossIncomeYear: projectedGross(profile.grossIncomeYear, house.month),
            hardEquityAvailable: projectedHardEquity(profile, house.month),
            pillar2Available: profile.pillar2,
          })
        : null,
    [house, profile],
  );

  useEffect(() => {
    setSolving(true);
    const t = setTimeout(() => {
      setRecipes(solveGoal(profile, events, behavior.params, { expenseDelta, optimize }));
      setSolving(false);
    }, 120);
    return () => clearTimeout(t);
  }, [profile, events, behavior, expenseDelta, optimize]);

  const behaviorCost = ideal.medianAtGoal - real.medianAtGoal;
  const netWorthToday = profile.cash + profile.portfolio + profile.pillar2 + profile.pillar3a;

  const stateChars = useMemo(() => JSON.stringify({ profile, events }).length, [profile, events]);

  // ---------------- multimodal snap ----------------
  function onSnap(name: string, r: SnapResult) {
    const update = extractionToUpdate(r.extraction, events);
    if (update.kind === "event") setEvents((ev) => applyOps(ev, update.ops, "snap"));
    if (update.kind === "transaction") setExtraTx((tx) => [...tx, update.tx]);
    if (update.kind === "income") setNetOverride(update.netIncomeMonth);
    setSnaps((s) => [...s, { id: uid(), name, result: r, summary: update.summary }]);
    setLedger((l) => [
      ...l,
      {
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
      },
    ]);
    setNarrative(null);
  }

  // ---------------- what-if commands ----------------
  async function onCommand(text: string) {
    setCmdBusy(true);
    setCmdMsg(undefined);
    const t0 = performance.now();
    const local = localParseCommand(text, events);
    let ops: Op[] | null = local;
    let entry: Omit<LedgerEntry, "id" | "at" | "ms"> | null = null;

    if (local) {
      entry = {
        kind: "command",
        title: `What-if · “${text}”`,
        tier: "local-parser",
        usage: { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "regex intent parser (local)", mode: "local" },
        naive: naiveReasoning(stateChars),
        payload: { sentToCloud: null, ops: local },
      };
    } else {
      const now = new Date().toISOString().slice(0, 7);
      const r = await callTwin<{ ops: Op[] }>({ task: "command", text, now, events: compactEvents(events) });
      if (r.ok && r.data?.ops) {
        ops = r.data.ops.filter((o) => o && ["add", "shift", "remove"].includes(o.op));
        entry = {
          kind: "command",
          title: `What-if · “${text}”`,
          tier: "llm",
          usage: { ...r.usage!, mode: "llm" },
          naive: naiveReasoning(stateChars),
          payload: { request: r.request, response: r.data },
        };
      } else {
        setCmdMsg(r.offline ? "I couldn't parse that offline. Add an OPENROUTER_API_KEY to handle free-form questions." : `LLM error: ${r.error}`);
      }
    }

    if (ops && entry) {
      setEvents((ev) => applyOps(ev, ops!, "command"));
      setLedger((l) => [...l, { ...entry!, id: uid(), at: Date.now(), ms: performance.now() - t0 }]);
      setCmdMsg(`${entry.tier === "local-parser" ? "Parsed locally · 0 tokens" : `Parsed by ${entry.usage.model}`} · simulator re-ran 2×1000 futures in ${Math.round(real.ms + ideal.ms)} ms`);
      setNarrative(null);
    }
    setCmdBusy(false);
  }

  // ---------------- private banker narration ----------------
  async function narrate() {
    setNarrative({ text: "", loading: true });
    const top = recipes[0];
    const facts = {
      client: `${profile.name}, ${profile.age}, ${profile.city}`,
      goal: profile.goal.label,
      odds_with_habits: pct(real.successProb),
      odds_disciplined: pct(ideal.successProb),
      habit_cost_chf: Math.round(Math.max(0, behaviorCost)),
      top_habit: behavior.insights[0]?.title,
      home: affordability ? { price: house!.amount, passes: affordability.pass, cost_to_income: pct(affordability.costToIncome, 1), max_price: affordability.maxPrice } : null,
      best_move: top ? `${top.title} → ${pct(top.newProb)}` : null,
    };
    const t0 = performance.now();
    const r = await callTwin<string>({ task: "narrate", facts });
    let text: string;
    let usage: LedgerEntry["usage"];
    if (r.ok && typeof r.data === "string") {
      text = r.data;
      usage = { ...r.usage!, mode: "llm" };
    } else {
      text = templateNarrative(facts);
      usage = { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "template (offline)", mode: "offline" };
    }
    setNarrative({ text, loading: false });
    setLedger((l) => [
      ...l,
      {
        id: uid(),
        at: Date.now(),
        kind: "narrate",
        title: "Private banker summary",
        tier: "llm",
        ms: performance.now() - t0,
        usage,
        naive: naiveReasoning(stateChars, 450),
        payload: r.request ?? { wouldSend: facts },
      },
    ]);
  }

  function applyRecipe(r: Recipe) {
    if (r.apply.kind === "expenseDelta") setExpenseDelta(r.apply.value);
    if (r.apply.kind === "optimize") setOptimize(true);
    if (r.apply.kind === "delay") {
      const { eventId, months } = r.apply;
      setEvents((ev) => applyOps(ev, [{ op: "shift", id: eventId, months }], "solver"));
    }
    setNarrative(null);
  }

  const probColor = real.successProb >= 0.8 ? "text-good" : real.successProb >= 0.5 ? "text-warn" : "text-bad";

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
        <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="label">
              {profile.name}, {profile.age} · {profile.city} · {profile.tagline}
            </div>
            <h1 className="mt-1 font-serif text-4xl leading-tight sm:text-5xl">
              {profile.goal.label}:{" "}
              <span className={`num ${probColor}`}>{pct(real.successProb)}</span>
            </h1>
            <p className="mt-1 text-sm text-ink-2">
              Disciplined you would be at <b className="num text-ink">{pct(ideal.successProb)}</b>. Net worth today{" "}
              <b className="num text-ink">{chf(netWorthToday)}</b>. {real.paths.toLocaleString()} futures simulated in{" "}
              <span className="num">{Math.round(real.ms)}</span> ms, in your browser.
            </p>
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
                <div className="label">Net worth, today&apos;s CHF</div>
                <span className="text-[11px] text-ink-3">Monte Carlo · deterministic engine · 0 tokens</span>
              </div>
              <ConeChart
                real={real}
                ideal={ideal}
                goal={profile.goal}
                eventAges={events.map((e) => ({ age: profile.age + Math.floor(e.month / 12), label: e.label }))}
              />
              <div className="mt-4 border-t border-line pt-4">
                <Timeline
                  events={events}
                  age={profile.age}
                  onShift={(id, m) => setEvents((ev) => applyOps(ev, [{ op: "shift", id, months: m }]))}
                  onRemove={(id) => setEvents((ev) => applyOps(ev, [{ op: "remove", id }]))}
                />
              </div>
              {(expenseDelta !== 0 || optimize || netOverride) && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {expenseDelta !== 0 && <Pill onClear={() => setExpenseDelta(0)}>Spending {chf(expenseDelta)}/mo</Pill>}
                  {optimize && <Pill onClear={() => setOptimize(false)}>Idle cash invested + 3a maxed</Pill>}
                  {netOverride && <Pill onClear={() => setNetOverride(null)}>Net pay from payslip {chf(netOverride)}</Pill>}
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

            <BehaviorCard behavior={behavior} costChf={behaviorCost} />
          </div>

          {/* Right column */}
          <div className="space-y-5">
            <SnapPanel onResult={onSnap} items={snaps} />
            {affordability && house && (
              <AffordabilityCard result={affordability} label={house.label} when={monthToLabel(house.month, profile.age).split(" · ")[0]} />
            )}
            <RecipesCard recipes={recipes} loading={solving} baseProb={real.successProb} onApply={applyRecipe} />
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
  home: { passes: boolean; max_price: number } | null;
  best_move: string | null;
}) {
  const parts = [`Your goal (${f.goal}) currently has a ${f.odds_with_habits} chance; with steadier habits it would be ${f.odds_disciplined}.`];
  if (f.home && !f.home.passes) parts.push(`The home does not pass the bank's test yet — today you could finance up to ${chf(f.home.max_price)}.`);
  else if (f.top_habit) parts.push(`The biggest drag is “${f.top_habit}”, worth about ${chf(f.habit_cost_chf)} by your goal date.`);
  if (f.best_move) parts.push(`Next step: ${f.best_move}.`);
  return parts.join(" ");
}
