/**
 * Spending insights for the three built-in accounts, with assertions:
 *   `npx tsx scripts/insights-check.ts`
 */
import assert from "node:assert/strict";
import { PROFILES } from "../src/lib/data/profiles";
import type { Profile } from "../src/lib/finance/types";
import { translateText } from "../src/lib/i18n";
import { spendingInsights, type SpendingInsights } from "../src/lib/twin/insights";

const chf = (n: number) => `CHF ${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100);
const text = (value: Parameters<typeof translateText>[1]) => translateText("en", value);

function print(p: Profile, s: SpendingInsights) {
  console.log(`\n=== ${p.name} (as of ${s.asOf}) ===`);
  console.log(`Recurring: ${s.recurring.items.length} payments, ${s.recurring.subscriptions} subscriptions, ${chf(s.recurring.yearlyTotal.value)} per year [${s.recurring.yearlyTotal.basis}]`);
  for (const r of s.recurring.items) {
    console.log(`  ${text(r.label).padEnd(20)} ${r.cadence.padEnd(8)} ${chf(r.amount).padStart(12)}  ${chf(r.yearlyCost).padStart(13)}/yr  seen ${r.monthsSeen} mo  next ${r.nextDate}${r.subscription ? "  subscription" : ""}`);
  }
  for (const o of s.recurring.overlaps) console.log(`  overlap: ${text(o.label)} (${o.merchants.join(", ")}), dropping one saves ${chf(o.yearlySaving)}/yr`);
  const m = s.monthOverMonth;
  console.log(`Month over month: ${m.latest} vs ${m.comparedWith.join(", ")}`);
  console.log(`  rule: ${text(m.rule.label)}`);
  for (const c of m.changes) console.log(`  ${c.category.padEnd(14)} ${chf(c.latest).padStart(12)} vs usual ${chf(c.usual).padStart(12)}  ${c.delta >= 0 ? "+" : ""}${c.delta.toFixed(2)} (${c.pct === null ? "new" : `${(c.pct * 100).toFixed(0)}%`})`);
  if (!m.changes.length) console.log("  no change clears the rule");
  for (const t of m.largest) console.log(`  largest: ${t.date} ${t.merchant} ${chf(t.amount)}`);
  const f = s.forecast;
  console.log(`Forecast ${f.month}: income ${chf(f.income.value)} [${f.income.source}, ${f.income.basis}] - fixed ${chf(f.fixed.value)} - variable ${chf(f.variable.value)} (range ${chf(f.variable.min)} to ${chf(f.variable.max)}, ${f.variable.months} months) = ${chf(f.result.value)} (range ${chf(f.result.low)} to ${chf(f.result.high)}) [${f.result.basis}]`);
  console.log(`  upcoming ${f.upcomingDays} days: ${f.upcoming.map((u) => `${u.date.slice(5)} ${u.merchant} ${u.amount}`).join(" | ")}`);
  console.log(`Runway: cash ${chf(s.runway.cash)} / ${chf(s.runway.monthlySpend.value)} per month = ${s.runway.months.value} months, below zero in ${s.runway.belowZero}`);
}

async function main() {
  const now = new Date(2026, 9, 31);
  let checks = 0;
  const ok = (cond: unknown, message: string) => {
    assert.ok(cond, message);
    checks++;
  };

  for (const p of PROFILES) {
    const s = spendingInsights(p);
    assert.ok(s, `${p.name}: insights expected`);
    print(p, s);

    // Yearly cost = 12 x the monthly amount, and the total is the sum of the rows.
    for (const r of s.recurring.items) {
      if (r.cadence === "monthly") ok(cents(r.yearlyCost) === cents(12 * r.amount), `${p.name}: ${r.merchant} yearly = 12 x monthly`);
      ok(r.nextDate > s.asOf, `${p.name}: ${r.merchant} next date is after the anchor`);
    }
    ok(cents(s.recurring.yearlyTotal.value) === s.recurring.items.reduce((sum, r) => sum + cents(r.yearlyCost), 0), `${p.name}: yearly total = sum of rows`);

    // Forecast parts sum to the result.
    const f = s.forecast;
    ok(cents(f.result.value) === cents(f.income.value) - cents(f.fixed.value) - cents(f.variable.value), `${p.name}: forecast parts sum to the result`);
    ok(f.variable.min <= f.variable.value && f.variable.value <= f.variable.max, `${p.name}: variable median inside its range`);
    ok(f.result.low <= f.result.value && f.result.value <= f.result.high, `${p.name}: result inside its range`);
    ok(f.upcoming.every((u) => u.date > s.asOf), `${p.name}: upcoming payments are in the future`);
    ok(f.result.basis === "estimated" && f.variable.basis === "estimated", `${p.name}: forecast tagged as estimate`);

    // Every listed change clears the stated noise rule.
    for (const c of s.monthOverMonth.changes) {
      ok(Math.abs(c.delta) >= s.monthOverMonth.rule.minChf, `${p.name}: ${c.category} clears the CHF floor`);
    }
    ok(s.monthOverMonth.largest.length <= 3, `${p.name}: at most three largest payments`);

    // Deterministic: same input, same output (with and without an injected date).
    ok(JSON.stringify(spendingInsights(p)) === JSON.stringify(s), `${p.name}: deterministic`);
    ok(JSON.stringify(spendingInsights(p, undefined, now)) === JSON.stringify(spendingInsights(p, undefined, new Date(2026, 9, 31))), `${p.name}: deterministic with now`);

    // Nothing for an empty transaction list.
    ok(spendingInsights({ ...p, transactions: [] }) === undefined, `${p.name}: nothing without transactions`);
  }

  // Meriç: five subscriptions, two video and two music services overlap (docs/PITCH.md).
  const meric = PROFILES.find((p) => p.id === "meric") ?? PROFILES[1];
  const s = spendingInsights(meric)!;
  const subs = s.recurring.items.filter((r) => r.subscription).map((r) => r.merchant).sort();
  assert.deepEqual(subs, ["Apple Music", "Disney+", "Let's Go Fitness", "Netflix", "Spotify"], "Meriç: five subscriptions");
  checks++;
  const video = s.recurring.overlaps.find((o) => o.family === "videoStreaming");
  const music = s.recurring.overlaps.find((o) => o.family === "musicStreaming");
  assert.deepEqual([...(video?.merchants ?? [])].sort(), ["Disney+", "Netflix"], "Meriç: video overlap");
  assert.deepEqual([...(music?.merchants ?? [])].sort(), ["Apple Music", "Spotify"], "Meriç: music overlap");
  checks += 2;
  ok(cents(video!.yearlySaving) === cents(12 * 12.9), "Meriç: video saving = cheapest service x 12");
  ok(cents(music!.yearlySaving) === cents(12 * 10.95), "Meriç: music saving = cheapest service x 12");

  console.log(`\ninsights-check: ${checks} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
