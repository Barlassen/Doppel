import { msg, translateText, type Msg } from "@/lib/i18n";
import { callTwin } from "@/lib/llm";
import { heuristicExtract } from "../heuristics";
import type { OcrResult } from "../ocr";
import type { Extraction, PipelineStep, SnapResult, Usage } from "../types";
import {
  compressPlanForVision,
  detectVisionCanvas,
  type VisionDetection,
} from "./detect";
import {
  offlineFloorPlanFromOcr,
  validateFloorPlanExtraction,
  verifyFloorPlan,
  type FloorPlanExtraction,
  type FloorPlanVerification,
} from "./floorplan";

export * from "./detect";
export * from "./floorplan";

export interface VisionPayload {
  kind: "floorplan";
  detection: VisionDetection;
  floorPlan: FloorPlanVerification;
}

const LOCAL_OFFLINE_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  costUsd: 0,
  model: "Vision fixture (offline)",
  mode: "offline",
};

/**
 * Runs the document-type detector and, if the image is a Swiss floor plan, executes the
 * cropped ≤768px vision extraction + deterministic TypeScript verification.
 * Returns null if the image is not a vision-routed document so the normal Tier 1/2 cascade proceeds.
 */
export async function tryVisionSnap(
  croppedCanvas: HTMLCanvasElement,
  ocr: OcrResult | undefined,
  steps: PipelineStep[],
  onProgress?: (m: Msg) => void,
): Promise<{
  route: "vision-plan";
  extraction: Extraction;
  usage: Usage;
  usageKnown: boolean;
  payload: unknown;
  preview: string;
  visionReason: Msg;
  cropSize: { width: number; height: number };
} | null> {
  const tDetect = performance.now();
  const ocrText = ocr?.rawText ?? "";
  const detection = detectVisionCanvas(croppedCanvas, ocrText);
  steps.push({
    name: msg("vision.stepDetect"),
    ms: performance.now() - tDetect,
    detail: detection.reason,
  });

  if (detection.kind !== "floorplan") {
    return null;
  }

  const tCrop = performance.now();
  const compressed = compressPlanForVision(croppedCanvas, detection.cropBox);
  steps.push({
    name: msg("vision.stepCropPlan"),
    ms: performance.now() - tCrop,
    bytes: compressed.bytes,
    detail: msg("step.grayJpeg", { size: `${compressed.width}×${compressed.height}` }),
  });

  onProgress?.(msg("progress.vision"));
  const tCall = performance.now();
  const response = await callTwin<FloorPlanExtraction>({
    task: "extract_floorplan",
    image: compressed.dataUrl,
  });
  const usageKnown = response.usageKnown ?? Boolean(response.usage || response.offline);
  steps.push({
    name: msg("step.visionLlm"),
    ms: performance.now() - tCall,
    bytes: compressed.bytes,
    detail: response.offline ? msg("step.noKey") : response.error ?? response.usage?.model,
  });

  // Merge OCR text fallback for price/location if printed outside the floor plan box
  const ocrLocal = heuristicExtract(ocrText);
  const rawPlan =
    (response.ok && response.data ? validateFloorPlanExtraction(response.data) : undefined) ??
    offlineFloorPlanFromOcr(ocrText);

  const mergedPlan: FloorPlanExtraction = {
    ...rawPlan,
    priceChf: rawPlan.priceChf ?? (ocrLocal.kind === "listing" ? ocrLocal.amount : undefined),
    location: rawPlan.location ?? ocrLocal.location,
  };

  const tVerify = performance.now();
  const verified = verifyFloorPlan(mergedPlan);
  steps.push({
    name: msg("vision.stepVerify"),
    ms: performance.now() - tVerify,
    detail: verified.headline,
  });

  const labelMsg = verified.location
    ? msg("event.roomsHomeIn", { rooms: verified.rooms, place: verified.location })
    : msg("event.roomsHome", { rooms: verified.rooms });

  const extraction: Extraction = {
    kind: "listing",
    amount: verified.priceChf,
    rooms: verified.rooms,
    location: verified.location,
    areaM2: verified.livingAreaM2,
    label: translateText("en", labelMsg),
    labelMsg,
    vision: {
      kind: "floorplan",
      detection,
      floorPlan: verified,
    },
  };

  const usage: Usage =
    response.ok && response.usage
      ? { ...response.usage, mode: "llm" }
      : {
          ...LOCAL_OFFLINE_USAGE,
          mode: response.offline ? "offline" : usageKnown ? "local" : "llm",
        };

  return {
    route: "vision-plan",
    extraction,
    usage,
    usageKnown,
    payload: response.request ?? {
      wouldSend: {
        task: "extract_floorplan",
        image: `JPEG ${compressed.width}×${compressed.height} · ${compressed.bytes} bytes`,
      },
    },
    preview: compressed.dataUrl,
    visionReason: detection.reason,
    cropSize: { width: compressed.width, height: compressed.height },
  };
}

export type VisionSnapDetails = Pick<
  SnapResult,
  "route" | "extraction" | "usage" | "usageKnown" | "payload" | "preview"
>;
