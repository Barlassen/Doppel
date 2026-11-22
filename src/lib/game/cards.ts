/**
 * The deck. Every card is named after a scenario of the UBS catalog (`scenarioId`, text in `ubsScenarioCatalog()`)
 * and is ONE deterministic, parameterised transition on the position. Each parameter states its source:
 *  - `ubs_synthetic_assumption`: a number from the UBS data (scenario_config.json, scenario-assumptions.csv, or a
 *    figure written in the catalog's intervention text such as "six-month buffer" or "reduce hours to 80%")
 *  - `doppel_engine_default`: Doppel's labelled modelling default (Swiss rules in `src/lib/finance`, or a stated estimate)
 *  - `user`: set by the player
 * Rules: asset classes only (no single securities), no hindsight (a card never looks at future markets).
 */
import { EQUITY_WEIGHT } from "./sim";
import { AMORTISATION_YEARS, ACTUAL_MORTGAGE_RATE, FIRST_MORTGAGE_SHARE, PILLAR_3A_MAX, closingCostRate, maxAffordablePrice, tragbarkeit } from "@/lib/finance/swissRules";
import { P3A_PAYOUT_TAX } from "@/lib/finance/pension";
import { type Regime, uniform } from "./regime";
import {
  type GameState,
  type Ledger,
  LedgerBuilder,
  MIN_BUFFER_MONTHS,
  balances,
  bufferMonths,
  cloneState,
  grossFromNet,
  incomeAt,
  marginalTaxFor,
  monthlyOutflow,
  monthlySurplus,
  phaseAt,
} from "./state";
import { CAR, CHILD, EDUCATION } from "@/lib/finance/params";
import { lifeCostPlan, withLifeCost, withoutLifeCost } from "./lifeCosts";

export type ParamSource = "ubs_synthetic_assumption" | "doppel_engine_default" | "user";

/**
 * Life preferences the player can declare at the start. A declared preference turns its card into a life choice:
 * the engine shows its cost but does not grade it (and never names it the best move), and the card is dealt whenever
 * it is eligible. Undeclared, the same card is graded like any other decision.
 */
export const LIFE_PREFS = ["children", "partner", "home", "car", "sabbatical", "earlyRetire"] as const;
export type LifePref = (typeof LIFE_PREFS)[number];
export const PREF_CARD: Record<LifePref, string> = {
  children: "haveChild",
  partner: "movePartner",
  home: "buyHome",
  car: "buyCar",
  sabbatical: "sabbatical",
  earlyRetire: "retireEarly",
};
/** The card is a life choice the player declared (not graded). */
export const declaredChoice = (s: { prefs?: string[] }, card: string) => (s.prefs ?? []).some((p) => PREF_CARD[p as LifePref] === card);
export type ParamUnit = "chf" | "chfMonth" | "chfYear" | "pct" | "months" | "years" | "age" | "daysWeek";

export interface CardParam {
  key: string;
  value: number;
  unit: ParamUnit;
  source: ParamSource;
  /** Where a UBS number comes from (assumption id, file or catalog row). */
  ref?: string;
}

export type CardKind = "decision" | "life";
export type CardGroup = "path" | "career" | "housing" | "spending" | "saving" | "family" | "macro" | "life" | "retirement" | "business";

export interface CardDef {
  id: string;
  kind: CardKind;
  scenarioId: string;
  group: CardGroup;
  /** Allowed when the king is in check (it improves liquidity). */
  response?: boolean;
  /** A life choice (children, partner, sabbatical): the engine shows its cost but does not grade it. */
  lifeChoice?: boolean;
  /** Its cost recurs every month (candidate for the drain tag). */
  recurring?: boolean;
  /** Turns before it can be played again (Infinity = once per game). */
  cooldown?: number;
  eligible: (s: GameState) => boolean;
  params: (s: GameState, r: Regime) => CardParam[];
  apply: (s: GameState, p: Record<string, number>, L: LedgerBuilder, r: Regime) => void;
}

const D = "doppel_engine_default" as const;
/** Selling a home: agent, notary and transfer costs (Doppel default). */
const SALE_COSTS = 0.03;
/** Renting a comparable flat after selling: gross rental yield on the home's value (Doppel default). */
const RENT_YIELD = 0.035;
const U = "ubs_synthetic_assumption" as const;
const param = (key: string, value: number, unit: ParamUnit, source: ParamSource = D, ref?: string): CardParam => ({ key, value, unit, source, ref });
const round = (x: number, step: number) => Math.round(x / step) * step;
const floorTo = (x: number, step: number) => Math.floor(x / step) * step;

/** Take-home share of a gross change (social deductions, marginal tax). */
const netShare = (s: GameState) => Math.max(0.3, 1 - 0.13 - s.marginalTaxRate);
const employed = (s: GameState) => s.gross > 0 && s.path !== "student" && !phaseAt(s, 0);
const excessCash = (s: GameState) => Math.max(0, s.cash - MIN_BUFFER_MONTHS * monthlyOutflow(s));
/** Investing idle cash keeps one month more than the check line, so inflation alone does not put you in check. */
const IDLE_BUFFER = MIN_BUFFER_MONTHS + 1;
const idleAbove = (s: GameState) => Math.max(0, s.cash - IDLE_BUFFER * monthlyOutflow(s));

function pay(s: GameState, L: LedgerBuilder, amount: number, kind: "card" | "event" = "card") {
  s.cash -= amount;
  L.add("cash", kind, -amount);
}

function changeGross(s: GameState, factor: number) {
  const delta = s.gross * (factor - 1);
  s.gross += delta;
  s.net += (delta * netShare(s)) / 12;
}

/** A change of workload: gross and take-home pay scale proportionally (the engine's rule for a workload decision). */
function scaleWorkload(s: GameState, factor: number) {
  s.gross *= factor;
  s.net *= factor;
}

/** Monthly payment of an amortising loan. */
const annuity = (principal: number, rate: number, months: number) => {
  const r = rate / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
};

function homePlan(s: GameState) {
  const closingRate = closingCostRate(s.canton);
  const hard = excessCash(s) + s.portfolio + s.pillar3a;
  const max = maxAffordablePrice(s.gross, hard, s.pillar2, closingRate);
  const price = floorTo(max * 0.95, 10_000);
  return { price, closingRate, hard, plan: tragbarkeit({ price, grossIncomeYear: s.gross, hardEquityAvailable: hard, pillar2Available: s.pillar2, closingRate }) };
}

