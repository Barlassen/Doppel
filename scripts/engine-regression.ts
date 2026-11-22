/**
 * Regression checks for the engine audit (2026-11-22) and the features built on top of it:
 * `npx tsx scripts/engine-regression.ts`. Every check failed before its fix and passes after.
 * Exits 1 when any check fails.
 */
import { PROFILES } from "@/lib/data/profiles";
import { simulate } from "@/lib/finance/monteCarlo";
import { tragbarkeit } from "@/lib/finance/swissRules";
import type { LifeEvent, Profile } from "@/lib/finance/types";
import { applyScenarioOps, localParseCommand, validateOps, type Op } from "@/lib/twin/actions";
import { baseScenario } from "@/lib/finance/scenario";
import type { Locale } from "@/lib/i18n/types";

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

function main() {
  // Built-in accounts still simulate (smoke).
  for (const p of PROFILES) simulate({ profile: p, events: p.events, paths: 20 });
  part1();
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
