import { msg, type Locale, type Msg } from "@/lib/i18n/types";
import type { Usage } from "@/lib/snap/types";

/**
 * Contract of the model gateway (`/api/twin`), shared by the browser and the route. No DOM and no secrets here:
 * the route imports the limits and key lists below, the browser imports the helpers.
 */

export interface LlmResponse<T> {
  ok: boolean;
  offline?: boolean;
  error?: string;
  data?: T;
  ms?: number;
  usage?: Omit<Usage, "mode">;
  usageKnown?: boolean;
  request?: unknown;
}

/** What `GET /api/twin` reports. Host and model names only: never a key, a header or the full base URL. */
export interface TwinStatus {
  ok: true;
  /** A chat-completions endpoint and a text model are set, so the text tasks can run. */
  configured: boolean;
  /** Host of the endpoint (e.g. "openrouter.ai", "localhost:11434"), or null when the base URL is unusable. */
  provider: string | null;
  /** Null when the task family has no model on this endpoint; its tasks then answer `{ ok: false, offline: true }`. */
  textModel: string | null;
  visionModel: string | null;
  naiveModel: string | null;
  /** Why `configured` is false. */
  reason?: "NO_KEY" | "BAD_BASE_URL" | "NO_TEXT_MODEL";
}

// ---------------- facts sent with `narrate` and `ask` ----------------

/** `narrate` refuses a facts object whose JSON is larger than this (UTF-8 bytes) or that carries an unlisted key. */
export const FACTS_BYTE_LIMIT = 2_000;
/** `ask` carries the outlook figures too (net worth by horizon, the budget, a decision's lines). */
export const ASK_FACTS_BYTE_LIMIT = 3_600;
export const FACT_TEXT_LIMIT = 200;

/** `narrate`: the engine facts DoppelApp sends (the dashboard's private-banker paragraph). */
export const NARRATE_FACT_KEYS = [
  "client", "goal", "odds", "odds_with_habits", "odds_disciplined",
  // The same figure under its old and its explicit name: the median cost of the habits in total by the goal date.
  "habit_cost_chf", "habit_cost_by_goal_date_chf",
  "top_habit", "cash_crunch_risk", "home", "retirement", "best_move",
] as const;
export const NARRATE_NESTED_KEYS: Readonly<Record<string, readonly string[]>> = {
  home: ["price", "passes", "cost_to_income", "max_price_at_purchase", "bought_in"],
  retirement: ["age", "savings_last_to_90", "pension_income_month"],
};

/**
 * `ask`: flat facts the engine computed for a free-form question. Every value is a number, a short string or a
 * boolean. The answer may only use figures that appear here (or in the question), so send numbers the way they
 * should be quoted: money in whole CHF (today's CHF), percentages as 42 or 41.5 for 42% / 41.5%.
 *
 * EVERY KEY NAMES ITS UNIT AND ITS TIME BASIS, because a model reads the key to say what the number means:
 *   `_chf` money · `_pct` percentage · `_per_month` a monthly amount · `_total` / `_by_goal_date` a sum over a period ·
 *   `_today` / `_in_5_years` / `_at_goal_date` / `_at_retirement` a level at that time ·
 *   `_median` the middle simulated future · `_weak_case` / `_strong_case` the weakest / strongest 10% of futures.
 * A key without such a suffix must not carry a number that could be read as another basis. Build the object with
 * `outlookFacts()` (`src/lib/twin/facts.ts`) rather than by hand; earlier keys survive when the byte cap trims.
 */
