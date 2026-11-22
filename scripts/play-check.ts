/**
 * Doppel Play checks: `npm run play:check` (or `npx tsx scripts/play-check.ts`). Exits 1 on any failure.
 *
 *  1. same seed → same game (and the DGN record replays to the same game)
 *  2. the best move's loss is 0
 *  3. the sacrifice tag fires for a home purchase at goal depth, not at 1-year depth
 *  4. mate fires when a hard constraint breaks
 *  5. with a big budget, MCTS agrees with brute-force enumeration on a tiny tree
 *  6. E is never produced by the LLM (no model/network code in the game; E recomputes exactly)
 *  7. every card and every year keep the cash identity: opening + flows = closing, for every account
 *  8. the one-year stepper agrees with the Monte Carlo simulator on the expected year
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROFILES } from "../src/lib/data/profiles";
import { simulate, type SimInput } from "../src/lib/game/sim";
import { simulate as dashboardSimulate } from "../src/lib/finance/monteCarlo";
import type { LifeEvent, Profile } from "../src/lib/finance/types";
import { ALL_CARDS, DECISION_CARDS, LIFE_CARDS, applyCard, dealHand } from "../src/lib/game/cards";
import { analyse, bruteForce, reviewMove, treeTurns, turnLuck, type Analysis } from "../src/lib/game/engine";
import { WEIGHT_PRESETS, combine, evaluatePosition, labelFor, mateValue } from "../src/lib/game/evaluate";
import { advance, currentPosition, isOver, legalMoves, newGame, play, type Game, type GameSettings } from "../src/lib/game/game";
import { holdLine, rateGame } from "../src/lib/game/rating";
import { FI_THRESHOLD, fiProbability } from "../src/lib/game/independence";
import { replay, toRecord } from "../src/lib/game/notation";
import { BUCKET_Z, MEDIAN_BUCKET, REGIME, marketYear, simAssumptions, type Regime, uniform } from "../src/lib/game/regime";
import { BASELINE } from "../src/lib/finance/params";
import { accountOpening, ubsOpening, withFiGoal } from "../src/lib/game/start";
import { type GameState, initialState, ledgerError, netWorth, stepYear, targetAt, toSimInput, monthlyOutflow, pensionNet } from "../src/lib/game/state";
import { ALEXIA_ID, listUbsProfiles, loadUbsProfile } from "../src/lib/ubs";
import { EngineCancelled, EngineClient, type WorkerLike } from "../src/components/play/engineClient";
import { keyAction, type KeyInput } from "../src/components/play/keys";

let failures = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  · " + detail : ""}`);
  if (!ok) failures++;
}
const pts = (e: number) => (e * 100).toFixed(2);

const settings = (over: Partial<GameSettings> = {}): GameSettings => ({
  regime: "normal",
  depth: "goal",
  weights: WEIGHT_PRESETS.balanced,
  seed: 2026,
  preset: "balanced",
  ...over,
});

/** Plays a whole game choosing the engine's best move each turn. */
function engineGame(start: GameState, s: GameSettings, budget = { scenarios: 12, paths: 48 }): { game: Game; picks: string[] } {
  let g = newGame(start, s);
  const picks: string[] = [];
  while (currentPosition(g).status === "playing") {
    const a = analyse(currentPosition(g), s, { budget });
    picks.push(a.best);
    g = play(g, a.best);
  }
  return { game: g, picks };
}

/** The same person one year after retiring at 65 (pensions in payment). */
function pensionerFor(s: GameState): GameState {
  return stepYear({ ...s, age: 65, retirementAge: 65 }, marketYear(REGIME.normal, MEDIAN_BUCKET)).state;
}

function profileFor(over: Partial<Profile>): Profile {
  return { ...PROFILES[1], events: [], transactions: [], trades: [], ...over };
}

/** Mean net worth after one year over the five market buckets (the stepper's expected year), nominal CHF. */
const stepperYear = (s: GameState) => [0, 1, 2, 3, 4].reduce((sum, b) => sum + netWorth(stepYear(s, marketYear(REGIME.normal, b)).state) / 5, 0);
/** The game simulator's median net worth after one year, nominal CHF (its bands are deflated). */
const simulatorYear = (s: GameState) => simulate({ ...toSimInput(s, s.age + 1, REGIME.normal, 4000, 11), shocks: undefined }).bands[1].p50 * (1 + REGIME.normal.inflation);

/** A simulator result without its timing, as comparable text. */
const comparable = (r: ReturnType<typeof simulate>) => JSON.stringify({ ...r, ms: 0 });

/**
 * Checks added by the /play audit (2026-11-22): the game simulator against the dashboard engine, retirees,
 * openings from every kind of profile.
 */
