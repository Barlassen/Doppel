/** Sanity run of the deterministic engine: `npx tsx scripts/engine-check.ts` */
import { PROFILES, PROFILE_WITH_HOME } from "@/lib/data/profiles";
import { simulate } from "@/lib/finance/monteCarlo";
import { analyzeBehavior } from "@/lib/finance/behavioralEngine";
import { deriveInvestBehavior, monthlySpend } from "@/lib/finance/investBehavior";
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

const netWorth = (p: Profile) => p.cash + p.portfolio + p.pillar2 + p.pillar3a;

/** Who the account is and what its data says (balances, derived behaviour inputs). */
function persona(p: Profile) {
  const b = analyzeBehavior(p);
  const inv = deriveInvestBehavior(p);
  const spend = monthlySpend(p.transactions);
  console.log(`\n##### ${p.name}, ${p.age}, ${p.city} (${p.canton}) · ${english(p.tagline)}`);
  console.log(
    `  income gross ${k(p.grossIncomeYear)}/yr · take-home ${k(p.netIncomeMonth)}/mo · marginal tax ${pc(p.marginalTaxRate)} · spending ${k(p.expensesMonth)}/mo (rent ${k(p.rentMonth)}) · risk ${p.riskProfile} · retire ${p.retirementAge}`,
  );
  console.log(
    `  balances cash ${k(p.cash)} · portfolio ${k(p.portfolio)} · pillar 2 ${k(p.pillar2)} · pillar 3a ${k(p.pillar3a)} → net worth ${k(netWorth(p))}`,
  );
  console.log(`  goal: ${english(p.goal.label)} · events: ${p.events.map((e) => `${e.label} (m${e.month}, ${k(e.amount)})`).join(", ") || "none"}`);
  console.log(
    `  data: ${p.transactions.length} transactions over ${spend.months} months, ${p.trades.length} trades → investShare ${pc(p.investShare)} · 3a ${p.contributes3a ? "yes" : "no"} · sold in drawdown ${p.history.soldInDrawdown ? pc(p.history.drawdownSellPct) : "no"}${inv.dip ? ` · bought the dip ${k(inv.dip.amount)}` : ""}${inv.chase ? ` · chased ${inv.chase.instrument} (−${pc(inv.chase.drop)})` : ""}`,
  );
  console.log(
    `  spending habits: payday spike ×${b.paydaySpike.toFixed(2)} · discretionary ${pc(b.discretionaryShare)} · ${b.subscriptions.length} subscriptions (${k(b.subscriptions.reduce((s, x) => s + x.monthly, 0))}/mo)`,
  );
  console.log(`  insights: ${b.insights.map((i) => english(i.title)).join(" | ")}`);
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
  return { real, ideal, b, sol };
}

const [barlas] = PROFILES;
const home = PROFILE_WITH_HOME;
const summary: string[] = [];

for (const p of PROFILES) {
  persona(p);
  const { real, ideal, b, sol } = report(p, baseScenario(p), `${p.name} — base`);
  const top = sol.recipes[0];
  summary.push(
    `| ${p.name} | ${p.age} | ${p.city} | ${k(netWorth(p))} | ${pc(p.investShare)} | ${p.history.soldInDrawdown ? pc(p.history.drawdownSellPct) : "–"} | ${pc(b.discretionaryShare)} | ${b.subscriptions.length} | ×${b.paydaySpike.toFixed(2)} | ${pc(real.successProb)} / ${pc(ideal.successProb)} | ${pc(real.crunchProb)} | ${top ? `${english(top.title)} → ${pc(top.newProb)}` : "none (on track)"} |`,
  );
}

console.log("\n=== Persona summary ===");
console.log("| Account | Age | City | Net worth | investShare | Sold in drawdown | Discretionary | Subs | Payday spike | Goal odds real / disciplined | Crunch | Top recipe |");
console.log("|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const row of summary) console.log(row);

// --- 940k Zürich listing snap (sample) for the account with a planned home ---
{
  const s0 = baseScenario(home);
  const before = headline(home, s0).real.successProb;
  const u = extractionToUpdate({ kind: "listing", amount: 940_000, rooms: 4.5, location: "Zürich" }, s0.events);
  if (u.kind !== "event") throw new Error("listing should be an event");
  const s1 = applyScenarioOps(s0, validateOps(u.ops, s0.events), "snap");
  console.log(`\n${english(u.summary)}`);
  const { real } = report(home, s1, `${home.name} — after snapping the 940k Zürich listing`);
  console.log(`  odds ${pc(before)} → ${pc(real.successProb)}`);
}

// --- sample payslip (Nettolohn CHF 8,650, before tax) for the first account ---
{
  const s0 = baseScenario(barlas);
  const before = headline(barlas, s0).real.successProb;
  const u = extractionToUpdate({ kind: "payslip", amount: 8_650 }, s0.events, new Date(), {
    marginalTaxRate: barlas.marginalTaxRate,
    income: { grossIncomeYear: barlas.grossIncomeYear, netIncomeMonth: barlas.netIncomeMonth },
  });
  if (u.kind !== "income") throw new Error("payslip should be income");
  const s1: Scenario = { ...s0, income: { grossIncomeYear: u.grossIncomeYear, netIncomeMonth: u.netIncomeMonth, label: "payslip" } };
  const after = headline(barlas, s1).real.successProb;
  console.log(`\n=== Payslip snap, Nettolohn CHF 8,650 (${barlas.name}) ===\n  ${english(u.summary)}`);
  console.log(`  profile before: gross ${k(barlas.grossIncomeYear)}/yr, take-home ${k(barlas.netIncomeMonth)}/mo → after: gross ${k(u.grossIncomeYear)}/yr, take-home ${k(u.netIncomeMonth)}/mo`);
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

// --- Retirement age what-ifs ---
for (const p of PROFILES) {
  const s0 = baseScenario(p);
  const parts: string[] = [];
  for (const age of [60, 63, 65]) {
    const s = applyScenarioOps(s0, validateOps([{ op: "set", key: "retirementAge", value: age }], s0.events));
    const { real } = headline(p, s);
    parts.push(`${age}: goal ${pc(real.successProb)}, lasts to 90 ${pc(real.retirement!.lastsTo90Prob)}, P10 depletion ${real.retirement!.depletionAgeP10 ?? ">90"}`);
  }
  console.log(`  ${p.name} retire at ${parts.join(" · ")}`);
}

// --- local intent parser (0 tokens) ---
console.log(`\n=== Local parser (events of ${home.name}) ===`);
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
  console.log(`  “${t}” → ${JSON.stringify(localParseCommand(t, home.events), (key, value) => key === "labelMsg" ? undefined : value)}`);
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
      home.events,
    ),
  )}`,
);
