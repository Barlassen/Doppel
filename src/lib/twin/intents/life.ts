/**
 * Life decisions and economic scenarios for the local (0-token) what-if parsers.
 *
 * Each language module passes its own vocabulary (`LifeVocab`, regexes over its normalised text); the logic that
 * turns a match into an op is shared, so the four languages cannot drift apart. Recognised decisions:
 * car (buy / lease / GA travelcard), child (with the track after school and daycare days), workload and sabbatical,
 * move (canton and rent), partner and marriage, further education, self-employment, inheritance or windfall,
 * a large purchase, a heat-pump retrofit, and the economic scenario.
 *
 * Values the sentence does not state are left out of the payload: the engine then uses its sourced defaults
 * (`src/lib/finance/params.ts`) or reports the input as needed.
 */
import type { EconomyId } from "@/lib/finance/economy";
import { HOME } from "@/lib/finance/params";
import type { CarDecision, ChildDecision, Decision, EducationDecision, MoveDecision, PartnerDecision, SelfEmployedDecision } from "@/lib/finance/types";
import type { MessageKey } from "@/lib/i18n/types";
import type { Op } from "../actions";
import { AMOUNT, amountValue, eventLabel, monthOfYear, yearIn, type IntentContext } from "./shared";

export interface LifeVocab {
  /** "a month" in the language, as a regex source (used after an amount). */
  perMonth: string;
  /** "for <amount>" in the language: a regex source that ends right before the amount. */
  forAmount: string;
  car: RegExp;
  lease: RegExp;
  buy: RegExp;
  ga: RegExp;
  /** Any word for a home: a sentence with one is a home purchase, never a car or a generic purchase. */
  home: RegExp;
  /** Has / expects / plans a child. */
  child: RegExp;
  university: RegExp;
  apprenticeship: RegExp;
  /** "<n> days of daycare": capture group 1 = days per week. */
  kitaDays: RegExp;
  /** Workload as a percentage: the first non-empty capture group is the percent. */
  workload: RegExp;
  /** Half-time without a number ("part-time 50" is caught by `workload`). */
  halfTime?: RegExp;
  sabbatical: RegExp;
  /** "for <n> months" / "for <n> years": capture group 1 = n. */
  forMonths: RegExp;
  forYears: RegExp;
  /** Run on the ORIGINAL text (place names keep their capital letter): capture group 1 = the place. */
  moveTo: RegExp;
  move: RegExp;
  /** "rent <amount>": a regex source that ends right before the amount. */
  rent: string;
  marry: RegExp;
  partner: RegExp;
  /** "partner earns <amount>": a regex source that ends right before the amount. */
  partnerEarns: string;
  master: RegExp;
  bachelor: RegExp;
  education: RegExp;
  fullTime: RegExp;
  selfEmployed: RegExp;
  /** "earning <amount>": a regex source that ends right before the amount. */
  earning: string;
  inherit: RegExp;
  heatPump: RegExp;
  economy: Partial<Record<EconomyId, RegExp>>;
}

/** Cities and canton names (lower case, accents folded, as typed in the four languages) → canton code. */
const CANTON_OF: Readonly<Record<string, string>> = {
  zurich: "ZH", zuerich: "ZH", zurih: "ZH", winterthur: "ZH", uster: "ZH",
  bern: "BE", berne: "BE", biel: "BE", bienne: "BE", thun: "BE",
  luzern: "LU", lucerne: "LU", lucern: "LU",
  uri: "UR", altdorf: "UR", schwyz: "SZ", obwalden: "OW", nidwalden: "NW", glarus: "GL",
  zug: "ZG", zoug: "ZG", baar: "ZG", cham: "ZG",
  fribourg: "FR", freiburg: "FR", solothurn: "SO", soleure: "SO", olten: "SO",
  basel: "BS", bale: "BS", "basel-stadt": "BS", baselland: "BL", liestal: "BL", "basel-landschaft": "BL",
  schaffhausen: "SH", schaffhouse: "SH", appenzell: "AI", herisau: "AR",
  "st. gallen": "SG", "st gallen": "SG", "st.gallen": "SG", "saint-gall": "SG", "sankt gallen": "SG",
  graubunden: "GR", graubuenden: "GR", grisons: "GR", chur: "GR", coire: "GR", davos: "GR",
  aargau: "AG", argovie: "AG", aarau: "AG", baden: "AG",
  thurgau: "TG", thurgovie: "TG", frauenfeld: "TG",
  ticino: "TI", tessin: "TI", lugano: "TI", bellinzona: "TI", locarno: "TI",
  vaud: "VD", waadt: "VD", lausanne: "VD", lozan: "VD", renens: "VD", montreux: "VD", nyon: "VD", vevey: "VD", yverdon: "VD",
  valais: "VS", wallis: "VS", sion: "VS", sitten: "VS", zermatt: "VS",
  neuchatel: "NE", neuenburg: "NE",
  geneva: "GE", geneve: "GE", genf: "GE", cenevre: "GE",
  jura: "JU", delemont: "JU",
};

