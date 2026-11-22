// Doppel desktop shell. It starts the Doppel production server inside the app (server.mjs), shows a splash until
// GET /api/twin answers, then opens one window on the app. See docs/DESKTOP.md.
//
// The web app is always loaded from http://doppel.localhost, whatever port the server got: requests to that origin
// are answered by proxying to 127.0.0.1:<port> (see proxy()). The origin never changes, so localStorage (accounts,
// statements, the Play game) survives relaunches even when the port differs.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, Menu, ipcMain, session, shell } from "electron";

import * as envFile from "./envFile.mjs";
import * as log from "./log.mjs";
import * as windowState from "./windowState.mjs";
import { DoppelServer } from "./server.mjs";

// This file and its modules are ES modules; nothing below awaits before the app is ready, so the calls that
// must come first (data folder, sandbox, single-instance lock) still do.
const here = import.meta.dirname;

const APP_HOST = "doppel.localhost";
const APP_ORIGIN = `http://${APP_HOST}`;
const UI_DIR = path.join(here, "ui");
const UI_URL = pathToFileURL(UI_DIR).href;
const isMac = process.platform === "darwin";
// For automated runs (scripts/desktop-smoke.mjs): windows appear without taking the keyboard from whoever is working.
const quiet = process.env.DOPPEL_DESKTOP_QUIET === "1";
const reveal = (win) => (quiet ? win.showInactive() : win.show());

app.setName("Doppel");
// Tests and development can point the app at their own data folder; an unpackaged run never shares the installed app's.
const dataOverride = process.env.DOPPEL_DESKTOP_DATA_DIR;
if (dataOverride) app.setPath("userData", path.resolve(dataOverride));
else if (!app.isPackaged) app.setPath("userData", path.join(app.getPath("appData"), "Doppel-dev"));
app.setAppLogsPath(path.join(app.getPath("userData"), "logs"));
app.enableSandbox();

const dataDir = app.getPath("userData");
const envPath = path.join(dataDir, "doppel.env");
const statePath = path.join(dataDir, "window-state.json");
const serverDir = process.env.DOPPEL_DESKTOP_SERVER_DIR
  ? path.resolve(process.env.DOPPEL_DESKTOP_SERVER_DIR)
  : app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(here, "..", ".stage", "server");

let server = null;
let mainWindow = null;
let settingsWindow = null;
let errorWindow = null;
let lastError = null;
let appliedEnvHash = null;
let quitting = false;
let serverStopped = false;
/** Start, restart and stop run one after another. */
let queue = Promise.resolve();

const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const isAppUrl = (url) => {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
};
const isExternalUrl = (url) => /^(?:https?:|mailto:)/i.test(url) && !isAppUrl(url);

// ---------------- stable origin ----------------

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "content-length", "accept-encoding"]);
const NO_BODY = new Set([204, 205, 304]);

/** Answers a request for http://doppel.localhost/… from the local server. Any other http host is refused. */
async function proxy(request) {
  const url = new URL(request.url);
  if (url.host !== APP_HOST) return new Response("Blocked: Doppel only loads its own pages.", { status: 403 });
  const port = server && server.port;
  if (!port) return new Response("Doppel is starting.", { status: 503, headers: { "retry-after": "1" } });

  const headers = {};
  request.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
  });
  // The server sees its public name, so its same-origin check on POST /api/twin holds.
  headers["x-forwarded-host"] = APP_HOST;
  headers["x-forwarded-proto"] = "http";
  headers["accept-encoding"] = "identity";
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? Buffer.from(await request.arrayBuffer()) : null;
  if (body) headers["content-length"] = String(body.length);

  return new Promise((resolve) => {
    const upstream = http.request({ host: "127.0.0.1", port, method: request.method, path: url.pathname + url.search, headers }, (response) => {
      const out = new Headers();
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        const name = response.rawHeaders[i];
        if (!HOP_BY_HOP.has(name.toLowerCase()) || name.toLowerCase() === "content-length") out.append(name, response.rawHeaders[i + 1]);
      }
      const status = response.statusCode || 502;
      const empty = NO_BODY.has(status) || request.method === "HEAD";
      if (empty) response.resume();
      resolve(new Response(empty ? null : Readable.toWeb(response), { status, statusText: response.statusMessage, headers: out }));
    });
    upstream.on("error", (error) => {
      log.write("shell", `proxy ${request.method} ${url.pathname}: ${error.message}`);
      resolve(new Response("The Doppel server is not answering.", { status: 502 }));
    });
    request.signal?.addEventListener("abort", () => upstream.destroy());
    upstream.end(body ?? undefined);
  });
}

