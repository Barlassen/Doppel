/**
 * The dated, sourced parameter table of the engine. ONE place to update when a figure changes.
 *
 * Every entry says where its value comes from:
 *  - `source` / `url`: the institution or document (docs/REAL_WORLD_FACTORS.md holds the full citations)
 *  - `asOf`: when the figure was looked up; `year`: the period it is valid for
 *  - `provenance`: `derived` = computed from sourced figures with a stated rule, `doppel_default` = a documented
 *    Doppel assumption (also every figure the source itself marks as an estimate → `estimate: true`).
 * A value the user supplies always overrides the table and is labelled `user` where it is used.
 *
 * Figures for which docs/REAL_WORLD_FACTORS.md says "no source found" are NOT in this table: the life-decision
 * model asks the user for them instead (see `REQUIRED_INPUTS` in `life.ts`).
 *
 * No network calls: the table is static and versioned with the code.
 */
import type { Provenance } from "./types";

/** `user` = entered by the user for this decision or scenario. */
export type ParamProvenance = Provenance | "user";

export interface Param {
  value: number;
  /** "share/yr" (0.012 = 1.2%), "CHF/month", "CHF/year", "CHF/day", "CHF/km", "CHF", "years", "share", "km/year". */
  unit: string;
  /** ISO date the figure was looked up. */
  asOf: string;
  /** Period the figure is valid for, as the source states it. */
  year: string;
  source: string;
  url?: string;
  provenance: Provenance;
  /** The source itself calls the figure an estimate or a range midpoint. */
  estimate?: boolean;
}

/** Date of the last review of the whole table. */
export const PARAMS_AS_OF = "2026-11-22";

const BAG = "https://www.bag.admin.ch/bag/en/home/versicherung/krankenversicherung.html";
const BSV_FAM = "https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html";
const BSV = "https://www.bsv.admin.ch/";
const ESTV = "https://www.estv.admin.ch/estv/de/home/direkte-bundessteuer.html";
const TCS = "https://www.tcs.ch/de/testberichte-ratgeber/ratgeber/kontrollen-unterhalt/kilometerkosten.php";
const SBB_GA = "https://www.sbb.ch/en/tickets-switzerland/travelcards/ga-travelcard.html";
const SBB_HT = "https://www.sbb.ch/en/tickets-switzerland/travelcards/half-fare-travelcard.html";
const SNB = "https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy";
const SECO = "https://www.seco.admin.ch/seco/en/home/wirtschaftslage---wirtschaftspolitik/Wirtschaftslage/konjunkturprognosen.html";
const BFS_HABE = "https://www.bfs.admin.ch/bfs/en/home/statistics/economic-social-situation-population/income-consumption-wealth/household-budget.html";
const BFS_EDU = "https://www.bfs.admin.ch/bfs/de/home/statistiken/bildung-wissenschaft/bildungsindikatoren.html";
const BFS_STUDENT = "https://www.bfs.admin.ch/bfs/en/home/statistics/education-science/social-economic-conditions-student-life.html";
const ETH = "https://ethz.ch/students/en/studies/financial/tuition-fees.html";
const COMPARIS = "https://www.comparis.ch/hypotheken";
const NGFS = "https://www.ngfs.net/ngfs-scenarios-portal/";
const ZH_KITA = "https://www.stadt-zuerich.ch/ssd/de/index/volksschule/kinderbetreuung.html";
const SWISSCANTO = "https://www.swisscanto.com/";
const BERUF = "https://www.berufsberatung.ch/";

const p = (
  value: number,
  unit: string,
  year: string,
  source: string,
  provenance: Provenance,
  url?: string,
  estimate?: boolean,
): Param => ({ value, unit, asOf: PARAMS_AS_OF, year, source, provenance, ...(url ? { url } : {}), ...(estimate ? { estimate } : {}) });

const DOPPEL = "Doppel assumption";

/**
 * Baseline economy: the constants every simulation uses unless an economic scenario (`economy.ts`) changes them.
 * `ASSUMPTIONS` in `monteCarlo.ts` is built from this table.
 */
