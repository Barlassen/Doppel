/**
 * Round-trip and unit verification for the statement importers, categorisation, dedupe and store API:
 *   `npx tsx scripts/import-check.ts`  (or `npm run import:check`)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addImport,
  addTrade,
  addTransaction,
  categoryOverrides,
  createAccount,
  deleteAccount,
  deleteTrade,
  deleteTransaction,
  getAccount,
  importedRefs,
  listImports,
  listTrades,
  listTransactions,
  undoImport,
  updateTrade,
  updateTransaction,
} from "../src/lib/accounts";
import { analyzeBehavior } from "../src/lib/finance/behavioralEngine";
import { simulate } from "../src/lib/finance/monteCarlo";
import { baseScenario, effectiveProfile, simInputFor } from "../src/lib/finance/scenario";
import type { InvestmentTrade, Transaction } from "../src/lib/finance/types";
import {
  guessBankMapping,
  guessTradeMapping,
  parseBankManual,
  parseTradesManual,
  readStatement,
} from "../src/lib/import";
import { parseCamt } from "../src/lib/import/camt";
import { classifyRow } from "../src/lib/import/categorize";
import { validCategorizeNames, validatedCategories } from "../src/lib/import/categorizeModel";
import {
  buildReview,
  finalizeReview,
  reviewCounts,
  reviewOverrides,
  setRowCategory,
  tradeKey,
  txKey,
  unresolvedMerchants,
} from "../src/lib/import/review";
import { camt053, importSamples, personaData } from "../src/lib/import/samples";
import { categorizeWithModel } from "../src/lib/import/categorizeClient";
import { parseBankCsv } from "../src/lib/import/bankCsv";
import { parseMt940 } from "../src/lib/import/mt940";
import { summarizeParsed, summarizeStatement, summaryAskFacts, type StatementSummary } from "../src/lib/import/summarize";
import { totals } from "../src/lib/frugal/ledger";
import { translateText } from "../src/lib/i18n";
import { ASK_FACT_KEYS } from "../src/lib/llm";
import { readTable } from "../src/lib/import/table";
import { decodeBytes, merchantKey, parseAmount, parseDate } from "../src/lib/import/text";

const sortTx = (xs: Transaction[]) =>
  [...xs].sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant) || a.amount - b.amount);

const sortTrades = (xs: InvestmentTrade[]) =>
  [...xs].sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account) || a.instrument.localeCompare(b.instrument) || a.amount - b.amount);

const enc = (s: string) => new TextEncoder().encode(s);

async function checkSampleRoundTrips() {
  console.log("=== 1. Sample generation & persona round-trip ===");
  const samples = importSamples();
  const sampleDir = join(process.cwd(), "public", "samples", "imports");

  // Verify the files on disk match importSamples() byte-for-byte.
  for (const s of samples) {
    const disk = new Uint8Array(await readFile(join(sampleDir, s.name)));
    assert.equal(disk.byteLength, s.bytes.byteLength, `${s.name} size on disk differs`);
    assert.deepEqual(Buffer.from(disk), Buffer.from(s.bytes), `${s.name} content on disk differs`);
  }

  for (const personaId of ["barlas", "meric", "oktay"] as const) {
    const expected = personaData(personaId);
    const freshId = createAccount({
      name: `${expected.profile.name} Roundtrip`,
      age: expected.profile.age,
      city: expected.profile.city,
      canton: expected.profile.canton,
      grossIncomeYear: expected.profile.grossIncomeYear,
      marginalTaxRate: expected.profile.marginalTaxRate,
      riskProfile: expected.profile.riskProfile,
      retirementAge: expected.profile.retirementAge,
      goal: expected.profile.goal,
      events: expected.profile.events,
      cash: expected.profile.cash,
      portfolio: expected.profile.portfolio,
      pillar2: expected.profile.pillar2,
      pillar3a: expected.profile.pillar3a,
    });

    const files = samples.filter((s) => s.account === personaId);
    for (const f of files) {
      const res = readStatement(f.name, f.bytes);
      assert.equal(res.kind, "parsed", `${f.name} must parse with a known profile`);
      if (f.name === "barlas-zkb.csv") {
        assert.equal(res.encoding, "windows-1252", "barlas-zkb.csv must auto-detect Windows-1252");
      }
      const review = buildReview(
        res.parsed,
        {
          transactions: listTransactions(freshId),
          trades: listTrades(freshId),
          refs: importedRefs(freshId),
        },
        categoryOverrides(freshId),
      );
      assert.deepEqual(unresolvedMerchants(review), [], `${f.name} must resolve all merchants locally at 0 tokens`);
      const counts = reviewCounts(review);
      assert.equal(counts.duplicates, 0, `${f.name} first import must have 0 duplicates`);
      assert.equal(counts.review, 0, `${f.name} must have 0 rows needing review`);
      const out = finalizeReview(review);
      addImport(freshId, {
        fileName: f.name,
        format: res.parsed.format,
        profile: res.parsed.profile,
        counts,
        transactions: out.transactions,
        refs: out.refs,
        trades: out.trades,
        overrides: reviewOverrides(review),
      });

      // Re-importing the exact same file must mark 100% of rows and trades as duplicates.
      const repeat = buildReview(
        res.parsed,
        {
          transactions: listTransactions(freshId),
          trades: listTrades(freshId),
          refs: importedRefs(freshId),
        },
        categoryOverrides(freshId),
      );
      const repeatCounts = reviewCounts(repeat);
      assert.equal(repeatCounts.transactions, 0, `${f.name} repeat import must add 0 transactions`);
      assert.equal(repeatCounts.trades, 0, `${f.name} repeat import must add 0 trades`);
      assert.equal(repeatCounts.duplicates, counts.transactions + counts.trades, `${f.name} repeat import must flag all entries as duplicates`);
    }

    const recreated = getAccount(freshId)!.profile;
    assert.deepEqual(
      sortTx(recreated.transactions),
      sortTx(expected.transactions),
      `${personaId}: recreated transactions must equal original persona transactions`,
    );
    assert.deepEqual(
      sortTrades(recreated.trades),
      sortTrades(expected.trades),
      `${personaId}: recreated trades must equal original persona trades`,
    );
    assert.equal(recreated.expensesMonth, expected.profile.expensesMonth, `${personaId}: expensesMonth`);
    assert.equal(recreated.rentMonth, expected.profile.rentMonth, `${personaId}: rentMonth`);
    assert.equal(recreated.netIncomeMonth, expected.profile.netIncomeMonth, `${personaId}: netIncomeMonth`);
    assert.equal(recreated.investShare, expected.profile.investShare, `${personaId}: investShare`);
    assert.equal(recreated.contributes3a, expected.profile.contributes3a, `${personaId}: contributes3a`);
    assert.deepEqual(recreated.history, expected.profile.history, `${personaId}: drawdown history`);

    const sOrig = baseScenario(expected.profile);
    const bOrig = analyzeBehavior(effectiveProfile(expected.profile, sOrig), sOrig.extraTx);
    const oddsOrig = simulate(simInputFor(expected.profile, sOrig, bOrig.params)).successProb;

    const sNew = baseScenario(recreated);
    const bNew = analyzeBehavior(effectiveProfile(recreated, sNew), sNew.extraTx);
    const oddsNew = simulate(simInputFor(recreated, sNew, bNew.params)).successProb;

    assert.equal(oddsNew, oddsOrig, `${personaId}: Monte Carlo headline odds must match identically`);
    console.log(
      `  ✓ ${expected.profile.name}: ${files.map((f) => f.name).join(" + ")} → ${recreated.transactions.length} tx, ${recreated.trades.length} trades, headline ${(oddsNew * 100).toFixed(1)}%`,
    );

    // Undo all imports on freshId and verify it empties out.
    for (const imp of listImports(freshId)) undoImport(freshId, imp.id);
    assert.equal(listTransactions(freshId).length, 0);
    assert.equal(listTrades(freshId).length, 0);
    assert.equal(listImports(freshId).length, 0);
    deleteAccount(freshId);
  }
}

function checkFormatsAndProfiles() {
  console.log("\n=== 2. Bank CSV, camt.053 (.04 & .08), broker/3a profiles & manual mapping ===");

  // Dates and Swiss number formats
  assert.equal(parseDate("25.08.2026"), "2026-08-25");
  assert.equal(parseDate("2026-08-25T10:15:00"), "2026-08-25");
  assert.equal(parseDate("25/08/2026"), "2026-08-25");
  assert.equal(parseAmount("1'234.50"), 1234.5);
  assert.equal(parseAmount("1’234.50"), 1234.5);
  assert.equal(parseAmount("-12.30"), -12.3);
  assert.equal(parseAmount("12,30"), 12.3);
  assert.equal(parseAmount("CHF 1'520.–"), 1520);

  // camt.053.001.04 and .001.08 parity
  const meric = personaData("meric").profile;
  const parsed04 = parseCamt(camt053(meric, "04"))!;
  const parsed08 = parseCamt(camt053(meric, "08"))!;
  assert.ok(parsed04 && parsed08);
  assert.equal(parsed04.rows.length, parsed08.rows.length);
  assert.deepEqual(
    parsed04.rows.map((r) => [r.date, r.counterparty, r.signed, r.ref]),
    parsed08.rows.map((r) => [r.date, r.counterparty, r.signed, r.ref]),
    "camt.053 .001.04 and .001.08 must parse identically",
  );

  // UBS CSV profile (typical layout)
  const ubsCsv = [
    "Kontonummer:;CH93 0023 0230 1234 5678 0",
    "Abschlussdatum;Beschreibung1;Beschreibung2;Beschreibung3;Transaktions-Nr.;Währung;Belastung;Gutschrift",
    "14.08.2026;Migros Zürich;Einkauf Karte;;UBS-001;CHF;42.80;",
    "25.08.2026;TechCorp AG;Lohn August 2026;;UBS-002;CHF;;6'200.00",
  ].join("\r\n");
  const ubsRes = readStatement("ubs.csv", enc(ubsCsv));
  assert.equal(ubsRes.kind, "parsed");
  assert.equal(ubsRes.parsed.profile, "ubs");
  assert.equal(ubsRes.parsed.rows.length, 2);

  // PostFinance CSV profile (typical layout)
  const pfCsv = [
    "Datum;Avisierungstext;Gutschrift in CHF;Lastschrift in CHF;Valuta;Saldo in CHF",
    "15.08.2026;SBB Mobile Ticket;;18.40;15.08.2026;4'120.00",
  ].join("\n");
  const pfRes = readStatement("pf.csv", enc(pfCsv));
  assert.equal(pfRes.kind, "parsed");
  assert.equal(pfRes.parsed.profile, "postfinance");
  assert.equal(pfRes.parsed.rows[0].signed, -18.4);

  // Raiffeisen CSV profile (typical layout)
  const raiffCsv = [
    "IBAN;Booked At;Text;Credit/Debit Amount;Valuta Date;Balance",
    "CH1180808001234567890;2026-08-18;Coop Basel;-33.90;2026-08-18;3200.00",
  ].join("\n");
  const raiffRes = readStatement("raiffeisen.csv", enc(raiffCsv));
  assert.equal(raiffRes.kind, "parsed");
  assert.equal(raiffRes.parsed.profile, "raiffeisen");
  assert.equal(raiffRes.parsed.rows[0].signed, -33.9);

  // Yuh CSV profile (typical layout)
  const yuhCsv = [
    "Date,Activity type,Activity name,Debit,Debit currency,Credit,Credit currency,Fees/Commission",
    "19/08/2026,CARD_TRANSACTION,Galaxus,79.90,CHF,,,0.00",
    "20/08/2026,TRANSFER,Top-up,,,500.00,CHF,0.00",
  ].join("\n");
  const yuhRes = readStatement("yuh.csv", enc(yuhCsv));
  assert.equal(yuhRes.kind, "parsed");
  assert.equal(yuhRes.parsed.profile, "yuh");
  assert.equal(yuhRes.parsed.rows.length, 2);

  // frankly 3a CSV profile (typical layout) & IBKR Flex CSV + foreign currency skip
  const franklyCsv = [
    "Datum;Transaktionsart;Fonds;Anteile;Kurs;Betrag CHF",
    "26.08.2026;Kauf;Swisscanto (CH) IPF I Index Equity World;4.821;125.49;605.00",
  ].join("\n");
  const franklyRes = readStatement("frankly.csv", enc(franklyCsv));
  assert.equal(franklyRes.kind, "parsed");
  assert.equal(franklyRes.parsed.profile, "frankly");
  assert.equal(franklyRes.parsed.trades.length, 1);
  assert.equal(franklyRes.parsed.trades[0].account, "3a");
  assert.equal(franklyRes.parsed.trades[0].amount, 605);

  const ibkrFlexCsv = [
    "TradeDate,Buy/Sell,Symbol,Description,Quantity,TradePrice,Proceeds,IBCommission,CurrencyPrimary,AssetClass",
    "20260826,BUY,VWRL,Vanguard FTSE All-World,5,112.00,-560.00,-1.50,CHF,STK",
    "20260827,BUY,AAPL,Apple Inc,2,220.00,-440.00,-1.00,USD,STK",
  ].join("\n");
  const flexRes = readStatement("flex.csv", enc(ibkrFlexCsv));
  assert.equal(flexRes.kind, "parsed");
  assert.equal(flexRes.parsed.profile, "ibkr-flex");
  assert.equal(flexRes.parsed.trades.length, 1);
  assert.equal(flexRes.parsed.trades[0].kind, "fund");
  assert.equal(flexRes.parsed.skipped.length, 1);
  assert.equal(flexRes.parsed.skipped[0].reason, "foreignCurrency");
  assert.equal(flexRes.parsed.skipped[0].currency, "USD");

  // Unknown CSV header -> manual mapping fallback (transactions and trades)
  const customCsv = [
    "When\tWhere\tOutflow",
    "21.08.2026\tMigros Bern\t28.50",
  ].join("\n");
  const customRes = readStatement("custom.tsv", enc(customCsv));
  assert.equal(customRes.kind, "mapping");
  const bankMap = { ...guessBankMapping(customRes.table), date: 0, description: [1], amount: 2, invert: true };
  const manualBank = parseBankManual(customRes.table, bankMap);
  assert.equal(manualBank.rows.length, 1);
  assert.equal(manualBank.rows[0].signed, -28.5);

  const customTradeTable = readTable("Tag;Titel;Stück;CHF\n22.08.2026;UBS ETF (CH) SMI;10;1150.00");
  const tradeMap = { ...guessTradeMapping(customTradeTable), account: "broker" as const, date: 0, instrument: 1, units: 2, amount: 3 };
  const manualTrades = parseTradesManual(customTradeTable, tradeMap);
  assert.equal(manualTrades.trades.length, 1);
  assert.equal(manualTrades.trades[0].amount, 1150);

  console.log("  ✓ All 7 bank profiles, camt.053 (.04 & .08), 4 broker/3a profiles and manual mapping fallbacks passed");
}

function checkCategorisationAndStore() {
  console.log("\n=== 3. Frugal categorisation, TWINT P2P, overrides, model validator & store CRUD ===");

  // TWINT P2P vs merchant TWINT
  assert.equal(
    classifyRow({ line: 1, date: "2026-08-10", description: "TWINT an Lukas Meier", signed: -25, currency: "CHF" }).kind,
    "transfer",
  );
  assert.equal(
    classifyRow({ line: 2, date: "2026-08-10", description: "TWINT Coop Pronto", signed: -14.2, currency: "CHF" }).category,
    "groceries",
  );
  assert.equal(
    classifyRow({ line: 3, date: "2026-08-25", description: "Salaire Août 2026", signed: 5700, currency: "CHF" }).kind,
    "income",
  );

  // Gateway model validator for `categorize`
  assert.equal(validCategorizeNames([]), undefined);
  assert.equal(validCategorizeNames(["A", "A"]), undefined);
  assert.equal(validCategorizeNames(["Bad\nName"]), undefined);
  assert.deepEqual(validCategorizeNames(["Boulangerie du Lac", "Garage Muller"]), ["Boulangerie du Lac", "Garage Muller"]);
  assert.deepEqual(validatedCategories({ c: ["dining", "transport"] }, 2), { categories: ["dining", "transport"] });
  assert.equal(validatedCategories({ c: ["dining", "invalid"] }, 2), undefined);

  // User correction overrides & manual transaction/trade CRUD
  const id = createAccount({
    name: "Test User",
    age: 32,
    city: "Zürich",
    canton: "ZH",
    grossIncomeYear: 90_000,
    marginalTaxRate: 0.22,
  });

  const parsed = parseBankManual(
    readTable("Date;Description;Amount\n2026-08-01;Atelier Inconnu Sàrl;-49.00\n2026-08-05;Atelier Inconnu Sàrl;-19.00"),
    { date: 0, description: [1], amount: 2 },
  );
  let rev = buildReview(parsed, { transactions: [], trades: [], refs: new Set() }, categoryOverrides(id));
  assert.deepEqual(unresolvedMerchants(rev), ["Atelier Inconnu Sàrl"]);
  assert.equal(reviewCounts(rev).review, 2);

  // Correcting one row updates every row of the same merchant and records an override
  rev = setRowCategory(rev, "r0", "shopping");
  assert.equal(reviewCounts(rev).review, 0);
  assert.deepEqual(reviewOverrides(rev), { [merchantKey("Atelier Inconnu Sàrl")]: "shopping" });

  const out = finalizeReview(rev);
  addImport(id, {
    fileName: "custom.csv",
    format: "bank-csv",
    profile: "manual",
    counts: reviewCounts(rev),
    transactions: out.transactions,
    refs: out.refs,
    trades: [],
    overrides: reviewOverrides(rev),
  });

  // Later import of the same merchant uses the stored per-account override at 0 tokens
  const nextParsed = parseBankManual(
    readTable("Date;Description;Amount\n2026-09-01;Atelier Inconnu Sàrl;-35.00"),
    { date: 0, description: [1], amount: 2 },
  );
  const nextRev = buildReview(nextParsed, { transactions: listTransactions(id), trades: [], refs: importedRefs(id) }, categoryOverrides(id));
  assert.equal(nextRev.rows[0].category, "shopping");
  assert.equal(nextRev.rows[0].source, "override");
  assert.equal(nextRev.rows[0].needsReview, false);

  // Manual transaction & trade CRUD
  const txId = addTransaction(id, {
    date: "2026-09-10",
    merchant: "Bio Hofladen",
    category: "other",
    amount: 32.5,
    items: [{ name: "Äpfel", amount: 12.5 }, { name: "Käse", amount: 20 }],
  });
  updateTransaction(id, txId, { category: "groceries" });
  assert.equal(categoryOverrides(id)[merchantKey("Bio Hofladen")], "groceries");
  assert.equal(listTransactions(id).find((r) => r.id === txId)?.value.items?.length, 2);
  deleteTransaction(id, txId);
  assert.equal(listTransactions(id).some((r) => r.id === txId), false);

  const trId = addTrade(id, { date: "2026-09-15", account: "3a", instrument: "VIAC Global 80", side: "buy", amount: 605 });
  updateTrade(id, trId, { amount: 650 });
  assert.equal(listTrades(id).find((r) => r.id === trId)?.value.amount, 650);
  deleteTrade(id, trId);
  assert.equal(listTrades(id).length, 0);

  // Encoding helper sanity check
  assert.equal(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])).text, "A");
  assert.ok(txKey({ date: "2026-08-01", amount: 10, merchant: "Migros" }).includes("migros"));
  assert.ok(tradeKey({ date: "2026-08-01", account: "3a", instrument: "VIAC", side: "buy", amount: 605 }).includes("viac"));

  deleteAccount(id);
  console.log("  ✓ Categorisation rules, TWINT P2P, overrides, model validator & store CRUD passed");
}

const NO_DATA = { transactions: [], trades: [], refs: new Set<string>() };

/** camt.053 (.08) wrapper for hand-written entries, with a namespace prefix on every element. */
const camtDoc = (entries: string) =>
  '<?xml version="1.0"?><ns2:Document xmlns:ns2="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><ns2:BkToCstmrStmt><ns2:Stmt>'
  + entries.replace(/<(\/?)/g, "<$1ns2:") + "</ns2:Stmt></ns2:BkToCstmrStmt></ns2:Document>";
