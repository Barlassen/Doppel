/**
 * Sample statement files generated FROM the built-in accounts' data (src/lib/data/history.ts via profiles.ts), so
 * importing them into a fresh account recreates that account's transactions and trades. Used by
 * `scripts/make-import-samples.ts` (writes public/samples/imports/) and `scripts/import-check.ts` (round trip).
 *
 * The layouts follow the TYPICAL export of each provider (see the profiles in bankCsv.ts / brokerCsv.ts). They are
 * fictional files, not copies of real exports. Besides the account's own rows, each file carries what a real
 * statement would: salary credits, transfers to the user's broker / 3a / card accounts, and (Revolut, Swissquote)
 * a few rows the importer must skip — all of which stay out of the recreated history by design.
 */
import { PROFILES } from "@/lib/data/profiles";
import type { InvestmentTrade, Profile, Transaction } from "@/lib/finance/types";

export interface SampleFile {
  /** File name in public/samples/imports/. */
  name: string;
  account: string;
  kind: "bank" | "broker";
  /** Provider shown in the UI. */
  provider: string;
  bytes: Uint8Array;
}

const byId = (id: string): Profile => PROFILES.find((p) => p.id === id)!;
const months = (p: Profile) => [...new Set(p.transactions.map((t) => t.date.slice(0, 7)))].sort();
const sortByDate = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const dmy = (iso: string, sep = ".") => `${iso.slice(8, 10)}${sep}${iso.slice(5, 7)}${sep}${iso.slice(0, 4)}`;
const fixed2 = (n: number) => n.toFixed(2);
/** 1520 → "1'520.00" (Swiss apostrophe grouping). */
const swiss = (n: number) => {
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${dec}`;
};
const csvCell = (v: string, delimiter: string) => (/["\n\r]/.test(v) || v.includes(delimiter) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows: (string | number)[][], delimiter: string, quoteAll = false) =>
  rows.map((r) => r.map((c) => (quoteAll ? `"${String(c).replace(/"/g, '""')}"` : csvCell(String(c), delimiter))).join(delimiter)).join("\r\n") + "\r\n";
const MONTH_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONTH_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const monthIndex = (ym: string) => Number(ym.slice(5, 7)) - 1;
const salaryOf = (p: Profile) => p.netIncomeMonth;
const FIXED = new Set<Transaction["category"]>(["housing", "insurance", "bills"]);

const utf8 = (s: string, bom = false) => {
  const body = new TextEncoder().encode(s);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
};
/** Windows-1252 bytes (older e-banking exports). Characters outside the code page become "?". */
const CP1252_HIGH: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x201e: 0x84, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2013: 0x96, 0x2014: 0x97 };
function cp1252(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out.push(c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : (CP1252_HIGH[c] ?? 0x3f));
  }
  return Uint8Array.from(out);
}

// ---------------- Barlas: ZKB CSV (Windows-1252) + VIAC 3a CSV + IBKR Activity Statement ----------------

function zkbCsv(p: Profile): Uint8Array {
  const header = ["Datum", "Buchungstext", "Whg", "Betrag Detail", "ZKB-Referenz", "Referenznummer", "Belastung CHF", "Gutschrift CHF", "Valuta", "Saldo CHF", "Zahlungszweck", "Details"];
  interface Line { date: string; text: string; debit?: number; credit?: number; purpose?: string }
  const lines: Line[] = p.transactions.map((t, i) => ({
    date: t.date,
    text: FIXED.has(t.category) || t.merchant === "ZVV NetzPass" || t.category === "subscriptions"
      ? `Dauerauftrag: ${t.merchant}`
      : i % 3 === 0
        ? `Einkauf ZKB Visa Debit ${t.merchant} ${dmy(t.date)} Kartennr. xxxx 4821`
        : `Einkauf Debitkarte ${t.merchant}`,
    debit: t.amount,
  }));
  for (const m of months(p)) {
    lines.push({ date: `${m}-25`, text: "Gutschrift Lohn Brightline Software AG", credit: salaryOf(p), purpose: `Lohn ${MONTH_DE[monthIndex(m)]} ${m.slice(0, 4)}` });
  }
  for (const t of p.trades) {
    lines.push({ date: t.date, text: t.account === "3a" ? "Dauerauftrag: VIAC 3a Einzahlung" : "eBanking-Auftrag: Interactive Brokers (U.K.) Ltd", debit: t.amount });
  }
  let balance = 2_000;
  const rows = sortByDate(lines).map((l, i) => {
    balance += (l.credit ?? 0) - (l.debit ?? 0);
    return [
      dmy(l.date), l.text, "CHF", "", `Z${l.date.replace(/-/g, "")}${String(i).padStart(4, "0")}`, "",
      l.debit ? swiss(l.debit) : "", l.credit ? swiss(l.credit) : "", dmy(l.date), swiss(balance), l.purpose ?? "", "",
    ];
  });
  return cp1252(csv([header, ...rows], ";"));
}

