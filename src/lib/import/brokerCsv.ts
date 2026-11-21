import type { InvestmentTrade } from "@/lib/finance/types";
import { msg, type Msg } from "@/lib/i18n/types";
import { column, hasMarker, readTable, type CsvTable } from "./table";
import { detectDelimiter, headerKey, parseAmount, parseCsv, parseDate, round2 } from "./text";
import type { ParsedStatement, SkippedRow } from "./types";

/**
 * Broker and pillar 3a statement readers → `InvestmentTrade`s. Every profile is BASED ON THE TYPICAL EXPORT LAYOUT
 * (Swissquote transactions CSV, Interactive Brokers Activity Statement and Flex trades CSV, VIAC and frankly
 * transaction lists); none is verified against real customer files. Unknown layouts go to `parseTradesManual`.
 *
 * Amounts are the gross trade value in CHF (net cash ∓ costs). Rows in another currency are skipped with a message
 * unless the file has a CHF amount column.
 */

export interface BrokerProfile {
  id: string;
  name: string;
  account: InvestmentTrade["account"];
  marker: readonly (readonly string[])[];
  date: readonly string[];
  side?: readonly string[];
  symbol?: readonly string[];
  name_: readonly string[];
  units?: readonly string[];
  price?: readonly string[];
  /** Signed or unsigned cash amount; `chfAmount` wins when present. */
  amount: readonly string[];
  chfAmount?: readonly string[];
  costs?: readonly string[];
  currency?: readonly string[];
  /** Asset type column ("ETF", "STK", "Fund"…), if any. */
  assetType?: readonly string[];
}

export const BROKER_PROFILES: readonly BrokerProfile[] = [
  {
    id: "swissquote",
    name: "Swissquote",
    account: "broker",
    marker: [["order #", "transaction", "symbol", "net amount"], ["auftrag #", "transaktion", "symbol", "nettobetrag"]],
    date: ["date", "datum"],
    side: ["transaction", "transaktion"],
    symbol: ["symbol"],
    name_: ["name"],
    units: ["quantity", "anzahl", "quantité"],
    price: ["unit price", "stückpreis", "prix unitaire"],
    amount: ["net amount", "nettobetrag", "montant net"],
    costs: ["costs", "kosten", "frais"],
    currency: ["currency", "währung", "devise"],
  },
  {
    id: "ibkr-flex",
    name: "Interactive Brokers (Flex)",
    account: "broker",
    marker: [["buy/sell", "tradeprice"]],
    date: ["tradedate", "date/time", "datetime"],
    side: ["buy/sell"],
    symbol: ["symbol"],
    name_: ["description"],
    units: ["quantity"],
    price: ["tradeprice"],
    amount: ["proceeds", "trademoney", "netcash"],
    costs: ["ibcommission"],
    currency: ["currencyprimary", "currency"],
    assetType: ["assetclass", "subcategory"],
  },
  {
    id: "viac",
    name: "VIAC",
    account: "3a",
    marker: [["portfolio", "instrument", "units", "amount (chf)"], ["portfolio", "instrument", "anteile", "betrag (chf)"]],
    date: ["date", "datum"],
    side: ["type", "typ"],
    name_: ["instrument"],
    units: ["units", "anteile"],
    price: ["price (chf)", "kurs (chf)"],
    amount: ["amount (chf)", "betrag (chf)"],
    chfAmount: ["amount (chf)", "betrag (chf)"],
  },
  {
    id: "frankly",
    name: "frankly",
    account: "3a",
    marker: [["transaktionsart", "fonds", "betrag chf"], ["transaction type", "fund", "amount chf"]],
    date: ["datum", "date"],
    side: ["transaktionsart", "transaction type"],
    name_: ["fonds", "fund"],
    units: ["anteile", "units"],
    price: ["kurs", "price"],
    amount: ["betrag chf", "amount chf"],
    chfAmount: ["betrag chf", "amount chf"],
  },
];

const BUY = /^(?:buy|bought|bot|b|kauf|käufe|purchase|achat|acquisto|compra)\b/i;
const SELL = /^(?:sell|sold|sld|s|verkauf|verkäufe|sale|vente|vendita|venta)\b/i;
const DEPOSIT = /^(?:deposit|einzahlung|einlage|versement|contribution|beitrag|transfer in|cash in|überweisung)\b/i;
const FUND = /\b(?:etf|etc|fund|fonds|fondo|index|indexfonds|ishares|vanguard|spdr|xtrackers|amundi|lyxor|invesco|ubs etf|msci|ftse|s&p ?500|stoxx|global \d{2,3}|pillar 3a|säule 3a|3a)\b/i;