/** Canton of a place name, also for a two-letter code ("ZG"). */
export function cantonOf(place: string): string | undefined {
  const key = place
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .trim();
  if (CANTON_OF[key]) return CANTON_OF[key];
  if (/^[a-z]{2}$/.test(key) && Object.values(CANTON_OF).includes(key.toUpperCase())) return key.toUpperCase();
  return undefined;
}

const re = (s: string, flags = "u") => new RegExp(s, flags);
const isYear = (value: string, unit?: string) => !unit && /^20[2-6]\d$/.test(value);

/** Amounts in `t` that are not bare years, percentages or durations, with whether "a month" follows. */
function amounts(t: string, perMonth: string): { value: number; monthly: boolean; index: number }[] {
  const out: { value: number; monthly: boolean; index: number }[] = [];
  for (const m of t.matchAll(re(String.raw`(?<![%\d.,])${AMOUNT}(\s*(?:%|percent|prozent|pour\s*cent))?(\s*${perMonth})?`, "gu"))) {
    if (m[3] || isYear(m[1], m[2])) continue;
    const before = t.slice(Math.max(0, m.index - 2), m.index);
    if (before.includes("%")) continue;
    // "a month" may come before the amount ("ayda 500", "pro Monat 500").
    const lead = re(String.raw`${perMonth}\s*(?:\p{L}+\s+)?$`).test(t.slice(0, m.index));
    out.push({ value: amountValue(m[1], m[2]), monthly: !!m[4] || lead, index: m.index });
  }
  return out;
}

/** The amount right after `prefix` (a regex source), e.g. "for 35k". */
function amountAfter(t: string, prefix: string, perMonth: string): { value: number; monthly: boolean } | undefined {
  for (const m of t.matchAll(re(String.raw`${prefix}\s*${AMOUNT}(\s*%)?(\s*${perMonth})?`, "gu"))) {
    const value = m[m.length - 4];
    const unit = m[m.length - 3];
    if (m[m.length - 2] || isYear(value, unit)) continue;
    const lead = re(String.raw`${perMonth}\s*(?:\p{L}+\s+)?$`).test(t.slice(0, m.index + m[0].indexOf(value)));
    return { value: amountValue(value, unit), monthly: !!m[m.length - 1] || lead };
  }
  return undefined;
}

function duration(t: string, v: LifeVocab): number | undefined {
  const months = t.match(v.forMonths);
  if (months) return Math.round(Number(months[1].replace(",", ".")));
  const years = t.match(v.forYears);
  if (years) return Math.round(Number(years[1].replace(",", ".")) * 12);
  return undefined;
}

const decide = (labelKey: MessageKey, month: number, decision: Decision, params?: Record<string, string | number>): Extract<Op, { op: "add" }> => ({
  op: "add",
  // The carrier type and the shown amount are set by `validateLocalOps` from the decision.
  type: "expense",
  ...eventLabel(params ? { key: labelKey, params } : { key: labelKey }),
  month,
  amount: 0,
  decision,
});

