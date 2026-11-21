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
    if (typeof src !== "string") setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function toCanvas(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
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
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
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
  const s = Math.min(1, 512 / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  const ctx = c.getContext("2d")!;
  ctx.filter = "grayscale(1) contrast(1.2)";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/jpeg", 0.6);
  return { dataUrl, width: c.width, height: c.height, bytes: Math.round((dataUrl.length - 23) * 0.75) };
}
