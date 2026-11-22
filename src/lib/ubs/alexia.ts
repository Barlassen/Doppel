/**
 * Alexia's three paths from the UBS starter kit (`scenario_config.json`) as Doppel scenarios, and the plain cash
 * ledger they imply (the reference `scripts/ubs-check.ts` holds the engine to).
 */
import type { CashflowPhase, LifeEvent, Profile, Scenario } from "@/lib/finance/types";
import { ALEXIA_CONFIG_NOTE, ALEXIA_PATHS, ALEXIA_PROFILE } from "./generated/alexia";
import { ASSUMPTIONS, STRINGS } from "./generated/assumptions";
import { grossFromNet, marginalTaxFor } from "./map";
import { ALEXIA_PATH_IDS, PATH_EVENT, clearPath, pathLabel, type AlexiaPathId } from "./path";
import { ALEXIA_ID, type AlexiaPath, type UbsAssumption } from "./types";

export { ALEXIA_PATH_IDS, clearPath, pathLabel, type AlexiaPathId };

export { ALEXIA_CONFIG_NOTE, ALEXIA_PROFILE };

export function alexiaPaths(): AlexiaPath[] {
  return ALEXIA_PATHS.map((p) => ({ name: p.name, phases: p.phases.map((x) => ({ ...x })), oneOffCosts: p.oneOffCosts.map((x) => ({ ...x })) }));
}

export function ubsAssumptions(scenarioId: string, profileId?: string): UbsAssumption[] {
  return ASSUMPTIONS.filter(([, s, pid]) => s === scenarioId && (profileId === undefined || pid === profileId)).map(
    ([id, s, pid, parameter, value, unit, frequency, sourceType, notes]) => ({
      id,
      scenarioId: s,
      profileId: pid,
      parameter: STRINGS[parameter],
      value,
      unit: STRINGS[unit],
      frequency: STRINGS[frequency],
      sourceType: STRINGS[sourceType],
      notes: STRINGS[notes],
    }),
  );
}


/** S001 (full-time master's) parameters for a profile: study years and yearly tuition. */
export function s001(profileId = ALEXIA_ID): { years: number; tuition: number; ids: string[] } | null {
  const rows = ubsAssumptions("S001", profileId);
  const years = rows.find((r) => r.parameter === "study_duration_years");
  const tuition = rows.find((r) => r.parameter === "annual_tuition_chf");
  if (!years || !tuition) return null;
  return { years: years.value, tuition: tuition.value, ids: [years.id, tuition.id] };
}

/**
 * One-off costs of a path. For the master's with `useS001`, the S001 tuition (CHF/yr at the start of each study
 * year) replaces the config's one-off costs, which would otherwise be counted twice. Without it: as in the config.
 */
export function pathOneOffs(id: AlexiaPathId, path: AlexiaPath, useS001: boolean): { month: number; amountChf: number }[] {
  const s = id === "master" && useS001 ? s001() : null;
  if (!s) return path.oneOffCosts;
  return Array.from({ length: s.years }, (_, y) => ({ month: y * 12, amountChf: s.tuition }));
}

/**
 * The cash path the config implies: opening cash + Σ (income − expenses) − one-off costs, month by month, nothing
 * else (no interest, no inflation, no tax beyond the given net figures). `cash[m]` = balance at the end of month m.
 */
export function alexiaLedger(path: AlexiaPath, openingCash: number, months = 120, oneOffs = path.oneOffCosts): number[] {
  const out: number[] = [];
  let cash = openingCash;
  for (let m = 0; m < months; m++) {
    const ph = path.phases.find((x) => m >= x.startMonth && m < x.endMonth);
    if (ph) cash += ph.monthlyIncomeChf - ph.monthlyExpensesChf;
    for (const o of oneOffs) if (o.month === m) cash -= o.amountChf;
    out.push(cash);
  }
  return out;
}

/** Engine phases for a path: given net income and spending; gross from net with the same rule as the profile. */
export function pathPhases(id: AlexiaPathId, path: AlexiaPath): CashflowPhase[] {
  return path.phases.map((ph) => ({
    startMonth: ph.startMonth,
    endMonth: ph.endMonth,
    netIncomeMonth: ph.monthlyIncomeChf,
    expensesMonth: ph.monthlyExpensesChf,
    grossIncomeYear: grossFromNet(ph.monthlyIncomeChf, marginalTaxFor(ph.monthlyIncomeChf)),
    // Doppel assumption: working abroad means no Swiss pension-fund credits during the phase.
    ...(id === "abroad" ? { bvgInsured: false } : {}),
  }));
}

/** The scenario with a path applied: phases + one-off costs as dated expenses (replacing an earlier path). */
export function applyPath(s: Scenario, id: AlexiaPathId, path: AlexiaPath, useS001: boolean): Scenario {
  const oneOffs = pathOneOffs(id, path, useS001);
  const events: LifeEvent[] = oneOffs.map((o, i) => ({
    id: `${PATH_EVENT}${id}-${i}`,
    type: "expense",
    label: id === "master" && useS001 ? "Tuition (S001)" : "One-off cost",
    labelMsg: id === "master" && useS001 ? { key: "ubs.tuitionEvent" } : { key: "ubs.oneOffEvent" },
    month: o.month,
    amount: o.amountChf,
    source: "profile",
  }));
  return {
    ...s,
    events: [...s.events.filter((e) => !e.id.startsWith(PATH_EVENT)), ...events],
    phases: pathPhases(id, path),
    path: { id: `${id}${id === "master" && useS001 ? "+S001" : ""}`, label: pathLabel(id) },
  };
}


export const isAlexia = (p: Pick<Profile, "id">) => p.id === ALEXIA_ID;
