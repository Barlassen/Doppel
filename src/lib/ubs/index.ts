/**
 * UBS LauzHack 2026 synthetic data: STUB of the shared data layer.
 *
 * ⚠ The coordinator replaces this file (and `stubData.ts`) with the real loader on merge. A parallel agent builds
 * `src/lib/ubs/` (all 1'200 profiles, liabilities, multiple goals, profile picker). Doppel Play consumes UBS data
 * ONLY through the API below, with exactly these signatures, so the swap needs no change in `src/lib/game` or
 * `src/components/play`.
 *
 * The stub holds Alexia plus six varied profiles, the full 120-scenario catalog and the S001 assumptions for those
 * profiles. Values are copied verbatim from `data/ubs/*.csv` into `stubData.ts`; `scenario_config.json` is imported.
 */
import scenarioConfig from "../../../data/ubs/scenario_config.json";
import { SOCIAL_DEDUCTIONS, effectiveTaxRate } from "@/lib/finance/pension";
import type { Profile } from "@/lib/finance/types";
import { ASSET_ROWS, ASSUMPTION_ROWS, CATALOG_ROWS, GOAL_ROWS, LIABILITY_ROWS, PROFILE_ROWS } from "./stubData";

export const ALEXIA_ID = "P00001";

export interface UbsProfileSummary { id: string; name: string; age: number; city: string; canton: string; employment: string; household: string; netWorthChf: number; debtChf: number; goalCount: number }
export interface UbsScenario { id: string; category: string; scenario: string; baseline: string; intervention: string; metrics: string }
export interface UbsAssumption { id: string; scenarioId: string; profileId: string; parameter: string; value: number; unit: string; frequency: string; sourceType: string; notes: string }
export interface AlexiaPath { name: string; phases: { startMonth: number; endMonth: number; monthlyIncomeChf: number; monthlyExpensesChf: number }[]; oneOffCosts: { month: number; amountChf: number }[] }

/** The data's as-of date (every row is 2025-01-01). Goal ages are counted from it. */
const AS_OF_YEAR = 2025;

const assetsOf = (id: string) => ASSET_ROWS.filter((a) => a[0] === id);
const debtOf = (id: string) => LIABILITY_ROWS.filter((l) => l[0] === id).reduce((s, l) => s + l[2], 0);
const goalsOf = (id: string) => GOAL_ROWS.filter((g) => g[0] === id);

export function listUbsProfiles(): UbsProfileSummary[] {
  return PROFILE_ROWS.map(([id, name, age, city, canton, employment, household]) => {
    const assets = assetsOf(id).reduce((s, a) => s + a[2], 0);
    const debt = debtOf(id);
    return { id, name, age, city, canton, employment, household, netWorthChf: Math.round(assets - debt), debtChf: Math.round(debt), goalCount: goalsOf(id).length };
  });
}

/** Rough marginal tax rate from monthly take-home (stub assumption; the real loader may differ). */
function marginalRate(netMonth: number): number {
  if (netMonth < 3000) return 0.1;
  if (netMonth < 6000) return 0.2;
  if (netMonth < 9000) return 0.28;
  return 0.33;
}

export async function loadUbsProfile(id: string): Promise<Profile> {
  const row = PROFILE_ROWS.find((r) => r[0] === id);
  if (!row) throw new Error(`Unknown UBS profile ${id}`);
  const [, name, age, city, canton, employment, household, , net, rent] = row;
  const cash = assetsOf(id).filter((a) => a[1] === "cash").reduce((s, a) => s + a[2], 0);
  const portfolio = assetsOf(id).filter((a) => a[1] === "investment_portfolio").reduce((s, a) => s + a[2], 0);
  const tax = marginalRate(net);
  const gross = Math.round((net * 12) / (1 - SOCIAL_DEDUCTIONS - effectiveTaxRate(tax)) / 100) * 100;
  // The data has rent but no other spending: stub assumption = rent + half of what is left (at least CHF 1'200).
  const expenses = Math.round((rent + Math.max(1200, 0.5 * (net - rent))) / 10) * 10;
  // Primary goal for the stub: the latest-dated one (the real loader adds multiple goals).
  const goals = [...goalsOf(id)].sort((a, b) => b[3].localeCompare(a[3]) || b[2] - a[2]);
  const g = goals[0];
  const goalAge = g ? age + Math.max(1, Number(g[3].slice(0, 4)) - AS_OF_YEAR) : age + 10;
  const target = g ? Math.round(g[2]) : 100_000;
  return {
    id,
    name,
    age,
    city,
    canton,
    tagline: { key: "play.ubs.tagline", params: { employment: { key: `play.ubs.employment.${employment}` as "play.ubs.employment.employed" }, household: { key: `play.ubs.household.${household}` as "play.ubs.household.single" } } },
    grossIncomeYear: employment === "student" || employment === "unemployed" ? 0 : gross,
    netIncomeMonth: net,
    expensesMonth: Math.max(rent, expenses),
    rentMonth: rent,
    cash,
    portfolio,
    pillar2: 0,
    pillar3a: 0,
    contributes3a: false,
    investShare: portfolio > 0 ? 0.5 : 0,
    marginalTaxRate: tax,
    riskProfile: "balanced",
    retirementAge: 65,
    goal: { label: { key: "profile.goalK", params: { target, age: goalAge } }, target, age: goalAge },
    events: [],
    transactions: [],
    trades: [],
    history: { soldInDrawdown: false, drawdownSellPct: 0 },
  };
}

export function ubsScenarioCatalog(): UbsScenario[] {
  return CATALOG_ROWS.map(([id, category, scenario, baseline, intervention, metrics]) => ({ id, category, scenario, baseline, intervention, metrics }));
}

export function ubsAssumptions(scenarioId: string, profileId?: string): UbsAssumption[] {
  return ASSUMPTION_ROWS.filter((r) => r[1] === scenarioId && (!profileId || r[2] === profileId)).map(
    ([id, sId, pId, parameter, value, unit, frequency, sourceType, notes]) => ({ id, scenarioId: sId, profileId: pId, parameter, value, unit, frequency, sourceType, notes }),
  );
}

export function alexiaPaths(): AlexiaPath[] {
  return scenarioConfig.scenarios.map((s) => ({
    name: s.name,
    phases: s.phases.map((p) => ({ startMonth: p.start_month, endMonth: p.end_month, monthlyIncomeChf: p.monthly_income_chf, monthlyExpensesChf: p.monthly_expenses_chf })),
    oneOffCosts: s.one_off_costs.map((c) => ({ month: c.month, amountChf: c.amount_chf })),
  }));
}