// Alexia's three paths (scenario_config.json) and S001 (scenario-assumptions.csv).
function alexia(s: GameState, i: number, fallback: { net: number; exp: number }[], oneOff = 0) {
  const path = s.ubs.alexiaPaths?.[i];
  const src: ParamSource = path ? U : D;
  const ref = path ? "scenario_config.json · " + path.name : undefined;
  const phases = path?.phases.map((p) => ({ net: p.monthlyIncomeChf, exp: p.monthlyExpensesChf, start: p.startMonth, end: p.endMonth })) ??
    fallback.map((f, k) => ({ ...f, start: k === 0 ? 0 : 24, end: k === 0 && fallback.length > 1 ? 24 : 120 }));
  return { src, ref, phases, oneOff: path ? path.oneOffCosts.reduce((a, c) => a + c.amountChf, 0) : oneOff };
}

const student = (s: GameState) => s.path === "student";

/** The engine's cost model for the next child / for a car bought now (see lifeCosts.ts). */
const childPlan = (s: GameState) => lifeCostPlan(s, "child-" + (s.children + 1), "child", { kind: "child" });
const carPlan = (s: GameState) => lifeCostPlan(s, "car", "car", { kind: "car", mode: "owned" });

function startStudy(s: GameState, p: Record<string, number>, L: LedgerBuilder) {
  const months = p.studyYears * 12;
  const taxAfter = marginalTaxFor(p.incomeAfter, s.canton);
  s.phases = [{ start: 0, end: months, net: p.incomeDuring, gross: 0, expenses: p.expensesDuring, bvg: false, kind: "study" }];
  s.marginalTaxRate = taxAfter;
  s.net = p.incomeAfter;
  s.gross = grossFromNet(p.incomeAfter, taxAfter);
  s.expenses = p.expensesAfter;
  pay(s, L, p.tuition);
  for (let y = 1; y < p.studyYears; y++) s.oneOffs.push({ month: 12 * y, amount: p.tuition });
  s.path = "master";
}

function studyParams(s: GameState): CardParam[] {
  const a = alexia(s, 1, [{ net: 1200, exp: 2100 }, { net: 4800, exp: 3100 }]);
  const s001 = s.ubs.s001;
  const sRef = s001 ? "S001 · " + s001.ids.join(", ") : undefined;
  return [
    // Without UBS figures for this profile: the engine's sourced values for a master's (params.ts EDUCATION).
    param("studyYears", s001?.years ?? EDUCATION.masterMonths.value / 12, "years", s001 ? U : D, s001 ? sRef : EDUCATION.masterMonths.source),
    param("tuition", s001?.tuition ?? EDUCATION.tuitionYear.value, "chfYear", s001 ? U : D, s001 ? sRef : EDUCATION.tuitionYear.source),
    param("incomeDuring", a.phases[0].net, "chfMonth", a.src, a.ref),
    param("expensesDuring", a.phases[0].exp, "chfMonth", a.src, a.ref),
    param("incomeAfter", a.phases[1]?.net ?? 4800, "chfMonth", a.src, a.ref),
    param("expensesAfter", a.phases[1]?.exp ?? 3100, "chfMonth", a.src, a.ref),
  ];
}

export const HOLD: CardDef = {
  id: "hold",
  kind: "decision",
  scenarioId: "",
  group: "saving",
  eligible: () => true,
  params: () => [],
  apply: () => {},
};

