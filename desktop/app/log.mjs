// One plain-text log in the data folder. Values of keys are never written: every line passes redact().
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 1024 * 1024;
let file = null;
let secrets = [];

export function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, "doppel.log");
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, path.join(dir, "doppel.old.log"));
  } catch {
    // No log yet.
  }
  return file;
}

/** Values that must never reach the log (the saved keys). */
export function setSecrets(values) {
  secrets = values.filter((value) => typeof value === "string" && value.length >= 6);
}

function redact(text) {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]");
}

export function write(scope, message) {
  if (!file) return;
  const lines = redact(String(message)).split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return;
  const stamp = new Date().toISOString();
  try {
    fs.appendFileSync(file, lines.map((line) => `${stamp} [${scope}] ${line}\n`).join(""));
  } catch {
    // A full disk must not stop the app.
  }
}

export function tail(count) {
  try {
    return fs.readFileSync(file, "utf8").trimEnd().split("\n").slice(-count).join("\n");
  } catch {
    return "";
  }
}

export const logPath = () => file;
