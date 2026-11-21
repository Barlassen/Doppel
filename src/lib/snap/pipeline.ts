"use client";

import jsQR from "jsqr";
import { isMsg, msg, type Msg, type Text } from "@/lib/i18n";
import { callTwin, type LlmResponse } from "@/lib/llm";
import { compressForVision, cropToInk, enhanceForOcr, imageFingerprint, jpegBytes, loadImage, toCanvas } from "./image";
import type { OcrResult } from "./ocr";
import { parseQrBill, qrBillToExtraction } from "./qrBill";
import { heuristicExtract } from "./heuristics";
import { hasReadableReceiptItems, canAcceptLocalReceipt, receiptExtractionStatus, receiptModelText, receiptSum, validatedReceiptItems } from "./receipt";
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
  onProgress?: (message: Msg) => void;
}

type Details = Partial<Pick<SnapResult, "payload" | "usage" | "usageKnown" | "ocrConfidence" | "preview" | "visionReason" | "cropSize">>;

function readCache(): CacheEntry[] {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]");
    return Array.isArray(cache) ? cache.filter((entry): entry is CacheEntry =>
      entry && typeof entry.hash === "string" && typeof entry.signature === "string" && [0, 1, 2].includes(entry.tier)
      && DOC_KINDS.includes(entry.extraction?.kind)
      && ((entry.extraction.kind !== "other" && isAmount(entry.extraction.amount)) || entry.extraction.vision?.kind === "chart")
      && (entry.extraction.kind !== "receipt" || (validatedReceiptItems(entry.extraction.items)
        && receiptExtractionStatus(entry.extraction).outcome === "ok"))) : [];
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
    { name: msg("step.areaFull"), max: 1000 },
    { name: msg("step.areaBottom"), max: 1700, crop: { x: 0, y: halfY, width: w, height: h - halfY } },
    { name: msg("step.areaBottomRight"), max: 1700, crop: { x: halfX, y: halfY, width: w - halfX, height: h - halfY } },
    { name: msg("step.areaFullRes"), max: 2000 },
  ] as const;
  for (const scan of scans) {
    const start = performance.now();
    const canvas = toCanvas(img, scan.max, "crop" in scan ? scan.crop : undefined);
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const qr = jsQR(pixels.data, canvas.width, canvas.height, {
      inversionAttempts: scan.max === 2000 ? "attemptBoth" : "dontInvert",
    });
    const bill = qr ? parseQrBill(qr.data) : null;
    steps.push({
      name: msg("step.qrScan", { area: scan.name }),
      ms: performance.now() - start,
      bytes: pixels.data.byteLength,
      detail: msg(bill ? "step.qrFound" : qr ? "step.qrOther" : "step.qrNone", { size: `${canvas.width}×${canvas.height}`}),
    });
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
  if (raw.kind === "receipt") return raw;
  if (raw.kind === "payslip" && compact.kind !== "payslip") return raw;
  if (compact.kind === "payslip" && raw.kind !== "payslip") return compact;
  return extractionRank(compact) > extractionRank(raw) ? compact : raw;
}

function ocrStep(ocr: OcrResult, name: Msg, ms: number): PipelineStep {
  return {
    name, ms, bytes: utf8(ocr.compact),
    detail: msg("step.ocrDetail", { conf: ocr.confidence / 100, kept: ocr.keptLines, total: ocr.totalLines, chars: ocr.compact.length }),
  };
}

function ocrErrorDetail(error: unknown): Text {
  if (!(error instanceof Error)) return msg("step.workerUnavailable");
  return isMsg(error.cause) ? error.cause : error.message;
}