function viacCsv(p: Profile): Uint8Array {
  const header = ["Date", "Type", "Portfolio", "Instrument", "ISIN", "Units", "Price (CHF)", "Amount (CHF)"];
  const rows: (string | number)[][] = [];
  for (const t of sortByDate(p.trades.filter((x) => x.account === "3a"))) {
    rows.push([t.date, "Deposit", "Global 60", "", "", "", "", fixed2(t.amount)]);
    rows.push([t.date, t.side === "buy" ? "Purchase" : "Sale", "Global 60", t.instrument, "", String(t.units ?? ""), fixed2(t.price ?? 0), fixed2(t.amount)]);
  }
  return utf8(csv([header, ...rows], ","));
}

function ibkrActivity(p: Profile): Uint8Array {
  const broker = sortByDate(p.trades.filter((x) => x.account === "broker"));
  const symbols = new Map<string, { symbol: string; name: string; type: string }>();
  for (const t of broker) {
    const m = /^(.*) \(([^)]+)\)$/.exec(t.instrument);
    symbols.set(t.instrument, { symbol: m ? m[2] : t.instrument, name: m ? m[1] : t.instrument, type: t.kind === "stock" ? "COMMON" : "ETF" });
  }
  const rows: (string | number)[][] = [
    ["Statement", "Header", "Field Name", "Field Value"],
    ["Statement", "Data", "BrokerName", "Interactive Brokers"],
    ["Statement", "Data", "Title", "Activity Statement"],
    ["Statement", "Data", "Period", `${months(p)[0]} - ${months(p).at(-1)}`],
    ["Account Information", "Header", "Field Name", "Field Value"],
    ["Account Information", "Data", "Base Currency", "CHF"],
    ["Trades", "Header", "DataDiscriminator", "Asset Category", "Currency", "Symbol", "Date/Time", "Quantity", "T. Price", "C. Price", "Proceeds", "Comm/Fee", "Basis", "Realized P/L", "MTM P/L", "Code"],
  ];
  for (const t of broker) {
    const s = symbols.get(t.instrument)!;
    const qty = t.side === "buy" ? t.units ?? 0 : -(t.units ?? 0);
    const proceeds = t.side === "buy" ? -t.amount : t.amount;
    rows.push(["Trades", "Data", "Order", "Stocks", "CHF", s.symbol, `${t.date}, 10:02:11`, String(qty), String(t.price ?? ""), String(t.price ?? ""), fixed2(proceeds), "-1.50", fixed2(-proceeds), "0", "0", "O"]);
  }
  rows.push(["Trades", "SubTotal", "", "Stocks", "CHF", "", "", "", "", "", fixed2(-broker.reduce((s, t) => s + (t.side === "buy" ? t.amount : -t.amount), 0)), "", "", "", "", ""]);
  rows.push(["Financial Instrument Information", "Header", "Asset Category", "Symbol", "Description", "Conid", "Security ID", "Listing Exch", "Multiplier", "Type", "Code"]);
  for (const s of symbols.values()) rows.push(["Financial Instrument Information", "Data", "Stocks", s.symbol, s.name, "123456", "", "EBS", "1", s.type, ""]);
  return utf8(csv(rows, ","));
}