export const DECISION_CARDS: CardDef[] = [
  // ---------------- the first decision for a student (Alexia) ----------------
  {
    id: "pathWork",
    kind: "decision",
    scenarioId: "S011",
    group: "path",
    eligible: student,
    params: (s) => {
      const a = alexia(s, 0, [{ net: 4200, exp: 3000 }]);
      return [param("income", a.phases[0].net, "chfMonth", a.src, a.ref), param("expenses", a.phases[0].exp, "chfMonth", a.src, a.ref)];
    },
    apply: (s, p) => {
      s.marginalTaxRate = marginalTaxFor(p.income, s.canton);
      s.net = p.income;
      s.gross = grossFromNet(p.income, s.marginalTaxRate);
      s.expenses = p.expenses;
      s.path = "work";
    },
  },
  {
    id: "pathMaster",
    kind: "decision",
    scenarioId: "S001",
    group: "path",
    eligible: student,
    params: studyParams,
    apply: (s, p, L) => startStudy(s, p, L),
  },
  {
    id: "pathMasterLoan",
    kind: "decision",
    scenarioId: "S009",
    group: "path",
    eligible: student,
    params: (s) => [
      ...studyParams(s),
      param("loan", 30_000, "chf"),
      param("loanRate", 0.025, "pct"),
      param("loanPayment", 450, "chfMonth"),
    ],
    apply: (s, p, L) => {
      s.cash += p.loan;
      L.add("cash", "card", p.loan);
      s.debts.push({ id: "debt-study", kind: "student", principal: p.loan, rate: p.loanRate, monthlyPayment: p.loanPayment, startMonth: p.studyYears * 12 });
      L.add("debt", "card", p.loan);
      startStudy(s, p, L);
    },
  },
  {
    id: "pathAbroad",
    kind: "decision",
    scenarioId: "S023",
    group: "path",
    eligible: student,
    params: (s) => {
      const a = alexia(s, 2, [{ net: 3700, exp: 2900 }], 6500);
      return [
        param("income", a.phases[0].net, "chfMonth", a.src, a.ref),
        param("expenses", a.phases[0].exp, "chfMonth", a.src, a.ref),
        param("moveCost", a.oneOff, "chf", a.src, a.ref),
      ];
    },
    apply: (s, p, L) => {
      s.marginalTaxRate = marginalTaxFor(p.income, s.canton);
      s.net = p.income;
      s.gross = grossFromNet(p.income, s.marginalTaxRate);
      s.expenses = p.expenses;
      s.abroad = true;
      s.contributes3a = false;
      pay(s, L, p.moveCost);
      s.path = "abroad";
    },
  },

  // ---------------- career ----------------
  {
    id: "bootcamp",
    kind: "decision",
    scenarioId: "S006",
    group: "career",
    cooldown: Infinity,
    eligible: (s) => employed(s) && s.age < 55,
    params: () => [param("cost", 6000, "chf"), param("months", 3, "months"), param("payDuring", 0.5, "pct"), param("raise", 0.1, "pct")],
    apply: (s, p, L) => {
      pay(s, L, p.cost);
      s.phases.push({ start: 0, end: p.months, net: s.net * p.payDuring, gross: s.gross * p.payDuring, bvg: true, kind: "training" });
      changeGross(s, 1 + p.raise);
    },
  },
  {
    id: "negotiate",
    kind: "decision",
    scenarioId: "S012",
    group: "career",
    cooldown: Infinity,
    eligible: (s) => employed(s),
    params: () => [param("raise", 0.03, "pct")],
    apply: (s, p) => changeGross(s, 1 + p.raise),
  },
  {
    id: "partTime",
    kind: "decision",
    scenarioId: "S017",
    group: "career",
    eligible: (s) => employed(s) && s.workPct === 1,
    params: () => [param("workPct", 0.8, "pct", U, "S017 catalog: reduce hours to 80%")],
    // The engine's workload rule (life.ts): salary and take-home pay scale with the percentage.
    apply: (s, p) => {
      scaleWorkload(s, p.workPct);
      s.workPct = p.workPct;
    },
  },
  {
    id: "fullTime",
    kind: "decision",
    scenarioId: "S017",
    group: "career",
    response: true,
    eligible: (s) => s.workPct < 1 && s.gross > 0 && !phaseAt(s, 0),
    params: (s) => [param("workPct", 1 / s.workPct - 1, "pct")],
    apply: (s, p) => {
      scaleWorkload(s, 1 + p.workPct);
      s.workPct = 1;
    },
  },
  {
    id: "sideJob",
    kind: "decision",
    scenarioId: "S020",
    group: "career",
    response: true,
    cooldown: Infinity,
    eligible: (s) => s.path !== "abroad" && s.age < 60,
    params: () => [param("extraNet", 900, "chfMonth")],
    apply: (s, p) => {
      s.net += p.extraNet;
      s.gross += Math.round((p.extraNet * 12) / netShare(s));
      for (const ph of s.phases) ph.net += p.extraNet;
    },
  },
  {
    id: "sabbatical",
    kind: "decision",
    scenarioId: "S044",
    group: "career",
    lifeChoice: true,
    cooldown: Infinity,
    eligible: (s) => employed(s) && excessCash(s) > 7000 + 6 * monthlyOutflow(s),
    params: () => [param("months", 6, "months", U, "S044 catalog: six-month unpaid travel"), param("travel", 7000, "chf")],
    apply: (s, p, L) => {
      pay(s, L, p.travel);
      s.phases.push({ start: 0, end: p.months, net: 0, gross: 0, bvg: false, kind: "gap" });
    },
  },

  // ---------------- housing ----------------
  {
    id: "buyHome",
    kind: "decision",
    scenarioId: "S033",
    group: "housing",
    eligible: (s) => !s.home && !s.abroad && !s.sharedFlat && s.gross > 0 && !phaseAt(s, 0) && s.path !== "student" && homePlan(s).price >= 250_000 && homePlan(s).plan.pass,
    params: (s) => {
      const h = homePlan(s);
      return [
        param("price", h.price, "chf"),
        param("equity", h.plan.equity, "chf"),
        param("loan", h.plan.loan, "chf"),
        param("closingRate", h.closingRate, "pct"),
        param("mortgageRate", ACTUAL_MORTGAGE_RATE, "pct"),
        param("maintenance", 0.01, "pct"),
      ];
    },
    apply: (s, p, L) => {
      const closingRate = p.closingRate;
      const hard = excessCash(s) + s.portfolio + s.pillar3a;
      const plan = tragbarkeit({ price: p.price, grossIncomeYear: s.gross, hardEquityAvailable: hard, pillar2Available: s.pillar2, closingRate });
      let need = plan.hardUsed + plan.closingCosts;
      const fromCash = Math.min(need, excessCash(s));
      s.cash -= fromCash;
      L.add("cash", "purchase", -fromCash);
      need -= fromCash;
      const fromPort = Math.min(need, s.portfolio);
      s.portfolio -= fromPort;
      L.add("portfolio", "purchase", -fromPort);
      need -= fromPort;
      const from3a = Math.min(need, s.pillar3a);
      s.pillar3a -= from3a;
      L.add("pillar3a", "purchase", -from3a);
      s.pillar2 -= plan.pillar2Used;
      L.add("pillar2", "purchase", -plan.pillar2Used);
      const floor = p.price * FIRST_MORTGAGE_SHARE;
      s.home = { value: p.price, mortgage: plan.loan, rate: p.mortgageRate, floor, amortMonthly: Math.max(0, plan.loan - floor) / AMORTISATION_YEARS / 12 };
      L.add("homeValue", "purchase", p.price);
      L.add("mortgage", "purchase", plan.loan);
      s.expenses -= s.rent;
      s.rent = 0;
    },
  },
  {
    id: "flatmates",
    kind: "decision",
    scenarioId: "S032",
    group: "housing",
    response: true,
    eligible: (s) => !s.home && !s.sharedFlat && !s.partner && s.rent > 600,
    params: () => [param("rentCut", 0.4, "pct")],
    apply: (s, p) => {
      const cut = s.rent * p.rentCut;
      s.rent -= cut;
      s.expenses -= cut;
      s.sharedFlat = true;
    },
  },
  {
    id: "nicerFlat",
    kind: "decision",
    scenarioId: "S031",
    group: "housing",
    recurring: true,
    cooldown: 3,
    eligible: (s) => !s.home && s.path !== "student",
    params: () => [param("extraRent", 500, "chfMonth")],
    apply: (s, p) => {
      s.rent += p.extraRent;
      s.expenses += p.extraRent;
      s.sharedFlat = false;
    },
  },
  {
    id: "repayDebt",
    kind: "decision",
    scenarioId: "S074",
    group: "housing",
    eligible: (s) => excessCash(s) >= 5000 && (s.debts.length > 0 || (!!s.home && s.home.mortgage > 0)),
    params: (s) => {
      const target = s.debts.length ? Math.max(...s.debts.map((d) => d.principal)) : s.home?.mortgage ?? 0;
      return [param("amount", Math.min(20_000, floorTo(excessCash(s), 1000), Math.ceil(target)), "chf")];
    },
    apply: (s, p, L) => {
      let left = p.amount;
      for (const d of [...s.debts].sort((a, b) => b.rate - a.rate)) {
        const x = Math.min(left, d.principal);
        d.principal -= x;
        L.add("debt", "card", -x);
        pay(s, L, x);
        left -= x;
      }
      s.debts = s.debts.filter((d) => d.principal > 0.5);
      if (left > 0 && s.home) {
        const x = Math.min(left, s.home.mortgage);
        s.home.mortgage -= x;
        L.add("mortgage", "card", -x);
        pay(s, L, x);
      }
    },
  },

  // ---------------- spending ----------------
  {
    id: "buyCar",
    kind: "decision",
    scenarioId: "S042",
    group: "spending",
    recurring: true,
    eligible: (s) => !s.car && s.path !== "student",
    // The dashboard's car decision (life.ts, TCS 2026 in params.ts): the reference car, its fixed and per-km costs,
    // a replacement every ten years net of the trade-in, until 80. The game adds the car loan when cash is short
    // (the dashboard has no car loan: there the purchase is a cash crunch).
    params: (s) => {
      const car = carPlan(s);
      return [
        param("price", Math.round(-car.upfront * s.priceIndex), "chf", D, CAR.price.source),
        param("running", Math.round(car.firstYearMonthly * s.priceIndex), "chfMonth", D, CAR.fixedOwnedMonth.source),
        param("replaceYears", CAR.replaceYears.value, "years", D, CAR.replaceYears.source),
        param("financed", excessCash(s) >= -car.upfront * s.priceIndex ? 0 : 1, "pct"),
        param("loanRate", 0.069, "pct"),
      ];
    },
    apply: (s, p, L) => {
      const car = carPlan(s);
      const price = -car.upfront * s.priceIndex;
      if (p.financed > 0) {
        s.debts.push({ id: "debt-car", kind: "car", principal: price, rate: p.loanRate, monthlyPayment: annuity(price, p.loanRate, 48), startMonth: 0 });
        L.add("debt", "card", price);
      } else pay(s, L, price);
      s.car = { value: price, monthly: car.firstYearMonthly * s.priceIndex };
      withLifeCost(s, car.cost);
    },
  },
  {
    id: "sellCar",
    kind: "decision",
    scenarioId: "S043",
    group: "spending",
    response: true,
    eligible: (s) => !!s.car,
    params: (s) => [param("resale", Math.round(s.car?.value ?? 0), "chf"), param("running", Math.round(s.car?.monthly ?? 0), "chfMonth")],
    apply: (s, p, L) => {
      s.cash += p.resale;
      L.add("cash", "sale", p.resale);
      const loan = s.debts.find((d) => d.kind === "car");
      if (loan) {
        const x = Math.min(loan.principal, s.cash);
        loan.principal -= x;
        L.add("debt", "card", -x);
        pay(s, L, x);
        s.debts = s.debts.filter((d) => d.principal > 0.5);
      }
      // The running costs and the planned replacements stop with the car.
      withoutLifeCost(s, "car");
      s.car = null;
    },
  },
  {
    id: "cutSpending",
    kind: "decision",
    scenarioId: "S041",
    group: "spending",
    response: true,
    cooldown: 3,
    eligible: (s) => s.expenses + s.expenseDelta - s.rent > 1000,
    params: (s) => [param("cutShare", 0.08, "pct"), param("cut", round(0.08 * (s.expenses + s.expenseDelta - s.rent), 10), "chfMonth")],
    apply: (s, p) => {
      s.expenseDelta -= p.cut;
    },
  },
  {
    id: "lifestyle",
    kind: "decision",
    scenarioId: "S046",
    group: "spending",
    recurring: true,
    cooldown: 3,
    eligible: (s) => s.path !== "student" && monthlySurplus(s) > 400,
    params: () => [param("extra", 400, "chfMonth")],
    apply: (s, p) => {
      s.expenseDelta += p.extra;
    },
  },
  {
    id: "subscriptions",
    kind: "decision",
    scenarioId: "S045",
    group: "spending",
    response: true,
    cooldown: Infinity,
    eligible: () => true,
    params: () => [param("saving", 45, "chfMonth")],
    apply: (s, p) => {
      s.expenseDelta -= p.saving;
    },
  },

  // ---------------- saving and investing (asset classes only) ----------------
  {
    id: "emergencyFund",
    kind: "decision",
    scenarioId: "S051",
    group: "saving",
    response: true,
    cooldown: 2,
    eligible: (s) => bufferMonths(s) < 6 && (s.investShare > 0 || s.monthlyInvest > 0 || s.portfolio > 500),
    params: (s) => [param("months", 6, "months", U, "S051 catalog: maintain six-month buffer"), param("topUp", Math.round(Math.max(0, Math.min(s.portfolio, 6 * monthlyOutflow(s) - s.cash))), "chf")],
    apply: (s, p, L) => {
      s.portfolio -= p.topUp;
      L.move("portfolio", "cash", "sale", p.topUp);
      s.cash += p.topUp;
      s.monthlyInvest = 0;
      s.investShare = 0;
    },
  },
  {
    id: "investMonthly",
    kind: "decision",
    scenarioId: "S052",
    group: "saving",
    eligible: (s) => s.monthlyInvest === 0 && monthlySurplus(s) >= 200 && !phaseAt(s, 0),
    params: (s) => [param("amount", Math.min(3000, Math.max(100, round(0.5 * monthlySurplus(s), 50))), "chfMonth"), param("equityShare", EQUITY_WEIGHT[s.riskProfile], "pct")],
    apply: (s, p) => {
      s.monthlyInvest = p.amount;
    },
  },
  {
    id: "investIdle",
    kind: "decision",
    scenarioId: "S061",
    group: "saving",
    eligible: (s) => idleAbove(s) >= 2000,
    params: (s) => [param("amount", floorTo(idleAbove(s), 100), "chf"), param("equityShare", EQUITY_WEIGHT[s.riskProfile], "pct"), param("bufferMonths", IDLE_BUFFER, "months")],
    apply: (s, p, L) => {
      s.cash -= p.amount;
      s.portfolio += p.amount;
      L.move("cash", "portfolio", "invest", p.amount);
      s.investShare = 1;
    },
  },
  {
    id: "pauseInvest",
    kind: "decision",
    scenarioId: "S067",
    group: "saving",
    response: true,
    eligible: (s) => s.monthlyInvest > 0 || s.investShare > 0,
    params: (s) => [param("amount", s.monthlyInvest, "chfMonth")],
    apply: (s) => {
      s.monthlyInvest = 0;
      s.investShare = 0;
    },
  },
  {
    id: "moreEquity",
    kind: "decision",
    scenarioId: "S062",
    group: "saving",
    eligible: (s) => s.riskProfile !== "growth" && (s.portfolio > 1000 || s.monthlyInvest > 0 || s.investShare > 0),
    params: () => [param("equityShare", EQUITY_WEIGHT.growth, "pct")],
    apply: (s) => {
      s.riskProfile = "growth";
    },
  },
  {
    id: "addBonds",
    kind: "decision",
    scenarioId: "S063",
    group: "saving",
    eligible: (s) => s.riskProfile !== "conservative" && s.portfolio > 1000,
    params: () => [param("equityShare", EQUITY_WEIGHT.conservative, "pct")],
    apply: (s) => {
      s.riskProfile = "conservative";
    },
  },
  {
    id: "start3a",
    kind: "decision",
    scenarioId: "S093",
    group: "saving",
    eligible: (s) => !s.contributes3a && !s.abroad && employed(s) && incomeAt(s, 0).gross > 0,
    params: (s) => [param("max", PILLAR_3A_MAX, "chfYear"), param("taxRate", s.marginalTaxRate, "pct")],
    apply: (s) => {
      s.contributes3a = true;
    },
  },
  {
    id: "stop3a",
    kind: "decision",
    scenarioId: "S094",
    group: "saving",
    response: true,
    eligible: (s) => s.contributes3a,
    params: () => [param("max", PILLAR_3A_MAX, "chfYear")],
    apply: (s) => {
      s.contributes3a = false;
    },
  },

  // ---------------- family (life choices: shown, not graded) ----------------
  {
    id: "haveChild",
    kind: "decision",
    scenarioId: "S082",
    group: "family",
    lifeChoice: true,
    recurring: true,
    cooldown: 2,
    eligible: (s) => s.children < 3 && s.age >= 22 && s.age <= 45 && s.path !== "student",
    // The dashboard's child decision (life.ts; BFS HABE, BSV and ESTV figures in params.ts): direct costs by age,
    // daycare from six months to four and a half, family allowances and tax relief, then an apprenticeship or
    // university (expected value). No pay cut during leave: the engine has none either.
    params: (s) => {
      const child = childPlan(s);
      return [
        param("monthly", Math.round(child.firstYearMonthly * s.priceIndex), "chfMonth", D, CHILD.direct0to4.source),
        param("tenYear", Math.round(child.tenYearMonthly * s.priceIndex), "chfMonth", D, CHILD.direct5to12.source),
        param("kitaDays", CHILD.kitaDaysPerWeek.value, "daysWeek", D, CHILD.kitaDaily.source),
      ];
    },
    apply: (s) => {
      const child = childPlan(s);
      s.children += 1;
      withLifeCost(s, child.cost);
    },
  },
  {
    id: "movePartner",
    kind: "decision",
    scenarioId: "S081",
    group: "family",
    lifeChoice: true,
    cooldown: Infinity,
    eligible: (s) => !s.partner && !s.home && !s.sharedFlat && s.age >= 21,
    params: () => [param("rentShare", 0.45, "pct"), param("livingShare", 0.15, "pct")],
    apply: (s, p) => {
      const rentCut = s.rent * p.rentShare;
      const livingCut = (s.expenses - s.rent) * p.livingShare;
      s.rent -= rentCut;
      s.expenses -= rentCut + livingCut;
      s.partner = true;
    },
  },

  // ---------------- retirement (UBS catalog S091, S092, S099; Doppel cards for downsizing and selling) ----------------
  {
    id: "retireEarly",
    kind: "decision",
    scenarioId: "S091",
    group: "retirement",
    cooldown: Infinity,
    eligible: (s) => !s.pension && s.gross > 0 && s.age >= 55 && s.retirementAge > Math.max(60, s.age + 1),
    params: (s) => [param("retireAge", Math.max(60, s.age + 1), "age", U, "S091 · Retire at 60")],
    apply: (s, p) => {
      s.retirementAge = p.retireAge;
    },
  },
  {
    id: "workLonger",
    kind: "decision",
    scenarioId: "S092",
    group: "retirement",
    cooldown: Infinity,
    eligible: (s) => !s.pension && s.gross > 0 && s.age >= 58 && s.retirementAge < 67,
    params: () => [param("retireAge", 67, "age", U, "S092 · Retire at 67")],
    apply: (s, p) => {
      s.retirementAge = p.retireAge;
    },
  },
  {
    id: "lumpSum",
    kind: "decision",
    scenarioId: "S099",
    group: "retirement",
    cooldown: Infinity,
    eligible: (s) => !s.pension && !s.lumpSum && s.pillar2 > 0 && s.age >= s.retirementAge - 3,
    params: (s) => [param("amount", round(s.pillar2, 1000), "chf"), param("withdrawalTax", P3A_PAYOUT_TAX, "pct")],
    apply: (s) => {
      s.lumpSum = true;
    },
  },
  {
    id: "workInRetirement",
    kind: "decision",
    scenarioId: "S092",
    group: "retirement",
    cooldown: Infinity,
    eligible: (s) => !!s.pension && s.age < 72 && !s.phases.some((p) => p.kind === "retiredWork"),
    params: () => [param("income", 1500, "chfMonth"), param("months", 36, "months")],
    apply: (s, p) => {
      s.phases.push({ start: 0, end: p.months, net: p.income, gross: (p.income * 12) / (1 - 0.13), bvg: false, kind: "retiredWork" });
    },
  },
  {
    id: "downsize",
    kind: "decision",
    scenarioId: "",
    group: "retirement",
    response: true,
    cooldown: Infinity,
    eligible: (s) => (!!s.pension || s.age >= 60) && !s.home && !s.sharedFlat && s.rent > 1200,
    params: (s) => [param("rentShare", 0.3, "pct"), param("rentCut", round(s.rent * 0.3, 10), "chfMonth"), param("moveCost", 5000, "chf")],
    apply: (s, p, L) => {
      s.rent -= p.rentCut;
      s.expenses -= p.rentCut;
      pay(s, L, p.moveCost);
    },
  },
  {
    id: "sellHome",
    kind: "decision",
    scenarioId: "",
    group: "retirement",
    response: true,
    cooldown: Infinity,
    eligible: (s) => !!s.home && (!!s.pension || s.age >= 60),
    params: (s) => {
      const h = s.home!;
      return [
        param("saleProceeds", round(h.value * (1 - SALE_COSTS) - h.mortgage, 1000), "chf"),
        param("newRent", round((h.value * RENT_YIELD) / 12, 10), "chfMonth"),
      ];
    },
    apply: (s, p, L) => {
      const h = s.home!;
      L.add("homeValue", "sale", -h.value);
      L.add("mortgage", "sale", -h.mortgage);
      s.cash += p.saleProceeds;
      L.add("cash", "sale", p.saleProceeds);
      s.home = null;
      s.rent = p.newRent;
      s.expenses += p.newRent;
    },
  },

  // ---------------- business (UBS catalog S111–S120); promotion = shop (rook) or factory (queen) ----------------
  {
    id: "startBusiness",
    kind: "decision",
    scenarioId: "S111",
    group: "business",
    cooldown: 3,
    eligible: (s) => !s.business && !s.pension && s.path !== "student" && s.age >= 21 && s.age <= 60 && excessCash(s) + s.portfolio >= BUSINESS_START.capital * BUSINESS_START.equityShare,
    params: () => [
      param("capital", BUSINESS_START.capital, "chf"),
      param("equityShare", BUSINESS_START.equityShare, "pct"),
      param("loanRate", BUSINESS_LOAN_RATE, "pct", D, "S119 · Business loan"),
      param("survival5", 0.5, "pct", D, "BFS UDEMO: about half of new firms active after 5 years"),
    ],
    apply: (s, p, L) => {
      const own = p.capital * p.equityShare;
      fundFromSavings(s, L, own);
      startLoan(s, L, "debt-business", p.capital - own, p.loanRate, 60);
      s.business = { kind: "venture", capital: p.capital, years: 0, profitRate: 0.15, hazard: 0.12, policy: "reinvest", staff: 0 };
      L.add("business", "purchase", p.capital);
    },
  },
  {
    id: "growBusiness",
    kind: "decision",
    scenarioId: "S113",
    group: "business",
    eligible: (s) => !!s.business && excessCash(s) >= 10_000,
    params: () => [param("amount", 10_000, "chf"), param("hazardCut", 0.01, "pct")],
    apply: (s, p, L) => {
      const b = s.business!;
      s.cash -= p.amount;
      L.add("cash", "business", -p.amount);
      b.capital += p.amount;
      L.add("business", "business", p.amount);
      b.hazard = Math.max(0.03, b.hazard - p.hazardCut);
    },
  },
  {
    id: "takeProfits",
    kind: "decision",
    scenarioId: "S118",
    group: "business",
    eligible: (s) => !!s.business && s.business.policy === "reinvest",
    params: () => [param("hazardUp", 0.03, "pct")],
    apply: (s, p) => {
      s.business!.policy = "withdraw";
      s.business!.hazard += p.hazardUp;
    },
  },
  {
    id: "reinvestProfits",
    kind: "decision",
    scenarioId: "S118",
    group: "business",
    eligible: (s) => !!s.business && s.business.policy === "withdraw",
    params: () => [param("hazardCut", 0.03, "pct")],
    apply: (s, p) => {
      s.business!.policy = "reinvest";
      s.business!.hazard = Math.max(0.03, s.business!.hazard - p.hazardCut);
    },
  },
  {
    id: "hireEmployee",
    kind: "decision",
    scenarioId: "S116",
    group: "business",
    cooldown: 3,
    eligible: (s) => !!s.business && s.business.staff < 5 && excessCash(s) + s.portfolio >= 15_000,
    params: () => [param("amount", 30_000, "chf"), param("profitUp", 0.04, "pct"), param("hazardUp", 0.02, "pct")],
    apply: (s, p, L) => {
      const b = s.business!;
      fundFromSavings(s, L, p.amount / 2);
      startLoan(s, L, "debt-business-2", p.amount / 2, BUSINESS_LOAN_RATE, 60);
      b.capital += p.amount;
      L.add("business", "purchase", p.amount);
      b.profitRate += p.profitUp;
      b.hazard += p.hazardUp;
      b.staff += 1;
    },
  },
  {
    id: "sellBusiness",
    kind: "decision",
    scenarioId: "S120",
    group: "business",
    response: true,
    eligible: (s) => !!s.business && s.business.years >= 1,
    params: (s) => [param("saleProceeds", round(s.business!.capital * saleMultiple(s.business!), 1000), "chf")],
    apply: (s, p, L) => {
      L.add("business", "sale", -s.business!.capital);
      s.cash += p.saleProceeds;
      L.add("cash", "sale", p.saleProceeds);
      s.business = null;
    },
  },
  {
    id: "openShop",
    kind: "decision",
    scenarioId: "S111",
    group: "business",
    eligible: (s) => s.business?.kind === "venture" && s.business.years >= PROMOTION_YEARS && ownFunds(s) >= SHOP.cost * SHOP.equityShare,
    params: () => [param("cost", SHOP.cost, "chf"), param("equityShare", SHOP.equityShare, "pct"), param("loanRate", 0.05, "pct", D, "S119 · Business loan")],
    apply: (s, p, L) => promote(s, L, "shop", p),
  },
  {
    id: "buildFactory",
    kind: "decision",
    scenarioId: "S111",
    group: "business",
    eligible: (s) => s.business?.kind === "venture" && s.business.years >= PROMOTION_YEARS && ownFunds(s) >= FACTORY.cost * FACTORY.equityShare,
    params: () => [param("cost", FACTORY.cost, "chf"), param("equityShare", FACTORY.equityShare, "pct"), param("loanRate", 0.05, "pct", D, "S119 · Business loan")],
    apply: (s, p, L) => promote(s, L, "factory", p),
  },
];

