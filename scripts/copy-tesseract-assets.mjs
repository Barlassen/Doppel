import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tesseractPackage = require.resolve("tesseract.js/package.json");
const core = dirname(createRequire(tesseractPackage).resolve("tesseract.js-core/package.json"));
const runtime = fileURLToPath(new URL("../public/tesseract/runtime/", import.meta.url));

await mkdir(runtime, { recursive: true });
await Promise.all([
  copyFile(join(dirname(tesseractPackage), "dist", "worker.min.js"), join(runtime, "worker.min.js")),
  ...["lstm", "simd-lstm", "relaxedsimd-lstm"].map((variant) => {
    // These v7 loaders embed the WASM. The worker picks one based on browser support.
    const file = `tesseract-core-${variant}.wasm.js`;
    return copyFile(join(core, file), join(runtime, file));
  }),
  copyFile(join(core, "LICENSE"), join(runtime, "LICENSE")),
]);
