/**
 * Life decisions → cash flows. Pure, deterministic, no LLM.
 *
 * `compileLife()` turns every event that carries a `decision` (child, car, partner, move, education, workload,
 * self-employment) into what the simulator needs month by month, all in TODAY'S CHF:
 *  - budget lines (itemised costs and incomes with their source), one-off amounts and chart markers
 *  - structural changes of the household: workload factor, self-employment, a partner's income, rent, canton
 *  - alternatives that are drawn per simulated future (a child's university vs apprenticeship track)
 *  - the list of inputs the model needs from the user because no sourced default exists
 *
 * Defaults come from `params.ts` (sourced, dated). A value the user gives always wins and is labelled `user`.
 * Where docs/REAL_WORLD_FACTORS.md has no source, nothing is invented: the effect stays neutral (zero) and the
 * field is listed in `inputsNeeded`.
 */
import type { Msg } from "@/lib/i18n/types";
import { cantonTaxIndex, hasCantonPremium, hasCantonTax, healthPremiumMonth, singleHousehold } from "./canton";
import { BASELINE, CAR, CHILD, EDUCATION, FAMILY_ALLOWANCE_PARAM, type Param, type ParamProvenance } from "./params";
import { annuityPayment } from "./debt";
import { SOCIAL_DEDUCTIONS, effectiveTaxRate } from "./pension";
import type { CarDecision, ChildDecision, DecisionKind, EducationDecision, LifeEvent, MoveDecision, PartnerDecision, Profile, SelfEmployedDecision, WorkloadDecision } from "./types";

export interface LifeLine {
  id: string;
  eventId: string;
  kind: DecisionKind;
  /** Side of the budget. Amounts may be negative (a cost that falls away, an income that drops). */
  flow: "income" | "expense";
  label: Msg;
  /** CHF/month in today's CHF, one value per simulated month. */
  monthly: Float64Array;
  provenance: ParamProvenance;
  source?: string;
  url?: string;
  estimate?: boolean;
  /** True = already inside the household's salary, rent or pension arrays; listed for the budget only. */
  structural?: boolean;
  /** Index into `LifePlan.alternatives`: the line applies only in futures where that draw equals `altWhen`. */
  alt?: number;
  altWhen?: boolean;
  /**
   * A contract fixed in nominal CHF (a loan instalment): `monthly` is in the CHF of the start of this month and is
   * NOT indexed afterwards. Absent = today's CHF, indexed with prices every month.
   */
  fixedFrom?: number;
  /** True = a debt obligation (loan or leasing instalment): banks count it in the mortgage affordability test. */
  obligation?: boolean;
}

/** A loan taken out by a decision (a financed car). Amounts are in the CHF of the start of `fromMonth`. */
export interface LifeLoan {
  eventId: string;
  fromMonth: number;
  termMonths: number;
  principal: number;
  annualRate: number;
  payment: number;
  /** Total interest over the term. */
  interest: number;
  /** Outstanding balance after each simulated month's payment (0 before the loan and after its end). */
  balance: Float64Array;
}

export interface LifeOneOff {
  month: number;
  /** Signed, today's CHF: negative = cost. */
  amount: number;
  label: Msg;
  eventId: string;
  kind: DecisionKind;
  provenance: ParamProvenance;
}

export interface LifeMarker {
  month: number;
  kind: string;
  label: Msg;
  eventId: string;
  /** Today's CHF, when the marker is a payment. */
  amount?: number;
}

export interface LifeInputNeeded {
  eventId: string;
  kind: DecisionKind;
  /** Field of the decision payload, e.g. "netIncomeMonth". */
  field: string;
  label: Msg;
}

export interface LifeParamUsed {
  eventId: string;
  kind: DecisionKind;
  /** Field of the decision payload or id of the parameter. */
  id: string;
  value: number;
  unit: string;
  provenance: ParamProvenance;
  source?: string;
  url?: string;
  asOf?: string;
  estimate?: boolean;
}

export interface LifeAlternative {
  eventId: string;
  /** Probability of the `true` outcome (university). */
  prob: number;
  label: Msg;
}

export interface LifePlan {
  months: number;
  /** True when no event carries a decision: the simulator then skips every life array. */
  empty: boolean;
  lines: LifeLine[];
  oneOffs: LifeOneOff[];
  markers: LifeMarker[];
  inputsNeeded: LifeInputNeeded[];
  params: LifeParamUsed[];
  alternatives: LifeAlternative[];
  /** Loans taken out by decisions: a liability in net worth until repaid. */
  loans: LifeLoan[];
  /** Multiplier on the user's own salary (1 = today's workload). */
  workFactor: Float64Array;
  /** Multiplier on the partner's salary. */
  partnerWorkFactor: Float64Array;
  /** 1 = self-employed in that month (no pension fund). */
  self: Uint8Array;
  /** Self-employed take-home pay, today's CHF/month (0 = keep the profile's income). */
  selfNet: Float64Array;
  /** Yearly volatility of the self-employed income in that month. */
  selfVol: Float64Array;
  /** Extra gross salary of the user, today's CHF/year (e.g. after a degree). */
  raise: Float64Array;
  /** Partner's take-home pay and gross salary at 100% of their workload, today's CHF. */
  partnerNet: Float64Array;
  partnerGross: Float64Array;
  /** 1 = married in that month (AHV couple cap). */
  married: Uint8Array;
  /** Household rent, today's CHF/month. */
  rent: Float64Array;
  /** Canton of residence in a month (after moves). */
  cantonAt: (month: number) => string;
}

/** Inputs without a sourced default: the model asks for them and stays neutral until they are given. */
export const REQUIRED_INPUTS: Readonly<Record<DecisionKind, readonly string[]>> = {
  child: [],
  // Only for a financed purchase.
  car: ["loanRate"],
  partner: ["netIncomeMonth", "expensesMonth", "rentMonth", "taxDeltaYear"],
  move: ["rentMonth", "movingCost"],
  education: ["workloadPct", "raiseAfterYear"],
  workload: [],
  selfEmployed: ["netIncomeMonth", "incomeVolatility"],
};

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Ctx {
  p: Profile;
  months: number;
  retireMonth: number;
  plan: LifePlan;
}