// ---------------- Meriç: PostFinance camt.053.001.08 + Swissquote CSV ----------------

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** camt.053 with one entry per booking, and same-day standing orders booked as one batch entry with several TxDtls. */
export function camt053(p: Profile, version: "04" | "08" = "08"): string {
  interface Tx { date: string; name: string; amount: number; credit?: boolean; ustrd?: string; strd?: string; info?: string }
  const fixedByDay = new Map<string, Tx[]>();
  const singles: Tx[] = [];
  for (const t of p.transactions) {
    const tx: Tx = { date: t.date, name: t.merchant, amount: t.amount };
    if (FIXED.has(t.category) || t.category === "subscriptions" || t.merchant === "Mobilis") {
      tx.ustrd = t.category === "housing" ? `Loyer ${MONTH_FR[monthIndex(t.date.slice(0, 7))]} ${t.date.slice(0, 4)}` : undefined;
      if (t.category === "insurance") tx.strd = `21000000000313947143000${t.date.slice(5, 7)}`;
      fixedByDay.set(t.date, [...(fixedByDay.get(t.date) ?? []), tx]);
    } else {
      tx.info = `Achat/Prestation du ${dmy(t.date)} Numéro de carte: xxxx 7731`;
      singles.push(tx);
    }
  }
  for (const m of months(p)) singles.push({ date: `${m}-25`, name: "Agence Lumen SA", amount: salaryOf(p), credit: true, ustrd: `Salaire ${MONTH_FR[monthIndex(m)]} ${m.slice(0, 4)}` });
  for (const t of p.trades.filter((x) => x.side === "buy")) singles.push({ date: t.date, name: "Swissquote Bank SA", amount: t.amount, ustrd: "Versement compte de trading" });

  const party = (tx: Tx) => {
    const role = tx.credit ? "Dbtr" : "Cdtr";
    const nm = `<Nm>${xmlEscape(tx.name)}</Nm>`;
    return `<RltdPties><${role}>${version === "08" ? `<Pty>${nm}</Pty>` : nm}</${role}></RltdPties>`;
  };
  const rmt = (tx: Tx) =>
    tx.ustrd || tx.strd
      ? `<RmtInf>${tx.ustrd ? `<Ustrd>${xmlEscape(tx.ustrd)}</Ustrd>` : ""}${tx.strd ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>${tx.strd}</Ref></CdtrRefInf></Strd>` : ""}</RmtInf>`
      : "";
  const txDtls = (tx: Tx, ref?: string, withAmount = false) =>
    `<TxDtls>${ref ? `<Refs><AcctSvcrRef>${ref}</AcctSvcrRef></Refs>` : ""}${withAmount ? `<Amt Ccy="CHF">${fixed2(tx.amount)}</Amt><CdtDbtInd>DBIT</CdtDbtInd>` : ""}${party(tx)}${rmt(tx)}${tx.info ? `<AddtlTxInf>${xmlEscape(tx.info)}</AddtlTxInf>` : ""}</TxDtls>`;

  type Entry = { date: string; xml: (ref: string) => string };
  const entries: Entry[] = [];
  for (const tx of singles) {
    entries.push({
      date: tx.date,
      xml: (ref) =>
        `<Ntry><Amt Ccy="CHF">${fixed2(tx.amount)}</Amt><CdtDbtInd>${tx.credit ? "CRDT" : "DBIT"}</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>` +
        `<BookgDt><Dt>${tx.date}</Dt></BookgDt><ValDt><Dt>${tx.date}</Dt></ValDt><AcctSvcrRef>${ref}</AcctSvcrRef>` +
        `<BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>${tx.credit ? "RCDT" : "CCRD"}</Cd><SubFmlyCd>${tx.credit ? "SALA" : "POSD"}</SubFmlyCd></Fmly></Domn></BkTxCd>` +
        `<NtryDtls>${txDtls(tx)}</NtryDtls></Ntry>`,
    });
  }
  for (const [date, txs] of fixedByDay) {
    const total = txs.reduce((s, t) => s + t.amount, 0);
    entries.push({
      date,
      xml: (ref) =>
        `<Ntry><Amt Ccy="CHF">${fixed2(total)}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>` +
        `<BookgDt><Dt>${date}</Dt></BookgDt><ValDt><Dt>${date}</Dt></ValDt><AcctSvcrRef>${ref}</AcctSvcrRef>` +
        `<BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>ICDT</Cd><SubFmlyCd>STDO</SubFmlyCd></Fmly></Domn></BkTxCd>` +
        (txs.length > 1 ? `<AddtlNtryInf>Ordre permanent groupé (${txs.length})</AddtlNtryInf>` : "") +
        `<NtryDtls>${txs.length > 1 ? `<Btch><NbOfTxs>${txs.length}</NbOfTxs></Btch>` : ""}${txs.map((t, i) => txDtls(t, txs.length > 1 ? `${ref}-${i + 1}` : undefined, txs.length > 1)).join("")}</NtryDtls></Ntry>`,
    });
  }
  const sorted = sortByDate(entries);
  const body = sorted.map((e, i) => e.xml(`PF${e.date.replace(/-/g, "")}${String(i).padStart(5, "0")}`)).join("\n");
  const first = sorted[0]?.date ?? "2026-06-01";
  const last = sorted.at(-1)?.date ?? first;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.${version}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<BkToCstmrStmt>
<GrpHdr><MsgId>PF-STMT-${p.id.toUpperCase()}-001</MsgId><CreDtTm>${last}T23:00:00</CreDtTm></GrpHdr>
<Stmt>
<Id>STMT-${first}-${last}</Id><ElctrncSeqNb>1</ElctrncSeqNb><CreDtTm>${last}T23:00:00</CreDtTm>
<FrToDt><FrDtTm>${first}T00:00:00</FrDtTm><ToDtTm>${last}T23:59:59</ToDtTm></FrToDt>
<Acct><Id><IBAN>CH5609000000123456789</IBAN></Id><Ccy>CHF</Ccy><Ownr><Nm>${xmlEscape(p.name)} Demo</Nm></Ownr><Svcr><FinInstnId><BICFI>POFICHBEXXX</BICFI></FinInstnId></Svcr></Acct>
${body}
</Stmt>
</BkToCstmrStmt>
</Document>
`;
}

