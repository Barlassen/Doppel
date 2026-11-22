// Runs the Doppel production server (Next's standalone server.js) inside the app.
// It is an Electron utility process: Electron's own Node, so no system Node is needed, and Chromium ends it
// together with the app even when the app is killed. It listens on 127.0.0.1 only, on a free port.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { utilityProcess } from "electron";

const READY_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 4_000;

function listenOnce(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(null));
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      const free = probe.address().port;
      probe.close(() => resolve(free));
    });
  });
}

/** A free loopback port: the preferred one when it is free, otherwise one the operating system picks. */
async function freePort(preferred) {
  if (preferred) {
    const port = await listenOnce(preferred);
    if (port) return port;
  }
  const port = await listenOnce(0);
  if (!port) throw new Error("No free port on 127.0.0.1.");
  return port;
}

/** GET http://127.0.0.1:<port><path> as parsed JSON, or null. */
function getJson(port, pathname, timeoutMs = 2_000) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: pathname, timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch {
          resolve(null);
        }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

export class DoppelServer {
  constructor({ dir, log, preferredPort }) {
    this.dir = dir;
    this.log = log;
    this.preferredPort = preferredPort;
    this.child = null;
    this.port = null;
    this.status = null;
    this.disposed = false;
  }

  /** Starts the server with the user's variables and resolves once GET /api/twin answers. */
  async start(userEnv, extraEnv) {
    await this.stop();
    const entry = path.join(this.dir, "server.js");
    if (!fs.existsSync(entry)) throw new Error(`The bundled server is missing (${entry}).`);
    const port = await freePort(this.preferredPort);
    if (this.disposed) throw new Error("The app is quitting.");
    const env = {
      ...process.env,
      ...userEnv,
      ...extraEnv,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;

    const child = utilityProcess.fork(entry, [], { cwd: this.dir, env, stdio: "pipe", serviceName: "Doppel server" });
    this.child = child;
    let exited = null;
    child.stdout?.on("data", (chunk) => this.log("server", chunk.toString("utf8")));
    child.stderr?.on("data", (chunk) => this.log("server", chunk.toString("utf8")));
    child.once("exit", (code) => {
      exited = code ?? 0;
      this.log("shell", `server process exited (code ${exited})`);
      if (this.child === child) {
        this.child = null;
        this.port = null;
      }
    });
    await new Promise((resolve) => {
      child.once("spawn", resolve);
      child.once("exit", resolve);
    });
    this.log("shell", `server process started (pid ${child.pid}), waiting for http://127.0.0.1:${port}/api/twin`);

    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (exited !== null) throw new Error(`The Doppel server stopped while starting (exit code ${exited}).`);
      const answer = await getJson(port, "/api/twin");
      if (answer && answer.status === 200 && answer.body && answer.body.ok === true) {
        this.port = port;
        this.status = answer.body;
        this.log("shell", `server ready on 127.0.0.1:${port} (assistant ${answer.body.configured ? "configured" : "not configured"})`);
        return port;
      }
      if (Date.now() > deadline) {
        await this.stop();
        throw new Error(`The Doppel server did not answer within ${READY_TIMEOUT_MS / 1000} seconds.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  /** Ends the server process and waits until it is gone. */
  async stop() {
    const child = this.child;
    this.child = null;
    this.port = null;
    if (!child || !child.pid) return;
    const pid = child.pid;
    await new Promise((resolve) => {
      const force = setTimeout(() => {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
        resolve();
      }, STOP_TIMEOUT_MS);
      child.once("exit", () => {
        clearTimeout(force);
        resolve();
      });
      child.kill();
    });
    this.log("shell", `server process ${pid} stopped`);
  }

  /** For quitting: stops the server and refuses any later start. */
  dispose() {
    this.disposed = true;
    return this.stop();
  }

  /** What GET /api/twin reports now (host and model names, never a key). */
  async readStatus() {
    if (!this.port) return null;
    const answer = await getJson(this.port, "/api/twin");
    this.status = answer && answer.status === 200 ? answer.body : null;
    return this.status;
  }
}