function line(ctx: Ctx, e: LifeEvent, kind: DecisionKind, id: string, flow: LifeLine["flow"], label: Msg, param: Pick<LifeLine, "provenance" | "source" | "url" | "estimate">, extra: Partial<LifeLine> = {}): Float64Array {
  const monthly = new Float64Array(ctx.months);
  ctx.plan.lines.push({ id: `${e.id}:${id}`, eventId: e.id, kind, flow, label, monthly, ...param, ...extra });
  return monthly;
}

/** The value in force: the user's, else the table's. Records which one was used. */
function pick(ctx: Ctx, e: LifeEvent, kind: DecisionKind, id: string, user: number | undefined, param: Param): { value: number; meta: Pick<LifeLine, "provenance" | "source" | "url" | "estimate"> } {
  if (user !== undefined) {
    ctx.plan.params.push({ eventId: e.id, kind, id, value: user, unit: param.unit, provenance: "user" });
    return { value: user, meta: { provenance: "user" } };
  }
  ctx.plan.params.push({ eventId: e.id, kind, id, value: param.value, unit: param.unit, provenance: param.provenance, source: param.source, asOf: param.asOf, ...(param.url ? { url: param.url } : {}), ...(param.estimate ? { estimate: true } : {}) });
  return { value: param.value, meta: { provenance: param.provenance, source: param.source, ...(param.url ? { url: param.url } : {}), ...(param.estimate ? { estimate: true } : {}) } };
}

function userValue(ctx: Ctx, e: LifeEvent, kind: DecisionKind, id: string, value: number, unit: string) {
  ctx.plan.params.push({ eventId: e.id, kind, id, value, unit, provenance: "user" });
}

function need(ctx: Ctx, e: LifeEvent, kind: DecisionKind, field: string, label: Msg) {
  ctx.plan.inputsNeeded.push({ eventId: e.id, kind, field, label });
}

function marker(ctx: Ctx, e: LifeEvent, month: number, kind: string, label: Msg, amount?: number) {
  if (month < 0 || month >= ctx.months) return;
  ctx.plan.markers.push({ month, kind, label, eventId: e.id, ...(amount !== undefined ? { amount } : {}) });
}

const fill = (a: Float64Array | Uint8Array, from: number, to: number, value: number) => {
  for (let m = Math.max(0, from); m < Math.min(a.length, to); m++) a[m] = value;
};
const add = (a: Float64Array, from: number, to: number, value: number) => {
  for (let m = Math.max(0, from); m < Math.min(a.length, to); m++) a[m] += value;
};

const USER = { provenance: "user" as const };
const DERIVED = { provenance: "derived" as const };

// ---------------------------------------------------------------------------------------------------------------

function workload(ctx: Ctx, e: LifeEvent, d: WorkloadDecision) {
  const pct = clamp(num(d.percent) ?? 100, 0, 150);
  const end = d.durationMonths ? e.month + Math.max(1, Math.round(d.durationMonths)) : ctx.retireMonth;
  fill(ctx.plan.workFactor, e.month, end, pct / 100);
  userValue(ctx, e, "workload", "percent", pct, "percent");
  marker(ctx, e, e.month, "workloadStart", { key: pct === 0 ? "life.marker.sabbaticalStart" : "life.marker.workloadStart", params: { percent: pct } });
  if (d.durationMonths) marker(ctx, e, end, "workloadEnd", { key: pct === 0 ? "life.marker.sabbaticalEnd" : "life.marker.workloadEnd" });
}

function selfEmployed(ctx: Ctx, e: LifeEvent, d: SelfEmployedDecision) {
  const end = d.durationMonths ? e.month + Math.max(1, Math.round(d.durationMonths)) : ctx.retireMonth;
  fill(ctx.plan.self, e.month, end, 1);
  const net = num(d.netIncomeMonth);
  if (net !== undefined && net >= 0) {
    fill(ctx.plan.selfNet, e.month, end, Math.max(1e-9, net));
    userValue(ctx, e, "selfEmployed", "netIncomeMonth", net, "CHF/month");
  } else need(ctx, e, "selfEmployed", "netIncomeMonth", { key: "life.need.selfIncome" });
  const vol = num(d.incomeVolatility);
  if (vol !== undefined && vol >= 0) {
    fill(ctx.plan.selfVol, e.month, end, clamp(vol, 0, 1));
    userValue(ctx, e, "selfEmployed", "incomeVolatility", vol, "share/yr");
  } else need(ctx, e, "selfEmployed", "incomeVolatility", { key: "life.need.selfVolatility" });
  marker(ctx, e, e.month, "selfStart", { key: "life.marker.selfStart" });
  if (d.durationMonths) marker(ctx, e, end, "selfEnd", { key: "life.marker.selfEnd" });
}

