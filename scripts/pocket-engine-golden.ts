/** Regenerate Pocket's deterministic parity fixture: npx tsx scripts/pocket-engine-golden.ts */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LEGACY_PROFILES } from "./fixtures/legacy-profiles";
import { analyzeBehavior } from "../src/lib/finance/behavioralEngine";
import { solveGoal, type Recipe } from "../src/lib/finance/goalSolver";
import { simulate } from "../src/lib/finance/monteCarlo";
import { mulberry32 } from "../src/lib/finance/rng";
import { baseScenario, costOfWaiting, effectiveProfile, habitCosts, simInputFor } from "../src/lib/finance/scenario";
import { checkAffordability } from "../src/lib/finance/swissRules";
import type { Profile, Scenario } from "../src/lib/finance/types";

// Frozen Lukas / Elena profiles: Pocket's parity test is pinned to them, not to the current web accounts.
const [lukas, elena] = LEGACY_PROFILES;

function applyRecipe(s: Scenario, recipe: Recipe): Scenario {
  const a = recipe.apply;
  if (a.kind === "expenseDelta") return { ...s, expenseDelta: a.value };
  if (a.kind === "optimize") return { ...s, optimize: true };
  if (a.kind === "debtExtra") return { ...s, debtExtra: a.value };
  const events = s.events.map((e) => e.id === a.eventId ? { ...e, month: Math.max(0, e.month + a.months) } : e);
  return { ...s, events, ...(a.kind === "combo" ? { expenseDelta: a.expenseDelta } : {}) };
}

function snapshot(id: string, p: Profile, s: Scenario, paths = 1000, seed = 42) {
  const behavior = analyzeBehavior(effectiveProfile(p, s), s.extraTx);
  const input = { ...simInputFor(p, s), paths, seed };
  const ideal = simulate(input);
  const realInput = { ...input, behavior: behavior.params };
  const real = simulate(realInput);
  const { house } = real;
  const affordability = house ? checkAffordability({
    price: house.price,
    grossIncomeYear: house.grossAtPurchase,
    hardEquityAvailable: house.medianHardEquity,
    pillar2Available: house.medianPillar2,
    closingRate: house.closingRate,
  }) : null;
  const solver = solveGoal(realInput, { spendTip: behavior.spendTip });
  return {
    id, paths, seed, ideal, real, affordability,
    behavior: behavior.params,
    habits: habitCosts(realInput),
    waiting: costOfWaiting(realInput)?.map(({ startMonth, prob }) => ({ startMonth, prob })),
    baseProb: solver.baseProb,
    recipes: solver.recipes.map((recipe) => {
      const { id, newProb, reaches, apply } = recipe;
      const next = applyRecipe(s, recipe);
      const b = analyzeBehavior(effectiveProfile(p, next), next.extraTx);
      return { id, newProb, reaches, apply, appliedProb: simulate(simInputFor(p, next, b.params)).successProb };
    }),
  };
}

const scenarios = [
  snapshot("lukas", lukas, baseScenario(lukas)),
  snapshot("elena", elena, baseScenario(elena)),
  snapshot("lukas_listing", lukas, {
    ...baseScenario(lukas),
    events: [{ ...lukas.events[0], amount: 940_000 }],
  }),
  snapshot("elena_retire_62", elena, { ...baseScenario(elena), retirementAge: 62 }),
  snapshot("lukas_stress", lukas, {
    ...baseScenario(lukas), monthlyInvest: 500, expenseDelta: -400, optimize: true,
    events: [
      ...lukas.events,
      { id: "job", type: "jobloss", label: "Job loss", month: 16, amount: 0, durationMonths: 6 },
      { id: "crash", type: "crash", label: "Crash", month: 36, amount: 0 },
      { id: "raise", type: "raise", label: "Raise", month: 48, amount: 10_000 },
      { id: "child", type: "child", label: "Child", month: 60, amount: 1_500 },
      { id: "income", type: "income", label: "Income", month: 72, amount: 20_000 },
    ],
  }, 137, -42),
];

const rng = [0, 42, -1, -2147483648].map((seed) => {
  const draw = mulberry32(seed);
  return { seed, values: Array.from({ length: 32 }, () => draw()) };
});

const keep = (key: string, value: unknown) => ["ms", "year", "label", "labelMsg"].includes(key) ? undefined : value;
const lines = [
  "{",
  `  "rng": ${JSON.stringify(rng)},`,
  '  "scenarios": [',
  scenarios.map((scenario) => `    ${JSON.stringify(scenario, keep)}`).join(",\n"),
  "  ]",
  "}",
];
// DOPPEL_GOLDEN_OUT writes elsewhere (e.g. to diff against the committed fixture without touching pocket/).
const fixture = resolve(process.env.DOPPEL_GOLDEN_OUT || "pocket/shared/src/jvmTest/resources/engine-golden.json");
writeFileSync(fixture, lines.join("\n") + "\n");
console.log(`Wrote ${fixture}`);
