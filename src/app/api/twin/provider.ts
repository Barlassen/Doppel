import { DEFAULT_TEXT_MODEL_PRICE, DEFAULT_VISION_MODEL_PRICE, NAIVE_MODEL, NAIVE_PRICE, estimateTextTokens, naiveImageTokens } from "@/lib/frugal/tokens";
import type { TwinStatus } from "@/lib/llm";

/**
 * Which chat-completions endpoint the gateway talks to. Any OpenAI-compatible `/chat/completions` works:
 * OpenRouter (default), Groq, a local Ollama (`http://localhost:11434/v1`, no key), LM Studio, vLLM…
 * Read from the environment on every call, so nothing here is baked into the build.
 */

type Env = Readonly<Record<string, string | undefined>>;
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface LlmConfig {
  /** Without a trailing slash; `/chat/completions` is appended. Undefined when DOPPEL_LLM_BASE_URL is not a http(s) URL. */
  baseUrl?: string;
  host: string | null;
  openRouter: boolean;
  apiKey?: string;
  textModel?: string;
  visionModel?: string;
  naiveModel?: string;
  jsonMode: boolean;
  timeoutMs: number;
  reason?: TwinStatus["reason"];
}

const value = (raw: string | undefined) => raw?.trim() || undefined;

export function llmConfig(env: Env = process.env): LlmConfig {
  const explicit = value(env.DOPPEL_LLM_BASE_URL);
  let baseUrl: string | undefined;
  let host: string | null = null;
  try {
    const url = new URL(explicit ?? OPENROUTER_BASE_URL);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
      baseUrl = (url.origin + url.pathname).replace(/\/+$/, "");
      host = url.host;
    }
  } catch {
    // Reported as BAD_BASE_URL below.
  }
  const openRouter = host === "openrouter.ai";
  // The OpenRouter key is never sent to another host: a custom endpoint needs its own key, or none (local models).
  const apiKey = value(env.DOPPEL_LLM_API_KEY) ?? (openRouter ? value(env.OPENROUTER_API_KEY) : undefined);
  // The default model ids are OpenRouter catalogue names, so another endpoint has to name its own models.
  const textModel = value(env.DOPPEL_TEXT_MODEL) ?? (openRouter ? DEFAULT_TEXT_MODEL_PRICE.model : undefined);
  const visionModel = value(env.DOPPEL_VISION_MODEL) ?? (openRouter ? DEFAULT_VISION_MODEL_PRICE.model : undefined);
  const naiveModel = value(env.DOPPEL_NAIVE_MODEL) ?? (openRouter ? NAIVE_MODEL : undefined);
  const timeout = Number(env.DOPPEL_LLM_TIMEOUT_MS);
  const reason: LlmConfig["reason"] = !baseUrl ? "BAD_BASE_URL" : openRouter && !apiKey ? "NO_KEY" : !textModel ? "NO_TEXT_MODEL" : undefined;
  return {
    baseUrl, host, openRouter, apiKey, textModel, visionModel, naiveModel,
    jsonMode: !/^(?:off|0|false|no)$/i.test(value(env.DOPPEL_LLM_JSON_MODE) ?? ""),
    timeoutMs: Number.isFinite(timeout) && timeout >= 1_000 ? Math.min(timeout, 25_000) : 15_000,
    reason,
  };
}

export function llmStatus(env: Env = process.env): TwinStatus {
  const config = llmConfig(env);
  const configured = !config.reason;
  return {
    ok: true,
    configured,
    provider: config.host,
    textModel: configured ? config.textModel ?? null : null,
    visionModel: configured ? config.visionModel ?? null : null,
    naiveModel: configured ? config.naiveModel ?? null : null,
    ...(config.reason ? { reason: config.reason } : {}),
  };
}

// ---------------- prices and usage ----------------

/** USD per 1M tokens for the models this repo names. Any other model has no price here: its cost stays unknown. */
const PRICES: readonly { model: string; input: number; output: number }[] = [DEFAULT_TEXT_MODEL_PRICE, DEFAULT_VISION_MODEL_PRICE, NAIVE_PRICE];
export const priceOf = (model: string) => PRICES.find((price) => price.model === model);

export interface ReportedUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
  /** "estimated": the provider sent no token counts, so these are ~4 characters per token (+ image tiles). */
  tokenBasis: "reported" | "estimated";
  /** "estimated": tokens × the catalogue price above. "unknown": no price for this model, `costUsd` is 0. */
  costBasis: "reported" | "estimated" | "unknown";
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000_000;

export interface SentSize { textChars: number; image?: { width: number; height: number } }

export const estimatePromptTokens = (sent: SentSize) =>
  Math.ceil(sent.textChars / 4) + (sent.image ? naiveImageTokens(sent.image.width, sent.image.height) : 0);

/**
 * Normalises a provider's `usage`. OpenRouter reports tokens and cost; most OpenAI-compatible servers report tokens
 * only; some report nothing. Missing parts are estimated and labelled, never passed off as measured.
 */
export function usageFrom(out: unknown, model: string, sent: SentSize, content: string): { usage: ReportedUsage; usageKnown: boolean } {
  const body = (typeof out === "object" && out !== null ? out : {}) as { usage?: Record<string, unknown>; model?: unknown };
  const raw = body.usage ?? {};
  const reportedTokens = isCount(raw.prompt_tokens) && isCount(raw.completion_tokens);
  const promptTokens = reportedTokens ? (raw.prompt_tokens as number) : estimatePromptTokens(sent);
  const completionTokens = reportedTokens ? (raw.completion_tokens as number) : estimateTextTokens(content);
  const reportedCost = typeof raw.cost === "number" && Number.isFinite(raw.cost) && raw.cost >= 0;
  const price = priceOf(model);
  const costUsd = reportedCost ? (raw.cost as number) : price ? (promptTokens * price.input + completionTokens * price.output) / 1e6 : 0;
  return {
    usage: {
      promptTokens,
      completionTokens,
      costUsd,
      model: typeof body.model === "string" && body.model.trim() && body.model.length <= 200 ? body.model : model,
      tokenBasis: reportedTokens ? "reported" : "estimated",
      costBasis: reportedCost ? "reported" : price ? "estimated" : "unknown",
    },
    // "Known" means measured by the provider: estimated token counts stay out of the headline savings.
    usageKnown: reportedTokens,
  };
}

/** Upper bound of one call for the daily budget: the whole prompt plus every output token it may use. */
export function worstCase(model: string, sent: SentSize, maxTokens: number): { tokens: number; usd: number } {
  // Dense text (numbers, JSON) runs nearer three characters per token than four.
  const prompt = Math.ceil(sent.textChars / 3) + (sent.image ? naiveImageTokens(sent.image.width, sent.image.height) : 0);
  const price = priceOf(model);
  return { tokens: prompt + maxTokens, usd: price ? (prompt * price.input + maxTokens * price.output) / 1e6 : 0 };
}

// ---------------- JSON mode ----------------

/** Endpoints (host + model) that refused `response_format`; later calls skip it. */
const noJsonMode = new Set<string>();
export const jsonModeKey = (config: Pick<LlmConfig, "host">, model: string) => `${config.host}|${model}`;
export const supportsJsonMode = (config: LlmConfig, model: string) => config.jsonMode && !noJsonMode.has(jsonModeKey(config, model));
export const rememberNoJsonMode = (config: LlmConfig, model: string) => void noJsonMode.add(jsonModeKey(config, model));
/** For checks only. */
export const resetProviderMemory = () => noJsonMode.clear();