function education(ctx: Ctx, e: LifeEvent, d: EducationDecision) {
  const program = d.program ?? "other";
  const sourcedMonths = program === "master" ? EDUCATION.masterMonths : program === "bachelor" ? EDUCATION.bachelorMonths : undefined;
  let months = num(d.durationMonths);
  if (months !== undefined) userValue(ctx, e, "education", "durationMonths", months, "months");
  else if (sourcedMonths) months = pick(ctx, e, "education", "durationMonths", undefined, sourcedMonths).value;
  else {
    months = 12;
    need(ctx, e, "education", "durationMonths", { key: "life.need.eduDuration" });
  }
  months = clamp(Math.round(months), 1, 120);
  const end = e.month + months;

  // Tuition: public universities have a sourced fee; any other programme needs the user's figure.
  const userTuition = num(d.tuitionYear);
  if (userTuition !== undefined || program !== "other") {
    const t = pick(ctx, e, "education", "tuitionYear", userTuition, EDUCATION.tuitionYear);
    add(line(ctx, e, "education", "tuition", "expense", { key: "life.line.eduTuition" }, t.meta), e.month, end, t.value / 12);
  } else need(ctx, e, "education", "tuitionYear", { key: "life.need.eduTuition" });

  const pct = num(d.workloadPct);
  if (pct !== undefined) {
    fill(ctx.plan.workFactor, e.month, end, clamp(pct, 0, 100) / 100);
    userValue(ctx, e, "education", "workloadPct", pct, "percent");
  } else need(ctx, e, "education", "workloadPct", { key: "life.need.eduWorkload" });

  const raise = num(d.raiseAfterYear);
  if (raise !== undefined) {
    add(ctx.plan.raise, end, ctx.months, raise);
    userValue(ctx, e, "education", "raiseAfterYear", raise, "CHF/year");
  } else need(ctx, e, "education", "raiseAfterYear", { key: "life.need.eduRaise" });

  marker(ctx, e, e.month, "eduStart", { key: "life.marker.eduStart" });
  marker(ctx, e, end, "eduEnd", { key: "life.marker.eduEnd" });
}

function partner(ctx: Ctx, e: LifeEvent, d: PartnerDecision) {
  const { p, plan } = ctx;
  const net = num(d.netIncomeMonth);
  if (net !== undefined && net >= 0) {
    // Gross behind the take-home pay with the engine's own rule (13% social deductions, effective tax ≈ ½ marginal).
    const gross = num(d.grossIncomeYear) ?? Math.round((net * 12) / (1 - effectiveTaxRate(p.marginalTaxRate)) / (1 - SOCIAL_DEDUCTIONS) / 100) * 100;
    add(plan.partnerNet, e.month, ctx.retireMonth, net);
    add(plan.partnerGross, e.month, ctx.retireMonth, gross);
    userValue(ctx, e, "partner", "netIncomeMonth", net, "CHF/month");
    plan.params.push({ eventId: e.id, kind: "partner", id: "grossIncomeYear", value: gross, unit: "CHF/year", provenance: d.grossIncomeYear !== undefined ? "user" : "derived" });
  } else need(ctx, e, "partner", "netIncomeMonth", { key: "life.need.partnerIncome" });

  const spend = num(d.expensesMonth);
  if (spend !== undefined) {
    add(line(ctx, e, "partner", "expenses", "expense", { key: "life.line.partnerExpenses" }, USER), e.month, ctx.months, spend);
    userValue(ctx, e, "partner", "expensesMonth", spend, "CHF/month");
  } else need(ctx, e, "partner", "expensesMonth", { key: "life.need.partnerExpenses" });

  const rent = num(d.rentMonth);
  if (rent !== undefined && rent >= 0) {
    fill(plan.rent, e.month, ctx.months, rent);
    userValue(ctx, e, "partner", "rentMonth", rent, "CHF/month");
  } else need(ctx, e, "partner", "rentMonth", { key: "life.need.partnerRent" });

  if (d.married) {
    fill(plan.married, e.month, ctx.months, 1);
    const tax = num(d.taxDeltaYear);
    if (tax !== undefined) {
      add(line(ctx, e, "partner", "tax", "expense", { key: "life.line.partnerTax" }, USER), e.month, ctx.months, tax / 12);
      userValue(ctx, e, "partner", "taxDeltaYear", tax, "CHF/year");
    } else need(ctx, e, "partner", "taxDeltaYear", { key: "life.need.marriageTax" });
  }

  const savings = num(d.savings);
  if (savings) {
    plan.oneOffs.push({ month: e.month, amount: savings, label: { key: "life.oneOff.partnerSavings" }, eventId: e.id, kind: "partner", provenance: "user" });
    userValue(ctx, e, "partner", "savings", savings, "CHF");
  }
  marker(ctx, e, e.month, "partner", { key: d.married ? "life.marker.marriage" : "life.marker.partner" });
}

function move(ctx: Ctx, e: LifeEvent, d: MoveDecision, cantons: { month: number; canton: string }[]) {
  const { p, plan } = ctx;
  const from = cantons.length ? cantons[cantons.length - 1].canton : p.canton;
  const to = typeof d.canton === "string" && /^[A-Za-z]{2}$/.test(d.canton) ? d.canton.toUpperCase() : from;
  const rent = num(d.rentMonth);
  if (rent !== undefined && rent >= 0) {
    fill(plan.rent, e.month, ctx.months, rent);
    userValue(ctx, e, "move", "rentMonth", rent, "CHF/month");
  } else need(ctx, e, "move", "rentMonth", { key: "life.need.moveRent" });

  const cost = num(d.movingCost);
  if (cost !== undefined && cost > 0) {
    plan.oneOffs.push({ month: e.month, amount: -cost, label: { key: "life.oneOff.movingCost" }, eventId: e.id, kind: "move", provenance: "user" });
    userValue(ctx, e, "move", "movingCost", cost, "CHF");
  } else if (cost === undefined) need(ctx, e, "move", "movingCost", { key: "life.need.movingCost" });

  if (to !== from) {
    cantons.push({ month: e.month, canton: to });
    // Income tax: the canton's burden index relative to the old canton, on the tax the take-home pay implies.
    if (hasCantonTax(from) && hasCantonTax(to)) {
      const household = p.grossIncomeYear + plan.partnerGross[Math.min(ctx.months - 1, Math.max(0, e.month))];
      const taxYear = effectiveTaxRate(p.marginalTaxRate) * household * (1 - SOCIAL_DEDUCTIONS);
      const delta = taxYear * (cantonTaxIndex(to) / cantonTaxIndex(from) - 1);
      // Shown on the side it lands on: a lower bill is income, a higher bill a cost. Stops with the salary.
      const l = line(ctx, e, "move", "tax", delta <= 0 ? "income" : "expense", { key: "life.line.moveTax", params: { from, to } }, { ...DERIVED, source: "ESTV-based tax burden of the cantonal capitals (canton.ts)" });
      add(l, e.month, ctx.retireMonth, Math.abs(delta) / 12);
      plan.params.push({ eventId: e.id, kind: "move", id: "taxIndex", value: cantonTaxIndex(to) / cantonTaxIndex(from), unit: "share", provenance: "derived", source: "ESTV-based tax burden of the cantonal capitals (canton.ts)" });
    } else need(ctx, e, "move", "taxDeltaYear", { key: "life.need.moveCantonTax", params: { canton: hasCantonTax(to) ? from : to } });
    // Health premiums: the canton's mean premium for the household's adults.
    if (hasCantonPremium(from) && hasCantonPremium(to)) {
      const one = singleHousehold(p.age + Math.floor(e.month / 12));
      const adults = plan.partnerNet[Math.min(ctx.months - 1, Math.max(0, e.month))] > 0 ? 2 : 1;
      const members = { adults: one.adults * adults, youngAdults: (one.youngAdults ?? 0) * adults };
      const delta = healthPremiumMonth(to, members) - healthPremiumMonth(from, members);
      add(line(ctx, e, "move", "premium", "expense", { key: "life.line.movePremium", params: { from, to } }, { ...DERIVED, source: "EDI ordinance on average premiums 2026 (canton.ts)" }), e.month, ctx.months, delta);
    }
  }
  marker(ctx, e, e.month, "move", d.city || to !== from ? { key: "life.marker.moveTo", params: { place: d.city ?? to } } : { key: "life.marker.move" });
}

