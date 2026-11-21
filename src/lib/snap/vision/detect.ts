import { msg, type Msg } from "@/lib/i18n/types";
import { jpegBytes, toCanvas } from "../image";

/**
 * Local 0-token document-type detector for visual financial documents (Swiss floor plans & charts).
 *
 * Routes by document type and visual structure — NOT by OCR failure.
 * Works identically on browser ImageData and Node RGBA buffers (for vision-benchmark.ts).
 */

export const MAX_PLAN_SIDE = 768;
export const MAX_CHART_SIDE = 512;

export interface VisionSignals {
  ocrKeywords: string[];
  planRoomLabels: string[];
  chartKeywords: string[];
  scatteredNumbers: number;
  dimensionPairs: number;
  areaMentions: number;
  explicitPercents: number;
  /** Characters of OCR text per megapixel of image area. */
  textDensity: number;
  /** 0..1 score measuring thin horizontal + vertical wall lines enclosing light rooms. */
  orthogonalWallScore: number;
  /** 0..1 score measuring multi-hue saturated segments (donut / pie slices). */
  colorSegmentScore: number;
  /** 0..1 score measuring continuous non-flat curve strokes across x-columns. */
  curveScore: number;
  distinctHueBins: number;
  lightBgRatio: number;
}

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionDetection {
  kind: "floorplan" | "chart" | "none";
  route: "vision-plan" | "vision-chart" | null;
  chartSubtype?: "donut" | "line" | "both";
  ocrSufficient: boolean;
  signals: VisionSignals;
  reason: Msg;
  cropBox: CropBox;
}

