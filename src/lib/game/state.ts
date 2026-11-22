/**
 * Doppel Play: the position. A game state is the existing `Profile` (identity, tax, canton) plus the evolving
 * balances, income, spending and standing decisions, i.e. what a `Scenario` would hold, advanced one year per turn.
 *
 * Everything here is pure and deterministic. Money is nominal CHF of the current game year; `priceIndex` converts
 * to the money of the game's start (the goal is set in start-year CHF, like the dashboard's "today's CHF").
 *
 * Two transitions change a state:
 *  - a card (`cards.ts`): immediate transfers plus changed standing decisions;
 *  - a year (`stepYear`): twelve monthly steps with the same rules as `simulate()` (salary, spending, BVG, 3a and
 *    its tax refund, mortgage interest + upkeep + amortisation, loans, returns, selling investments on a shortfall).
 * Both write a ledger, and `checkLedger` proves opening + flows = closing for every account.
 */
import {
  AHV_AGE,
  P3A_PAYOUT_TAX,
  RETIREMENT_TAX_FACTOR,
  SOCIAL_DEDUCTIONS,
  ahvMonthly,
  bvgAgeCredit,
  bvgConversionRate,
  coordinatedSalary,
  effectiveTaxRate,
} from "@/lib/finance/pension";
import { HEALTH_EXCESS_GROWTH, cantonMarginalRate, defaultHealthPremium } from "@/lib/finance/canton";
import { ASSUMPTIONS, EQUITY_WEIGHT } from "./sim";
import { BUFFER_MONTHS, MAINTENANCE_RATE, PILLAR_3A_MAX } from "@/lib/finance/swissRules";
import type { LifeEvent, Profile, RiskProfile } from "@/lib/finance/types";
import type { IncomePhase, SimInput } from "./sim";
import type { Text } from "@/lib/i18n/types";
import type { AlexiaPath } from "@/lib/ubs";
import { type MarketYear, type Regime, simAssumptions } from "./regime";

/** Overdraft the game tolerates before a payment is impossible (mate). Engine default. */
export const CREDIT_LINE = 2000;
/**
 * Arrears (Doppel default): when cash falls below the credit line with nothing left to sell, the shortfall becomes
 * a 10% loan repaid over 36 months, up to this total. Only beyond it is the position mate. So a ruinous move puts
 * the player in check first (like a chess blunder), instead of ending the game on the spot.
 */
export const ARREARS_CAP = 25_000;
export const ARREARS_RATE = 0.1;
export const ARREARS_MONTHS = 36;
/** Pillar 3a equity share (same as the simulator). */
const P3A_EQUITY = 0.45;

export interface Phase {
  /** Months from now, [start, end). */
  start: number;
  end: number;
  net: number;
  gross: number;
  /** Total monthly spending during the phase; absent = the regular spending. */
  expenses?: number;
  /** false = no pillar 2 credits (studying, abroad, job gap). */
  bvg: boolean;
  /** What the phase is, for the position panel. */
  kind: "study" | "jobless" | "leave" | "gap" | "training";
}

export interface Debt {
  id: string;
  kind: "student" | "car" | "personal";
  principal: number;
  rate: number;
  monthlyPayment: number;
  /** Months from now when repayments start (interest accrues before). */
  startMonth: number;
}

export interface Home {
  value: number;
  mortgage: number;
  rate: number;
  /** Amortise the second mortgage down to this floor (⅔ of the price). */
  floor: number;
  amortMonthly: number;
}

/** What the UBS layer contributed to this game, resolved once at the start (the worker never calls the UBS API). */
export interface UbsContext {
  alexiaPaths: AlexiaPath[] | null;
  /** S001 assumptions for this profile (study years, tuition), with their assumption ids. */
  s001: { years: number; tuition: number; ids: string[] } | null;
}

export interface GameGoal {
  label: Text;
  /** Net-worth target in start-year CHF (cash + portfolio + pillar 2 + pillar 3a + home equity − loans). */
  target: number;
  age: number;
  startNetWorth: number;
  startAge: number;
}

export type GameStatus = "playing" | "won" | "mate" | "ended";
export type StudentPath = "student" | "work" | "master" | "abroad" | null;