/** "fund" for ETFs and funds (by asset type or name), "stock" otherwise. 3a positions are always funds. */
export function instrumentKind(name: string, assetType?: string, account?: InvestmentTrade["account"]): InvestmentTrade["kind"] {
  if (account === "3a") return "fund";
  if (assetType && /^(?:etf|fund|fonds|etc|mf|ucits)/i.test(assetType)) return "fund";
  if (assetType && /^(?:stk|stock|stocks|aktie|action|equity|share)/i.test(assetType) && !FUND.test(name)) return "stock";
  return FUND.test(name) ? "fund" : "stock";
}

/** "iShares Core MSCI World" + "SWDA" → "iShares Core MSCI World (SWDA)". */
export function instrumentName(name: string, symbol?: string): string {
  const n = name.trim();
  const s = (symbol ?? "").trim();
  if (!s || n.toUpperCase().includes(`(${s.toUpperCase()})`)) return n || s;
  return n ? `${n} (${s})` : s;
}

function finishTrades(trades: InvestmentTrade[], deposits: InvestmentTrade[], skipped: SkippedRow[], profile: string): ParsedStatement {
  const notes: Msg[] = [];
  let all = trades;
  if (deposits.length && trades.some((t) => t.side === "buy")) notes.push(msg("data.depositsIgnored", { count: deposits.length }));
  else if (deposits.length) {
    all = [...trades, ...deposits];
    notes.push(msg("data.depositsAsContributions", { count: deposits.length }));
  }
  return { format: "broker-csv", profile, rows: [], trades: all, skipped, notes };
}

function parseProfileTable(table: CsvTable, p: BrokerProfile): ParsedStatement {
  const col = (alts?: readonly string[]) => column(table, alts);
  const c = {
    date: col(p.date),
    side: col(p.side),
    symbol: col(p.symbol),
    name: col(p.name_),
    units: col(p.units),
    price: col(p.price),
    amount: col(p.amount),
    chf: col(p.chfAmount),
    costs: col(p.costs),
    currency: col(p.currency),
    type: col(p.assetType),
  };
  const trades: InvestmentTrade[] = [];
  const deposits: InvestmentTrade[] = [];
  const skipped: SkippedRow[] = [];
  table.rows.forEach((cells, i) => {
    const line = table.firstLine + i + 1;
    const cell = (idx: number) => (idx >= 0 ? (cells[idx] ?? "").trim() : "");
    const date = parseDate(cell(c.date));
    if (!date) return void skipped.push({ line, reason: "badDate" });
    const sideText = cell(c.side);
    const quantity = parseAmount(cell(c.units));
    const isDeposit = p.account === "3a" && DEPOSIT.test(sideText);
    let side: InvestmentTrade["side"] | undefined = BUY.test(sideText) ? "buy" : SELL.test(sideText) ? "sell" : undefined;
    // No side column (manual mapping): a negative quantity is a sell, anything else a buy.
    if (!side && c.side < 0) side = (quantity ?? 0) < 0 ? "sell" : "buy";
    if (!side && !isDeposit) return void skipped.push({ line, reason: "notATrade" });
    const currency = (cell(c.currency) || "CHF").toUpperCase();
    const chf = c.chf >= 0 ? parseAmount(cell(c.chf)) : undefined;
    if (chf === undefined && currency !== "CHF") return void skipped.push({ line, reason: "foreignCurrency", currency });
    const raw = chf ?? parseAmount(cell(c.amount));
    if (raw === undefined || raw === 0) return void skipped.push({ line, reason: raw === 0 ? "zero" : "badAmount" });
    const costs = Math.abs(parseAmount(cell(c.costs)) ?? 0);
    // Net cash includes costs: gross = |net| − costs for buys, |net| + costs for sells.
    const amount = round2(chf !== undefined ? Math.abs(chf) : Math.abs(raw) + (side === "sell" ? costs : -costs));
    const instrument = instrumentName(cell(c.name), cell(c.symbol)) || (p.account === "3a" ? "Pillar 3a" : "?");
    const price = parseAmount(cell(c.price));
    const trade: InvestmentTrade = {
      date,
      account: p.account,
      instrument,
      kind: instrumentKind(instrument, cell(c.type), p.account),
      side: side ?? "buy",
      amount,
      ...(quantity ? { units: Math.abs(quantity) } : {}),
      ...(price ? { price: Math.abs(price) } : {}),
    };
    (isDeposit ? deposits : trades).push(trade);
  });
  return finishTrades(trades, deposits, skipped, p.id);
}

/**
 * Interactive Brokers Activity Statement (multi-section CSV): rows of the "Trades" section with
 * DataDiscriminator "Order", names and ETF/stock type from "Financial Instrument Information".
 */