function car(ctx: Ctx, e: LifeEvent, d: CarDecision) {
  const { p, plan } = ctx;
  const untilAge = d.mode === "ga" ? 200 : CAR.untilAge.value;
  const end = Math.min(ctx.months, d.durationMonths ? e.month + Math.max(1, Math.round(d.durationMonths)) : Math.max(e.month, (untilAge - p.age) * 12));
  const replaces = num(d.replacesMonthly);
  if (replaces) {
    add(line(ctx, e, "car", "replaces", "expense", { key: "life.line.carReplaces" }, USER), e.month, end, -Math.abs(replaces));
    userValue(ctx, e, "car", "replacesMonthly", Math.abs(replaces), "CHF/month");
  }
  if (d.mode === "ga") {
    const ga = pick(ctx, e, "car", "gaYear", undefined, d.gaClass === 1 ? CAR.gaFirstYear : CAR.gaSecondYear);
    add(line(ctx, e, "car", "ga", "expense", { key: "life.line.carGa", params: { cls: d.gaClass === 1 ? 1 : 2 } }, ga.meta), e.month, end, ga.value / 12);
    marker(ctx, e, e.month, "gaStart", { key: "life.marker.gaStart" });
    return;
  }
  const price = pick(ctx, e, "car", "price", num(d.price), CAR.price);
  const km = pick(ctx, e, "car", "annualKm", num(d.annualKm), CAR.annualKm);
  const perKm = pick(ctx, e, "car", "variablePerKm", num(d.variablePerKm), CAR.variablePerKm);
  const fixed = pick(ctx, e, "car", "fixedMonthly", num(d.fixedMonthly), d.mode === "leased" ? CAR.fixedLeasedMonth : CAR.fixedOwnedMonth);
  add(line(ctx, e, "car", "fixed", "expense", { key: "life.line.carFixed" }, fixed.meta), e.month, end, fixed.value);
  add(line(ctx, e, "car", "running", "expense", { key: "life.line.carRunning", params: { km: km.value } }, perKm.meta), e.month, end, (km.value / 12) * perKm.value);

  if (d.mode === "leased") {
    const term = pick(ctx, e, "car", "replaceYears", num(d.replaceYears), CAR.leaseTermYears);
    const userLease = num(d.leaseMonthly);
    // TCS rule of thumb: all instalments together stay within half of the list price over the term.
    const derived = (CAR.leaseBudgetShare.value * price.value) / (Math.max(1, term.value) * 12);
    const lease = userLease ?? Math.round(derived);
    if (userLease !== undefined) userValue(ctx, e, "car", "leaseMonthly", userLease, "CHF/month");
    else plan.params.push({ eventId: e.id, kind: "car", id: "leaseMonthly", value: lease, unit: "CHF/month", provenance: "derived", source: CAR.leaseBudgetShare.source, asOf: CAR.leaseBudgetShare.asOf, url: CAR.leaseBudgetShare.url });
    add(line(ctx, e, "car", "lease", "expense", { key: "life.line.carLease" }, userLease !== undefined ? USER : { ...DERIVED, source: CAR.leaseBudgetShare.source, url: CAR.leaseBudgetShare.url }, { obligation: true }), e.month, end, lease);
    marker(ctx, e, e.month, "leaseStart", { key: "life.marker.leaseStart" });
  } else {
    const every = Math.max(1, Math.round(pick(ctx, e, "car", "replaceYears", num(d.replaceYears), CAR.replaceYears).value)) * 12;
    const resale = clamp(pick(ctx, e, "car", "resaleShare", num(d.resaleShare), CAR.resaleShare).value, 0, 1);
    if (d.financed) carLoan(ctx, e, d, price.value);
    else plan.oneOffs.push({ month: e.month, amount: -price.value, label: { key: "life.oneOff.carPurchase" }, eventId: e.id, kind: "car", provenance: price.meta.provenance });
    marker(ctx, e, e.month, "carPurchase", { key: "life.marker.carPurchase" }, price.value);
    for (let m = e.month + every; m < end; m += every) {
      const net = price.value * (1 - resale);
      plan.oneOffs.push({ month: m, amount: -net, label: { key: "life.oneOff.carReplacement" }, eventId: e.id, kind: "car", provenance: price.meta.provenance });
      marker(ctx, e, m, "carReplacement", { key: "life.marker.carReplacement" }, net);
    }
    // The last car is sold when the costs stop.
    if (end < ctx.months) plan.oneOffs.push({ month: end, amount: price.value * resale, label: { key: "life.oneOff.carSale" }, eventId: e.id, kind: "car", provenance: "derived" });
  }
  if (end < ctx.months) marker(ctx, e, end, "carEnd", { key: "life.marker.carEnd" });
}