export interface GameState {
  profileId: string;
  name: string;
  city: string;
  canton: string;
  marginalTaxRate: number;
  retirementAge: number;
  /**
   * Pensions once retired (nominal CHF/month): the pension-fund annuity (fixed) and the AHV pension (from 65,
   * indexed with prices). `formerGross` is the last salary, kept for the simulator's AHV rule. null = still working.
   */
  pension: { bvgMonth: number; ahvMonth: number; formerGross: number } | null;
  startAge: number;
  age: number;
  /** Years played. */
  turn: number;
  /** Last turn of the game (start age + length). */
  endTurn: number;
  priceIndex: number;

  cash: number;
  portfolio: number;
  pillar2: number;
  pillar3a: number;
  home: Home | null;
  debts: Debt[];
  /** Car: value is not counted in net worth (consumption); running costs are in `expenseDelta`. */
  car: { value: number; monthly: number } | null;

  /** Regular job (CHF/year gross, CHF/month take-home). */
  gross: number;
  net: number;
  /** Regular monthly spending incl. rent. */
  expenses: number;
  rent: number;
  /** Change of spending from decisions (car, children, cuts, lifestyle). */
  expenseDelta: number;
  /** Monthly health-insurance premiums inside `expenses` (KVG, canton-dependent); they grow faster than prices. */
  healthPremium: number;
  phases: Phase[];
  /** Scheduled one-off payments (months from now, CHF). */
  oneOffs: { month: number; amount: number }[];
  workPct: number;
  children: number;
  sharedFlat: boolean;
  partner: boolean;
  abroad: boolean;
  path: StudentPath;

  contributes3a: boolean;
  monthlyInvest: number;
  investShare: number;
  riskProfile: RiskProfile;

  goal: GameGoal;
  ubs: UbsContext;
  /** Card id → turn it was last played (eligibility and cooldowns). */
  played: Record<string, number>;

  status: GameStatus;
  check: { reason: "buffer" | "crunch"; crunchProb: number; bufferMonths: number } | null;
  goalReached: boolean;
}

// ---------------- derived quantities ----------------

export const realNetWorth = (s: GameState) => netWorth(s) / s.priceIndex;

export function netWorth(s: GameState): number {
  const home = s.home ? s.home.value - s.home.mortgage : 0;
  return s.cash + s.portfolio + s.pillar2 + s.pillar3a + home - debtTotal(s);
}

export const debtTotal = (s: GameState) => s.debts.reduce((sum, d) => sum + d.principal, 0);

export const phaseAt = (s: GameState, month: number) => s.phases.find((p) => month >= p.start && month < p.end);

/** Take-home and gross at a month from now (phase-aware). */
/** Net pension per month after tax (pension-fund annuity, plus AHV from 65). */
export function pensionNet(s: GameState): number {
  if (!s.pension) return 0;
  const gross = s.pension.bvgMonth + (s.age >= AHV_AGE ? s.pension.ahvMonth : 0);
  return gross * (1 - effectiveTaxRate(s.marginalTaxRate) * RETIREMENT_TAX_FACTOR);
}

/**
 * Retirement: the pension fund becomes an annuity at the conversion rate of the retirement age, AHV is fixed from
 * the last salary, pillar 3a is paid out into the portfolio after the capital-withdrawal tax, and non-housing
 * spending falls to the retirement share (same rules as the simulator). `reduceSpending` = false for a profile
 * that is already retired at the start (its spending already is retirement spending).
 */
export function retireNow(s: GameState, L: LedgerBuilder, reduceSpending = true) {
  const bvgMonth = (s.pillar2 * bvgConversionRate(Math.min(s.retirementAge, s.age))) / 12;
  L.add("pillar2", "pension", -s.pillar2);
  s.pillar2 = 0;
  const formerGross = s.gross;
  const ahvMonth = ahvMonthly(formerGross / s.priceIndex) * s.priceIndex;
  if (s.pillar3a > 0) {
    const paid = s.pillar3a * (1 - P3A_PAYOUT_TAX);
    L.add("pillar3a", "pension", -s.pillar3a);
    L.add("portfolio", "pension", paid);
    s.portfolio += paid;
    s.pillar3a = 0;
  }
  s.pension = { bvgMonth, ahvMonth, formerGross };
  if (reduceSpending) s.expenses = (s.expenses - s.rent) * ASSUMPTIONS.retirementSpending + s.rent;
  s.gross = 0;
  s.net = 0;
  s.phases = [];
  s.contributes3a = false;
  s.monthlyInvest = 0;
}