// ---------------- business helpers (Doppel defaults; S111–S120 give the scenarios, not these numbers) ----------------

/** A small venture: CHF 40'000, half from savings, half a business loan. */
const BUSINESS_START = { capital: 40_000, equityShare: 0.5 };
const BUSINESS_LOAN_RATE = 0.06;
/** Years a venture must survive before it can be promoted (the pawn reaches the last rank). */
export const PROMOTION_YEARS = 4;
/** Promotion: a shop (rook) or a factory (queen), at least 30% own funds, the rest a 10-year loan at 5%. */
const SHOP = { cost: 150_000, equityShare: 0.3, profitRate: 0.12, hazard: 0.05 };
const FACTORY = { cost: 400_000, equityShare: 0.3, profitRate: 0.14, hazard: 0.06 };

/** Savings that can go into a business: cash above the buffer, the portfolio, and half the business's own value. */
const ownFunds = (s: GameState) => excessCash(s) + s.portfolio + (s.business?.capital ?? 0) * 0.5;
const saleMultiple = (b: { kind: string; years: number }) => (b.kind === "venture" ? 0.8 : 1) + Math.min(0.3, b.years * 0.05);

function fundFromSavings(s: GameState, L: LedgerBuilder, amount: number) {
  const fromCash = Math.min(amount, Math.max(0, excessCash(s)));
  s.cash -= fromCash;
  L.add("cash", "business", -fromCash);
  const fromPort = Math.min(amount - fromCash, s.portfolio);
  s.portfolio -= fromPort;
  L.add("portfolio", "business", -fromPort);
  const rest = amount - fromCash - fromPort;
  if (rest > 0) {
    s.cash -= rest;
    L.add("cash", "business", -rest);
  }
}

