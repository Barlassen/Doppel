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

await checkSampleRoundTrips();
checkFormatsAndProfiles();
checkCategorisationAndStore();