export function incomeAt(s: GameState, month: number): { net: number; gross: number; bvg: boolean } {
  if (s.pension) return { net: pensionNet(s), gross: 0, bvg: false };
  const ph = phaseAt(s, month);
  return ph ? { net: ph.net, gross: ph.gross, bvg: ph.bvg } : { net: s.net, gross: s.gross, bvg: !s.abroad };
}

/** Monthly living costs (incl. rent, excl. ownership and loan costs) at a month from now. */
export function livingAt(s: GameState, month: number): number {
  const ph = phaseAt(s, month);
  return Math.max(s.rent, (ph?.expenses ?? s.expenses) + s.expenseDelta);
}

export function ownershipMonthly(h: Home | null): number {
  if (!h) return 0;
  const amort = h.mortgage > h.floor ? Math.min(h.amortMonthly, h.mortgage - h.floor) : 0;
  return (h.mortgage * h.rate) / 12 + (h.value * MAINTENANCE_RATE) / 12 + amort;
}

export const loanPayments = (s: GameState, month = 0) =>
  s.debts.reduce((sum, d) => sum + (d.principal > 0 && month >= d.startMonth ? Math.min(d.monthlyPayment, d.principal) : 0), 0);

/** Everything that leaves the account each month right now. */
export const monthlyOutflow = (s: GameState) => livingAt(s, 0) + ownershipMonthly(s.home) + loanPayments(s);

/** Take-home minus all outflows, before saving (3a, standing order). */
export const monthlySurplus = (s: GameState) => incomeAt(s, 0).net - monthlyOutflow(s);

export const bufferMonths = (s: GameState) => (monthlyOutflow(s) > 0 ? Math.max(0, s.cash) / monthlyOutflow(s) : 99);

/** Gross salary that yields a given take-home (social deductions + effective tax), engine rule. */
export function grossFromNet(netMonth: number, marginalTaxRate: number): number {
  return Math.round((netMonth * 12) / (1 - SOCIAL_DEDUCTIONS - effectiveTaxRate(marginalTaxRate)) / 100) * 100;
}

/** Glide path to the goal in start-year CHF: straight line from the opening net worth to the target at the goal age. */
export function glideTarget(g: GameGoal, age: number): number {
  if (age >= g.age || g.age <= g.startAge) return g.target;
  const f = (age - g.startAge) / (g.age - g.startAge);
  return g.startNetWorth + (g.target - g.startNetWorth) * Math.max(0, f);
}

// ---------------- the ledger ----------------

export const ACCOUNTS = ["cash", "portfolio", "pillar2", "pillar3a", "homeValue", "mortgage", "debt"] as const;
export type Account = (typeof ACCOUNTS)[number];
export type Balances = Record<Account, number>;

export type FlowKind =
  | "income" | "living" | "housing" | "loan" | "interest" | "return" | "credit" | "contribution" | "refund"
  | "invest" | "sale" | "purchase" | "oneOff" | "card" | "event" | "amortisation" | "pension";

export interface Flow {
  account: Account;
  kind: FlowKind;
  amount: number;
}

export interface Ledger {
  opening: Balances;
  closing: Balances;
  flows: Flow[];
}

export function balances(s: GameState): Balances {
  return {
    cash: s.cash,
    portfolio: s.portfolio,
    pillar2: s.pillar2,
    pillar3a: s.pillar3a,
    homeValue: s.home?.value ?? 0,
    mortgage: s.home?.mortgage ?? 0,
    debt: debtTotal(s),
  };
}

/** Collects flows by (account, kind) so a year's ledger stays small. */
export class LedgerBuilder {
  private sums = new Map<string, number>();
  constructor(private readonly opening: Balances) {}
  add(account: Account, kind: FlowKind, amount: number) {
    if (amount === 0) return;
    const k = account + "|" + kind;
    this.sums.set(k, (this.sums.get(k) ?? 0) + amount);
  }
  /** A transfer between two accounts (e.g. cash → portfolio). */
  move(from: Account, to: Account, kind: FlowKind, amount: number) {
    this.add(from, kind, -amount);
    this.add(to, kind, amount);
  }
  build(closing: Balances): Ledger {
    const flows: Flow[] = [];
    for (const [k, amount] of this.sums) {
      const [account, kind] = k.split("|") as [Account, FlowKind];
      flows.push({ account, kind, amount });
    }
    return { opening: this.opening, closing, flows };
  }
}