const camtTx = (amount: string, payee: string, ref: string, ccy = "CHF") =>
  `<TxDtls><Refs><AcctSvcrRef>${ref}</AcctSvcrRef></Refs><Amt Ccy="${ccy}">${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><RltdPties><Cdtr><Pty><Nm>${payee}</Nm></Pty></Cdtr></RltdPties></TxDtls>`;
const camtEntry = (amount: string, ind: "DBIT" | "CRDT", ref: string, details: string, extra = "") =>
  `<Ntry><Amt Ccy="CHF">${amount}</Amt><CdtDbtInd>${ind}</CdtDbtInd>${extra}<Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-06-30</Dt></BookgDt><AcctSvcrRef>${ref}</AcctSvcrRef><NtryDtls>${details}</NtryDtls></Ntry>`;

/** Regressions for the parsing, dedupe and classification bugs found in the audit. */
async function checkAuditFixes() {
  console.log("\n=== 4. Audit fixes: batches, references, collective orders, amounts, encodings, classification, ledger ===");

  // camt batch whose transactions share the entry's AcctSvcrRef: every transaction is kept, none is a "duplicate".
  const batch = parseCamt(camtDoc(camtEntry("300.00", "DBIT", "E1", camtTx("100.00", "Swisscom", "E1") + camtTx("200.00", "Helsana", "E1"))))!;
  assert.deepEqual(batch.rows.map((r) => [r.counterparty, r.signed, r.ref]), [["Swisscom", -100, "E1"], ["Helsana", -200, "E1"]]);
  const batchReview = buildReview(batch, NO_DATA);
  assert.deepEqual(batchReview.rows.map((r) => r.duplicate), [false, false], "a reference repeated inside one file is not a duplicate");
  assert.equal(reviewCounts(batchReview).transactions, 2);
  // …and the same file imported again is a duplicate through the recorded references.
  const again = buildReview(batch, { transactions: [], trades: [], refs: new Set(["E1"]) });
  assert.deepEqual(again.rows.map((r) => r.duplicate), [true, true], "references of an earlier import still dedupe");

  // A batch whose details do not add up to the booked entry (bank charges) stays one row of the booked amount.
  const charged = parseCamt(camtDoc(camtEntry("301.50", "DBIT", "E2", camtTx("100.00", "Swisscom", "A") + camtTx("200.00", "Helsana", "B"))))!;
  assert.deepEqual(charged.rows.map((r) => [r.signed, r.counterparty]), [[-301.5, undefined]]);
  assert.match(charged.rows[0].description, /Swisscom, Helsana/);

  // Card payments abroad: the details carry EUR, the entry is booked in CHF. The CHF entry must not be dropped.
  const foreignTx = '<TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">50.00</Amt></TxAmt></AmtDtls></TxDtls>';
  const abroad = parseCamt(camtDoc(camtEntry("95.00", "DBIT", "E3", foreignTx + foreignTx)))!;
  assert.deepEqual(abroad.rows.map((r) => [r.signed, r.currency]), [[-95, "CHF"]]);
  assert.equal(abroad.skipped.length, 0);

  // Reversal: a returned debit is a refund from the shop (the creditor of the original payment), not income.
  const reversal = parseCamt(camtDoc(camtEntry("50.00", "CRDT", "E4",
    "<TxDtls><RltdPties><Cdtr><Pty><Nm>Zalando</Nm></Pty></Cdtr><Dbtr><Pty><Nm>Meric Yilmaz</Nm></Pty></Dbtr></RltdPties></TxDtls>", "<RvslInd>true</RvslInd>")))!;
  assert.deepEqual([reversal.rows[0].counterparty, reversal.rows[0].signed, reversal.rows[0].reversal], ["Zalando", 50, true]);
  assert.equal(buildReview(reversal, NO_DATA).rows[0].kind, "refund");
  // A reversal credit from an unknown payee is still a refund to review, never income.
  const unknownReversal = classifyRow({ line: 1, date: "2026-06-30", description: "Atelier Nordlicht", signed: 80, currency: "CHF", reversal: true });
  assert.equal(unknownReversal.kind, "refund");

  // UBS collective order: the booked total and its detail rows are the same money.
  const ubsHead = "Abschlussdatum;Buchungsdatum;Währung;Belastung;Gutschrift;Einzelbetrag;Saldo;Transaktions-Nr.;Beschreibung1;Beschreibung2;Beschreibung3\r\n";
  const ubs = parseBankCsv(ubsHead
    + "2026-06-30;2026-06-30;CHF;-300.00;;;5000.00;TX1;Sammelauftrag;e-banking;\r\n"
    + ";;CHF;;;100.00;;TX1;Swisscom;Rechnung;\r\n"
    + ";2026-06-30;CHF;;;-200.00;;TX1;Helsana;Praemie;\r\n"
    + "2026-06-29;2026-06-29;CHF;-12.50;;;5300.00;TX2;Migros;Karte;\r\n")!;
  assert.deepEqual(ubs.rows.map((r) => [r.description, r.signed, r.date]), [
    ["Swisscom · Rechnung", -100, "2026-06-30"], ["Helsana · Praemie", -200, "2026-06-30"], ["Migros · Karte", -12.5, "2026-06-29"],
  ], "details replace the collective total; unsigned and undated details follow the booked row");
  assert.equal(ubs.notes.length, 1);
  const ubsReview = buildReview(ubs, NO_DATA);
  assert.equal(ubsReview.rows.filter((r) => !r.duplicate && r.kind === "spend").reduce((sum, r) => sum + r.amount, 0), 312.5);
  assert.equal(ubsReview.rows.some((r) => r.duplicate), false);
  // Details that do not add up: the booked total stays, the details go.
  const ubsOdd = parseBankCsv(ubsHead + "2026-06-30;2026-06-30;CHF;-300.00;;;5000.00;TX1;Sammelauftrag;;\r\n;2026-06-30;CHF;;;-100.00;;TX1;Swisscom;;\r\n")!;
  assert.deepEqual(ubsOdd.rows.map((r) => [r.description, r.signed]), [["Sammelauftrag", -300]]);

  // Amounts: brackets and a minus say "negative" once; a doubled sign is not a number.
  assert.equal(parseAmount("(-12.30)"), -12.3);
  assert.equal(parseAmount("(12.30)"), -12.3);
  assert.equal(parseAmount("-12.30-"), undefined);
  assert.equal(parseAmount("12.30-"), -12.3);

  // UTF-16 exports (Excel "Unicode text"), with and without a byte-order mark.
  const csv = "IBAN;Buchungsdatum;Buchungstext;Betrag;Valuta\r\nCH00;01.06.2026;Café Zürich;-4.50;01.06.2026\r\n";
  const le = Buffer.from(csv, "utf16le");
  const be = Buffer.from(le).swap16();
  for (const [bytes, encoding] of [
    [Buffer.concat([Buffer.from([0xff, 0xfe]), le]), "utf-16le"], [le, "utf-16le"], [Buffer.concat([Buffer.from([0xfe, 0xff]), be]), "utf-16be"], [be, "utf-16be"],
  ] as const) {
    const decoded = decodeBytes(new Uint8Array(bytes));
    assert.equal(decoded.encoding, encoding);
    assert.equal(parseBankCsv(decoded.text)?.rows[0]?.description, "Café Zürich");
  }
  assert.equal(decodeBytes(enc("Datum;Text\n")).encoding, "utf-8");

  // Classification: a prepaid top-up at a telecom shop and "TWINT A. Vogel" are purchases; salary words are whole words.
  const classify = (description: string, signed: number) => classifyRow({ line: 1, date: "2026-06-01", description, signed, currency: "CHF" });
  assert.deepEqual([classify("Salt Mobile Recharge", -20).kind, classify("Salt Mobile Recharge", -20).category], ["spend", "bills"]);
  assert.equal(classify("Savings Bar Cafe", -9).kind, "spend");
  assert.equal(classify("TWINT A. Vogel Blumen", -30).kind, "spend");
  assert.equal(classify("TWINT à Max Muster", -30).kind, "transfer");
  assert.equal(classify("TWINT an Max Muster", -30).kind, "transfer");
  assert.equal(classify("Aufladung Sparkonto", -500).kind, "transfer");
  assert.equal(classify("Top-up 4417", -500).kind, "transfer");
  assert.equal(classify("Coop Maastricht Erstattung", 20).kind, "refund", "\"maas\" inside a place name is not a salary");
  assert.equal(classify("Migros Kohlohner Gutschrift", 15).kind, "refund");
  for (const pay of ["Lohn Juni Brightline AG", "Monatslohn 06/2026", "Salaire juin 2026 Agence Lumen SA", "Gehalt Juni", "Salärzahlung", "Maaş ödemesi"]) {
    assert.equal(classify(pay, 5000).kind, "income", pay);
  }

  // MT940: debits, credits, a reversal, structured and plain :86:, and re-import dedupe through the bank reference.
  const mt = parseMt940([
    ":20:STMT2606", ":25:CH9300762011623852957", ":28C:6/1", ":60F:C260601CHF5000,00",
    ":61:2606020602D45,50NTRFNONREF//B001", ":86:Coop Zürich Karte 1234",
    ":61:2606250625C5700,NSALLOHN0626//B002", ":86:166?00Gutschrift?20Lohn Juni 2026?32Brightline Software AG",
    ":61:260630RD20,00NRTINONREF//B003", ":86:Zalando Retoure",
    ":61:2701021231D10,00NTRFNONREF", ":86:Kiosk",
    ":62F:C260630CHF10664,50", "-",
  ].join("\r\n"))!;
  assert.deepEqual(mt.rows.map((r) => [r.date, r.signed, r.counterparty ?? null, r.ref ?? null, r.reversal ?? false]), [
    ["2026-06-02", -45.5, null, "B001", false],
    ["2026-06-25", 5700, "Brightline Software AG", "B002", false],
    ["2026-06-30", 20, null, "B003", true],
    ["2026-12-31", -10, null, null, false],
  ]);
  assert.match(mt.rows[1].description, /Lohn Juni 2026/);
  const read = readStatement("konto.sta", enc(":20:X\r\n:25:CH93\r\n:60F:C260601CHF1,00\r\n:61:2606020602D45,50NTRFNONREF//B001\r\n:86:Coop\r\n:62F:C260630CHF1,00\r\n-\r\n"));
  assert.equal(read.kind === "parsed" && read.parsed.format, "mt940");
  const mtReview = buildReview(mt, NO_DATA);
  assert.deepEqual(mtReview.rows.map((r) => r.kind), ["spend", "income", "refund", "spend"]);
  assert.equal(parseMt940(":20:X\n:60F:C260601EUR1,00\n:61:2606020602D45,50NTRFNONREF\n:86:Bar\n")!.skipped[0].reason, "foreignCurrency");

  // Token ledger: an offline import that resolved nothing must not claim savings against the GPT-4o baseline.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, offline: true }))) as typeof fetch;
  try {
    let unknown = "IBAN;Buchungsdatum;Buchungstext;Betrag;Valuta\n";
    for (let i = 0; i < 30; i++) unknown += `CH00;01.06.2026;Unbekannt Laden ${i} GmbH;-4.50;01.06.2026\n`;
    const review = buildReview(parseBankCsv(unknown)!, NO_DATA);
    const out = await categorizeWithModel(review, "x.csv", 0);
    assert.equal(out.mode, "offline");
    const sums = totals(out.entries);
    assert.deepEqual([sums.ours, sums.naive, sums.tokenSavedPct], [0, 0, null], "nothing was categorised, so nothing was saved");
    // Rows the local rules did resolve keep their baseline.
    const known = buildReview(parseBankCsv("IBAN;Buchungsdatum;Buchungstext;Betrag;Valuta\nCH00;01.06.2026;Migros;-4.50;01.06.2026\nCH00;02.06.2026;Unbekannt Laden GmbH;-9.00;02.06.2026\n")!, NO_DATA);
    const partial = totals((await categorizeWithModel(known, "y.csv", 1)).entries);
    assert.ok(partial.naive > 0 && partial.ours === 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("  ✓ camt batches / reversals / foreign details, in-file references, UBS collective orders, (-12.30), UTF-16, classification, MT940 and the import ledger passed");
}

/** A synthetic household statement (fictional payees) with the obligations the samples do not contain. */
function familyStatement(): string {
  let csv = "IBAN;Buchungsdatum;Buchungstext;Betrag;Valuta\n";
  const row = (date: string, text: string, amount: number) => { csv += `CH00;${date};${text};${amount.toFixed(2)};${date}\n`; };
  for (const [i, month] of ["01", "02", "03", "04"].entries()) {
    row(`25.${month}.2026`, "Lohn Seeland Technik AG", 7200);
    row(`25.${month}.2026`, "Familienzulage Ausgleichskasse Bern", 215);
    row(`01.${month}.2026`, "Hypothekarzins Festhypothek Regiobank Seeland", -980);
    row(`03.${month}.2026`, "AMAG Leasing AG Leasingrate", -389);
    row(`05.${month}.2026`, "Kita Sonnenschein Betreuung", -1450);
    row(`06.${month}.2026`, "Motorfahrzeugversicherung Helvetia", -96);
    row(`07.${month}.2026`, "Privatkredit Cembra Rate", -310);
    row(`10.${month}.2026`, "Avia Tankstelle Lyss", -78 - i * 3);
    row(`19.${month}.2026`, "Migrol Tankstelle Biel", -64 + i);
    row(`12.${month}.2026`, "Migros", -210 - i * 17);
    row(`20.${month}.2026`, "Coop", -150 + i * 9);
    row(`21.${month}.2026`, "Kebab Haus Lyss", -25);
  }
  row("15.02.2026", "Strassenverkehrsamt Kanton Bern", -412);
  return csv;
}

function checkStatementSummary() {
  console.log("\n=== 5. What a statement tells the twin (summarizeStatement) ===");
  const summaries = new Map<string, StatementSummary>();
  for (const s of importSamples()) {
    const res = readStatement(s.name, s.bytes);
    assert.equal(res.kind, "parsed");
    if (res.kind !== "parsed") continue;
    const summary = summarizeParsed(res.parsed);
    assert.ok(summary, `${s.name} must summarise`);
    summaries.set(s.name, summary);
    // Every text is a translatable message and every number is finite.
    for (const locale of ["en", "de", "fr", "tr"] as const) {
      for (const line of [...summary.headline, ...summary.facts.flatMap((f) => [f.title, ...f.reasons]), ...summary.fixed.items.map((i) => i.label)]) {
        const text = translateText(locale, line);
        assert.ok(text && !/[{}]|NaN|undefined/.test(text), `${s.name} ${locale}: ${text}`);
      }
    }
    assert.ok([summary.income.monthlyAvg, summary.fixed.monthlyTotal, summary.variable.monthlyTotal, summary.saving.monthlyNet].every(Number.isFinite));
    assert.ok(summary.facts.every((f) => f.confidence > 0 && f.confidence <= 0.95 && f.evidence.length > 0));
  }

  // Barlas (ZKB): the persona's own figures come back from the file.
  const barlas = summaries.get("barlas-zkb.csv")!;
  const persona = personaData("barlas").profile;
  assert.deepEqual([barlas.period.months, barlas.period.calendarMonths, barlas.period.reliable], [5, 5, true]);
  assert.equal(barlas.income.monthlyAvg, persona.netIncomeMonth, "net income per month");
  assert.equal(barlas.income.regularity, 1);
  assert.equal(barlas.income.sources[0].regular, true);
  const rent = barlas.fixed.items.find((i) => i.kind === "rent")!;
  assert.deepEqual([rent.monthlyAmount, rent.cadence, rent.months, rent.evidence.length], [persona.rentMonth, "monthly", 5, 5]);
  assert.deepEqual(barlas.fixed.items.map((i) => i.kind), ["rent", "insurance", "bills", "bills", "transit", "subscription"]);
  assert.ok(!barlas.fixed.items.some((i) => /kebab|mensa|migros|coop/i.test(i.merchant)), "a regular lunch is a habit, not a fixed cost");
  assert.equal(barlas.variable.byCategory[0].category, "groceries");
  assert.equal(Math.round(barlas.fixed.monthlyTotal + barlas.variable.monthlyTotal + barlas.saving.monthlyNet), barlas.income.monthlyAvg, "income = fixed + variable + what is left");
  assert.equal(barlas.saving.monthlyPillar3a, 605);
  assert.deepEqual(barlas.facts.map((f) => f.id).sort(), ["investor", "pillar3a", "salary", "tenant"]);
  assert.ok(barlas.facts.every((f) => f.confidence >= 0.9));
  assert.equal(barlas.facts.find((f) => f.id === "tenant")!.monthlyAmount, persona.rentMonth);

  // Meriç (camt.053): one lump-sum transfer to the broker is a weak "invests regularly".
  const meric = summaries.get("meric-postfinance.camt053.xml")!;
  assert.equal(meric.income.monthlyAvg, personaData("meric").profile.netIncomeMonth);
  assert.equal(meric.variable.byCategory[0].category, "dining");
  assert.equal(meric.facts.find((f) => f.id === "investor")!.confidence, 0.5);
  assert.equal(meric.facts.some((f) => f.id === "pillar3a" || f.id === "car" || f.id === "child" || f.id === "owner"), false);

  // A card account without income: spending only, no savings rate, no facts.
  const revolut = summaries.get("oktay-revolut.csv")!;
  assert.deepEqual([revolut.income.monthlyAvg, revolut.saving.savingsRate, revolut.facts.length, revolut.fixed.items.length], [0, null, 0, 0]);

  // A 3a file running from the 26th to the 26th holds five contributions in four months of days: 605 a month, not 756.
  const viac = summaries.get("barlas-viac-3a.csv")!;
  assert.deepEqual([viac.saving.monthlyPillar3a, viac.facts.map((f) => f.id)], [605, ["pillar3a"]]);
  assert.deepEqual(summaries.get("barlas-ibkr.csv")!.facts.map((f) => f.id), ["investor"]);

  // Obligations that imply life facts, each with its evidence rows.
  const family = summarizeParsed(parseBankCsv(familyStatement())!)!;
  const fact = (id: string) => family.facts.find((f) => f.id === id);
  assert.deepEqual(family.facts.map((f) => f.id).sort(), ["car", "child", "debt", "owner", "salary"]);
  assert.equal(fact("tenant"), undefined, "mortgage interest means owner, not tenant");
  assert.deepEqual([fact("owner")!.monthlyAmount, fact("owner")!.evidence.length], [980, 4]);
  assert.ok(fact("owner")!.confidence >= 0.9 && fact("child")!.confidence >= 0.9 && fact("car")!.confidence >= 0.9);
  assert.equal(fact("child")!.monthlyAmount, 1450);
  assert.equal(fact("child")!.evidence.length, 8, "four daycare invoices and four family allowances");
  assert.equal(fact("child")!.reasons.length, 2);
  // Car: leasing rate + motor insurance + fuel in four months + road tax.
  assert.equal(fact("car")!.reasons.length, 4);
  assert.equal(fact("car")!.evidence.length, 4 + 4 + 8 + 1);
  assert.ok(Math.abs(fact("car")!.monthlyAmount - (389 + 96 + (4 * (78 + 64) + 18 - 6 + 412) / family.period.months)) < 0.5);
  assert.equal(fact("debt")!.monthlyAmount, 310);
  assert.deepEqual(family.fixed.items.map((i) => i.kind), ["mortgage", "insurance", "leasing", "loan", "childcare"], "fuel and groceries stay variable");
  assert.equal(fact("salary")!.monthlyAmount, 7200, "the family allowance is not part of the salary");
  // The family allowance is income but not the salary.
  assert.deepEqual(family.income.sources.map((s) => [s.monthlyAvg, s.regular]), [[7200, true], [215, true]]);
  // Fuel alone, in one month, is a question (rental car?), and fuel plus an insurer that is not a health insurer is likelier.
  const header = "IBAN;Buchungsdatum;Buchungstext;Betrag;Valuta\n";
  const fuelOnly = summarizeParsed(parseBankCsv(header + "CH00;03.03.2026;Avia Tankstelle;-70.00;03.03.2026\nCH00;19.03.2026;Shell Station;-65.00;19.03.2026\n")!)!;
  assert.ok(fuelOnly.facts.find((f) => f.id === "car")!.confidence < 0.5);
  assert.equal(fuelOnly.period.reliable, false);
  assert.ok(fuelOnly.headline.some((line) => line.key === "statement.headline.short"));
  let insured = header;
  for (const m of ["01", "02", "03"]) insured += `CH00;03.${m}.2026;Avia Tankstelle;-70.00;03.${m}.2026\nCH00;19.${m}.2026;Shell Station;-65.00;19.${m}.2026\nCH00;05.${m}.2026;Mobiliar Versicherung;-88.00;05.${m}.2026\nCH00;06.${m}.2026;Krankenkasse Helsana;-390.00;06.${m}.2026\n`;
  const car = summarizeParsed(parseBankCsv(insured)!)!.facts.find((f) => f.id === "car")!;
  assert.ok(car.confidence >= 0.6 && car.confidence < 0.9, `fuel + insurance: ${car.confidence}`);
  assert.ok(car.merchants.includes("Mobiliar Versicherung") && !car.merchants.some((m) => /helsana/i.test(m)), "a health insurer says nothing about a car");
  // "Rent a car" on holiday is not a home.
  const rental = summarizeParsed(parseBankCsv(header + "CH00;03.03.2026;Europcar Rent a Car Flughafen;-240.00;03.03.2026\nCH00;04.03.2026;Hotel Bellevue;-300.00;04.03.2026\n")!)!;
  assert.equal(rental.facts.some((f) => f.id === "tenant"), false);

  // Nothing to summarise; and the ask-facts bridge only uses listed keys.
  assert.equal(summarizeStatement({ rows: [], trades: [] }), undefined);
  const facts = summaryAskFacts(barlas);
  assert.ok(Object.keys(facts).every((key) => (ASK_FACT_KEYS as readonly string[]).includes(key)));
  assert.deepEqual([facts.statement_months, facts.statement_income_month_chf, facts.statement_savings_rate_pct, facts.statement_top_category], [5, 4310, 37, "groceries"]);
  console.log(`  ✓ ${summaries.size} sample statements and 4 synthetic ones: income, fixed and variable costs, saving rate and inferred facts with evidence passed`);
}

// tsx compiles scripts as CommonJS here, so no top-level await.
void (async () => {
  await checkSampleRoundTrips();
  checkFormatsAndProfiles();
  checkCategorisationAndStore();
  await checkAuditFixes();
  checkStatementSummary();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
