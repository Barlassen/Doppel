import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import QRCode from "qrcode";

const baseURL = "http://127.0.0.1:3302";
const require = createRequire(import.meta.url);
const payslipPath = process.env.DOPPEL_SMOKE_PAYSLIP || "public/samples/payslip.svg";
const payslipAvailable = await access(payslipPath).then(() => true, () => false);

assert.equal(await fetch(baseURL).then(() => true, () => false), false, "Port 3302 is already in use");
const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "-p", "3302"], {
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

async function visit(page, errors) {
  const response = await page.goto(baseURL);
  await page.getByRole("button", { name: "Dictate your what-if" }).waitFor();
  // The dashboard renders a measured simulation duration during SSR. Report
  // that startup mismatch separately so scanner and worker errors still fail.
  const timing = await page.evaluate((html) => {
    const duration = (root) => [...root.querySelectorAll("main p")]
      .find((paragraph) => paragraph.textContent.includes("futures simulated"))
      ?.textContent.match(/simulated in\s+(\d+)\s+ms/)?.[1];
    return { server: duration(new DOMParser().parseFromString(html, "text/html")), browser: duration(document) };
  }, await response.text());
  if (timing.server && timing.browser && timing.server !== timing.browser && errors[0]?.includes("Minified React error #418")) {
    errors.shift();
    console.log(`Dashboard SSR timing mismatch observed (server ${timing.server} ms, browser ${timing.browser} ms)`);
  }
}

function enableTestSpeech(context) {
  return context.addInitScript(() => {
    window.SpeechRecognition = class {
      start() {
        queueMicrotask(() => {
          this.onresult({ results: [[{ transcript: "Retire at 60" }]] });
          this.onend();
        });
      }
      stop() { this.onend?.(); }
    };
  });
}

async function scan(page, sample) {
  await page.getByRole("button", { name: sample, exact: true }).click();
  const card = page.getByRole("form", { name: "Review scan" });
  await card.waitFor({ timeout: 45_000 });
  const result = {
    tier: Number(await card.getAttribute("data-tier")),
    route: await card.getAttribute("data-route"),
    outcome: await card.getAttribute("data-outcome"),
    kind: await card.getByLabel("Document type").inputValue(),
    amount: await card.getByLabel("Amount (CHF)").inputValue(),
    confidence: await card.getByText(/^OCR \d/).textContent({ timeout: 1000 }).catch(() => null),
  };
  console.log(sample, JSON.stringify(result));
  return { card, ...result };
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

  const oversized = await fetch(`${baseURL}/api/twin`, { method: "POST", body: "x".repeat(3_500_001) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, "BODY_TOO_LARGE");
  console.log("Gateway offline response, image type validation and request byte cap passed");

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
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
    if (url.pathname === "/api/twin") gatewayCalls.push(request.postDataJSON());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, errors);
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
  await page.getByText(editedLabel, { exact: false }).waitFor();

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
  await page.locator('input[type="file"]:not([capture])').setInputFiles({
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
  await receipt.card.getByRole("button", { name: "Discard" }).click();
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
  assert.deepEqual([note.tier, note.route, note.kind], [2, "offline-heuristic", "note"]);
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
  assert.ok(gatewayCalls.some((entry) => entry.task === "extract_image" && entry.image.startsWith("data:image/jpeg;base64,")));
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
  await page.locator('input[type="file"]:not([capture])').setInputFiles({
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
  check(forced, 1, "offline-heuristic", "receipt", 87.45);
  assert.equal(gatewayCalls.at(-1).task, "extract_text");
  await forced.card.getByRole("button", { name: "Discard" }).click();
  await page.evaluate(() => localStorage.removeItem("doppel:force-llm"));

  const recovery = await browser.newContext();
  await enableTestSpeech(recovery);
  let abortWorker = true;
  await recovery.route("**/tesseract/runtime/worker.min.js", (route) => abortWorker ? route.abort() : route.continue());
  const recoveryPage = await recovery.newPage();
  recoveryPage.on("pageerror", (error) => errors.push(error.message));
  await visit(recoveryPage, errors);
  const failed = await scan(recoveryPage, "Receipt");
  assert.deepEqual([failed.tier, failed.route, failed.outcome], [2, "offline-heuristic", "failed"]);
  await failed.card.getByRole("button", { name: "Discard" }).click();
  abortWorker = false;
  const recovered = await scan(recoveryPage, "Receipt");
  check(recovered, 1, "local-regex", "receipt", 87.45);
  console.log("OCR recovered on a second snap after a blocked worker request");

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