/** Largest |opening + Σ flows − closing| over all accounts (CHF). 0 up to floating point. */
export function ledgerError(l: Ledger): number {
  let worst = 0;
  for (const a of ACCOUNTS) {
    const sum = l.flows.filter((f) => f.account === a).reduce((s, f) => s + f.amount, l.opening[a]);
    worst = Math.max(worst, Math.abs(sum - l.closing[a]));
  }
  return worst;
}

export const cloneState = (s: GameState): GameState => ({
  ...s,
  home: s.home ? { ...s.home } : null,
  debts: s.debts.map((d) => ({ ...d })),
  car: s.car ? { ...s.car } : null,
  phases: s.phases.map((p) => ({ ...p })),
  oneOffs: s.oneOffs.map((o) => ({ ...o })),
  played: { ...s.played },
  pension: s.pension ? { ...s.pension } : null,
  check: s.check ? { ...s.check } : null,
});

// ---------------- opening position ----------------

/** The game runs to this age (working-age players); retirees play 15 years, at most to 95. */
export const END_AGE = 80;
export const RETIREE_END_AGE = 95;
/** Years per turn: yearly for the first ten years, then five-year turns. */
export const YEARLY_YEARS = 10;
export const LONG_TURN_YEARS = 5;

export const gameEndAge = (age: number, retired: boolean) => (retired ? Math.min(RETIREE_END_AGE, Math.max(age + 5, age + 15)) : Math.max(END_AGE, age + 5));

/** Years the next turn covers (s.turn counts years played). */
export const turnYears = (s: GameState) => Math.max(1, Math.min(s.turn < YEARLY_YEARS ? 1 : LONG_TURN_YEARS, s.endTurn - s.turn));

export interface StartOptions {
  /** Years to play; default: to the end age (80 for working-age players). */
  lengthTurns?: number;
  ubs: UbsContext;
  /** Opening debt from the UBS summary (rate unknown there → engine default 5%, 5-year repayment). */
  openingDebt?: number;
  /** "student" makes the first decision the study / work / abroad choice. */
  student?: boolean;
}

export function initialState(p: Profile, o: StartOptions): GameState {
  const debts: Debt[] = o.openingDebt && o.openingDebt > 0
    ? [{ id: "debt-opening", kind: "personal", principal: o.openingDebt, rate: 0.05, monthlyPayment: Math.round(o.openingDebt / 60), startMonth: 0 }]
    : [];
  const s: GameState = {
    profileId: p.id,
    name: p.name,
    city: p.city,
    canton: p.canton,
    marginalTaxRate: p.marginalTaxRate,
    retirementAge: p.retirementAge,
    startAge: p.age,
    age: p.age,
    turn: 0,
    endTurn: Math.max(1, o.lengthTurns ?? gameEndAge(p.age, p.retirementAge <= p.age) - p.age),
    pension: null,
    priceIndex: 1,
    cash: p.cash,
    portfolio: p.portfolio,
    pillar2: p.pillar2,
    pillar3a: p.pillar3a,
    home: null,
    debts,
    car: null,
    gross: p.grossIncomeYear,
    net: p.netIncomeMonth,
    expenses: p.expensesMonth,
    healthPremium: p.healthPremiumMonth ?? defaultHealthPremium(p),
    rent: p.rentMonth,
    expenseDelta: 0,
    phases: [],
    oneOffs: [],
    workPct: 1,
    children: 0,
    sharedFlat: false,
    partner: false,
    abroad: false,
    path: o.student ? "student" : null,
    contributes3a: p.contributes3a,
    monthlyInvest: 0,
    investShare: p.investShare,
    riskProfile: p.riskProfile,
    goal: { label: p.goal.label, target: p.goal.target, age: p.goal.age, startNetWorth: 0, startAge: p.age },
    ubs: o.ubs,
    played: {},
    status: "playing",
    check: null,
    goalReached: false,
  };
  if (p.retirementAge <= p.age) retireNow(s, new LedgerBuilder(balances(s)), false);
  s.goal.startNetWorth = netWorth(s);
  return s;
}