export const ASK_FACT_KEYS = [
  // who and what for
  "client", "age_years", "city", "canton", "household", "children", "risk_profile",
  "goal", "goal_target_chf", "goal_date", "years_to_goal",
  // the scenario the figures belong to
  "scenario", "economy_scenario", "economy_assumptions",
  // odds = share of the simulated futures
  "goal_odds_pct", "goal_odds_before_decision_pct", "goal_odds_disciplined_pct", "cash_crunch_risk_before_goal_date_pct",
  "habit_cost_by_goal_date_chf", "top_habit", "best_move", "best_move_goal_odds_pct",
  // monthly budget
  "take_home_income_per_month_today_chf", "spending_per_month_today_chf", "surplus_per_month_today_chf",
  "budget_after_decision_month", "take_home_income_per_month_after_decision_chf", "spending_per_month_after_decision_chf",
  "surplus_per_month_after_decision_chf", "surplus_change_per_month_from_decision_chf",
  // the decision and its own cost lines
  "decision", "decision_start_month", "decision_inputs_missing",
  "decision_net_cost_per_month_first_year_chf", "decision_net_cost_per_month_first_10_years_chf",
  "decision_net_cost_first_12_months_total_chf", "decision_net_cost_total_chf",
  "decision_line_1", "decision_line_2", "decision_line_3", "decision_line_4", "decision_line_5", "decision_line_6",
  // net worth
  "net_worth_today_chf", "net_worth_in_1_year_median_chf", "net_worth_in_5_years_median_chf", "net_worth_in_10_years_median_chf",
  "date_in_1_year", "date_in_5_years", "date_in_10_years",
  "net_worth_in_10_years_weak_case_chf", "net_worth_in_10_years_strong_case_chf", "net_worth_in_10_years_change_from_decision_chf",
  "net_worth_at_goal_date_median_chf", "net_worth_at_retirement_median_chf",
  // cash
  "lowest_cash_median_chf", "lowest_cash_month", "lowest_cash_weak_case_chf",
  // home
  "home_price_at_purchase_chf", "home_purchase_year", "home_bank_test_passes", "home_cost_to_income_pct",
  "home_max_price_at_purchase_chf", "home_bought_in_pct_of_futures",
  // retirement
  "retirement_age_years", "retirement_income_per_month_from_ahv_age_chf", "retirement_spending_per_month_chf",
  "retirement_gap_per_month_chf", "savings_last_to_age_90_pct",
  // balances today
  "liquid_savings_today_chf", "investments_today_chf", "pillar3a_today_chf", "pension_fund_today_chf", "debt_today_chf",
  "invest_per_month_chf", "contributes_3a",
  // what the statement import taught the twin
  "statement_months", "statement_income_month_chf", "statement_fixed_month_chf", "statement_variable_month_chf",
  "statement_invest_month_chf", "statement_savings_rate_pct", "statement_top_category", "statement_facts",
  // free context computed by the engine
  "assumptions", "note",
] as const;
export type AskFactKey = (typeof ASK_FACT_KEYS)[number];
export type AskFacts = Partial<Record<AskFactKey, string | number | boolean>>;

export const ASK_QUESTION_LIMIT = 400;
export const ASK_WORD_LIMIT = 120;

// ---------------- browser helpers ----------------

export async function callTwin<T>(body: Record<string, unknown>): Promise<LlmResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch("/api/twin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await res.json()) as LlmResponse<T>;
  } catch {
    return { ok: false, error: "GATEWAY_UNAVAILABLE", usageKnown: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether an assistant is connected. Undefined when the gateway itself cannot be reached. */
export async function twinStatus(): Promise<TwinStatus | undefined> {
  try {
    const res = await fetch("/api/twin", { method: "GET", cache: "no-store" });
    const body = (await res.json()) as TwinStatus;
    return body && body.ok === true && typeof body.configured === "boolean" ? body : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps only the listed, well-formed facts and drops trailing ones until the JSON fits the gateway's byte cap. */
export function askFacts(facts: Readonly<Record<string, unknown>>): AskFacts {
  const out: Record<string, string | number | boolean> = {};
  let bytes = 2;
  for (const key of ASK_FACT_KEYS) {
    const raw = facts[key];
    const value = typeof raw === "string" ? raw.trim().slice(0, FACT_TEXT_LIMIT) : raw;
    if (!(typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value))) continue;
    const size = new TextEncoder().encode(JSON.stringify(key) + ":" + JSON.stringify(value) + ",").length;
    if (bytes + size > ASK_FACTS_BYTE_LIMIT) break;
    out[key] = value;
    bytes += size;
  }
  return out as AskFacts;
}

/**
 * Free-form question about the twin, answered from the engine's figures only. `data` is plain text. The gateway
 * rejects an answer that contains a number the facts do not (error `UNGROUNDED_ANSWER`) or that quotes a figure on
 * another time basis than its key (`MISLABELED_ANSWER`); show `askErrorMsg()` then.
 */
export function askTwin(question: string, facts: AskFacts, lang: Locale): Promise<LlmResponse<string>> {
  return callTwin<string>({ task: "ask", question: question.trim().slice(0, ASK_QUESTION_LIMIT), facts: askFacts(facts), lang });
}

/** A display message for a failed gateway call (never tells an end user to edit an env file). */
export function askErrorMsg(r: Pick<LlmResponse<unknown>, "offline" | "error">): Msg {
  if (r.offline) return msg("llm.notConnected");
  switch (r.error) {
    case "UNGROUNDED_ANSWER":
    case "MISLABELED_ANSWER": return msg("llm.ungrounded");
    case "RATE_LIMITED":
    case "GATEWAY_BUSY": return msg("llm.busy");
    case "BUDGET_EXHAUSTED": return msg("llm.budget");
    case "INVALID_FIELDS":
    case "BODY_TOO_LARGE": return msg("llm.invalid");
    default: return msg("llm.failed");
  }
}

/** One line for a status badge: connected to which host and model, or not connected. */
export function statusMsg(status: TwinStatus | undefined): Msg {
  if (!status) return msg("llm.unreachable");
  if (!status.configured || !status.provider || !status.textModel) return msg("llm.notConnected");
  return msg("llm.connected", { provider: status.provider, model: status.textModel });
}