function startLoan(s: GameState, L: LedgerBuilder, id: string, principal: number, rate: number, months: number) {
  if (principal <= 0) return;
  const existing = s.debts.find((d) => d.id === id);
  const total = principal + (existing?.principal ?? 0);
  const monthlyPayment = annuity(total, rate, months);
  if (existing) Object.assign(existing, { principal: total, rate, monthlyPayment, startMonth: 0 });
  else s.debts.push({ id, kind: "business", principal, rate, monthlyPayment, startMonth: 0 });
  L.add("debt", "loan", principal);
}

function promote(s: GameState, L: LedgerBuilder, kind: "shop" | "factory", p: Record<string, number>) {
  const b = s.business!;
  const spec = kind === "shop" ? SHOP : FACTORY;
  const own = p.cost * p.equityShare;
  // Own funds: savings first, then part of the venture's value.
  const fromSavings = Math.min(own, Math.max(0, excessCash(s)) + s.portfolio);
  fundFromSavings(s, L, fromSavings);
  const fromBusiness = own - fromSavings;
  b.capital -= fromBusiness;
  L.add("business", "business", -fromBusiness);
  startLoan(s, L, "debt-" + kind, p.cost - own, p.loanRate, 120);
  b.capital += p.cost;
  L.add("business", "purchase", p.cost);
  b.kind = kind;
  b.profitRate = spec.profitRate;
  b.hazard = spec.hazard;
  b.policy = "reinvest";
}

