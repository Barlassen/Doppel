"use client";

import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

/** Lazily creates one Tesseract worker (eng+deu) and keeps it warm for the whole session. */
export function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(({ createWorker }) => createWorker(["eng", "deu"]));
  }
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

export async function runOcr(canvas: HTMLCanvasElement): Promise<OcrResult> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
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
  let compact = kept.slice(0, 24).join("\n");
  if (compact.length > 600) compact = compact.slice(0, 600);
  return { confidence: data.confidence, rawText: data.text, compact, keptLines: kept.length, totalLines: lines.length };
}
