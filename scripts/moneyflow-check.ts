/** Proves that the rows of "Where my money goes" add up to its totals. No model calls. */
import assert from "node:assert/strict";
import { PROFILES } from "../src/lib/data/profiles";
import { summarizeStatement, type ReviewRow, type ReviewTrade } from "../src/lib/import";
import { flowAfter, moneyFlow, type MoneyFlow } from "../src/lib/twin/moneyFlow";
import type { Profile } from "../src/lib/finance/types";

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 0.05, `${what}: ${a} vs ${b}`);
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

/** The same adapter as `learnedFrom()` in the dashboard: bookings → statement summary. */
function summaryOf(p: Profile) {
  const rows: ReviewRow[] = p.transactions.map((t, i) => ({
    id: `tx${i}`, line: i + 1, date: t.date, merchant: t.merchant, raw: t.merchant, amount: t.amount,
    kind: t.amount < 0 ? "refund" : "spend", category: t.category, source: "dictionary", needsReview: false, duplicate: false,
  }));
  const trades: ReviewTrade[] = p.trades.map((trade, i) => ({ id: `tr${i}`, trade, duplicate: false }));
  return summarizeStatement({ rows, trades });
}

function check(name: string, f: MoneyFlow) {
  const of = (group: string) => f.rows.filter((r) => r.group === group);
  near(sum([...of("fixed"), ...of("variable")].map((r) => r.monthly)), f.spent, `${name}: fixed + variable = spent`);
  near(sum(of("saved").map((r) => (r.shortfall ? -r.monthly : r.monthly))), f.saved, `${name}: saved rows = saved`);
  near(f.spent + f.saved, f.income, `${name}: spent + saved = income`);
  near(f.invested + f.left, f.saved, `${name}: invested + left = saved`);
  near(sum(f.segments.map((s) => s.monthly)) - Math.max(0, -f.left), f.income, `${name}: bar segments = income (less the shortfall)`);
  near(sum(f.rows.map((r) => (r.shortfall ? -r.share : r.share))), f.income > 0 ? 1 : 0, `${name}: shares = 100%`);
  for (const r of f.rows) assert.ok(r.monthly >= 0 && sum(r.merchants.map((m) => m.monthly)) <= r.monthly + 0.05, `${name}: ${r.id} merchants within the row`);
  if (f.savingRate !== null) near(f.savingRate, f.saved / f.income, `${name}: saving rate`);
}

async function main() {
  for (const p of PROFILES) {
    for (const [mode, summary] of [["summary", summaryOf(p)], ["categories", undefined]] as const) {
      const f = moneyFlow(p, summary);
      assert.equal(f.source, "bookings");
      check(`${p.name}/${mode}`, f);
      if (mode === "summary") {
        console.log(`${p.name}: income ${f.income.toFixed(0)}  spent ${f.spent.toFixed(0)}  saved ${f.saved.toFixed(0)} (invested ${f.invested.toFixed(0)}, left ${f.left.toFixed(0)})  rate ${f.savingRate === null ? "-" : (f.savingRate * 100).toFixed(1) + "%"}  months ${f.months}  rows ${f.rows.length}`);
      }
    }
    // Profile fallback: the same person without bookings.
    const bare = moneyFlow({ ...p, transactions: [], trades: [] });
    assert.equal(bare.source, "profile");
    check(`${p.name}/profile`, bare);
    near(bare.spent, p.expensesMonth, `${p.name}/profile: spent = expensesMonth`);
    // A decision line moves the totals by exactly its amount.
    const f = moneyFlow(p, summaryOf(p));
    const after = flowAfter(f, [{ id: "a", label: { key: "flow.left" }, monthly: -500 }, { id: "b", label: { key: "flow.left" }, monthly: 200 }])!;
    near(after.spent, f.spent + 500, "decision cost");
    near(after.income, f.income + 200, "decision income");
    near(after.saved, f.saved - 300, "decision net");
    assert.equal(flowAfter(f, []), undefined);
  }
  console.log("moneyFlow: rows add up to the totals for", PROFILES.map((p) => p.name).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