/**
 * A financed first purchase: a down payment, then a fixed annuity (interest_m = balance × rate / 12, as in debt.ts).
 * The instalment is fixed in the CHF of the purchase date; the balance is a liability until the loan is repaid.
 * The interest rate has no sourced default: without it the loan is costed at 0% and the rate is asked for.
 */
function carLoan(ctx: Ctx, e: LifeEvent, d: CarDecision, price: number) {
  const { plan } = ctx;
  const down = clamp(num(d.downPayment) ?? 0, 0, price);
  if (d.downPayment !== undefined) userValue(ctx, e, "car", "downPayment", down, "CHF");
  const term = clamp(Math.round(pick(ctx, e, "car", "loanTermMonths", num(d.loanTermMonths), CAR.loanTermMonths).value), 1, 240);
  const userRate = num(d.loanRate);
  const rate = clamp(userRate ?? 0, 0, 1);
  if (userRate !== undefined) userValue(ctx, e, "car", "loanRate", rate, "share/yr");
  else need(ctx, e, "car", "loanRate", { key: "life.need.carLoanRate" });
  const principal = price - down;
  const payment = annuityPayment(principal, rate, term);
  if (down > 0) plan.oneOffs.push({ month: e.month, amount: -down, label: { key: "life.oneOff.carDownPayment" }, eventId: e.id, kind: "car", provenance: "user" });
  if (principal <= 0) return;
  const l = line(ctx, e, "car", "loan", "expense", { key: "life.line.carLoan", params: { months: term } }, userRate !== undefined ? USER : { ...DERIVED, source: "annuity at 0% until the interest rate is given" }, { fixedFrom: e.month, obligation: true });
  const balance = new Float64Array(ctx.months);
  let left = principal;
  for (let k = 0; k < term; k++) {
    const m = e.month + k;
    const due = Math.min(payment, left * (1 + rate / 12));
    left = Math.max(0, left * (1 + rate / 12) - due);
    if (left < 1e-6) left = 0;
    if (m >= 0 && m < ctx.months) {
      l[m] = due;
      balance[m] = left;
    }
  }
  const interest = payment * term - principal;
  plan.loans.push({ eventId: e.id, fromMonth: e.month, termMonths: term, principal, annualRate: rate, payment, interest, balance });
  plan.params.push({ eventId: e.id, kind: "car", id: "loanPayment", value: payment, unit: "CHF/month", provenance: "derived", source: "annuity: principal × r / (1 − (1 + r)^−n), r = rate / 12" });
  plan.params.push({ eventId: e.id, kind: "car", id: "loanInterestTotal", value: interest, unit: "CHF", provenance: "derived", source: "sum of the instalments minus the amount borrowed" });
  marker(ctx, e, e.month + term, "carLoanEnd", { key: "life.marker.carLoanEnd" });
}

/** Out-of-pocket daycare tariff: the user's, the City of Zürich income ramp in ZH, else the unsubsidised rate. */
export function kitaDailyTariff(canton: string, householdGrossYear: number): { value: number; subsidised: boolean } {
  const full = CHILD.kitaDaily.value;
  if (canton !== "ZH") return { value: full, subsidised: false };
  const lo = CHILD.kitaRampFromGross.value;
  const hi = CHILD.kitaRampToGross.value;
  const t = clamp((householdGrossYear - lo) / (hi - lo), 0, 1);
  return { value: Math.round((CHILD.kitaDailyMinZH.value + t * (full - CHILD.kitaDailyMinZH.value)) * 100) / 100, subsidised: t < 1 };
}

