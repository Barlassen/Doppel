/**
 * Validation of the UBS synthetic-data integration: npx tsx scripts/ubs-check.ts  (npm run ubs:check)
 *
 *  1. all 1'200 profiles load and map to a Doppel Profile without NaN; the summary matches the details
 *  2. net worth = assets − liabilities (profile, summary, and the simulator's month 0 in every future)
 *  3. loan amortisation: balance 0 at the term, interest + principal = payments, the engine's debt = the schedule
 *  4. Alexia's three paths: the engine (accounting mode) reproduces the cash path of scenario_config.json
 *  5. multiple goals: odds in [0, 1], the primary goal equals the headline, odds fall as the target rises
 *  6. derivations: gross ↔ take-home round trip, retirees' month-0 pension = the UBS income, debt in the bank test
 *  7. the solver's debt lever lands on its advertised odds
 *  8. the built-in accounts are bit-identical to the fingerprint taken before these changes
 */
import { readFileSync, writeFileSync } from "node:fs";
import { takeHomeMonth } from "../src/lib/data/profiles";
import { analyzeBehavior } from "../src/lib/finance/behavioralEngine";
import { debtSchedule, netWorthOf, totalDebt } from "../src/lib/finance/debt";
import { solveGoal } from "../src/lib/finance/goalSolver";
import { simulate } from "../src/lib/finance/monteCarlo";
import { ahvMonthly, bvgConversionRate, effectiveTaxRate, RETIREMENT_TAX_FACTOR } from "../src/lib/finance/pension";
import { baseScenario, effectiveProfile, HEADLINE, simInputFor } from "../src/lib/finance/scenario";
import { maxAffordablePrice, tragbarkeit } from "../src/lib/finance/swissRules";
import type { Profile, Scenario } from "../src/lib/finance/types";
import { ALEXIA_ID, alexiaPaths, listUbsProfiles, loadUbsProfile, loadUbsRaw, ubsAssumptions, ubsScenarioCatalog } from "../src/lib/ubs";
import { ALEXIA_PATH_IDS, alexiaLedger, applyPath, pathOneOffs } from "../src/lib/ubs/alexia";
import { GOLDEN_PATH, personaFingerprint } from "./fixtures/persona-fingerprint";

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error("  ✗ " + msg);
};
const ok = (msg: string) => console.log("  ✓ " + msg);
const k = (x: number) => `CHF ${Math.round(x).toLocaleString("en")}`;
const pc = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Every number reachable from `v` is finite (NaN / Infinity anywhere is a failure). */
function nonFinite(v: unknown, path = ""): string[] {
  if (typeof v === "number") return Number.isFinite(v) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => nonFinite(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([key, x]) => nonFinite(x, path ? `${path}.${key}` : key));
  return [];
}

/** Relative tolerance for the fingerprint on other platforms: far below a rappen on any figure, far above rounding noise. */
const GOLDEN_REL_TOL = 1e-12;

/** Same structure and same values; numbers may differ by `tol` relative. */
function sameWithin(a: unknown, b: unknown, tol: number): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b || Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && sameWithin((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol));
}