// ---------------- Life's cards (White) ----------------

const sev = (r: Regime) => r.severity;

export const LIFE_CARDS: CardDef[] = [
  {
    id: "lifeJobloss",
    kind: "life",
    scenarioId: "S014",
    group: "life",
    eligible: (s) => employed(s),
    params: (s, r) => [param("months", Math.round(6 * sev(r)), "months", U, "S014 catalog: six-month job gap"), param("replacement", 0.7, "pct")],
    apply: (s, p) => {
      s.phases.push({ start: 0, end: p.months, net: s.net * p.replacement, gross: s.gross * p.replacement, bvg: false, kind: "jobless" });
    },
  },
  {
    id: "lifeDrawdown",
    kind: "life",
    scenarioId: "S065",
    group: "macro",
    eligible: (s) => s.portfolio + s.pillar3a > 500,
    params: (s, r) => [param("drop", Math.min(0.5, 0.25 * sev(r)), "pct")],
    apply: (s, p, L) => {
      const lp = s.portfolio * EQUITY_WEIGHT[s.riskProfile] * p.drop;
      const l3 = s.pillar3a * 0.45 * p.drop;
      s.portfolio -= lp;
      s.pillar3a -= l3;
      L.add("portfolio", "event", -lp);
      L.add("pillar3a", "event", -l3);
    },
  },
  {
    id: "lifeInflation",
    kind: "life",
    scenarioId: "S101",
    group: "macro",
    eligible: () => true,
    params: (s, r) => [param("jump", 0.03 * sev(r), "pct")],
    apply: (s, p) => {
      s.expenses *= 1 + p.jump;
      s.rent *= 1 + p.jump;
      s.expenseDelta *= 1 + p.jump;
    },
  },
  {
    id: "lifeRate",
    kind: "life",
    scenarioId: "S103",
    group: "macro",
    eligible: (s) => !!s.home && s.home.mortgage > 0,
    params: (s, r) => [param("rise", 0.01 * sev(r), "pct")],
    apply: (s, p) => {
      if (s.home) s.home.rate += p.rise;
    },
  },
  {
    id: "lifeRent",
    kind: "life",
    scenarioId: "S037",
    group: "life",
    eligible: (s) => !s.home && s.rent > 0,
    params: (s, r) => [param("rise", 0.05 * sev(r), "pct")],
    apply: (s, p) => {
      const d = s.rent * p.rise;
      s.rent += d;
      s.expenses += d;
    },
  },
  {
    id: "lifeEmergency",
    kind: "life",
    scenarioId: "S048",
    group: "life",
    eligible: () => true,
    params: (s, r) => [param("amount", round(3500 * sev(r), 50), "chf")],
    apply: (s, p, L) => pay(s, L, p.amount, "event"),
  },
  {
    id: "lifeMaintenance",
    kind: "life",
    scenarioId: "S040",
    group: "life",
    eligible: (s) => !!s.home,
    params: (s, r) => [param("amount", round((s.home?.value ?? 0) * 0.015 * sev(r), 100), "chf")],
    apply: (s, p, L) => pay(s, L, p.amount, "event"),
  },
  {
    id: "lifeWindfall",
    kind: "life",
    scenarioId: "S057",
    group: "life",
    eligible: () => true,
    params: () => [param("amount", 6000, "chf")],
    apply: (s, p, L) => pay(s, L, -p.amount, "event"),
  },
  {
    id: "lifePromotion",
    kind: "life",
    scenarioId: "S013",
    group: "life",
    eligible: (s) => employed(s),
    params: () => [param("raise", 0.08, "pct")],
    apply: (s, p) => changeGross(s, 1 + p.raise),
  },
  {
    id: "lifeEnergy",
    kind: "life",
    scenarioId: "S106",
    group: "macro",
    eligible: () => true,
    params: (s, r) => [param("factor", 2, "pct", U, "S050 catalog: utility costs double"), param("monthly", round(110 * sev(r), 5), "chfMonth")],
    apply: (s, p) => {
      s.expenseDelta += p.monthly;
    },
  },
  {
    id: "lifeFamily",
    kind: "life",
    scenarioId: "S084",
    group: "life",
    eligible: () => true,
    params: (s, r) => [param("monthly", round(400 * sev(r), 10), "chfMonth"), param("months", 12, "months")],
    apply: (s, p) => {
      for (let m = 0; m < p.months; m++) s.oneOffs.push({ month: m, amount: p.monthly });
    },
  },
  {
    id: "lifeClaim",
    kind: "life",
    scenarioId: "S089",
    group: "life",
    eligible: () => true,
    params: () => [param("amount", 2500, "chf")],
    apply: (s, p, L) => pay(s, L, p.amount, "event"),
  },
  {
    id: "lifeRecession",
    kind: "life",
    scenarioId: "S104",
    group: "macro",
    eligible: () => true,
    params: (s, r) => [param("payCut", 0.04 * sev(r), "pct"), param("drop", 0.15 * sev(r), "pct")],
    apply: (s, p, L) => {
      if (s.gross > 0) changeGross(s, 1 - p.payCut);
      const lp = s.portfolio * EQUITY_WEIGHT[s.riskProfile] * p.drop;
      s.portfolio -= lp;
      L.add("portfolio", "event", -lp);
    },
  },
  {
    id: "lifeCompound",
    kind: "life",
    scenarioId: "S110",
    group: "macro",
    eligible: () => true,
    params: (s, r) => [param("months", 6, "months"), param("replacement", 0.7, "pct"), param("drop", Math.min(0.5, 0.3 * sev(r)), "pct")],
    apply: (s, p, L) => {
      if (employed(s)) s.phases.push({ start: 0, end: p.months, net: s.net * p.replacement, gross: s.gross * p.replacement, bvg: false, kind: "jobless" });
      const lp = s.portfolio * EQUITY_WEIGHT[s.riskProfile] * p.drop;
      s.portfolio -= lp;
      L.add("portfolio", "event", -lp);
    },
  },
  {
    id: "lifeCare",
    kind: "life",
    scenarioId: "S100",
    group: "life",
    eligible: (s) => s.age >= 80,
    params: (s, r) => [param("monthly", round(1500 * sev(r) * s.priceIndex, 10), "chfMonth")],
    apply: (s, p) => {
      s.expenses += p.monthly;
    },
  },
];