function child(ctx: Ctx, e: LifeEvent, d: ChildDecision, order: number) {
  const { p, plan, months } = ctx;
  const birth = e.month - Math.round(clamp(num(d.ageYears) ?? 0, 0, 25) * 12);
  const later = order > 0;
  const marginal = p.marginalTaxRate;
  const cantonAt = plan.cantonAt;
  const grossAt = (m: number) => {
    const i = Math.min(months - 1, Math.max(0, m));
    return m >= ctx.retireMonth ? 0 : p.grossIncomeYear * plan.workFactor[i] + plan.raise[i] + plan.partnerGross[i] * plan.partnerWorkFactor[i];
  };
  const range = (fromAge: number, toAge: number): [number, number] => [birth + fromAge, birth + toAge];

  // A parent works less after the birth (user input: there is no sourced default).
  const pct = num(d.parentWorkloadPct);
  const pMonths = num(d.parentWorkloadMonths);
  if (pct !== undefined && pMonths !== undefined && pMonths > 0) {
    const from = Math.max(0, Math.max(birth, e.month));
    fill(plan.workFactor, from, Math.min(ctx.retireMonth, from + Math.round(pMonths)), clamp(pct, 0, 100) / 100);
    userValue(ctx, e, "child", "parentWorkloadPct", pct, "percent");
    marker(ctx, e, from, "workloadStart", { key: "life.marker.workloadStart", params: { percent: pct } });
    marker(ctx, e, from + Math.round(pMonths), "workloadEnd", { key: "life.marker.workloadEnd" });
  }

  // 1. Direct cost by age band (food, clothes, activities; housing is the household's rent).
  const userDirect = num(d.directMonthly);
  const bands: [Param, Param, number, number][] = [
    [CHILD.direct0to4, CHILD.laterChild0to4, 0, 60],
    [CHILD.direct5to12, CHILD.laterChild5to12, 60, 156],
    [CHILD.direct13to18, CHILD.laterChild13to18, 156, 192],
  ];
  const teen = userDirect ?? CHILD.direct13to18.value * (later ? CHILD.laterChild13to18.value : 1);
  if (userDirect !== undefined) {
    add(line(ctx, e, "child", "direct", "expense", { key: "life.line.childDirect" }, USER), Math.max(e.month, birth), birth + 192, userDirect);
    userValue(ctx, e, "child", "directMonthly", userDirect, "CHF/month");
  } else {
    const l = line(ctx, e, "child", "direct", "expense", { key: "life.line.childDirect" }, { provenance: CHILD.direct0to4.provenance, source: CHILD.direct0to4.source, url: CHILD.direct0to4.url, estimate: true });
    for (const [param, factor, from, to] of bands) {
      const v = pick(ctx, e, "child", `direct${from / 12}`, undefined, param).value * (later ? factor.value : 1);
      add(l, Math.max(e.month, birth + from), birth + to, v);
    }
  }

  // 2. Daycare from age 0.5 to 4.5.
  const days = clamp(pick(ctx, e, "child", "kitaDaysPerWeek", num(d.kitaDaysPerWeek), CHILD.kitaDaysPerWeek).value, 0, 5);
  const [kFrom, kTo] = range(CHILD.kitaFromAgeMonths.value, CHILD.kitaToAgeMonths.value);
  const kita = new Float64Array(months);
  if (days > 0 && kTo > Math.max(0, e.month)) {
    const userTariff = num(d.kitaDailyChf);
    const kStart = Math.max(e.month, kFrom);
    const auto = kitaDailyTariff(cantonAt(Math.max(0, kStart)), grossAt(kStart));
    const tariff = userTariff ?? auto.value;
    if (userTariff !== undefined) userValue(ctx, e, "child", "kitaDailyChf", userTariff, "CHF/day");
    else
      plan.params.push({ eventId: e.id, kind: "child", id: "kitaDailyChf", value: tariff, unit: "CHF/day", provenance: auto.subsidised ? "derived" : CHILD.kitaDaily.provenance, source: auto.subsidised ? CHILD.kitaDailyMinZH.source : CHILD.kitaDaily.source, url: CHILD.kitaDaily.url, asOf: CHILD.kitaDaily.asOf, estimate: true });
    const l = line(ctx, e, "child", "kita", "expense", { key: "life.line.childKita", params: { days, tariff } }, userTariff !== undefined ? USER : { provenance: auto.subsidised ? "derived" : CHILD.kitaDaily.provenance, source: auto.subsidised ? CHILD.kitaDailyMinZH.source : CHILD.kitaDaily.source, url: CHILD.kitaDaily.url, estimate: true });
    add(l, kStart, kTo, days * CHILD.kitaWeeksPerMonth.value * tariff);
    add(kita, kStart, kTo, days * CHILD.kitaWeeksPerMonth.value * tariff);
    marker(ctx, e, kStart, "kitaStart", { key: "life.marker.kitaStart" });
    marker(ctx, e, kTo, "kitaEnd", { key: "life.marker.kitaEnd" });
  }

  // 3. Family allowances (taxable income) and 4. tax effects, while the household has an AHV salary.
  const allowance = line(ctx, e, "child", "allowance", "income", { key: "life.line.childAllowance" }, { provenance: "doppel_default", source: FAMILY_ALLOWANCE_PARAM(p.canton, 0).source, url: FAMILY_ALLOWANCE_PARAM(p.canton, 0).url });
  const tax = line(ctx, e, "child", "tax", "income", { key: "life.line.childTax" }, { ...DERIVED, source: `${CHILD.taxDeductionFederal.source}; conservative: cantonal deductions above the federal one are not added`, url: CHILD.taxDeductionFederal.url });
  const careTax = line(ctx, e, "child", "careTax", "income", { key: "life.line.childcareTax" }, { ...DERIVED, source: CHILD.childcareDeductionCap.source, url: CHILD.childcareDeductionCap.url });
  const taxSaving = (CHILD.taxDeductionFederal.value * marginal + CHILD.taxCreditFederal.value) / 12;
  const childAllowanceTo = CHILD.allowanceChildToAge.value * 12;
  const start = Math.max(0, Math.max(e.month, birth));
  for (let m = start; m < Math.min(months, birth + childAllowanceTo); m++) {
    const working = grossAt(m) >= CHILD.allowanceMinSalary.value;
    if (working) allowance[m] += FAMILY_ALLOWANCE_PARAM(cantonAt(m), 0).value * (1 - marginal);
    if (grossAt(m) > 0) {
      tax[m] += taxSaving;
      if (m - birth < CHILD.childcareDeductionAge.value * 12) careTax[m] += (Math.min(kita[m] * 12, CHILD.childcareDeductionCap.value) * marginal) / 12;
    }
  }
  plan.params.push({ eventId: e.id, kind: "child", id: "familyAllowance", value: FAMILY_ALLOWANCE_PARAM(cantonAt(start), 0).value, unit: "CHF/month", provenance: "doppel_default", source: FAMILY_ALLOWANCE_PARAM(cantonAt(start), 0).source, url: FAMILY_ALLOWANCE_PARAM(p.canton, 0).url, asOf: CHILD.taxDeductionFederal.asOf });

  // 5. From 16: apprenticeship or the way to university. "auto" draws the track per simulated future.
  const track = d.tertiaryTrack ?? "auto";
  let altIndex: number | undefined;
  if (track === "auto") {
    const prob = clamp(pick(ctx, e, "child", "uniProb", num(d.uniProb), CHILD.uniProb).value, 0, 1);
    altIndex = plan.alternatives.length;
    plan.alternatives.push({ eventId: e.id, prob, label: { key: "life.alt.university" } });
  }
  const alt = (when: boolean): Partial<LifeLine> => (altIndex === undefined ? {} : { alt: altIndex, altWhen: when });
  const f16 = birth + CHILD.apprenticeFromAge.value * 12;
  const eduAllowanceAt = (m: number) => (grossAt(m) >= CHILD.allowanceMinSalary.value ? FAMILY_ALLOWANCE_PARAM(cantonAt(m), 1).value * (1 - marginal) : 0);
  const eduMeta = { provenance: "doppel_default" as const, source: FAMILY_ALLOWANCE_PARAM(p.canton, 1).source, url: FAMILY_ALLOWANCE_PARAM(p.canton, 1).url };

  if (track !== "university") {
    const years = CHILD.apprenticeYears.value;
    const wages = [CHILD.apprenticeWage1.value, CHILD.apprenticeWage2.value, CHILD.apprenticeWage3.value];
    const cost = line(ctx, e, "child", "apprentice", "expense", { key: "life.line.childApprentice" }, { provenance: "doppel_default", source: CHILD.apprenticeWage1.source, url: CHILD.apprenticeWage1.url, estimate: true }, alt(false));
    const al = line(ctx, e, "child", "eduAllowanceA", "income", { key: "life.line.childEduAllowance" }, eduMeta, alt(false));
    const tx = line(ctx, e, "child", "taxA", "income", { key: "life.line.childTax" }, { ...DERIVED, source: CHILD.taxDeductionFederal.source }, alt(false));
    for (let m = Math.max(start, f16); m < Math.min(months, f16 + years * 12); m++) {
      const y = Math.min(wages.length - 1, Math.floor((m - f16) / 12));
      cost[m] += Math.max(0, teen - CHILD.apprenticeWageShare.value * wages[y]);
      al[m] += eduAllowanceAt(m);
      if (grossAt(m) > 0) tx[m] += taxSaving;
    }
    if (altIndex === undefined) {
      marker(ctx, e, f16, "apprenticeStart", { key: "life.marker.apprenticeStart" });
      marker(ctx, e, f16 + years * 12, "childIndependent", { key: "life.marker.childIndependent" });
    }
  }
  if (track !== "apprenticeship") {
    const uFrom = birth + CHILD.uniFromAge.value * 12;
    const uTo = uFrom + CHILD.uniYears.value * 12;
    const away = d.uniLivesAway !== false;
    const living = away ? CHILD.uniLivingAway : CHILD.uniLivingHome;
    const school = line(ctx, e, "child", "school16", "expense", { key: "life.line.childDirect" }, { provenance: CHILD.direct13to18.provenance, source: CHILD.direct13to18.source, estimate: true }, alt(true));
    const tuition = line(ctx, e, "child", "uniTuition", "expense", { key: "life.line.childUniTuition" }, { provenance: CHILD.uniTuitionYear.provenance, source: CHILD.uniTuitionYear.source, url: CHILD.uniTuitionYear.url }, alt(true));
    const live = line(ctx, e, "child", "uniLiving", "expense", { key: away ? "life.line.childUniLivingAway" : "life.line.childUniLivingHome" }, { provenance: living.provenance, source: living.source, url: living.url, estimate: true }, alt(true));
    const al = line(ctx, e, "child", "eduAllowanceU", "income", { key: "life.line.childEduAllowance" }, eduMeta, alt(true));
    const tx = line(ctx, e, "child", "taxU", "income", { key: "life.line.childTax" }, { ...DERIVED, source: CHILD.taxDeductionFederal.source }, alt(true));
    for (let m = Math.max(start, f16); m < Math.min(months, uTo); m++) {
      if (m < uFrom) school[m] += teen;
      else {
        tuition[m] += CHILD.uniTuitionYear.value / 12;
        live[m] += living.value;
      }
      al[m] += eduAllowanceAt(m);
      if (grossAt(m) > 0) tx[m] += taxSaving;
    }
    if (altIndex === undefined) {
      marker(ctx, e, uFrom, "uniStart", { key: "life.marker.uniStart" });
      marker(ctx, e, uTo, "childIndependent", { key: "life.marker.childIndependent" });
    }
  }
  if (altIndex !== undefined) {
    marker(ctx, e, f16, "childTrack", { key: "life.marker.childTrack", params: { prob: plan.alternatives[altIndex].prob } });
    marker(ctx, e, birth + (CHILD.uniFromAge.value + CHILD.uniYears.value) * 12, "childIndependent", { key: "life.marker.childIndependent" });
  }

  if (birth >= 0) marker(ctx, e, birth, "childBirth", { key: "life.marker.childBirth" });
  marker(ctx, e, birth + 60, "childSchool", { key: "life.marker.childSchool" });
  marker(ctx, e, birth + 156, "childTeen", { key: "life.marker.childTeen" });
}

