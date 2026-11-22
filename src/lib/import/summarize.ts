import type { TransactionCategory } from "@/lib/finance/types";
import { msg, type Msg } from "@/lib/i18n/types";
import type { AskFacts } from "@/lib/llm";
import { buildReview, type Review } from "./review";
import { merchantKey, round2 } from "./text";
import type { ParsedStatement, ReviewRow } from "./types";

/**
 * What a statement tells the twin: income and how regular it is, fixed costs with their recurring payees, variable
 * spending by category, the saving and investing rate, and the obligations that imply a life fact (a leasing rate
 * means a car, a daycare invoice a child, rent a tenant, mortgage interest an owner).
 *
 * Pure and deterministic, 0 tokens. Every figure is a raw number and every text a `Msg`, so the UI formats and
 * translates. Each inferred fact carries the rows it rests on and a confidence, and is a PROPOSAL: the user confirms
 * or rejects it before anything enters the profile.
 */

export type FixedKind = "rent" | "mortgage" | "insurance" | "subscription" | "loan" | "leasing" | "childcare" | "bills" | "transit" | "tax" | "other";
export type Cadence = "monthly" | "quarterly" | "irregular";

export interface RecurringCost {
  kind: FixedKind;
  merchant: string;
  category: TransactionCategory;
  /** CHF per month: the typical payment for a monthly payee, a third of it for a quarterly one, else total / months. */
  monthlyAmount: number;
  /** Median single payment, CHF. */
  typicalAmount: number;
  cadence: Cadence;
  occurrences: number;
  /** Calendar months with at least one payment. */
  months: number;
  /** `ReviewRow.id`s, oldest first. */
  evidence: string[];
  label: Msg;
}

export interface IncomeSource {
  merchant: string;
  monthlyAvg: number;
  total: number;
  occurrences: number;
  months: number;
  /** Paid in most months with a stable amount: a salary or pension rather than a one-off credit. */
  regular: boolean;
  evidence: string[];
}

export interface CategorySpend {
  category: TransactionCategory;
  total: number;
  monthlyAvg: number;
  count: number;
  /** Share of variable spending, 0..1. */
  share: number;
}

export type FactId = "salary" | "tenant" | "owner" | "car" | "child" | "debt" | "investor" | "pillar3a";

export interface InferredFact {
  id: FactId;
  /** 0..1. Below 0.5 the UI should present the fact as a question, not a finding. */
  confidence: number;
  /** CHF per month tied to the fact (net salary, rent, leasing + fuel + car insurance, daycare, loan rate, contributions). */
  monthlyAmount: number;
  merchants: string[];
  /** `ReviewRow.id`s (bank rows) and `ReviewTrade.id`s (broker rows) the fact rests on. */
  evidence: string[];
  title: Msg;
  /** One line per signal, e.g. "leasing rate to AMAG Leasing in 5 of 5 months". */
  reasons: Msg[];
}

export interface StatementSummary {
  period: {
    from: string;
    to: string;
    /** Months of data, counting the first and last month by the days they cover (5 for 1 June to 31 October). */
    months: number;
    /** Calendar months with at least one row. */
    calendarMonths: number;
    /** False under two months: averages are then one month's totals, not a pattern. */
    reliable: boolean;
  };
  income: {
    monthlyAvg: number;
    total: number;
    /** 1 = the same amount every month, 0 = erratic; null with fewer than two months of income. */
    regularity: number | null;
    sources: IncomeSource[];
  };
  fixed: { monthlyTotal: number; items: RecurringCost[] };
  variable: { monthlyTotal: number; byCategory: CategorySpend[] };
  saving: {
    /** Income minus all spending, CHF per month. */
    monthlyNet: number;
    /** monthlyNet / income, or null without income in the file. */
    savingsRate: number | null;
    /** Transfers to brokers and 3a providers, or net purchases in a broker file, CHF per month. */
    monthlyInvested: number;
    monthlyPillar3a: number;
    investRate: number | null;
    evidence: string[];
  };
  facts: InferredFact[];
  /** Ready-to-show lines, most important first. */
  headline: Msg[];
  counts: { rows: number; spend: number; income: number; transfers: number; trades: number };
}

type Row = Pick<ReviewRow, "id" | "date" | "merchant" | "raw" | "amount" | "kind" | "category">;

