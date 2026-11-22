import { measureDonut } from "./donut";
import { withPixelAllocation } from "./chart";
import { msg, translateText, type Msg } from "@/lib/i18n";
import { callTwin } from "@/lib/llm";
import { heuristicExtract } from "../heuristics";
import type { OcrResult } from "../ocr";
import type { Extraction, PipelineStep, SnapResult, Usage } from "../types";
import {
  offlineChartFromOcr,
  validateChartExtraction,
  verifyChart,
  type ChartExtraction,
  type ChartVerification,
} from "./chart";
import {
  compressChartForVision,
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

export * from "./chart";
export * from "./detect";
export * from "./floorplan";

export type VisionPayload =
  | {
      kind: "floorplan";
      detection: VisionDetection;
      floorPlan: FloorPlanVerification;
    }
  | {
      kind: "chart";
      detection: VisionDetection;
      chart: ChartVerification;
    };

const LOCAL_OFFLINE_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  costUsd: 0,
  model: "Vision fixture (offline)",
  mode: "offline",
};

/**
 * Runs the 0-token document-type detector and, if the image is a Swiss floor plan or financial chart,
 * executes the cropped & downscaled vision extraction + deterministic TypeScript verification.
 * Returns null if the image is not a vision-routed document so the normal Tier 1/2 cascade proceeds.
 */
export async function tryVisionSnap(
  croppedCanvas: HTMLCanvasElement,
  ocr: OcrResult | undefined,
  steps: PipelineStep[],
  onProgress?: (m: Msg) => void,
): Promise<{
  route: "vision-plan" | "vision-chart";
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

  if (detection.kind === "none") {
    return null;
  }

  if (detection.kind === "floorplan") {
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

  // detection.kind === "chart"
  const tCrop = performance.now();
  const compressed = compressChartForVision(croppedCanvas, detection.cropBox);
  steps.push({
    name: msg("vision.stepCropChart"),
    ms: performance.now() - tCrop,
    bytes: compressed.bytes,
    detail: msg("vision.colorJpeg", { size: `${compressed.width}×${compressed.height}` }),
  });

  onProgress?.(msg("progress.vision"));
  const tCall = performance.now();
  const response = await callTwin<ChartExtraction>({
    task: "extract_chart",
    image: compressed.dataUrl,
  });
  const usageKnown = response.usageKnown ?? Boolean(response.usage || response.offline);
  steps.push({
    name: msg("step.visionLlm"),
    ms: performance.now() - tCall,
    bytes: compressed.bytes,
    detail: response.offline ? msg("step.noKey") : response.error ?? response.usage?.model,
  });

  const rawChart =
    (response.ok && response.data ? validateChartExtraction(response.data) : undefined) ??
    (response.offline ? offlineChartFromOcr(ocrText, detection.chartSubtype) : {});

  const tVerify = performance.now();
  const probe = document.createElement("canvas");
  const ratio = Math.min(1, 900 / Math.max(croppedCanvas.width, croppedCanvas.height));
  probe.width = Math.round(croppedCanvas.width * ratio); probe.height = Math.round(croppedCanvas.height * ratio);
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  ctx?.drawImage(croppedCanvas, 0, 0, probe.width, probe.height);
  const pixels = ctx ? measureDonut(ctx.getImageData(0, 0, probe.width, probe.height)) : undefined;
  const verified = verifyChart(withPixelAllocation(rawChart, pixels));
  if (rawChart.legend || rawChart.allocation) steps.push({name: msg("vision.stepVerify"), ms: 0, detail: msg(pixels && verified.checks.some(c => c.key === "vision.pixelMeasured") ? "vision.pixelMeasured" : "vision.pixelFallback")});
  steps.push({
    name: msg("vision.stepVerify"),
    ms: performance.now() - tVerify,
    detail: verified.headline,
  });

  const labelMsg = verified.headline;
  const extraction: Extraction = {
    kind: "note",
    amount: verified.latestValueChf,
    label: verified.provider ?? translateText("en", labelMsg),
    labelMsg,
    vision: {
      kind: "chart",
      detection,
      chart: verified,
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
    route: "vision-chart",
    extraction,
    usage,
    usageKnown,
    payload: response.request ?? {
      wouldSend: {
        task: "extract_chart",
        image: `JPEG ${compressed.width}×${compressed.height} · ${compressed.bytes} bytes`,
      },
    },
    preview: compressed.dataUrl,
    visionReason: verified.checks.find(c => c.key === "vision.pixelMeasured") ?? verified.warnings.find(c => c.key === "vision.pixelFallback") ?? detection.reason,
    cropSize: { width: compressed.width, height: compressed.height },
  };
}

export type VisionSnapDetails = Pick<
  SnapResult,
  "route" | "extraction" | "usage" | "usageKnown" | "payload" | "preview"
>;

export { VISION_CHART_OUTPUT_TOKENS, VISION_PLAN_OUTPUT_TOKENS } from "./limits";
