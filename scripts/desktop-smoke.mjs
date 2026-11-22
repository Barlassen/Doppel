// Drives the Doppel desktop app with Playwright's Electron support and checks what docs/DESKTOP.md promises.
//
//   node scripts/desktop-smoke.mjs                              the unpackaged app (desktop/, after `npm run stage`)
//   node scripts/desktop-smoke.mjs --app desktop/dist/mac/Doppel.app
//   node scripts/desktop-smoke.mjs --shots <dir>                where screenshots go (default: a temp folder)
//
// Every run uses its own empty data folder (DOPPEL_DESKTOP_DATA_DIR), never the user's. No key is used.
// The windows do appear on screen, but without taking the keyboard focus (DOPPEL_DESKTOP_QUIET).
// Exit code 0 only when every check passed. macOS and Linux (it reads `ps`).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const appArg = arg("--app");
const work = mkdtempSync(join(tmpdir(), "doppel-desktop-smoke-"));
const shots = resolve(arg("--shots") ?? join(work, "shots"));
const dataDir = join(work, "data");
mkdirSync(shots, { recursive: true });

function target() {
  if (!appArg) {
    const bin = process.platform === "win32" ? "electron.cmd" : "electron";
    const local = join(root, "desktop", "node_modules", ".bin", bin);
    const executablePath = execFileSync(process.execPath, ["-e", "process.stdout.write(require('electron'))"], { cwd: join(root, "desktop"), encoding: "utf8" });
    if (!existsSync(local)) throw new Error("desktop/node_modules is missing: run `npm --prefix desktop ci`");
    return { executablePath, args: [join(root, "desktop")] };
  }
  const path = resolve(appArg);
  return { executablePath: path.endsWith(".app") ? join(path, "Contents", "MacOS", "Doppel") : path, args: [] };
}
const { executablePath, args } = target();

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** pid → command of every process below `pid`. */
function descendants(pid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean);
  const found = new Map();
  const visit = (parent) => {
    for (const [, child, ppid, command] of rows) {
      if (Number(ppid) === parent && !found.has(Number(child))) {
        found.set(Number(child), command);
        visit(Number(child));
      }
    }
  };
  visit(pid);
  return found;
}
const freePort = () => new Promise((done) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});
const logText = () => {
  try {
    return readFileSync(join(dataDir, "logs", "doppel.log"), "utf8");
  } catch {
    return "";
  }
};
const lastMatch = (pattern) => [...logText().matchAll(pattern)].pop();
const serverInfo = () => ({ pid: Number(lastMatch(/server process started \(pid (\d+)\)/g)?.[1]), port: Number(lastMatch(/server ready on 127\.0\.0\.1:(\d+)/g)?.[1]) });
const readyCount = () => [...logText().matchAll(/server ready on/g)].length;
async function until(test, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await test()) return true;
    await sleep(150);
  }
  return false;
}