const STRONG_PLAN_WORDS: [RegExp, string][] = [
  [/\bgrundriss\b/i, "Grundriss"],
  [/\bfloor\s*plan\b/i, "floor plan"],
  [/\bplan\s+d['’]?\s*[ée]tage\b/i, "plan d'étage"],
  [/\bmassstab\b|\b[ée]chelle\b|\b1\s*:\s*(?:50|100|200)\b/i, "1:100"],
  [/\bnettowohnfl[äa]che\b|\bwohnfl[äa]che\b|\bsurface\s+habitable\b/i, "Wohnfläche"],
];

const PLAN_ROOM_WORDS: [RegExp, string][] = [
  [/\bwohnen\b|\bwohnzimmer\b|\bs[ée]jour\b|\bliving\b/i, "Wohnen/Séjour"],
  [/\bessen\b|\bessbereich\b|\bcoin\s+[àa]\s+manger\b|\bsalle\s+[àa]\s+manger\b|\bdining\b/i, "Essen"],
  [/\bschlafen\b|\beltern\b|\bchambre\b|\bbedroom\b/i, "Schlafen/Chambre"],
  [/\bzimmer\s*[1-5]\b|\bb[üu]ro\b|\barbeitszimmer\b|\boffice\b/i, "Zimmer"],
  [/\bk[üu]che\b|\bcuisine\b|\bkitchen\b/i, "Küche/Cuisine"],
  [/\bbad\b|\bdusche\b|\bdu\s*\/\s*wc\b|\bsalle\s+de\s+bain\b|\bbain\b/i, "Bad/WC"],
  [/\bkorridor\b|\bentr[ée]e\b|\bhall\b|\breduit\b|\bd[ée]gagement\b/i, "Korridor/Entrée"],
  [/\bbalkon\b|\bterrasse\b|\bloggia\b|\bbalcon\b/i, "Balkon/Terrasse"],
];

const CHART_WORDS: [RegExp, string][] = [
  [/\ballokation\b|\ballocation\b|\banlageaufteilung\b/i, "Allocation"],
  [/\bwertentwicklung\b|\bdepotentwicklung\b|\bperformance\b|\brendite\b/i, "Performance"],
  [/\baktien\b|\bactions\b|\bequities\b/i, "Aktien/Actions"],
  [/\bobligationen\b|\bobligations\b|\bbonds\b/i, "Obligationen/Bonds"],
  [/\bliquidit[äa]t\b|\bliquidit[ée]s\b|\bcash\b/i, "Liquidität/Cash"],
  [/\bimmobilien\b|\bimmobilier\b|\breal\s+estate\b/i, "Immobilien"],
  [/\bs[äa]ule\s*3a\b|\bpilier\s*3a\b|\bvorsorge\s*3a\b|\b3a\b/i, "3a"],
  [/\bdepot(?:wert)?\b|\bportfolio\b|\bportefeuille\b|\bverm[öo]gens[üu]bersicht\b/i, "Portfolio"],
];

const NON_VISION_DOC =
  /\b(?:lohnabrechnung|bulletin\s+de\s+salaire|fiche\s+de\s+paie|nettolohn|salaire\s+net|empfangsschein|zahlteil|quittung|kassenbon|ticket\s+de\s+caisse|total\s+ttc|mwst-nr)\b/i;

const lum = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

/**
 * Compute structural pixel signals on an RGBA image buffer (typically downscaled to ≤360px).
 */
export function analyzeImagePixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): {
  orthogonalWallScore: number;
  colorSegmentScore: number;
  curveScore: number;
  distinctHueBins: number;
  lightBgRatio: number;
  cropBox: CropBox;
} {
  const totalPixels = Math.max(1, width * height);
  let lightBg = 0;
  let saturated = 0;
  const hueBins = new Uint32Array(12);

  // Track content bounding box of non-white ink or colour features
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  const gray = new Uint8Array(totalPixels);
  const satMask = new Uint8Array(totalPixels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const l = Math.round(lum(r, g, b));
      gray[idx] = l;

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const delta = maxC - minC;

      if (l > 205 && delta < 30) {
        lightBg++;
      } else if (l < 200 || delta >= 32) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      if (delta >= 38 && l > 35 && l < 235) {
        saturated++;
        satMask[idx] = 1;
        let hue = 0;
        if (maxC === r) hue = ((g - b) / delta) % 6;
        else if (maxC === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        const deg = (hue * 60 + 360) % 360;
        const bin = Math.min(11, Math.floor(deg / 30));
        hueBins[bin]++;
      }
    }
  }

  const lightBgRatio = lightBg / totalPixels;

  // 1. Orthogonal wall score: thin dark horizontal & vertical runs bordered by light room interior pixels
  const minRunX = Math.max(10, Math.round(width * 0.065));
  const minRunY = Math.max(10, Math.round(height * 0.065));
  const perpOffset = Math.max(3, Math.round(Math.min(width, height) * 0.02));

  let hWallSegments = 0;
  let hWallPixels = 0;
  for (let y = perpOffset; y < height - perpOffset; y += 2) {
    let run = 0;
    let bordered = 0;
    for (let x = 0; x < width; x++) {
      const g = gray[y * width + x];
      if (g < 145) {
        run++;
        const above = gray[(y - perpOffset) * width + x];
        const below = gray[(y + perpOffset) * width + x];
        if (above > 175 && below > 175) bordered++;
      } else {
        if (run >= minRunX && bordered >= run * 0.55) {
          hWallSegments++;
          hWallPixels += run;
        }
        run = 0;
        bordered = 0;
      }
    }
    if (run >= minRunX && bordered >= run * 0.55) {
      hWallSegments++;
      hWallPixels += run;
    }
  }

  let vWallSegments = 0;
  let vWallPixels = 0;
  for (let x = perpOffset; x < width - perpOffset; x += 2) {
    let run = 0;
    let bordered = 0;
    for (let y = 0; y < height; y++) {
      const g = gray[y * width + x];
      if (g < 145) {
        run++;
        const left = gray[y * width + (x - perpOffset)];
        const right = gray[y * width + (x + perpOffset)];
        if (left > 175 && right > 175) bordered++;
      } else {
        if (run >= minRunY && bordered >= run * 0.55) {
          vWallSegments++;
          vWallPixels += run;
        }
        run = 0;
        bordered = 0;
      }
    }
    if (run >= minRunY && bordered >= run * 0.55) {
      vWallSegments++;
      vWallPixels += run;
    }
  }

  // Floor plans have BOTH horizontal and vertical interior walls enclosing rooms.
  const bothAxes = Math.min(hWallSegments, vWallSegments);
  const wallDensity = (hWallPixels + vWallPixels) / Math.max(1, totalPixels * 0.035);
  const orthogonalWallScore =
    bothAxes < 2
      ? Math.min(0.22, bothAxes * 0.08)
      : Math.min(1, Math.min(1, bothAxes / 9) * 0.65 + Math.min(1, wallDensity) * 0.35);

  // 2. Colour segment score (donut / pie charts have >= 3 distinct saturated hue bins)
  const minBinPixels = Math.max(15, Math.round(totalPixels * 0.0012));
  let distinctHueBins = 0;
  for (let b = 0; b < 12; b++) {
    if (hueBins[b] >= minBinPixels) distinctHueBins++;
  }
  const saturatedShare = saturated / totalPixels;
  const colorSegmentScore =
    distinctHueBins >= 3
      ? Math.min(1, 0.45 + distinctHueBins * 0.12 + Math.min(0.3, saturatedShare * 4))
      : distinctHueBins === 2
        ? Math.min(0.55, 0.25 + saturatedShare * 3)
        : Math.min(0.2, saturatedShare * 2);

  // 3. Curve continuity score (line chart: thin saturated curve stroke y(x) across columns with smooth continuity & vertical span)
  const xStart = Math.floor(width * 0.1);
  const xEnd = Math.floor(width * 0.9);
  const totalCols = Math.max(1, Math.floor((xEnd - xStart) / 2));
  const maxStroke = Math.max(8, Math.round(height * 0.04));

  function scoreCurveBand(yMin: number, yMax: number): number {
    const centroids: number[] = [];
    let smoothSteps = 0;
    let prevY: number | null = null;

    for (let x = xStart; x < xEnd; x += 2) {
      // Find thin vertical runs of saturated pixels in [yMin, yMax)
      const runs: number[] = [];
      let runStart = -1;
      for (let y = yMin; y < yMax; y++) {
        if (satMask[y * width + x] === 1) {
          if (runStart === -1) runStart = y;
        } else if (runStart !== -1) {
          const len = y - runStart;
          if (len >= 1 && len <= maxStroke) {
            runs.push(runStart + (len - 1) / 2);
          }
          runStart = -1;
        }
      }
      if (runStart !== -1) {
        const len = yMax - runStart;
        if (len >= 1 && len <= maxStroke) {
          runs.push(runStart + (len - 1) / 2);
        }
      }

      // A single-line chart column has 1 thin stroke (avoid double-arc columns from a donut ring)
      if (runs.length === 1) {
        const cy = runs[0];
        centroids.push(cy);
        if (prevY !== null && Math.abs(cy - prevY) <= height * 0.09) {
          smoothSteps++;
        }
        prevY = cy;
      } else {
        prevY = null;
      }
    }

    if (centroids.length < totalCols * 0.48) return 0;
    const minCy = Math.min(...centroids);
    const maxCy = Math.max(...centroids);
    const span = (maxCy - minCy) / Math.max(1, height);
    const continuity = smoothSteps / Math.max(1, centroids.length - 1);
    if (span >= 0.05 && continuity >= 0.65) {
      return Math.min(1, 0.35 + continuity * 0.4 + Math.min(0.25, span * 1.2));
    }
    return 0;
  }

  const curveScore = Math.max(
    scoreCurveBand(Math.floor(height * 0.12), Math.floor(height * 0.88)),
    scoreCurveBand(Math.floor(height * 0.45), Math.floor(height * 0.92)),
  );

  const padX = Math.round(width * 0.03);
  const padY = Math.round(height * 0.03);
  const cropBox: CropBox =
    maxX > minX && maxY > minY
      ? {
          x: Math.max(0, minX - padX),
          y: Math.max(0, minY - padY),
          width: Math.min(width, maxX + padX + 1) - Math.max(0, minX - padX),
          height: Math.min(height, maxY + padY + 1) - Math.max(0, minY - padY),
        }
      : { x: 0, y: 0, width, height };

  return {
    orthogonalWallScore: Math.round(orthogonalWallScore * 100) / 100,
    colorSegmentScore: Math.round(colorSegmentScore * 100) / 100,
    curveScore: Math.round(curveScore * 100) / 100,
    distinctHueBins,
    lightBgRatio: Math.round(lightBgRatio * 100) / 100,
    cropBox,
  };
}

/**
 * Pure detector combining pixel signals and OCR text signals (0 tokens).
 */
export function detectVisionFromSignals(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  ocrText: string,
): VisionDetection {
  const px = analyzeImagePixels(rgba, width, height);
  const cleanText = ocrText.replace(/\r/g, "");

  const strongPlanHits = STRONG_PLAN_WORDS.filter(([re]) => re.test(cleanText)).map(([, label]) => label);
  const planRoomLabels = PLAN_ROOM_WORDS.filter(([re]) => re.test(cleanText)).map(([, label]) => label);
  const chartKeywords = CHART_WORDS.filter(([re]) => re.test(cleanText)).map(([, label]) => label);

  const dimensionMatches = cleanText.match(/\b\d{1,2}[.,]\d{1,2}\s*[×x✕*]\s*\d{1,2}[.,]\d{1,2}\b/g) ?? [];
  const areaMatches = cleanText.match(/\b\d{1,3}(?:[.,]\d{1,2})?\s*m[²2]\b/gi) ?? [];
  const percentMatches = cleanText.match(/\b\d{1,3}(?:[.,]\d+)?\s*%/g) ?? [];
  const numberMatches = cleanText.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];

  const megapixels = Math.max(0.05, (width * height) / 1_000_000);
  const textDensity = Math.round(cleanText.replace(/\s+/g, "").length / megapixels);

  const signals: VisionSignals = {
    ocrKeywords: [...strongPlanHits, ...planRoomLabels, ...chartKeywords],
    planRoomLabels,
    chartKeywords,
    scatteredNumbers: numberMatches.length,
    dimensionPairs: dimensionMatches.length,
    areaMentions: areaMatches.length,
    explicitPercents: percentMatches.length,
    textDensity,
    orthogonalWallScore: px.orthogonalWallScore,
    colorSegmentScore: px.colorSegmentScore,
    curveScore: px.curveScore,
    distinctHueBins: px.distinctHueBins,
    lightBgRatio: px.lightBgRatio,
  };

  // Hard exclusion: payslips, supermarket receipts, and QR-bill slips stay on Tier 0 / Tier 1.
  if (NON_VISION_DOC.test(cleanText)) {
    return {
      kind: "none",
      route: null,
      ocrSufficient: true,
      signals,
      reason: msg("vision.whyOcrSufficient"),
      cropBox: px.cropBox,
    };
  }

  // 1. Floor plan detection
  // Needs structural room walls + room/dimension cues, OR multiple room labels + multiple areas/dimensions.
  // A plain-text property listing with only "4.5 Zimmer · CHF 940'000 · Wohnfläche 112 m²" and no floor plan has
  // planRoomLabels <= 1, dimensionPairs === 0, and areaMentions <= 1 → stays on local-regex (0 tokens)!
  const hasPlanStructure =
    (px.orthogonalWallScore >= 0.36 &&
      (planRoomLabels.length >= 2 ||
        dimensionMatches.length >= 2 ||
        areaMatches.length >= 2 ||
        strongPlanHits.length >= 1)) ||
    (planRoomLabels.length >= 3 && (dimensionMatches.length >= 2 || areaMatches.length >= 3));

  if (hasPlanStructure) {
    return {
      kind: "floorplan",
      route: "vision-plan",
      ocrSufficient: false,
      signals,
      reason: msg("vision.whyPlan", {
        numbers: Math.max(numberMatches.length, dimensionMatches.length * 2 + areaMatches.length),
        walls: px.orthogonalWallScore.toFixed(2),
      }),
      cropBox: px.cropBox,
    };
  }

  // 2. Chart detection (donut allocation, portfolio value line chart, or banking screenshot with both)
  const hasDonut = px.colorSegmentScore >= 0.42 && px.distinctHueBins >= 3;
  const hasLine = px.curveScore >= 0.42;
  const isChart =
    (chartKeywords.length >= 2 && (hasDonut || hasLine)) ||
    (chartKeywords.length >= 1 && px.colorSegmentScore >= 0.55) ||
    (chartKeywords.length >= 1 && px.curveScore >= 0.55);

  if (isChart) {
    const chartSubtype: "donut" | "line" | "both" =
      hasDonut && hasLine ? "both" : hasDonut ? "donut" : "line";
    const kindMsg =
      chartSubtype === "both"
        ? msg("vision.chartKindBoth")
        : chartSubtype === "donut"
          ? msg("vision.chartKindDonut")
          : msg("vision.chartKindLine");
    return {
      kind: "chart",
      route: "vision-chart",
      chartSubtype,
      ocrSufficient: false,
      signals,
      reason: msg("vision.whyChart", {
        kind: kindMsg,
        colors: px.distinctHueBins,
        curve: px.curveScore.toFixed(2),
      }),
      cropBox: px.cropBox,
    };
  }

  return {
    kind: "none",
    route: null,
    ocrSufficient: true,
    signals,
    reason: msg("vision.whyOcrSufficient"),
    cropBox: px.cropBox,
  };
}