async function auditChecks(alexia: GameState, S: GameSettings) {
  const ubs = listUbsProfiles();
  const firstOf = async (test: (p: Profile) => boolean, among = ubs) => {
    for (const s of among) {
      const p = await loadUbsProfile(s.id);
      if (test(p)) return p;
    }
    throw new Error("no such UBS profile");
  };
  const indebted = await firstOf((p) => !!p.liabilities?.length && p.retirementAge > p.age);
  const selfEmployed = await firstOf((p) => p.bvgInsured === false && p.origin?.employment === "self_employed");
  const retiredProfile = await firstOf((p) => p.retirementAge <= p.age);

  // ---------- A1. the game's simulator is the dashboard's engine (no extension → identical results) ----------
  {
    const alexiaProfile = await loadUbsProfile(ALEXIA_ID);
    const cases: [string, SimInput][] = [];
    for (const p of [...PROFILES, alexiaProfile, indebted, selfEmployed, retiredProfile]) {
      cases.push([`${p.name} to the goal`, { profile: p, events: p.events, paths: 300, seed: 5, horizon: "goal" }]);
      cases.push([`${p.name} to 90`, { profile: p, events: p.events, paths: 120, seed: 6, horizon: "full" }]);
    }
    const b = PROFILES[0];
    cases.push(["behaviour, standing order, spending cut", { profile: b, events: b.events, paths: 200, seed: 7, horizon: "goal", behavior: { leakageRate: 0.2, panicSellProb: 0.6, panicSellShare: 0.5, panicOutMonths: 9 }, monthlyInvest: 300, expenseDelta: -150 }]);
    cases.push(["optimised idle cash from month 12", { profile: b, events: b.events, paths: 200, seed: 8, horizon: "full", optimizeIdleCash: true, optimizeFromMonth: 12 }]);
    cases.push(["extra debt payment", { profile: indebted, events: [], paths: 200, seed: 9, horizon: "goal", extraDebtPayment: 200 }]);
    cases.push(["a home purchase with other loans", { profile: { ...indebted, cash: 400_000 }, events: [{ id: "h", type: "house", label: "Home", month: 18, amount: 700_000 }], paths: 200, seed: 10, horizon: "goal" }]);
    cases.push(["dashboard cash-flow phases", { profile: b, events: [], paths: 200, seed: 11, horizon: "goal", phases: [{ startMonth: 0, endMonth: 24, netIncomeMonth: 1800, expensesMonth: 2100, grossIncomeYear: 24_000, bvgInsured: false }, { startMonth: 24, endMonth: 60, netIncomeMonth: 5200, expensesMonth: 3100, grossIncomeYear: 78_000 }] }]);
    cases.push(["accounting mode with a trace", { profile: indebted, events: [], paths: 2, seed: 12, horizon: "goal", accounting: true, trace: true }]);
    // The engine's life decisions, economic scenarios and budget detail (merged 2026-11-22).
    const ev = (id: string, type: LifeEvent["type"], month: number, decision: LifeEvent["decision"], amount = 0): LifeEvent => ({ id, type, label: id, month, amount, decision });
    const family: LifeEvent[] = [
      ev("kid", "child", 14, { kind: "child", kitaDaysPerWeek: 2 }),
      ev("kid2", "child", 50, { kind: "child", tertiaryTrack: "university" }),
      ev("car", "expense", 6, { kind: "car", mode: "owned" }, 45_000),
      ev("partner", "income", 10, { kind: "partner", married: true, netIncomeMonth: 4200, expensesMonth: 1500, rentMonth: 2400 }),
    ];
    const career: LifeEvent[] = [
      ev("lease", "expense", 3, { kind: "car", mode: "leased", leaseMonthly: 450 }),
      ev("move", "expense", 20, { kind: "move", canton: "ZG", rentMonth: 2100, movingCost: 4000 }),
      ev("master", "expense", 30, { kind: "education", program: "master", workloadPct: 50, raiseAfterYear: 9000 }),
      ev("eighty", "raise", 70, { kind: "workload", percent: 80, durationMonths: 24 }),
      ev("self", "raise", 110, { kind: "selfEmployed", netIncomeMonth: 6000, incomeVolatility: 0.25, durationMonths: 60 }),
      { id: "bonus", type: "income", label: "Bonus", month: 9, amount: 8000 },
      { id: "fee", type: "expense", label: "Fee", month: 15, amount: 3000, nominal: true },
    ];
    cases.push(["life decisions: children, a car, a partner", { profile: b, events: family, paths: 150, seed: 13, horizon: "full" }]);
    cases.push(["life decisions: lease, move, master's, 80%, self-employed, one-offs", { profile: PROFILES[1], events: career, paths: 150, seed: 14, horizon: "full" }]);
    cases.push(["budget detail with decisions", { profile: b, events: family, paths: 60, seed: 15, horizon: "goal", detail: true }]);
    for (const economy of ["high_inflation", "recession", "low_rates", "climate_transition"] as const) cases.push([`economy ${economy}`, { profile: PROFILES[1], events: PROFILES[1].events, paths: 120, seed: 16, horizon: "full", economy }]);
    cases.push(["a custom economy with a home purchase", { profile: { ...indebted, cash: 400_000 }, events: [{ id: "h", type: "house", label: "Home", month: 30, amount: 700_000 }], paths: 120, seed: 17, horizon: "goal", economy: { id: "mine", label: { key: "economy.name.high_inflation" }, summary: { key: "economy.summary.baseline" }, phases: [{ years: 4, label: { key: "economy.phase.high" }, regime: { inflation: 0.03, wageGrowth: 0.02, mortgageRate: 0.04, jobLossRisk: 0.05 }, equityShock: -0.2, sources: [] }] } }]);
    cases.push(["a fractional age and an invalid path count", { profile: { ...b, age: b.age + 0.4 }, events: [], paths: 77.6, seed: 18, horizon: "goal" }]);
    const differing = cases.filter(([, input]) => comparable(simulate(input)) !== comparable(dashboardSimulate(input))).map(([name]) => name);
    check(
      "simulator parity: without game extensions the game's simulator returns exactly the dashboard engine's result",
      differing.length === 0,
      differing.length ? `DIFFERENT: ${differing.join("; ")} — mirror the change of src/lib/finance/monteCarlo.ts in src/lib/game/sim.ts` : `${cases.length} runs identical (built-ins, Alexia, loans, no pension fund, retired, behaviour, optimiser, home, phases, accounting, life decisions, economic scenarios, budget detail)`,
    );

    // The game's "normal" regime is the engine's baseline table: same numbers, and the same simulation result.
    const n = REGIME.normal;
    const table =
      n.equity.mu === BASELINE.equityMu.value && n.equity.sigma === BASELINE.equitySigma.value && n.bonds.mu === BASELINE.bondMu.value && n.bonds.sigma === BASELINE.bondSigma.value &&
      n.home.mu === BASELINE.homeMu.value && n.home.sigma === BASELINE.homeSigma.value && n.inflation === BASELINE.inflation.value && n.wageGrowth === BASELINE.wageGrowth.value;
    const plain: SimInput = { profile: b, events: b.events, paths: 200, seed: 21, horizon: "full" };
    const sameRun = comparable(simulate({ ...plain, assumptions: simAssumptions(n) })) === comparable(dashboardSimulate(plain));
    const stressDiffers = comparable(simulate({ ...plain, assumptions: simAssumptions(REGIME.stress) })) !== comparable(dashboardSimulate(plain));
    check("regime: \"normal\" reads the engine's baseline table and simulates exactly like the dashboard's baseline economy", table && sameRun && stressDiffers, `equity ${n.equity.mu}/${n.equity.sigma} · bonds ${n.bonds.mu}/${n.bonds.sigma} · home ${n.home.mu}/${n.home.sigma} · inflation ${n.inflation} · wages ${n.wageGrowth} · identical run: ${sameRun}`);
  }

  // ---------- A2. retirees: the stepper and the simulator agree; the three stepper conventions are the only gap ----------
  {
    const retirees: GameState[] = [];
    for (const s of ubs.filter((x) => x.employment === "retired").slice(0, 6)) retirees.push(await ubsOpening(s.id));
    retirees.push(pensionerFor({ ...accountOpening(PROFILES[1]), pillar2: 400_000, pillar3a: 80_000 }));
    let worstNw = 0;
    let worstSpend = 0;
    const rows: string[] = [];
    for (const r of retirees) {
      const a = stepperYear(r);
      const b = simulatorYear(r);
      worstNw = Math.max(worstNw, Math.abs(a - b) / Math.max(1, Math.abs(b)));
      // A double retirement cut (0.8 × non-housing spending) would show as 20% of a year's non-housing spending.
      worstSpend = Math.max(worstSpend, Math.abs(a - b) / Math.max(1, (r.expenses - r.rent) * 12));
      rows.push(`${r.name} ${Math.round(a).toLocaleString("en")} vs ${Math.round(b).toLocaleString("en")}`);
    }
    check("retirees: one-year stepper ≈ simulator median (within 1% of net worth and 5% of a year's non-housing spending)", worstNw < 0.01 && worstSpend < 0.05, rows.join(" · ") + ` · worst ${(worstNw * 100).toFixed(2)}% / ${(worstSpend * 100).toFixed(1)}%`);

    // The dashboard's rules on the same input count the annuity's capital: that is what saturated the evaluation.
    const r0 = retirees[0];
    const input = toSimInput(r0, r0.age + 1, REGIME.normal, 2000, 11);
    const withCapital = simulate({ ...input, shocks: undefined, conventions: undefined }).bands[1].p50;
    const without = simulate({ ...input, shocks: undefined }).bands[1].p50;
    check("retirees: an annuity is income, not capital, in the game's net worth", withCapital - without > 0.5 * input.profile.pillar2 && Math.abs(without - netWorth(r0)) / netWorth(r0) < 0.15, `${r0.name}: CHF ${Math.round(without).toLocaleString("en")} (game) vs ${Math.round(withCapital).toLocaleString("en")} with the dashboard's rule · position CHF ${Math.round(netWorth(r0)).toLocaleString("en")}`);

    // A retiree with a spending gap: odds that tell moves apart, and running out of savings is a cash crunch.
    const pensioner = retirees[retirees.length - 1];
    const short = { ...pensioner, cash: 20_000, portfolio: 120_000, expenses: pensionNet(pensioner) + 1500, expenseDelta: 0, check: null };
    const shortGoal = withFiGoal({ ...short, goal: { ...short.goal, startNetWorth: netWorth(short), startAge: short.age } });
    const e = evaluatePosition(shortGoal, shortGoal.age + 10, REGIME.normal, S.weights, { paths: 200, seed: 3 });
    const a = analyse(shortGoal, S, { candidates: ["downsize", "nicerFlat", "hold"], budget: { scenarios: 12, paths: 48 } });
    const odds = a.candidates.map((c) => `${c.card} P(goal) ${(c.parts.pGoal * 100).toFixed(0)}% P(crunch) ${(c.parts.pCrunch * 100).toFixed(0)}%`);
    const spread = Math.max(...a.candidates.map((c) => c.parts.pCrunch)) - Math.min(...a.candidates.map((c) => c.parts.pCrunch));
    check("retirees: savings that run out are a cash crunch, and the odds differ between moves", e.pCrunch > 0.5 && spread > 0.1, `hold for ten years: P(crunch) ${(e.pCrunch * 100).toFixed(0)}% · ${odds.join(" · ")}`);

    // A player who started working and retired: the target is the liquid capital still needed, not the old target
    // that included the pension fund (which is an annuity now).
    const started = accountOpening(PROFILES[1]);
    const retired = pensionerFor({ ...started, pillar2: 400_000, pillar3a: 80_000 });
    const liquid = started.goal.retired!.liquid;
    check(
      "retired after a working start: the target is the liquid capital still needed until 95",
      !!started.goal.retired && targetAt(started, 65) === started.goal.target && Math.abs(targetAt({ ...retired, age: 65 }, 65) - liquid) < 1 && targetAt({ ...retired, age: 80 }, 80) < liquid && targetAt({ ...retired, age: 80 }, 80) > 0,
      `target at 65 CHF ${started.goal.target.toLocaleString("en")} = liquid ${liquid.toLocaleString("en")} + pension fund · retired at 65: ${Math.round(targetAt({ ...retired, age: 65 }, 65)).toLocaleString("en")} · at 80: ${Math.round(targetAt({ ...retired, age: 80 }, 80)).toLocaleString("en")}`,
    );
  }

  // ---------- A3. openings keep the profile's loans and pension-fund status ----------
  {
    const viaUbs = await ubsOpening(indebted.id);
    const viaAccount = accountOpening(indebted);
    const same = (s: GameState) => s.debts.length === indebted.liabilities!.length && s.debts.every((d, i) => d.principal === indebted.liabilities![i].principal && d.rate === indebted.liabilities![i].annualRate && Math.abs(d.monthlyPayment - indebted.liabilities![i].monthlyPayment) < 1e-9);
    const l = indebted.liabilities![0];
    check("openings: a profile's loans keep their principal, rate and payment (UBS profile and account alike)", same(viaUbs) && same(viaAccount) && Math.abs(viaUbs.goal.startNetWorth - viaAccount.goal.startNetWorth) < 1e-6, `${indebted.id}: CHF ${Math.round(l.principal).toLocaleString("en")} at ${(l.annualRate * 100).toFixed(1)}%, CHF ${Math.round(l.monthlyPayment)}/month → game ${viaUbs.debts.map((d) => `${(d.rate * 100).toFixed(1)}% CHF ${Math.round(d.monthlyPayment)}/month`).join(", ")}`);

    const se = await ubsOpening(selfEmployed.id);
    const year = stepYear(se, marketYear(REGIME.normal, MEDIAN_BUCKET));
    const credits = year.ledger.flows.filter((f) => f.account === "pillar2" && f.kind === "credit").reduce((a, f) => a + f.amount, 0);
    const insured = stepYear({ ...se, bvgInsured: undefined }, marketYear(REGIME.normal, MEDIAN_BUCKET));
    const insuredCredits = insured.ledger.flows.filter((f) => f.account === "pillar2" && f.kind === "credit").reduce((a, f) => a + f.amount, 0);
    const rollout = simulate({ ...toSimInput(se, se.age + 1, REGIME.normal, 400, 3), shocks: undefined });
    check("openings: no pension fund (bvgInsured false) means no pillar 2 credits, in the year and in the rollouts", credits === 0 && insuredCredits > 0 && Math.abs(stepperYear(se) - rollout.bands[1].p50 * (1 + REGIME.normal.inflation)) / Math.max(1, stepperYear(se)) < 0.03, `${selfEmployed.id}: CHF ${Math.round(credits)} credits (insured it would be CHF ${Math.round(insuredCredits).toLocaleString("en")})`);

    // A hand-made account: only the required Profile fields (no origin, loans, goals list, premium, as-of date).
    const bare: Profile = {
      id: "user-bare", name: "Bare", age: 41, city: "Bern", canton: "BE", tagline: { key: "profile.user.tagline" }, grossIncomeYear: 84_000, netIncomeMonth: 5600,
      expensesMonth: 4300, rentMonth: 1700, cash: 18_000, portfolio: 9000, pillar2: 95_000, pillar3a: 12_000, contributes3a: true, investShare: 0.3, marginalTaxRate: 0.22,
      riskProfile: "balanced", retirementAge: 65, goal: { label: { key: "profile.user.tagline" }, target: 0, age: 30 }, events: [], transactions: [], trades: [], history: { soldInDrawdown: false, drawdownSellPct: 0 },
    };
    const variants: [string, Profile][] = [
      ["working", bare],
      ["retired", { ...bare, id: "user-retired", age: 72, retirementAge: 65, pillar2: 300_000 }],
      ["older than the end age", { ...bare, id: "user-97", age: 97, retirementAge: 65 }],
      ["in debt", { ...bare, id: "user-debt", cash: 500, portfolio: 0, liabilities: [{ id: "L1", kind: "personal_loan", label: { key: "profile.user.tagline" }, principal: 40_000, annualRate: 0.079, monthlyPayment: 0 }] }],
    ];
    const played: string[] = [];
    let ok = true;
    for (const [name, p] of variants) {
      let g = newGame(accountOpening(p), S);
      let n = 0;
      while (!isOver(g) && n < 60) {
        const legal = legalMoves(g);
        ok &&= legal.length > 0;
        if (!legal.length) break;
        g = play(g, legal[n % legal.length]);
        n++;
      }
      const last = currentPosition(g);
      ok &&= isOver(g) && Object.values(last).every((v) => typeof v !== "number" || Number.isFinite(v));
      if (n > 0 && !isOver(g)) ok = false;
      const a = analyse(g.positions[0], S, { budget: { scenarios: 6, paths: 32 } });
      ok &&= a.candidates.every((c) => Number.isFinite(c.e));
      played.push(`${name}: ${n} moves, ${last.status}`);
    }
    const debtOpen = accountOpening(variants[3][1]);
    ok &&= debtOpen.debts.length === 1 && debtOpen.debts[0].monthlyPayment > 0;
    check("openings: hand-made accounts with the optional Profile fields missing play to the end", ok, played.join(" · ") + ` · a loan without a payment gets the 60-month annuity CHF ${Math.round(debtOpen.debts[0]?.monthlyPayment ?? 0)}/month`);
  }

  // ---------- A4. a life decision is never the best move ----------
  {
    // Moving in with a partner halves the rent: the simulated numbers improve, and it is still not "the best move".
    let found = "";
    let ok = false;
    for (const p of PROFILES) {
      const pos = { ...accountOpening(p), check: null };
      if (!dealable(pos, "movePartner")) continue;
      const a = analyse(pos, S, { candidates: ["movePartner", "subscriptions", "hold"], budget: { scenarios: 16, paths: 16 } });
      const life = a.candidates.find((c) => c.card === "movePartner")!;
      const r = reviewMove(a, "movePartner");
      if (life.e <= a.candidates[0].e) continue;
      ok = a.best !== "movePartner" && r.label === "lifeChoice" && r.accuracy === null && r.loss === 0 && a.candidates[a.candidates.length - 1].card === "movePartner";
      found = `${p.name}: movePartner E ${pts(life.e)} > engine's best ${a.best} E ${pts(a.candidates[0].e)} → label ${r.label}, accuracy ${r.accuracy}`;
      break;
    }
    check("a life decision that scores higher than every other move is ♡, never best or brilliant, and has no accuracy", ok, found || "no position where the life decision scores highest");
  }

  // ---------- A5. labels: noise-aware, and stable across the sampled futures ----------
  {
    const unit =
      labelFor(2.5, false, false) === "mistake" && labelFor(2.5, false, false, 0.5) === "inaccuracy" && labelFor(0.6, false, false, 0.2) === "good" &&
      labelFor(0.03, false, false, 5) === "best" && labelFor(9, false, false, 0.4) === "blunder" && labelFor(0, true, false) === "brilliant";
    check("labels: a harsher label needs the loss to clear its threshold by two standard errors", unit, `2.5 ± 0 → ${labelFor(2.5, false, false)} · 2.5 ± 0.5 → ${labelFor(2.5, false, false, 0.5)} · 0.6 ± 0.2 → ${labelFor(0.6, false, false, 0.2)}`);

    let g = newGame(accountOpening(PROFILES[0]), S);
    for (let k = 0; k < 3; k++) g = advance(g, "hold");
    const pos = currentPosition(g);
    const cands = legalMoves(g);
    const labels = new Map<string, Set<string>>();
    const losses = new Map<string, number[]>();
    const ses = new Map<string, number[]>();
    const bests = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const a = analyse(pos, S, { sampleSeed: seed });
      bests.add(a.best);
      for (const c of cands) {
        const r = reviewMove(a, c);
        labels.set(c, (labels.get(c) ?? new Set()).add(r.label));
        losses.set(c, [...(losses.get(c) ?? []), r.loss]);
        ses.set(c, [...(ses.get(c) ?? []), r.lossSe]);
      }
    }
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    const worstSpread = Math.max(...cands.map((c) => spread(losses.get(c)!)));
    const stable = bests.size === 1 && cands.every((c) => labels.get(c)!.size === 1);
    const seReported = cands.every((c) => c === [...bests][0] || ses.get(c)!.every((x) => x > 0));
    check(
      "labels: the same position gets the same best move and the same labels on 8 different sets of futures",
      stable && seReported && worstSpread < 0.6,
      `${pos.name}, year ${pos.turn + 1}: ` + cands.map((c) => `${c} ${[...labels.get(c)!].join("/")} (loss ${Math.min(...losses.get(c)!).toFixed(2)}–${Math.max(...losses.get(c)!).toFixed(2)}, ± ${Math.max(...ses.get(c)!).toFixed(2)})`).join(" · "),
    );
  }

  // ---------- A6. the tree plays the game's turns; mated futures do not distort the money shown ----------
  {
    let g = newGame(accountOpening(PROFILES[0]), S);
    while (!isOver(g) && currentPosition(g).turn < 9) g = advance(g, "hold");
    const year10 = currentPosition(g);
    g = advance(g, "hold");
    const long = currentPosition(g);
    const schedule = JSON.stringify(treeTurns(year10, year10.age + 12, 2)) === "[1,5]" && JSON.stringify(treeTurns(long, long.age + 12, 2)) === "[5,5]" && treeTurns(long, long.age + 5, 2).length === 0 && JSON.stringify(treeTurns(accountOpening(PROFILES[0]), 99, 2)) === "[1,1]";
    const a5 = analyse({ ...long, check: null }, settings({ depth: "5y" }), { budget: { scenarios: 8, paths: 8 } });
    const noMoveInside = a5.plies === 0 && a5.candidates.every((c) => c.pv.length === 1);
    check("the tree plays the game's turns: inside a five-year turn the engine gives the player no extra moves", schedule && noMoveInside && long.status === "playing", `year 10: ${JSON.stringify(treeTurns(year10, year10.age + 12, 2))} · year 11: ${JSON.stringify(treeTurns(long, long.age + 12, 2))} · depth 5 years in a five-year turn: ${a5.plies} plies, lines of ${a5.candidates.map((c) => c.pv.length).join(",")} move(s)`);

    const a = analyse(currentPosition(newGame(alexia, S)), S, { budget: { scenarios: 80, paths: 8 } });
    const risky = [...a.candidates, a.hold].find((c) => c.mateShare > 0 && c.mateShare < 1);
    check("a candidate that is mated in some futures shows the target and median of the futures it survives", !!risky && Math.abs(risky.parts.target - a.hold.parts.target) < 1e-6 && risky.parts.median > 0, risky ? `${risky.card}: mate in ${(risky.mateShare * 100).toFixed(0)}% of futures · target CHF ${Math.round(risky.parts.target).toLocaleString("en")} (hold: ${Math.round(a.hold.parts.target).toLocaleString("en")})` : "no candidate with a partial mate share");
  }

  // ---------- A7. luck averages zero ----------
  {
    const rows: string[] = [];
    let ok = true;
    const lucks: Record<"goal" | "1y", number[]> = { goal: [], "1y": [] };
    for (let seed = 1; seed <= 60; seed++) {
      // The realised turn does not depend on the depth: one game, judged at both horizons.
      const g0 = newGame(accountOpening(PROFILES[seed % 2]), settings({ seed }));
      const g1 = advance(g0, "hold");
      for (const depth of ["goal", "1y"] as const) {
        lucks[depth].push(turnLuck(g0.positions[0], "hold", currentPosition(g1), g1.moves[0].crunch, settings({ seed, depth }), { budget: { scenarios: 32, paths: 8 } }).luck * 100);
      }
    }
    for (const depth of ["goal", "1y"] as const) {
      const v = lucks[depth];
      const mean = v.reduce((x, y) => x + y, 0) / v.length;
      const sd = Math.sqrt(v.reduce((x, y) => x + (y - mean) * (y - mean), 0) / (v.length - 1));
      const positive = v.filter((x) => x > 0).length / v.length;
      ok &&= Math.abs(mean) < 0.3 * sd && positive > 0.2 && positive < 0.8 && sd > 0.05;
      rows.push(`depth ${depth}: mean ${mean.toFixed(2)} pts, spread (sd) ${sd.toFixed(2)} pts, ${(positive * 100).toFixed(0)}% of turns lucky`);
    }
    const s1 = settings({ seed: 3 });
    const g0 = newGame(accountOpening(PROFILES[0]), s1);
    const g1 = advance(g0, "hold");
    const twice = [0, 1].map(() => turnLuck(g0.positions[0], "hold", currentPosition(g1), g1.moves[0].crunch, s1, { budget: { scenarios: 16, paths: 8 } }).luck);
    check("luck (realised turn − expected turn at the same horizon) averages zero over 60 games and is deterministic", ok && twice[0] === twice[1], rows.join(" · "));
  }

  // ---------- A8. the record replays on its own ----------
  {
    const start = { ...accountOpening(PROFILES[0]), prefs: ["children", "home"] };
    let g = newGame(start, S);
    const reviews: (ReturnType<typeof reviewMove> | null)[] = [];
    while (!isOver(g) && g.moves.length < 14) {
      const legal = legalMoves(g);
      const card = legal.includes("haveChild") ? "haveChild" : legal[g.moves.length % legal.length];
      reviews.push(g.moves.length < 2 ? reviewMove(analyse(currentPosition(g), settings({ depth: "5y" }), { budget: { scenarios: 6, paths: 8 } }), card) : null);
      g = play(g, card);
    }
    const record = toRecord(g, { reviews, reviewedWith: { depth: "5y", weights: S.weights, preset: "balanced" } });
    const text = JSON.stringify(record);
    const again = replay(JSON.parse(text));
    const years = g.moves.reduce((n, m) => n + m.years, 0);
    const inside = g.lifeEvents.reduce((n, l) => n + (l.earlier?.length ?? 0), 0);
    const complete =
      record.prefs.join() === "children,home" && record.markets.length === years && record.moves.some((m) => m.years === 5) &&
      record.lifeEvents.reduce((n, l) => n + (l.earlier?.length ?? 0), 0) === inside && inside > 0 &&
      record.reviewedWith?.depth === "5y" && record.moves[0].review?.label === reviews[0]!.label && typeof record.moves[0].review?.lossSe === "number" && record.moves[5].review === null &&
      record.moves.some((m) => m.card === "haveChild");
    let plainFails = false;
    try {
      replay({ ...JSON.parse(text), prefs: [] }, accountOpening(PROFILES[0]));
    } catch {
      plainFails = true;
    }
    check("game record: a game with declared preferences replays from the record alone to the identical final state", JSON.stringify(again) === JSON.stringify(g) && complete && plainFails, `${g.moves.length} moves over ${years} years · ${record.markets.length} market years · ${inside} Life cards inside five-year turns · prefs ${record.prefs.join("+")} · ${text.length} bytes · without the preferences the replay fails: ${plainFails}`);
  }

  // ---------- A9. an opening that is already independent ----------
  {
    const rich = { ...accountOpening(PROFILES[1]), age: 55, cash: 400_000, portfolio: 3_000_000 };
    const g = newGame(rich, S);
    const first = currentPosition(g);
    const rating = rateGame(g);
    const retiredRich = pensionerFor({ ...accountOpening(PROFILES[1]), pillar2: 400_000, portfolio: 3_000_000 });
    const gr = newGame(retiredRich, S);
    check("an opening that is already financially independent is won before the first move (retirees play on)", first.status === "won" && first.goalReached && g.moves.length === 0 && legalMoves(g).length === 0 && rating.player.kind === "independent" && replay(JSON.parse(JSON.stringify(toRecord(g)))).positions.length === 1 && currentPosition(gr).status === "playing", `status ${first.status} with ${g.moves.length} moves · Elo ${rating.elo} · retiree: ${currentPosition(gr).status}`);
  }

  // ---------- A10. keyboard: Tab is free, a held key plays once, nothing fires from a control ----------
  {
    const k = (key: string, over: Partial<KeyInput> = {}) => keyAction({ key, targetTag: "BODY", ...over })?.kind ?? null;
    const cases: [string, unknown, unknown][] = [
      ["Tab", k("Tab"), null],
      ["Tab on a button", k("Tab", { targetTag: "BUTTON" }), null],
      ["H", k("h"), "hold"],
      ["H held down (auto-repeat)", k("h", { repeat: true }), null],
      ["2", keyAction({ key: "2", targetTag: "BODY" })?.kind === "card" && (keyAction({ key: "2", targetTag: "BODY" }) as { index: number }).index, 1],
      ["2 held down", k("2", { repeat: true }), null],
      ["3 typed into the seed field", k("3", { targetTag: "INPUT" }), null],
      ["h typed into the search field", k("h", { targetTag: "INPUT" }), null],
      ["1 on a select", k("1", { targetTag: "SELECT" }), null],
      ["1 with a button focused", k("1", { targetTag: "BUTTON" }), null],
      ["H with a link focused", k("H", { targetTag: "A" }), null],
      ["C", k("c"), "compare"],
      ["C with a disclosure focused", k("C", { targetTag: "SUMMARY" }), null],
      ["C held down", k("c", { repeat: true }), null],
      ["← held down", k("ArrowLeft", { repeat: true }), "prev"],
      ["→ on a button", k("ArrowRight", { targetTag: "BUTTON" }), "next"],
      ["← in a field", k("ArrowLeft", { targetTag: "TEXTAREA" }), null],
      ["Ctrl+H", k("h", { ctrlKey: true }), null],
      ["5", k("5"), null],
    ];
    const wrong = cases.filter(([, got, want]) => got !== want).map(([name, got]) => `${name} → ${String(got)}`);
    check("keys: Tab is left to the browser, a held key plays once, fields and focused controls are not hijacked", wrong.length === 0, wrong.length ? "WRONG: " + wrong.join("; ") : `${cases.length} cases · compare lines is C`);
  }

  // ---------- A11. a new game cancels the engine's running work ----------
  {
    const made: { posted: number[]; terminated: boolean; w: WorkerLike }[] = [];
    const client = new EngineClient(() => {
      const rec = { posted: [] as number[], terminated: false, w: null as unknown as WorkerLike };
      rec.w = { onmessage: null, postMessage: (m) => void rec.posted.push(m.id), terminate: () => void (rec.terminated = true) };
      made.push(rec);
      return rec.w;
    });
    const request = { kind: "analyse" as const, state: alexia, settings: S };
    const answer = (id: number) => ({ data: { id, result: { kind: "analyse" as const, analysis: { best: "from-worker-" + id } as unknown as Analysis, ms: 1 } } });
    const outcome = (pr: Promise<unknown>) => pr.then((r) => (r as { analysis: { best: string } }).analysis.best, (e: unknown) => (e instanceof EngineCancelled ? "cancelled" : "error"));
    const old1 = outcome(client.run(request));
    const old2 = outcome(client.run(request));
    client.reset(); // the new game
    const fresh = outcome(client.run(request));
    made[0].w.onmessage?.(answer(made[0].posted[0])); // a late answer of the terminated worker
    made[1].w.onmessage?.(answer(made[1].posted[0]));
    const got = await Promise.all([old1, old2, fresh]);
    const workerOk = made.length === 2 && made[0].terminated && !made[1].terminated && made[0].posted.length === 2 && made[1].posted.length === 1 && got[0] === "cancelled" && got[1] === "cancelled" && got[2] === "from-worker-" + made[1].posted[0] && client.waiting === 0;

    // Without worker support the request waits a frame on the main thread; a reset before that drops it unrun.
    const deferred: (() => void)[] = [];
    const inline = new EngineClient(() => null, (run) => void deferred.push(run));
    const dropped = outcome(inline.run(request));
    inline.reset();
    const t0 = performance.now();
    deferred.forEach((run) => run());
    const idle = performance.now() - t0;
    check("engine client: a new game terminates the worker, cancels what was waiting and ignores late answers", workerOk && (await dropped) === "cancelled" && idle < 50, `old requests: ${got[0]}, ${got[1]} · new request: ${got[2]} · workers started ${made.length}, first terminated ${made[0]?.terminated} · no-worker fallback dropped unrun (${idle.toFixed(1)} ms)`);
  }
  void alexia;
}