// Patterns run on `merchantKey()` text: lower case, no accents, letters and digits separated by single spaces.
const RE = {
  mortgage: /\b(?:hypothek\w*|hypozins\w*|hypothekarzins\w*|mortgage|interets? hypothecaires?|hypotheque|ipoteca|festhypothek|saron hypothek)\b/,
  rent: /\b(?:miete|mietzins|wohnungsmiete|monatsmiete|loyer|affitto|rent|rental|nebenkosten|charges locatives)\b/,
  leasing: /\b(?:leasing\w*|leasingrate|multilease|autoleasing|car lease|lease payment)\b/,
  loan: /\b(?:privatkredit|barkredit|kreditrate|ratenkredit|darlehen\w*|ratenzahlung|loan|credit prive|credit personnel|pret personnel|prestito|cashgate|bank now|cembra|bob finance|credit suisse kredit|migros bank kredit)\b/,
  childcare: /\b(?:kita|kitas|kindertagesstatte|kinderkrippe|krippe|kinderbetreuung|tagesmutter|tagesfamilie|tagesschule|hort|spielgruppe|creche|garderie|accueil parascolaire|uape|maman de jour|asilo nido|daycare|nursery|childcare|kindergarten)\b/,
  childAllowance: /\b(?:kinderzulagen?|familienzulagen?|ausbildungszulagen?|allocations? familiales?|allocations? pour enfants?|assegni familiari|child allowance|family allowance)\b/,
  carInsurance: /\b(?:motorfahrzeug\w*|autoversicherung|fahrzeugversicherung|kfz\w*|vollkasko|teilkasko|assurance (?:auto|vehicule|voiture)|assicurazione auto|car insurance|motor insurance)\b/,
  health: /\b(?:krankenkasse|krankenversicherung|health insurance|caisse maladie|assurance maladie|cassa malati|lamal|kvg|css|helsana|swica|sanitas|concordia|visana|kpt|groupe mutuel|assura|sympany|atupri|okk|egk)\b/,
  fuel: /\b(?:tankstelle|tanken|benzin|diesel|carburant|essence|station service|stazione di servizio|benzina|fuel|petrol|avia|migrol|socar|tamoil|agrola|coop pronto|esso|shell|ruedi ruessel|oel pool)\b/,
  carUpkeep: /\b(?:strassenverkehrsamt|motorfahrzeugsteuer|verkehrssteuer|service des automobiles|vignette|autobahnvignette|tcs|acs|garage|autogarage|carrosserie|pneu\w*|reifen\w*|autowasch\w*|car wash|mfk|parkhaus|parking)\b/,
  tax: /\b(?:steueramt|steuerverwaltung|steuern|kantonssteuer|gemeindesteuer|bundessteuer|impots?|administration fiscale|contributions? publiques?|imposte)\b/,
  pillar3a: /\b(?:viac|frankly|finpension|3a|saule 3a|pilier 3a|pilastro 3a|vorsorge 3a|vorsorgekonto|prevoyance)\b/,
  broker: /\b(?:swissquote|interactive brokers|ibkr|true wealth|selma|saxo|inyova|descartes|yuh invest|neon invest|degiro|cornertrader|postfinance e trading|etf sparplan|fondssparplan|wertschriften)\b/,
} as const;

const DAY_MS = 86_400_000;
const monthOf = (date: string) => date.slice(0, 7);
const daysIn = (date: string) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Spread around the median, relative to it: 0 for identical amounts. */
function spread(values: number[]): number {
  const mid = median(values);
  return mid > 0 ? median(values.map((v) => Math.abs(v - mid))) / mid : 1;
}

/** Months of data: whole months count 1, the first and last month by the share of their days the file covers. */
function monthsCovered(from: string, to: string): number {
  if (monthOf(from) === monthOf(to)) return (Number(to.slice(8)) - Number(from.slice(8)) + 1) / daysIn(from);
  const whole = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) - 1;
  return whole + (daysIn(from) - Number(from.slice(8)) + 1) / daysIn(from) + Number(to.slice(8)) / daysIn(to);
}

interface Group { merchant: string; rows: Row[]; months: Set<string>; text: string }

