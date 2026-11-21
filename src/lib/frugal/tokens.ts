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
  formula: "OpenAI tile formula, $2.50/$10 per 1M",
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
 * Realistic non-inflated text prompt & output token counts for a typical GPT-4o extraction call:
 * - Prompt text (160 tok ≈ 640 chars): clear extraction instructions + JSON schema for 6 Swiss doc kinds
 *   (Doppel's ultra-terse system prompt is ~90 tok; a normal readable prompt without manual golfing is ~150–180 tok).
 * - Completion (120 tok ≈ 480 chars): pretty-printed JSON with 8–10 extracted fields and brief field notes.
 */
export const NAIVE_SNAP_PROMPT_TEXT_TOKENS = 160;
export const NAIVE_SNAP_OUTPUT_TOKENS = 120;

/**
 * Cap the profile state fed to the "LLM-does-the-maths" baseline at 2,400 chars (~600 tokens).
 * Why: a reasonable engineer prompting GPT-4o to project a user's finances would send a structured
 * summary (balances, income, expenses, events, behavioural summary) rather than dumping 150 raw
 * transaction rows on every turn. Capping here avoids inflating the baseline with transaction-log bloat.
 */
export const NAIVE_STATE_CHAR_CAP = 2400;
export const NAIVE_REASONING_PROMPT_TOKENS = 180;

export interface NaiveEstimate {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  description: string;
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
    description: `GPT-4o high-detail (${w}×${h}: ${imgTok} img + ${NAIVE_SNAP_PROMPT_TEXT_TOKENS} prompt tok; OpenAI tile formula, $2.50/$10 per 1M)`,
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
    description: `LLM-does-the-maths (GPT-4o, $2.50/$10 per 1M): compact twin (~${stateTokens} tok) + rules (${NAIVE_REASONING_PROMPT_TOKENS} tok) + ${completionTokens} out`,
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
  note: "Rough estimate: ~0.0006 Wh/tok frontier (Epoch AI, 2025), ~0.0002 Wh/tok small model (Google, 2025), ~0.002 Wh local CPU pass (15 W × 0.5 s). Varies 3–5× by hardware and batching.",
} as const;

export function estimateEnergyWh(tokens: number, kind: "frontier" | "small" | "local"): number {
  if (kind === "local") return ENERGY_ASSUMPTIONS.localCallWh;
  const rate = kind === "frontier" ? ENERGY_ASSUMPTIONS.frontierWhPerTok : ENERGY_ASSUMPTIONS.smallWhPerTok;
  return tokens * rate;
}
