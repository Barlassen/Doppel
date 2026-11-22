/**
 * Facts for the `ask` task, built from an `outlook()` result. ONE function writes every figure under a key that
 * names its unit and time basis (`ASK_FACT_KEYS` in `src/lib/llm.ts`), so a caller cannot send a total under a
 * monthly name or the other way round. Pure; numbers are rounded the way they should be quoted (whole CHF,
 * percentages with one decimal).
 */
import { totalDebt } from "@/lib/finance/debt";
import type { Outlook } from "@/lib/finance/outlook";
import { checkAffordability } from "@/lib/finance/swissRules";
import type { Profile, SimResult } from "@/lib/finance/types";
import { translateText } from "@/lib/i18n";
import type { Locale, Text } from "@/lib/i18n/types";
import { FACT_TEXT_LIMIT, askFacts, type AskFacts } from "@/lib/llm";

export interface OutlookFactsContext {
  /** The profile the outlook was computed for (the effective profile of the scenario). */
  profile: Profile;
  /** Language of the labels inside the facts (decision names, cost lines, the economy's description). */
  locale: Locale;
  /** A name for the scenario, e.g. the what-if as typed. */
  scenario?: Text;
  /** The same scenario simulated without the behaviour parameters (the "disciplined" twin), for the habit figures. */
  disciplined?: Pick<SimResult, "successProb" | "medianAtGoal">;
  topHabit?: Text;
  bestMove?: { title: Text; odds: number };
  /** Further listed facts, e.g. `statementFacts()`; they never replace a figure of the outlook. */
  extra?: AskFacts;
}

const chf = (x: number) => Math.round(x);
const pct = (share: number) => Math.round(share * 1000) / 10;
const month = (ym: number) => `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, "0")}`;
const cut = (s: string) => (s.length <= FACT_TEXT_LIMIT ? s : s.slice(0, FACT_TEXT_LIMIT - 1).trimEnd() + "…");