function swissquoteCsv(p: Profile): Uint8Array {
  const header = ["Date", "Order #", "Transaction", "Symbol", "Name", "ISIN", "Quantity", "Unit price", "Costs", "Accrued Interest", "Net Amount", "Balance", "Currency"];
  const trades = sortByDate(p.trades.filter((x) => x.account === "broker"));
  const rows: (string | number)[][] = [];
  let balance = 0;
  const deposit = trades.filter((t) => t.side === "buy").reduce((s, t) => s + t.amount + 9.85, 0);
  balance += deposit;
  rows.push([`${dmy(trades[0]?.date ?? "2026-06-01", "-")} 08:00:00`, "", "Payment", "", "", "", "", "", "", "", fixed2(deposit), fixed2(balance), "CHF"]);
  trades.forEach((t, i) => {
    const m = /^(.*) \(([^)]+)\)$/.exec(t.instrument);
    const costs = 9.85;
    const net = t.side === "buy" ? -(t.amount + costs) : t.amount - costs;
    balance += net;
    rows.push([
      `${dmy(t.date, "-")} 10:15:0${i}`, String(81234560 + i), t.side === "buy" ? "Buy" : "Sell", m ? m[2] : "", m ? m[1] : t.instrument, "",
      String(t.units ?? ""), fixed2(t.price ?? 0), fixed2(costs), "0.00", fixed2(net), fixed2(balance), "CHF",
    ]);
  });
  rows.push([`${dmy("2026-09-15", "-")} 09:00:00`, "", "Custody Fees", "", "", "", "", "", "", "", "-12.50", fixed2(balance - 12.5), "CHF"]);
  return utf8(csv([header, ...rows].map((r) => r), ";"));
}

// ---------------- Oktay: neon CSV (UTF-8 with BOM) + Revolut CSV ----------------

const onRevolut = (t: Transaction) => ["Uber Eats", "Just Eat", "Smood", "Starbucks"].includes(t.merchant) || t.category === "travel";

