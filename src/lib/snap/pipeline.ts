"use client";

import jsQR from "jsqr";
import { callTwin, type LlmResponse } from "@/lib/llm";
import { compressForVision, cropToInk, enhanceForOcr, imageFingerprint, jpegBytes, loadImage, toCanvas } from "./image";
import type { OcrResult } from "./ocr";
import { parseQrBill, qrBillToExtraction } from "./qrBill";
import { heuristicExtract } from "./heuristics";
import { DOC_KINDS, extractionStatus, isAmount, type Extraction, type PipelineStep, type SnapResult, type Usage } from "./types";

export const OCR_CONFIDENCE_THRESHOLD = 65;
const CACHE_KEY = "doppel:snap-cache:v1";
const FORCE_LLM_KEY = "doppel:force-llm";
const LOCAL_USAGE: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0, model: "Local", mode: "local" };
const utf8 = (text: string) => new TextEncoder().encode(text).length;

interface CacheEntry {
  hash: string;
  signature: string;
  tier: SnapResult["tier"];
  extraction: Extraction;
}

interface SnapOptions {
  forceLlm?: boolean;
  onProgress?: (message: string) => void;
}

type Details = Partial<Pick<SnapResult, "payload" | "usage" | "usageKnown" | "ocrConfidence" | "preview">>;

function readCache(): CacheEntry[] {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]");
    return Array.isArray(cache) ? cache.filter((entry): entry is CacheEntry =>
      entry && typeof entry.hash === "string" && typeof entry.signature === "string" && [0, 1, 2].includes(entry.tier)
      && DOC_KINDS.includes(entry.extraction?.kind) && entry.extraction.kind !== "other" && isAmount(entry.extraction.amount)) : [];
  } catch {
    return [];
  }
}

function forceFromStorage() {
  try {
    return localStorage.getItem(FORCE_LLM_KEY) === "1";
  } catch {
    return false;
  }
}

function findQrBill(img: HTMLImageElement, steps: PipelineStep[]) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const halfY = Math.floor(h / 2);
  const halfX = Math.floor(w / 2);
  const scans = [
    { name: "Full image", max: 1000 },
    { name: "Bottom half", max: 1700, crop: { x: 0, y: halfY, width: w, height: h - halfY } },
    { name: "Bottom right", max: 1700, crop: { x: halfX, y: halfY, width: w - halfX, height: h - halfY } },
    { name: "Full resolution", max: 2000 },
  ] as const;
  for (const scan of scans) {
    const start = performance.now();
    const canvas = toCanvas(img, scan.max, "crop" in scan ? scan.crop : undefined);
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const qr = jsQR(pixels.data, canvas.width, canvas.height, {
      inversionAttempts: scan.max === 2000 ? "attemptBoth" : "dontInvert",
    });
    const bill = qr ? parseQrBill(qr.data) : null;
    const result = bill ? "Swiss QR-bill" : qr ? "Different QR format" : "No QR code";
    steps.push({ name: `QR scan · ${scan.name}`, ms: performance.now() - start,
      bytes: pixels.data.byteLength, detail: `${canvas.width}×${canvas.height} · ${result}` });
    if (bill) return bill;
  }
  return null;
}