// Own data folder, and windows that do not take the keyboard focus from the person at the machine.
const quietEnv = { DOPPEL_DESKTOP_DATA_DIR: dataDir, DOPPEL_DESKTOP_QUIET: "1" };
let running = null;
async function launch(extraEnv = {}) {
  const env = { ...process.env, ...quietEnv, ...extraEnv };
  for (const name of ["OPENROUTER_API_KEY", "DOPPEL_LLM_API_KEY", "DOPPEL_LLM_BASE_URL", "ELECTRON_RUN_AS_NODE"]) delete env[name];
  running = await electron.launch({ executablePath, args, env, timeout: 60_000 });
  return running;
}
async function mainPage(app) {
  const page = await app.firstWindow();
  await page.waitForURL("http://doppel.localhost/**", { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  return page;
}
const clickMenu = (app, label) => app.evaluate(({ Menu }, wanted) => {
  for (const top of Menu.getApplicationMenu().items) {
    const item = top.submenu?.items.find((entry) => entry.label === wanted);
    if (item) return item.click(), true;
  }
  return false;
}, label);
/** Closes the app and reports which of its processes are still there a moment later. */
async function quitAndFindLeftovers(app) {
  const pid = app.process().pid;
  const before = descendants(pid);
  before.set(pid, "main");
  await app.close();
  await until(() => [...before.keys()].every((each) => !alive(each)), 8_000);
  return [...before].filter(([each]) => alive(each));
}

async function main() {
  // ---------- first launch ----------
  let app = await launch();
  let page = await mainPage(app);
  const first = serverInfo();
  check("window opens the dashboard from the app's own origin", page.url() === "http://doppel.localhost/", page.url());
  check("server listens on a loopback port", first.port > 0 && alive(first.pid), `127.0.0.1:${first.port}, pid ${first.pid}`);
  const listening = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", String(first.pid)], { encoding: "utf8" }).split("\n").filter((line) => line.includes("TCP"));
  check("server is bound to 127.0.0.1 only", listening.length > 0 && listening.every((line) => line.includes(`127.0.0.1:${first.port}`)), listening.map((line) => line.trim().split(/\s+/).slice(-2).join(" ")).join("; "));

  const twin = await page.evaluate(async () => {
    const response = await fetch("/api/twin");
    return { status: response.status, body: await response.json() };
  });
  check("GET /api/twin answers 200 inside the app", twin.status === 200 && twin.body.ok === true, JSON.stringify(twin.body));
  check("without a key the assistant is not configured", twin.body.configured === false, twin.body.reason);
  const post = await page.evaluate(async () => (await fetch("/api/twin", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status);
  check("POST /api/twin passes the same-origin check", post !== 403, `status ${post}`);

  const globals = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, bridge: typeof window.doppelShell, secure: window.isSecureContext }));
  check("renderer has no Node and no shell bridge", globals.require === "undefined" && globals.process === "undefined" && globals.bridge === "undefined", JSON.stringify(globals));
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox, preload: Boolean(p.preload) };
  });
  check("nodeIntegration off, contextIsolation on, sandboxed, no preload", prefs.nodeIntegration === false && prefs.contextIsolation === true && prefs.sandbox === true && !prefs.preload, JSON.stringify(prefs));

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 140, y: 90, width: 1280, height: 900 }));
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await sleep(1200);
  await page.screenshot({ path: join(shots, "dashboard.png") });
  const dashboardText = await page.locator("body").innerText();
  check("dashboard is rendered", /Upload a bank statement/.test(dashboardText) && /net worth/i.test(dashboardText));
  check("the web UI says the assistant is not connected", /not connected/i.test(dashboardText));

  // The OCR worker and its language data are served through the same origin.
  const worker = await page.evaluate(() => new Promise((done) => {
    const instance = new Worker("/tesseract/runtime/worker.min.js");
    instance.onerror = (event) => done(`error: ${event.message}`);
    setTimeout(() => done("started"), 1500);
  }));
  const assets = await page.evaluate(async () => Promise.all(["/tesseract/eng.traineddata.gz", "/tesseract/runtime/tesseract-core-simd-lstm.wasm.js", "/samples/imports/barlas-zkb.csv"].map(async (path) => {
    const response = await fetch(path);
    return `${path} ${response.status} ${(await response.arrayBuffer()).byteLength}`;
  })));
  check("Tesseract worker and assets load", worker === "started" && assets.every((line) => / 200 [1-9]\d{3,}$/.test(line)), `${worker}; ${assets.join("; ")}`);

  // A sample bank statement: load, review, add to the twin. Another account's file, so its rows are new to Barlas.
  await page.getByTestId("statement-samples").locator("summary").click();
  const sample = page.getByRole("button", { name: "Load sample Oktay · neon (CSV)" });
  await sample.scrollIntoViewIfNeeded();
  await sleep(600);
  await sample.click();
  const review = page.getByRole("region", { name: "Review statement import" }).or(page.getByLabel("Review statement import"));
  await review.first().waitFor({ timeout: 20_000 });
  const add = page.getByRole("button", { name: /^Add \d+ entr(y|ies) to twin$/ });
  await add.waitFor({ timeout: 20_000 });
  const addLabel = await add.innerText();
  await add.click();
  const imported = await until(async () => /Imported \d+ transactions/.test(await page.locator("body").innerText()), 15_000);
  await page.screenshot({ path: join(shots, "statement-imported.png") });
  check("sample statement import works", imported, addLabel);

  await page.evaluate(() => localStorage.setItem("doppel-desktop-smoke", "kept-across-launches"));
  const storedKeys = await page.evaluate(() => Object.keys(localStorage).sort());

  const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((top) => `${top.label}: ${top.submenu.items.filter((item) => item.type !== "separator").map((item) => item.label).join(", ")}`));
  const flat = menu.join(" | ");
  check("menu has Dashboard, Play, Reload, Open data folder, Assistant settings…", ["Dashboard", "Play", "Reload", "Open data folder", "Assistant settings…"].every((label) => flat.includes(label)), flat);
  await clickMenu(app, "Play");
  await page.waitForURL("http://doppel.localhost/play");
  await page.waitForLoadState("networkidle");
  await sleep(1200);
  await page.screenshot({ path: join(shots, "play.png") });
  check("/play loads from the menu", (await page.locator("body").innerText()).trim().length > 200, page.url());
  await clickMenu(app, "Dashboard");
  await page.waitForURL("http://doppel.localhost/");

  // External links leave the app; the window never navigates away from its origin.
  await app.evaluate(({ shell }) => {
    globalThis.smokeOpened = [];
    shell.openExternal = async (url) => void globalThis.smokeOpened.push(url);
  });
  await page.evaluate(() => {
    window.open("https://example.org/from-window-open");
    const link = Object.assign(document.createElement("a"), { href: "https://example.org/from-link", textContent: "x" });
    document.body.append(link);
    link.click();
  });
  await sleep(800);
  const opened = await app.evaluate(() => globalThis.smokeOpened);
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  check("external links go to the system browser, navigation stays on the app origin", opened.length === 2 && page.url() === "http://doppel.localhost/" && windows === 1, `${opened.join(", ")}; window at ${page.url()}`);
  const foreign = await page.evaluate(() => fetch("http://example.org/").then((response) => `status ${response.status}`, (error) => `refused: ${error.message}`));
  check("pages cannot fetch other hosts", /refused/.test(foreign), foreign);

  let left = await quitAndFindLeftovers(app);
  check("quit leaves no process behind (first launch)", left.length === 0 && !alive(first.pid), left.length ? JSON.stringify(left) : `server pid ${first.pid} gone`);

  // ---------- second launch, on a different port ----------
  const forced = await freePort();
  app = await launch({ DOPPEL_DESKTOP_PORT: String(forced) });
  page = await mainPage(app);
  const second = serverInfo();
  check("second launch runs on another port", second.port === forced && second.port !== first.port, `${first.port} → ${second.port}`);
  const kept = await page.evaluate(() => ({ marker: localStorage.getItem("doppel-desktop-smoke"), keys: Object.keys(localStorage).sort() }));
  check("localStorage survives quit and relaunch on a new port", kept.marker === "kept-across-launches" && storedKeys.every((key) => kept.keys.includes(key)), `${kept.keys.length} keys: ${kept.keys.join(", ")}`);
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  check("window size and position are remembered", bounds.width === 1280 && bounds.height === 900 && bounds.x === 140 && bounds.y === 90, JSON.stringify(bounds));

  const again = spawnSync(executablePath, args, { env: { ...process.env, ...quietEnv }, timeout: 20_000 });
  const afterSecond = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  check("a second instance exits and the first keeps running", again.status === 0 && again.error === undefined && afterSecond === 1 && alive(second.pid), `exit ${again.status}, windows ${afterSecond}`);

  // Assistant settings: a separate window with the only bridge; saving restarts the server.
  const opening = app.waitForEvent("window");
  await clickMenu(app, "Assistant settings…");
  const settings = await opening;
  await settings.waitForLoadState("domcontentloaded");
  await settings.locator("#status").filter({ hasText: /Not connected/ }).waitFor();
  await settings.screenshot({ path: join(shots, "settings.png") });
  check("settings window opens", /settings\.html$/.test(settings.url()) && (await settings.evaluate(() => typeof window.doppelShell)) === "object", settings.url());
  await settings.getByLabel("Another endpoint").check();
  await settings.locator("#base-url").fill("http://127.0.0.1:9/v1");
  await settings.locator("#api-key").fill("smoke-secret-value-123456");
  await settings.locator("#text-model").fill("smoke-model");
  const readyBefore = readyCount();
  await settings.locator("#save").click();
  await settings.locator("#status").filter({ hasText: "Assistant configured: smoke-model at 127.0.0.1:9" }).waitFor({ timeout: 30_000 });
  await settings.screenshot({ path: join(shots, "settings-configured.png") });
  const third = serverInfo();
  const envText = readFileSync(join(dataDir, "doppel.env"), "utf8");
  check("saving settings writes doppel.env and restarts the server", readyCount() === readyBefore + 1 && third.pid !== second.pid && !alive(second.pid) && alive(third.pid) && /^DOPPEL_LLM_BASE_URL=http:\/\/127\.0\.0\.1:9\/v1$/m.test(envText), `server pid ${second.pid} → ${third.pid}, port ${second.port} → ${third.port}`);
  const leak = await settings.evaluate(() => document.documentElement.outerHTML.includes("smoke-secret-value") || document.querySelector("#api-key").value !== "");
  check("the saved key is not handed back to any page and not logged", !leak && !logText().includes("smoke-secret-value") && envText.includes("DOPPEL_LLM_API_KEY=smoke-secret-value-123456"));
  await page.waitForLoadState("networkidle");
  const configured = await page.evaluate(async () => (await (await fetch("/api/twin")).json()));
  // The dashboard shows a "connected" pill whose tooltip carries the model and host.
  const connectedText = await until(() => page.locator('[title="Assistant connected: smoke-model at 127.0.0.1:9"]').count(), 15_000);
  check("the app reloads and shows the assistant as connected", configured.configured === true && configured.provider === "127.0.0.1:9" && connectedText, JSON.stringify(configured));
  check("localStorage is still there after the restart", (await page.evaluate(() => localStorage.getItem("doppel-desktop-smoke"))) === "kept-across-launches");

  // Editing doppel.env by hand has the same effect.
  const readyBeforeEdit = readyCount();
  writeFileSync(join(dataDir, "doppel.env"), envText.split("\n").filter((line) => !/^DOPPEL_(LLM_|TEXT_MODEL)/.test(line)).join("\n"));
  const restarted = await until(() => readyCount() === readyBeforeEdit + 1, 20_000);
  await sleep(1500);
  await page.waitForLoadState("networkidle");
  const offline = await page.evaluate(async () => (await (await fetch("/api/twin")).json()));
  check("editing doppel.env by hand restarts the server too", restarted && offline.configured === false, JSON.stringify(offline));
  await settings.close();

  const fourth = serverInfo();
  left = await quitAndFindLeftovers(app);
  check("quit leaves no process behind (after restarts)", left.length === 0 && ![second.pid, third.pid, fourth.pid].some(alive), left.length ? JSON.stringify(left) : `server pids ${second.pid}, ${third.pid}, ${fourth.pid} gone`);

  // ---------- the server cannot start ----------
  app = await launch({ DOPPEL_DESKTOP_SERVER_DIR: join(work, "no-server-here") });
  const errorPage = await until(async () => app.windows().find((win) => /error\.html$/.test(win.url())), 20_000) && app.windows().find((win) => /error\.html$/.test(win.url()));
  if (errorPage) {
    await errorPage.locator("#tail:not([hidden])").waitFor();
    await errorPage.screenshot({ path: join(shots, "error.png") });
    const text = await errorPage.locator("body").innerText();
    check("a missing server shows the error window with the log path", /Doppel could not start/.test(text) && text.includes(join(dataDir, "logs", "doppel.log")), text.split("\n").slice(0, 2).join(" / "));
    const errorPid = app.process().pid;
    await errorPage.getByRole("button", { name: "Quit" }).click().catch(() => {});
    check("Quit in the error window ends the app", await until(() => !alive(errorPid), 10_000));
  } else {
    check("a missing server shows the error window with the log path", false, "no error window");
    await app.close();
  }
}