async function main() {
  const t0 = performance.now();
  const summaries = listUbsProfiles();

  // ---------------- 1. load + map ----------------
  console.log("\n1. Load and map every profile");
  const profiles: Profile[] = [];
  let loans = 0;
  let goals = 0;
  let mismatch = 0;
  for (const s of summaries) {
    const p = await loadUbsProfile(s.id);
    profiles.push(p);
    const bad = nonFinite(p);
    if (bad.length) fail(`${s.id}: non-finite ${bad.slice(0, 3).join(", ")}`);
    loans += p.liabilities?.length ?? 0;
    goals += p.goals?.length ?? 0;
    const raw = await loadUbsRaw(s.id);
    const ubsNet = raw.cashChf + raw.investmentsChf + raw.otherAssetsChf - raw.liabilities.reduce((x, l) => x + l.principalChf, 0);
    if (Math.abs(ubsNet - s.netWorthChf) > 0.01 || s.name !== p.name || s.age !== p.age || s.city !== p.city) mismatch++;
    if (!p.goals?.some((g) => g.primary) || p.goals.filter((g) => g.primary).length !== 1) fail(`${s.id}: needs exactly one primary goal`);
    if (p.provenance?.cash !== "ubs_synthetic" || p.provenance?.grossIncomeYear !== "derived" || p.provenance?.marginalTaxRate !== "doppel_default")
      fail(`${s.id}: provenance labels missing`);
  }
  if (summaries[0].id !== ALEXIA_ID) fail("Alexia must be the first summary row");
  if (profiles.length === 1200 && loans === 283 && goals === 1500) ok(`${profiles.length} profiles, ${loans} liabilities, ${goals} goals, no NaN`);
  else fail(`expected 1200 / 283 / 1500, got ${profiles.length} / ${loans} / ${goals}`);
  if (mismatch) fail(`${mismatch} summary rows differ from their details`);
  else ok("summary rows match the detail chunks (name, age, city, UBS net worth)");
  const catalog = ubsScenarioCatalog();
  const s001 = ubsAssumptions("S001");
  if (catalog.length === 120 && new Set(catalog.map((c) => c.category)).size === 12 && s001.length === 240) ok("catalog: 120 scenarios in 12 categories; S001: 240 assumptions");
  else fail(`catalog ${catalog.length}, categories ${new Set(catalog.map((c) => c.category)).size}, S001 rows ${s001.length}`);

  // ---------------- 2. net worth = assets − liabilities ----------------
  console.log("\n2. Net worth = assets − liabilities");
  let nwBad = 0;
  const withDebt = profiles.filter((p) => (p.liabilities?.length ?? 0) > 0);
  for (const p of profiles) {
    const assets = p.cash + p.portfolio + p.pillar2 + p.pillar3a;
    const debt = (p.liabilities ?? []).reduce((s, l) => s + l.principal, 0);
    if (Math.abs(netWorthOf(p) - (assets - debt)) > 1e-6) nwBad++;
  }
  for (const p of withDebt) {
    // Month 0 is the same in every future: the band at the starting age must equal today's net worth.
    const r = simulate({ profile: p, events: [], paths: 20, seed: 1 });
    const b0 = r.bands[0];
    if (Math.abs(b0.p10 - netWorthOf(p)) > 1e-6 || Math.abs(b0.p90 - netWorthOf(p)) > 1e-6) nwBad++;
  }
  if (nwBad) fail(`${nwBad} net-worth mismatches`);
  else ok(`netWorthOf() = cash + portfolio + pillar 2 + 3a − debt for all ${profiles.length}; simulator month 0 equals it for all ${withDebt.length} debt profiles`);

  // ---------------- 3. loan amortisation ----------------
  console.log("\n3. Loan amortisation (annuity)");
  let amBad = 0;
  let maxResidual = 0;
  let maxIdentity = 0;
  for (const p of withDebt) {
    for (const l of p.liabilities!) {
      const term = l.termMonths ?? 60;
      const s = debtSchedule([l], term + 12);
      const paid = s.payment.reduce((a, b) => a + b, 0);
      const interest = s.interest.reduce((a, b) => a + b, 0);
      const principal = s.principal.reduce((a, b) => a + b, 0);
      const residual = s.balance[term - 1];
      maxResidual = Math.max(maxResidual, Math.abs(residual));
      maxIdentity = Math.max(maxIdentity, Math.abs(interest + principal - paid), Math.abs(principal - l.principal));
      // Payments are rounded to cents, so the last payment absorbs < CHF 1 and the loan ends at the term.
      if (residual > 0.01 || s.debtFreeMonth !== term || s.balance[term - 2] <= 0) amBad++;
      if (Math.abs(interest + principal - paid) > 1e-6 || Math.abs(principal - l.principal) > 1e-6) amBad++;
    }
    // The simulator's debt is the same schedule (traced on path 0).
    const r = simulate({ profile: p, events: [], paths: 1, seed: 1, trace: true, horizon: "goal" });
    const s = debtSchedule(p.liabilities!, r.trace!.debt.length);
    if (r.trace!.debt.some((d, m) => Math.abs(d - s.balance[m]) > 1e-9)) amBad++;
  }
  // Extra payments shorten the term and cut interest.
  const sample = withDebt[0];
  const s0 = debtSchedule(sample.liabilities!, 600);
  const s1 = debtSchedule(sample.liabilities!, 600, 300);
  if (!(s1.debtFreeMonth! < s0.debtFreeMonth! && s1.interestPaid < s0.interestPaid)) amBad++;
  if (amBad) fail(`${amBad} amortisation failures`);
  else
    ok(
      `${loans} loans: balance 0 at the term (max residual CHF ${maxResidual.toFixed(4)}), interest + principal = payments (max error ${maxIdentity.toExponential(1)}), engine debt = schedule; CHF 300 extra on ${sample.id}: ${s0.debtFreeMonth} → ${s1.debtFreeMonth} months, interest ${k(s0.interestPaid)} → ${k(s1.interestPaid)}`,
    );

  // ---------------- 4. Alexia's three paths ----------------
  console.log("\n4. Alexia's paths vs scenario_config.json (120 months, accounting mode)");
  const alexia = profiles.find((p) => p.id === ALEXIA_ID)!;
  const paths = alexiaPaths();
  for (const [i, id] of ALEXIA_PATH_IDS.entries()) {
    for (const useS001 of [false, true]) {
      if (useS001 && id !== "master") continue;
      const s = applyPath(baseScenario(alexia), id, paths[i], useS001);
      const ledger = alexiaLedger(paths[i], alexia.cash, 120, pathOneOffs(id, paths[i], useS001));
      const r = simulate({ ...simInputFor(alexia, s), paths: 1, accounting: true, trace: true });
      const engine = r.trace!.cash.slice(0, 120);
      const err = Math.max(...engine.map((c, m) => Math.abs(c - ledger[m])));
      const label = `${paths[i].name}${useS001 ? " + S001 tuition" : ""}`;
      if (err > 0.005) fail(`${label}: engine cash differs from the ledger by up to CHF ${err.toFixed(2)}`);
      else {
        const neg = ledger.findIndex((c) => c < 0);
        ok(
          `${label.padEnd(28)} max |engine − ledger| = CHF ${err.toFixed(4)} · cash m24 ${k(ledger[23])} · m60 ${k(ledger[59])} · m120 ${k(ledger[119])}${neg >= 0 ? ` · negative from month ${neg + 1}` : ""}`,
        );
      }
    }
  }
  // And what the dashboard shows on the same paths (real twin, headline seed and paths).
  for (const [i, id] of ALEXIA_PATH_IDS.entries()) {
    const s = applyPath(baseScenario(alexia), id, paths[i], true);
    const b = analyzeBehavior(effectiveProfile(alexia, s), s.extraTx);
    const r = simulate(simInputFor(alexia, s, b.params));
    console.log(`    ${paths[i].name.padEnd(16)} headline ${pc(r.successProb)} · crunch ${pc(r.crunchProb)} · median net worth at 30 ${k(r.bands[10].p50)}`);
  }

  // ---------------- 5. multiple goals ----------------
  console.log("\n5. Multiple goals");
  let goalBad = 0;
  let checked = 0;
  const multi = profiles.filter((p) => (p.goals?.length ?? 0) > 1);
  const goalSample = [...profiles.filter((_, i) => i % 40 === 0), ...multi.filter((_, i) => i % 15 === 0)];
  for (const p of goalSample) {
    const s = baseScenario(p);
    const b = analyzeBehavior(effectiveProfile(p, s), s.extraTx);
    const r = simulate({ ...simInputFor(p, s, b.params), paths: 300 });
    const primary = p.goals!.find((g) => g.primary)!;
    for (const g of r.goals ?? []) if (!(g.prob >= 0 && g.prob <= 1)) goalBad++;
    if (r.goals?.find((g) => g.id === primary.id)?.prob !== r.successProb) goalBad++;
    // Monotonic: same futures (seed), higher target → odds never rise.
    for (const goal of p.goals!) {
      let prev = Infinity;
      for (const f of [0.25, 0.5, 1, 1.5, 2, 4]) {
        const q: Profile = { ...p, goals: p.goals!.map((x) => (x.id === goal.id ? { ...x, target: x.target * f } : x)) };
        const prob = simulate({ ...simInputFor(q, s, b.params), paths: 300 }).goals!.find((x) => x.id === goal.id)!.prob;
        if (prob > prev + 1e-12) goalBad++;
        prev = prob;
      }
      checked++;
    }
  }
  if (goalBad) fail(`${goalBad} goal-feasibility failures`);
  else ok(`${goalSample.length} profiles, ${checked} goals: odds in [0, 1], primary = headline, non-increasing over 6 target levels`);

  // ---------------- 6. derivations ----------------
  console.log("\n6. Derived fields");
  let roundTrip = 0;
  let pensionOk = 0;
  let pensionFloor = 0;
  let retirees = 0;
  for (const p of profiles) {
    if (p.origin?.employment === "retired") {
      retirees++;
      const retTax = effectiveTaxRate(p.marginalTaxRate) * RETIREMENT_TAX_FACTOR;
      const income = ((p.pillar2 * bvgConversionRate(p.retirementAge)) / 12 + ahvMonthly(p.grossIncomeYear)) * (1 - retTax);
      if (Math.abs(income - p.netIncomeMonth) <= 1) pensionOk++;
      else if (p.pillar2 === 0) pensionFloor++; // reported pension below the minimum AHV pension
      else fail(`${p.id}: month-0 pension ${income.toFixed(2)} ≠ UBS income ${p.netIncomeMonth}`);
      const r = simulate({ profile: p, events: [], paths: 1, accounting: true, trace: true, horizon: "goal" });
      // Month 0 cash change = pension − spending − loan payment.
      const debtPay = p.liabilities?.length ? debtSchedule(p.liabilities, 1).payment[0] : 0;
      const expected = p.cash + income - p.expensesMonth - debtPay;
      if (p.pillar2 > 0 && Math.abs(r.trace!.cash[0] - expected) > 1) fail(`${p.id}: engine month 0 cash ${r.trace!.cash[0].toFixed(2)} ≠ ${expected.toFixed(2)}`);
    } else if (Math.abs(takeHomeMonth(p.grossIncomeYear, p.marginalTaxRate) - p.netIncomeMonth) > 15) roundTrip++;
  }
  if (roundTrip) fail(`${roundTrip} profiles: take-home(gross) is more than CHF 15 from the UBS net income`);
  else ok(`gross ↔ take-home round trip within CHF 15 for all ${profiles.length - retirees} working-age profiles (gross rounded to CHF 100)`);
  ok(`${retirees} retirees: simulated month-0 pension = UBS income ±CHF 1 for ${pensionOk}; ${pensionFloor} report less than the minimum AHV pension (engine pays the minimum)`);
  // Exactly 20% equity, so the loan is the same with and without other debt and only the debt service differs.
  const plainPlan = tragbarkeit({ price: 800_000, grossIncomeYear: 150_000, hardEquityAvailable: 160_000, pillar2Available: 0 });
  const debtPlan = tragbarkeit({ price: 800_000, grossIncomeYear: 150_000, hardEquityAvailable: 160_000, pillar2Available: 0, otherDebtYear: 12_000 });
  const maxPlain = maxAffordablePrice(150_000, 160_000, 0);
  const maxDebt = maxAffordablePrice(150_000, 160_000, 0, 0, 12_000);
  if (
    plainPlan.loan === debtPlan.loan &&
    maxDebt < maxPlain &&
    Math.abs(debtPlan.costToIncome - plainPlan.costToIncome - 12_000 / 150_000) < 1e-12 &&
    debtPlan.otherDebtYear === 12_000
  )
    ok(`bank test: CHF 12k/yr loan payments add ${pc(12_000 / 150_000)} to cost/income (${pc(plainPlan.costToIncome)} → ${pc(debtPlan.costToIncome)}), max price ${k(maxPlain)} → ${k(maxDebt)}`);
  else fail("debt service does not reduce affordability");

  // ---------------- 7. solver debt lever ----------------
  console.log("\n7. Solver: pay down debt");
  let lever = 0;
  let leverChecked = 0;
  // Debt profiles below the 80% target (the solver only searches levers there).
  const offTrack = withDebt.filter((p) => {
    const s = baseScenario(p);
    return simulate({ ...simInputFor(p, s, analyzeBehavior(p).params), horizon: "goal" }).successProb < 0.8;
  });
  for (const p of offTrack.filter((_, i) => i % 3 === 0)) {
    const s: Scenario = baseScenario(p);
    const b = analyzeBehavior(effectiveProfile(p, s), s.extraTx);
    const sol = solveGoal(simInputFor(p, s, b.params), { spendTip: b.spendTip });
    const rec = sol.recipes.find((r) => r.id === "debt");
    leverChecked++;
    if (!rec || rec.apply.kind !== "debtExtra") continue;
    lever++;
    const next = { ...s, debtExtra: rec.apply.value };
    const after = simulate(simInputFor(p, next, analyzeBehavior(effectiveProfile(p, next), next.extraTx).params)).successProb;
    if (after !== rec.newProb) fail(`${p.id}: debt recipe says ${pc(rec.newProb)}, applied headline ${pc(after)}`);
    else console.log(`    ${p.id} ${p.name}: base ${pc(sol.baseProb)} → pay ${k(rec.apply.value)}/mo extra → ${pc(rec.newProb)} ✓ consistent`);
  }
  ok(`${lever} of ${leverChecked} sampled off-track debt profiles (of ${offTrack.length}) get a debt recipe; each lands on its advertised odds (${HEADLINE.paths} paths, seed ${HEADLINE.seed})`);

  // ---------------- 8. built-in accounts unchanged ----------------
  console.log("\n8. Built-in accounts (Barlas, Meriç, Oktay)");
  const now = JSON.stringify(personaFingerprint());
  // A deliberate engine change re-pins the fingerprint: DOPPEL_UPDATE_GOLDEN=1 npx tsx scripts/ubs-check.ts
  if (process.env.DOPPEL_UPDATE_GOLDEN === "1") {
    writeFileSync(GOLDEN_PATH, now + "\n");
    console.log("  fingerprint re-pinned (DOPPEL_UPDATE_GOLDEN=1)");
  }
  const golden = readFileSync(GOLDEN_PATH, "utf8").trim();
  if (now === golden) ok("engine output is bit-identical to the pinned fingerprint (scripts/fixtures/persona-golden.json)");
  // Other CPUs and Node versions round the last bits of a few sums differently (seen: 4 of 1'744 values, last digit).
  else if (sameWithin(JSON.parse(now), JSON.parse(golden), GOLDEN_REL_TOL))
    ok(`engine output matches the pinned fingerprint within ${GOLDEN_REL_TOL} relative (floating-point rounding on this platform)`);
  else fail("built-in accounts changed (scripts/fixtures/persona-golden.json); re-pin with DOPPEL_UPDATE_GOLDEN=1 only for a deliberate engine change");

  // ---------------- population overview ----------------
  console.log("\nAll 1'200 profiles, headline (real twin, 200 futures)");
  const odds: number[] = [];
  let crunchy = 0;
  for (const p of profiles) {
    const s = baseScenario(p);
    const r = simulate({ ...simInputFor(p, s, analyzeBehavior(p).params), paths: 200, horizon: "goal" });
    if (!Number.isFinite(r.successProb) || nonFinite(r.bands).length) fail(`${p.id}: non-finite simulation`);
    odds.push(r.successProb);
    if (r.crunchProb > 0.5) crunchy++;
  }
  odds.sort((a, b) => a - b);
  const q = (x: number) => pc(odds[Math.floor(x * (odds.length - 1))]);
  console.log(`  goal odds p10 ${q(0.1)} · median ${q(0.5)} · p90 ${q(0.9)} · ≥ 80%: ${odds.filter((x) => x >= 0.8).length} · cash crunch likely (> 50%): ${crunchy} · total debt ${k(profiles.reduce((s, p) => s + totalDebt(p), 0))}`);

  console.log(`\n${failures ? `✗ ${failures} failure(s)` : "✓ all UBS checks passed"} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