function offlineExtraction(text: string): Extraction {
  if (!/[\p{L}\p{N}]{2}/u.test(text)) return { kind: "other" };
  if (looksLikePayslip(text)) {
    // The generic receipt pattern also matches "Total Abzüge" on Swiss payslips.
    const net = /\b(?:nettolohn|net pay|salaire net)\b[^\d\n]{0,40}(\d[\d'’ .]*[.,]\d{2})/i.exec(text);
    return heuristicExtract(net ? `Nettolohn ${net[1]}` : "Nettolohn");
  }
  const result = heuristicExtract(text);
  if (result.kind === "note") {
    // A year or a duration on a note is weak evidence for a financial amount.
    const shorthand = /\b(\d+\s*k)\b/i.exec(text);
    const marked = /\b(?:chf|fr\.?|budget|cost|need|save|objectif|kosten)\s*[:≈=~]?\s*(\d[\d'’.,]*(?: \d{3})*(?:[.,]\d{2})?)/i.exec(text);
    const standalone = /^\s*(\d{5,}|\d{1,3}(?:['’ ]\d{3})+(?:[.,]\d{2})?)\s*$/m.exec(text);
    const amountText = shorthand?.[1] ?? marked?.[1] ?? standalone?.[1];
    const amount = amountText ? heuristicExtract(amountText).amount : undefined;
    return { ...result, amount: isAmount(amount) ? amount : undefined };
  }
  return isAmount(result.amount) ? result : { ...result, amount: undefined };
}

function looksLikePayslip(text: string): boolean {
  return /\b(?:lohnabrechnung|nettolohn|payslip|net pay|fiche de paie|salaire net)\b/i.test(text);
}

function extractionRank(e: Extraction): number {
  if (e.kind === "other") return 0;
  return (e.kind === "note" ? 1 : 2) + 3 * Number(isAmount(e.amount));
}

function bestLocal(ocr: OcrResult): Extraction {
  const raw = offlineExtraction(ocr.rawText);
  const compact = offlineExtraction(ocr.compact);
  if (raw.kind === "payslip" && compact.kind !== "payslip") return raw;
  if (compact.kind === "payslip" && raw.kind !== "payslip") return compact;
  return extractionRank(compact) > extractionRank(raw) ? compact : raw;
}

function ocrStep(ocr: OcrResult, name: string, ms: number): PipelineStep {
  return {
    name, ms, bytes: utf8(ocr.compact),
    detail: `${Math.round(ocr.confidence)}% confidence · ${ocr.keptLines}/${ocr.totalLines} lines · ${ocr.compact.length} chars`,
  };
}

export async function runSnap(src: Blob | string, { forceLlm = forceFromStorage(), onProgress }: SnapOptions = {}): Promise<SnapResult> {
  const steps: PipelineStep[] = [];
  let start = performance.now();
  onProgress?.("Decoding image…");
  const img = await loadImage(src);
  const imageSize = { width: img.naturalWidth, height: img.naturalHeight };
  steps.push({ name: "Decode image", ms: performance.now() - start, detail: `${imageSize.width}×${imageSize.height}`,
    ...(typeof src === "string" ? {} : { bytes: src.size }) });

  start = performance.now();
  const naiveImage = toCanvas(img, 2048).toDataURL("image/jpeg", 0.85);
  steps.push({ name: "Prepare comparison image locally", ms: performance.now() - start, bytes: jpegBytes(naiveImage) });

  start = performance.now();
  const fingerprint = imageFingerprint(img);
  const cache = readCache();
  const cached = forceLlm ? undefined : cache.find(({ hash, signature }) => hash === fingerprint.hash && signature === fingerprint.signature);
  steps.push({ name: "Image cache", ms: performance.now() - start, detail: forceLlm ? "Bypassed for comparison" : cached ? "Repeat image · 0 tokens" : "New image" });

  function finish(tier: SnapResult["tier"], route: SnapResult["route"], extraction: Extraction, details: Details = {}): SnapResult {
    const status = extractionStatus(extraction);
    if (route !== "cache" && status.outcome === "ok") {
      try {
        const rest = readCache().filter((entry) => entry.hash !== fingerprint.hash || entry.signature !== fingerprint.signature);
        localStorage.setItem(CACHE_KEY, JSON.stringify([{ ...fingerprint, tier, extraction }, ...rest.slice(0, 31)]));
      } catch {
        // The cascade still works when storage is unavailable.
      }
    }
    return { tier, route, extraction, ...status, steps, imageSize, naiveImage,
      usage: LOCAL_USAGE, usageKnown: true, payload: { sentToCloud: null }, ...details };
  }
  if (cached) return finish(cached.tier, "cache", cached.extraction);

  onProgress?.("Checking for a Swiss QR-bill…");
  const bill = findQrBill(img, steps);
  if (bill) {
    return finish(0, "qr", qrBillToExtraction(bill), {
      usage: { ...LOCAL_USAGE, model: "jsQR (local)" },
      payload: { sentToCloud: null, decodedLocally: bill },
    });
  }

  start = performance.now();
  const base = toCanvas(img, 1600);
  const cropped = cropToInk(base);
  steps.push({ name: "Crop to ink", ms: performance.now() - start, bytes: cropped.width * cropped.height * 4,
    detail: `${base.width}×${base.height} → ${cropped.width}×${cropped.height}` });
  start = performance.now();
  const enhanced = enhanceForOcr(cropped);
  steps.push({ name: "Grayscale and stretch contrast", ms: performance.now() - start });

  let ocr: OcrResult | undefined;
  let runOcr: typeof import("./ocr").runOcr | undefined;
  start = performance.now();
  try {
    ({ runOcr } = await import("./ocr"));
    ocr = await runOcr(enhanced, onProgress);
    steps.push(ocrStep(ocr, "Local OCR", performance.now() - start));
  } catch (error) {
    steps.push({ name: "Local OCR failed", ms: performance.now() - start,
      detail: error instanceof Error ? error.message : "Worker unavailable" });
  }

  if (ocr && ocr.confidence >= OCR_CONFIDENCE_THRESHOLD) {
    const { confidence } = ocr;
    const text = ocr.compact || ocr.rawText.trim().slice(0, 600);
    start = performance.now();
    const local = heuristicExtract(text);
    const extraField = local.merchant || local.rooms || local.location || local.date;
    if (!forceLlm && confidence >= 80 && local.kind !== "other" && isAmount(local.amount) && extraField
      && (local.kind !== "receipt" || !looksLikePayslip(ocr.rawText))) {
      steps.push({ name: "Local regex", ms: performance.now() - start, bytes: utf8(text), detail: "Accepted amount and supporting field · 0 tokens" });
      return finish(1, "local-regex", local, { usage: { ...LOCAL_USAGE, model: "Regex (local)" }, ocrConfidence: confidence });
    }
    steps.push({ name: "Local regex check", ms: performance.now() - start,
      detail: forceLlm ? "Bypassed for comparison" : "Confidence or extracted fields below the local acceptance threshold" });

    if (!text) return finish(1, "offline-heuristic", { kind: "other" }, { ocrConfidence: confidence });
    onProgress?.("Extracting from compact text…");
    start = performance.now();
    const response = await callTwin<Extraction>({ task: "extract_text", text });
    const details = gatewayDetails(response, steps, "Small text LLM", start, utf8(text), { wouldSend: { task: "extract_text", text } });
    if (response.ok && response.data) return finish(1, "text-llm", response.data, { ...details, ocrConfidence: confidence });
    start = performance.now();
    const extraction = bestLocal(ocr);
    steps.push({ name: "Local heuristic fallback", ms: performance.now() - start });
    return finish(1, "offline-heuristic", extraction, { ...details, ocrConfidence: confidence });
  }

  start = performance.now();
  const vision = compressForVision(cropped);
  steps.push({ name: "Compress for vision", ms: performance.now() - start, bytes: vision.bytes,
    detail: `${vision.width}×${vision.height} grayscale JPEG` });
  onProgress?.("Trying a small vision model…");
  start = performance.now();
  const response = await callTwin<Extraction>({ task: "extract_image", image: vision.dataUrl });
  const details = gatewayDetails(response, steps, "Small vision LLM", start, vision.bytes,
    { wouldSend: { task: "extract_image", image: `JPEG · ${vision.bytes} bytes` } });
  details.preview = vision.dataUrl;
  details.ocrConfidence = ocr?.confidence;
  if (response.ok && response.data) return finish(2, "vision-llm", response.data, details);

  start = performance.now();
  let extraction: Extraction = ocr ? bestLocal(ocr) : { kind: "other" };
  steps.push({ name: "Local heuristic fallback", ms: performance.now() - start });
  if (ocr && runOcr && extractionStatus(extraction).outcome !== "ok") {
    start = performance.now();
    try {
      const raw = await runOcr(cropped, onProgress, true);
      const candidate = bestLocal(raw);
      steps.push(ocrStep(raw, "OCR retry on unenhanced crop", performance.now() - start));
      const rank = extractionRank(candidate) - extractionRank(extraction);
      if (rank > 0 || (rank === 0 && raw.confidence > ocr.confidence)) extraction = candidate;
    } catch (error) {
      steps.push({ name: "OCR retry failed", ms: performance.now() - start,
        detail: error instanceof Error ? error.message : "Worker unavailable" });
    }
  }
  return finish(2, "offline-heuristic", extraction, details);
}

function gatewayDetails(response: LlmResponse<Extraction>, steps: PipelineStep[], name: string, start: number, bytes: number, wouldSend: unknown): Details {
  const usageKnown = response.usageKnown ?? Boolean(response.usage || response.offline);
  steps.push({ name, ms: performance.now() - start, bytes, detail: response.offline ? "No API key · no provider call" : response.error ?? response.usage?.model });
  return {
    usage: response.usage ? { ...response.usage, mode: "llm" as const } :
      { ...LOCAL_USAGE, model: usageKnown ? "Regex (local)" : "Provider usage unavailable", mode: response.offline ? "offline" : usageKnown ? "local" : "llm" },
    usageKnown,
    payload: response.request ?? wouldSend,
  };
}