export async function runSnap(src: Blob | string, { forceLlm = forceFromStorage(), onProgress }: SnapOptions = {}): Promise<SnapResult> {
  const steps: PipelineStep[] = [];
  let start = performance.now();
  onProgress?.(msg("progress.decoding"));
  const img = await loadImage(src);
  const imageSize = { width: img.naturalWidth, height: img.naturalHeight };
  steps.push({ name: msg("step.decode"), ms: performance.now() - start, detail: `${imageSize.width}×${imageSize.height}`,
    ...(typeof src === "string" ? {} : { bytes: src.size }) });

  start = performance.now();
  const naiveImage = toCanvas(img, 2048).toDataURL("image/jpeg", 0.85);
  steps.push({ name: msg("step.prepareNaive"), ms: performance.now() - start, bytes: jpegBytes(naiveImage) });

  start = performance.now();
  const fingerprint = imageFingerprint(img);
  const cache = readCache();
  const cached = forceLlm ? undefined : cache.find(({ hash, signature }) => hash === fingerprint.hash && signature === fingerprint.signature);
  steps.push({ name: msg("step.cache"), ms: performance.now() - start, detail: msg(forceLlm ? "step.bypassed" : cached ? "step.cacheHit" : "step.cacheMiss") });

  function finish(tier: SnapResult["tier"], route: SnapResult["route"], extraction: Extraction, details: Details = {}): SnapResult {
    const status = receiptExtractionStatus(extraction);
    if (extraction.kind === "receipt" && extraction.items?.length && isAmount(extraction.amount)) {
      const start = performance.now();
      const { matches } = receiptSum(extraction.items, extraction.amount);
      steps.push({ name: msg("step.receiptCheck"), ms: performance.now() - start,
        detail: msg(matches ? "receipt.matched" : "receipt.mismatch") });
    }
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

  onProgress?.(msg("progress.qr"));
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
  steps.push({ name: msg("step.cropInk"), ms: performance.now() - start, bytes: cropped.width * cropped.height * 4,
    detail: `${base.width}×${base.height} → ${cropped.width}×${cropped.height}` });
  start = performance.now();
  const enhanced = enhanceForOcr(cropped);
  steps.push({ name: msg("step.enhance"), ms: performance.now() - start });

  let ocr: OcrResult | undefined;
  let runOcr: typeof import("./ocr").runOcr | undefined;
  start = performance.now();
  try {
    ({ runOcr } = await import("./ocr"));
    ocr = await runOcr(enhanced, onProgress);
    steps.push(ocrStep(ocr, msg("step.ocr"), performance.now() - start));
  } catch (error) {
    steps.push({ name: msg("step.ocrFailed"), ms: performance.now() - start,
      detail: ocrErrorDetail(error) });
  }

  // --- Vision document-type hook (floor plans & charts routed by structure, not OCR failure) ---
  const { tryVisionSnap } = await import("./vision");
  const visionResult = await tryVisionSnap(cropped, ocr, steps, onProgress);
  if (visionResult) {
    return finish(2, visionResult.route, visionResult.extraction, {
      usage: visionResult.usage,
      usageKnown: visionResult.usageKnown,
      payload: visionResult.payload,
      preview: visionResult.preview,
      ocrConfidence: ocr?.confidence,
      visionReason: visionResult.visionReason,
      cropSize: visionResult.cropSize,
    });
  }

  start = performance.now();
  const rawLocal = ocr ? heuristicExtract(ocr.rawText) : undefined;
  const receipt = ocr && rawLocal?.kind === "receipt" && !looksLikePayslip(ocr.rawText) ? rawLocal : undefined;
  if (ocr && (ocr.confidence >= OCR_CONFIDENCE_THRESHOLD || (receipt && hasReadableReceiptItems(receipt)))) {
    const { confidence } = ocr;
    const text = receipt ? receiptModelText(ocr.rawText) : ocr.compact || ocr.rawText.trim().slice(0, 600);
    const local = receipt ?? heuristicExtract(text);
    const extraField = local.merchant || local.rooms || local.location || local.date;
    const canAccept = local.kind === "receipt"
      ? !looksLikePayslip(ocr.rawText) && canAcceptLocalReceipt(local, confidence)
      : confidence >= 80 && local.kind !== "other" && isAmount(local.amount) && extraField;
    if (!forceLlm && canAccept) {
      steps.push({ name: msg("step.regex"), ms: performance.now() - start, bytes: utf8(text), detail: msg("step.regexAccepted") });
      return finish(1, "local-regex", local, { usage: { ...LOCAL_USAGE, model: "Regex (local)" }, ocrConfidence: confidence });
    }
    steps.push({ name: msg("step.regexCheck"), ms: performance.now() - start,
      detail: msg(forceLlm ? "step.bypassed" : "step.regexRejected") });

    if (!text) return finish(1, "offline-heuristic", { kind: "other" }, { ocrConfidence: confidence });
    onProgress?.(msg("progress.extracting"));
    start = performance.now();
    const request = { task: "extract_text", text, ...(receipt ? { receipt: true } : {}) };
    const response = await callTwin<Extraction>(request);
    const details = gatewayDetails(response, steps, msg("step.textLlm"), start, utf8(text), { wouldSend: request });
    const tier = receipt || response.data?.kind === "receipt" ? 2 : 1;
    if (response.ok && response.data) return finish(tier, "text-llm", response.data, { ...details, ocrConfidence: confidence });
    start = performance.now();
    const extraction = bestLocal(ocr);
    steps.push({ name: msg("step.fallback"), ms: performance.now() - start });
    return finish(tier, "offline-heuristic", extraction, { ...details, ocrConfidence: confidence });
  }

  start = performance.now();
  const vision = compressForVision(cropped);
  steps.push({ name: msg("step.compress"), ms: performance.now() - start, bytes: vision.bytes,
    detail: msg("step.grayJpeg", { size: `${vision.width}×${vision.height}` }) });
  onProgress?.(msg("progress.vision"));
  start = performance.now();
  const response = await callTwin<Extraction>({ task: "extract_image", image: vision.dataUrl });
  const details = gatewayDetails(response, steps, msg("step.visionLlm"), start, vision.bytes,
    { wouldSend: { task: "extract_image", image: `JPEG · ${vision.bytes} bytes` } });
  details.preview = vision.dataUrl;
  details.ocrConfidence = ocr?.confidence;
  if (response.ok && response.data) return finish(2, "vision-llm", response.data, details);

  start = performance.now();
  let extraction: Extraction = ocr ? bestLocal(ocr) : { kind: "other" };
  steps.push({ name: msg("step.fallback"), ms: performance.now() - start });
  if (ocr && runOcr && extractionStatus(extraction).outcome !== "ok") {
    start = performance.now();
    try {
      const raw = await runOcr(cropped, onProgress, true);
      const candidate = bestLocal(raw);
      steps.push(ocrStep(raw, msg("step.ocrRetry"), performance.now() - start));
      const rank = extractionRank(candidate) - extractionRank(extraction);
      if (rank > 0 || (rank === 0 && raw.confidence > ocr.confidence)) extraction = candidate;
    } catch (error) {
      steps.push({ name: msg("step.ocrRetryFailed"), ms: performance.now() - start,
        detail: ocrErrorDetail(error) });
    }
  }
  return finish(2, "offline-heuristic", extraction, details);
}

function gatewayDetails(response: LlmResponse<Extraction>, steps: PipelineStep[], name: Msg, start: number, bytes: number, wouldSend: unknown): Details {
  const usageKnown = response.usageKnown ?? Boolean(response.usage || response.offline);
  steps.push({ name, ms: performance.now() - start, bytes, detail: response.offline ? msg("step.noKey") : response.error ?? response.usage?.model });
  return {
    usage: response.usage ? { ...response.usage, mode: "llm" as const } :
      { ...LOCAL_USAGE, model: usageKnown ? "Regex (local)" : "Provider usage unavailable", mode: response.offline ? "offline" : usageKnown ? "local" : "llm" },
    usageKnown,
    payload: response.request ?? wouldSend,
  };
}