function setUpSession() {
  const ses = session.defaultSession;
  ses.protocol.handle("http", proxy);
  // Camera (document capture, hand control) and microphone (dictation) for the app's own pages; nothing else.
  const allowed = new Set(["media", "clipboard-sanitized-write", "fullscreen"]);
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowed.has(permission) && isAppUrl(details.requestingUrl || contents.getURL()));
  });
  ses.setPermissionCheckHandler((_contents, permission, origin) => allowed.has(permission) && isAppUrl(origin || ""));
}

// ---------------- server lifecycle ----------------

function readUserEnv() {
  envFile.ensure(envPath);
  const text = envFile.read(envPath);
  const values = envFile.parse(text);
  log.setSecrets(envFile.SECRET_KEYS.map((name) => values[name]));
  return { text, values };
}

function enqueue(task) {
  queue = queue.then(task, task);
  return queue;
}

/** (Re)starts the server with the current doppel.env, then shows the app at `route` (or reloads the page). */
function startServer(route) {
  return enqueue(async () => {
    if (quitting) return;
    try {
      const { text, values } = readUserEnv();
      appliedEnvHash = hash(text);
      const origins = [APP_ORIGIN, ...(values.DOPPEL_ALLOWED_ORIGINS || "").split(",")].map((entry) => entry.trim()).filter(Boolean);
      await server.start(values, { DOPPEL_ALLOWED_ORIGINS: origins.join(",") });
      lastError = null;
      if (errorWindow && !errorWindow.isDestroyed()) errorWindow.destroy();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const current = mainWindow.webContents.getURL();
      const target = route ? APP_ORIGIN + route : isAppUrl(current) ? current : `${APP_ORIGIN}/`;
      // A load the user interrupts (a click while the page comes up) is not a failed start.
      await mainWindow.loadURL(target).catch((error) => log.write("shell", `load ${target}: ${error.message}`));
      if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) reveal(mainWindow);
    } catch (error) {
      if (quitting) return;
      log.write("shell", `start failed: ${error.message}`);
      lastError = { message: error.message, logPath: log.logPath(), tail: log.tail(14) };
      showError();
    }
  });
}

function watchEnvFile() {
  fs.watchFile(envPath, { interval: 1500 }, () => {
    if (quitting || hash(envFile.read(envPath)) === appliedEnvHash) return;
    log.write("shell", "doppel.env changed; restarting the server");
    startServer();
  });
}

// ---------------- windows ----------------

function guard(contents, { internal }) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    else if (!internal && isAppUrl(url) && mainWindow) mainWindow.loadURL(url);
    return { action: "deny" };
  });
  const block = (event, url) => {
    if (!internal && isAppUrl(url)) return;
    event.preventDefault();
    if (isExternalUrl(url)) shell.openExternal(url);
  };
  contents.on("will-navigate", block);
  contents.on("will-redirect", block);
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

function createMainWindow() {
  const state = windowState.load(statePath);
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: windowState.MIN.width,
    minHeight: windowState.MIN.height,
    show: false,
    title: "Doppel",
    backgroundColor: "#f6f5f1",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  if (state.maximized) mainWindow.maximize();
  windowState.track(mainWindow, statePath);
  guard(mainWindow.webContents, { internal: false });
  mainWindow.once("ready-to-show", () => reveal(mainWindow));
  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => log.write("shell", `renderer gone: ${details.reason}`));
  return mainWindow.loadFile(path.join(UI_DIR, "splash.html"));
}