export const BASELINE = {
  inflation: p(0.012, "share/yr", "long run", `${DOPPEL}: long-run Swiss CPI inside the SNB's price-stability range (< 2%); SECO forecast for 2026 is 0.6%`, "doppel_default", SNB),
  wageGrowth: p(0.012, "share/yr", "long run", `${DOPPEL}: nominal wages grow with prices (0% real); BFS wage index 2025: +1.8% nominal`, "doppel_default", "https://www.bfs.admin.ch/bfs/en/home/statistics/work-income/wages-income-employment-labour-costs/wage-evolution.html"),
  wageVol: p(0.01, "share/yr", "long run", `${DOPPEL}: yearly volatility of real wage growth (career luck)`, "doppel_default"),
  equityMu: p(0.065, "share/yr", "long run", `${DOPPEL}: nominal return of a global equity index`, "doppel_default"),
  equitySigma: p(0.16, "share/yr", "long run", `${DOPPEL}: yearly volatility of a global equity index`, "doppel_default"),
  bondMu: p(0.02, "share/yr", "long run", `${DOPPEL}: nominal return of CHF bonds`, "doppel_default"),
  bondSigma: p(0.05, "share/yr", "long run", `${DOPPEL}: yearly volatility of CHF bonds`, "doppel_default"),
  cashRate: p(0.003, "share/yr", "2026", `${DOPPEL}: savings-account interest at an SNB policy rate of 0%`, "doppel_default", SNB),
  overdraftRate: p(0.06, "share/yr", "2026", `${DOPPEL}: account overdraft interest`, "doppel_default"),
  homeMu: p(0.015, "share/yr", "long run", `${DOPPEL}: Swiss residential property price growth`, "doppel_default"),
  homeSigma: p(0.05, "share/yr", "long run", `${DOPPEL}: yearly volatility of residential property prices`, "doppel_default"),
  pillar2Rate: p(0.0125, "share/yr", "2024–2026", "BVG minimum interest rate (Federal Council); 2.0% announced for 2027", "doppel_default", BSV),
  mortgageRate: p(0.018, "share/yr", "2026", "10-year fixed mortgage, market average 1.80–1.85% (Comparis)", "doppel_default", COMPARIS),
  unemploymentReplacement: p(0.7, "share", "2026", "Unemployment insurance (AVIG): 70% of the insured salary (80% with dependent children is not modelled)", "doppel_default", "https://www.seco.admin.ch/"),
  unemploymentInsuredCap: p(148_200, "CHF/year", "2026", "Maximum insured salary, unemployment and accident insurance (UVG/AVIG)", "doppel_default", "https://www.seco.admin.ch/"),
  unemploymentRate: p(0.031, "share", "2026 forecast", "SECO Expert Group: unemployment rate 2026 (2.8% in 2025)", "doppel_default", SECO),
  crashShock: p(-0.3, "share", "scenario", `${DOPPEL}: one-month equity fall of a "market crash" event`, "doppel_default"),
  retirementSpending: p(0.8, "share", "long run", `${DOPPEL}: non-housing spending in retirement relative to working life`, "doppel_default"),
  raiseNetShare: p(0.72, "share", "2026", `${DOPPEL}: share of a gross raise that reaches the bank account`, "doppel_default"),
  panicDrawdown: p(0.15, "share", "long run", `${DOPPEL}: market drawdown that can trigger a panic sale`, "doppel_default"),
  healthExcessGrowth: p(0.025, "share/yr", "1996–2026", "BAG: basic premiums grew 3.81%/yr vs. ~0.6%/yr CPI (≈ 3.2 pp above prices); Doppel uses a conservative 2.5 pp", "derived", BAG),
} as const satisfies Record<string, Param>;