// ---------------- the simulator input for a position ----------------

/**
 * The existing simulator, started from this position: profile values become "today", phases and loans keep their
 * remaining months, the goal is the glide-path target at the horizon (in this year's CHF).
 */
export function toSimInput(s: GameState, horizonAge: number, regime: Regime, paths: number, seed: number): SimInput {
  const target = glideTarget(s.goal, horizonAge) * s.priceIndex;
  const events: LifeEvent[] = s.oneOffs
    .filter((o) => o.month >= 0)
    .map((o, i) => ({ id: "oneoff-" + i, type: "expense", label: "One-off", month: o.month, amount: o.amount }));
  const phases: IncomePhase[] = s.phases.map((p) => ({
    startMonth: p.start,
    endMonth: p.end,
    netIncomeMonth: p.net,
    grossIncomeYear: p.gross,
    expensesMonth: p.expenses ?? s.expenses,
    bvg: p.bvg,
  }));
  if (s.abroad) phases.push({ startMonth: 0, endMonth: 12 * 100, netIncomeMonth: s.net, grossIncomeYear: s.gross, expensesMonth: s.expenses, bvg: false });
  const profile: Profile = {
    id: s.profileId,
    name: s.name,
    age: s.age,
    city: s.city,
    canton: s.canton,
    tagline: { key: "profile.user.tagline" },
    grossIncomeYear: s.pension ? s.pension.formerGross : s.gross,
    netIncomeMonth: s.pension ? pensionNet(s) : s.net,
    expensesMonth: s.expenses,
    healthPremiumMonth: s.healthPremium,
    rentMonth: s.rent,
    cash: s.cash,
    portfolio: s.portfolio,
    // Retired: the annuity as the pension-fund capital it came from, AHV from the last salary (simulator rules).
    pillar2: s.pension ? (s.pension.bvgMonth * 12) / bvgConversionRate(Math.min(s.retirementAge, s.age)) : s.pillar2,
    pillar3a: s.pillar3a,
    contributes3a: s.contributes3a && !s.abroad,
    investShare: s.investShare,
    marginalTaxRate: s.marginalTaxRate,
    riskProfile: s.riskProfile,
    retirementAge: s.pension ? Math.min(s.retirementAge, s.age) : s.retirementAge,
    goal: { label: { key: "profile.user.tagline" }, target, age: Math.max(horizonAge, s.age + 1) },
    events,
    transactions: [],
    trades: [],
    history: { soldInDrawdown: false, drawdownSellPct: 0 },
  };
  return {
    profile,
    events,
    paths,
    seed,
    horizon: "goal",
    expenseDelta: s.expenseDelta,
    monthlyInvest: s.monthlyInvest,
    assumptions: simAssumptions(regime),
    shocks: regime.shocks,
    phases,
    home: s.home ? { value: s.home.value, mortgage: s.home.mortgage, floor: s.home.floor, rate: s.home.rate } : undefined,
    debts: s.debts.map((d) => ({ principal: d.principal, rate: d.rate, monthlyPayment: d.monthlyPayment, startMonth: d.startMonth })),
  };
}

// ---------------- one realised year ----------------

export interface YearResult {
  state: GameState;
  ledger: Ledger;
  /** Investments had to be sold to cover a shortfall. */
  soldToCover: number;
  /** Lowest cash balance of the year (after selling investments). */
  minCash: number;
  /** A hard constraint broke: cash below the credit line with nothing left to sell. */
  mate: boolean;
}

/**
 * Twelve monthly steps with one market bucket's returns. Mirrors `simulate()`: returns first, then income and
 * spending, ownership and loan costs, BVG credits, standing order, 3a (refund in month 12), investing the
 * surplus, and selling investments when cash goes negative. Wage and price growth apply monthly within the year.
 */