export function parseIbkrActivity(text: string): ParsedStatement | undefined {
  const rows = parseCsv(text, ",");
  if (!rows.some((r) => r[0] === "Trades" && r[1] === "Header")) return undefined;
  const info = new Map<string, { name: string; type: string }>();
  let infoHeader: string[] = [];
  let tradeHeader: string[] = [];
  const trades: InvestmentTrade[] = [];
  const skipped: SkippedRow[] = [];
  rows.forEach((r) => {
    if (r[0] === "Financial Instrument Information") {
      if (r[1] === "Header") infoHeader = r.map(headerKey);
      else if (r[1] === "Data") {
        const get = (k: string) => r[infoHeader.indexOf(k)] ?? "";
        info.set(get("symbol"), { name: get("description"), type: get("type") });
      }
    }
  });
  rows.forEach((r, i) => {
    if (r[0] !== "Trades") return;
    if (r[1] === "Header") {
      tradeHeader = r.map(headerKey);
      return;
    }
    if (r[1] !== "Data") return;
    const get = (k: string) => (r[tradeHeader.indexOf(k)] ?? "").trim();
    if (get("datadiscriminator") && get("datadiscriminator").toLowerCase() !== "order") return;
    const line = i + 1;
    const date = parseDate(get("date/time"));
    if (!date) return void skipped.push({ line, reason: "badDate" });
    const currency = (get("currency") || "CHF").toUpperCase();
    if (currency !== "CHF") return void skipped.push({ line, reason: "foreignCurrency", currency });
    const quantity = parseAmount(get("quantity"));
    const proceeds = parseAmount(get("proceeds"));
    if (!quantity || proceeds === undefined || proceeds === 0) return void skipped.push({ line, reason: "badAmount" });
    const symbol = get("symbol");
    const meta = info.get(symbol);
    const instrument = instrumentName(meta?.name ?? "", symbol);
    const price = parseAmount(get("t. price"));
    trades.push({
      date,
      account: "broker",
      instrument,
      kind: instrumentKind(instrument, meta?.type),
      side: quantity < 0 ? "sell" : "buy",
      amount: round2(Math.abs(proceeds)),
      units: Math.abs(quantity),
      ...(price ? { price } : {}),
    });
  });
  return finishTrades(trades, [], skipped, "ibkr");
}

export function detectBrokerProfile(table: CsvTable): BrokerProfile | undefined {
  return BROKER_PROFILES.find((p) => hasMarker(table, p.marker) && column(table, p.date) >= 0 && column(table, p.amount) >= 0);
}

/** Parses a broker / 3a CSV with a known layout; undefined when none matches. */
export function parseBrokerCsv(text: string): (ParsedStatement & { table?: CsvTable }) | undefined {
  const ibkr = parseIbkrActivity(text);
  if (ibkr) return ibkr;
  const table = readTable(text, detectDelimiter(text));
  const profile = detectBrokerProfile(table);
  if (!profile) return undefined;
  return { ...parseProfileTable(table, profile), table };
}

/** Manual mapping for trade files with an unknown layout. Indexes into the header row. */
export interface TradeMapping {
  account: InvestmentTrade["account"];
  date: number;
  instrument: number;
  amount: number;
  side?: number;
  units?: number;
  price?: number;
  currency?: number;
}

export function parseTradesManual(table: CsvTable, m: TradeMapping): ParsedStatement {
  const keys = (i?: number) => (i !== undefined && i >= 0 ? [table.keys[i]] : undefined);
  return parseProfileTable(table, {
    id: "manual",
    name: "manual",
    account: m.account,
    marker: [],
    date: keys(m.date) ?? [],
    side: keys(m.side),
    name_: keys(m.instrument) ?? [],
    units: keys(m.units),
    price: keys(m.price),
    amount: keys(m.amount) ?? [],
    currency: keys(m.currency),
  });
}

/** Best-effort default for the manual trade mapping. */
export function guessTradeMapping(table: CsvTable): TradeMapping {
  const find = (alts: string[]) => table.keys.findIndex((k) => alts.some((a) => k === a || k.startsWith(a)));
  const opt = (i: number) => (i >= 0 ? i : undefined);
  return {
    account: "broker",
    date: Math.max(0, find(["date", "datum", "tradedate", "trade date", "buchungsdatum"])),
    instrument: Math.max(0, find(["instrument", "name", "description", "fonds", "fund", "titel", "security", "valor"])),
    amount: Math.max(0, find(["amount", "betrag", "montant", "net amount", "proceeds", "total"])),
    side: opt(find(["side", "type", "typ", "transaction", "buy/sell", "transaktionsart", "action"])),
    units: opt(find(["units", "quantity", "anteile", "anzahl", "stück", "quantité"])),
    price: opt(find(["price", "kurs", "unit price", "prix"])),
    currency: opt(find(["currency", "währung", "devise", "ccy"])),
  };
}