/** Macro regimes of docs/REAL_WORLD_FACTORS.md §2.2 A (design proposal anchored on Swiss episodes). */
export const REGIMES = {
  low: {
    anchor: "CH 2015–2021, 2025–2026",
    inflation: p(0.002, "share/yr", "2025", "BFS CPI 2025: 0.2% (low-rate regime of REAL_WORLD_FACTORS §2.2 A)", "doppel_default", "https://www.bfs.admin.ch/bfs/en/home/statistics/prices/consumer-price-index.html"),
    realWage: p(0.005, "share/yr", "regime", "REAL_WORLD_FACTORS §2.2 A, low regime: real wage drift +0.5%", "doppel_default", undefined, true),
    policyRate: p(0, "share/yr", "2025–2026", "SNB policy rate 0.00% (floor; −0.75% in 2015–2022)", "doppel_default", SNB),
    mortgageRate: p(0.015, "share/yr", "regime", "REAL_WORLD_FACTORS §2.2 A, low regime: 10-year fixed 1.5% (market range 1.55–2.15% in 2026)", "doppel_default", COMPARIS, true),
    stayProb: p(0.85, "share", "regime", "REAL_WORLD_FACTORS §2.2 A: yearly probability of staying in the regime (design proposal)", "doppel_default", undefined, true),
  },
  normal: {
    anchor: "CH 2000–2014",
    inflation: p(0.012, "share/yr", "2000–2014", "REAL_WORLD_FACTORS §2.2 A, price-stability regime: CPI 1.2% (2000: 1.56%)", "doppel_default", "https://fred.stlouisfed.org/"),
    realWage: p(0.006, "share/yr", "regime", "REAL_WORLD_FACTORS §2.2 A, normal regime: real wage drift +0.6%", "doppel_default", undefined, true),
    policyRate: p(0.0125, "share/yr", "regime", "REAL_WORLD_FACTORS §2.2 A, normal regime: SNB / SARON 1.25%", "doppel_default", SNB, true),
    mortgageRate: p(0.024, "share/yr", "regime", "REAL_WORLD_FACTORS §2.2 A, normal regime: 10-year fixed 2.4%", "doppel_default", COMPARIS, true),
    stayProb: p(0.85, "share", "regime", "REAL_WORLD_FACTORS §2.2 A (design proposal)", "doppel_default", undefined, true),
  },
  high: {
    anchor: "CH 1974 / 1991 / 2022–2023",
    inflation: p(0.038, "share/yr", "regime", "REAL_WORLD_FACTORS §2.2 A, inflation regime: CPI 3.8% (1974: 9.77%, 1991: 5.86%)", "doppel_default", "https://fred.stlouisfed.org/", true),
    realWage: p(-0.005, "share/yr", "regime", "REAL_WORLD_FACTORS §2.2 A, high regime: real wage drift −0.5%", "doppel_default", undefined, true),
    policyRate: p(0.035, "share/yr", "regime", "REAL_WORLD_FACTORS §2.2 A, high regime: SNB / SARON 3.5%", "doppel_default", SNB, true),
    mortgageRate: p(0.048, "share/yr", "regime", "REAL_WORLD_FACTORS §2.2 A, high regime: 10-year fixed 4.8% (early 1990s peak ~7%)", "doppel_default", "https://www.snb.ch/en/", true),
    stayProb: p(0.7, "share", "regime", "REAL_WORLD_FACTORS §2.2 A (design proposal)", "doppel_default", undefined, true),
  },
} as const;

/** Transmission rules of the regimes (REAL_WORLD_FACTORS §2.2 A, "Asset & pension linkage"). */
export const TRANSMISSION = {
  /** Cash earns max(0, policy rate − this). */
  cashBelowPolicy: p(0.0025, "share/yr", "2026", "SNB sight-deposit discount above the threshold: 0.25 pp below the policy rate", "doppel_default", SNB),
  /** BVG credits use max(minimum rate, this × 10-year fixed mortgage rate). */
  pillar2ShareOfMortgage: p(0.5, "share", "regime", "REAL_WORLD_FACTORS §2.2 A: BVG credit = max(1.25%, 0.5 × 10-year rate)", "doppel_default", undefined, true),
  /** Years a 10-year fixed mortgage keeps its rate before it resets to the prevailing one. */
  mortgageFixedYears: p(10, "years", "2026", "10-year fixed mortgage (the engine's mortgage product)", "doppel_default", COMPARIS),
  /** Months of the job-loss spell an unemployment risk draws (the engine's default job-loss event). */
  jobLossSpellMonths: p(6, "months", "engine", `${DOPPEL}: default length of a job-loss event`, "doppel_default"),
  /** Unemployment rate assumed in the recession scenario. A scenario assumption, not a forecast. */
  recessionUnemploymentRate: p(0.05, "share", "scenario", "Scenario assumption (not a forecast): unemployment rises from SECO's 3.1% (2026) to 5%", "doppel_default", SECO, true),
  /** Equity return drag of a disorderly climate transition over ten years. */
  climateEquityDrag: p(-0.004, "share/yr", "scenario range −0.3 to −0.5", "Mercer / Ortec Finance citing NGFS (disorderly transition); midpoint, no official Swiss figure", "doppel_default", NGFS, true),
  climateYears: p(10, "years", "scenario", "Mercer / Ortec Finance citing NGFS: 10-year annualised drag", "doppel_default", NGFS, true),
} as const satisfies Record<string, Param>;

