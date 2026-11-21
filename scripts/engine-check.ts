/** Quick sanity run of the deterministic engine: `npx tsx scripts/engine-check.ts` */
import { PROFILES } from "@/lib/data/profiles";
import { simulate } from "@/lib/finance/monteCarlo";
import { analyzeBehavior } from "@/lib/finance/behavioralEngine";
import { solveGoal } from "@/lib/finance/goalSolver";
import { checkAffordability, projectedGross, projectedHardEquity } from "@/lib/finance/swissRules";

for (const p of PROFILES) {
  const b = analyzeBehavior(p);
  const ideal = simulate({ profile: p, events: p.events });
  const real = simulate({ profile: p, events: p.events, behavior: b.params });
  console.log(`\n== ${p.name} ==`);
  console.log("behavior", b.params, "spike", b.paydaySpike.toFixed(2), b.insights.map((i) => i.title));
  console.log(`ideal  prob ${(ideal.successProb * 100).toFixed(1)}% median@goal ${Math.round(ideal.medianAtGoal)} crunch ${ideal.crunchProb} ${ideal.ms.toFixed(1)}ms`);
  console.log(`real   prob ${(real.successProb * 100).toFixed(1)}% median@goal ${Math.round(real.medianAtGoal)} crunch ${real.crunchProb} ${real.ms.toFixed(1)}ms`);
  const h = p.events.find((e) => e.type === "house");
  if (h) {
    const a = checkAffordability({ price: h.amount, grossIncomeYear: projectedGross(p.grossIncomeYear, h.month), hardEquityAvailable: projectedHardEquity(p, h.month), pillar2Available: p.pillar2 });
    console.log("affordability", { pass: a.pass, ratio: a.costToIncome.toFixed(3), equityGap: a.equityGap, incomeGap: Math.round(a.incomeGap), maxPrice: a.maxPrice });
  }
  const t = Date.now();
  console.log("recipes", solveGoal(p, p.events, b.params, { expenseDelta: 0, optimize: false }).map((r) => `${r.title} -> ${(r.newProb * 100).toFixed(0)}%`), `${Date.now() - t}ms`);
}