function groupByMerchant(rows: readonly Row[]): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = merchantKey(row.merchant) || row.merchant;
    const group = groups.get(key) ?? { merchant: row.merchant, rows: [], months: new Set<string>(), text: "" };
    group.rows.push(row);
    group.months.add(monthOf(row.date));
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.rows.sort((a, b) => a.date.localeCompare(b.date));
    // Merchant plus the distinct booking texts: "Health insurance" alone does not say "Krankenkasse".
    group.text = merchantKey([group.merchant, ...new Set(group.rows.map((r) => r.raw))].join(" "));
  }
  return [...groups.values()];
}

function cadenceOf(group: Group, calendarMonths: number): Cadence {
  const amounts = group.rows.map((r) => r.amount);
  if (group.rows.length < 2 || spread(amounts) > 0.15) return "irregular";
  const gaps = group.rows.slice(1).map((r, i) => dayNumber(r.date) - dayNumber(group.rows[i].date));
  const gap = median(gaps);
  // Once a month, in most months of the file.
  if (gap >= 25 && gap <= 35 && group.rows.length <= group.months.size + 1 && group.months.size >= Math.max(2, Math.ceil(calendarMonths * 0.6))) return "monthly";
  if (gap >= 80 && gap <= 100) return "quarterly";
  return "irregular";
}

function fixedKind(group: Group, category: TransactionCategory): FixedKind | undefined {
  const t = group.text;
  if (RE.mortgage.test(t)) return "mortgage";
  if (RE.leasing.test(t)) return "leasing";
  if (RE.childcare.test(t)) return "childcare";
  if (RE.loan.test(t)) return "loan";
  if (RE.tax.test(t)) return "tax";
  // "Rent" in a travel or transport booking is a rental car, not a home.
  if (category === "housing" || (RE.rent.test(t) && (category === "other" || category === "bills"))) return "rent";
  if (category === "insurance" || RE.carInsurance.test(t)) return "insurance";
  if (category === "subscriptions") return "subscription";
  return undefined;
}

/** Kinds that are obligations by name: one payment is enough to list them, a pattern raises the confidence. */
const NAMED: readonly FixedKind[] = ["rent", "mortgage", "insurance", "leasing", "loan", "childcare", "tax"];
const KIND_ORDER: readonly FixedKind[] = ["rent", "mortgage", "insurance", "leasing", "loan", "childcare", "tax", "bills", "transit", "subscription", "other"];

/** How sure a named payee makes a fact, by how often it was paid. */
const byMonths = (months: number, once: number, twice: number, often: number) => (months >= 3 ? often : months === 2 ? twice : once);
const combine = (signals: number[]) => Math.min(0.95, 1 - signals.reduce((rest, p) => rest * (1 - p), 1));
const ids = (rows: readonly Row[]) => rows.map((r) => r.id);
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

