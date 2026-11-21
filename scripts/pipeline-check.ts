/** Node-side check of the snap cascade on the demo samples: `npx tsx scripts/pipeline-check.ts` */
import sharp from "sharp";
import jsQR from "jsqr";
import { createWorker } from "tesseract.js";
import { parseQrBill } from "@/lib/snap/qrBill";
import { heuristicExtract } from "@/lib/snap/heuristics";

async function main() {
  const worker = await createWorker(["eng", "deu"]);
  for (const f of ["qr-bill", "listing", "receipt", "note"]) {
    const png = await sharp(`public/samples/${f}.svg`).flatten({ background: "#fff" }).png().toBuffer();
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    const bill = qr ? parseQrBill(qr.data) : null;
    if (bill) {
      console.log(f, "→ TIER 0", bill.amount, bill.creditor.name, bill.message);
      continue;
    }
    const gray = await sharp(png).grayscale().normalise().png().toBuffer();
    const r = await worker.recognize(gray);
    const text = r.data.text.replace(/\n+/g, "\n").trim();
    console.log(f, `→ OCR conf ${Math.round(r.data.confidence)}`, r.data.confidence >= 65 ? "TIER 1" : "TIER 2");
    console.log("   ", JSON.stringify(text.slice(0, 160)));
    console.log("   heuristic:", JSON.stringify(heuristicExtract(text)));
  }
  await worker.terminate();
}
main();
