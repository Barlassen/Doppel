import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import QRCode from "qrcode";
// Run through tsx (see package.json) so localized steps read their labels from the dictionaries.
import { DICTIONARIES, translate } from "../src/lib/i18n/index.ts";
import { ALEXIA_ID, listUbsProfiles } from "../src/lib/ubs/index.ts";

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The longest fixed fragment of a template, for matching text whose placeholders vary. */
const fixedFragment = (template) => template.split(/\{[^}]+\}/).map((s) => s.trim()).sort((a, b) => b.length - a.length)[0];

const port = process.env.DOPPEL_SMOKE_PORT || "3302";
const baseURL = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url);
const payslipPath = process.env.DOPPEL_SMOKE_PAYSLIP || "public/samples/payslip.svg";
const payslipAvailable = await access(payslipPath).then(() => true, () => false);
const receiptScreenshots = process.env.DOPPEL_RECEIPT_SCREENSHOTS;
const visionScreenshots = process.env.DOPPEL_VISION_SCREENSHOTS;

assert.equal(await fetch(baseURL).then(() => true, () => false), false, `Port ${port} is already in use`);
const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "-p", port], {
  env: { ...process.env, OPENROUTER_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });
const serverExited = once(server, "exit");

async function start() {
  for (let i = 0; i < 100 && server.exitCode === null; i++) {
    if (await fetch(baseURL).then((response) => response.ok, () => false)) return;
    await delay(200);
  }
  throw new Error(`Next.js did not start. Run npm run build first.\n${serverLog}`);
}

async function assertNoOverflow(page) {
  const viewport = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const overflow = [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > width + 1)
      .slice(0, 12)
      .map((element) => (element.tagName + "." + element.getAttribute("class")).slice(0, 120));
    return { width, scrollWidth: document.documentElement.scrollWidth, overflow };
  });
  assert.equal(viewport.scrollWidth, viewport.width, JSON.stringify(viewport));
}

async function visit(page) {
  await page.goto(baseURL);
  await page.getByRole("button", { name: "Dictate your what-if" }).waitFor();
}

function trackHydration(page, errors) {
  page.on("console", (message) => {
    if (/hydrat|Minified React error #(418|423|425)/i.test(message.text())) errors.push(message.text());
  });
}

function enableTestSpeech(context) {
  return context.addInitScript(() => {
    window.SpeechRecognition = class {
      start() {
        window.testSpeechLanguage = this.lang;
        queueMicrotask(() => {
          this.onresult({ results: [[{ transcript: "Retire at 60" }]] });
          this.onend();
        });
      }
      stop() { this.onend?.(); }
    };
  });
}

/** Document photos are the secondary entry of the statement card: open "Other documents" when it is closed. */
async function openOtherDocs(page) {
  const docs = page.getByTestId("other-docs");
  await docs.waitFor();
  if (!(await docs.evaluate((el) => el.open))) await docs.locator("summary").click();
}

async function scan(page, sample) {
  await openOtherDocs(page);
  await page.getByRole("button", { name: sample, exact: true }).click();
  const card = page.getByRole("form", { name: "Review scan" });
  await card.waitFor({ timeout: 45_000 });
  const result = {
    tier: Number(await card.getAttribute("data-tier")),
    route: await card.getAttribute("data-route"),
    outcome: await card.getAttribute("data-outcome"),
    kind: await card.getByLabel("Document type").inputValue(),
    amount: await card.getByLabel(/^(Amount|Total) \(CHF\)$/).inputValue(),
    confidence: await card.getByText(/^OCR \d/).textContent({ timeout: 1000 }).catch(() => null),
  };
  console.log(sample, JSON.stringify(result));
  return { card, ...result };
}

async function uploadReceipt(page, locale) {
  const L = (key, params) => translate(locale, key, params);
  await openOtherDocs(page);
  const filePicker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: L("snap.uploadAria") }).click();
  await (await filePicker).setFiles("public/samples/receipt-market.svg");
  const review = page.getByRole("form", { name: L("review.formAria") });
  await review.waitFor({ timeout: 45_000 });
  return review;
}