/** Family allowances 2025/2026, CHF/month: [child allowance (0–16), education allowance (16–25 in education)]. BSV. */
export const FAMILY_ALLOWANCES: Readonly<Record<string, readonly [number, number]>> = {
  AG: [225, 278], AR: [230, 280], AI: [245, 298], BL: [215, 268], BS: [275, 325], BE: [250, 310], FR: [265, 325],
  GE: [311, 415], GL: [215, 268], GR: [240, 290], JU: [275, 325], LU: [215, 268], NE: [240, 320], NW: [258, 311],
  OW: [220, 270], SH: [230, 290], SZ: [230, 280], SO: [215, 268], SG: [245, 298], TI: [215, 268], TG: [215, 280],
  UR: [240, 290], VD: [322, 425], VS: [327, 477], ZG: [330, 330], ZH: [215, 268],
};
/** Federal minimum (FamZG Art. 5), used for a canton that is not in the table. */
export const FAMILY_ALLOWANCE_MIN: readonly [number, number] = [215, 268];
const FAMILY_SOURCE = "BSV: Arten und Ansätze der Familienzulagen 2025/2026";

/** Children: REAL_WORLD_FACTORS §1.2 and §2.2 B. */
export const CHILD = {
  direct0to4: p(850, "CHF/month", "2026 prices", "BFS HABE 2015–2017: CHF 819/month for a first child of a couple (excl. daycare and housing), adjusted to 2026 prices", "derived", BFS_HABE),
  direct5to12: p(950, "CHF/month", "2026 prices", "REAL_WORLD_FACTORS §2.2 B age band, anchored on BFS HABE", "doppel_default", BFS_HABE, true),
  direct13to18: p(1200, "CHF/month", "2026 prices", "REAL_WORLD_FACTORS §2.2 B age band, anchored on BFS HABE", "doppel_default", BFS_HABE, true),
  /** Second and later children cost less (BFS HABE: 819 for the first, +491 for the second). */
  laterChild0to4: p(0.75, "share", "2015–2017", "BFS HABE: second child adds CHF 491 vs. CHF 819 for the first; REAL_WORLD_FACTORS §2.2 B factor", "derived", BFS_HABE),
  laterChild5to12: p(0.8, "share", "2015–2017", "REAL_WORLD_FACTORS §2.2 B factor", "doppel_default", BFS_HABE, true),
  laterChild13to18: p(0.85, "share", "2015–2017", "REAL_WORLD_FACTORS §2.2 B factor", "doppel_default", BFS_HABE, true),
  kitaDaily: p(120, "CHF/day", "2025–2026", "Unsubsidised daycare 110–150 CHF/day (Swiss daycare market); 120 is also the City of Zürich maximum", "doppel_default", ZH_KITA, true),
  kitaDailyMinZH: p(25, "CHF/day", "2025–2026", "City of Zürich parental contribution 12–120 CHF/day by income; REAL_WORLD_FACTORS §2.2 B simplified ramp starts at 25", "doppel_default", ZH_KITA, true),
  kitaRampFromGross: p(60_000, "CHF/year", "2025–2026", "REAL_WORLD_FACTORS §2.2 B simplified income ramp (City of Zürich): lowest tariff up to this household gross income", "doppel_default", ZH_KITA, true),
  kitaRampToGross: p(130_000, "CHF/year", "2025–2026", "REAL_WORLD_FACTORS §2.2 B simplified income ramp (City of Zürich): full tariff from this household gross income", "doppel_default", ZH_KITA, true),
  kitaDaysPerWeek: p(3, "days/week", "default", "REAL_WORLD_FACTORS §2.2 B default", "doppel_default", undefined, true),
  kitaWeeksPerMonth: p(4.2, "weeks/month", "default", "REAL_WORLD_FACTORS §2.2 B: days per week × 4.2", "doppel_default"),
  kitaFromAgeMonths: p(6, "months", "default", "REAL_WORLD_FACTORS §2.2 B: daycare from age 0.5", "doppel_default"),
  kitaToAgeMonths: p(54, "months", "default", "REAL_WORLD_FACTORS §2.2 B: daycare until age 4.5 (48 months)", "doppel_default"),
  taxDeductionFederal: p(6800, "CHF/year", "2025–2026", "ESTV / DBG: federal income deduction per child", "doppel_default", ESTV),
  taxCreditFederal: p(263, "CHF/year", "2025–2026", "ESTV / DBG: federal tax reduction per child (parents' tariff)", "doppel_default", ESTV),
  childcareDeductionCap: p(25_000, "CHF/year", "2025–2026", "Childcare deduction, lowest of the sourced caps (federal 25,800, ZH 25,000–25,800, BS 26,000, GE 25,000–26,320)", "derived", ESTV),
  childcareDeductionAge: p(14, "years", "2025–2026", "ESTV / DBG: childcare deduction for children under 14", "doppel_default", ESTV),
  allowanceMinSalary: p(7560, "CHF/year", "2025–2026", "BSV: family allowances need an AHV salary of at least CHF 630/month", "doppel_default", BSV_FAM),
  allowanceChildToAge: p(16, "years", "2025–2026", "FamZG: child allowance until 16, education allowance 16–25", "doppel_default", BSV_FAM),
  uniProb: p(0.43, "share", "2022–2024", "BFS: baccalaureate rate 42.9% of a cohort (tertiary graduation rate 34.6%)", "derived", BFS_EDU),
  uniTuitionYear: p(1460, "CHF/year", "from autumn 2025", "ETH Zürich / EPFL: CHF 730 per semester (UZH ~770, UNIL ~580, ZHAW ~720)", "doppel_default", ETH),
  uniLivingAway: p(1500, "CHF/month", "latest BFS SSEE", "BFS: student median budget CHF 2,282/month minus ~780 own earnings and grants (73% of students work)", "derived", BFS_STUDENT, true),
  uniLivingHome: p(700, "CHF/month", "estimate", "REAL_WORLD_FACTORS §2.2 B: support for a student living at home", "doppel_default", BFS_STUDENT, true),
  uniFromAge: p(19, "years", "structural norm", "swissuniversities / BFS: Bachelor + Master ≈ 5 years", "doppel_default", "https://www.swissuniversities.ch/"),
  uniYears: p(5, "years", "structural norm", "swissuniversities / BFS: 3-year BSc + 1.5–2-year MSc", "doppel_default", "https://www.swissuniversities.ch/"),
  apprenticeFromAge: p(16, "years", "structural norm", "BFS / SBFI: apprenticeship after compulsory school (65–70% of a cohort)", "doppel_default", BERUF),
  apprenticeYears: p(3, "years", "structural norm", "REAL_WORLD_FACTORS §2.2 B: 36–48 months", "doppel_default", BERUF, true),
  apprenticeWage1: p(775, "CHF/month", "2025–2026", "Yousty / berufsberatung.ch: 750–800 in year 1 (no statutory minimum)", "doppel_default", BERUF, true),
  apprenticeWage2: p(975, "CHF/month", "2025–2026", "Yousty / berufsberatung.ch: 950–1,000 in year 2", "doppel_default", BERUF, true),
  apprenticeWage3: p(1250, "CHF/month", "2025–2026", "Yousty / berufsberatung.ch: ~1,250 in year 3", "doppel_default", BERUF, true),
  apprenticeWageShare: p(0.5, "share", "estimate", "REAL_WORLD_FACTORS §2.2 B: half of the apprentice wage lowers the household's cost", "doppel_default", BERUF, true),
} as const satisfies Record<string, Param>;