function internalWindow(file, options) {
  const win = new BrowserWindow({
    ...options,
    show: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#f6f5f1",
    webPreferences: {
      preload: path.join(here, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: "doppel-internal",
    },
  });
  win.removeMenu();
  guard(win.webContents, { internal: true });
  win.once("ready-to-show", () => reveal(win));
  win.loadFile(path.join(UI_DIR, file));
  return win;
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return reveal(settingsWindow);
  settingsWindow = internalWindow("settings.html", { width: 560, height: 680, minWidth: 420, minHeight: 420, title: "Assistant settings" });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function showError() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  if (errorWindow && !errorWindow.isDestroyed()) {
    errorWindow.reload();
    return reveal(errorWindow);
  }
  errorWindow = internalWindow("error.html", { width: 620, height: 560, minWidth: 420, minHeight: 360, title: "Doppel could not start" });
  errorWindow.on("closed", () => {
    errorWindow = null;
    // Nothing else is on screen when the server is down.
    if (lastError && !quitting) app.quit();
  });
}

function retry() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(UI_DIR, "splash.html"));
    reveal(mainWindow);
  }
  lastError = null;
  if (errorWindow && !errorWindow.isDestroyed()) errorWindow.destroy();
  startServer("/");
}

function go(route) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (server.port) mainWindow.loadURL(APP_ORIGIN + route);
  reveal(mainWindow);
}

// ---------------- menu ----------------

