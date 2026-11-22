/**
 * Regression checks for the engine audit (2026-11-22) and the features built on top of it:
 * `npx tsx scripts/engine-regression.ts`. Every check failed before its fix and passes after.
 * Exits 1 when any check fails.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROFILES } from "@/lib/data/profiles";
import { analyzeBehavior } from "@/lib/finance/behavioralEngine";
import { ECONOMIES, ECONOMY_IDS, economyTable } from "@/lib/finance/economy";
import { applyCarToGa, solveGoal } from "@/lib/finance/goalSolver";
import { carVsTransit, compileLife, inputsNeededFor, type LifePlan } from "@/lib/finance/life";
import { ASSUMPTIONS, simulate } from "@/lib/finance/monteCarlo";
import { outlook } from "@/lib/finance/outlook";
import { BASELINE, PENSION } from "@/lib/finance/params";
import { ACTUAL_MORTGAGE_RATE, PILLAR_3A_MAX_NO_PENSION_FUND, tragbarkeit } from "@/lib/finance/swissRules";
import type { Decision, LifeEvent, Profile, Scenario } from "@/lib/finance/types";
import { DECISION_CARRIER, applyOps, applyScenarioOps, applyScenarioOpsChecked, localParseCommand, updateDecision, validateOps, type Op } from "@/lib/twin/actions";
import { baseScenario, simInputFor } from "@/lib/finance/scenario";
import { DICTIONARIES, LOCALES, translate } from "@/lib/i18n";
import type { Locale, MessageKey, Msg } from "@/lib/i18n/types";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
};
const section = (title: string) => console.log(`\n${title}`);
/** A block of checks: an exception counts as a failure instead of stopping the run. */
const guard = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    check("block threw", false, e instanceof Error ? e.message : String(e));
  }
};

export const TEST_PROFILE: Profile = {
  id: "t",
  name: "Test",
  age: 30,
  city: "Zürich",
  canton: "ZH",
  tagline: { key: "profile.user.tagline" },
  grossIncomeYear: 100_000,
  netIncomeMonth: 6500,
  expensesMonth: 5000,
  rentMonth: 1800,
  cash: 20_000,
  portfolio: 100_000,
  pillar2: 50_000,
  pillar3a: 0,
  contributes3a: false,
  investShare: 0,
  marginalTaxRate: 0.25,
  riskProfile: "growth",
  retirementAge: 65,
  goal: { label: { key: "profile.goalK", params: { target: 300_000, age: 40 } }, target: 300_000, age: 40 },
  events: [],
  transactions: [],
  trades: [],
  history: { soldInDrawdown: false, drawdownSellPct: 0 },
  asOf: "2026-01-01",
};
const ev = (e: Partial<LifeEvent> & Pick<LifeEvent, "type" | "month">): LifeEvent => ({ id: `x-${e.type}-${e.month}`, label: e.type, amount: 0, ...e });

const NOW = new Date(2026, 10, 22);
const HOUSE = ev({ id: "ev-house", type: "house", month: 24, amount: 900_000 });
const parse = (text: string, locale: Locale = "en", events: LifeEvent[] = [HOUSE]) => localParseCommand(text, events, NOW, locale, 65);
const has = (ops: Op[] | null, want: Record<string, unknown>) =>
  !!ops?.some((o) => Object.entries(want).every(([k, v]) => (o as unknown as Record<string, unknown>)[k] === v));
const none = (ops: Op[] | null, want: Record<string, unknown>) => !has(ops, want);

