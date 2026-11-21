import { msg, type Msg } from "@/lib/i18n/types";

/**
 * Token, cost, and rough energy accounting used by the Frugal Inspector and benchmark.
 *
 * Our numbers come from OpenRouter's real `usage` field (or exact 0 for local browser passes).
 * The "naive" baseline models sending the document at its ACTUAL resolution to GPT-4o in
 * high-detail mode, or asking GPT-4o to do the financial maths directly on a compact twin summary.
 * Estimates are always labelled as estimates until replaced by a live GPT-4o comparison run.
 */

/** ~4 characters per token is the standard rule of thumb for English/German/French text. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Image tokens for GPT-4o high-detail mode using OpenAI's documented tiling formula:
 *   1. Fit within 2048×2048 preserving aspect ratio (if larger).
 *   2. Scale shortest side down to 768px preserving aspect ratio (if > 768).
 *   3. Count 512×512 tiles: ceil(w / 512) * ceil(h / 512).
 *   4. Cost = 85 base + 170 * tiles.
 */
export function naiveImageTokens(width: number, height: number): number {
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  const fit = Math.min(1, 2048 / Math.max(w, h));
  w *= fit;
  h *= fit;
  const short = Math.min(w, h);
  if (short > 768) {
    const s = 768 / short;
    w *= s;
    h *= s;
  }
  const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
  return 85 + 170 * tiles;
}

/**
 * Reference naive model pricing (USD per 1M tokens).
 * GPT-4o standard API list pricing: $2.50 / 1M input, $10.00 / 1M output.
 */
export const NAIVE_MODEL = "openai/gpt-4o";
export const NAIVE_PRICE = {
  input: 2.5,
  output: 10,
  label: "GPT-4o high-detail",
  model: NAIVE_MODEL,
} as const;

/**
 * Small model list pricing used only for offline benchmark estimates when OPENROUTER_API_KEY is unset.
 * Google Gemini 2.5 Flash-Lite OpenRouter list price: $0.10 / 1M input, $0.40 / 1M output.
 */
export const SMALL_MODEL_PRICE = {
  input: 0.1,
  output: 0.4,
  label: "Gemini 2.5 Flash-Lite",
  model: "google/gemini-2.5-flash-lite",
} as const;

/**
 * Text prompt and completion token counts for the estimated GPT-4o extraction baseline:
 * - Prompt text (160 tok, ~640 chars): extraction instructions and JSON schema for 6 document kinds.
 * - Completion (120 tok, ~480 chars): JSON object with the extracted fields.
 */
export const NAIVE_SNAP_PROMPT_TEXT_TOKENS = 160;
export const NAIVE_SNAP_OUTPUT_TOKENS = 120;

/**
 * Cap the profile state in the "LLM-does-the-maths" baseline at 2,400 chars (~600 tokens):
 * send a summary (balances, income, expenses, events, habits) rather than all 150 raw transactions
 * so transaction logs do not inflate the baseline.
 */
export const NAIVE_STATE_CHAR_CAP = 2400;
export const NAIVE_REASONING_PROMPT_TOKENS = 180;

export interface NaiveEstimate {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  description: Msg;
  model?: string;
  basis?: "estimated" | "measured";
}

/**
 * Naive snap baseline: actual image dimensions (no synthetic upscaling) sent to GPT-4o high-detail,
 * plus a realistic structured-extraction prompt (160 tok) and JSON completion (120 tok).
 */
export function naiveSnap(width: number, height: number): NaiveEstimate {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const imgTok = naiveImageTokens(w, h);
  const promptTokens = imgTok + NAIVE_SNAP_PROMPT_TEXT_TOKENS;
  const completionTokens = NAIVE_SNAP_OUTPUT_TOKENS;
  return {
    promptTokens,
    completionTokens,
    costUsd: (promptTokens * NAIVE_PRICE.input + completionTokens * NAIVE_PRICE.output) / 1e6,
    description: msg("naive.snap", { w, h, img: imgTok, prompt: NAIVE_SNAP_PROMPT_TEXT_TOKENS }),
    model: NAIVE_MODEL,
    basis: "estimated",
  };
}

/**
 * Naive "LLM-does-the-maths" baseline for what-ifs and narrations:
 * sends a compact twin summary (capped at 2.4k chars / ~600 tok, excluding raw transaction history)
 * + Swiss affordability & projection rules (~180 tok) to GPT-4o and asks it to calculate & explain.
 */
export function naiveReasoning(stateJsonChars: number, outputTokens = 350): NaiveEstimate {
  const effectiveChars = Math.min(Math.max(stateJsonChars, 400), NAIVE_STATE_CHAR_CAP);
  const stateTokens = Math.ceil(effectiveChars / 4);
  const promptTokens = stateTokens + NAIVE_REASONING_PROMPT_TOKENS;
  const completionTokens = Math.max(80, Math.min(outputTokens, 450));
  return {
    promptTokens,
    completionTokens,
    costUsd: (promptTokens * NAIVE_PRICE.input + completionTokens * NAIVE_PRICE.output) / 1e6,
    description: msg("naive.reasoning", { state: stateTokens, rules: NAIVE_REASONING_PROMPT_TOKENS, out: completionTokens }),
    model: NAIVE_MODEL,
    basis: "estimated",
  };
}

/**
 * Rough order-of-magnitude serving energy assumptions (Wh per token):
 * - Frontier VLM/LLM (~0.0006 Wh/tok): Epoch AI (2025), "How much energy does ChatGPT use?",
 *   estimating ~0.3 Wh for a ~500-token GPT-4o query.
 * - Small/lite LLM (~0.0002 Wh/tok): Google (2025), "Measuring the environmental impact of
 *   delivering AI at Google Scale", reporting 0.24 Wh median per Gemini text prompt; lite models
 *   with short output caps sit near ~0.2 Wh per 1,000 tokens.
 * - Local browser pass (~0.002 Wh/call): ~15 W client CPU active for ~0.5 s during jsQR/OCR.
 * Real energy varies 3–5× with accelerator generation, batching, and datacenter PUE.
 */
export const ENERGY_ASSUMPTIONS = {
  frontierWhPerTok: 0.0006,
  smallWhPerTok: 0.0002,
  localCallWh: 0.002,
} as const;

export function estimateEnergyWh(tokens: number, kind: "frontier" | "small" | "local"): number {
  if (kind === "local") return ENERGY_ASSUMPTIONS.localCallWh;
  const rate = kind === "frontier" ? ENERGY_ASSUMPTIONS.frontierWhPerTok : ENERGY_ASSUMPTIONS.smallWhPerTok;
  return tokens * rate;
}
