"use client";

import jsQR from "jsqr";
import { callTwin } from "@/lib/llm";
import { compressForVision, enhanceForOcr, loadImage, toCanvas } from "./image";
import { runOcr } from "./ocr";
import { parseQrBill, qrBillToExtraction } from "./qrBill";
import { heuristicExtract } from "./heuristics";
import type { Extraction, PipelineStep, SnapResult } from "./types";

/** Below this Tesseract confidence (0–100) we stop trusting local OCR and escalate to vision. */
export const OCR_CONFIDENCE_THRESHOLD = 65;

const now = () => performance.now();

/**
 * The frugal cascade:
 *   Tier 0 – Swiss QR-bill decoded locally          → 0 tokens
 *   Tier 1 – local OCR → compressed text → small LLM → ~100 tokens
 *   Tier 2 – low OCR confidence → 512px gray JPEG → small VLM
 */
export async function runSnap(src: Blob | string): Promise<SnapResult> {
  const steps: PipelineStep[] = [];
  let t = now();
  const img = await loadImage(src);
  const imageSize = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  const base = toCanvas(img, 1600);
  steps.push({ name: "Decode + resize", ms: now() - t, detail: `${imageSize.width}×${imageSize.height} → ${base.width}×${base.height}` });

  // ---------- Tier 0: Swiss QR-bill ----------
  t = now();
  const small = toCanvas(img, 1000);
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  const pixels = ctx.getImageData(0, 0, small.width, small.height);
  const qr = jsQR(pixels.data, small.width, small.height, { inversionAttempts: "attemptBoth" });
  const bill = qr ? parseQrBill(qr.data) : null;
  steps.push({ name: "QR-bill scan", ms: now() - t, detail: bill ? "Swiss QR-bill found" : qr ? "QR found, not a QR-bill" : "no QR code" });
  if (bill) {
    return {
      tier: 0,
      extraction: qrBillToExtraction(bill),
      steps,
      usage: { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "jsQR (local)", mode: "local" },
      payload: { sentToCloud: null, decodedLocally: bill },
      imageSize,
    };
  }

  // ---------- Tier 1: local OCR ----------
  t = now();
  const enhanced = enhanceForOcr(base);
  steps.push({ name: "Grayscale + contrast", ms: now() - t });
  t = now();
  const ocr = await runOcr(enhanced);
  steps.push({
    name: "Local OCR (Tesseract)",
    ms: now() - t,
    detail: `confidence ${Math.round(ocr.confidence)}% · kept ${ocr.keptLines}/${ocr.totalLines} lines · ${ocr.compact.length} chars`,
  });

  const trustOcr = ocr.confidence >= OCR_CONFIDENCE_THRESHOLD && ocr.compact.length >= 20;
  if (trustOcr) {
    t = now();
    const r = await callTwin<Extraction>({ task: "extract_text", text: ocr.compact });
    if (r.ok && r.data) {
      steps.push({ name: "Small LLM → JSON", ms: r.ms ?? now() - t, detail: r.usage?.model });
      return {
        tier: 1,
        extraction: normalise(r.data),
        steps,
        usage: { ...r.usage!, mode: "llm" },
        payload: r.request,
        ocrConfidence: ocr.confidence,
        imageSize,
      };
    }
    steps.push({ name: "Local heuristics", ms: now() - t, detail: r.offline ? "no API key — offline mode" : r.error });
    return {
      tier: 1,
      extraction: heuristicExtract(ocr.compact),
      steps,
      usage: { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "regex (local)", mode: r.offline ? "offline" : "local" },
      payload: { wouldSend: { task: "extract_text", text: ocr.compact } },
      ocrConfidence: ocr.confidence,
      imageSize,
    };
  }

  // ---------- Tier 2: escalate a tiny image ----------
  t = now();
  const vision = compressForVision(base);
  steps.push({ name: "Escalate: 512px gray JPEG", ms: now() - t, detail: `${vision.width}×${vision.height} · ${Math.round(vision.bytes / 1024)} KB` });
  t = now();
  const r = await callTwin<Extraction>({ task: "extract_image", image: vision.dataUrl });
  if (r.ok && r.data) {
    steps.push({ name: "Small VLM → JSON", ms: r.ms ?? now() - t, detail: r.usage?.model });
    return {
      tier: 2,
      extraction: normalise(r.data),
      steps,
      usage: { ...r.usage!, mode: "llm" },
      payload: r.request,
      ocrConfidence: ocr.confidence,
      imageSize,
      preview: vision.dataUrl,
    };
  }
  steps.push({ name: "Local heuristics", ms: now() - t, detail: r.offline ? "no API key — offline mode" : r.error });
  return {
    tier: 2,
    extraction: heuristicExtract(ocr.rawText),
    steps,
    usage: { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "regex (local)", mode: r.offline ? "offline" : "local" },
    payload: { wouldSend: { task: "extract_image", image: `${vision.dataUrl.slice(0, 40)}…(${Math.round(vision.bytes / 1024)} KB)` } },
    ocrConfidence: ocr.confidence,
    imageSize,
    preview: vision.dataUrl,
  };
}

function normalise(e: Extraction): Extraction {
  const out = { ...e };
  if (typeof out.amount === "string") out.amount = Number(String(out.amount).replace(/[^\d.]/g, ""));
  if (typeof out.rooms === "string") out.rooms = Number(out.rooms);
  if (typeof out.year === "string") out.year = Number(out.year);
  return out;
}