/**
 * Compiles the decisions among `events` for `profile` over `months` simulated months.
 * `retireMonth` = month the salary stops (the partner is assumed to retire with the user).
 */
export function compileLife(profile: Profile, events: readonly LifeEvent[], months: number, retireMonth: number): LifePlan {
  const decided = events.filter((e) => e.decision && e.month >= 0 && e.month < months).sort((a, b) => a.month - b.month);
  const cantons: { month: number; canton: string }[] = [];
  const plan: LifePlan = {
    months,
    empty: decided.length === 0,
    lines: [],
    oneOffs: [],
    markers: [],
    inputsNeeded: [],
    params: [],
    alternatives: [],
    loans: [],
    workFactor: new Float64Array(decided.length ? months : 0).fill(1),
    partnerWorkFactor: new Float64Array(decided.length ? months : 0).fill(1),
    self: new Uint8Array(decided.length ? months : 0),
    selfNet: new Float64Array(decided.length ? months : 0),
    selfVol: new Float64Array(decided.length ? months : 0),
    raise: new Float64Array(decided.length ? months : 0),
    partnerNet: new Float64Array(decided.length ? months : 0),
    partnerGross: new Float64Array(decided.length ? months : 0),
    married: new Uint8Array(decided.length ? months : 0),
    rent: new Float64Array(decided.length ? months : 0).fill(profile.rentMonth),
    cantonAt: (month) => {
      let c = profile.canton;
      for (const x of cantons) if (x.month <= month) c = x.canton;
      return c;
    },
  };
  if (plan.empty) return plan;
  const ctx: Ctx = { p: profile, months, retireMonth: Math.min(months, Math.max(0, retireMonth)), plan };

  // Household structure first (it decides incomes, rent and canton), then the car, then the children.
  for (const e of decided) {
    const d = e.decision!;
    if (d.kind === "partner") partner(ctx, e, d);
    else if (d.kind === "move") move(ctx, e, d, cantons);
    else if (d.kind === "selfEmployed") selfEmployed(ctx, e, d);
  }
  // Later starts override earlier ones: "work 80%" and then a sabbatical gives 0% during the sabbatical.
  for (const e of decided) {
    const d = e.decision!;
    if (d.kind === "workload") workload(ctx, e, d);
    else if (d.kind === "education") education(ctx, e, d);
  }
  for (const e of decided) if (e.decision!.kind === "car") car(ctx, e, e.decision as CarDecision);
  const children = decided.filter((e) => e.decision!.kind === "child").map((e) => ({ e, birth: e.month - Math.round((num((e.decision as ChildDecision).ageYears) ?? 0) * 12) }));
  children.sort((a, b) => a.birth - b.birth);
  children.forEach(({ e }, i) => child(ctx, e, e.decision as ChildDecision, i));

  // Structural effects as budget lines (information only: the salary arrays already carry them).
  structuralLines(ctx, decided, events);
  plan.markers.sort((a, b) => a.month - b.month);
  return plan;
}