function part1() {
  section("Part 1 — audit findings");

  // 1. A crash event must not change the other market draws.
  guard(() => {
    const p: Profile = { ...TEST_PROFILE, grossIncomeYear: 0, netIncomeMonth: 0, expensesMonth: 0, rentMonth: 0, cash: 0, pillar2: 0, healthPremiumMonth: 0, portfolio: 100_000 };
    const a = simulate({ profile: p, events: [], paths: 1, seed: 42 }).bands.map((b) => b.p50);
    const b = simulate({ profile: p, events: [ev({ type: "crash", month: 13 })], paths: 1, seed: 42 }).bands.map((x) => x.p50);
    const ratios = [3, 5, 8, 12].map((y) => b[y] / a[y]);
    const spread = Math.max(...ratios) / Math.min(...ratios) - 1;
    check("1 crash keeps the same markets after the crash month", spread < 1e-9, `ratio spread ${spread.toExponential(2)}`);
  });

  // 2–5, 11. English / German number and date handling.
  check("2 “buy a flat in 2028 for 1.2M” parses locally", has(parse("buy a flat in 2028 for 1.2M"), { type: "house", amount: 1_200_000, month: 20 }));
  check("3 “cut spending by 1,200” → −1200", has(parse("cut spending by 1,200"), { key: "expenseDelta", value: -1200 }));
  check("3 “buy a house for 850,000”", has(parse("buy a house for 850,000"), { type: "house", amount: 850_000 }));
  check("3 “buy a house for 1,200,000” and “1.200.000”", has(parse("buy a house for 1,200,000"), { amount: 1_200_000 }) && has(parse("buy a flat for 1.200.000"), { amount: 1_200_000 }));
  check("4 “raise of 10%” is not CHF 10 (EN, DE)", none(parse("I get a raise of 10%"), { type: "raise" }) && none(parse("Lohnerhöhung von 10%", "de"), { type: "raise" }));
  check("4 “Lohnerhöhung von 500 pro Monat” → 6000/yr", has(parse("Lohnerhöhung von 500 pro Monat", "de"), { type: "raise", amount: 6000 }));
  check("4 “raise of 500 a month” → 6000/yr", has(parse("a raise of 500 a month"), { type: "raise", amount: 6000 }));
  check("5 “lose my job in 18 months” keeps the default duration", has(parse("lose my job in 18 months"), { type: "jobloss", month: 18, duration: 6 }));
  check("5 “lose my job for 9 months in 2028”", has(parse("lose my job for 9 months in 2028"), { type: "jobloss", month: 20, duration: 9 }));
  check(
    "11 a past year is dropped, not moved to today (EN, DE, FR, TR)",
    none(parse("buy a flat in 2024 for 900k"), { type: "house" }) &&
      none(parse("Wohnung kaufen 2024 für 900k", "de"), { type: "house" }) &&
      none(parse("acheter un appartement en 2024 pour 900k", "fr"), { type: "house" }) &&
      none(parse("2024'te ev alsam 900 bine", "tr"), { type: "house" }),
  );

  // 6. A negative raise cannot push income below zero.
  guard(() => {
    const r = simulate({ profile: TEST_PROFILE, events: [ev({ type: "raise", month: 0, amount: -200_000 })], horizon: "goal" });
    const zero = simulate({ profile: { ...TEST_PROFILE, grossIncomeYear: 0, netIncomeMonth: 0 }, events: [], horizon: "goal" });
    check("6 raise −200k on 100k gross = zero income, not negative", Math.abs(r.medianAtGoal - zero.medianAtGoal) < 1, `median ${Math.round(r.medianAtGoal)} vs zero-income ${Math.round(zero.medianAtGoal)}`);
  });

  // 7. A home planned after the goal date does not fail the goal.
  guard(() => {
    const p: Profile = { ...TEST_PROFILE, goal: { ...TEST_PROFILE.goal, target: 1000, age: 32 } };
    const r = simulate({ profile: p, events: [ev({ type: "house", month: 120, amount: 5_000_000 })], horizon: "goal" });
    check("7 unaffordable home 8 years after the goal date leaves the goal alone", r.successProb === 1 && r.house?.boughtProb === 0, `success ${r.successProb}`);
    const before = simulate({ profile: p, events: [ev({ type: "house", month: 12, amount: 5_000_000 })], horizon: "goal" });
    check("7 a failed home before the goal date still fails the plan", before.successProb === 0);
  });

  // 8. Future amounts are in today's CHF: the home price and one-offs are indexed to their date.
  guard(() => {
    const at = (m: number) => simulate({ profile: TEST_PROFILE, events: [ev({ type: "house", month: m, amount: 800_000 })], paths: 50 }).house!;
    const h0 = at(0);
    const h240 = at(240);
    check("8 home price is indexed to the purchase date", h240.price > h0.price * 1.2 && h240.priceToday === 800_000, `month 0 ${Math.round(h0.price)} · month 240 ${Math.round(h240.price)}`);
    const acc = (events: LifeEvent[]) => simulate({ profile: { ...TEST_PROFILE, portfolio: 0 }, events, paths: 1, horizon: "goal", trace: true }).trace!.cash;
    const plain = acc([]);
    const withExpense = acc([ev({ type: "expense", month: 119, amount: 10_000 })]);
    const paid = plain[119] - withExpense[119];
    check("8 a one-off in 10 years is paid in that year's CHF", paid > 10_000 * 1.1, `CHF ${Math.round(paid)} for 10,000 in today's CHF`);
  });

  // 9. Pillar 2 may fund equity above 20% (only the first 10% must be hard).
  guard(() => {
    const t = tragbarkeit({ price: 1_000_000, grossIncomeYear: 150_000, hardEquityAvailable: 150_000, pillar2Available: 400_000 });
    check("9 pillar 2 covers the equity the income rule needs", t.pass && t.pillar2Used > 50_000, `pillar 2 used ${Math.round(t.pillar2Used)}`);
    const soft = tragbarkeit({ price: 1_000_000, grossIncomeYear: 250_000, hardEquityAvailable: 50_000, pillar2Available: 400_000 });
    check("9 the 10% hard-equity rule still holds", !soft.pass && soft.equityGap === 50_000);
  });

  // 10. A cut below the rent floor is reported as what the engine really applies.
  guard(() => {
    const p: Profile = { ...TEST_PROFILE, expensesMonth: 2200, rentMonth: 1800 };
    const r = simulate({ profile: p, events: [], expenseDelta: -2500, horizon: "goal", paths: 50 });
    check("10 the result reports the applied spending change", r.expenseDeltaApplied === -400, `applied ${r.expenseDeltaApplied}`);
    const s = applyScenarioOps(baseScenario(p), [{ op: "set", key: "expenseDelta", value: -2500 }], "command", { profile: p });
    check("10 applyScenarioOps clamps the cut when it knows the profile", s.expenseDelta === -400, `scenario delta ${s.expenseDelta}`);
  });

  // 12. validateOps.
  guard(() => {
    const ops = validateOps(
      [
        { op: "add", type: "house", month: 12, amount: "0x100000" },
        { op: "add", type: "jobloss", month: "" },
        { op: "add", type: "jobloss", month: 3, duration: 2.5 },
        { op: "shift", id: "ev-house", months: 470 },
      ],
      [HOUSE],
    );
    check("12 hex strings and empty months are rejected", none(ops, { type: "house" }) && ops.filter((o) => o.op === "add").length === 1);
    check("12 durations are whole months", has(ops, { type: "jobloss", duration: 3 }));
    check("12 a shift past the 480-month bound is dropped", none(ops, { op: "shift" }));
  });

  // 13. simulate() edge cases.
  guard(() => {
    const run = (patch: Partial<Profile>, extra: object = {}) => {
      try {
        return simulate({ profile: { ...TEST_PROFILE, ...patch }, events: [], paths: 20, ...extra });
      } catch {
        return null;
      }
    };
    const old = run({ age: 95, goal: { ...TEST_PROFILE.goal, age: 80 } });
    check("13 age above 90 with a past goal does not throw", !!old && old.bands.length >= 2);
    const frac = run({ age: 30.5 });
    check("13 a fractional age gives finite bands", !!frac && frac.bands.every((b) => Number.isFinite(b.p50)));
    const zero = run({}, { paths: 0 });
    check("13 paths: 0 falls back to at least one path", !!zero && Number.isFinite(zero.successProb));
    const retired = run({ age: 60, retirementAge: 55, goal: { ...TEST_PROFILE.goal, age: 70 } });
    check("13 already retired still returns retirement stats", !!retired?.retirement && Number.isFinite(retired.retirement.replacementRatio));
  });

  // The three "unverified" items.
  guard(() => {
    const self: Profile = { ...TEST_PROFILE, bvgInsured: false, contributes3a: true, pillar3a: 0, portfolio: 0, expensesMonth: 2000, investShare: 0 };
    const insured: Profile = { ...self, bvgInsured: true };
    const p3a = (p: Profile) => simulate({ profile: p, events: [], paths: 1, accounting: true, horizon: "goal", trace: true }).trace!.p3a![11];
    check("U1 without a pension fund the 3a ceiling is 20% of income up to 36,288", p3a(self) > 15_000 && p3a(insured) < 7300, `self ${Math.round(p3a(self))} · insured ${Math.round(p3a(insured))}`);
    const early = simulate({ profile: { ...TEST_PROFILE, retirementAge: 60 }, events: [], paths: 50 }).retirement!;
    check(
      "U2 early retirement: income at retirement excludes AHV until the reference age",
      Math.abs(early.monthlyIncomeAtRetirement - early.bvgMonthly) < 1e-6 && early.monthlyIncomeFromAhvAge! > early.monthlyIncomeAtRetirement && early.bvgMonthlyAtAhvAge! < early.bvgMonthly,
      `at 60 ${Math.round(early.monthlyIncomeAtRetirement)} · from 65 ${Math.round(early.monthlyIncomeFromAhvAge!)}`,
    );
  });
}

const decision = (id: string, month: number, d: Decision): LifeEvent => ({ id, type: DECISION_CARRIER[d.kind], label: d.kind, month, amount: 0, decision: d });
const lineOf = (plan: LifePlan, id: string) => plan.lines.find((l) => l.id === id)!;
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

