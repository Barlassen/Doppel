/**
 * Generates the 7 sample bank, camt.053 and broker/3a statement files from the built-in persona data
 * (`src/lib/data/history.ts` via `src/lib/import/samples.ts`) into `public/samples/imports/`.
 *
 * Run: `npx tsx scripts/make-import-samples.ts`
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { importSamples } from "../src/lib/import/samples";

const outDir = join(process.cwd(), "public", "samples", "imports");

async function main() {
  await mkdir(outDir, { recursive: true });
  const files = importSamples();
  for (const file of files) {
    const target = join(outDir, file.name);
    await writeFile(target, file.bytes);
    console.log(`wrote ${file.name} (${file.bytes.byteLength} bytes, ${file.account} · ${file.provider})`);
  }
}

await main();