function structuralLines(ctx: Ctx, decided: LifeEvent[], events: readonly LifeEvent[]) {
  const { p, plan, months } = ctx;
  // The user's own take-home pay at full workload in today's CHF, incl. raises (the engine's rule for a raise).
  const share = BASELINE.raiseNetShare.value / 12;
  const raises = events.filter((e) => e.type === "raise" && !e.decision);
  const ownNet = (m: number) => {
    let net = plan.selfNet[m] > 0 ? plan.selfNet[m] : p.netIncomeMonth;
    net += plan.raise[m] * share;
    for (const e of raises) if (m >= e.month) net += e.amount * share;
    return Math.max(0, net);
  };
  const first = (kind: DecisionKind) => decided.find((e) => e.decision!.kind === kind);
  const partnerEvent = first("partner");
  if (partnerEvent && plan.partnerNet.some((v) => v > 0)) {
    const l = line(ctx, partnerEvent, "partner", "income", "income", { key: "life.line.partnerIncome" }, USER, { structural: true });
    for (let m = 0; m < months; m++) l[m] = plan.partnerNet[m] * plan.partnerWorkFactor[m];
  }
  const rentEvent = decided.find((e) => (e.decision!.kind === "move" || e.decision!.kind === "partner") && num((e.decision as MoveDecision | PartnerDecision).rentMonth) !== undefined);
  if (rentEvent) {
    const l = line(ctx, rentEvent, rentEvent.decision!.kind, "rent", "expense", { key: "life.line.rentChange" }, USER, { structural: true });
    for (let m = 0; m < months; m++) l[m] = plan.rent[m] - p.rentMonth;
  }
  const workEvent = decided.find((e) => e.decision!.kind === "workload" || e.decision!.kind === "education" || (e.decision!.kind === "child" && num((e.decision as ChildDecision).parentWorkloadPct) !== undefined));
  if (workEvent && plan.workFactor.some((v) => v !== 1)) {
    const l = line(ctx, workEvent, workEvent.decision!.kind, "workIncome", "income", { key: "life.line.workloadIncome" }, { ...DERIVED, source: "take-home pay scales with the workload" }, { structural: true });
    for (let m = 0; m < ctx.retireMonth; m++) l[m] = ownNet(m) * (plan.workFactor[m] - 1);
  }
  const selfEvent = first("selfEmployed");
  if (selfEvent && plan.selfNet.some((v) => v > 0)) {
    const l = line(ctx, selfEvent, "selfEmployed", "income", "income", { key: "life.line.selfIncome" }, USER, { structural: true });
    for (let m = 0; m < ctx.retireMonth; m++) if (plan.selfNet[m] > 0) l[m] = plan.selfNet[m] - p.netIncomeMonth;
  }
}

/**
 * The inputs the decisions among `events` still need from the user (no sourced default exists). Empty = every
 * decision is fully specified. Pure; no simulation. Use it before applying a what-if, to ask instead of applying
 * a decision whose effect would silently be zero.
 */
export function inputsNeededFor(profile: Profile, events: readonly LifeEvent[]): LifeInputNeeded[] {
  if (!events.some((e) => e.decision)) return [];
  const retireMonth = Math.max(0, (profile.retirementAge - profile.age) * 12);
  const months = Math.max(12, (Math.max(90, profile.retirementAge + 1) - profile.age) * 12);
  return compileLife(profile, events, months, retireMonth).inputsNeeded;
}

/** Monthly cost of a car decision vs a GA travelcard, today's CHF (no simulation needed). */
export function carVsTransit(d: Partial<CarDecision> = {}) {
  const mode = d.mode === "leased" ? "leased" : "owned";
  const price = num(d.price) ?? CAR.price.value;
  const km = num(d.annualKm) ?? CAR.annualKm.value;
  const fixed = num(d.fixedMonthly) ?? (mode === "leased" ? CAR.fixedLeasedMonth.value : CAR.fixedOwnedMonth.value);
  const running = (km / 12) * (num(d.variablePerKm) ?? CAR.variablePerKm.value);
  const years = Math.max(1, num(d.replaceYears) ?? (mode === "leased" ? CAR.leaseTermYears.value : CAR.replaceYears.value));
  const resale = clamp(num(d.resaleShare) ?? CAR.resaleShare.value, 0, 1);
  // Owned: the value lost between purchase and resale, spread over the holding period. Leased: the instalment.
  const capital = mode === "leased" ? (num(d.leaseMonthly) ?? Math.round((CAR.leaseBudgetShare.value * price) / (years * 12))) : (price * (1 - resale)) / (years * 12);
  const carMonthly = fixed + running + capital;
  const ga = (d.gaClass === 1 ? CAR.gaFirstYear.value : CAR.gaSecondYear.value) / 12;
  return { mode, carMonthly, fixed, running, capital, gaMonthly: ga, halfFareMonthly: CAR.halfFareYear.value / 12, differenceMonthly: carMonthly - ga };
}