/** Can `card` be played in this position at all? */
const dealable = (s: GameState, card: string) => DECISION_CARDS.some((c) => c.id === card && c.eligible(s));

async function main() {
  const alexia = await ubsOpening(ALEXIA_ID);
  const S = settings();
  if (process.env.PLAY_CHECK === "audit") {
    await auditChecks(alexia, S);
    return report();
  }

  // ---------- worked example: Alexia's first move ----------
  {
    const t0 = performance.now();
    const a = analyse(currentPosition(newGame(alexia, S)), S);
    const ms = performance.now() - t0;
    console.log(`Alexia, turn 1 (age ${alexia.age}), depth goal → horizon age ${a.horizonAge}, plies ${a.plies}, ${a.stats.leafEvals} leaf rollouts (${a.stats.cacheHits} cached), ${ms.toFixed(0)} ms`);
    for (const c of a.candidates) {
      const r = reviewMove(a, c.card);
      console.log(`  ${c.card.padEnd(15)} E ${pts(c.e).padStart(6)}  E1y ${pts(c.e1).padStart(6)}  P(goal) ${(c.parts.pGoal * 100).toFixed(0).padStart(3)}%  P(crunch) ${(c.parts.pCrunch * 100).toFixed(0).padStart(3)}%  median CHF ${Math.round(c.parts.median).toLocaleString("en").padStart(8)}  mate ${(c.mateShare * 100).toFixed(0).padStart(3)}%  loss ${r.loss.toFixed(2).padStart(6)} ${r.label.padEnd(10)} pv ${c.pv.join(" → ")}`);
    }
    console.log(`  hold reference E ${pts(a.hold.e)}`);
  }

  // ---------- 1. same seed → same game; the record replays ----------
  {
    const one = engineGame(alexia, S);
    const two = engineGame(alexia, S);
    const same = JSON.stringify(one.game) === JSON.stringify(two.game);
    check("same seed → same game", same, `${one.picks.length} moves, result ${currentPosition(one.game).status}: ${one.picks.join(", ")}`);
    const record = toRecord(one.game);
    const replayed = replay(JSON.parse(JSON.stringify(record)), alexia);
    check("game record (DGN) replays to the same game", JSON.stringify(replayed) === JSON.stringify(one.game), `${JSON.stringify(record).length} bytes`);
    const other = engineGame(alexia, settings({ seed: 7 }));
    check("a different seed gives a different game", JSON.stringify(other.game.lifeEvents) !== JSON.stringify(one.game.lifeEvents) || JSON.stringify(other.game.moves.map((m) => m.market)) !== JSON.stringify(one.game.moves.map((m) => m.market)));
  }

  // ---------- 2. best move loss = 0 ----------
  {
    const positions: GameState[] = [alexia];
    let g = newGame(alexia, S);
    g = play(g, "pathWork");
    positions.push(currentPosition(g));
    for (const p of PROFILES) positions.push(accountOpening(p));
    let ok = true;
    const seen: string[] = [];
    for (const pos of positions) {
      const a = analyse(pos, S, { budget: { scenarios: 12, paths: 48 } });
      const r = reviewMove(a, a.best);
      ok &&= r.loss === 0 && (r.label === "best" || r.label === "brilliant");
      for (const c of a.candidates) ok &&= reviewMove(a, c.card).loss >= 0;
      seen.push(`${pos.name}: ${a.best} ${r.label}`);
    }
    check("the best move's loss is 0 (and no move has a negative loss)", ok, seen.join("; "));
  }

  // ---------- 3. sacrifice: a home purchase at goal depth, not at 1-year depth ----------
  {
    const buyer = initialState(
      profileFor({ id: "buyer", name: "Test buyer", age: 32, canton: "ZH", city: "Zürich", grossIncomeYear: 150_000, netIncomeMonth: 9000, expensesMonth: 6200, rentMonth: 3200, cash: 260_000, portfolio: 0, pillar2: 90_000, pillar3a: 30_000, investShare: 0, riskProfile: "conservative", marginalTaxRate: 0.3, goal: { label: { key: "profile.goalK", params: { target: 1_100_000, age: 52 } }, target: 1_100_000, age: 52 } }),
      { lengthTurns: 20, ubs: { alexiaPaths: null, s001: null } },
    );
    buyer.check = null;
    const cands = ["buyHome", "hold"];
    const goal = analyse(buyer, S, { candidates: cands });
    const short = analyse(buyer, settings({ depth: "1y" }), { candidates: cands });
    const g = goal.candidates.find((c) => c.card === "buyHome")!;
    const s = short.candidates.find((c) => c.card === "buyHome")!;
    const price = g.params.find((p) => p.key === "price")?.value ?? 0;
    check("sacrifice tag: home purchase at goal depth", g.sacrifice, `price CHF ${price.toLocaleString("en")}: E1y ${pts(g.e1)} vs hold ${pts(goal.hold.e1)}, E(goal age) ${pts(g.e)} vs hold ${pts(goal.hold.e)}`);
    check("no sacrifice tag at 1-year depth", !s.sacrifice, `E1y ${pts(s.e)} vs hold ${pts(short.hold.e)}`);
    check("the verdict flips with depth (best at goal depth, not at 1 year)", goal.best === "buyHome" && short.best === "hold", `goal: ${goal.best} · 1y: ${short.best}`);
  }

  // ---------- 4. mate when a hard constraint breaks ----------
  {
    const broke = initialState(
      profileFor({ id: "broke", name: "Test broke", age: 30, grossIncomeYear: 36_000, netIncomeMonth: 2400, expensesMonth: 7200, rentMonth: 1800, cash: 3000, portfolio: 0, pillar2: 0, pillar3a: 0 }),
      { lengthTurns: 10, ubs: { alexiaPaths: null, s001: null } },
    );
    const yr = stepYear(broke, marketYear(REGIME.normal, MEDIAN_BUCKET));
    check("mate: the year breaks the credit line and the arrears cap", yr.mate, `min cash CHF ${Math.round(yr.minCash).toLocaleString("en")}`);
    // A smaller shortfall becomes arrears (a loan) and leaves the player in check, not mate.
    const tight = { ...broke, expenses: 3900, rent: 1800 };
    const yt = stepYear(tight, marketYear(REGIME.normal, MEDIAN_BUCKET));
    const arrears = yt.state.debts.find((d) => d.id === "debt-arrears");
    check("arrears: a shortfall under the cap becomes a 10% loan, not mate", !yt.mate && !!arrears && arrears.principal > 0 && ledgerError(yt.ledger) < 1e-6, `arrears CHF ${Math.round(arrears?.principal ?? 0).toLocaleString("en")} · ledger error ${ledgerError(yt.ledger).toExponential(1)}`);
    let g = newGame(broke, S);
    const legal = currentPosition(g).check ? "in check" : "not in check";
    const move = analyse(currentPosition(g), S, { budget: { scenarios: 8, paths: 32 } });
    g = play(g, move.best);
    check("mate ends the game", currentPosition(g).status === "mate", `${legal}, played ${move.best}, status ${currentPosition(g).status}`);
    const sure = analyse(broke, S, { candidates: ["hold"], budget: { scenarios: 8, paths: 32 } });
    check("a line that is mated in every future scores the mate value", Math.abs(sure.hold.e - mateValue(S.weights).e) < 1e-12 && sure.hold.mateShare === 1, `E ${pts(sure.hold.e)}`);
  }

  // ---------- 5. MCTS = brute force on a tiny tree ----------
  {
    // Two Life cards that matter (a job gap, a market drawdown) on a position with little room.
    const tiny: Regime = { ...REGIME.stress, eventProb: 0.4, lifeWeights: { lifeJobloss: 1, lifeDrawdown: 1 } };
    const pos = { ...accountOpening(PROFILES[2]), cash: 9000, portfolio: 12_000, check: null };
    const cands = ["investIdle", "cutSpending", "hold"];
    const opts = { regime: tiny, candidates: cands, fixedLeafSeed: true, budget: { plies: 1, paths: 32, scenarios: 1500 } };
    const t0 = performance.now();
    const exact = bruteForce(pos, S, opts);
    const t1 = performance.now();
    const mcts = analyse(pos, S, opts);
    const t2 = performance.now();
    const bfBest = [...exact.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const worst = Math.max(...mcts.candidates.map((c) => Math.abs(c.e - exact.get(c.card)!)));
    check("MCTS agrees with brute force on the best move", mcts.best === bfBest, `${mcts.best} vs ${bfBest}`);
    check("MCTS values match the exact expectimax values", worst < 0.005, `max |ΔE| ${(worst * 100).toFixed(3)} pts · ${mcts.candidates.map((c) => `${c.card} ${pts(c.e)}/${pts(exact.get(c.card)!)}`).join(", ")} · brute force ${(t1 - t0).toFixed(0)} ms, MCTS ${(t2 - t1).toFixed(0)} ms`);
  }

  // ---------- 6. E is never produced by the LLM ----------
  {
    const dir = join(process.cwd(), "src", "lib", "game");
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), "utf8");
      if (/from ["']@\/lib\/llm|\/api\/|fetch\(|openrouter|XMLHttpRequest|Math\.random\(/i.test(text)) offenders.push(f);
    }
    check("no model, network or Math.random code in src/lib/game", offenders.length === 0, offenders.join(", ") || readdirSync(dir).join(" "));
    const working = currentPosition(play(newGame(alexia, S), "pathWork"));
    const e1 = evaluatePosition(working, 27, REGIME.normal, S.weights, { paths: 64, seed: 9 });
    const e2 = evaluatePosition(working, 27, REGIME.normal, S.weights, { paths: 64, seed: 9 });
    const recombined = combine({ pGoal: e1.pGoal, pCrunch: e1.pCrunch, median: e1.median, p10: e1.p10, target: e1.target }, S.weights).e;
    const manual = 0.4 * 0.5 + 0.3 * (1 - 0.1) + 0.2 * 0.75 - 0.1 * 0.5;
    const formula = combine({ pGoal: 0.5, pCrunch: 0.1, median: 200_000, p10: 50_000, target: 100_000 }, S.weights).e;
    check("E is deterministic and equals the formula", e1.e === e2.e && Math.abs(recombined - e1.e) < 1e-12 && Math.abs(formula - manual) < 1e-12, `E ${pts(e1.e)} · formula example ${pts(formula)} = ${pts(manual)}`);
  }

  // ---------- 7. cash identity for every card and every year ----------
  {
    const samples: GameState[] = [alexia];
    let g = newGame(alexia, S);
    g = play(g, "pathWork");
    samples.push(currentPosition(g));
    for (const p of PROFILES) samples.push(accountOpening(p));
    const owner = applyCard(samples[samples.length - 2], "buyHome", REGIME.normal);
    samples.push(owner.state);
    const indebted = applyCard(applyCard(samples[1], "buyCar", REGIME.normal).state, "pathWork", REGIME.normal).state;
    samples.push({ ...indebted, cash: 1500 });
    const student = applyCard(alexia, "pathMasterLoan", REGIME.normal).state;
    samples.push(student);
    const rich = { ...accountOpening(PROFILES[1]), cash: 150_000, gross: 140_000, net: 8400 };
    samples.push(rich, applyCard(rich, "partTime", REGIME.normal).state);
    // Retirement: a worker close to retirement, a pensioner (renting and owning), and an 81-year-old.
    const nearRetirement = { ...accountOpening(PROFILES[1]), age: 62, pillar2: 380_000, pillar3a: 60_000 };
    samples.push(nearRetirement);
    const pensioner = stepYear({ ...nearRetirement, age: 65, retirementAge: 65 }, marketYear(REGIME.normal, MEDIAN_BUCKET)).state;
    samples.push(pensioner, { ...pensioner, age: 81 });
    samples.push(stepYear({ ...owner.state, age: 65, retirementAge: 65 }, marketYear(REGIME.normal, MEDIAN_BUCKET)).state);
    // Business: a new venture, and one that survived four years (promotion to a shop or a factory).
    const founder = { ...rich, portfolio: 300_000 };
    const venture = applyCard(founder, "startBusiness", REGIME.normal).state;
    samples.push(venture, { ...venture, business: { ...venture.business!, years: 4, policy: "withdraw" as const } });
    let worst = 0;
    let cards = 0;
    let years = 0;
    const exercised = new Set<string>();
    for (const s of samples) {
      for (const c of ALL_CARDS) {
        if (!c.eligible(s)) continue;
        for (const r of [REGIME.calm, REGIME.stress]) {
          const res = applyCard(s, c.id, r);
          worst = Math.max(worst, ledgerError(res.ledger));
          cards++;
          exercised.add(c.id);
        }
      }
      for (let b = 0; b < BUCKET_Z.length; b++) {
        const yr = stepYear(s, marketYear(REGIME.normal, b));
        worst = Math.max(worst, ledgerError(yr.ledger));
        years++;
      }
    }
    const missing = [...DECISION_CARDS, ...LIFE_CARDS].filter((c) => !exercised.has(c.id)).map((c) => c.id);
    check("cash identity: opening + flows = closing (every account, every card, every year)", worst < 1e-6, `${cards} card transitions, ${years} years, max error CHF ${worst.toExponential(1)}${missing.length ? " · not exercised: " + missing.join(", ") : ""}`);
  }

  // ---------- 8. the stepper and the simulator agree on the expected year ----------
  {
    let worst = 0;
    const rows: string[] = [];
    for (const start of [accountOpening(PROFILES[0]), accountOpening(PROFILES[1]), accountOpening(PROFILES[2])]) {
      const nwTree = [0, 1, 2, 3, 4].reduce((sum, b) => sum + netWorth(stepYear(start, marketYear(REGIME.normal, b)).state) / 5, 0);
      const res = simulate({ ...toSimInput(start, start.age + 1, REGIME.normal, 4000, 11), shocks: undefined });
      // simulate's bands are real (deflated): compare nominal by inflating back one year.
      const nwSim = res.bands[1].p50 * (1 + REGIME.normal.inflation);
      const rel = Math.abs(nwTree - nwSim) / Math.max(1, nwSim);
      worst = Math.max(worst, rel);
      rows.push(`${start.name} ${Math.round(nwTree).toLocaleString("en")} vs ${Math.round(nwSim).toLocaleString("en")}`);
    }
    check("one-year stepper ≈ simulator median (within 3%)", worst < 0.03, rows.join(" · ") + ` · worst ${(worst * 100).toFixed(1)}%`);
  }

  // ---------- 9. long game: turn schedule, retirement, independence, rating ----------
  {
    // Turns: yearly for ten years, then five-year turns, up to age 80.
    let g = newGame(accountOpening(PROFILES[0]), S);
    const lengths: number[] = [];
    while (!isOver(g) && g.moves.length < 13) {
      g = advance(g, "hold");
      lengths.push(g.moves[g.moves.length - 1].years);
    }
    const scheduleOk = lengths.slice(0, 10).every((y) => y === 1) && lengths.slice(10).every((y) => y === 5);
    check("turns: ten one-year turns, then five-year turns", scheduleOk || isOver(g), `${lengths.join(",")} · end age ${accountOpening(PROFILES[0]).age + accountOpening(PROFILES[0]).endTurn}`);

    // Retirement: pension fund → annuity, 3a paid out, AHV from 65; the ledger still balances.
    const worker = { ...accountOpening(PROFILES[1]), age: 65, retirementAge: 65, pillar2: 400_000, pillar3a: 80_000 };
    const yr = stepYear(worker, marketYear(REGIME.normal, MEDIAN_BUCKET));
    const p = yr.state.pension;
    const ok = !!p && yr.state.pillar2 === 0 && yr.state.pillar3a === 0 && Math.abs(p.bvgMonth - (400_000 * 0.055) / 12) < 1 && p.ahvMonth > 0 && ledgerError(yr.ledger) < 1e-6;
    check("retirement: annuity at the conversion rate, 3a paid out, AHV, ledger balances", ok, p ? `BVG CHF ${Math.round(p.bvgMonth)}/mo · AHV CHF ${Math.round(p.ahvMonth)}/mo · ledger error ${ledgerError(yr.ledger).toExponential(1)}` : "no pension");

    // Lump sum: capital into the portfolio after the withdrawal tax, no annuity.
    const lump = applyCard({ ...worker, age: 64 }, "lumpSum", REGIME.normal).state;
    const yl = stepYear({ ...lump, age: 65 }, marketYear(REGIME.normal, MEDIAN_BUCKET));
    const lp = yl.state.pension;
    check("lump sum: the pension fund is paid out as capital, no annuity", !!lp && lp.bvgMonth === 0 && yl.state.portfolio > lump.portfolio + 400_000 * 0.9 && ledgerError(yl.ledger) < 1e-6, `portfolio CHF ${Math.round(lump.portfolio).toLocaleString("en")} → ${Math.round(yl.state.portfolio).toLocaleString("en")} · BVG annuity ${Math.round(lp?.bvgMonth ?? -1)}`);

    // A retiree whose savings run out before 95 is not independent; one whose pensions cover the spending is.
    const pensioner = pensionerFor(worker);
    const retiredShort = { ...pensioner, cash: 20_000, portfolio: 120_000, expenses: pensionNet(pensioner) + 1500, expenseDelta: 0 };
    const retiredFine = { ...retiredShort, expenses: pensionNet(retiredShort) * 0.9, rent: 0 };
    const pShort = fiProbability(retiredShort, REGIME.normal, retiredShort.age + 1, 7);
    const pFine = fiProbability(retiredFine, REGIME.normal, retiredFine.age + 1, 7);
    check("retiree independence: savings must cover the pension gap until 95", pShort < FI_THRESHOLD && pFine >= FI_THRESHOLD, `gap CHF ${Math.round(monthlyOutflow(retiredShort) - pensionNet(retiredShort))}/mo: ${(pShort * 100).toFixed(0)}% · pensions cover spending: ${(pFine * 100).toFixed(0)}%`);

    // Independence ends the game as a win.
    const rich = { ...accountOpening(PROFILES[1]), age: 55, cash: 400_000, portfolio: 3_000_000, check: null };
    // (An opening that is already independent is won before the first move, see the audit checks; here the position
    // is entered mid-game, as after a windfall.)
    const midGame: Game = { settings: S, positions: [rich], moves: [], lifeEvents: [{ turn: 0, card: null, params: [] }] };
    const won = advance(midGame, "hold");
    check("independence (savings last to 95 in ≥ 90% of futures) wins the game", currentPosition(won).status === "won", `status ${currentPosition(won).status} at ${currentPosition(won).age}`);

    // Rating: deterministic, and holding scores exactly the reference formula.
    const holdGame = holdLine(newGame(accountOpening(PROFILES[0]), S));
    const r1 = rateGame(holdGame);
    const r2 = rateGame(holdGame);
    const expected = Math.round(1200 + 0.4 * (r1.holdScore - 1200));
    check("rating: deterministic; holding every year rates 1200 + 0.4 × (outcome − 1200)", r1.elo === r2.elo && r1.elo === expected && r1.playerScore === r1.holdScore, `Elo ${r1.elo} (${r1.tier}) · outcome ${r1.player.kind} at ${r1.player.age}`);
  }

  // ---------- 10. declared life preferences ----------
  {
    const base = { ...accountOpening(PROFILES[1]), check: null };
    const cands = ["haveChild", "hold"];
    const undeclared = analyse(base, S, { candidates: cands, budget: { scenarios: 8, paths: 32 } });
    const declared = analyse({ ...base, prefs: ["children"] }, S, { candidates: cands, budget: { scenarios: 8, paths: 32 } });
    const lu = reviewMove(undeclared, "haveChild").label;
    const ld = reviewMove(declared, "haveChild").label;
    const dealt = dealHand({ ...base, prefs: ["children"] }, S.seed).cards.includes("haveChild");
    check("preferences: a declared choice is not graded (♡) and is dealt; undeclared it is graded", ld === "lifeChoice" && lu !== "lifeChoice" && dealt, `undeclared ${lu} · declared ${ld} · dealt ${dealt}`);
    const accU = reviewMove(undeclared, "haveChild").accuracy;
    check("a life decision never counts towards the accuracy, declared or not", accU === null && reviewMove(declared, "haveChild").accuracy === null, `undeclared accuracy ${accU}`);
  }

  // ---------- 11. business: survival calibrated to the BFS (about half of new firms after five years) ----------
  {
    let alive = 0;
    const n = 600;
    for (let i = 0; i < n; i++) {
      let st: GameState = { ...accountOpening(PROFILES[1]), profileId: "founder-" + i, cash: 200_000 };
      st = applyCard(st, "startBusiness", REGIME.normal).state;
      for (let y = 0; y < 5 && st.business; y++) st = stepYear(st, marketYear(REGIME.normal, Math.floor(uniform(i, y, "bucket") * 5))).state;
      if (st.business) alive++;
    }
    const share = alive / n;
    check("business: about half of new ventures survive five years (BFS: 47.8–50.1%)", share > 0.4 && share < 0.6, `${(share * 100).toFixed(1)}% of ${n} ventures alive after 5 years`);
    const shopState = applyCard({ ...accountOpening(PROFILES[1]), cash: 300_000, business: { kind: "venture" as const, capital: 60_000, years: 4, profitRate: 0.15, hazard: 0.12, policy: "reinvest" as const, staff: 0 } }, "openShop", REGIME.normal);
    check("business: promotion to a shop adds the asset and its loan, ledger balances", shopState.state.business?.kind === "shop" && shopState.state.debts.some((d) => d.id === "debt-shop") && ledgerError(shopState.ledger) < 1e-6, `capital CHF ${Math.round(shopState.state.business?.capital ?? 0).toLocaleString("en")}`);
  }

  // ---------- budget: a review takes about a second ----------
  {
    const t0 = performance.now();
    const a = analyse(accountOpening(PROFILES[0]), S);
    const ms = performance.now() - t0;
    check("a review fits the budget (< 2.5 s in Node)", ms < 2500, `${a.candidates.length} candidates, ${a.stats.iterations} iterations, ${a.stats.leafEvals} rollouts × ${a.stats.paths} paths, ${ms.toFixed(0)} ms`);
  }

  await auditChecks(alexia, S);
  report();
}

function report() {
  console.log("");
  for (const r of results) console.log(r);
  console.log(failures ? `\n${failures} check(s) failed` : `\nAll ${results.length} Doppel Play checks passed`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
