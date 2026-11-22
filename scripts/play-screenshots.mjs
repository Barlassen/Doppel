/**
 * Screenshots of /play (start, after a move with the review, the check banner, the end review) at 320×800 and
 * 1280×900 in EN and TR. Needs `npm run build`. Usage:
 *   DOPPEL_SMOKE_PORT=3348 DOPPEL_PLAY_SHOTS=./shots node scripts/play-screenshots.mjs
 * Starts its own `next start` on the port and stops exactly that process.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const port = process.env.DOPPEL_SMOKE_PORT || "3348";
const out = process.env.DOPPEL_PLAY_SHOTS || "play-shots";
const baseURL = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url);
await mkdir(out, { recursive: true });

const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "-p", port], {
  env: { ...process.env, OPENROUTER_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const exited = once(server, "exit");
for (let i = 0; i < 100; i++) {
  if (await fetch(baseURL).then((r) => r.ok, () => false)) break;
  await delay(200);
}

const reviewed = (page) => page.waitForFunction(() => document.querySelector("[data-testid=play-review]")?.getAttribute("data-label"), null, { timeout: 30_000 });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

let browser;
try {
  browser = await chromium.launch();
  for (const locale of ["en", "tr"]) {
    for (const { width, height } of [{ width: 320, height: 800 }, { width: 1280, height: 900 }]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addInitScript((l) => localStorage.setItem("doppel:locale", l), locale);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = async (name) => {
        const file = join(out, `play-${locale}-${width}x${height}-${name}.png`);
        await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
        console.log(file, "overflow", await overflow(page));
      };
      await page.goto(baseURL + "/play");
      await page.locator("[data-testid=play-card]").first().waitFor();
      await page.waitForFunction(() => !document.querySelector("#play-move")?.closest("section")?.querySelector(".pulse-soft"), null, { timeout: 30_000 });
      await shot("1-start");
      // Alexia: "Move abroad" is a mistake against "Start working" (3 points).
      await page.locator("[data-card=pathAbroad][data-testid=play-card]").click();
      await reviewed(page);
      await page.waitForFunction(() => document.querySelector("[data-testid=play-luck] .num")?.textContent !== "—", null, { timeout: 30_000 }).catch(() => {});
      await shot("2-review");
      // Oktay spends what comes in: under three months of buffer, so the game opens in check.
      await page.locator("select").first().selectOption("acct:oktay");
      await page.locator("[data-testid=play-start]").click();
      await page.locator("[data-banner=check], [data-banner=threat]").first().waitFor({ timeout: 30_000 });
      await shot("3-check");
      await page.locator("select").first().selectOption("ubs:P00001");
      await page.locator("[data-testid=play-start]").click();
      await page.locator("[data-card=pathWork][data-testid=play-card]").waitFor();
      for (let k = 0; k < 15; k++) {
        if (await page.locator("[data-testid=play-end]").count()) break;
        const card = page.locator("#play-move").locator("xpath=ancestor::section").locator("[data-testid=play-card]").first();
        await card.click();
        await delay(150);
      }
      await page.locator("[data-testid=play-end]").waitFor({ timeout: 60_000 });
      await page.waitForFunction(() => !document.querySelector("[data-testid=play-review] .pulse-soft"), null, { timeout: 60_000 }).catch(() => {});
      await shot("4-end");
      if (errors.length) console.error("page errors", errors);
      await context.close();
    }
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
  await exited;
}
