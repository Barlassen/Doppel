import type { TransactionCategory } from "@/lib/finance/types";
import { estimateBytesSent, type LedgerEntry } from "@/lib/frugal/ledger";
import { estimateTextTokens, NAIVE_MODEL, NAIVE_PRICE, type NaiveEstimate } from "@/lib/frugal/tokens";
import { msg } from "@/lib/i18n/types";
import { callTwin } from "@/lib/llm";
import type { Usage } from "@/lib/snap/types";
import { CATEGORIZE_MAX_NAMES, categorizeName } from "./categorizeModel";
import { applyCategories, unresolvedMerchants, type Review } from "./review";
import { merchantKey } from "./text";

/**
 * Frugal categorisation, step 2 (browser only): the model-answer cache, then ONE compact batch of the still
 * unresolved unique merchant names to the small text model via /api/twin (`task: "categorize"`). Offline or on any
 * error the rows stay "other" with "review needed". Every run adds a ledger entry for the Inspector.
 */

const CACHE_KEY = "doppel:import:categories:v1";
const CACHE_MAX = 500;

function readCache(): Record<string, TransactionCategory> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, TransactionCategory>) : {};
  } catch {
    return {};
  }
}

function writeCache(add: Record<string, TransactionCategory>) {
  try {
    const next = { ...readCache(), ...add };
    const keys = Object.keys(next);
    for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete next[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the cache is only an optimisation.
  }
}

/** What GPT-4o would cost if every row's booking text were sent for categorisation (the naive baseline). */
function naiveCategorize(review: Review): NaiveEstimate {
  const text = review.rows.map((r) => `${r.date} ${r.raw} ${r.amount}`).join("\n");
  const promptTokens = estimateTextTokens(text) + 120;
  const completionTokens = Math.max(20, review.rows.length * 6);
  return {
    promptTokens,
    completionTokens,
    costUsd: (promptTokens * NAIVE_PRICE.input + completionTokens * NAIVE_PRICE.output) / 1e6,
    description: msg("data.naive", { rows: review.rows.length, tokens: promptTokens }),
    model: NAIVE_MODEL,
    basis: "estimated",
  };
}

let seq = 0;
const entryId = () => `imp-${Date.now().toString(36)}-${(++seq).toString(36)}`;

export interface CategorizeOutcome {
  review: Review;
  entries: LedgerEntry[];
  /** "local" = everything resolved at 0 tokens; "model" = a call was made; "offline" / "error" = rows left for review. */
  mode: "local" | "model" | "offline" | "error";
  sent: number;
}

/** Cache + one model batch. `fileName` labels the ledger entries. */
export async function categorizeWithModel(review: Review, fileName: string, rowsResolvedLocally: number): Promise<CategorizeOutcome> {
  const t0 = performance.now();
  const cache = readCache();
  const cached = new Map<string, TransactionCategory>();
  for (const name of unresolvedMerchants(review)) {
    const c = cache[merchantKey(name)];
    if (c) cached.set(merchantKey(name), c);
  }
  let next = cached.size ? applyCategories(review, cached, "cache") : review;
  const pending = unresolvedMerchants(next);
  const naive = naiveCategorize(review);
  const localEntry: LedgerEntry = {
    id: entryId(),
    at: Date.now(),
    kind: "command",
    title: msg("data.ledgerLocal", { file: fileName, count: rowsResolvedLocally + cached.size }),
    tier: "local-parser",
    ms: performance.now() - t0,
    usage: { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "merchant rules + cache (local)", mode: "local" },
    naive,
    payload: { sentToCloud: null, resolvedLocally: rowsResolvedLocally, fromCache: cached.size, unresolved: pending.length },
    route: "local-parser",
    outcome: "ok",
    usageKnown: true,
    bytesSent: 0,
  };
  if (!pending.length) return { review: next, entries: [localEntry], mode: "local", sent: 0 };

  const names = pending.slice(0, CATEGORIZE_MAX_NAMES).map(categorizeName);
  const unique = [...new Set(names)];
  const request = { task: "categorize", merchants: unique };
  const t1 = performance.now();
  const r = await callTwin<{ categories: TransactionCategory[] }>(request);
  let mode: CategorizeOutcome["mode"];
  let usage: Usage;
  if (r.ok && r.data && Array.isArray(r.data.categories) && r.data.categories.length === unique.length) {
    const answers = new Map<string, TransactionCategory>();
    const toCache: Record<string, TransactionCategory> = {};
    unique.forEach((name, i) => {
      const c = r.data!.categories[i];
      for (const original of pending) if (categorizeName(original) === name) answers.set(merchantKey(original), c);
      if (c !== "other") toCache[merchantKey(name)] = c;
    });
    next = applyCategories(next, answers, "model");
    writeCache(toCache);
    mode = "model";
    usage = { ...r.usage!, mode: "llm" };
  } else {
    mode = r.offline ? "offline" : "error";
    usage = { promptTokens: 0, completionTokens: 0, costUsd: 0, model: r.offline ? "offline: left for review" : "model error: left for review", mode: r.offline ? "offline" : "llm" };
  }
  const modelEntry: LedgerEntry = {
    id: entryId(),
    at: Date.now(),
    kind: "command",
    title: msg("data.ledgerModel", { file: fileName, count: unique.length }),
    tier: "llm",
    ms: performance.now() - t1,
    usage,
    naive: { ...naive, promptTokens: 0, completionTokens: 0, costUsd: 0 },
    payload: r.request ?? { wouldSend: request },
    route: mode === "offline" ? "offline-heuristic" : "text-llm",
    outcome: mode === "model" ? "ok" : mode === "offline" ? "partial" : "failed",
    usageKnown: mode === "model" ? r.usageKnown !== false : mode === "error" ? false : undefined,
    bytesSent: estimateBytesSent(r.request ?? request, usage.mode),
  };
  return { review: next, entries: [localEntry, modelEntry], mode, sent: unique.length };
}