/**
 * Ops for the life decisions and economic scenario found in `t` (the language's normalised text).
 * `when` = the month the sentence names, if any. `taken` = ops the language module already produced: a sentence
 * that is already a home purchase, a job loss or a raise is not read again as a generic purchase.
 */
export function lifeOps(v: LifeVocab, t: string, ctx: IntentContext, month: number | undefined, taken: readonly Op[]): Op[] {
  const ops: Op[] = [];
  // A bare year dates the decision even when the language's own date phrase ("en 2027") is missing.
  const year = yearIn(t);
  const when = month ?? (year ? monthOfYear(year, ctx.now) : undefined);
  const all = amounts(t, v.perMonth);
  const lump = all.filter((a) => !a.monthly);
  const monthly = all.filter((a) => a.monthly);
  const homeTalk = v.home.test(t);
  const hasAdd = (type: string) => taken.some((o) => o.op === "add" && o.type === type);

  // --- child: phases, daycare, allowances and the track after school (replaces the flat legacy child) ---
  const childTalk = v.child.test(t);
  if (childTalk) {
    const d: ChildDecision = { kind: "child" };
    if (v.university.test(t)) d.tertiaryTrack = "university";
    else if (v.apprenticeship.test(t)) d.tertiaryTrack = "apprenticeship";
    const days = t.match(v.kitaDays);
    if (days) d.kitaDaysPerWeek = Number(days[1]);
    ops.push({ ...decide("event.baby", when ?? 18, d), type: "child" });
  }

  // --- education of the user (never when the sentence is about a child's studies) ---
  let educationTalk = false;
  if (!childTalk && (v.master.test(t) || v.bachelor.test(t) || v.education.test(t))) {
    educationTalk = true;
    const program = v.master.test(t) ? "master" : v.bachelor.test(t) ? "bachelor" : "other";
    const d: EducationDecision = { kind: "education", program };
    const pct = t.match(v.workload);
    const percent = pct ? Number(pct.slice(1).find((x) => x !== undefined)) : undefined;
    if (percent !== undefined && percent <= 100) d.workloadPct = percent;
    else if (v.fullTime.test(t)) d.workloadPct = 0;
    const months = duration(t, v);
    if (months) d.durationMonths = months;
    ops.push(decide(program === "master" ? "life.event.master" : program === "bachelor" ? "life.event.bachelor" : "life.event.education", when ?? 12, d));
  }

  // --- self-employment ---
  let selfTalk = false;
  if (v.selfEmployed.test(t)) {
    selfTalk = true;
    const d: SelfEmployedDecision = { kind: "selfEmployed" };
    const income = amountAfter(t, v.earning, v.perMonth) ?? (monthly[0] ? { value: monthly[0].value, monthly: true } : undefined);
    if (income) d.netIncomeMonth = income.monthly || income.value < 30_000 ? income.value : Math.round(income.value / 12);
    ops.push(decide("life.event.selfEmployed", when ?? 12, d));
  }

  // --- workload and sabbatical ---
  if (!educationTalk) {
    const months = duration(t, v);
    if (v.sabbatical.test(t)) {
      ops.push(decide("life.event.sabbatical", when ?? 12, { kind: "workload", percent: 0, durationMonths: months ?? 6 }));
    } else {
      const pct = t.match(v.workload);
      const percent = pct ? Number(pct.slice(1).find((x) => x !== undefined)) : v.halfTime?.test(t) ? 50 : undefined;
      if (percent !== undefined && percent >= 0 && percent <= 100) {
        ops.push(decide("life.event.workload", when ?? 1, { kind: "workload", percent, ...(months ? { durationMonths: months } : {}) }, { percent }));
      }
    }
  }

  // --- partner / marriage ---
  const married = v.marry.test(t);
  if (married || v.partner.test(t)) {
    const d: PartnerDecision = { kind: "partner", ...(married ? { married: true } : {}) };
    const earns = amountAfter(t, v.partnerEarns, v.perMonth);
    if (earns) d.netIncomeMonth = earns.monthly || earns.value < 30_000 ? earns.value : Math.round(earns.value / 12);
    const rent = amountAfter(t, v.rent, v.perMonth);
    if (rent) d.rentMonth = rent.value;
    ops.push(decide(married ? "life.event.marriage" : "life.event.partner", when ?? 12, d));
  }

  // --- move: canton from the place name, rent when the sentence gives one ---
  const place = ctx.text.match(v.moveTo)?.slice(1).find(Boolean)?.replace(/['’].*$/, "").trim();
  if (place || v.move.test(t)) {
    const d: MoveDecision = { kind: "move" };
    const canton = place ? cantonOf(place) : undefined;
    if (canton) d.canton = canton;
    if (place) d.city = place;
    const rent = amountAfter(t, v.rent, v.perMonth);
    if (rent) d.rentMonth = rent.value;
    if (place || rent) ops.push(place ? decide("life.event.moveTo", when ?? 12, d, { place }) : decide("life.event.move", when ?? 12, d));
  }

  // --- mobility: GA travelcard, leased car, bought car ---
  const carTalk = v.car.test(t);
  if (v.ga.test(t) && !homeTalk) {
    ops.push(decide("life.event.ga", when ?? 1, { kind: "car", mode: "ga" }));
  } else if (carTalk && !homeTalk && (v.lease.test(t) || v.buy.test(t))) {
    const leased = v.lease.test(t);
    const d: CarDecision = { kind: "car", mode: leased ? "leased" : "owned" };
    const priced = amountAfter(t, v.forAmount, v.perMonth);
    const km = t.match(/(?<![\d.,])(\d{1,3}(?:[.,]\d)?)\s*(k)?\s*km\b/);
    const kmValue = km ? Number(km[1].replace(",", ".")) * (km[2] ? 1000 : 1) : undefined;
    if (kmValue && kmValue >= 500) d.annualKm = kmValue;
    const usable = lump.filter((a) => a.value !== kmValue);
    if (leased) {
      const instalment = priced?.monthly ? priced.value : monthly[0]?.value;
      if (instalment) d.leaseMonthly = instalment;
      const price = priced && !priced.monthly ? priced.value : usable.find((a) => a.value >= 5000)?.value;
      if (price) d.price = price;
    } else {
      const price = priced && !priced.monthly ? priced.value : usable.reduce((best, a) => Math.max(best, a.value), 0);
      if (price >= 1000) d.price = price;
    }
    ops.push(decide(leased ? "life.event.carLease" : "life.event.car", when ?? 12, d));
  }

  // --- inheritance or windfall: a one-off income ---
  if (v.inherit.test(t) && lump.length) {
    const amount = lump.reduce((best, a) => Math.max(best, a.value), 0);
    ops.push({ op: "add", type: "income", ...eventLabel({ key: "life.event.inheritance" }), month: when ?? 12, amount });
  }

  // --- heat-pump retrofit (homeowners): gross cost minus the subsidy, both from the sourced table ---
  if (v.heatPump.test(t)) {
    const amount = lump.find((a) => a.value >= 5000)?.value ?? HOME.heatPumpGross.value - HOME.heatPumpGrant.value;
    ops.push({ op: "add", type: "expense", ...eventLabel({ key: "life.event.heatPump" }), month: when ?? 24, amount });
  } else if (!ops.length && !homeTalk && !carTalk && !selfTalk && v.buy.test(t) && !hasAdd("house") && !hasAdd("raise")) {
    // --- a large purchase: "buy a boat for 50k in 2030" ---
    const priced = amountAfter(t, v.forAmount, v.perMonth);
    if (priced && !priced.monthly && priced.value >= 1000) {
      ops.push({ op: "add", type: "expense", ...eventLabel({ key: "life.event.purchase" }), month: when ?? 12, amount: priced.value });
    }
  }

  // --- economic scenario ---
  for (const id of Object.keys(v.economy) as EconomyId[]) {
    if (v.economy[id]!.test(t)) {
      ops.push({ op: "set", key: "economy", value: id });
      break;
    }
  }
  return ops;
}
