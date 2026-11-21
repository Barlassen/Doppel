import { PAYSLIP_SALARIES, SOCIAL_DEDUCTIONS, payslipToIncome } from "@/lib/finance/pension";
import { monthlySpend, withDerivedBehavior } from "@/lib/finance/investBehavior";
import type { Goal, InvestmentTrade, Profile } from "@/lib/finance/types";
import { translate } from "@/lib/i18n";
import type { Msg } from "@/lib/i18n/types";
import { fundTrade, generateTransactions, stockTrade, type SpendPlan } from "./history";

/**
 * The three built-in accounts (all fictional). Balances are set so that net worth
 * (cash + portfolio + pillar 2 + pillar 3a) is exactly CHF 10,000 / 20,000 / 10,000.
 * Spending, rent, the investment rate, 3a and drawdown selling are NOT set by hand: they come from the
 * seeded transaction and trade history below (Jun–Oct 2026) via `monthlySpend()` and `withDerivedBehavior()`.
 */

/** Built-in event: English `label` (data for the LLM prompt) + translatable `labelMsg` for the UI. */
const labelled = (labelMsg: Msg) => ({ label: translate("en", labelMsg.key, labelMsg.params), labelMsg });

const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] as const;

/** Monthly take-home after social deductions and income tax, with the same rule a payslip snap uses. */
export const takeHomeMonth = (gross: number, marginalTaxRate: number) =>
  payslipToIncome((gross * (1 - SOCIAL_DEDUCTIONS)) / PAYSLIP_SALARIES, marginalTaxRate).netIncomeMonth;

const goal = (target: number, age: number): Goal => ({ label: { key: "profile.goalK", params: { target, age } }, target, age });

type Balances = Pick<Profile, "cash" | "portfolio" | "pillar2" | "pillar3a">;
type Persona = Omit<Profile, "netIncomeMonth" | "expensesMonth" | "rentMonth" | "investShare" | "contributes3a" | "history" | keyof Balances> & {
  balances: Balances;
};

/** Fills in what the history determines: take-home pay, spending, rent and the behavioural inputs. */
export function fromHistory(p: Persona): Profile {
  const spend = monthlySpend(p.transactions);
  const { balances, ...rest } = p;
  return withDerivedBehavior({
    ...rest,
    ...balances,
    netIncomeMonth: takeHomeMonth(p.grossIncomeYear, p.marginalTaxRate),
    expensesMonth: Math.round(spend.average / 10) * 10,
    rentMonth: Math.round(spend.rent),
    investShare: 0,
    contributes3a: false,
    history: { soldInDrawdown: false, drawdownSellPct: 0 },
  });
}

// ---------------- Barlas · Zürich · frugal, invests by standing order ----------------

const barlasSpend: SpendPlan = {
  seed: 2401,
  months: MONTHS,
  fixed: [
    { day: 1, merchant: "Rent", category: "housing", amount: 1520 },
    { day: 1, merchant: "ZVV NetzPass", category: "transport", amount: 88 },
    { day: 3, merchant: "Health insurance", category: "insurance", amount: 318 },
    { day: 5, merchant: "Salt", category: "bills", amount: 29.95 },
    { day: 8, merchant: "Spotify", category: "subscriptions", amount: 13.95 },
    { day: 12, merchant: "ewz", category: "bills", amount: 42 },
  ],
  variable: [
    { merchants: ["Migros", "Lidl", "Denner", "Coop", "Aldi Suisse"], category: "groceries", perMonth: 11, min: 22, max: 58 },
    { merchants: ["Migros Take Away", "Kebab Haus Altstetten", "Mensa Technopark"], category: "dining", perMonth: 3, min: 12, max: 34 },
    { merchants: ["SBB"], category: "transport", perMonth: 2, min: 9.8, max: 34 },
    { merchants: ["Galaxus", "Decathlon", "Digitec"], category: "shopping", perMonth: 1, min: 25, max: 80 },
  ],
  oneOff: [
    { date: "2026-07-11", merchant: "Booking.com", category: "travel", amount: 340 },
    { date: "2026-09-19", merchant: "Kletterzentrum Gaswerk", category: "shopping", amount: 145 },
  ],
};