export function summarizeStatement(review: Pick<Review, "rows" | "trades">): StatementSummary | undefined {
  const rows: Row[] = [...review.rows].sort((a, b) => a.date.localeCompare(b.date));
  const trades = review.trades.map((t) => ({ id: t.id, ...t.trade })).sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...rows.map((r) => r.date), ...trades.map((t) => t.date)].sort();
  if (!dates.length) return undefined;
  const from = dates[0];
  const to = dates[dates.length - 1];
  const covered = monthsCovered(from, to);
  // Under a month there is nothing to average: totals stand for one month.
  const months = Math.max(1, covered);
  const calendarMonths = new Set(dates.map(monthOf)).size;
  const perMonth = (total: number) => round2(total / months);
  const mostMonths = (active: number) => active >= Math.max(2, Math.ceil(calendarMonths * 0.6));
  /**
   * CHF per month of a flow. One that arrives in most months (a salary, a standing order) is the median month: a
   * file from the 26th to the 26th holds five salaries in four months of days. Anything else is total / months.
   */
  const monthlyFlow = (entries: readonly { date: string; amount: number }[]) => {
    const byMonth = new Map<string, number>();
    for (const e of entries) byMonth.set(monthOf(e.date), (byMonth.get(monthOf(e.date)) ?? 0) + e.amount);
    return mostMonths(byMonth.size) ? round2(median([...byMonth.values()])) : perMonth(sum(entries.map((e) => e.amount)));
  };

  // ---- income ----
  const incomeRows = rows.filter((r) => r.kind === "income");
  const incomeTotal = round2(sum(incomeRows.map((r) => -r.amount)));
  const sources: IncomeSource[] = groupByMerchant(incomeRows).map((g) => {
    const total = round2(sum(g.rows.map((r) => -r.amount)));
    const credits = g.rows.filter((r) => r.amount < 0).map((r) => -r.amount);
    const regular = mostMonths(g.months.size) && credits.length >= 2 && spread(credits) <= 0.2;
    return { merchant: g.merchant, monthlyAvg: monthlyFlow(g.rows.map((r) => ({ date: r.date, amount: -r.amount }))), total, occurrences: g.rows.length, months: g.months.size, regular, evidence: ids(g.rows) };
  }).sort((a, b) => b.total - a.total);
  const incomeByMonth = new Map<string, number>();
  for (const r of incomeRows) incomeByMonth.set(monthOf(r.date), (incomeByMonth.get(monthOf(r.date)) ?? 0) - r.amount);
  const monthly = [...incomeByMonth.values()];
  const mean = monthly.length ? sum(monthly) / monthly.length : 0;
  const deviation = monthly.length ? Math.sqrt(sum(monthly.map((v) => (v - mean) ** 2)) / monthly.length) : 0;
  // Months without any income count against regularity as much as uneven amounts do.
  const regularity = monthly.length >= 2 && mean > 0 ? round2(Math.max(0, 1 - deviation / mean) * Math.min(1, monthly.length / calendarMonths)) : null;

  // ---- spending: fixed and variable ----
  const spendRows = rows.filter((r) => r.kind === "spend" || r.kind === "refund");
  const groups = groupByMerchant(spendRows);
  const fixedItems: RecurringCost[] = [];
  const fixedRows = new Set<string>();
  const kindOfGroup = new Map<Group, FixedKind>();
  for (const g of groups) {
    const paid = g.rows.filter((r) => r.amount > 0);
    if (!paid.length) continue;
    // The category most of the group's rows carry.
    const counts = new Map<TransactionCategory, number>();
    for (const r of paid) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    const category = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const cadence = cadenceOf({ ...g, rows: paid }, calendarMonths);
    const named = fixedKind(g, category);
    // A stable monthly amount is a standing cost for a utility, a pass or an unknown payee. The same lunch every
    // month is a habit: groceries, dining, shopping and travel stay variable.
    const kind: FixedKind | undefined = named && NAMED.includes(named) ? named
      : cadence === "irregular" ? undefined
        : named ?? (category === "bills" ? "bills" : category === "transport" && !RE.fuel.test(g.text) ? "transit" : category === "other" || category === "housing" ? "other" : undefined);
    if (!kind) continue;
    const typical = round2(median(paid.map((r) => r.amount)));
    const total = sum(g.rows.map((r) => r.amount));
    const monthlyAmount = cadence === "monthly" ? typical : cadence === "quarterly" ? round2(typical / 3) : perMonth(total);
    kindOfGroup.set(g, kind);
    for (const r of g.rows) fixedRows.add(r.id);
    fixedItems.push({
      kind, merchant: g.merchant, category, monthlyAmount, typicalAmount: typical, cadence,
      occurrences: paid.length, months: g.months.size, evidence: ids(g.rows),
      label: msg(`statement.kind.${kind}`),
    });
  }
  fixedItems.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.monthlyAmount - a.monthlyAmount);
  const fixedMonthly = round2(sum(fixedItems.map((i) => i.monthlyAmount)));

  const variableRows = spendRows.filter((r) => !fixedRows.has(r.id));
  const byCategoryMap = new Map<TransactionCategory, { total: number; count: number }>();
  for (const r of variableRows) {
    const entry = byCategoryMap.get(r.category) ?? { total: 0, count: 0 };
    entry.total += r.amount;
    entry.count += 1;
    byCategoryMap.set(r.category, entry);
  }
  const variableTotal = sum([...byCategoryMap.values()].map((e) => e.total));
  const byCategory: CategorySpend[] = [...byCategoryMap].map(([category, e]) => ({
    category, total: round2(e.total), monthlyAvg: perMonth(e.total), count: e.count, share: variableTotal > 0 ? round2(Math.max(0, e.total) / variableTotal) : 0,
  })).sort((a, b) => b.total - a.total);

  // ---- saving and investing ----
  const transferOut = rows.filter((r) => r.kind === "transfer" && r.amount > 0);
  const textOf = (r: Row) => merchantKey(`${r.merchant} ${r.raw}`);
  const to3a = transferOut.filter((r) => RE.pillar3a.test(textOf(r)));
  const toBroker = transferOut.filter((r) => !to3a.includes(r) && RE.broker.test(textOf(r)));
  const tradeFlow = (list: typeof trades) => sum(list.map((t) => (t.side === "buy" ? t.amount : -t.amount)));
  const trades3a = trades.filter((t) => t.account === "3a");
  const tradesBroker = trades.filter((t) => t.account !== "3a");
  const pillar3aTotal = sum(to3a.map((r) => r.amount)) + Math.max(0, tradeFlow(trades3a));
  const brokerTotal = sum(toBroker.map((r) => r.amount)) + Math.max(0, tradeFlow(tradesBroker));
  const spendTotal = sum(spendRows.map((r) => r.amount));
  const flowOf = (transfers: readonly Row[], bought: typeof trades) =>
    monthlyFlow([...transfers, ...bought.map((t) => ({ date: t.date, amount: t.side === "buy" ? t.amount : -t.amount }))]);
  const monthlyPillar3a = pillar3aTotal > 0 ? Math.max(0, flowOf(to3a, trades3a)) : 0;
  const monthlyBroker = brokerTotal > 0 ? Math.max(0, flowOf(toBroker, tradesBroker)) : 0;
  const monthlyIncome = round2(sum(sources.map((s) => s.monthlyAvg)));
  const monthlyNet = round2(monthlyIncome - perMonth(spendTotal));
  const monthlyInvested = round2(monthlyPillar3a + monthlyBroker);

  // ---- facts ----
  const facts: InferredFact[] = [];
  const fact = (id: FactId, confidence: number, monthlyAmount: number, evidenceRows: readonly { id: string }[], merchants: string[], reasons: Msg[]) => {
    if (confidence <= 0 || !evidenceRows.length) return;
    facts.push({
      id, confidence: round2(Math.min(0.95, confidence)), monthlyAmount: round2(monthlyAmount),
      merchants: [...new Set(merchants)], evidence: [...new Set(evidenceRows.map((r) => r.id))],
      title: msg(`statement.fact.${id}`), reasons,
    });
  };
  const payee = (item: RecurringCost) => msg("statement.reason.payee", { kind: item.label, merchant: item.merchant, amount: item.monthlyAmount, months: item.months, of: calendarMonths });
  const itemsOf = (kind: FixedKind) => fixedItems.filter((i) => i.kind === kind);
  const rowsOfItems = (items: RecurringCost[]) => items.flatMap((i) => i.evidence.map((id) => ({ id })));

  // A family allowance arrives as regularly as pay; it is evidence for a child, not a salary.
  const salary = sources.filter((s) => s.regular && !RE.childAllowance.test(merchantKey(s.merchant)));
  if (salary.length) {
    fact("salary", byMonths(Math.max(...salary.map((s) => s.months)), 0, 0.7, 0.9), sum(salary.map((s) => s.monthlyAvg)),
      salary.flatMap((s) => s.evidence.map((id) => ({ id }))), salary.map((s) => s.merchant),
      salary.map((s) => msg("statement.reason.salary", { merchant: s.merchant, amount: s.monthlyAvg, months: s.months, of: calendarMonths })));
  }

  for (const [id, kind, once, twice, often] of [["tenant", "rent", 0.5, 0.75, 0.9], ["owner", "mortgage", 0.6, 0.8, 0.9], ["child", "childcare", 0.6, 0.8, 0.9], ["debt", "loan", 0.5, 0.75, 0.85]] as const) {
    const items = itemsOf(kind);
    if (!items.length) continue;
    const signals = [byMonths(Math.max(...items.map((i) => i.months)), once, twice, often)];
    const evidence = rowsOfItems(items);
    const reasons = items.map(payee);
    if (id === "child") {
      const allowance = incomeRows.filter((r) => RE.childAllowance.test(textOf(r)));
      if (allowance.length) {
        signals.push(0.7);
        evidence.push(...allowance);
        reasons.push(msg("statement.reason.allowance", { count: allowance.length }));
      }
    }
    fact(id, combine(signals), sum(items.map((i) => i.monthlyAmount)), evidence, items.map((i) => i.merchant), reasons);
  }
  // A family allowance without a daycare payee still points to a child.
  if (!facts.some((f) => f.id === "child")) {
    const allowance = [...incomeRows, ...rows.filter((r) => r.kind === "refund")].filter((r) => RE.childAllowance.test(textOf(r)));
    if (allowance.length) fact("child", 0.7, 0, allowance, [...new Set(allowance.map((r) => r.merchant))], [msg("statement.reason.allowance", { count: allowance.length })]);
  }

  // Car: a leasing rate, motor insurance, fuel in several months, road tax or a garage. Signals add up.
  const leasing = itemsOf("leasing");
  const carInsurance = fixedItems.filter((i) => i.kind === "insurance" && RE.carInsurance.test(merchantKey(i.merchant + " " + spendRows.filter((r) => i.evidence.includes(r.id)).map((r) => r.raw).join(" "))));
  const otherInsurance = fixedItems.filter((i) => i.kind === "insurance" && !carInsurance.includes(i)
    && !RE.health.test(merchantKey(i.merchant + " " + spendRows.filter((r) => i.evidence.includes(r.id)).map((r) => r.raw).join(" "))));
  const fuelRows = spendRows.filter((r) => r.amount > 0 && RE.fuel.test(textOf(r)));
  const fuelMonths = new Set(fuelRows.map((r) => monthOf(r.date))).size;
  const upkeepRows = spendRows.filter((r) => r.amount > 0 && !fuelRows.includes(r) && RE.carUpkeep.test(textOf(r)));
  const carSignals: number[] = [];
  const carReasons: Msg[] = [];
  if (leasing.length) {
    carSignals.push(byMonths(Math.max(...leasing.map((i) => i.months)), 0.6, 0.8, 0.85));
    carReasons.push(...leasing.map(payee));
  }
  if (carInsurance.length) {
    carSignals.push(0.6);
    carReasons.push(...carInsurance.map(payee));
  }
  if (fuelRows.length >= 2) {
    carSignals.push(fuelMonths >= 3 ? 0.5 : fuelMonths === 2 ? 0.4 : 0.25);
    carReasons.push(msg("statement.reason.fuel", { count: fuelRows.length, months: fuelMonths, amount: perMonth(sum(fuelRows.map((r) => r.amount))) }));
  }
  if (upkeepRows.length) {
    carSignals.push(0.2);
    carReasons.push(msg("statement.reason.upkeep", { count: upkeepRows.length }));
  }
  // An insurer that is not a health insurer supports a car only together with fuel ("fuel + insurance").
  if (fuelRows.length >= 2 && !carInsurance.length && otherInsurance.length) {
    carSignals.push(0.3);
    carReasons.push(...otherInsurance.map(payee));
  }
  if (leasing.length || carInsurance.length || fuelRows.length >= 2) {
    const insured = carInsurance.length ? carInsurance : fuelRows.length >= 2 ? otherInsurance : [];
    fact("car", combine(carSignals),
      sum([...leasing, ...carInsurance].map((i) => i.monthlyAmount)) + perMonth(sum([...fuelRows, ...upkeepRows].map((r) => r.amount))),
      [...rowsOfItems([...leasing, ...insured]), ...fuelRows, ...upkeepRows],
      [...leasing, ...insured].map((i) => i.merchant), carReasons);
  }

  const investEvidence = [...toBroker, ...tradesBroker.filter((t) => t.side === "buy")];
  if (brokerTotal > 0) {
    const investMonths = new Set(investEvidence.map((r) => monthOf(r.date))).size;
    fact("investor", byMonths(investMonths, 0.5, 0.7, 0.9), monthlyBroker, investEvidence,
      [...toBroker.map((r) => r.merchant), ...tradesBroker.map((t) => t.instrument)],
      [msg("statement.reason.invest", { amount: monthlyBroker, months: investMonths, of: calendarMonths })]);
  }
  const pillarEvidence = [...to3a, ...trades3a.filter((t) => t.side === "buy")];
  if (pillar3aTotal > 0) {
    const pillarMonths = new Set(pillarEvidence.map((r) => monthOf(r.date))).size;
    fact("pillar3a", byMonths(pillarMonths, 0.6, 0.8, 0.9), monthlyPillar3a, pillarEvidence,
      [...to3a.map((r) => r.merchant), ...trades3a.map((t) => t.instrument)],
      [msg("statement.reason.pillar3a", { amount: monthlyPillar3a, months: pillarMonths, of: calendarMonths })]);
  }
  facts.sort((a, b) => b.confidence - a.confidence);

  // ---- headline ----
  const yyyymm = (date: string) => Number(date.slice(0, 4)) * 100 + Number(date.slice(5, 7));
  const headline: Msg[] = [msg("statement.headline.period", { months: round2(covered), from: yyyymm(from), to: yyyymm(to), rows: rows.length + trades.length })];
  if (incomeTotal > 0) headline.push(msg("statement.headline.income", { amount: monthlyIncome, regularity: regularity ?? 0 }));
  if (fixedItems.length) headline.push(msg("statement.headline.fixed", { amount: fixedMonthly, count: fixedItems.length }));
  if (byCategory.length) headline.push(msg("statement.headline.variable", { amount: perMonth(variableTotal), category: byCategory[0].category === "other" ? msg("statement.categoryOther") : msg(`category.${byCategory[0].category}`) }));
  if (monthlyIncome > 0) headline.push(msg("statement.headline.saving", { rate: monthlyNet / monthlyIncome, amount: monthlyNet }));
  if (monthlyInvested > 0) headline.push(msg("statement.headline.invest", { amount: monthlyInvested }));
  if (covered < 2) headline.push(msg("statement.headline.short"));

  return {
    period: { from, to, months: round2(covered), calendarMonths, reliable: covered >= 2 },
    income: { monthlyAvg: monthlyIncome, total: incomeTotal, regularity, sources },
    fixed: { monthlyTotal: fixedMonthly, items: fixedItems },
    variable: { monthlyTotal: perMonth(variableTotal), byCategory },
    saving: {
      monthlyNet,
      savingsRate: monthlyIncome > 0 ? round2(monthlyNet / monthlyIncome) : null,
      monthlyInvested,
      monthlyPillar3a,
      investRate: monthlyIncome > 0 ? round2(monthlyInvested / monthlyIncome) : null,
      evidence: [...ids(to3a), ...ids(toBroker), ...trades.filter((t) => t.side === "buy").map((t) => t.id)],
    },
    facts,
    headline,
    counts: {
      rows: rows.length,
      spend: spendRows.length,
      income: incomeRows.length,
      transfers: rows.filter((r) => r.kind === "transfer").length,
      trades: trades.length,
    },
  };
}