/** Every file under `dir` with its size and modification time, to see whether a run changed anything. */
function snapshot(dir) {
  const out = new Map();
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.set(path, `${statSync(path).size}:${statSync(path).mtimeMs}`);
    }
  };
  walk(dir);
  return out;
}
// What the app is installed as: the .app bundle, or the staged server in an unpackaged run.
const installed = appArg ? (resolve(appArg).endsWith(".app") ? resolve(appArg) : dirname(resolve(appArg))) : join(root, "desktop", ".stage", "server");
const installedBefore = snapshot(installed);

try {
  await main();
  const after = snapshot(installed);
  const changed = [...after].filter(([path, stamp]) => installedBefore.get(path) !== stamp).map(([path]) => path.slice(installed.length + 1));
  check("the app never writes into its own files", changed.length === 0 && after.size === installedBefore.size, changed.length ? `changed: ${changed.slice(0, 3).join(", ")}` : `${after.size} files untouched`);
} catch (error) {
  check("smoke run completed", false, error.stack ?? String(error));
  // Never leave the app (and its server) running after a failed run.
  await running?.close().catch(() => {});
}
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${shots}`);
console.log(`Log of the run: ${join(dataDir, "logs", "doppel.log")}`);
if (!failed.length && !process.argv.includes("--keep")) rmSync(dataDir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