function part2() {
  section("Part 2 — life decisions");
  const p = TEST_PROFILE;
  const months = 720;
  const retire = 420;

  guard(() => {
    // Old stored events (no `decision`) behave as before: a flat child cost for its duration.
    const old = ev({ id: "old-child", type: "child", month: 12, amount: 1500, durationMonths: 216 });
    const r = simulate({ profile: p, events: [old], paths: 20, detail: true });
    const l = r.detail!.lines.find((x) => x.eventId === "old-child")!;
    check("legacy child event keeps the flat model", near(l.monthly[12], 1500) && near(l.monthly[227], 1500) && l.monthly[228] === 0 && l.monthly[11] === 0 && !r.life);
    const applied = applyOps([old], [{ op: "shift", id: "old-child", months: 6 }]);
    check("legacy events still load and shift", applied[0].month === 18 && applied[0].decision === undefined);
  });

  guard(() => {
    const plan = compileLife(p, [decision("c", 12, { kind: "child", tertiaryTrack: "university" })], months, retire);
    const direct = lineOf(plan, "c:direct").monthly;
    check("child: direct cost by age band (850 / 950 / 1200)", near(direct[12], 850) && near(direct[12 + 60], 950) && near(direct[12 + 156], 1200) && direct[12 + 192] === 0);
    const kita = lineOf(plan, "c:kita").monthly;
    // ZH income ramp at CHF 100k gross: 25 + (40/70) × 95 = 79.29 CHF/day; 3 days × 4.2 weeks.
    check("child: daycare from age 0.5 to 4.5 at the ZH income tariff", kita[12 + 5] === 0 && near(kita[12 + 6], 3 * 4.2 * 79.29, 1) && near(kita[12 + 53], 3 * 4.2 * 79.29, 1) && kita[12 + 54] === 0, `CHF ${Math.round(kita[18])}/mo`);
    const allowance = lineOf(plan, "c:allowance").monthly;
    check("child: ZH allowance 215 after tax until 16, education allowance 268 after", near(allowance[12], 215 * 0.75) && allowance[12 + 192] === 0 && near(lineOf(plan, "c:eduAllowanceU").monthly[12 + 192], 268 * 0.75));
    const vd = compileLife({ ...p, canton: "VD" }, [decision("c", 12, { kind: "child" })], months, retire);
    check("child: canton decides the allowance (VD 322) and the daycare tariff (no ZH ramp)", near(lineOf(vd, "c:allowance").monthly[12], 322 * 0.75) && near(lineOf(vd, "c:kita").monthly[18], 3 * 4.2 * 120));
    check("child: tax effects (deduction 6,800 × marginal + 263; childcare deduction)", near(lineOf(plan, "c:tax").monthly[12], (6800 * 0.25 + 263) / 12) && near(lineOf(plan, "c:careTax").monthly[18], (Math.min(3 * 4.2 * 79.29 * 12, 25_000) * 0.25) / 12, 1));
    check("child: university track = tuition 1,460/yr + living 1,500/mo from 19 to 24", near(lineOf(plan, "c:uniTuition").monthly[12 + 19 * 12], 1460 / 12) && near(lineOf(plan, "c:uniLiving").monthly[12 + 19 * 12], 1500) && lineOf(plan, "c:uniLiving").monthly[12 + 24 * 12] === 0);
    const second = compileLife(p, [decision("a", 12, { kind: "child" }), decision("b", 36, { kind: "child" })], months, retire);
    check("child: a second child costs less (× 0.75 at 0–4)", near(lineOf(second, "b:direct").monthly[36], 850 * 0.75));
    const user = compileLife(p, [decision("c", 12, { kind: "child", kitaDailyChf: 100, kitaDaysPerWeek: 5, directMonthly: 700 })], months, retire);
    check("user values override the defaults and are labelled user", near(lineOf(user, "c:kita").monthly[18], 5 * 4.2 * 100) && lineOf(user, "c:kita").provenance === "user" && near(lineOf(user, "c:direct").monthly[12], 700) && user.params.some((x) => x.id === "kitaDailyChf" && x.provenance === "user"));
  });

  guard(() => {
    const auto = [decision("c", 12, { kind: "child" })];
    const run = (track?: "university" | "apprenticeship") => simulate({ profile: p, events: track ? [decision("c", 12, { kind: "child", tertiaryTrack: track })] : auto, horizon: "full" });
    const a = run();
    const share = a.life!.alternatives[0].share;
    check("child: the track after school is drawn per future (≈ 43% university)", Math.abs(share - 0.43) < 0.05 && a.life!.alternatives[0].prob === 0.43, `share ${share}`);
    const uni = run("university").bands[30].p50;
    const app = run("apprenticeship").bands[30].p50;
    check("child: pinned tracks bracket the drawn one (same markets)", app > a.bands[30].p50 && a.bands[30].p50 > uni && !run("university").life!.alternatives.length);
  });

  guard(() => {
    const owned = compileLife(p, [decision("car", 12, { kind: "car", mode: "owned", price: 35_000 })], months, retire);
    const pays = owned.oneOffs.map((o) => [o.month, o.amount]);
    check("car (owned): purchase, replacement every 10 years after resale, sale at 80", pays[0][0] === 12 && pays[0][1] === -35_000 && pays[1][0] === 132 && near(pays[1][1], -28_000) && pays[pays.length - 1][1] === 7000 && pays[pays.length - 1][0] === 600);
    check("car (owned): TCS running costs 310 + 12,000 km × 0.276 / 12", near(lineOf(owned, "car:fixed").monthly[12], 310) && near(lineOf(owned, "car:running").monthly[12], 276) && lineOf(owned, "car:fixed").monthly[600] === 0);
    const leased = compileLife(p, [decision("car", 0, { kind: "car", mode: "leased" })], months, retire);
    check("car (leased): default instalment from the TCS 50% rule (45,000 × 0.5 / 48)", near(lineOf(leased, "car:lease").monthly[0], 469) && lineOf(leased, "car:lease").provenance === "derived" && leased.oneOffs.length === 0);
    const ga = compileLife(p, [decision("car", 0, { kind: "car", mode: "ga", replacesMonthly: 88 })], months, retire);
    check("GA travelcard: 4,095 a year, minus the pass it replaces", near(lineOf(ga, "car:ga").monthly[0], 4095 / 12) && near(lineOf(ga, "car:replaces").monthly[0], -88));
    const cmp = carVsTransit();
    check("car vs GA: TCS reference car costs more than a GA every month", cmp.carMonthly > cmp.gaMonthly && near(cmp.gaMonthly, 341.25, 0.01), `car ${Math.round(cmp.carMonthly)} vs GA ${Math.round(cmp.gaMonthly)}`);
  });

  guard(() => {
    const full = simulate({ profile: p, events: [], paths: 20 });
    const part = simulate({ profile: p, events: [decision("w", 0, { kind: "workload", percent: 80 })], paths: 20, detail: true });
    const income = part.detail!.lines.find((l) => l.id === "income")!.monthly;
    check("workload 80%: take-home pay × 0.8 and a smaller pension", near(income[0], p.netIncomeMonth * 0.8, 10) && part.retirement!.bvgMonthly < full.retirement!.bvgMonthly * 0.85);
    const sab = compileLife(p, [decision("s", 12, { kind: "workload", percent: 0, durationMonths: 6 })], months, retire);
    check("sabbatical: no salary for its months, then back", sab.workFactor[11] === 1 && sab.workFactor[12] === 0 && sab.workFactor[17] === 0 && sab.workFactor[18] === 1);
  });

  guard(() => {
    const self = [decision("se", 0, { kind: "selfEmployed", netIncomeMonth: 6500, incomeVolatility: 0.3 })];
    const calm = [decision("se", 0, { kind: "selfEmployed", netIncomeMonth: 6500, incomeVolatility: 0 })];
    const a = simulate({ profile: p, events: self });
    const b = simulate({ profile: p, events: calm });
    const emp = simulate({ profile: p, events: [] });
    check("self-employment: no pension-fund credits", b.retirement!.bvgMonthly < emp.retirement!.bvgMonthly * 0.5, `BVG ${Math.round(b.retirement!.bvgMonthly)} vs ${Math.round(emp.retirement!.bvgMonthly)}`);
    const spread = (r: typeof a) => r.bands[10].p90 - r.bands[10].p10;
    check("self-employment: income volatility widens the outcomes", spread(a) > spread(b) * 1.05);
    const missing = compileLife(p, [decision("se", 0, { kind: "selfEmployed" })], months, retire);
    check("self-employment: income and volatility are asked for, not invented", missing.inputsNeeded.map((n) => n.field).join() === "netIncomeMonth,incomeVolatility" && missing.selfNet[0] === 0 && missing.selfVol[0] === 0);
  });

  guard(() => {
    const partner = decision("pt", 0, { kind: "partner", married: true, netIncomeMonth: 6000, expensesMonth: 2000, rentMonth: 2600, taxDeltaYear: 2400 });
    const r = simulate({ profile: p, events: [partner], paths: 20, detail: true });
    const solo = simulate({ profile: p, events: [], paths: 20 });
    const d = r.detail!;
    check("partner: second income, own living costs, shared rent, tax change", near(d.lines.find((l) => l.kind === "partnerIncome")!.monthly[0], 6000, 10) && near(d.lines.find((l) => l.id === "rent")!.monthly[0], 2600, 5) && near(d.lines.find((l) => l.id === "pt:tax")!.monthly[0], 200));
    check("partner: married couple's AHV is capped at 150% of the maximum pension", near(r.retirement!.ahvMonthly, 1.5 * 2520 * (13 / 12) * 0.9, 1) && r.retirement!.ahvMonthly < 2 * solo.retirement!.ahvMonthly, `AHV ${Math.round(r.retirement!.ahvMonthly)}`);
    const empty = compileLife(p, [decision("pt", 0, { kind: "partner", married: true })], months, retire);
    check("partner: nothing is assumed without the user's figures", empty.inputsNeeded.length === 4 && empty.lines.length === 0 && empty.partnerNet[0] === 0);
  });

  guard(() => {
    const plan = compileLife(p, [decision("mv", 12, { kind: "move", canton: "ZG", rentMonth: 2500, movingCost: 3000 })], months, retire);
    const tax = lineOf(plan, "mv:tax");
    // ZH 11.7% → ZG 5.3% of gross (ESTV-based index): the tax implied by the take-home pay falls by 1 − 5.3/11.7.
    const expected = (0.125 * 100_000 * 0.87 * (1 - 5.3 / 11.7)) / 12;
    check("move ZH → ZG: lower income tax, lower premiums, new rent, moving cost", tax.flow === "income" && near(tax.monthly[12], expected, 1) && near(lineOf(plan, "mv:premium").monthly[12], (5016 - 7680) / 12, 1) && plan.rent[12] === 2500 && plan.rent[11] === 1800 && plan.oneOffs[0].amount === -3000, `tax −${Math.round(tax.monthly[12])}/mo`);
    const noData = compileLife(p, [decision("mv", 12, { kind: "move", canton: "AG" })], months, retire);
    check("move: missing rent, moving cost and tax data are asked for", noData.inputsNeeded.map((n) => n.field).join() === "rentMonth,movingCost,taxDeltaYear");
  });

  guard(() => {
    const plan = compileLife(p, [decision("ed", 12, { kind: "education", program: "master", workloadPct: 0, raiseAfterYear: 15_000 })], months, retire);
    check("education: sourced tuition and length, the user's workload and later salary", near(lineOf(plan, "ed:tuition").monthly[12], 1460 / 12) && plan.workFactor[12] === 0 && plan.workFactor[36] === 1 && plan.raise[36] === 15_000 && plan.inputsNeeded.length === 0);
    const other = compileLife(p, [decision("ed", 12, { kind: "education", program: "other" })], months, retire);
    check("education: an unknown programme asks for its cost and length", other.inputsNeeded.map((n) => n.field).join() === "durationMonths,tuitionYear,workloadPct,raiseAfterYear");
  });

  guard(() => {
    // Budget identity in accounting mode: month-on-month cash change = income lines − expense lines + one-offs.
    const acct: Profile = { ...p, cash: 300_000, portfolio: 0, investShare: 0, healthPremiumMonth: 400 };
    const events = [
      decision("c", 6, { kind: "child", tertiaryTrack: "university" }),
      decision("car", 12, { kind: "car", mode: "owned", price: 20_000 }),
      decision("pt", 3, { kind: "partner", married: true, netIncomeMonth: 5000, expensesMonth: 1500, rentMonth: 2600, taxDeltaYear: 1200 }),
      decision("mv", 24, { kind: "move", canton: "ZG", rentMonth: 3000, movingCost: 4000 }),
      decision("w", 30, { kind: "workload", percent: 80, durationMonths: 12 }),
      ev({ id: "one", type: "expense", month: 40, amount: 9000 }),
    ];
    const r = simulate({ profile: acct, events, paths: 1, accounting: true, trace: true, detail: true });
    const d = r.detail!;
    let worst = 0;
    for (let m = 1; m < 400; m++) {
      let flow = 0;
      for (const l of d.lines) if (!l.info) flow += (l.flow === "income" ? 1 : -1) * l.monthly[m];
      for (const o of d.oneOffs) if (o.month === m) flow += o.amount;
      worst = Math.max(worst, Math.abs(r.trace!.cash[m] - r.trace!.cash[m - 1] - flow));
    }
    check("the itemised budget equals the simulated cash flow (accounting mode, 400 months)", worst < 0.01, `largest gap CHF ${worst.toFixed(4)}`);
    check("every budget line of a decision carries a provenance", d.lines.filter((l) => l.eventId).every((l) => !!l.provenance));
  });

  guard(() => {
    const ops = validateOps(
      [
        { op: "add", type: "expense", month: 12, decision: { kind: "car", mode: "owned", price: 35_000 } },
        { op: "add", type: "expense", month: 12, decision: { kind: "car", mode: "owned", price: 5 } },
        { op: "add", type: "expense", month: 12, decision: { kind: "spaceship" } },
        { op: "add", type: "child", month: 12, decision: { kind: "child", kitaDaysPerWeek: 9 } },
        { op: "add", type: "raise", month: 1, decision: { kind: "workload", percent: 80 } },
      ],
      [],
    );
    check("validateOps: decisions inside their bounds pass, the others are dropped", ops.length === 2 && has(ops, { type: "expense", amount: 35_000 }) && has(ops, { type: "raise" }));
    const events = applyOps([], ops);
    check("applyOps: the decision travels with the event", events[0].decision?.kind === "car" && events[1].decision?.kind === "workload");
  });
}

