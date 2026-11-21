/** Sanity run of the deterministic engine: `npx tsx scripts/engine-check.ts` */
import { PROFILES } from "@/lib/data/profiles";
import { simulate } from "@/lib/finance/monteCarlo";
import { analyzeBehavior } from "@/lib/finance/behavioralEngine";
import { solveGoal, type Recipe } from "@/lib/finance/goalSolver";
import { checkAffordability } from "@/lib/finance/swissRules";
import { baseScenario, costOfWaiting, effectiveProfile, habitCosts, simInputFor } from "@/lib/finance/scenario";
import type { Profile, Scenario, SimResult } from "@/lib/finance/types";
import { applyScenarioOps, extractionToUpdate, localParseCommand, validateOps } from "@/lib/twin/actions";

import { translateText, type Text } from "@/lib/i18n";
const english = (value: Text) => translateText("en", value);

const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
const k = (x: number) => `CHF ${Math.round(x).toLocaleString("en")}`;

/** Exactly what the app computes for a scenario (headline = real twin, seed 42, 1,000 paths, to age 90). */
function headline(p: Profile, s: Scenario) {
  const b = analyzeBehavior(effectiveProfile(p, s), s.extraTx);
  return { b, ideal: simulate(simInputFor(p, s)), real: simulate(simInputFor(p, s, b.params)) };
}

function card(r: SimResult) {
  const h = r.house;
  if (!h) return null;
  return checkAffordability({
    price: h.price,
    grossIncomeYear: h.grossAtPurchase,
    hardEquityAvailable: h.medianHardEquity,
    pillar2Available: h.medianPillar2,
    closingRate: h.closingRate,
  });
}

/** Same patch as DoppelApp.applyRecipe. */
function applyRecipe(s: Scenario, r: Recipe): Scenario {
  const a = r.apply;
  if (a.kind === "expenseDelta") return { ...s, expenseDelta: a.value };
  if (a.kind === "optimize") return { ...s, optimize: true };
  const shifted = applyScenarioOps(s, [{ op: "shift", id: a.eventId, months: a.months }], "solver");
  return a.kind === "combo" ? { ...shifted, expenseDelta: a.expenseDelta } : shifted;
}

function report(p: Profile, s: Scenario, title: string) {
  const { b, ideal, real } = headline(p, s);
  console.log(`\n=== ${title} ===`);
  console.log(`  goal: ${english(p.goal.label)} · retire at ${effectiveProfile(p, s).retirementAge}`);
  console.log(`  disciplined ${pc(ideal.successProb)} · real (headline) ${pc(real.successProb)} · crunch ${pc(real.crunchProb)} · median@goal ${k(real.medianAtGoal)} · ${real.ms.toFixed(0)} ms`);
  const input = simInputFor(p, s, b.params);
  const hc = habitCosts(input);
  console.log(`  leakage ${(b.params.leakageRate * 100).toFixed(1)}% ≈ ${k(b.leakageChfMonth)}/mo · panic p=${b.params.panicSellProb.toFixed(2)} sells ${pc(b.params.panicSellShare)}`);
  if (hc) console.log(`  per-habit cost: payday/impulse spending −${hc.leakagePp.toFixed(1)} pp · panic selling −${hc.panicPp.toFixed(1)} pp`);
  const r = real.retirement;
  if (r)
    console.log(
      `  retirement @${r.age}: lasts to 90 ${pc(r.lastsTo90Prob)} · P10 depletion age ${r.depletionAgeP10 ?? "none (>90)"} · income ${k(r.monthlyIncomeAtRetirement)}/mo (AHV ${k(r.ahvMonthly)} + BVG ${k(r.bvgMonthly)}) · spending ${k(r.monthlySpending)}/mo · replacement ${pc(r.replacementRatio)} · savings@ret ${k(r.medianLiquidAtRetirement)} · bridge ${r.bridgeYears} yrs`,
    );
  const c = card(real);
  if (c && real.house)
    console.log(
      `  home ${real.house.label} ${k(real.house.price)}: card ${c.pass ? "PASS" : "FAIL"} ${pc(c.costToIncome)} of income · equity ${k(c.equityUsed)} · max price at purchase ${k(c.maxPrice)} · sim bought in ${pc(real.house.boughtProb)} of futures`,
    );
  const w = costOfWaiting(input);
  if (w) console.log(`  cost of waiting: ${w.map((x) => `${english(x.label)} ${pc(x.prob)}`).join(" · ")}`);
  const sol = solveGoal(input, { spendTip: b.spendTip });
  console.log(`  solver baseProb ${pc(sol.baseProb)} (== headline: ${sol.baseProb === real.successProb}) · ${sol.ms.toFixed(0)} ms`);
  for (const rec of sol.recipes) {
    const after = headline(p, applyRecipe(s, rec)).real.successProb;
    console.log(`    • ${english(rec.title)} → ${rec.reaches ? "" : "improves to "}${pc(rec.newProb)} · applied headline ${pc(after)} ${after === rec.newProb ? "✓ consistent" : "✗ MISMATCH"}`);
  }
  if (sol.recipes.length === 0) console.log(`    (no recipes${sol.baseProb >= 0.8 ? " — on track" : ""})`);
  return { real, b };
}

