import { msg, type Text } from "@/lib/i18n/types";
import type { NaiveEstimate } from "./tokens";
import { estimateEnergyWh, naiveReasoning, naiveSnap } from "./tokens";
import type { DocKind, PipelineStep, SnapResult, Tier, Usage } from "@/lib/snap/types";

export type SnapOutcome = "ok" | "partial" | "failed";
export type SnapRoute = "qr" | "cache" | "local-regex" | "text-llm" | "vision-llm" | "offline-heuristic";
export type LedgerRoute = SnapRoute | "local-parser" | "offline-template";

/**
 * Forward-compatible view of SnapResult covering fields added by the pipeline upgrade.
 * Keeps this module compiling cleanly both before and after branch integration.
 */
export type SnapResultX = SnapResult &
  Partial<{
    outcome: SnapOutcome;
    route: SnapRoute;
    usageKnown: boolean;
    naiveImage: string;
    fieldsMissing: string[];
  }>;

/** Result of a live GPT-4o comparison run from the Inspector. */
export interface NaiveComparison {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  ms: number;
  extractedAmount?: number;
  extractedKind?: string;
  amountMatches: boolean | null;
  rawData?: unknown;
}

export interface LedgerEntry {
  id: string;
  at: number;
  kind: "snap" | "command" | "narrate";
  title: Text;
  tier: Tier | "local-parser" | "llm";
  ms: number;
  usage: Usage;
  naive: NaiveEstimate;
  payload: unknown;
  steps?: PipelineStep[];
  preview?: string;
  // Extended accounting fields (optional so inline callers remain compatible)
  route?: LedgerRoute;
  outcome?: SnapOutcome;
  usageKnown?: boolean;
  bytesSent?: number;
  naiveImage?: string;
  fieldsMissing?: string[];
  extractedAmount?: number;
  extractedKind?: DocKind;
  imageSize?: { width: number; height: number };
}

export type ExclusionReason = "offline" | "failed" | "usage-unknown";

