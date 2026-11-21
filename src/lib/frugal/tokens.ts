/**
 * Token accounting used by the Frugal Inspector.
 * Our numbers come from OpenRouter's real `usage` field. The "naive" baseline is an
 * estimate of what the obvious approach would cost — clearly labelled as such in the UI.
 */

/** ~4 characters per token is the usual rule of thumb for English/German text. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Image tokens for a frontier VLM in high-detail mode (OpenAI-style tiling):
 * fit within 2048², scale shortest side to 768, 170 tokens per 512² tile + 85 base.
 */
export function naiveImageTokens(width: number, height: number): number {
  let w = width;
  let h = height;
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

/** Frontier-model list prices used for the naive baseline (USD per 1M tokens). */
export const NAIVE_PRICE = { input: 2.5, output: 10, label: "frontier VLM" };

export interface NaiveEstimate {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  description: string;
}

/** Naive snap: full-resolution image + a verbose extraction prompt + verbose JSON answer. */
export function naiveSnap(width: number, height: number): NaiveEstimate {
  const promptTokens = naiveImageTokens(width, height) + 450;
  const completionTokens = 350;
  return {
    promptTokens,
    completionTokens,
    costUsd: (promptTokens * NAIVE_PRICE.input + completionTokens * NAIVE_PRICE.output) / 1e6,
    description: `Full ${width}×${height} image to a ${NAIVE_PRICE.label} + verbose prompt`,
  };
}

/** Naive what-if: dump the whole twin (profile + transaction history) and ask the LLM to project it. */
export function naiveReasoning(stateJsonChars: number, outputTokens = 700): NaiveEstimate {
  const promptTokens = Math.ceil(stateJsonChars / 4) + 400;
  return {
    promptTokens,
    completionTokens: outputTokens,
    costUsd: (promptTokens * NAIVE_PRICE.input + outputTokens * NAIVE_PRICE.output) / 1e6,
    description: `Whole twin (${Math.round(stateJsonChars / 1000)}k chars) to a ${NAIVE_PRICE.label}, LLM does the maths`,
  };
}