function part3() {
  section("Part 3 — economy");
  const p = TEST_PROFILE;

  guard(() => {
    const rows = Object.entries(BASELINE);
    check("baseline table: every value is dated and sourced", rows.length >= 20 && rows.every(([, x]) => Number.isFinite(x.value) && /^\d{4}-\d{2}-\d{2}$/.test(x.asOf) && x.source.length > 5 && !!x.provenance));
    check(
      "the engine constants are the table's values",
      ASSUMPTIONS.inflation === BASELINE.inflation.value && ASSUMPTIONS.equity.mu === BASELINE.equityMu.value && ASSUMPTIONS.healthExcessGrowth === BASELINE.healthExcessGrowth.value && ACTUAL_MORTGAGE_RATE === BASELINE.mortgageRate.value && PILLAR_3A_MAX_NO_PENSION_FUND === PENSION.pillar3aMaxNoFund.value,
    );
    const a = simulate({ profile: p, events: [], paths: 200 });
    const b = simulate({ profile: p, events: [], paths: 200, economy: "baseline" });
    check("economy: baseline = no economy given (bit-identical)", JSON.stringify(a.bands) === JSON.stringify(b.bands) && a.successProb === b.successProb && b.economy === undefined);
  });

  guard(() => {
    const house = ev({ type: "house", month: 12, amount: 600_000 });
    const rich: Profile = { ...p, cash: 300_000 };
    const base = simulate({ profile: rich, events: [house], paths: 200, detail: true });
    const high = simulate({ profile: rich, events: [house], paths: 200, economy: "high_inflation", detail: true });
    check("high inflation: prices rise 3.8% a year for 3 years, then 1.2%", near(high.detail!.priceIdx[35], Math.pow(1.038, 3), 1e-9) && near(high.detail!.priceIdx[47] / high.detail!.priceIdx[35], 1.012, 1e-9));
    check("high inflation: a mortgage taken in year 2 locks in 4.8% (baseline 1.8%)", high.house!.mortgageRate === 0.048 && base.house!.mortgageRate === undefined);
    const interest = (r: typeof base) => r.detail!.lines.find((l) => l.id.endsWith(":interest"))!.monthly;
    check("high inflation: the 10-year fixed rate resets to the then-current rate", interest(high)[13] > interest(base)[13] * 2 && interest(high)[12 + 121] < interest(high)[12 + 119] * 0.5);
    check("high inflation: real wages fall, so the goal is harder", high.medianAtGoal < base.medianAtGoal && high.economy === "high_inflation");
  });

  guard(() => {
    const saver: Profile = { ...p, grossIncomeYear: 0, netIncomeMonth: 0, expensesMonth: 0, rentMonth: 0, cash: 0, pillar2: 0, healthPremiumMonth: 0, portfolio: 100_000 };
    const base = simulate({ profile: saver, events: [], paths: 400 });
    const rec = simulate({ profile: saver, events: [], paths: 400, economy: "recession" });
    const ratio = rec.bands[1].p50 / base.bands[1].p50;
    check("recession: shares fall 30% in the first month", ratio > 0.7 && ratio < 0.82, `year-1 median × ${ratio.toFixed(3)}`);
    const worker: Profile = { ...p, portfolio: 0, cash: 5000, expensesMonth: 6000 };
    const calm = simulate({ profile: worker, events: [], paths: 1000, horizon: "goal", detail: true });
    const hit = simulate({ profile: worker, events: [], paths: 1000, horizon: "goal", economy: "recession", detail: true });
    check("recession: the job-loss risk produces cash crunches the baseline does not have", hit.crunchProb > calm.crunchProb + 0.02, `crunch ${calm.crunchProb} → ${hit.crunchProb}`);
    const clim = simulate({ profile: saver, events: [], paths: 400, economy: "climate_transition" });
    const drag = Math.pow(clim.bands[10].p50 / base.bands[10].p50, 1 / 10) - 1;
    check("climate transition: about −0.4% a year on a growth portfolio (80% shares) for 10 years", drag < -0.002 && drag > -0.005, `${(drag * 100).toFixed(2)}%/yr`);
  });

  guard(() => {
    const custom = { id: "mine", label: { key: "economy.name.baseline" as const }, summary: { key: "economy.summary.baseline" as const }, phases: [{ years: 2, label: { key: "economy.phase.high" as const }, regime: { inflation: 0.05, wageGrowth: NaN, mortgageRate: 9 }, sources: [] }] };
    const r = simulate({ profile: p, events: [], paths: 50, economy: custom, detail: true });
    check("a custom scenario is used; values outside plausible bounds are limited, NaN ignored", near(r.detail!.priceIdx[23], 1.05 * 1.05, 1e-9) && r.economy === "mine" && r.bands.every((b) => Number.isFinite(b.p50)));
    check("every scenario lists what it changes and where the value comes from", ECONOMY_IDS.every((id) => ECONOMIES[id].phases.every((ph) => ph.sources.length > 0 && ph.sources.every((s) => s.source.length > 5))) && economyTable("recession").phases.length === 2);
    const dir = join(__dirname, "../src/lib/finance");
    const offline = readdirSync(dir).every((f) => !/\bfetch\(|XMLHttpRequest|from "node:https?"|axios/.test(readFileSync(join(dir, f), "utf8")));
    check("the engine makes no network calls", offline);
  });
}

function part4() {
  section("Part 4 — outlook");
  const [barlas] = PROFILES;
  const b = analyzeBehavior(barlas).params;
  const s0 = baseScenario(barlas);
  const s1 = applyScenarioOps(s0, validateOps([{ op: "add", type: "child", label: "Baby", month: 20, decision: { kind: "child" } }], s0.events));
  guard(() => {
    const o = outlook(barlas, s1, { behavior: b, now: NOW });
    const headline = simulate(simInputFor(barlas, s1, b));
    check("outlook: goal odds are the headline's (same seed and paths)", o.goal.prob === headline.successProb && o.goal.baselineProb === simulate(simInputFor(barlas, s0, b)).successProb);
    check("outlook: net worth at +1, +5, +10 years, the goal date and retirement, each with P10 ≤ P50 ≤ P90 and the baseline", o.netWorth.map((n) => n.key).join() === "y1,y5,y10,goal,retirement" && o.netWorth.every((n) => n.p10 <= n.p50 && n.p50 <= n.p90 && n.baseline !== undefined));
    check("outlook: budget now = today's income and spending", near(o.budget.now.income, barlas.netIncomeMonth, barlas.netIncomeMonth * 0.01) && near(o.budget.now.expenses, barlas.expensesMonth, barlas.expensesMonth * 0.01));
    const lines = o.budget.after.items.filter((i) => i.eventId);
    check("outlook: the decision's lines are itemised in the budget after it", o.budget.after.month === 20 && lines.length >= 3 && o.budget.surplusDelta! < -400, `Δ surplus ${Math.round(o.budget.surplusDelta!)}/mo`);
    const dec = o.decisions.find((x) => x.isNew)!;
    check("outlook: the decision over the years (first year, 5 and 10 years, by year)", dec.kind === "child" && dec.netMonthly.years5 > dec.netMonthly.year1 && dec.byYear.length >= 20 && dec.totalNet > 100_000, `10-yr average CHF ${Math.round(dec.netMonthly.years10)}/mo · total ${Math.round(dec.totalNet)}`);
    check("outlook: lowest cash point, crunch odds and retirement income vs spending", Number.isFinite(o.cashLow.median.amount) && o.cashLow.p10.amount <= o.cashLow.median.amount && o.crunch.within.length === 3 && !!o.retirement && near(o.retirement.gapMonthly, o.retirement.spendingMonthly - o.retirement.incomeFromAhvAge, 1e-9));
    const kinds = new Set(o.markers.map((m) => m.kind));
    check("outlook: dated markers for the chart (child phases, goal, retirement)", ["childBirth", "kitaStart", "kitaEnd", "childTrack", "goal", "retirement"].every((x) => kinds.has(x)) && o.markers.every((m, i) => i === 0 || m.month >= o.markers[i - 1].month) && o.markers.find((m) => m.kind === "childBirth")!.ym === 202807);
    // Only message descriptors and numbers: every label must resolve in the dictionary.
    const labels: unknown[] = [o.economy.label, o.economy.summary, o.goal.label, ...o.netWorth.map((n) => n.label), ...o.markers.map((m) => m.label), ...o.budget.after.items.map((i) => i.label), ...o.decisions.flatMap((d) => [d.label, ...d.lines.map((l) => l.label), ...d.oneOffs.map((x) => x.label)]), ...o.inputsNeeded.map((n) => n.label)];
    const flat = new Map<string, unknown>();
    const walk = (v: unknown, key: string) => (typeof v === "string" ? flat.set(key, v) : Object.entries(v as object).forEach(([k2, c]) => walk(c, key ? `${key}.${k2}` : k2)));
    walk(DICTIONARIES.en, "");
    const bad = labels.filter((l) => typeof l !== "string" && !flat.has((l as Msg).key) && !flat.has(`${(l as Msg).key}_other`));
    check("outlook: every label is a message key of the dictionaries", bad.length === 0, bad.length ? JSON.stringify(bad[0]) : `${labels.length} labels`);
    const again = outlook(barlas, s1, { behavior: b, now: NOW });
    const strip = (x: typeof o) => JSON.stringify({ ...x, sim: { ...x.sim, ms: 0, detail: undefined }, baselineSim: { ...x.baselineSim!, ms: 0, detail: undefined } });
    check("outlook: deterministic", strip(o) === strip(again));
  });
  guard(() => {
    const home = PROFILES[1];
    const o = outlook(home, baseScenario(home), { baseline: null, now: NOW });
    const dec = o.decisions.find((x) => x.kind === "house")!;
    check("outlook: a planned home shows interest, upkeep, amortisation and the rent that falls away", !!dec && dec.lines.length === 4 && dec.oneOffs.some((x) => x.transfer) && o.baselineSim === undefined);
    const eco = outlook(home, { ...baseScenario(home), economy: "high_inflation" }, { now: NOW });
    check("outlook: an economic scenario is compared with the same plan under the baseline economy", eco.economy.id === "high_inflation" && eco.baselineSim!.economy === undefined && eco.netWorth[2].deltaP50! < 0);
  });
}

function part5() {
  section("Part 5 — parsers (EN / DE / FR / TR)");
  const cases: [string, (ops: Op[] | null) => boolean][] = [
    ["car", (ops) => has(ops, { type: "expense", amount: 35_000, month: 8 }) && decisionOf(ops)?.kind === "car" && (decisionOf(ops) as { mode: string }).mode === "owned" && (decisionOf(ops) as { price: number }).price === 35_000],
    ["lease", (ops) => decisionOf(ops)?.kind === "car" && (decisionOf(ops) as { mode: string }).mode === "leased" && (decisionOf(ops) as { leaseMonthly: number }).leaseMonthly === 500],
    ["child", (ops) => has(ops, { type: "child", month: 20 }) && decisionOf(ops)?.kind === "child"],
    ["workload", (ops) => decisionOf(ops)?.kind === "workload" && (decisionOf(ops) as { percent: number }).percent === 80],
    ["move", (ops) => decisionOf(ops)?.kind === "move" && (decisionOf(ops) as { canton: string }).canton === "ZG"],
    ["marry", (ops) => has(ops, { month: 8 }) && decisionOf(ops)?.kind === "partner" && (decisionOf(ops) as { married: boolean }).married === true],
    ["master", (ops) => has(ops, { month: 8 }) && decisionOf(ops)?.kind === "education" && (decisionOf(ops) as { program: string }).program === "master"],
    ["economy", (ops) => has(ops, { op: "set", key: "economy", value: "high_inflation" })],
  ];
  for (const locale of LOCALES) {
    const failedIds: string[] = [];
    for (const [id, ok] of cases) {
      const text = translate(locale, `life.examples.${id}` as MessageKey);
      const ops = parse(text, locale, []);
      if (ops?.length !== 1 || !ok(ops)) failedIds.push(`${id}: “${text}” → ${JSON.stringify(ops)}`);
      // The English sentence must also parse when another language is active.
      const english = parse(translate("en", `life.examples.${id}` as MessageKey), locale, []);
      if (english?.length !== 1 || !ok(english)) failedIds.push(`${id} (English under ${locale})`);
    }
    check(`${locale}: ${cases.length} life-decision examples parse locally`, failedIds.length === 0, failedIds.join(" | "));
  }
  guard(() => {
    const more: [string, Locale, (ops: Op[] | null) => boolean][] = [
      ["Lease a 45k car in 2028", "en", (o) => (decisionOf(o) as { price?: number })?.price === 45_000 && (decisionOf(o) as { mode: string }).mode === "leased"],
      ["Get a GA travelcard", "en", (o) => (decisionOf(o) as { mode: string })?.mode === "ga"],
      ["What if my kid studies at ETH?", "en", (o) => (decisionOf(o) as { tertiaryTrack: string })?.tertiaryTrack === "university"],
      ["Take a sabbatical for 6 months in 2029", "en", (o) => (decisionOf(o) as { percent: number; durationMonths: number })?.percent === 0 && (decisionOf(o) as { durationMonths: number }).durationMonths === 6],
      ["Move to Lausanne with rent of 2'400", "en", (o) => (decisionOf(o) as { canton: string; rentMonth: number })?.canton === "VD" && (decisionOf(o) as { rentMonth: number }).rentMonth === 2400],
      ["Go freelance earning 7000 a month", "en", (o) => decisionOf(o)?.kind === "selfEmployed" && (decisionOf(o) as { netIncomeMonth: number }).netIncomeMonth === 7000],
      ["I inherit 200k in 2030", "en", (o) => has(o, { type: "income", amount: 200_000, month: 44 })],
      ["Buy a boat for 50k in 2030", "en", (o) => has(o, { type: "expense", amount: 50_000, month: 44 }) && !decisionOf(o)],
      ["Replace the oil heating with a heat pump in 2029", "en", (o) => has(o, { type: "expense", amount: 43_000 })],
      ["Full-time master's in 2027", "en", (o) => (decisionOf(o) as { workloadPct: number })?.workloadPct === 0],
      ["Auto leasen für 450 pro Monat", "de", (o) => (decisionOf(o) as { leaseMonthly: number })?.leaseMonthly === 450],
      ["Pensum auf 60% reduzieren", "de", (o) => (decisionOf(o) as { percent: number })?.percent === 60],
      ["Umzug nach Basel mit Miete 2'300", "de", (o) => (decisionOf(o) as { canton: string })?.canton === "BS" && (decisionOf(o) as { rentMonth: number }).rentMonth === 2300],
      ["Ich mache mich selbständig", "de", (o) => decisionOf(o)?.kind === "selfEmployed"],
      ["Wir erben 2031 150'000", "de", (o) => has(o, { type: "income", amount: 150_000 })],
      ["Nous aurons un enfant en 2029, il fera un apprentissage", "fr", (o) => (decisionOf(o) as { tertiaryTrack?: string })?.tertiaryTrack === "apprenticeship" && has(o, { month: 32 })],
      ["Déménager à Genève avec un loyer de 2'800", "fr", (o) => (decisionOf(o) as { canton: string })?.canton === "GE" && (decisionOf(o) as { rentMonth: number }).rentMonth === 2800],
      ["Prendre un congé sabbatique pendant 6 mois", "fr", (o) => (decisionOf(o) as { percent: number })?.percent === 0],
      ["Çocuğum ETH'da okursa", "tr", (o) => (decisionOf(o) as { tertiaryTrack: string })?.tertiaryTrack === "university"],
      ["Serbest çalışmaya başlasam", "tr", (o) => decisionOf(o)?.kind === "selfEmployed"],
      ["2030'da 200 bin miras kalırsa", "tr", (o) => has(o, { type: "income", amount: 200_000 })],
      ["Recession scenario", "en", (o) => o?.length === 1 && has(o, { key: "economy", value: "recession" })],
      ["What if interest rates rise?", "en", (o) => has(o, { key: "economy", value: "high_inflation" })],
    ];
    const bad = more.filter(([text, locale, ok]) => !ok(parse(text, locale, []))).map(([text, locale]) => `${locale} “${text}” → ${JSON.stringify(parse(text, locale, []))}`);
    check(`${more.length} further sentences (lease price, GA, track, sabbatical, rent, freelance, inheritance, purchase, heat pump, economy)`, bad.length === 0, bad.join(" | "));
    const s = applyScenarioOps(baseScenario(TEST_PROFILE), parse("high inflation scenario", "en", []) ?? []);
    check("the economy op sets the scenario's economy, and the simulation uses it", s.economy === "high_inflation" && simulate({ ...simInputFor(TEST_PROFILE, s), paths: 20 }).economy === "high_inflation");
  });
}

function part6() {
  section("Round 2 — personas, crash monotonicity, car loan, missing inputs, GA lever");
  const p = TEST_PROFILE;
  const [barlas, meric, oktay] = PROFILES;

  guard(() => {
    // A crash can only lower the outcome on the same futures: odds, median and the whole cone.
    const bad: string[] = [];
    for (const who of PROFILES) {
      const s = baseScenario(who);
      for (const behavior of [undefined, analyzeBehavior(who).params]) {
        const base = simulate(simInputFor(who, s, behavior));
        for (const month of [1, 12, 60]) {
          const crashed = simulate(simInputFor(who, { ...s, events: [...s.events, ev({ type: "crash", month })] }, behavior));
          const coneUp = crashed.bands.some((b, y) => y * 12 > month && b.p50 > base.bands[y].p50 + 1e-6);
          if (crashed.successProb > base.successProb || crashed.medianAtGoal > base.medianAtGoal + 1e-6 || coneUp) bad.push(`${who.name} m${month} ${behavior ? "real" : "ideal"}: ${base.successProb} → ${crashed.successProb}`);
        }
      }
    }
    check("a market crash never raises the goal odds, the median or the cone (3 accounts × real/ideal × 3 dates)", bad.length === 0, bad.join(" | "));
    const s0 = baseScenario(barlas);
    const b = analyzeBehavior(barlas).params;
    const s1 = applyScenarioOps(s0, localParseCommand("Market crash next year", s0.events, NOW, "en") ?? []);
    const before = simulate(simInputFor(barlas, s0, b)).successProb;
    const after = simulate(simInputFor(barlas, s1, b)).successProb;
    check("“Market crash next year” does not raise Barlas's odds", s1.events.some((e) => e.type === "crash") && after <= before, `${before} → ${after}`);
  });

  guard(() => {
    check("built-in accounts use their own health premium (318 / 428 / 372), labelled derived", barlas.healthPremiumMonth === 318 && meric.healthPremiumMonth === 428 && oktay.healthPremiumMonth === 372 && barlas.provenance?.healthPremiumMonth === "derived");
    const own = simulate({ profile: barlas, events: [], paths: 20, detail: true }).detail!.lines.find((l) => l.id === "health")!;
    const { healthPremiumMonth: _own, ...noPremium } = barlas;
    void _own;
    const avg = simulate({ profile: noPremium, events: [], paths: 20, detail: true }).detail!.lines.find((l) => l.id === "health")!;
    check("the twin budgets the person's premium when it has one, the canton's mean otherwise", near(own.monthly[0], 318, 1) && own.provenance === "derived" && near(avg.monthly[0], 459, 1) && avg.provenance === "doppel_default", `${Math.round(own.monthly[0])} vs ${Math.round(avg.monthly[0])}`);
    const odds = PROFILES.map((who) => simulate(simInputFor(who, baseScenario(who), analyzeBehavior(who).params)).successProb);
    check("the three accounts keep their roles: on track, borderline, off track", odds[0] >= 0.8 && odds[1] > 0.4 && odds[1] < 0.7 && odds[2] < 0.1, odds.join(" / "));
  });

  guard(() => {
    const months = 720;
    const car = decision("car", 12, { kind: "car", mode: "owned", price: 36_000, financed: true, downPayment: 6000, loanRate: 0.06, loanTermMonths: 48 });
    const plan = compileLife(p, [car], months, 420);
    const loan = plan.loans[0];
    // Annuity: 30,000 × r / (1 − (1 + r)^−48), r = 0.005 → CHF 704.55.
    check("car loan: down payment, 48 annuity instalments, interest = instalments − principal", plan.oneOffs[0].amount === -6000 && near(loan.payment, 704.55, 0.01) && near(loan.interest, 704.55 * 48 - 30_000, 0.5) && near(loan.balance[12 + 47], 0, 0.01) && loan.balance[12] < 30_000 && loan.balance[12] > 29_000, `payment ${loan.payment.toFixed(2)} · interest ${Math.round(loan.interest)}`);
    const l = lineOf(plan, "car:loan");
    check("car loan: the instalment is a nominal contract and a debt obligation", l.fixedFrom === 12 && l.obligation === true && near(l.monthly[12], 704.55, 0.01) && l.monthly[60] === 0 && lineOf(compileLife(p, [decision("c", 0, { kind: "car", mode: "leased" })], months, 420), "c:lease").obligation === true);
    const cash = simulate({ profile: p, events: [decision("car", 12, { kind: "car", mode: "owned", price: 36_000 })], paths: 200, detail: true });
    const fin = simulate({ profile: p, events: [car], paths: 200, detail: true });
    const line = fin.detail!.lines.find((x) => x.id === "car:loan")!;
    check("car loan: fixed in nominal CHF, so it shrinks in today's CHF", line.monthly[13] > line.monthly[58] && near(line.monthly[58] / line.monthly[13], 1 / Math.pow(1.012, 45 / 12), 1e-3));
    check("car loan: net worth carries the balance (≈ cash purchase in year 2, lower after the interest is paid)", Math.abs(fin.bands[2].p50 - cash.bands[2].p50) < 2500 && fin.bands[6].p50 < cash.bands[6].p50, `year 2: ${Math.round(fin.bands[2].p50)} vs ${Math.round(cash.bands[2].p50)} · year 6: ${Math.round(fin.bands[6].p50)} vs ${Math.round(cash.bands[6].p50)}`);
    const house = ev({ type: "house", month: 24, amount: 600_000 });
    const rich: Profile = { ...p, cash: 300_000 };
    const withLoan = simulate({ profile: rich, events: [house, car], paths: 100 }).house!;
    const without = simulate({ profile: rich, events: [house], paths: 100 }).house!;
    check("car loan and leasing count in the bank's affordability test", withLoan.medianOtherDebtYear! > 8000 && without.medianOtherDebtYear === undefined, `other debt CHF ${Math.round(withLoan.medianOtherDebtYear ?? 0)}/yr`);
    const acct: Profile = { ...p, cash: 300_000, portfolio: 0, investShare: 0 };
    const r = simulate({ profile: acct, events: [car], paths: 1, accounting: true, trace: true, detail: true });
    let worst = 0;
    for (let m = 1; m < 200; m++) {
      let flow = 0;
      for (const x of r.detail!.lines) if (!x.info) flow += (x.flow === "income" ? 1 : -1) * x.monthly[m];
      for (const o of r.detail!.oneOffs) if (o.month === m) flow += o.amount;
      worst = Math.max(worst, Math.abs(r.trace!.cash[m] - r.trace!.cash[m - 1] - flow));
    }
    check("car loan: the itemised budget still equals the simulated cash flow", worst < 0.01, `largest gap CHF ${worst.toFixed(4)}`);
  });

  guard(() => {
    const s0 = baseScenario(p);
    const marry: Op[] = validateOps([{ op: "add", type: "income", label: "Marriage", month: 12, decision: { kind: "partner", married: true } }], []);
    const blocked = applyScenarioOpsChecked(s0, marry, p);
    check("a decision with missing figures is not applied: state needsInput, scenario unchanged", blocked.state === "needsInput" && blocked.scenario === s0 && blocked.needsInput.length === 4 && blocked.pending!.events.length === 1);
    const o = outlook(p, blocked.pending!, { now: NOW, paths: 100 });
    check("outlook reports the state and which decision lacks which figures", o.state === "needsInput" && o.needsInput.length === 1 && o.needsInput[0].fields.length === 4 && o.decisions.find((d) => d.isNew)!.inputsNeeded.length === 4);
    const id = blocked.pending!.events[0].id;
    const filled = updateDecision(blocked.pending!.events, id, { netIncomeMonth: 5000, expensesMonth: 1500, rentMonth: 2400, taxDeltaYear: 0 });
    check("updateDecision() completes the decision; then it applies", inputsNeededFor(p, filled).length === 0 && outlook(p, { ...blocked.pending!, events: filled }, { now: NOW, paths: 100 }).state === "ok" && updateDecision(filled, id, { netIncomeMonth: -5 }) === filled);
    const car: Op[] = validateOps([{ op: "add", type: "expense", label: "Car", month: 6, decision: { kind: "car", mode: "owned", financed: true } }], []);
    const loan = applyScenarioOpsChecked(s0, car, p);
    check("a financed car without an interest rate asks for it; a complete decision applies", loan.state === "needsInput" && loan.needsInput[0].field === "loanRate" && applyScenarioOpsChecked(s0, validateOps([{ op: "add", type: "child", label: "Baby", month: 6, decision: { kind: "child" } }], []), p).state === "applied");
  });

  guard(() => {
    const who: Profile = { ...p, portfolio: 20_000, goal: { ...p.goal, target: 320_000 } };
    const s: Scenario = { ...baseScenario(who), events: [decision("car", 6, { kind: "car", mode: "leased", leaseMonthly: 600 })] };
    const sol = solveGoal(simInputFor(who, s));
    const lever = sol.carToGa;
    const applied = lever ? simulate(simInputFor(who, applyCarToGa(s, lever))).successProb : NaN;
    check("solver: “GA instead of the car” is offered when a car keeps the plan off track, and lands on its odds", sol.baseProb < 0.8 && !!lever && lever.newProb > sol.baseProb && applied === lever.newProb && lever.events[0].decision?.kind === "car" && (lever.events[0].decision as { mode: string }).mode === "ga" && near(lever.gaMonthly, 341.25, 0.01), lever ? `${sol.baseProb} → ${lever.newProb} · car CHF ${Math.round(lever.carMonthly)}/mo vs GA ${Math.round(lever.gaMonthly)}` : `base ${sol.baseProb}`);
    check("solver: no car, no lever", solveGoal(simInputFor(who, baseScenario(who))).carToGa === undefined);
  });

  guard(() => {
    check("Turkish: a large purchase with a price in the dative", has(parse("2030'da 50 bine tekne alsam", "tr", []), { type: "expense", amount: 50_000, month: 44 }) && has(parse("Mutfağı 30.000'e yenilemek için satın alsam", "tr", []), { type: "expense", amount: 30_000 }));
    check("Turkish: a sentence without a price is not a purchase", parse("kredi alsam", "tr", []) === null);
  });
}

const decisionOf = (ops: Op[] | null): Decision | undefined => (ops?.find((o) => o.op === "add" && o.decision) as Extract<Op, { op: "add" }> | undefined)?.decision;

function main() {
  // Built-in accounts still simulate (smoke).
  for (const p of PROFILES) simulate({ profile: p, events: p.events, paths: 20 });
  part1();
  part2();
  part3();
  part4();
  part5();
  part6();
  if (failed) {
    console.error(`\n${failed} regression check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll regression checks passed");
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
