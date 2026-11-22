/**
 * Cantonal cost factors (deterministic, sourced). Used by the dashboard engine (`monteCarlo.ts`), the UBS profile
 * mapping (`src/lib/ubs/map.ts`) and the game (`src/lib/game`), so all three see the same canton.
 *
 * 1. Mandatory health insurance (KVG/OKP) premiums, 2026, CHF per year, incl. accident cover:
 *    EDI ordinance on average premiums ("Verordnung des EDI über die Durchschnittsprämien der
 *    Krankenpflegeversicherung", Anhang Art. 3), in force 1 January 2026. Premium region 1 for cantons with several
 *    regions (the region of the main cities), the single cantonal value otherwise.
 *    https://www.bsv.admin.ch/dam/de/sd-web/juMQ1SfoExDq/DE%20Anhang%20(Art.%203)%20Durchschnittspr%C3%A4mien%202026.pdf
 *    These are averages of the standard model (franchise CHF 300 with accident cover), so they sit above the
 *    all-models national mean (CHF 465.30/month for adults, BAG). We use them for differences between cantons and
 *    for the premium's growth, never as an extra cost on top of spending that already contains a premium.
 *
 * 2. Income-tax burden, single person, CHF 100'000 gross, cantonal capital, tax year 2026 (federal + cantonal +
 *    communal + personal tax, no church tax, standard deductions), in % of gross salary: lohnnetto.ch ranking based
 *    on the ESTV tax calculator, https://lohnnetto.ch/de/steuerbelastung-kantone-ranking/ (accessed 2026-11-22).
 *    Only the ten cantons of the UBS profiles plus Zug are covered; any other canton uses index 1.
 *
 * 3. Health premium growth above inflation: BAG, 1996–2026 mean premium CHF 128 → 393.30 (CAGR 3.81%/yr) against
 *    ~0.6%/yr CPI, i.e. ~3.2 pp/yr above prices (docs/REAL_WORLD_FACTORS.md §1.4). Doppel uses 2.5 pp/yr, a
 *    conservative default (§2.2 D of the same document).
 */

/** [adults (26+), young adults (19–25), children (0–18)], CHF per year, 2026. */
const PREMIUM_2026: Readonly<Record<string, readonly [number, number, number]>> = {
  ZH: [7680, 5508, 1848],
  BE: [8004, 5688, 1872],
  LU: [6708, 4824, 1560],
  SG: [6888, 4980, 1644],
  GR: [6564, 4848, 1560],
  FR: [7332, 5352, 1752],
  BL: [8076, 5820, 1932],
  SH: [6996, 5172, 1632],
  TI: [8976, 6588, 2088],
  VD: [8388, 6120, 2040],
  VS: [7092, 5064, 1680],
  UR: [5856, 4200, 1332],
  SZ: [6204, 4368, 1428],
  OW: [5904, 4200, 1380],
  NW: [5928, 4296, 1380],
  GL: [6408, 4584, 1500],
  ZG: [5016, 3624, 1188],
  SO: [7224, 5220, 1668],
  BS: [8328, 6084, 2064],
  AR: [6408, 4620, 1500],
  AI: [5292, 3852, 1248],
  AG: [6852, 4980, 1608],
  TG: [6540, 4752, 1548],
  NE: [8244, 6024, 1884],
  GE: [8760, 6528, 2076],
  JU: [8028, 5760, 1824],
};

/** Effective income-tax burden, single, CHF 100'000 gross, cantonal capital, 2026, % of gross. */
const TAX_SINGLE_100K: Readonly<Record<string, number>> = {
  ZG: 5.3,
  ZH: 11.7,
  LU: 11.4,
  TI: 14.4,
  BS: 14.5,
  SG: 15.0,
  GE: 15.3,
  BE: 16.2,
  FR: 16.3,
  VD: 16.6,
  NE: 17.9,
};

