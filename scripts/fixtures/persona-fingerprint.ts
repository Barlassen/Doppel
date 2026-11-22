/**
 * Engine fingerprint of the three built-in accounts (Barlas, Meriç, Oktay): everything the dashboard shows for the
 * base scenario, without wall-clock times. `persona-golden.json` was written BEFORE liabilities and multiple goals
 * were added to the engine; `scripts/ubs-check.ts` recomputes the fingerprint and requires exact equality, which
 * proves those changes leave accounts without debt untouched.
 *
 * Regenerate (only after an intended engine change): npx tsx scripts/fixtures/persona-fingerprint.ts --write
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROFILES } from "../../src/lib/data/profiles";
import { analyzeBehavior } from "../../src/lib/finance/behavioralEngine";
import { solveGoal } from "../../src/lib/finance/goalSolver";
import { simulate } from "../../src/lib/finance/monteCarlo";
import { baseScenario, costOfWaiting, effectiveProfile, habitCosts, simInputFor } from "../../src/lib/finance/scenario";
import type { SimResult } from "../../src/lib/finance/types";

const strip = (r: SimResult) => {
  // Wall time and calendar years depend on the machine and the date, not on the engine.
  const { ms: _ms, ...rest } = r;
  void _ms;
  return { ...rest, bands: rest.bands.map(({ age, p10, p50, p90 }) => ({ age, p10, p50, p90 })) };
};

export function personaFingerprint() {
  return PROFILES.map((p) => {
    const s = baseScenario(p);
    const b = analyzeBehavior(effectiveProfile(p, s), s.extraTx);
    const input = simInputFor(p, s, b.params);
    const sol = solveGoal(input, { spendTip: b.spendTip });
    return {
      id: p.id,
      ideal: strip(simulate(simInputFor(p, s))),
      real: strip(simulate(input)),
      habits: habitCosts(input),
      waiting: costOfWaiting(input)?.map(({ startMonth, prob }) => ({ startMonth, prob })),
      solver: { baseProb: sol.baseProb, recipes: sol.recipes.map(({ id, newProb, reaches, apply }) => ({ id, newProb, reaches, apply })) },
    };
  });
}

export const GOLDEN_PATH = resolve(__dirname, "persona-golden.json");

if (process.argv.includes("--write")) {
  writeFileSync(GOLDEN_PATH, JSON.stringify(personaFingerprint()) + "\n");
  console.log("wrote " + GOLDEN_PATH);
}