export const ALL_CARDS: CardDef[] = [HOLD, ...DECISION_CARDS, ...LIFE_CARDS];
const BY_ID = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function cardById(id: string): CardDef {
  const c = BY_ID.get(id);
  if (!c) throw new Error("Unknown card " + id);
  return c;
}

export const paramMap = (params: CardParam[]) => Object.fromEntries(params.map((p) => [p.key, p.value])) as Record<string, number>;

export interface CardResult {
  state: GameState;
  ledger: Ledger;
  params: CardParam[];
}

/** Plays a card on a position: a deterministic transition with its ledger. Never mutates the input. */
export function applyCard(s0: GameState, id: string, r: Regime, params?: CardParam[]): CardResult {
  const card = cardById(id);
  const s = cloneState(s0);
  const L = new LedgerBuilder(balances(s0));
  const ps = params ?? card.params(s0, r);
  card.apply(s, paramMap(ps), L, r);
  if (card.kind === "decision" && id !== "hold") s.played[id] = s.turn;
  if (card.kind === "life") s.played[id] = s.turn;
  return { state: s, ledger: L.build(balances(s)), params: ps };
}

const cooledDown = (s: GameState, c: CardDef) => {
  const last = s.played[c.id];
  if (last === undefined) return true;
  if (c.cooldown === Infinity) return false;
  return s.turn - last >= (c.cooldown ?? 1);
};

