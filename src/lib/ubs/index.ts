/**
 * UBS LauzHack 2026 synthetic starter data, shared by the dashboard and the /play game. All people are fictional.
 *
 *   listUbsProfiles()          all 1'200 profiles as search rows (Alexia first)
 *   loadUbsProfile(id)         full Doppel Profile, every field labelled with its provenance (lazy chunk)
 *   ubsScenarioCatalog()       the 120 text scenarios
 *   ubsAssumptions(s, p?)      numeric assumptions (only S001 in the starter data)
 *   alexiaPaths()              Alexia's three paths from scenario_config.json
 *
 * Importing this module pulls in the search summary (~47 KB raw); code that only opens a profile should import
 * `@/lib/ubs/load` instead.
 */
import { CATALOG } from "./generated/catalog";
import { CANTONS, CITIES, EMPLOYMENTS, HOUSEHOLDS, ROWS } from "./generated/summary";
import { ALEXIA_ID, type UbsProfileSummary, type UbsScenario } from "./types";

export { ALEXIA_ID } from "./types";
export type { AlexiaPath, UbsAssumption, UbsProfileSummary, UbsScenario, UbsRawProfile } from "./types";
export { loadUbsProfile, loadUbsRaw, isUbsId } from "./load";
export { alexiaPaths, ubsAssumptions } from "./alexia";
export { AS_OF as UBS_AS_OF } from "./generated/meta";

let summaries: UbsProfileSummary[] | null = null;

export function listUbsProfiles(): UbsProfileSummary[] {
  summaries ??= ROWS.map(([n, name, age, city, canton, emp, hh, netWorth, debt, goals]) => ({
    id: `P${String(n).padStart(5, "0")}`,
    name,
    age,
    city: CITIES[city],
    canton: CANTONS[canton],
    employment: EMPLOYMENTS[emp],
    household: HOUSEHOLDS[hh],
    netWorthChf: netWorth,
    debtChf: debt,
    goalCount: goals,
  })).sort((a, b) => Number(b.id === ALEXIA_ID) - Number(a.id === ALEXIA_ID) || a.id.localeCompare(b.id));
  return summaries.map((s) => ({ ...s }));
}

export function ubsScenarioCatalog(): UbsScenario[] {
  return CATALOG.map(([id, category, scenario, baseline, intervention, metrics]) => ({ id, category, scenario, baseline, intervention, metrics }));
}
