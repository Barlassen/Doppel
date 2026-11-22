/**
 * Starting positions. UBS profiles come only through the `@/lib/ubs` API; Doppel's own accounts (Barlas, Meriç,
 * Oktay) through their `Profile`. The profile's balances, income, spending and debt are the opening.
 */
import type { Profile } from "@/lib/finance/types";
import { ALEXIA_ID, alexiaPaths, listUbsProfiles, loadUbsProfile, ubsAssumptions } from "@/lib/ubs";
import { FI_END_AGE, GOAL_AGE, GOAL_REAL_RATE, goalCapital } from "./independence";
import { MEDIAN_BUCKET, REGIME, hashSeed, marketYear } from "./regime";
import { type GameState, type UbsContext, initialState, monthlyOutflow, netWorth, pensionNet, stepYear } from "./state";

const annuityFactor = (years: number) => (years <= 0 ? 0 : (1 - Math.pow(1 + GOAL_REAL_RATE, -years)) / GOAL_REAL_RATE);

/**
 * The game's goal: financial independence, not the profile's short-term goal (which is easy to beat).
 * Working age: net worth at 65 = the liquid capital that covers spending minus pensions until 95, plus the pension
 * fund the player will hold anyway (projected on the median market). Retired: the money for the gap between
 * spending and pensions until 95, measured ten years ahead. Start-year CHF, computed once (`derived`).
 */
export function withFiGoal(s: GameState): GameState {
  const regime = REGIME.normal;
  const seed = hashSeed(s.profileId, "goal");
  if (s.pension) {
    const age = Math.min(FI_END_AGE, s.age + 10);
    const gapYear = (Math.max(0, monthlyOutflow(s) - pensionNet(s)) * 12) / s.priceIndex;
    // The money for the spending gap until 95, and at least 80% of today's wealth kept in real terms (a retiree whose
    // pensions cover everything still has a goal: keep the capital, for safety and for the heirs).
    const keep = 0.8 * (netWorth(s) / s.priceIndex);
    const target = Math.max(10_000, Math.round(Math.max(gapYear * annuityFactor(FI_END_AGE - age), keep) / 1000) * 1000);
    return { ...s, goal: { ...s.goal, label: { key: "fi.goalRetired", params: { age: FI_END_AGE } }, target, age } };
  }
  const age = Math.max(GOAL_AGE, s.age + 5);
  let st = s;
  for (let y = s.age; y < age; y++) st = stepYear(st, marketYear(regime, MEDIAN_BUCKET)).state;
  const pensionFund = st.pillar2 / st.priceIndex;
  const target = Math.max(10_000, Math.round((goalCapital(s, regime, seed) + pensionFund) / 1000) * 1000);
  return { ...s, goal: { ...s.goal, label: { key: "fi.goal", params: { age } }, target, age } };
}

export function ubsContextFor(profileId: string): UbsContext {
  const rows = ubsAssumptions("S001", profileId);
  const years = rows.find((r) => r.parameter === "study_duration_years");
  const tuition = rows.find((r) => r.parameter === "annual_tuition_chf");
  return {
    alexiaPaths: profileId === ALEXIA_ID ? alexiaPaths() : null,
    s001: years && tuition ? { years: years.value, tuition: tuition.value, ids: [years.id, tuition.id] } : null,
  };
}

export async function ubsOpening(profileId: string, lengthTurns?: number): Promise<GameState> {
  const profile = await loadUbsProfile(profileId);
  const summary = listUbsProfiles().find((p) => p.id === profileId);
  return withFiGoal(
    initialState(profile, {
      lengthTurns,
      ubs: ubsContextFor(profileId),
      openingDebt: summary?.debtChf,
      student: summary?.employment === "student",
    }),
  );
}

export function accountOpening(profile: Profile, lengthTurns?: number): GameState {
  return withFiGoal(initialState(profile, { lengthTurns, ubs: { alexiaPaths: null, s001: null } }));
}

/** UBS profiles the game can start from: all of them (retirees play with their pensions, see `retireNow`). */
export const playableUbsProfiles = () => listUbsProfiles();