/** Summary of a freshly parsed file, before it is compared with what the account already has. */
export function summarizeParsed(parsed: ParsedStatement, overrides: Readonly<Record<string, TransactionCategory>> = {}): StatementSummary | undefined {
  return summarizeStatement(buildReview(parsed, { transactions: [], trades: [], refs: new Set<string>() }, overrides));
}

/** The summary as `ask` facts (see `ASK_FACT_KEYS` in src/lib/llm.ts), so a question can be answered from it. */
export function summaryAskFacts(summary: StatementSummary): AskFacts {
  const pct = (share: number | null) => (share === null ? undefined : Math.round(share * 1000) / 10);
  const facts: AskFacts = {
    statement_months: summary.period.months,
    statement_income_month_chf: Math.round(summary.income.monthlyAvg),
    statement_fixed_month_chf: Math.round(summary.fixed.monthlyTotal),
    statement_variable_month_chf: Math.round(summary.variable.monthlyTotal),
    statement_invest_month_chf: Math.round(summary.saving.monthlyInvested),
  };
  const rate = pct(summary.saving.savingsRate);
  if (rate !== undefined) facts.statement_savings_rate_pct = rate;
  if (summary.variable.byCategory[0]) facts.statement_top_category = summary.variable.byCategory[0].category;
  const likely = summary.facts.filter((f) => f.confidence >= 0.5).map((f) => f.id);
  if (likely.length) facts.statement_facts = likely.join(", ");
  return facts;
}