function buildMenu() {
  const settings = { label: "Assistant settings…", accelerator: "CmdOrCtrl+,", click: openSettings };
  const dataFolder = { label: "Open data folder", click: () => shell.openPath(dataDir) };
  const template = [
    ...(isMac
      ? [{ label: "Doppel", submenu: [{ role: "about" }, { type: "separator" }, settings, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }]
      : []),
    {
      label: isMac ? "Go" : "Doppel",
      submenu: [
        { label: "Dashboard", accelerator: "CmdOrCtrl+1", click: () => go("/") },
        { label: "Play", accelerator: "CmdOrCtrl+2", click: () => go("/play") },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => mainWindow && isAppUrl(mainWindow.webContents.getURL()) && mainWindow.webContents.reload() },
        { type: "separator" },
        dataFolder,
        ...(isMac ? [] : [settings, { type: "separator" }, { role: "quit" }]),
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "Window", role: "window", submenu: [{ role: "minimize" }, { role: "zoom" }, ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------- settings and error windows (the only pages with a bridge) ----------------

const MODEL_KEYS = ["DOPPEL_TEXT_MODEL", "DOPPEL_VISION_MODEL"];
const LIMIT_KEYS = ["DOPPEL_DAILY_BUDGET_USD", "DOPPEL_DAILY_TOKEN_BUDGET"];
const oneLine = (value, max) => (typeof value === "string" ? value.replace(/[\r\n]/g, "").trim().slice(0, max) : "");

/** What the settings window may see: plain values, and for keys only whether one is saved. */
function settingsView() {
  const { values } = readUserEnv();
  const mode = values.DOPPEL_LLM_BASE_URL ? "custom" : values.OPENROUTER_API_KEY || values.DOPPEL_LLM_API_KEY ? "openrouter" : "offline";
  return {
    mode,
    baseUrl: values.DOPPEL_LLM_BASE_URL || "",
    textModel: values.DOPPEL_TEXT_MODEL || "",
    visionModel: values.DOPPEL_VISION_MODEL || "",
    budgetUsd: values.DOPPEL_DAILY_BUDGET_USD || "",
    budgetTokens: values.DOPPEL_DAILY_TOKEN_BUDGET || "",
    hasOpenRouterKey: Boolean(values.OPENROUTER_API_KEY),
    hasCustomKey: Boolean(values.DOPPEL_LLM_API_KEY),
    envPath,
    status: server.status,
    running: Boolean(server.port),
  };
}

function settingsChanges(form) {
  const mode = ["offline", "openrouter", "custom"].includes(form.mode) ? form.mode : "offline";
  const changes = {};
  const key = oneLine(form.apiKey, 400);
  if (mode === "offline") {
    Object.assign(changes, { OPENROUTER_API_KEY: null, DOPPEL_LLM_BASE_URL: null, DOPPEL_LLM_API_KEY: null });
  } else if (mode === "openrouter") {
    // A DOPPEL_LLM_API_KEY would take precedence over the OpenRouter key, so it goes with the custom endpoint.
    Object.assign(changes, { DOPPEL_LLM_BASE_URL: null, DOPPEL_LLM_API_KEY: null });
    if (key) changes.OPENROUTER_API_KEY = key;
  } else {
    const baseUrl = oneLine(form.baseUrl, 400);
    let parsed = null;
    try {
      parsed = new URL(baseUrl);
    } catch {
      // Reported below.
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) throw new Error("The endpoint must be an http(s) URL, for example http://localhost:11434/v1");
    changes.DOPPEL_LLM_BASE_URL = baseUrl;
    if (key) changes.DOPPEL_LLM_API_KEY = key;
    else if (form.clearKey === true) changes.DOPPEL_LLM_API_KEY = null;
  }
  const plain = { DOPPEL_TEXT_MODEL: form.textModel, DOPPEL_VISION_MODEL: form.visionModel, DOPPEL_DAILY_BUDGET_USD: form.budgetUsd, DOPPEL_DAILY_TOKEN_BUDGET: form.budgetTokens };
  for (const name of [...MODEL_KEYS, ...LIMIT_KEYS]) {
    const value = oneLine(plain[name], 200);
    if (LIMIT_KEYS.includes(name) && value && !/^\d+(?:\.\d+)?$/.test(value)) throw new Error("The daily limits must be numbers.");
    changes[name] = value || null;
  }
  return changes;
}

function setUpBridge() {
  const internal = (event) => Boolean(event.senderFrame && event.senderFrame.url.startsWith(`${UI_URL}/`));
  const handle = (channel, fn) => ipcMain.handle(channel, (event, payload) => {
    if (!internal(event)) throw new Error("Not allowed.");
    return fn(payload);
  });
  handle("settings:load", () => settingsView());
  handle("settings:save", async (form) => {
    const changes = settingsChanges(form && typeof form === "object" ? form : {});
    envFile.write(envPath, envFile.update(envFile.read(envPath) || "", changes));
    log.write("shell", `assistant settings saved (${Object.keys(changes).filter((name) => changes[name] !== null).join(", ") || "all cleared"})`);
    await startServer();
    if (lastError) throw new Error(lastError.message);
    return settingsView();
  });
  handle("error:info", () => lastError || { message: "", logPath: log.logPath(), tail: "" });
  handle("shell:action", (name) => {
    if (name === "retry") retry();
    else if (name === "settings") openSettings();
    else if (name === "showLog") shell.showItemInFolder(log.logPath());
    else if (name === "showEnv") shell.showItemInFolder(envPath);
    else if (name === "closeSettings" && settingsWindow) settingsWindow.close();
    else if (name === "quit") app.quit();
  });
}

// ---------------- app lifecycle ----------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = mainWindow && mainWindow.isVisible() ? mainWindow : errorWindow || mainWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    reveal(win);
  });

  app.on("web-contents-created", (_event, contents) => {
    // Belt and braces for any page that is not one of the three windows above.
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  // The window is the app: closing it quits, on every platform, so no server is left behind.
  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    quitting = true;
    if (serverStopped || !server) return;
    event.preventDefault();
    fs.unwatchFile(envPath);
    server.dispose().finally(() => {
      serverStopped = true;
      log.write("shell", "quit");
      app.quit();
    });
  });

  app.whenReady().then(async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    log.init(app.getPath("logs"));
    log.write("shell", `Doppel ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform} ${process.arch}, packaged ${app.isPackaged})`);
    const preferredPort = Number(process.env.DOPPEL_DESKTOP_PORT) || undefined;
    server = new DoppelServer({ dir: serverDir, log: log.write, preferredPort });
    app.setAboutPanelOptions({ applicationName: "Doppel", applicationVersion: app.getVersion(), copyright: "Swiss personal-finance digital twin. Fictional sample data." });
    setUpSession();
    setUpBridge();
    buildMenu();
    await createMainWindow();
    await startServer("/");
    watchEnvFile();
  });
}