export interface LedgerTotals {
  /** Measured Doppel tokens across included (successful, non-offline, known-usage) entries. */
  ours: number;
  /** Baseline tokens (live GPT-4o where compared, else estimated) across included entries. */
  naive: number;
  /** Measured Doppel cost (USD) across included entries. */
  oursCost: number;
  /** Baseline cost (USD) across included entries. */
  naiveCost: number;
  /** Token savings fraction (0..1) over included entries (0 when none included). Kept for compatibility. */
  saved: number;
  /** Token savings fraction (0..1), or null if no included entries exist. */
  tokenSavedPct: number | null;
  /** Cost savings fraction (0..1), or null if no included entries or naiveCost === 0. */
  costSavedPct: number | null;
  measuredCount: number;
  excludedCount: number;
  offlineCount: number;
  failedCount: number;
  unknownUsageCount: number;
  partialCount: number;
  liveNaiveCount: number;
  /** Measured snap-only aggregates for per-1,000-snap unit economics. */
  snapCount: number;
  snapOursCost: number;
  snapNaiveCost: number;
  snapOursTokens: number;
  snapNaiveTokens: number;
  /** Rough order-of-magnitude energy estimates (Wh) across included entries. */
  oursWh: number;
  naiveWh: number;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function resolveRoute(e: Pick<LedgerEntry, "kind" | "tier" | "usage" | "route">): LedgerRoute {
  if (e.route) return e.route;
  if (e.kind === "command") {
    if (e.tier === "local-parser") return "local-parser";
    return e.usage.mode === "offline" ? "offline-heuristic" : "text-llm";
  }
  if (e.kind === "narrate") {
    return e.usage.mode === "offline" ? "offline-template" : "text-llm";
  }
  if (e.usage.mode === "offline") return "offline-heuristic";
  if (e.tier === 0) return "qr";
  if (e.tier === 1) return e.usage.mode === "local" ? "local-regex" : "text-llm";
  return e.usage.mode === "local" ? "local-regex" : "vision-llm";
}

export function resolveOutcome(e: Pick<LedgerEntry, "outcome">): SnapOutcome {
  return e.outcome ?? "ok";
}

export function resolveUsageKnown(e: Pick<LedgerEntry, "usage" | "usageKnown">): boolean {
  if (typeof e.usageKnown === "boolean") return e.usageKnown;
  if (e.usage.mode === "local") return true;
  if (e.usage.mode === "offline") return false;
  return e.usage.promptTokens + e.usage.completionTokens > 0;
}

/**
 * Returns why an entry is excluded from headline savings, or null if it counts.
 * Offline fallbacks, failed extractions, and LLM calls with missing usage are never
 * allowed to inflate the "−X% saved" figure.
 */
export function exclusionReason(e: LedgerEntry): ExclusionReason | null {
  if (e.usage.mode === "offline") return "offline";
  if (resolveOutcome(e) === "failed") return "failed";
  if (!resolveUsageKnown(e)) return "usage-unknown";
  return null;
}

/** Approximate bytes that actually left the browser (0 for any local or offline execution). */
export function estimateBytesSent(payload: unknown, mode: Usage["mode"], preview?: string): number {
  if (mode !== "llm") return 0;
  let jsonStr = "";
  try {
    jsonStr = JSON.stringify(payload ?? {});
  } catch {
    jsonStr = "";
  }
  let bytes = new TextEncoder().encode(jsonStr).length;
  // /api/twin redacts base64 image data as "...(NN KB)" for display; add back the actual compressed image bytes.
  if (preview && preview.startsWith("data:image/")) {
    const comma = preview.indexOf(",");
    if (comma > 0) {
      const imgBytes = Math.round((preview.length - comma - 1) * 0.75);
      bytes += imgBytes;
    }
  }
  return bytes;
}

/** Build a ledger entry from a snap cascade result using the actual image dimensions. */
export function entryFromSnap(name: Text, r: SnapResult): LedgerEntry {
  const rx = r as SnapResultX;
  const route: SnapRoute =
    rx.route ??
    (r.usage.mode === "offline"
      ? "offline-heuristic"
      : r.tier === 0
        ? "qr"
        : r.tier === 1
          ? r.usage.mode === "local"
            ? "local-regex"
            : "text-llm"
          : r.usage.mode === "local"
            ? "local-regex"
            : "vision-llm");

  const inferredOutcome: SnapOutcome =
    r.extraction.kind === "other" && (r.extraction.amount == null || !Number.isFinite(r.extraction.amount))
      ? "failed"
      : r.extraction.amount == null || !Number.isFinite(r.extraction.amount)
        ? "partial"
        : "ok";
  const outcome: SnapOutcome = rx.outcome ?? inferredOutcome;

  const usageKnown: boolean =
    typeof rx.usageKnown === "boolean"
      ? rx.usageKnown
      : r.usage.mode === "local"
        ? true
        : r.usage.mode === "llm"
          ? r.usage.promptTokens + r.usage.completionTokens > 0
          : false;

  const ms = r.steps.reduce((s, x) => s + x.ms, 0);
  const w = r.imageSize?.width || 512;
  const h = r.imageSize?.height || 512;

  return {
    id: nextId("snap"),
    at: Date.now(),
    kind: "snap",
    title: msg("ledger.snap", { name }),
    tier: r.tier,
    ms,
    usage: r.usage,
    naive: naiveSnap(w, h),
    payload: r.payload,
    steps: r.steps,
    preview: r.preview,
    route,
    outcome,
    usageKnown,
    bytesSent: estimateBytesSent(r.payload, r.usage.mode, r.preview),
    naiveImage: rx.naiveImage,
    fieldsMissing: rx.fieldsMissing,
    extractedAmount: r.extraction.amount,
    extractedKind: r.extraction.kind,
    imageSize: r.imageSize,
  };
}

/** Build a ledger entry from a what-if command (local parser or small LLM). */
export function entryFromCommand(a: {
  text: string;
  tier: "local-parser" | "llm";
  usage: Usage;
  payload: unknown;
  ms: number;
  stateChars: number;
  usageKnown?: boolean;
  outcome?: SnapOutcome;
}): LedgerEntry {
  const route: LedgerRoute =
    a.tier === "local-parser" ? "local-parser" : a.usage.mode === "offline" ? "offline-heuristic" : "text-llm";
  const usageKnown =
    typeof a.usageKnown === "boolean"
      ? a.usageKnown
      : a.usage.mode === "local"
        ? true
        : a.usage.mode === "llm"
          ? a.usage.promptTokens + a.usage.completionTokens > 0
          : false;

  return {
    id: nextId("cmd"),
    at: Date.now(),
    kind: "command",
    title: msg("ledger.command", { text: a.text }),
    tier: a.tier,
    ms: a.ms,
    usage: a.usage,
    naive: naiveReasoning(a.stateChars, 350),
    payload: a.payload,
    route,
    outcome: a.outcome ?? "ok",
    usageKnown,
    bytesSent: estimateBytesSent(a.payload, a.usage.mode),
  };
}

/** Build a ledger entry from a private-banker narration call. */
export function entryFromNarrate(a: {
  usage: Usage;
  payload: unknown;
  ms: number;
  stateChars: number;
  usageKnown?: boolean;
  outcome?: SnapOutcome;
}): LedgerEntry {
  const route: LedgerRoute = a.usage.mode === "offline" ? "offline-template" : "text-llm";
  const usageKnown =
    typeof a.usageKnown === "boolean"
      ? a.usageKnown
      : a.usage.mode === "llm"
        ? a.usage.promptTokens + a.usage.completionTokens > 0
        : false;

  return {
    id: nextId("nar"),
    at: Date.now(),
    kind: "narrate",
    title: msg("ledger.narrate"),
    tier: "llm",
    ms: a.ms,
    usage: a.usage,
    naive: naiveReasoning(a.stateChars, 220),
    payload: a.payload,
    route,
    outcome: a.outcome ?? "ok",
    usageKnown,
    bytesSent: estimateBytesSent(a.payload, a.usage.mode),
  };
}

/**
 * Aggregate ledger totals.
 * Savings % (both tokens and cost) are computed strictly over measured, non-offline, non-failed entries.
 * If live GPT-4o comparisons exist in `comparisons`, their measured tokens/cost replace the estimates.
 */
export function totals(entries: LedgerEntry[], comparisons?: Record<string, NaiveComparison>): LedgerTotals {
  let ours = 0;
  let naive = 0;
  let oursCost = 0;
  let naiveCost = 0;
  let measuredCount = 0;
  let offlineCount = 0;
  let failedCount = 0;
  let unknownUsageCount = 0;
  let partialCount = 0;
  let liveNaiveCount = 0;
  let snapCount = 0;
  let snapOursCost = 0;
  let snapNaiveCost = 0;
  let snapOursTokens = 0;
  let snapNaiveTokens = 0;
  let oursWh = 0;
  let naiveWh = 0;

  for (const e of entries) {
    const reason = exclusionReason(e);
    if (reason) {
      if (reason === "offline") offlineCount += 1;
      else if (reason === "failed") failedCount += 1;
      else if (reason === "usage-unknown") unknownUsageCount += 1;
      continue;
    }

    measuredCount += 1;
    if (resolveOutcome(e) === "partial") partialCount += 1;

    const eOurs = e.usage.promptTokens + e.usage.completionTokens;
    const live = comparisons?.[e.id];
    const eNaive = live ? live.promptTokens + live.completionTokens : e.naive.promptTokens + e.naive.completionTokens;
    const eNaiveCost = live ? live.costUsd : e.naive.costUsd;
    if (live) liveNaiveCount += 1;

    ours += eOurs;
    naive += eNaive;
    oursCost += e.usage.costUsd;
    naiveCost += eNaiveCost;

    const localPass = e.usage.mode === "local";
    oursWh += estimateEnergyWh(eOurs, localPass ? "local" : "small");
    naiveWh += estimateEnergyWh(eNaive, "frontier");

    if (e.kind === "snap") {
      snapCount += 1;
      snapOursCost += e.usage.costUsd;
      snapNaiveCost += eNaiveCost;
      snapOursTokens += eOurs;
      snapNaiveTokens += eNaive;
    }
  }

  const excludedCount = offlineCount + failedCount + unknownUsageCount;
  const tokenSavedPct = measuredCount > 0 && naive > 0 ? 1 - ours / naive : null;
  const costSavedPct = measuredCount > 0 && naiveCost > 0 ? 1 - oursCost / naiveCost : null;

  return {
    ours,
    naive,
    oursCost,
    naiveCost,
    saved: tokenSavedPct ?? 0,
    tokenSavedPct,
    costSavedPct,
    measuredCount,
    excludedCount,
    offlineCount,
    failedCount,
    unknownUsageCount,
    partialCount,
    liveNaiveCount,
    snapCount,
    snapOursCost,
    snapNaiveCost,
    snapOursTokens,
    snapNaiveTokens,
    oursWh,
    naiveWh,
  };
}
