"use client";

/** Browser-side image helpers. Everything here runs locally and costs 0 tokens. */

export async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

type CanvasSource = HTMLImageElement | HTMLCanvasElement;
type Crop = { x: number; y: number; width: number; height: number };

export function toCanvas(img: CanvasSource, maxSide: number, crop?: Crop, filter = "none"): HTMLCanvasElement {
  const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const { x, y, width, height } = crop ?? { x: 0, y: 0, width: w, height: h };
  const s = Math.min(1, maxSide / Math.max(width, height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width * s));
  c.height = Math.max(1, Math.round(height * s));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.filter = filter;
  ctx.drawImage(img, x, y, width, height, 0, 0, c.width, c.height);
  return c;
}

const luminance = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

/** Project dark pixels onto both axes and keep a margin around the detected ink. */
export function cropToInk(src: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = src;
  const { data } = src.getContext("2d")!.getImageData(0, 0, width, height);
  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (luminance(data[i], data[i + 1], data[i + 2]) < 145) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const hasRowInk = (count: number) => count >= Math.max(2, width * 0.004);
  const hasColInk = (count: number) => count >= Math.max(2, height * 0.004);
  const left = cols.findIndex(hasColInk);
  const top = rows.findIndex(hasRowInk);
  if (left < 0 || top < 0) return src;
  const right = cols.findLastIndex(hasColInk);
  const bottom = rows.findLastIndex(hasRowInk);
  const padding = Math.max(16, Math.round(Math.max(width, height) * 0.055));
  const x = Math.max(0, left - padding);
  const y = Math.max(0, top - padding);
  const croppedWidth = Math.min(width, right + padding + 1) - x;
  const croppedHeight = Math.min(height, bottom + padding + 1) - y;
  if (croppedWidth * croppedHeight > width * height * 0.95) return src;
  return toCanvas(src, Math.max(width, height), { x, y, width: croppedWidth, height: croppedHeight });
}

/** Grayscale + percentile contrast stretch: cheap and it noticeably helps Tesseract on phone photos. */
export function enhanceForOcr(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  const gray = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = luminance(d[i], d[i + 1], d[i + 2]);
    gray[j] = g;
    hist[gray[j]]++;
  }
  const n = gray.length;
  let lo = 0;
  let hi = 255;
  for (let acc = 0, k = 0; k < 256; k++) {
    acc += hist[k];
    if (acc > n * 0.02) {
      lo = k;
      break;
    }
  }
  for (let acc = 0, k = 255; k >= 0; k--) {
    acc += hist[k];
    if (acc > n * 0.02) {
      hi = k;
      break;
    }
  }
  if (hi - lo < 32) lo = Math.max(0, hi - 32);
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, ((gray[j] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Tier-2 payload: ≤512px, grayscale, JPEG q=0.6 (~15–30 KB). */
export function compressForVision(src: HTMLCanvasElement): { dataUrl: string; width: number; height: number; bytes: number } {
  const c = toCanvas(src, 512, undefined, "grayscale(1)");
  const dataUrl = c.toDataURL("image/jpeg", 0.6);
  return { dataUrl, width: c.width, height: c.height, bytes: jpegBytes(dataUrl) };
}

export function jpegBytes(dataUrl: string): number {
  return ((dataUrl.length - "data:image/jpeg;base64,".length) * 3) / 4 - (dataUrl.match(/=+$/)?.[0].length ?? 0);
}

/** Difference hash plus a higher-detail check to avoid mixing documents with similar layouts. */
export function imageFingerprint(img: HTMLImageElement): { hash: string; signature: string } {
  const tiny = document.createElement("canvas");
  tiny.width = 9;
  tiny.height = 8;
  const ctx = tiny.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 9, 8);
  ctx.drawImage(img, 0, 0, 9, 8);
  const pixels = ctx.getImageData(0, 0, 9, 8).data;
  let hash = "";
  for (let y = 0; y < 8; y++) {
    let row = 0;
    for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * 4;
      row = (row << 1) | Number(luminance(pixels[i], pixels[i + 1], pixels[i + 2]) > luminance(pixels[i + 4], pixels[i + 5], pixels[i + 6]));
    }
    hash += row.toString(16).padStart(2, "0");
  }

  const detail = toCanvas(img, 512);
  const colors = detail.getContext("2d")!.getImageData(0, 0, detail.width, detail.height).data;
  let checksum = 2166136261;
  for (let i = 0; i < colors.length; i += 4) {
    checksum = Math.imul(checksum ^ Math.round(luminance(colors[i], colors[i + 1], colors[i + 2])), 16777619);
  }
  return { hash, signature: `${img.naturalWidth}×${img.naturalHeight}:${(checksum >>> 0).toString(16)}` };
}