const VWRL = "Vanguard FTSE All-World (VWRL)";
const P3A_FUND = "Pillar 3a fund · Global 60";
const barlasTrades: InvestmentTrade[] = [
  ...MONTHS.flatMap((m) => [fundTrade(`${m}-26`, "broker", VWRL, "buy", 600, 110), fundTrade(`${m}-26`, "3a", P3A_FUND, "buy", 605, 120)]),
  // Bought extra while the market was down, sold nothing.
  fundTrade("2026-08-12", "broker", VWRL, "buy", 600, 110),
  fundTrade("2026-09-09", "broker", VWRL, "buy", 300, 110),
];

// ---------------- Meriç · Lausanne · sporadic lump sums, panic sale, hyped stock ----------------

const mericSpend: SpendPlan = {
  seed: 2702,
  months: MONTHS,
  fixed: [
    { day: 1, merchant: "Rent", category: "housing", amount: 1690 },
    { day: 1, merchant: "Mobilis", category: "transport", amount: 74 },
    { day: 3, merchant: "Health insurance", category: "insurance", amount: 428 },
    { day: 4, merchant: "Let's Go Fitness", category: "subscriptions", amount: 69 },
    { day: 5, merchant: "Swisscom", category: "bills", amount: 59.9 },
    { day: 7, merchant: "Netflix", category: "subscriptions", amount: 20.9 },
    { day: 10, merchant: "Disney+", category: "subscriptions", amount: 12.9 },
    { day: 10, merchant: "Romande Energie", category: "bills", amount: 48 },
    { day: 12, merchant: "Spotify", category: "subscriptions", amount: 13.95 },
    { day: 15, merchant: "Apple Music", category: "subscriptions", amount: 10.95 },
  ],
  variable: [
    { merchants: ["Coop", "Migros", "Lidl", "Aldi Suisse", "Manor Food"], category: "groceries", perMonth: 9, min: 25, max: 75 },
    { merchants: ["Smood", "Uber Eats"], category: "dining", perMonth: 8, min: 24, max: 48, payday: 2.5 },
    { merchants: ["Holy Cow!", "Pizzeria Sapori", "Café de la Gare"], category: "dining", perMonth: 4, min: 18, max: 55, payday: 2.5 },
    { merchants: ["Starbucks"], category: "dining", perMonth: 6, min: 5.5, max: 8.9 },
    { merchants: ["Zalando", "Manor", "Galaxus", "Sephora"], category: "shopping", perMonth: 4, min: 40, max: 170, payday: 6 },
    { merchants: ["SBB"], category: "transport", perMonth: 2, min: 12, max: 38 },
  ],
  oneOff: [{ date: "2026-08-14", merchant: "easyJet", category: "travel", amount: 289 }],
};

const SWDA = "iShares Core MSCI World (SWDA)";
const NEXORA = "Nexora AI (NXRA)";
const mericTrades: InvestmentTrade[] = [
  fundTrade("2026-06-03", "broker", SWDA, "buy", 3000, 92),
  // The hyped stock, bought at its high…
  stockTrade("2026-06-18", NEXORA, "buy", 2500, 182),
  // …and a large part of everything sold near the bottom of the drawdown.
  fundTrade("2026-08-06", "broker", SWDA, "sell", 1000, 92),
  stockTrade("2026-08-06", NEXORA, "sell", 700, 124),
];

// ---------------- Oktay · Basel · doesn't invest, lots of discretionary spending ----------------