export function stepYear(start: GameState, mkt: MarketYear): YearResult {
  const s = cloneState(start);
  const L = new LedgerBuilder(balances(s));
  const A = ASSUMPTIONS;
  const wE = EQUITY_WEIGHT[s.riskProfile];
  const mE = Math.pow(1 + mkt.equity, 1 / 12) - 1;
  const mB = Math.pow(1 + mkt.bonds, 1 / 12) - 1;
  const mH = Math.pow(1 + mkt.home, 1 / 12) - 1;
  const mInfl = Math.pow(1 + mkt.inflation, 1 / 12);
  const mWage = Math.pow(1 + mkt.wage, 1 / 12);
  let soldToCover = 0;
  let minCash = s.cash;
  let mate = false;
  let p3aYear = 0;
  if (!s.pension && s.age >= s.retirementAge) retireNow(s, L);
  const retired = !!s.pension;

  for (let m = 0; m < 12; m++) {
    const price = Math.pow(mInfl, m + 1);
    const wage = Math.pow(mWage, m + 1);
    // --- returns ---
    const rPort = s.portfolio * (wE * mE + (1 - wE) * mB);
    s.portfolio += rPort;
    L.add("portfolio", "return", rPort);
    const r3a = s.pillar3a * (P3A_EQUITY * mE + (1 - P3A_EQUITY) * mB);
    s.pillar3a += r3a;
    L.add("pillar3a", "return", r3a);
    if (!retired) {
      const r2 = (s.pillar2 * A.pillar2Rate) / 12;
      s.pillar2 += r2;
      L.add("pillar2", "return", r2);
    }
    const rCash = s.cash * ((s.cash > 0 ? A.cashRate : A.overdraftRate) / 12);
    s.cash += rCash;
    L.add("cash", "interest", rCash);
    if (s.home) {
      const rh = s.home.value * mH;
      s.home.value += rh;
      L.add("homeValue", "return", rh);
    }

    // --- income and spending ---
    const inc = incomeAt(s, m);
    const income = retired ? inc.net : inc.net * wage;
    s.cash += income;
    L.add("cash", "income", income);
    const living = livingAt(s, m) * price;
    s.cash -= living;
    L.add("cash", "living", -living);
    for (const o of s.oneOffs) {
      if (o.month === m) {
        s.cash -= o.amount;
        L.add("cash", "oneOff", -o.amount);
      }
    }
    let outflow = living;
    if (s.home) {
      const h = s.home;
      const amort = h.mortgage > h.floor ? Math.min(h.amortMonthly, h.mortgage - h.floor) : 0;
      const costs = (h.mortgage * h.rate) / 12 + (h.value * MAINTENANCE_RATE) / 12;
      h.mortgage -= amort;
      L.add("mortgage", "amortisation", -amort);
      s.cash -= costs + amort;
      L.add("cash", "housing", -costs);
      L.add("cash", "amortisation", -amort);
      outflow += costs + amort;
    }
    for (const d of s.debts) {
      if (d.principal <= 0) continue;
      const interest = (d.principal * d.rate) / 12;
      d.principal += interest;
      L.add("debt", "interest", interest);
      if (m >= d.startMonth) {
        const pay = Math.min(d.monthlyPayment, d.principal);
        d.principal -= pay;
        L.add("debt", "loan", -pay);
        s.cash -= pay;
        L.add("cash", "loan", -pay);
        outflow += pay;
      }
    }

    // --- savings flow (surplus of this month) ---
    let surplus = income - outflow;
    if (!retired) {
      if (inc.bvg && inc.gross > 0) {
        const credit = (bvgAgeCredit(s.age) * coordinatedSalary(inc.gross) * wage) / 12;
        s.pillar2 += credit;
        L.add("pillar2", "credit", credit);
      }
      if (surplus > 0 && s.monthlyInvest > 0) {
        const order = Math.min(s.monthlyInvest, surplus);
        L.move("cash", "portfolio", "invest", order);
        s.cash -= order;
        s.portfolio += order;
        surplus -= order;
      }
      if (s.contributes3a && !s.abroad && inc.gross > 0 && surplus > 0) {
        const c = Math.min(PILLAR_3A_MAX / 12, surplus);
        L.move("cash", "pillar3a", "contribution", c);
        s.cash -= c;
        s.pillar3a += c;
        p3aYear += c;
        surplus -= c;
      }
      if (m === 11 && p3aYear > 0) {
        const refund = p3aYear * s.marginalTaxRate;
        s.cash += refund;
        L.add("cash", "refund", refund);
      }
    }
    if (surplus > 0 && !retired) {
      const inv = surplus * s.investShare;
      L.move("cash", "portfolio", "invest", inv);
      s.cash -= inv;
      s.portfolio += inv;
    }

    // --- shortfall: sell investments; below the credit line with nothing left → mate ---
    if (s.cash < 0 && s.portfolio > 0) {
      const sell = Math.min(s.portfolio, -s.cash);
      L.move("portfolio", "cash", "sale", sell);
      s.portfolio -= sell;
      s.cash += sell;
      soldToCover += sell;
    }
    if (s.cash < -CREDIT_LINE * price) {
      const need = -s.cash;
      const arrears = s.debts.find((d) => d.id === "debt-arrears");
      const owed = arrears?.principal ?? 0;
      if (owed + need <= ARREARS_CAP * price) {
        L.add("cash", "loan", need);
        L.add("debt", "loan", need);
        s.cash += need;
        const principal = owed + need;
        const r = ARREARS_RATE / 12;
        const monthlyPayment = (principal * r) / (1 - Math.pow(1 + r, -ARREARS_MONTHS));
        if (arrears) Object.assign(arrears, { principal, monthlyPayment, startMonth: m + 1 });
        else s.debts.push({ id: "debt-arrears", kind: "personal", principal, rate: ARREARS_RATE, monthlyPayment, startMonth: m + 1 });
      } else {
        mate = true;
      }
    }
    minCash = Math.min(minCash, s.cash);
  }

  // --- the year turns: growth of salaries and prices, phases and schedules move 12 months closer ---
  const infl = 1 + mkt.inflation;
  const g = 1 + mkt.wage;
  s.net *= g;
  s.gross *= g;
  if (s.pension) {
    s.pension.ahvMonth *= infl;
    s.pension.formerGross *= infl;
  }
  s.expenses *= infl;
  // Health premiums: the part of their growth above inflation (once a year; the simulator does the same).
  const premiumStep = s.healthPremium * infl * HEALTH_EXCESS_GROWTH;
  s.expenses += premiumStep;
  s.healthPremium *= infl * (1 + HEALTH_EXCESS_GROWTH);
  s.rent *= infl;
  s.expenseDelta *= infl;
  if (s.car) s.car = { value: s.car.value * 0.85, monthly: s.car.monthly * infl };
  s.phases = s.phases
    .map((p) => ({ ...p, start: p.start - 12, end: p.end - 12, net: p.net * g, gross: p.gross * g, expenses: p.expenses === undefined ? undefined : p.expenses * infl + premiumStep }))
    .filter((p) => p.end > 0)
    .map((p) => ({ ...p, start: Math.max(0, p.start) }));
  s.oneOffs = s.oneOffs.map((o) => ({ ...o, month: o.month - 12 })).filter((o) => o.month >= 0);
  s.debts = s.debts.map((d) => ({ ...d, startMonth: Math.max(0, d.startMonth - 12) })).filter((d) => d.principal > 0.5);
  s.priceIndex *= infl;
  s.age += 1;
  s.turn += 1;
  if (s.path === "master" && !s.phases.some((p) => p.kind === "study")) s.path = "work";
  const ledger = L.build(balances(s));
  // Repaid loans leave the list: book the rounding remainder so the identity holds exactly.
  const drift = ledger.closing.debt - ledger.flows.filter((f) => f.account === "debt").reduce((a, f) => a + f.amount, ledger.opening.debt);
  if (Math.abs(drift) > 1e-9) ledger.flows.push({ account: "debt", kind: "loan", amount: drift });
  return { state: s, ledger, soldToCover, minCash, mate };
}

/** Months of spending kept as the minimum cash buffer (dashboard and bank rule). Below it the king is in check. */
export const MIN_BUFFER_MONTHS = BUFFER_MONTHS;

/** Engine default: rough marginal tax rate from monthly take-home (same brackets as the UBS stub). */
/** Marginal tax rate for a take-home pay, scaled by the canton's tax burden when a canton is given (canton.ts). */
export function marginalTaxFor(netMonth: number, canton?: string): number {
  const average = netMonth < 3000 ? 0.1 : netMonth < 6000 ? 0.2 : netMonth < 9000 ? 0.28 : 0.33;
  return canton ? cantonMarginalRate(average, canton) : average;
}
