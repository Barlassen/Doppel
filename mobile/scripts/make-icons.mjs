#!/usr/bin/env node
/**
 * Draws the app icon, the Android adaptive icon layers and the splash image from Doppel's mark:
 * a red rounded square with a white "D" (the web header draws the same mark; `src/app/globals.css` --accent).
 * No dependencies: the shapes are rasterised here and written as PNG with node:zlib, so the result is the
 * same on every machine. Run `npm run icons` after changing a colour or the geometry; commit the PNGs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const RED = [0xb3, 0x12, 0x2e];
const RED_DARK = [0xe5, 0x48, 0x4d];
const WHITE = [0xff, 0xff, 0xff];
const SAMPLES = 4; // 4x4 supersampling per pixel

/** The "D": a stem and a bowl, as an outer shape minus the same shape inset by the stroke. Unit coordinates. */
function letterD(cx, cy, height) {
  const width = height * 0.8;
  const stroke = height * 0.2;
  const left = cx - width / 2 + height * 0.02; // optical centring: the bowl is lighter than the stem
  const top = cy - height / 2;
  const shape = (inset) => {
    const x0 = left + inset;
    const y0 = top + inset;
    const y1 = top + height - inset;
    const ry = (y1 - y0) / 2;
    const rx = width * 0.56 - inset;
    const xm = left + width - (width * 0.56); // where the stem's box ends and the bowl begins
    return (x, y) => {
      if (y < y0 || y > y1 || x < x0) return false;
      if (x <= xm) return true;
      const dx = (x - xm) / rx;
      const dy = (y - (y0 + ry)) / ry;
      return dx * dx + dy * dy <= 1;
    };
  };
  const outer = shape(0);
  const inner = shape(stroke);
  return (x, y) => outer(x, y) && !inner(x, y);
}

function roundedSquare(x0, y0, size, radius) {
  return (x, y) => {
    const px = Math.min(x - x0, x0 + size - x);
    const py = Math.min(y - y0, y0 + size - y);
    if (px < 0 || py < 0) return false;
    if (px >= radius || py >= radius) return true;
    const dx = radius - px;
    const dy = radius - py;
    return dx * dx + dy * dy <= radius * radius;
  };
}

/** layers: [{ inside(x, y), color: [r, g, b] }] painted in order on a transparent canvas. */
function render(size, layers) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SAMPLES);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px * SAMPLES + sx + 0.5) * step;
          const y = (py * SAMPLES + sy + 0.5) * step;
          let color = null;
          for (const layer of layers) if (layer.inside(x, y)) color = layer.color;
          if (color) { r += color[0]; g += color[1]; b += color[2]; a += 1; }
        }
      }
      const at = (py * size + px) * 4;
      if (a > 0) {
        pixels[at] = Math.round(r / a);
        pixels[at + 1] = Math.round(g / a);
        pixels[at + 2] = Math.round(b / a);
        pixels[at + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
      }
    }
  }
  return png(size, size, pixels);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bit, RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const everywhere = () => true;
const tile = roundedSquare(0.1, 0.1, 0.8, 0.8 * 0.22);
const files = {
  // Launcher icon for stores and old Android: full-bleed red, the system applies its own mask.
  "icon.png": render(1024, [{ inside: everywhere, color: RED }, { inside: letterD(0.5, 0.5, 0.46), color: WHITE }]),
  // Adaptive icon: the letter stays inside the centre 61% that every mask keeps; the red comes from app.json.
  "android-icon-foreground.png": render(1024, [{ inside: letterD(0.5, 0.5, 0.3), color: WHITE }]),
  "android-icon-monochrome.png": render(1024, [{ inside: letterD(0.5, 0.5, 0.3), color: WHITE }]),
  // Splash: the mark as the web header shows it, on the page background set in app.json.
  "splash-icon.png": render(1024, [{ inside: tile, color: RED }, { inside: letterD(0.5, 0.5, 0.4), color: WHITE }]),
  "splash-icon-dark.png": render(1024, [{ inside: tile, color: RED_DARK }, { inside: letterD(0.5, 0.5, 0.4), color: WHITE }]),
};

mkdirSync(OUT, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