function neonCsv(p: Profile): Uint8Array {
  const header = ["Date", "Amount", "Original amount", "Original currency", "Exchange rate", "Description", "Subject", "Category", "Tags", "Wise", "Spaces"];
  interface Line { date: string; amount: number; description: string; subject?: string; category?: string }
  const lines: Line[] = p.transactions.filter((t) => !onRevolut(t)).map((t) => ({ date: t.date, amount: -t.amount, description: t.merchant, category: t.category }));
  for (const m of months(p)) {
    lines.push({ date: `${m}-25`, amount: salaryOf(p), description: "Rheinhafen Logistik AG", subject: `Lohn ${MONTH_DE[monthIndex(m)]} ${m.slice(0, 4)}`, category: "income" });
    const card = p.transactions.filter((t) => onRevolut(t) && t.date.startsWith(m)).reduce((s, t) => s + t.amount, 0);
    lines.push({ date: `${m}-02`, amount: -Math.ceil(card / 50) * 50, description: "Revolut", subject: "Top-up", category: "transfers" });
  }
  const rows = sortByDate(lines).map((l) => [l.date, fixed2(l.amount), "", "", "", l.description, l.subject ?? "", l.category ?? "", "", "no", "no"]);
  return utf8(csv([header, ...rows], ";", true), true);
}

function revolutCsv(p: Profile): Uint8Array {
  const header = ["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"];
  interface Line { type: string; date: string; description: string; amount: number; currency?: string; state?: string }
  const lines: Line[] = p.transactions.filter(onRevolut).map((t) => ({ type: "CARD_PAYMENT", date: t.date, description: t.merchant, amount: -t.amount }));
  for (const m of months(p)) {
    const card = p.transactions.filter((t) => onRevolut(t) && t.date.startsWith(m)).reduce((s, t) => s + t.amount, 0);
    lines.push({ type: "TOPUP", date: `${m}-02`, description: "Top-up by *4417", amount: Math.ceil(card / 50) * 50 });
  }
  // Rows the importer must skip: a card payment in EUR (no CHF amount) and a reverted one.
  lines.push({ type: "CARD_PAYMENT", date: "2026-07-26", description: "Boulangerie Paul Paris", amount: -8.4, currency: "EUR" });
  lines.push({ type: "CARD_PAYMENT", date: "2026-09-12", description: "Galeries Online", amount: -59, state: "REVERTED" });
  let balance = 0;
  const rows = sortByDate(lines).map((l, i) => {
    if ((l.state ?? "COMPLETED") === "COMPLETED" && !l.currency) balance += l.amount;
    const time = `${l.date} ${String(9 + (i % 12)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:14`;
    return [l.type, "Current", time, time, l.description, fixed2(l.amount), "0.00", l.currency ?? "CHF", l.state ?? "COMPLETED", fixed2(balance)];
  });
  return utf8(csv([header, ...rows], ","));
}

/** All sample files, in the order the UI lists them. */
export function importSamples(): SampleFile[] {
  const barlas = byId("barlas");
  const meric = byId("meric");
  const oktay = byId("oktay");
  return [
    { name: "barlas-zkb.csv", account: "barlas", kind: "bank", provider: "ZKB", bytes: zkbCsv(barlas) },
    { name: "barlas-viac-3a.csv", account: "barlas", kind: "broker", provider: "VIAC", bytes: viacCsv(barlas) },
    { name: "barlas-ibkr.csv", account: "barlas", kind: "broker", provider: "Interactive Brokers", bytes: ibkrActivity(barlas) },
    { name: "meric-postfinance.camt053.xml", account: "meric", kind: "bank", provider: "PostFinance", bytes: utf8(camt053(meric)) },
    { name: "meric-swissquote.csv", account: "meric", kind: "broker", provider: "Swissquote", bytes: swissquoteCsv(meric) },
    { name: "oktay-neon.csv", account: "oktay", kind: "bank", provider: "neon", bytes: neonCsv(oktay) },
    { name: "oktay-revolut.csv", account: "oktay", kind: "bank", provider: "Revolut", bytes: revolutCsv(oktay) },
  ];
}

/** Persona data the samples must recreate. */
export function personaData(id: string): { transactions: Transaction[]; trades: InvestmentTrade[]; profile: Profile } {
  const p = byId(id);
  return { transactions: p.transactions, trades: p.trades, profile: p };
}