/** Decision cards the rules allow in this position (before dealing the hand). */
export function eligibleDecisions(s: GameState): CardDef[] {
  return DECISION_CARDS.filter((c) => c.eligible(s) && cooledDown(s, c));
}

export const HAND_SIZE = 4;

/**
 * The hand: up to four eligible cards, dealt with the game seed (one card per group first, so a hand is varied).
 * A student's first hand is the study / work / abroad choice; in check only responses are dealt, and with less than
 * six months of buffer one response is always among the four.
 * The engine uses the same rule for future turns: it knows the rules of the deck, never the markets.
 */
export function dealHand(s: GameState, seed: number): { cards: string[]; holdAllowed: boolean } {
  if (s.status !== "playing") return { cards: [], holdAllowed: false };
  let pool = eligibleDecisions(s);
  if (s.path === "student") return { cards: pool.filter((c) => c.group === "path").map((c) => c.id), holdAllowed: true };
  pool = pool.filter((c) => c.group !== "path");
  if (s.check) {
    const responses = pool.filter((c) => c.response);
    if (responses.length) pool = responses;
  }
  const ranked = pool
    .map((c) => ({ c, u: uniform(seed, s.turn, "deal", c.id) }))
    .sort((a, b) => a.u - b.u)
    .map((x) => x.c);
  const hand: CardDef[] = [];
  const groups = new Set<CardGroup>();
  // Declared preferences come up whenever they are possible (outside check), so the player can act on them.
  if (!s.check) {
    for (const c of ranked.filter((c) => declaredChoice(s, c.id)).slice(0, 2)) {
      hand.push(c);
      groups.add(c.group);
    }
  }
  // A thin buffer always comes with one way to repair it, so avoiding check never costs you the good responses.
  if (!s.check && bufferMonths(s) < 6) {
    const fix = ranked.find((c) => c.response);
    if (fix) {
      hand.push(fix);
      groups.add(fix.group);
    }
  }
  for (const c of ranked) {
    if (hand.includes(c)) continue;
    if (hand.length >= HAND_SIZE) break;
    if (!groups.has(c.group)) {
      hand.push(c);
      groups.add(c.group);
    }
  }
  for (const c of ranked) {
    if (hand.length >= HAND_SIZE) break;
    if (!hand.includes(c)) hand.push(c);
  }
  return { cards: hand.map((c) => c.id), holdAllowed: !s.check || hand.length === 0 };
}

/** Life cards that can happen in this position, with the regime's weights. */
export function lifeDeck(s: GameState, r: Regime): { id: string; w: number }[] {
  return LIFE_CARDS.filter((c) => (r.lifeWeights[c.id] ?? 0) > 0 && c.eligible(s)).map((c) => ({ id: c.id, w: r.lifeWeights[c.id] }));
}

/** Maps a uniform draw to Life's card (or null = quiet year): P(event) from the regime, then weights. */
export function lifeEventFor(s: GameState, r: Regime, u: number): string | null {
  if (u >= r.eventProb) return null;
  const deck = lifeDeck(s, r);
  const total = deck.reduce((a, d) => a + d.w, 0);
  if (!total) return null;
  let x = (u / r.eventProb) * total;
  for (const d of deck) {
    x -= d.w;
    if (x < 0) return d.id;
  }
  return deck[deck.length - 1].id;
}

/** Exact distribution of Life's card in a position (for brute-force enumeration). */
export function lifeDistribution(s: GameState, r: Regime): { id: string | null; p: number }[] {
  const deck = lifeDeck(s, r);
  const total = deck.reduce((a, d) => a + d.w, 0);
  if (!total) return [{ id: null, p: 1 }];
  return [{ id: null, p: 1 - r.eventProb }, ...deck.map((d) => ({ id: d.id, p: (r.eventProb * d.w) / total }))];
}