export const FAMILY_ALLOWANCE_PARAM = (canton: string, which: 0 | 1): Param =>
  p((FAMILY_ALLOWANCES[canton] ?? FAMILY_ALLOWANCE_MIN)[which], "CHF/month", "2025–2026", `${FAMILY_SOURCE}${FAMILY_ALLOWANCES[canton] ? ` (${canton})` : " (federal minimum)"}`, "doppel_default", BSV_FAM);

/** Mobility: REAL_WORLD_FACTORS §1.3 and §2.2 C. */
export const CAR = {
  price: p(45_000, "CHF", "2026", "TCS reference car (kilometre costs 2026)", "doppel_default", TCS),
  annualKm: p(12_000, "km/year", "recent BFS", "BFS Mikrozensus Mobilität: 9,000 (petrol) to 12,800 (diesel) km/year", "doppel_default", "https://www.bfs.admin.ch/bfs/en/home/statistics/mobility-transport.html"),
  fixedOwnedMonth: p(310, "CHF/month", "2026", "TCS fixed costs CHF 6,977/year minus straight-line depreciation: insurance, road tax, parking", "derived", TCS),
  fixedLeasedMonth: p(280, "CHF/month", "2026", "TCS fixed costs without depreciation for a leased car: insurance, road tax, parking", "derived", TCS),
  variablePerKm: p(0.276, "CHF/km", "2026", "TCS variable costs CHF 4,135 at 15,000 km/year: fuel or electricity, tyres, maintenance", "derived", TCS),
  replaceYears: p(10, "years", "2025–2026", "BFS: average age of the car fleet > 10.5 years (proxy for the replacement cycle)", "derived", "https://www.bfs.admin.ch/bfs/en/home/statistics/mobility-transport/transport-infrastructure-vehicles/vehicles.html"),
  resaleShare: p(0.2, "share", "estimate", "REAL_WORLD_FACTORS §2.2 C: resale value after 10 years", "doppel_default", TCS, true),
  leaseTermYears: p(4, "years", "2025–2026", "TCS: leasing terms of 3–5 years (midpoint)", "derived", TCS),
  leaseBudgetShare: p(0.5, "share", "2025–2026", "TCS rule of thumb: down payment + instalments ≤ 50% of the list price over the term", "doppel_default", TCS),
  untilAge: p(80, "years", "default", "REAL_WORLD_FACTORS §2.2 C: car costs stop at age 80", "doppel_default", undefined, true),
  gaSecondYear: p(4095, "CHF/year", "from Dec 2026", "SBB / Alliance SwissPass: GA Travelcard adult, 2nd class (3,995 until Dec 2026)", "doppel_default", SBB_GA),
  gaFirstYear: p(6770, "CHF/year", "from Dec 2026", "SBB / Alliance SwissPass: GA Travelcard adult, 1st class (6,520 until Dec 2026)", "doppel_default", SBB_GA),
  halfFareYear: p(195, "CHF/year", "from Dec 2026", "SBB / Alliance SwissPass: Half-Fare Travelcard adult (190 until Dec 2026)", "doppel_default", SBB_HT),
} as const satisfies Record<string, Param>;

