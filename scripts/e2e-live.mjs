/**
 * Live end-to-end demo check (real OpenRouter calls, costs ~$0.01 per run).
 * Needs OPENROUTER_API_KEY in .env.local and a production build (`npm run build`).
 *   npm run e2e:live [-- <screenshot-dir>]
 * Walks the stage demo: listing (0 tokens) → handwritten note (Tier 2 vision) → free-form what-if (LLM)
 * → local what-if (0 tokens) → banker narration → Inspector live GPT-4o comparison.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const OUT = process.argv[2] ?? join(tmpdir(), "doppel-e2e");
mkdirSync(OUT, { recursive: true });
const PORT = 3306;
const base = `http://127.0.0.1:${PORT}`;
const flat = (s) => s.replace(/\s+/g, " ").trim();

// `next start` loads .env.local, so the gateway uses the real key.
const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", String(PORT)], { stdio: "ignore" });
const errors = [];
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await delay(500);
  }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message}`));
  await page.goto(base, { waitUntil: "networkidle" });
  await delay(2500);
  const headline = async () => flat(await page.locator("h1").first().innerText());

  console.log("initial        :", await headline());
  await page.screenshot({ path: join(OUT, "1-initial.png"), fullPage: true });

  async function snap(sample) {
    await page.getByRole("button", { name: sample, exact: true }).click();
    const card = page.getByRole("form", { name: "Review scan" });
    await card.waitFor({ timeout: 60_000 });
    const r = {
      tier: await card.getAttribute("data-tier"),
      route: await card.getAttribute("data-route"),
      kind: await card.getByLabel("Document type").inputValue(),
      amount: Number(await card.getByLabel("Amount (CHF)").inputValue()),
    };
    await card.getByRole("button", { name: "Add to twin" }).click();
    await delay(3000);
    console.log(`snap ${sample.padEnd(10)}:`, JSON.stringify(r), "→", await headline());
    return r;
  }

  const listing = await snap("Listing");
  assert.deepEqual([listing.route, listing.amount], ["local-regex", 940_000]);
  const note = await snap("Note");
  assert.deepEqual([note.tier, note.kind, note.amount], ["2", "note", 25_000]);
  await page.screenshot({ path: join(OUT, "2-after-snaps.png"), fullPage: true });

  const input = page.getByLabel("What-if for your twin");
  const status = page.getByRole("status").first();
  await input.fill("Suppose my partner moves in and pays 1200 francs of the rent from next spring");
  await page.getByRole("button", { name: "Simulate" }).click();
  await status.getByText(/Parsed by|LLM error/).waitFor({ timeout: 30_000 });
  console.log("llm what-if    :", flat(await status.innerText()));
  assert.match(await status.innerText(), /Parsed by/);

  await input.fill("Retire at 60");
  await page.getByRole("button", { name: "Simulate" }).click();
  await status.getByText(/Parsed locally/).waitFor({ timeout: 10_000 });
  console.log("local what-if  :", flat(await status.innerText()));

  await page.getByRole("button", { name: "Explain my situation" }).click();
  await page.getByRole("button", { name: "Refresh" }).waitFor({ timeout: 30_000 });
  console.log("banker         :", flat(await page.locator("p.font-serif").first().innerText()));
  await page.screenshot({ path: join(OUT, "3-after-actions.png"), fullPage: true });

  await page.getByTitle(/Inspector/).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByText(/Snap · Listing/).first().click();
  await dialog.getByRole("button", { name: /Run the naive way/ }).first().click();
  await dialog.getByText(/1 measured/i).first().waitFor({ timeout: 45_000 });
  const verdict = flat(await dialog.getByText(/^(Same amount|Differs)$/).first().innerText());
  console.log("naive GPT-4o   :", verdict);
  assert.equal(verdict, "Same amount");
  console.log("inspector      :", flat(await dialog.innerText()).slice(0, 420));
  await page.screenshot({ path: join(OUT, "4-inspector.png") });

  assert.deepEqual(errors, []);
  console.log(`\nLive e2e passed. Screenshots in ${OUT}`);
} finally {
  await browser?.close();
  server.kill();
  if (errors.length) console.log("console errors:", errors);
}