const oktaySpend: SpendPlan = {
  seed: 2603,
  months: MONTHS,
  fixed: [
    { day: 1, merchant: "Rent", category: "housing", amount: 1640 },
    { day: 1, merchant: "U-Abo TNW", category: "transport", amount: 80 },
    { day: 2, merchant: "Netflix", category: "subscriptions", amount: 20.9 },
    { day: 3, merchant: "Health insurance", category: "insurance", amount: 372 },
    { day: 5, merchant: "Sunrise", category: "bills", amount: 69.9 },
    { day: 6, merchant: "Disney+", category: "subscriptions", amount: 12.9 },
    { day: 9, merchant: "Sky Show", category: "subscriptions", amount: 9.9 },
    { day: 11, merchant: "Spotify", category: "subscriptions", amount: 13.95 },
    { day: 12, merchant: "IWB", category: "bills", amount: 52 },
    { day: 14, merchant: "Xbox Game Pass", category: "subscriptions", amount: 16.9 },
    { day: 16, merchant: "Update Fitness", category: "subscriptions", amount: 59 },
    { day: 18, merchant: "Audible", category: "subscriptions", amount: 12.95 },
  ],
  variable: [
    { merchants: ["Coop", "Migros", "Denner"], category: "groceries", perMonth: 7, min: 15, max: 55 },
    { merchants: ["Uber Eats", "Just Eat", "Smood"], category: "dining", perMonth: 13, min: 22, max: 52, payday: 3 },
    { merchants: ["Rhybar", "Burger Bros Basel", "Pizzeria Da Gino"], category: "dining", perMonth: 7, min: 25, max: 85, payday: 4 },
    { merchants: ["Starbucks"], category: "dining", perMonth: 12, min: 5.9, max: 9.5 },
    { merchants: ["Zalando", "Galaxus", "Digitec", "AliExpress", "Manor"], category: "shopping", perMonth: 5, min: 35, max: 190, payday: 8 },
    { merchants: ["SBB"], category: "transport", perMonth: 1, min: 20, max: 45 },
  ],
  oneOff: [
    { date: "2026-07-24", merchant: "easyJet", category: "travel", amount: 186 },
    { date: "2026-07-25", merchant: "Booking.com", category: "travel", amount: 420 },
  ],
};

const barlas = fromHistory({
  id: "barlas",
  name: "Barlas",
  age: 24,
  city: "Zürich",
  canton: "ZH",
  tagline: { key: "profile.barlas.tagline" },
  grossIncomeYear: 66_000,
  marginalTaxRate: 0.2,
  riskProfile: "growth",
  retirementAge: 65,
  goal: goal(450_000, 40),
  events: [{ id: "ev-raise", type: "raise", ...labelled({ key: "event.raise" }), month: 20, amount: 12_000, source: "profile" }],
  balances: { cash: 2_645, portfolio: 4_265, pillar2: 0, pillar3a: 3_090 },
  transactions: generateTransactions(barlasSpend),
  trades: barlasTrades,
});

const meric = fromHistory({
  id: "meric",
  name: "Meriç",
  age: 27,
  city: "Lausanne",
  canton: "VD",
  tagline: { key: "profile.meric.tagline" },
  grossIncomeYear: 92_000,
  marginalTaxRate: 0.29,
  riskProfile: "balanced",
  retirementAge: 65,
  goal: goal(400_000, 40),
  events: [
    { id: "ev-house", type: "house", ...labelled({ key: "event.flatIn", params: { place: "Renens" } }), month: 60, amount: 540_000, source: "profile" },
  ],
  balances: { cash: 14_800, portfolio: 2_900, pillar2: 2_300, pillar3a: 0 },
  transactions: generateTransactions(mericSpend),
  trades: mericTrades,
});

const oktay = fromHistory({
  id: "oktay",
  name: "Oktay",
  age: 26,
  city: "Basel",
  canton: "BS",
  tagline: { key: "profile.oktay.tagline" },
  grossIncomeYear: 72_000,
  marginalTaxRate: 0.25,
  riskProfile: "balanced",
  retirementAge: 65,
  goal: goal(200_000, 40),
  events: [
    { id: "ev-trip", type: "expense", ...labelled({ key: "event.tripTo", params: { place: "Tokyo" } }), month: 10, amount: 4_500, source: "profile" },
  ],
  balances: { cash: 3_900, portfolio: 0, pillar2: 6_100, pillar3a: 0 },
  transactions: generateTransactions(oktaySpend),
  trades: [],
});

/** Built-in accounts, in switcher order. The first one is what the server renders. */
export const PROFILES: Profile[] = [barlas, meric, oktay];

/** The persona with a planned home (house-delay what-ifs and their checks need one). */
export const PROFILE_WITH_HOME = meric;

