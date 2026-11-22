/**
 * Starting positions. UBS profiles come only through the `@/lib/ubs` API; Doppel's own accounts (Barlas, Meriç,
 * Oktay) through their `Profile`. The profile's balances, income, spending and debt are the opening.
 */
import type { Profile } from "@/lib/finance/types";
import { ALEXIA_ID, alexiaPaths, listUbsProfiles, loadUbsProfile, ubsAssumptions } from "@/lib/ubs";
import { type GameState, type UbsContext, initialState } from "./state";

export const DEMO_LENGTH = 10;

export function ubsContextFor(profileId: string): UbsContext {
  const rows = ubsAssumptions("S001", profileId);
  const years = rows.find((r) => r.parameter === "study_duration_years");
  const tuition = rows.find((r) => r.parameter === "annual_tuition_chf");
  return {
    alexiaPaths: profileId === ALEXIA_ID ? alexiaPaths() : null,
    s001: years && tuition ? { years: years.value, tuition: tuition.value, ids: [years.id, tuition.id] } : null,
  };
}

export async function ubsOpening(profileId: string, lengthTurns = DEMO_LENGTH): Promise<GameState> {
  const profile = await loadUbsProfile(profileId);
  const summary = listUbsProfiles().find((p) => p.id === profileId);
  return initialState(profile, {
    lengthTurns,
    ubs: ubsContextFor(profileId),
    openingDebt: summary?.debtChf,
    student: summary?.employment === "student",
  });
}

export function accountOpening(profile: Profile, lengthTurns = DEMO_LENGTH): GameState {
  return initialState(profile, { lengthTurns, ubs: { alexiaPaths: null, s001: null } });
}

/** UBS profiles the game can start from: working age (the game does not model retirement yet). */
export const playableUbsProfiles = () => listUbsProfiles().filter((p) => p.employment !== "retired" && p.age <= 60);
