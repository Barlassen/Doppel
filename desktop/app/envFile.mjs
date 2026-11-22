// doppel.env in the data folder: the same variables as the repository's .env.example, set by the user.
// Nothing here is bundled with the app; the file is created empty (comments only) on first launch.
import fs from "node:fs";

/** Only these reach the server process, so the file cannot set PORT, NODE_OPTIONS and the like. */
export const ALLOWED = /^(?:OPENROUTER_API_KEY|DOPPEL_[A-Z0-9_]+)$/;
/** Set by the shell itself. */
const RESERVED = new Set(["DOPPEL_STANDALONE", "DOPPEL_TRUSTED_PROXIES"]);
export const SECRET_KEYS = ["OPENROUTER_API_KEY", "DOPPEL_LLM_API_KEY"];

const TEMPLATE = `# Doppel assistant settings. The app reads this file when it starts and again whenever it changes.
# Edit it here or under "Assistant settings…" in the app menu. Without a key Doppel runs fully offline.
# Keep this file private: it holds your key in plain text.
#
# --- Option 1: OpenRouter ---
#OPENROUTER_API_KEY=
#DOPPEL_TEXT_MODEL=qwen/qwen3-30b-a3b-instruct-2507
#DOPPEL_VISION_MODEL=qwen/qwen3-vl-30b-a3b-instruct
#
# --- Option 2: any OpenAI-compatible endpoint (Groq, a local Ollama, LM Studio, vLLM…) ---
#DOPPEL_LLM_BASE_URL=http://localhost:11434/v1
#DOPPEL_LLM_API_KEY=
#DOPPEL_TEXT_MODEL=llama3.2
#DOPPEL_VISION_MODEL=llama3.2-vision
#DOPPEL_LLM_JSON_MODE=off
#DOPPEL_LLM_TIMEOUT_MS=25000
#
# --- Daily limits (0 switches the assistant off) ---
#DOPPEL_DAILY_BUDGET_USD=1
#DOPPEL_DAILY_TOKEN_BUDGET=2000000
`;

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;
const unquote = (raw) => raw.replace(/^(["'])(.*)\1$/, "$2");

/** The allowed, non-empty variables of an env text. */
export function parse(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (!match || !ALLOWED.test(match[1]) || RESERVED.has(match[1])) continue;
    const value = unquote(match[2]);
    if (value) values[match[1]] = value;
    else delete values[match[1]];
  }
  return values;
}

/** Sets (string) or removes (null) variables, leaving every other line and comment as the user wrote it. */
export function update(text, changes) {
  const pending = new Map(Object.entries(changes));
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const match = LINE.exec(line);
    if (!match || !pending.has(match[1])) {
      out.push(line);
      continue;
    }
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    if (value !== null) out.push(`${match[1]}=${value}`);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  for (const [name, value] of pending) if (value !== null) out.push(`${name}=${value}`);
  return `${out.join("\n")}\n`;
}

export function ensure(file) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, TEMPLATE, { mode: 0o600 });
}

export function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function write(file, text) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, text, { mode: 0o600 });
  fs.renameSync(temp, file);
}