const [lukas, elena] = PROFILES;

for (const p of PROFILES) report(p, baseScenario(p), `${p.name} — base`);

// --- 940k Zürich listing snap (sample) for Lukas ---
{
  const s0 = baseScenario(lukas);
  const before = headline(lukas, s0).real.successProb;
  const u = extractionToUpdate({ kind: "listing", amount: 940_000, rooms: 4.5, location: "Zürich" }, s0.events);
  if (u.kind !== "event") throw new Error("listing should be an event");
  const s1 = applyScenarioOps(s0, validateOps(u.ops, s0.events), "snap");
  console.log(`\n${english(u.summary)}`);
  const { real } = report(lukas, s1, "Lukas — after snapping the 940k Zürich listing");
  console.log(`  odds ${pc(before)} → ${pc(real.successProb)}`);
}

// --- payslip 10,300 (Nettolohn, before tax) for Lukas ---
{
  const s0 = baseScenario(lukas);
  const before = headline(lukas, s0).real.successProb;
  const u = extractionToUpdate({ kind: "payslip", amount: 10_300 }, s0.events, new Date(), {
    marginalTaxRate: lukas.marginalTaxRate,
    income: { grossIncomeYear: lukas.grossIncomeYear, netIncomeMonth: lukas.netIncomeMonth },
  });
  if (u.kind !== "income") throw new Error("payslip should be income");
  const s1: Scenario = { ...s0, income: { grossIncomeYear: u.grossIncomeYear, netIncomeMonth: u.netIncomeMonth, label: "payslip" } };
  const after = headline(lukas, s1).real.successProb;
  console.log(`\n=== Payslip snap, Nettolohn CHF 10,300 (Lukas) ===\n  ${english(u.summary)}`);
  console.log(`  profile before: gross ${k(lukas.grossIncomeYear)}/yr, take-home ${k(lukas.netIncomeMonth)}/mo → after: gross ${k(u.grossIncomeYear)}/yr, take-home ${k(u.netIncomeMonth)}/mo`);
  console.log(`  odds ${pc(before)} → ${pc(after)}`);
}

// --- QR-bill premium (sample: CHF 412 "Prämie Dezember 2026") ---
for (const p of PROFILES) {
  const s0 = baseScenario(p);
  const before = headline(p, s0).real.successProb;
  const u = extractionToUpdate(
    { kind: "bill", amount: 412, merchant: "Limmat Krankenkasse AG", category: "insurance", label: "Prämie Dezember 2026", message: "Prämie Dezember 2026" },
    s0.events,
    new Date(),
    { transactions: p.transactions, recurring: s0.recurring, marginalTaxRate: p.marginalTaxRate },
  );
  const s1 = u.kind === "recurring" ? { ...s0, recurring: [...s0.recurring, u.expense] } : s0;
  console.log(`\n=== QR-bill premium snap (${p.name}) ===\n  ${english(u.summary)}\n  odds ${pc(before)} → ${pc(headline(p, s1).real.successProb)}`);
}

// --- Elena: what if she retires later? ---
{
  const s0 = baseScenario(elena);
  for (const age of [58, 60, 62, 65]) {
    const s = applyScenarioOps(s0, validateOps([{ op: "set", key: "retirementAge", value: age }], s0.events));
    const { real } = headline(elena, s);
    console.log(`  Elena retire at ${age}: goal ${pc(real.successProb)} · lasts to 90 ${pc(real.retirement!.lastsTo90Prob)} · P10 depletion ${real.retirement!.depletionAgeP10 ?? ">90"}`);
  }
}

// --- local intent parser (0 tokens) ---
console.log("\n=== Local parser ===");
for (const t of [
  "retire at 60",
  "start investing 500 a month",
  "invest CHF 1'000 per month",
  "switch to growth",
  "go conservative",
  "cut spending by 400",
  "spend 300 less",
  "max out 3a",
  "start 3a",
  "stop paying into 3a",
  "What if I lose my job for 6 months in 2028?",
  "Delay the flat by 2 years",
  "buy a flat in Bern for 1.2m",
  "buy a castle for 50m",
]) {
  console.log(`  “${t}” → ${JSON.stringify(localParseCommand(t, lukas.events), (key, value) => key === "labelMsg" ? undefined : value)}`);
}
console.log(
  `  validateOps rejects junk: ${JSON.stringify(
    validateOps(
      [
        { op: "set", key: "retirementAge", value: 40 },
        { op: "set", key: "riskProfile", value: "yolo" },
        { op: "add", type: "house", label: "x", month: 9999, amount: 1e6 },
        { op: "shift", id: "nope", months: 6 },
        { op: "set", key: "monthlyInvest", value: "500" },
      ],
      lukas.events,
    ),
  )}`,
);
