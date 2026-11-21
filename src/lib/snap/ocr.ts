"use client";

import { msg, type Msg } from "@/lib/i18n/types";
import type { LoggerMessage, RecognizeOptions, Worker } from "tesseract.js";

const INIT_MS = 12_000;
const RECOGNIZE_MS = 8_000;
let workerPromise: Promise<Worker> | null = null;
let queue = Promise.resolve();
let report: ((message: Msg) => void) | undefined;

async function withDeadline<T>(work: Promise<T>, ms: number, detail: Msg): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(detail.key, { cause: detail })), ms)));
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function getOcrWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;

  let abandoned = false;
  let loading = 0;
  report?.(msg("progress.ocrLoading", { p: 0 }));
  const ranges: Record<string, [number, number]> = {
    "loading tesseract core": [0, 25],
    "initializing tesseract": [25, 35],
    "loading language traineddata": [35, 85],
    "initializing api": [85, 100],
  };
  const logger = ({ status, progress }: LoggerMessage) => {
    if (abandoned) return;
    if (status === "recognizing text") {
      report?.(msg("progress.ocrReading", { p: progress }));
      return;
    }
    const range = ranges[status];
    if (range) {
      loading = Math.max(loading, Math.round(range[0] + progress * (range[1] - range[0])));
      report?.(msg("progress.ocrLoading", { p: loading / 100 }));
    }
  };

  let initError: (reason: Error) => void;
  const initFailed = new Promise<never>((_, reject) => { initError = reject; });
  const starting = import("tesseract.js").then(async ({ createWorker, OEM }) => {
    if (abandoned) throw new Error("step.ocrInitCanceled", { cause: msg("step.ocrInitCanceled") });
    const worker = await createWorker(["eng", "deu", "fra"], OEM.LSTM_ONLY, {
      workerPath: "/tesseract/runtime/worker.min.js",
      corePath: "/tesseract/runtime",
      langPath: "/tesseract",
      workerBlobURL: false,
      cachePath: "doppel-tessdata-fast-4.1.0",
      logger,
      errorHandler: () => initError(new Error("step.ocrInitFailed", { cause: msg("step.ocrInitFailed") })),
    });
    if (abandoned) await worker.terminate();
    return worker;
  });
  workerPromise = withDeadline(Promise.race([starting, initFailed]), INIT_MS, msg("step.ocrInitTimeout")).catch((error) => {
    abandoned = true;
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

export interface OcrResult {
  confidence: number;
  rawText: string;
  /** Cleaned, compressed text: only confident, information-bearing lines. */
  compact: string;
  keptLines: number;
  totalLines: number;
}

const NOISE = /^[\W_]{0,3}$/;
const AMOUNT_CUE = /\b(?:chf[\s:]*\d|\d+\s*k\b)|\b(?:nettolohn|net pay|salaire net|total|summe|kaufpreis)\b[^\n]*\d/i;

export function runOcr(canvas: HTMLCanvasElement, progress?: (message: Msg) => void, sparse = false): Promise<OcrResult> {
  const work = queue.then(async () => {
    report = progress;
    try {
      const worker = await getOcrWorker();
      report?.(msg("progress.ocrReading", { p: 0 }));
      try {
        // The worker accepts Tesseract variables here, which its TS declaration omits.
        const options: Partial<RecognizeOptions> & { tessedit_pageseg_mode?: string } = sparse ? { tessedit_pageseg_mode: "11" } : {};
        const { data } = await withDeadline(
          worker.recognize(canvas, options, { text: true, blocks: true }),
          RECOGNIZE_MS,
          msg("step.ocrRecognitionTimeout"),
        );
        return compactOcr(data);
      } catch (error) {
        workerPromise = null;
        await worker.terminate();
        throw error;
      }
    } finally {
      report = undefined;
    }
  });
  queue = work.then(() => undefined, () => undefined);
  return work;
}

function compactOcr(data: Awaited<ReturnType<Worker["recognize"]>>["data"]): OcrResult {
  const lines: { text: string; confidence: number }[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) lines.push({ text: l.text.trim(), confidence: l.confidence });
    }
  }
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const l of lines) {
    const t = l.text.replace(/\s+/g, " ").trim();
    if (l.confidence < 45 || NOISE.test(t) || t.length < 3) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(t);
  }
  const compact = kept.slice(0, 24).join("\n").slice(0, 600);
  // A page average can hide a poorly read amount among clear headings and footers.
  const confidence = lines.reduce((min, line) =>
    AMOUNT_CUE.test(line.text) ? Math.min(min, line.confidence) : min, Math.max(0, data.confidence));
  return { confidence, rawText: data.text, compact, keptLines: compact ? compact.split("\n").length : 0, totalLines: lines.length };
}