/**
 * Browser helper: runs the 0-token detector on a canvas and OCR result.
 */
export function detectVisionCanvas(canvas: HTMLCanvasElement, ocrText: string): VisionDetection {
  const probe = toCanvas(canvas, 360);
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, probe.width, probe.height);
  const res = detectVisionFromSignals(data, width, height, ocrText);
  // Scale cropBox back to the source canvas coordinates
  const scaleX = canvas.width / Math.max(1, width);
  const scaleY = canvas.height / Math.max(1, height);
  return {
    ...res,
    cropBox: {
      x: Math.max(0, Math.floor(res.cropBox.x * scaleX)),
      y: Math.max(0, Math.floor(res.cropBox.y * scaleY)),
      width: Math.min(canvas.width, Math.ceil(res.cropBox.width * scaleX)),
      height: Math.min(canvas.height, Math.ceil(res.cropBox.height * scaleY)),
    },
  };
}

/**
 * Crop & downscale for floor plans:
 * Max edge 768px, grayscale JPEG q=0.68 so small printed room dimensions (e.g. "4.20 × 3.85") stay legible.
 */
export function compressPlanForVision(
  src: HTMLCanvasElement,
  crop?: CropBox,
): { dataUrl: string; width: number; height: number; bytes: number } {
  const c = toCanvas(src, MAX_PLAN_SIDE, crop, "grayscale(1) contrast(1.12)");
  const dataUrl = c.toDataURL("image/jpeg", 0.68);
  return { dataUrl, width: c.width, height: c.height, bytes: jpegBytes(dataUrl) };
}

/**
 * Crop & downscale for charts:
 * Max edge 512px, COLOUR JPEG q=0.65 because donut legends map categories by colour hue.
 */
export function compressChartForVision(
  src: HTMLCanvasElement,
  crop?: CropBox,
): { dataUrl: string; width: number; height: number; bytes: number } {
  const c = toCanvas(src, MAX_CHART_SIDE, crop);
  const dataUrl = c.toDataURL("image/jpeg", 0.65);
  return { dataUrl, width: c.width, height: c.height, bytes: jpegBytes(dataUrl) };
}