async function captureReceiptReview(page, review, locale) {
  if (!receiptScreenshots) return;
  await mkdir(receiptScreenshots, { recursive: true });
  const original = page.viewportSize();
  for (const { width, height } of [{ width: 320, height: 800 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize({ width, height });
    await review.evaluate((form) => form.scrollIntoView({ block: "start" }));
    await assertNoOverflow(page);
    await page.screenshot({ path: join(receiptScreenshots, "receipt-" + locale + "-" + width + "x" + height + ".png"), animations: "disabled" });
  }
  if (original) await page.setViewportSize(original);
}

async function captureVisionShot(page, target, name, locale) {
  if (!visionScreenshots) return;
  await mkdir(visionScreenshots, { recursive: true });
  const original = page.viewportSize();
  for (const { width, height } of [{ width: 320, height: 800 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize({ width, height });
    if (target) {
      await target.evaluate((el) => el.scrollIntoView({ block: "start" }));
    }
    await assertNoOverflow(page);
    await page.screenshot({
      path: join(visionScreenshots, `${name}-${locale}-${width}x${height}.png`),
      animations: "disabled",
    });
  }
  if (original) await page.setViewportSize(original);
}

function check(result, tier, route, kind, amount) {
  assert.deepEqual(
    [result.tier, result.route, result.outcome, result.kind, Number(result.amount)],
    [tier, route, "ok", kind, amount],
  );
}

let browser;
try {
  await start();
  const offline = await fetch(`${baseURL}/api/twin`, {
    method: "POST",
    body: JSON.stringify({ task: "extract_text", text: "Example" }),
  });
  assert.deepEqual(await offline.json(), { ok: false, offline: true });

  const malformed = await fetch(`${baseURL}/api/twin`, {
    method: "POST",
    body: JSON.stringify({ task: "extract_image", image: "data:image/svg+xml;base64,Zm9v" }),
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "INVALID_FIELDS");

  for (const lang of [undefined, "en", "de", "fr", "tr", "it"]) {
    const narration = await fetch(`${baseURL}/api/twin`, {
      method: "POST",
      body: JSON.stringify({ task: "narrate", facts: { odds: 0.4 }, lang }),
    });
    assert.deepEqual(await narration.json(), lang === "it"
      ? { ok: false, error: "INVALID_FIELDS", usageKnown: true }
      : { ok: false, offline: true });
  }

  const oversized = await fetch(`${baseURL}/api/twin`, { method: "POST", body: "x".repeat(3_500_001) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, "BODY_TOO_LARGE");
  console.log("Gateway offline response, image type validation and request byte cap passed");

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: "reduce", locale: "en-US" });
  await enableTestSpeech(context);
  const externalRequests = [];
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== baseURL) {
      externalRequests.push(route.request().url());
      await route.abort();
    } else if (payslipAvailable && process.env.DOPPEL_SMOKE_PAYSLIP && route.request().url().endsWith("/samples/payslip.svg")) {
      await route.fulfill({ path: payslipPath, contentType: "image/svg+xml" });
    } else {
      await route.continue();
    }
  });

  const page = await context.newPage();
  const errors = [];
  const ocrAssets = new Set();
  const gatewayCalls = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/tesseract/")) ocrAssets.add(url.pathname);
    // Model calls only: the dashboard also asks `GET /api/twin` once after mount whether an assistant is connected.
    if (url.pathname === "/api/twin" && request.method() === "POST") gatewayCalls.push(request.postDataJSON());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  trackHydration(page, errors);
  await visit(page);
  await page.getByRole("button", { name: "Dictate your what-if" }).click();
  await page.getByText("Review the transcript, then select Simulate.").waitFor();
  assert.equal(await page.getByRole("textbox", { name: "What-if for your twin" }).inputValue(), "Retire at 60");
  assert.equal(gatewayCalls.length, 0);
  assert.equal(ocrAssets.size, 0);
  await assertNoOverflow(page);

  const qr = await scan(page, "QR-bill");
  check(qr, 0, "qr", "bill", 412);
  assert.equal(ocrAssets.size, 0);
  const editedLabel = "Insurance from review";
  await qr.card.getByLabel("Label", { exact: true }).fill(editedLabel);
  await qr.card.getByLabel("Creditor").fill(editedLabel);
  assert.equal(await page.getByText(editedLabel, { exact: false }).count(), 0);
  await qr.card.getByRole("button", { name: "Add to twin" }).click();
  await page.getByText(editedLabel, { exact: false }).first().waitFor();

  const repeat = await scan(page, "QR-bill");
  check(repeat, 0, "cache", "bill", 412);
  await repeat.card.getByRole("button", { name: "Discard" }).click();
  assert.equal(gatewayCalls.length, 0);

  const decoy = await QRCode.toDataURL("https://example.invalid", { width: 400 });
  const phonePhoto = await page.evaluate(async (decoyUrl) => {
    const load = async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      return image;
    };
    const fullBill = await load("/samples/qr-bill.svg");
    const unrelatedQr = await load(decoyUrl);
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 3400;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e1ddd2";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(145, 190, 2100, 2970);
    ctx.drawImage(unrelatedQr, 320, 350);
    ctx.drawImage(fullBill, 292, 150, 184, 184, 1550, 2460, 460, 460);
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  }, decoy);
  await page.locator('input[type="file"][accept="image/*"]:not([capture])').setInputFiles({
    name: "qr-phone-photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from(phonePhoto, "base64"),
  });
  const photoReview = page.getByRole("form", { name: "Review scan" });
  await photoReview.waitFor();
  assert.equal(await photoReview.getAttribute("data-route"), "qr");
  assert.equal(await photoReview.getByLabel("Amount (CHF)").inputValue(), "412");
  await photoReview.getByRole("button", { name: "Discard" }).click();
  assert.equal(ocrAssets.size, 0);
  console.log("A4-style JPEG with a second, unrelated QR decoded CHF 412 at Tier 0");

  const receipt = await scan(page, "Receipt");
  check(receipt, 1, "local-regex", "receipt", 87.45);
  assert.equal(await receipt.card.getByLabel(/^Item \d+ name$/).count(), 13);
  await receipt.card.getByRole("button", { name: "Discard" }).click();

  const market = await uploadReceipt(page, "en");
  assert.equal(await market.getAttribute("data-route"), "local-regex");
  assert.equal(await market.getByLabel(/^Item \d+ name$/).count(), 6);
  assert.equal(await market.getByLabel("Item 1 name").inputValue(), "Vollmilch");
  assert.equal(await market.getByLabel("Item 6 amount (CHF)").inputValue(), "-2");
  assert.equal(await market.getByLabel("Total (CHF)").inputValue(), "47.3");
  await market.getByText("Items CHF 47.30 · Total CHF 47.30").waitFor();
  await captureReceiptReview(page, market, "en");
  await market.getByLabel("Item 1 amount (CHF)").fill("4.90");
  await market.getByText(DICTIONARIES.en.receipt.mismatch).waitFor();
  await market.getByLabel("Item 1 amount (CHF)").fill("3.90");
  await market.getByRole("button", { name: "Remove item 6" }).click();
  await market.getByRole("button", { name: "Add item" }).click();
  await market.getByLabel("Item 6 name").fill("Corrected discount");
  await market.getByLabel("Item 6 amount (CHF)").fill("-2.00");
  await market.getByLabel("Category").selectOption("shopping");
  await market.getByText("Items CHF 47.30 · Total CHF 47.30").waitFor();
  await market.getByRole("button", { name: "Add to twin" }).click();
  const itemSummary = page.getByText("6 items · CHF 47.30", { exact: true });
  await itemSummary.click();
  await page.getByText("Corrected discount", { exact: true }).waitFor();
  await page.getByTitle(DICTIONARIES.en.badge.title).click();
  const receiptInspector = page.getByRole("dialog", { name: DICTIONARIES.en.inspector.title });
  await receiptInspector.getByText("6 items · CHF 47.30", { exact: true }).click();
  await receiptInspector.getByText("Corrected discount", { exact: true }).waitFor();
  await receiptInspector.getByRole("button", { name: DICTIONARIES.en.inspector.closeAria }).click();
  console.log("Receipt upload, item edits, sum warning, confirmation and Inspector details passed");

  const listing = await scan(page, "Listing");
  check(listing, 1, "local-regex", "listing", 940_000);
  await listing.card.getByRole("button", { name: "Discard" }).click();
  assert.equal(gatewayCalls.length, 0);

  if (payslipAvailable) {
    const payslip = await scan(page, "Payslip");
    check(payslip, 1, "local-regex", "payslip", 8650);
    assert.equal(gatewayCalls.length, 0);
    await payslip.card.getByRole("button", { name: "Discard" }).click();
  } else {
    console.log("Payslip fixture is supplied by the companion branch. Set DOPPEL_SMOKE_PAYSLIP to its path to include it before merge.");
  }

  const note = await scan(page, "Note");
  // The note's OCR confidence sits near the 65% line and differs by machine: below it the note goes to Tier 2 (image
  // to the vision model), above it it stays on Tier 1 (OCR text to the text model). Both end in the offline heuristic.
  assert.ok(note.tier === 1 || note.tier === 2, `note tier ${note.tier}`);
  assert.deepEqual([note.route, note.kind], ["offline-heuristic", "note"]);
  if (note.outcome === "partial") {
    assert.equal(note.amount, "");
    await note.card.getByText(/could not find an amount/).waitFor();
    assert.equal(await note.card.getByRole("button", { name: "Add to twin" }).isEnabled(), false);
    await note.card.getByLabel("Amount (CHF)").fill("25000");
    assert.equal(await note.card.getByRole("button", { name: "Add to twin" }).isEnabled(), true);
  } else {
    assert.equal(note.outcome, "ok");
    assert.equal(Number(note.amount), 25_000);
  }
  await assertNoOverflow(page);
  await note.card.getByRole("button", { name: "Discard" }).click();
  if (note.tier === 2) assert.ok(gatewayCalls.some((entry) => entry.task === "extract_image" && entry.image.startsWith("data:image/jpeg;base64,")));
  else {
    assert.ok(gatewayCalls.some((entry) => entry.task === "extract_text"));
    console.log(`Note stayed on Tier 1 here (${note.confidence}); the Tier 2 image call was not exercised by this step.`);
  }
  assert.ok(ocrAssets.has("/tesseract/runtime/worker.min.js"));
  assert.ok(["eng", "deu", "fra"].every((lang) => ocrAssets.has(`/tesseract/${lang}.traineddata.gz`)));
  assert.equal([...ocrAssets].filter((path) => path.endsWith(".wasm.js")).length, 1);

  const dateOnlyNote = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111";
    ctx.font = "40px Arial";
    ctx.fillText("Sabbatical in 2028", 100, 170);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[type="file"][accept="image/*"]:not([capture])').setInputFiles({
    name: "year-only-note.png", mimeType: "image/png", buffer: Buffer.from(dateOnlyNote, "base64"),
  });
  const yearReview = page.getByRole("form", { name: "Review scan" });
  await yearReview.waitFor();
  assert.equal(await yearReview.getAttribute("data-outcome"), "partial");
  assert.equal(await yearReview.getByLabel("Amount (CHF)").inputValue(), "");
  assert.equal(await yearReview.getByLabel("Year", { exact: true }).inputValue(), "2028");
  assert.equal(await yearReview.getByRole("button", { name: "Add to twin" }).isEnabled(), false);
  await yearReview.getByLabel("Amount (CHF)").fill("25000");
  assert.equal(await yearReview.getByRole("button", { name: "Add to twin" }).isEnabled(), true);
  await yearReview.getByRole("button", { name: "Discard" }).click();
  console.log("A date-only note requested manual entry instead of treating its year as an amount");

  await page.evaluate(() => localStorage.setItem("doppel:force-llm", "1"));
  const forced = await scan(page, "Receipt");
  check(forced, 2, "offline-heuristic", "receipt", 87.45);
  assert.equal(gatewayCalls.at(-1).task, "extract_text");
  assert.equal(gatewayCalls.at(-1).receipt, true);
  assert.equal(typeof gatewayCalls.at(-1).image, "undefined");
  await forced.card.getByRole("button", { name: "Discard" }).click();
  await page.route("**/api/twin", (route) => route.fulfill({
    json: {
      ok: true,
      data: { kind: "receipt", merchant: "Alpina Markt", amount: 87.45, currency: "CHF", items: [{ name: "Vollmilch", amount: 1.65 }] },
      usage: { promptTokens: 120, completionTokens: 40, costUsd: 0.000028, model: "Test model" },
    },
  }), { times: 1 });
  const unbalanced = await scan(page, "Receipt");
  assert.deepEqual([unbalanced.tier, unbalanced.route, unbalanced.outcome, unbalanced.amount], [2, "text-llm", "partial", "87.45"]);
  await unbalanced.card.getByText(DICTIONARIES.en.receipt.mismatch).waitFor();
  await unbalanced.card.getByRole("button", { name: "Discard" }).click();
  await page.evaluate(() => localStorage.removeItem("doppel:force-llm"));

  // Vision floor-plan & chart mocked gateway smoke steps
  const mockPlanData = {
    statedRooms: 4.5,
    statedLivingAreaM2: 112,
    balconyAreaM2: 14,
    priceChf: 940_000,
    location: "Winterthur",
    rooms: [
      { name: "Wohnen", type: "living", areaM2: 26.0, widthM: 5.2, lengthM: 5.0 },
      { name: "Essbereich (offen)", type: "dining", areaM2: 10.4, widthM: 3.25, lengthM: 3.2 },
      { name: "Eltern", type: "bedroom", areaM2: 17.6, widthM: 4.4, lengthM: 4.0 },
      { name: "Zimmer 2", type: "bedroom", areaM2: 14.4, widthM: 4.0, lengthM: 3.6 },
      { name: "Zimmer 3 / Büro", type: "office", areaM2: 12.6, widthM: 3.6, lengthM: 3.5 },
      { name: "Küche", type: "kitchen", areaM2: 10.8, widthM: 3.6, lengthM: 3.0 },
      { name: "Bad / WC", type: "bath", areaM2: 7.2, widthM: 3.0, lengthM: 2.4 },
      { name: "DU / WC", type: "bath", areaM2: 4.2, widthM: 2.1, lengthM: 2.0 },
      { name: "Entrée / Korridor", type: "hall", areaM2: 8.8, widthM: 4.4, lengthM: 2.0 },
      { name: "Balkon", type: "balcony", areaM2: 14.0, widthM: 5.0, lengthM: 2.8 },
    ],
  };
  await page.route("**/api/twin", (route) => route.fulfill({
    json: {
      ok: true,
      data: mockPlanData,
      usage: { promptTokens: 285, completionTokens: 112, costUsd: 0.000073, model: "google/gemini-2.5-flash-lite" },
    },
  }), { times: 1 });
  const planScan = await scan(page, "Plan");
  check(planScan, 2, "vision-plan", "listing", 940_000);
  assert.equal(gatewayCalls.at(-1).task, "extract_floorplan");
  await planScan.card.getByTestId("vision-plan-headline").waitFor();
  const planHeadlineText = await planScan.card.getByTestId("vision-plan-headline").textContent();
  assert.match(planHeadlineText, /4\.5 rooms · 112 m² · CHF 8’390\/m² · 6% above the Winterthur median/);
  await captureVisionShot(page, planScan.card, "plan-review", "en");
  await planScan.card.getByRole("button", { name: "Add to twin" }).click();
  await page.getByTestId("afford-floorplan").waitFor();

  const mockChartData = {
    accountType: "portfolio",
    provider: "LemanInvest",
    printedTotalChf: 114_000,
    allocation: { equitiesPct: 70, bondsPct: 18, realEstatePct: 7, cashPct: 5, otherPct: 0 },
    series: [
      { month: "2026-01", valueChf: 116_000 },
      { month: "2026-03", valueChf: 125_000 },
      { month: "2026-05", valueChf: 112_000 },
      { month: "2026-06", valueChf: 106_000 },
      { month: "2026-08", valueChf: 109_000 },
      { month: "2026-09", valueChf: 110_500 },
      { month: "2026-11", valueChf: 114_000 },
    ],
  };
  await page.route("**/api/twin", (route) => route.fulfill({
    json: {
      ok: true,
      data: mockChartData,
      usage: { promptTokens: 240, completionTokens: 96, costUsd: 0.000062, model: "google/gemini-2.5-flash-lite" },
    },
  }), { times: 1 });
  await page.getByRole("button", { name: "Chart", exact: true }).click();
  const chartCard = page.getByRole("form", { name: "Review scan" });
  await chartCard.waitFor({ timeout: 45_000 });
  assert.equal(await chartCard.getAttribute("data-route"), "vision-chart");
  assert.equal(await chartCard.getAttribute("data-outcome"), "ok");
  assert.equal(gatewayCalls.at(-1).task, "extract_chart");
  const chartHeadlineText = await chartCard.getByTestId("vision-chart-headline").textContent();
  assert.match(chartHeadlineText, /Portfolio CHF 114’000 · 70% equities \(Growth\) · 15\.2% max drawdown/);
  await captureVisionShot(page, chartCard, "chart-review", "en");
  await chartCard.getByRole("button", { name: "Add to twin" }).click();

  if (visionScreenshots) {
    await page.getByTitle(DICTIONARIES.en.badge.title).click();
    const enInspector = page.getByRole("dialog", { name: DICTIONARIES.en.inspector.title });
    await enInspector.getByRole("button", { name: /Snap · Plan/ }).click();
    await captureVisionShot(page, enInspector, "inspector", "en");
    await enInspector.getByRole("button", { name: DICTIONARIES.en.inspector.closeAria }).click();
  }
  console.log("Mocked vision-plan and vision-chart scans, deterministic verification, and review confirmation passed");

  const recovery = await browser.newContext({ locale: "en-US" });
  await enableTestSpeech(recovery);
  let abortWorker = true;
  await recovery.route("**/tesseract/runtime/worker.min.js", (route) => abortWorker ? route.abort() : route.continue());
  const recoveryPage = await recovery.newPage();
  recoveryPage.on("pageerror", (error) => errors.push(error.message));
  trackHydration(recoveryPage, errors);
  await visit(recoveryPage);
  const failed = await scan(recoveryPage, "Receipt");
  assert.deepEqual([failed.tier, failed.route, failed.outcome], [2, "offline-heuristic", "failed"]);
  await failed.card.getByRole("button", { name: "Discard" }).click();
  abortWorker = false;
  const recovered = await scan(recoveryPage, "Receipt");
  check(recovered, 1, "local-regex", "receipt", 87.45);
  console.log("OCR recovered on a second snap after a blocked worker request");

  const localeCases = [
    { name: "Deutsch", code: "de", tag: "de-CH", percent: "%" },
    { name: "Français", code: "fr", tag: "fr-CH", percent: "\u202f%" },
    { name: "Türkçe", code: "tr", tag: "tr-TR", percent: "%" },
  ];
  for (const { name, code, tag, percent } of localeCases) {
    const L = (key, params) => translate(code, key, params);
    const language = page.getByTestId("lang-select");
    assert.equal(await language.locator(`option[value="${code}"]`).getAttribute("aria-label"), name);
    await language.selectOption(code);
    await page.waitForFunction((lang) => document.documentElement.lang === lang, tag);
    assert.equal(await language.inputValue(), code);
    assert.equal(await page.evaluate(() => localStorage.getItem("doppel:locale")), code);
    const headline = await page.locator("h1 .num").textContent();
    assert.ok(code === "tr" ? headline.startsWith(percent) : headline.endsWith(percent), headline);

    await page.getByRole("button", { name: L("cmd.dictate") }).click();
    await page.getByText(L("speech.review")).waitFor();
    assert.equal(await page.evaluate(() => window.testSpeechLanguage), tag);

    // Only the first examples show by default; expand once (the toggle then reads "Fewer examples").
    const moreExamples = page.getByRole("button", { name: L("cmd.moreExamples"), exact: true });
    if (await moreExamples.count()) {
      await moreExamples.click();
      assert.equal(await page.getByRole("button", { name: L("cmd.fewerExamples"), exact: true }).getAttribute("aria-expanded"), "true");
    }
    const callsBefore = gatewayCalls.length;
    await page.getByRole("button", { name: L("cmd.examples.retire"), exact: true }).click();
    await page.getByText(new RegExp(escapeRegExp(L("cmd.parsedLocally")))).waitFor();
    assert.equal(gatewayCalls.length, callsBefore);
    await assertNoOverflow(page);
  }

  // The last case leaves Turkish active.
  const T = (key, params) => translate("tr", key, params);
  if (receiptScreenshots) {
    const turkish = await browser.newContext({ locale: "tr-TR", viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
    const turkishPage = await turkish.newPage();
    await turkishPage.goto(baseURL);
    const turkishReceipt = await uploadReceipt(turkishPage, "tr");
    await turkishReceipt.getByText(T("receipt.sum", { sum: "CHF 47.30", total: "CHF 47.30" })).waitFor();
    await captureReceiptReview(turkishPage, turkishReceipt, "tr");
    await turkish.close();
  }
  await page.getByTitle(T("badge.title")).click();
  const inspector = page.getByRole("dialog", { name: T("inspector.title") });
  await inspector.getByRole("button", { name: new RegExp(escapeRegExp(T("ledger.snap", { name: { key: "snap.samples.qr" } }))) }).click();
  await inspector.getByText(T("step.qrScan", { area: { key: "step.areaFull" } }), { exact: true }).waitFor();
  if (visionScreenshots) {
    await inspector.getByRole("button", { name: new RegExp(escapeRegExp(T("ledger.snap", { name: { key: "snap.samples.plan" } }))) }).click();
    await captureVisionShot(page, inspector, "inspector", "tr");
  }
  await inspector.getByRole("button", { name: T("inspector.closeAria") }).click();

  if (visionScreenshots) {
    await page.evaluate(() => localStorage.removeItem("doppel:snap-cache:v1"));
    await page.route("**/api/twin", (route) => route.fulfill({
      json: {
        ok: true,
        data: mockPlanData,
        usage: { promptTokens: 285, completionTokens: 112, costUsd: 0.000073, model: "google/gemini-2.5-flash-lite" },
      },
    }), { times: 1 });
    await page.getByRole("button", { name: T("snap.samples.plan"), exact: true }).click();
    const trPlanCard = page.getByRole("form", { name: T("review.formAria") });
    await trPlanCard.waitFor({ timeout: 45_000 });
    await captureVisionShot(page, trPlanCard, "plan-review", "tr");
    await trPlanCard.getByRole("button", { name: T("review.discard") }).click();

    await page.route("**/api/twin", (route) => route.fulfill({
      json: {
        ok: true,
        data: mockChartData,
        usage: { promptTokens: 240, completionTokens: 96, costUsd: 0.000062, model: "google/gemini-2.5-flash-lite" },
      },
    }), { times: 1 });
    await page.getByRole("button", { name: T("snap.samples.chart"), exact: true }).click();
    const trChartCard = page.getByRole("form", { name: T("review.formAria") });
    await trChartCard.waitFor({ timeout: 45_000 });
    await captureVisionShot(page, trChartCard, "chart-review", "tr");
    await trChartCard.getByRole("button", { name: T("review.discard") }).click();
  }

  await page.getByRole("button", { name: T("banker.explain") }).click();
  await page.getByText(new RegExp(escapeRegExp(fixedFragment(DICTIONARIES.tr.narr.goal)))).waitFor();
  assert.equal(gatewayCalls.at(-1).task, "narrate");
  assert.equal(gatewayCalls.at(-1).lang, "tr");

  // Account switcher by keyboard: Barlas → Oktay changes the headline and survives a reload.
  const switcher = (name) => page.getByRole("button", { name: T("header.switchAria", { name }) });
  // The whole headline (goal + odds): earlier steps may leave both accounts at the same odds.
  const barlasHeadline = await page.locator("h1").textContent();
  await switcher("Barlas").press("ArrowDown");
  await page.getByRole("menu", { name: T("header.menu") }).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await switcher("Oktay").waitFor();
  assert.notEqual(await page.locator("h1").textContent(), barlasHeadline);
  assert.equal(await page.evaluate(() => localStorage.getItem("doppel:account")), "oktay");
  await assertNoOverflow(page);

  const reloaded = await page.reload();
  assert.match(await reloaded.text(), /<html lang="en"/);
  await page.waitForFunction(() => document.documentElement.lang === "tr-TR");
  await switcher("Oktay").waitFor();
  console.log("Account switcher: keyboard switch, headline change and persistence across reload passed");

  // UBS synthetic profiles: open Alexia from the picker (headline + her three paths), then a profile with debt.
  {
    const E = DICTIONARIES.en.ubs;
    const ubsContext = await browser.newContext({ locale: "en-US", viewport: { width: 320, height: 800 } });
    const ubsPage = await ubsContext.newPage();
    ubsPage.on("pageerror", (error) => errors.push(error.message));
    trackHydration(ubsPage, errors);
    await visit(ubsPage);
    const ubsSwitcher = (name) => ubsPage.getByRole("button", { name: translate("en", "header.switchAria", { name }) });
    const openPicker = async (current) => {
      await ubsSwitcher(current).click();
      await ubsPage.getByRole("menuitem", { name: new RegExp(escapeRegExp(E.openProfile)) }).click();
      const picker = ubsPage.getByRole("dialog", { name: E.pickerTitle });
      await picker.waitFor();
      return picker;
    };
    let picker = await openPicker("Barlas");
    assert.equal(await picker.locator("[data-ubs-id]").first().getAttribute("data-ubs-id"), ALEXIA_ID);
    await assertNoOverflow(ubsPage);
    await picker.locator(`[data-ubs-id="${ALEXIA_ID}"]`).click();
    await ubsSwitcher("Alexia").waitFor();
    const alexiaHeadline = await ubsPage.locator("h1").textContent();
    assert.match(alexiaHeadline, new RegExp(escapeRegExp(E.goalName.emergency)));
    assert.match(alexiaHeadline, /\d+%/);
    const paths = ubsPage.getByTestId("alexia-paths");
    await paths.waitFor();
    assert.equal(await paths.locator("[data-path]").count(), 3);
    await paths.locator("[data-path=master] dd").first().waitFor();
    await paths.locator("[data-path=work] [data-action=apply]").click();
    // The pill's clear button is named after the pill (the auto-pinned Plan A chip repeats the label).
    await ubsPage.getByRole("button", { name: translate("en", "pill.clear", { label: { key: "ubs.pillPath", params: { label: { key: "ubs.path.work" } } } }) }).waitFor();
    await ubsPage.getByTestId("goals-card").waitFor();
    await ubsPage.getByTestId("ubs-source").waitFor();
    await assertNoOverflow(ubsPage);

    const debtor = listUbsProfiles().find((p) => p.debtChf > 0);
    picker = await openPicker("Alexia");
    await picker.getByRole("checkbox", { name: E.filterDebt }).check();
    await picker.getByTestId("ubs-search").fill(debtor.id);
    await picker.locator(`[data-ubs-id="${debtor.id}"]`).click();
    await ubsSwitcher(debtor.name).waitFor();
    const debtCard = ubsPage.getByTestId("debt-card");
    await debtCard.waitFor();
    const chf = `CHF ${Math.round(debtor.debtChf).toLocaleString("en").replace(/,/g, "’")}`;
    assert.match(await debtCard.textContent(), new RegExp(escapeRegExp(chf)));
    await debtCard.getByRole("button", { name: E.debtMore }).click();
    await ubsPage.getByRole("button", { name: translate("en", "pill.clear", { label: { key: "ubs.pillDebt", params: { amount: 100 } } }) }).waitFor();
    await assertNoOverflow(ubsPage);
    const stored = await ubsPage.evaluate(() => JSON.parse(localStorage.getItem("doppel:accounts:v1") ?? "{}").ubs);
    assert.deepEqual(stored, [ALEXIA_ID, debtor.id]);
    await ubsPage.reload();
    await ubsSwitcher(debtor.name).waitFor();
    await ubsPage.getByTestId("debt-card").waitFor();
    await ubsContext.close();
    console.log(`UBS profiles: Alexia from the picker (headline, 3 paths, apply), debt profile ${debtor.id} shows ${chf}, persisted across reload at 320px`);
  }

  const preferenceContext = await browser.newContext({ locale: "fr-CH" });
  const preferencePage = await preferenceContext.newPage();
  trackHydration(preferencePage, errors);
  preferencePage.on("pageerror", (error) => errors.push(error.message));
  await preferencePage.goto(baseURL);
  await preferencePage.waitForFunction(() => document.documentElement.lang === "fr-CH");
  await preferenceContext.close();
  console.log("Locale switching, persistence, browser preference, speech, offline narration, and English SSR passed at 320px");

  // Doppel Play: open /play, play two moves, the engine review appears, branch once, and the nav links back.
  {
    const play = await browser.newContext({ locale: "en-US", viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
    const playPage = await play.newPage();
    playPage.on("pageerror", (error) => errors.push(error.message));
    trackHydration(playPage, errors);
    const P = (key, params) => translate("en", key, params);
    await playPage.goto(baseURL + "/play");
    const review = playPage.getByTestId("play-review");
    const playable = playPage.locator("#play-move").locator("xpath=ancestor::section").getByTestId("play-card");
    await playPage.locator("[data-card=pathWork][data-testid=play-card]").click();
    await playPage.waitForFunction(() => document.querySelector("[data-testid=play-review]")?.getAttribute("data-label"), null, { timeout: 30_000 });
    const first = await review.getAttribute("data-label");
    assert.ok(["brilliant", "best", "good", "inaccuracy", "mistake", "blunder", "lifeChoice"].includes(first), first);
    await review.getByText(P("play.review.lineEngine"), { exact: true }).waitFor();
    assert.ok((await review.getByTestId("play-explain").textContent()).length > 20);
    await playable.first().waitFor();
    await playable.first().click();
    await playPage.getByTestId("play-move").nth(1).waitFor();
    await playPage.waitForFunction(() => document.querySelectorAll("[data-testid=play-move]").length === 2 && document.querySelector("[data-testid=play-review]")?.getAttribute("data-label"), null, { timeout: 30_000 });
    // Branch: open the first move, play another card instead.
    await playPage.getByTestId("play-move").first().click();
    await playPage.getByText(P("play.moves.whatIf"), { exact: true }).waitFor();
    const alternative = playPage.getByTestId("play-whatif").first();
    await alternative.waitFor({ timeout: 30_000 });
    await alternative.click();
    await playPage.getByTestId("play-branch").waitFor();
    assert.equal(await playPage.getByTestId("play-move").count(), 1);
    await playPage.getByRole("button", { name: P("play.moves.main") }).click();
    assert.equal(await playPage.getByTestId("play-move").count(), 2);
    await assertNoOverflow(playPage);
    await playPage.getByRole("navigation", { name: P("play.nav.aria") }).getByRole("link", { name: P("play.nav.dashboard") }).click();
    await playPage.getByRole("button", { name: "Dictate your what-if" }).waitFor();
    await play.close();
    console.log("Doppel Play: two moves reviewed (" + first + "), branch and return to the main line, nav back to the dashboard passed at 320px");
  }


  // Dashboard UX: 320px header in every language, the statement-first card, the chart reading, the wizard and delete.
  {
    const ux = await browser.newContext({ locale: "en-US", viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
    const uxPage = await ux.newPage();
    uxPage.on("pageerror", (error) => errors.push(error.message));
    trackHydration(uxPage, errors);
    await visit(uxPage);
    const U = (key, params) => translate("en", key, params);

    // Header: the Play link stays reachable (nothing lies on top of it) and the logo keeps its size, in each language.
    for (const code of ["de", "fr", "tr", "en"]) {
      await uxPage.getByTestId("lang-select").selectOption(code);
      await uxPage.waitForFunction((lang) => localStorage.getItem("doppel:locale") === lang, code);
      const header = await uxPage.evaluate(() => {
        const link = document.querySelector('header a[href="/play"]');
        const box = link.getBoundingClientRect();
        const hit = [box.left + 3, (box.left + box.right) / 2, box.right - 3].every((x) => document.elementFromPoint(x, box.top + box.height / 2) === link);
        return { hit, logo: Math.round(document.querySelector("header span[aria-hidden]").getBoundingClientRect().width) };
      });
      assert.deepEqual(header, { hit: true, logo: 28 }, code);
      await assertNoOverflow(uxPage);
    }
    assert.equal(await uxPage.title(), U("ux.docTitle"));
    await uxPage.getByTestId("lang-select").selectOption("tr");
    await uxPage.waitForFunction((title) => document.title === title, translate("tr", "ux.docTitle"));
    await uxPage.waitForTimeout(1000); // a late head re-render must not put the English title back
    assert.equal(await uxPage.title(), translate("tr", "ux.docTitle"));
    await uxPage.getByTestId("lang-select").selectOption("en");
    await uxPage.waitForFunction((title) => document.title === title, U("ux.docTitle"));

    // Statement first: the upload is the first data action, document photos are collapsed below it.
    const statement = uxPage.getByTestId("statement-card");
    await statement.getByRole("button", { name: U("data.chooseFile") }).waitFor();
    assert.equal(await statement.getByTestId("other-docs").evaluate((el) => el.open), false);
    const learned = statement.getByTestId("learned");
    assert.ok((await learned.getByTestId("learned-headline").locator("li").count()) >= 3);
    assert.match(await statement.locator('input[type="file"]').first().getAttribute("accept"), /\.sta,\.mt940,\.940/);
    await statement.getByTestId("statement-samples").locator("summary").click();
    await statement.getByRole("button", { name: U("data.sampleAria", { account: "Meriç", provider: "PostFinance", format: "camt.053" }) }).click();
    const review = statement.getByRole("form", { name: U("data.reviewAria") });
    await review.getByRole("button", { name: U("data.confirm", { count: 220 }) }).waitFor({ timeout: 30_000 });
    const merchantWidth = await review.getByTestId("import-rows").locator("li span[title]").first().evaluate((el) => el.getBoundingClientRect().width);
    assert.ok(merchantWidth > 60, `merchant column is ${merchantWidth}px wide`);
    await assertNoOverflow(uxPage);
    await review.getByRole("button", { name: U("data.confirm", { count: 220 }) }).click();
    await statement.getByText(U("data.imported", { transactions: 220, trades: 0, file: "meric-postfinance.camt053.xml" })).waitFor();
    // The summary now knows the salary of that statement and proposes life facts with a confirm / reject control.
    await learned.locator("[data-fact=salary]").waitFor();
    await learned.locator("[data-fact=salary]").getByRole("button", { name: U("statement.reject") }).click();
    assert.equal(await learned.locator("[data-fact=salary]").count(), 0);
    await assertNoOverflow(uxPage);

    // Chart: a text alternative, a plain-language reading, and the before line once a what-if is applied.
    const chart = uxPage.getByTestId("cone-chart");
    assert.equal(await chart.getAttribute("role"), "img");
    assert.ok((await chart.getAttribute("aria-label")).length > 80);
    const linesBefore = await uxPage.getByTestId("chart-reading").locator("li").count();
    assert.ok(linesBefore >= 3);
    assert.equal(await uxPage.getByRole("button", { name: U("cmd.examples.delay"), exact: true }).count(), 0, "no home on the timeline: the delay example is hidden");
    await uxPage.getByRole("button", { name: U("cmd.examples.crash"), exact: true }).click();
    await uxPage.getByTestId("chart-before").waitFor();
    assert.equal(await uxPage.getByTestId("chart-reading").locator("li").count(), linesBefore + 1);
    await uxPage.getByRole("textbox", { name: U("cmd.inputAria") }).fill("retire at 30");
    await uxPage.keyboard.press("Enter");
    await uxPage.getByText(U("ux.cmdRetireRange", { min: 55, max: 70 })).waitFor();
    await assertNoOverflow(uxPage);

    // Wizard: a validation message instead of a dead button, the statement step, then the review of that statement.
    const switcherOf = (name) => uxPage.getByRole("button", { name: U("header.switchAria", { name }) });
    await switcherOf("Barlas").click();
    await uxPage.getByRole("menuitem", { name: U("data.newAccount") }).click();
    const wizard = uxPage.getByRole("dialog", { name: U("data.wizardTitle") });
    await wizard.getByTestId("wizard-next").click();
    await wizard.getByText(U("ux.wiz.errName")).waitFor();
    await wizard.getByLabel(U("data.wizardName")).fill("Smoke Test");
    await wizard.getByTestId("wizard-next").click();
    await wizard.getByRole("button", { name: /PostFinance/ }).click();
    await wizard.getByTestId("wizard-facts").waitFor({ timeout: 20_000 });
    await assertNoOverflow(uxPage);
    for (let step = 0; step < 5; step++) await wizard.getByTestId("wizard-next").click();
    await wizard.getByTestId("wizard-summary").waitFor();
    await wizard.getByRole("button", { name: U("ux.wiz.createAndReview") }).click();
    await switcherOf("Smoke Test").waitFor();
    await uxPage.getByTestId("statement-card").getByRole("form", { name: U("data.reviewAria") }).waitFor({ timeout: 30_000 });
    assert.equal(await uxPage.evaluate(() => document.activeElement?.closest("[data-testid=statement-card]") !== null), true);

    // Delete asks once more, then focus is back on the account button.
    await switcherOf("Smoke Test").click();
    const remove = uxPage.getByTestId("delete-account");
    await remove.click();
    await remove.getByText(U("ux.confirmDelete", { name: "Smoke Test" })).waitFor();
    await switcherOf("Smoke Test").waitFor();
    await remove.click();
    await switcherOf("Barlas").waitFor();
    assert.equal(await uxPage.evaluate(() => document.activeElement?.getAttribute("aria-haspopup")), "menu");
    await ux.close();
    console.log("Dashboard UX: 320px header in four languages, statement-first card and review, chart reading, wizard validation + statement step, and confirmed delete passed");
  }


  // Decisions, outlook, economy and the assistant state (the gateway is offline in this run).
  {
    const twin = await browser.newContext({ locale: "en-US", viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
    const twinPage = await twin.newPage();
    twinPage.on("pageerror", (error) => errors.push(error.message));
    trackHydration(twinPage, errors);
    await visit(twinPage);
    const W = (key, params) => translate("en", key, params);
    const outlookCard = twinPage.getByTestId("outlook-card");
    await outlookCard.getByTestId("outlook-goal").waitFor({ timeout: 30_000 });

    // Economy: the headline is never shown without its economy, and another scenario changes it.
    assert.equal(await twinPage.getByTestId("hero-economy").textContent(), W("ux.econ.chip", { name: { key: "economy.name.baseline" } }));
    const baselineHeadline = await twinPage.locator("h1").textContent();
    await twinPage.getByTestId("economy-select").selectOption("high_inflation");
    await twinPage.waitForFunction((before) => document.querySelector("h1")?.textContent !== before, baselineHeadline, { timeout: 30_000 });
    assert.equal(await twinPage.getByTestId("hero-economy").textContent(), W("ux.econ.chip", { name: { key: "economy.name.high_inflation" } }));
    await twinPage.getByTestId("economy-summary").waitFor();
    await twinPage.getByTestId("economy-table").locator("summary").click();
    assert.ok((await twinPage.getByTestId("economy-table").locator("li").count()) > 20);
    await assertNoOverflow(twinPage);
    await twinPage.getByTestId("economy-select").selectOption("baseline");
    await twinPage.waitForFunction((before) => document.querySelector("h1")?.textContent === before, baselineHeadline, { timeout: 30_000 });

    // A car (leased, the engine's sourced defaults) and a child from the picker: itemised monthly costs and chart markers.
    const addDecision = async (kind, fill) => {
      await twinPage.getByTestId("add-decision").click();
      await twinPage.getByTestId("decision-picker").locator(`[data-kind=${kind}]`).click();
      const form = twinPage.getByTestId("decision-form");
      await form.waitFor();
      if (fill) await fill(form);
      return form;
    };
    const car = await addDecision("car", (form) => form.getByLabel(W("ux.dec.f.carMode")).selectOption("leased"));
    await car.getByTestId("decision-apply").click();
    const carCost = outlookCard.locator("[data-testid=outlook-decisions] > li[data-kind=car]");
    await carCost.waitFor({ timeout: 30_000 });
    assert.ok((await carCost.getByTestId("decision-lines").locator("li").count()) >= 3);
    assert.match(await carCost.getByTestId("decision-lines").textContent(), new RegExp(escapeRegExp(W("life.line.carLease"))));
    assert.match(await carCost.getByTestId("decision-net").textContent(), /CHF \d/);
    const child = await addDecision("child");
    await child.getByTestId("decision-apply").click();
    const childCost = outlookCard.locator("[data-testid=outlook-decisions] > li[data-kind=child]");
    await childCost.waitFor({ timeout: 30_000 });
    assert.ok((await childCost.getByTestId("decision-lines").locator("li").count()) >= 3);
    assert.match(await childCost.getByTestId("decision-lines").textContent(), new RegExp(escapeRegExp(W("life.line.childDirect"))));
    assert.equal(await twinPage.getByTestId("decision-list").locator("li[data-kind=car], li[data-kind=child]").count(), 2);
    assert.match(await outlookCard.getByTestId("outlook-goal").textContent(), /→/);
    assert.match(await outlookCard.getByTestId("outlook-surplus").textContent(), /→/);
    await twinPage.waitForFunction(
      (labels) => labels.every((label) => [...document.querySelectorAll("[data-testid=cone-chart] title")].some((title) => title.textContent === label)),
      [W("life.marker.leaseStart"), W("life.marker.childBirth")],
      { timeout: 30_000 },
    );
    await twinPage.getByTestId("chart-before").waitFor();
    await assertNoOverflow(twinPage);

    // A move has no sourced rent: Apply is refused until the required inputs are given.
    const move = await addDecision("move", (form) => form.getByLabel(W("ux.dec.f.canton")).selectOption("ZG"));
    await move.getByTestId("decision-apply").click();
    await move.getByTestId("decision-missing").waitFor();
    assert.equal(await twinPage.getByTestId("decision-list").locator("li[data-kind=move]").count(), 0);
    await move.getByRole("spinbutton", { name: new RegExp(escapeRegExp(W("life.need.moveRent"))) }).fill("2400");
    await move.getByRole("spinbutton", { name: new RegExp(escapeRegExp(W("life.need.movingCost"))) }).fill("3000");
    await move.getByTestId("decision-apply").click();
    await twinPage.getByTestId("decision-list").locator("li[data-kind=move]").waitFor();
    await assertNoOverflow(twinPage);

    // The assistant: no endpoint in this run, so the box says so and the local summary still works.
    await twinPage.waitForFunction(() => document.querySelector("[data-testid=assistant-state]")?.getAttribute("data-state") === "off");
    assert.equal(await twinPage.getByTestId("assistant-offline").textContent(), W("llm.notConnected"));
    assert.equal(await twinPage.getByTestId("ask-card").getByRole("textbox", { name: W("llm.askLabel") }).isDisabled(), true);
    await twinPage.getByTestId("ask-card").getByRole("button", { name: W("banker.explain") }).click();
    await twinPage.getByTestId("banker-source").getByText(W("ux.bankerTemplate")).waitFor();
    await twin.close();
    console.log("Twin: economy switch changes the headline, car and child decisions show itemised costs and chart markers, a move waits for its rent, the assistant reports not connected");
  }

  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log("Chromium scanner smoke passed at 320px with no remote OCR assets or scanner errors");
} catch (error) {
  if (serverLog) console.error(serverLog.trim());
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    if (server.exitCode === null) server.kill();
    await serverExited;
  }
}