export function outlookFacts(o: Outlook, ctx: OutlookFactsContext): AskFacts {
  const { profile: p, locale } = ctx;
  const text = (value: Text) => translateText(locale, value);
  const startYm = o.startYear * 100 + (o.budget.now.ym % 100);
  const ymOf = (m: number) => {
    const total = (startYm % 100) - 1 + m;
    return (Math.floor(startYm / 100) + Math.floor(total / 12)) * 100 + (total % 12) + 1;
  };
  const point = (key: string) => o.netWorth.find((n) => n.key === key);
  const fresh = o.decisions.filter((d) => d.isNew);
  const facts: Record<string, string | number | boolean | undefined> = {
    client: p.name,
    age_years: o.age,
    city: p.city,
    canton: p.canton,
    risk_profile: text({ key: `risk.${p.riskProfile}` }),
    goal: text(o.goal.label),
    goal_target_chf: chf(o.goal.target),
    goal_date: month(ymOf(o.goal.month)),
    years_to_goal: Math.round(o.goal.month / 12),
    scenario: ctx.scenario ? cut(text(ctx.scenario)) : undefined,
    economy_scenario: text(o.economy.label),
    economy_assumptions: cut(text(o.economy.summary)),
    goal_odds_pct: pct(o.goal.prob),
    goal_odds_before_decision_pct: fresh.length && o.goal.baselineProb !== undefined ? pct(o.goal.baselineProb) : undefined,
    goal_odds_disciplined_pct: ctx.disciplined ? pct(ctx.disciplined.successProb) : undefined,
    cash_crunch_risk_before_goal_date_pct: pct(o.crunch.beforeGoal),
    habit_cost_by_goal_date_chf: ctx.disciplined ? chf(Math.max(0, ctx.disciplined.medianAtGoal - o.goal.median)) : undefined,
    top_habit: ctx.topHabit ? cut(text(ctx.topHabit)) : undefined,
    best_move: ctx.bestMove ? cut(text(ctx.bestMove.title)) : undefined,
    best_move_goal_odds_pct: ctx.bestMove ? pct(ctx.bestMove.odds) : undefined,
    take_home_income_per_month_today_chf: chf(o.budget.now.income),
    spending_per_month_today_chf: chf(o.budget.now.expenses),
    surplus_per_month_today_chf: chf(o.budget.now.surplus),
  };

  if (fresh.length) {
    const first = fresh.reduce((a, b) => (b.month < a.month ? b : a));
    facts.budget_after_decision_month = month(o.budget.after.ym);
    facts.take_home_income_per_month_after_decision_chf = chf(o.budget.after.income);
    facts.spending_per_month_after_decision_chf = chf(o.budget.after.expenses);
    facts.surplus_per_month_after_decision_chf = chf(o.budget.after.surplus);
    if (o.budget.surplusDelta !== undefined) facts.surplus_change_per_month_from_decision_chf = chf(o.budget.surplusDelta);
    facts.decision = cut(fresh.map((d) => text(d.label)).join(" + "));
    facts.decision_start_month = month(ymOf(first.month));
    const missing = fresh.flatMap((d) => d.inputsNeeded.map((n) => text(n.label)));
    if (missing.length) facts.decision_inputs_missing = cut(missing.join("; "));
    facts.decision_net_cost_per_month_first_year_chf = chf(fresh.reduce((s, d) => s + d.netMonthly.year1, 0));
    facts.decision_net_cost_per_month_first_10_years_chf = chf(fresh.reduce((s, d) => s + d.netMonthly.years10, 0));
    facts.decision_net_cost_first_12_months_total_chf = chf(fresh.reduce((s, d) => s + (d.byYear[0]?.net ?? 0), 0));
    facts.decision_net_cost_total_chf = chf(fresh.reduce((s, d) => s + d.totalNet, 0));
    // The decision's own lines, largest first: what it is, cost or income, CHF per month and from when to when.
    const lines: { weight: number; text: string }[] = [];
    for (const d of fresh) {
      for (const l of d.lines) {
        if (!l.phases.length || l.transfer) continue;
        const parts = l.phases.slice(0, 3).map((ph, i) => `${i ? "then " : ""}CHF ${Math.abs(ph.monthly)} per month ${month(ymOf(ph.fromMonth))} to ${month(ymOf(ph.toMonth - 1))}`);
        const sign = l.phases[0].monthly < 0 ? (l.flow === "income" ? "lower income" : "saving") : l.flow === "income" ? "income" : "cost";
        const chance = l.prob !== undefined ? ` (expected value; applies in ${pct(l.prob)}% of futures)` : "";
        lines.push({ weight: Math.abs(l.total), text: `${text(l.label)}: ${sign} ${parts.join(", ")}${chance}` });
      }
      for (const x of d.oneOffs) {
        if (x.transfer) continue;
        lines.push({ weight: Math.abs(x.amount) * 12, text: `${text(x.label)}: one-off ${x.amount < 0 ? "cost" : "income"} CHF ${Math.abs(chf(x.amount))} in ${month(ymOf(x.month))}` });
      }
    }
    lines.sort((a, b) => b.weight - a.weight);
    lines.slice(0, 6).forEach((l, i) => (facts[`decision_line_${i + 1}`] = cut(l.text)));
  }

  const y10 = point("y10");
  Object.assign(facts, {
    net_worth_today_chf: chf(o.sim.bands[0].p50),
    net_worth_in_1_year_median_chf: point("y1") ? chf(point("y1")!.p50) : undefined,
    net_worth_in_5_years_median_chf: point("y5") ? chf(point("y5")!.p50) : undefined,
    net_worth_in_10_years_median_chf: y10 ? chf(y10.p50) : undefined,
    date_in_1_year: point("y1") ? month(point("y1")!.ym) : undefined,
    date_in_5_years: point("y5") ? month(point("y5")!.ym) : undefined,
    date_in_10_years: y10 ? month(y10.ym) : undefined,
    net_worth_in_10_years_weak_case_chf: y10 ? chf(y10.p10) : undefined,
    net_worth_in_10_years_strong_case_chf: y10 ? chf(y10.p90) : undefined,
    net_worth_in_10_years_change_from_decision_chf: fresh.length && y10?.deltaP50 !== undefined ? chf(y10.deltaP50) : undefined,
    net_worth_at_goal_date_median_chf: point("goal") ? chf(point("goal")!.p50) : undefined,
    net_worth_at_retirement_median_chf: point("retirement") ? chf(point("retirement")!.p50) : undefined,
    lowest_cash_median_chf: chf(o.cashLow.median.amount),
    lowest_cash_month: month(o.cashLow.median.ym),
    lowest_cash_weak_case_chf: chf(o.cashLow.p10.amount),
  });

  const h = o.sim.house;
  if (h) {
    const test = checkAffordability({
      price: h.price,
      grossIncomeYear: h.grossAtPurchase,
      hardEquityAvailable: h.medianHardEquity,
      pillar2Available: h.medianPillar2,
      closingRate: h.closingRate,
      ...(h.medianOtherDebtYear ? { otherDebtYear: h.medianOtherDebtYear } : {}),
      ...(h.mortgageRate ? { stressRate: h.mortgageRate } : {}),
    });
    Object.assign(facts, {
      home_price_at_purchase_chf: chf(h.price),
      home_purchase_year: Math.floor(ymOf(h.month) / 100),
      home_bank_test_passes: test.pass,
      home_cost_to_income_pct: Number.isFinite(test.costToIncome) ? pct(test.costToIncome) : undefined,
      home_max_price_at_purchase_chf: chf(test.maxPrice),
      home_bought_in_pct_of_futures: pct(h.boughtProb),
    });
  }
  const r = o.retirement;
  if (r) {
    Object.assign(facts, {
      retirement_age_years: r.age,
      retirement_income_per_month_from_ahv_age_chf: chf(r.incomeFromAhvAge),
      retirement_spending_per_month_chf: chf(r.spendingMonthly),
      retirement_gap_per_month_chf: chf(r.gapMonthly),
      savings_last_to_age_90_pct: pct(r.lastsTo90Prob),
    });
  }
  Object.assign(facts, {
    liquid_savings_today_chf: chf(p.cash),
    investments_today_chf: chf(p.portfolio),
    pillar3a_today_chf: chf(p.pillar3a),
    pension_fund_today_chf: chf(p.pillar2),
    debt_today_chf: p.liabilities?.length ? chf(totalDebt(p)) : undefined,
    contributes_3a: p.contributes3a,
  });
  // The outlook's figures win over anything passed in.
  return askFacts({ ...ctx.extra, ...Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined)) });
}