/** The ten cantons of the UBS synthetic profiles: the reference for "average" (index 1). */
export const UBS_CANTONS = ["ZH", "BE", "LU", "FR", "BS", "SG", "TI", "VD", "NE", "GE"] as const;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Mean tax burden of the ten UBS cantons (14.93%). Doppel's tax brackets stand for this average. */
export const TAX_REFERENCE = mean(UBS_CANTONS.map((c) => TAX_SINGLE_100K[c]));
/** Mean adult premium of the ten UBS cantons, CHF per year (7'930.80). Doppel's living-cost floors contain this. */
export const PREMIUM_REFERENCE_ADULT = mean(UBS_CANTONS.map((c) => PREMIUM_2026[c][0]));
const PREMIUM_REFERENCE_YOUNG = mean(UBS_CANTONS.map((c) => PREMIUM_2026[c][1]));
const PREMIUM_REFERENCE_CHILD = mean(UBS_CANTONS.map((c) => PREMIUM_2026[c][2]));

/** Health premiums grow this much faster than consumer prices (per year). */
export const HEALTH_EXCESS_GROWTH = 0.025;

/** Relative income-tax burden of the canton (1 = average of the UBS cantons; 1.2 = 20% more tax). */
export function cantonTaxIndex(canton: string): number {
  const t = TAX_SINGLE_100K[canton];
  return t ? t / TAX_REFERENCE : 1;
}

export const hasCantonTax = (canton: string) => canton in TAX_SINGLE_100K;
export const hasCantonPremium = (canton: string) => canton in PREMIUM_2026;

/** Applies the canton's tax index to an average marginal rate, kept within a plausible Swiss range. */
export function cantonMarginalRate(averageRate: number, canton: string): number {
  return Math.round(Math.min(0.45, Math.max(0.03, averageRate * cantonTaxIndex(canton))) * 1000) / 1000;
}

export interface HouseholdMembers {
  adults: number;
  /** Adults aged 19–25 (young-adult premium). */
  youngAdults?: number;
  children?: number;
}

function premiumYear(canton: string, h: HouseholdMembers, which: "canton" | "reference"): number {
  const row = which === "canton" ? PREMIUM_2026[canton] : undefined;
  const [a, y, c] = row ?? [PREMIUM_REFERENCE_ADULT, PREMIUM_REFERENCE_YOUNG, PREMIUM_REFERENCE_CHILD];
  return h.adults * a + (h.youngAdults ?? 0) * y + (h.children ?? 0) * c;
}

/** The household's monthly KVG premiums in the canton (standard model, 2026). */
export const healthPremiumMonth = (canton: string, h: HouseholdMembers) => Math.round(premiumYear(canton, h, "canton") / 12);

/** How much more (or less) the household pays per month than in an average UBS canton. */
export const premiumDifferenceMonth = (canton: string, h: HouseholdMembers) =>
  Math.round((premiumYear(canton, h, "canton") - premiumYear(canton, h, "reference")) / 12);

/** A one-person household of the given age. */
export const singleHousehold = (age: number): HouseholdMembers => (age < 26 ? { adults: 0, youngAdults: 1 } : { adults: 1 });

/** Monthly premium of a profile that does not state one: a one-person household in its canton. */
export const defaultHealthPremium = (p: { canton: string; age: number }) => healthPremiumMonth(p.canton, singleHousehold(p.age));

/**
 * Extra monthly cost from premium growth above inflation, `months` after the start, in nominal CHF.
 * `priceIndex` is the CPI factor at that month. `stepYears` = true applies growth once per year (game stepper).
 */
export function premiumDrift(premiumMonth: number, months: number, priceIndex: number, stepYears = false, excess = HEALTH_EXCESS_GROWTH): number {
  if (!premiumMonth || !excess) return 0;
  const years = stepYears ? Math.floor(months / 12) : months / 12;
  return premiumMonth * priceIndex * (Math.pow(1 + excess, years) - 1);
}

/** Facts for the UI (all raw numbers; text lives in the dictionaries). */
export function cantonFacts(canton: string) {
  return {
    canton,
    taxIndex: cantonTaxIndex(canton),
    taxRate100k: TAX_SINGLE_100K[canton] ?? null,
    taxReference: TAX_REFERENCE,
    adultPremiumMonth: PREMIUM_2026[canton] ? Math.round(PREMIUM_2026[canton][0] / 12) : null,
    premiumReferenceMonth: Math.round(PREMIUM_REFERENCE_ADULT / 12),
    excessGrowth: HEALTH_EXCESS_GROWTH,
  };
}
