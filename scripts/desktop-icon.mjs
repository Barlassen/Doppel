// Renders assets/icon.svg into the desktop app's icons: desktop/build/icon.png (1024), icon.icns (macOS) and
// icon.ico (Windows). The results are committed, so packaging needs neither a browser nor this script.
//
//   node scripts/desktop-icon.mjs      (needs Playwright's Chromium: npx playwright install chromium)
//
// Both containers hold plain PNGs, so they are written here without any platform tool.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "desktop", "build");
const svg = readFileSync(join(root, "assets", "icon.svg"), "utf8");

const browser = await chromium.launch();
/** The icon as a PNG of `size` pixels. `inset` is the share of the canvas left empty on each side. */
async function render(size, inset = 0) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}div{box-sizing:border-box;width:100vw;height:100vh;padding:${inset * 100}vw}svg{display:block;width:100%;height:100%}</style><div>${svg}</div>`,
  );
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}

/** .ico: a directory of PNG images (Windows Vista and later read PNG entries at every size). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/** .icns: typed PNG chunks (the @1x and @2x slots of a macOS icon set). */
function icns(images) {
  const types = { 16: ["icp4"], 32: ["icp5", "ic11"], 64: ["ic12"], 128: ["ic07"], 256: ["ic08", "ic13"], 512: ["ic09", "ic14"], 1024: ["ic10"] };
  const chunks = images.flatMap(({ size, png }) =>
    (types[size] ?? []).map((type) => {
      const head = Buffer.alloc(8);
      head.write(type, 0, "ascii");
      head.writeUInt32BE(png.length + 8, 4);
      return Buffer.concat([head, png]);
    }),
  );
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([head, ...chunks]);
}

mkdirSync(out, { recursive: true });
const sized = async (sizes, inset) => Promise.all(sizes.map(async (size) => ({ size, png: await render(size, inset) })));
writeFileSync(join(out, "icon.png"), await render(1024));
writeFileSync(join(out, "icon.ico"), ico(await sized([16, 24, 32, 48, 64, 128, 256])));
// macOS icons sit on an 824 px body inside the 1024 px canvas, so the Dock shows it the size of its neighbours.
writeFileSync(join(out, "icon.icns"), icns(await sized([16, 32, 64, 128, 256, 512, 1024], 100 / 1024)));
await browser.close();
console.log(`desktop-icon: wrote icon.png, icon.ico and icon.icns to ${out}`);