/** Education of the user (further education, a master's): REAL_WORLD_FACTORS §1.2. */
export const EDUCATION = {
  tuitionYear: CHILD.uniTuitionYear,
  masterMonths: p(24, "months", "structural norm", "swissuniversities / BFS: Master 1.5–2 years", "doppel_default", "https://www.swissuniversities.ch/"),
  bachelorMonths: p(36, "months", "structural norm", "swissuniversities / BFS: Bachelor 3 years", "doppel_default", "https://www.swissuniversities.ch/"),
} as const satisfies Record<string, Param>;

/** Homeowner one-offs: REAL_WORLD_FACTORS §1.5 and §2.2 E. */
export const HOME = {
  heatPumpGross: p(55_000, "CHF", "2025–2026", "Heat-pump retrofit CHF 45,000–85,000 (Swiss retrofit market guides), midpoint of the proposal", "doppel_default", "https://www.dasgebaeudeprogramm.ch/", true),
  heatPumpGrant: p(12_000, "CHF", "2025–2026", "Das Gebäudeprogramm / cantons: several thousand up to > CHF 25,000", "doppel_default", "https://www.dasgebaeudeprogramm.ch/", true),
} as const satisfies Record<string, Param>;

/** Old-age provision figures not in `pension.ts` / `swissRules.ts`. */
export const PENSION = {
  coupleAhvCap: p(1.5, "share", "AHVG Art. 35", "AHV: the two pensions of a married couple together are capped at 150% of the maximum single pension", "doppel_default", BSV),
  pillar3aMaxNoFund: p(36_288, "CHF/year", "2025–2026", "BSV: pillar 3a without a pension fund, 20% of net earned income up to this amount", "doppel_default", BSV),
  bvgConversionMarket: p(0.053, "share", "2025–2026", "Swisscanto Pensionskassenstudie: effective blended conversion rate (the engine uses 5.5%)", "doppel_default", SWISSCANTO),
} as const satisfies Record<string, Param>;

/** Every table, for a UI that lists "assumptions and sources". */
export const PARAM_TABLES = { baseline: BASELINE, transmission: TRANSMISSION, child: CHILD, car: CAR, education: EDUCATION, home: HOME, pension: PENSION } as const;
