// Builds the Doppel production server for the desktop app and stages it in desktop/.stage/server.
//
//   node scripts/desktop-stage.mjs            build (DOPPEL_STANDALONE=1 next build), then stage
//   node scripts/desktop-stage.mjs --no-build stage the existing .next/standalone
//
// The staged folder is what the Electron shell runs (desktop/app/server.mjs) and what electron-builder copies into
// the app as Resources/server: Next's standalone server + public/ (with the Tesseract assets) + .next/static.
// It must never contain a key: env files are removed and the folder is scanned before the script succeeds.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");
const stage = join(root, "desktop", ".stage", "server");
const SECRET_NAMES = ["OPENROUTER_API_KEY", "DOPPEL_LLM_API_KEY"];

function fail(message) {
  console.error(`desktop-stage: ${message}`);
  process.exit(1);
}

/** KEY=value lines of an env file (values unquoted). */
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** Every key value this machine knows about: the build must not have written any of them into the stage. */
function knownSecrets() {
  const values = new Set();
  const add = (env) => {
    for (const name of SECRET_NAMES) if (env[name] && env[name].length >= 8) values.add(env[name]);
  };
  add(process.env);
  for (const file of readdirSync(root)) {
    if (file.startsWith(".env") && file !== ".env.example") add(parseEnv(readFileSync(join(root, file), "utf8")));
  }
  return [...values];
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

if (!process.argv.includes("--no-build")) {
  const next = createRequire(join(root, "package.json")).resolve("next/dist/bin/next");
  const env = { ...process.env, DOPPEL_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" };
  for (const name of SECRET_NAMES) delete env[name];
  console.log("desktop-stage: next build (DOPPEL_STANDALONE=1)");
  const built = spawnSync(process.execPath, [next, "build"], { cwd: root, env, stdio: "inherit" });
  if (built.status !== 0) fail("next build failed");
}
if (!existsSync(join(standalone, "server.js"))) fail(".next/standalone/server.js is missing; run without --no-build");
if (!existsSync(join(root, "public", "tesseract", "runtime", "worker.min.js"))) {
  fail("public/tesseract/runtime is missing; run `npm ci` (its postinstall copies the Tesseract assets)");
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(dirname(stage), { recursive: true });
cpSync(standalone, stage, { recursive: true, verbatimSymlinks: true });
cpSync(join(root, "public"), join(stage, "public"), { recursive: true });
cpSync(join(root, ".next", "static"), join(stage, ".next", "static"), { recursive: true });

// Env files never ship: the app reads the user's own doppel.env from its data folder.
for (const file of readdirSync(stage)) if (file.startsWith(".env")) rmSync(join(stage, file), { force: true });
// The image optimiser (sharp, a native binary per OS and CPU) is traced by Next but Doppel uses no next/image.
// Without it the staged server is plain JavaScript, so one stage serves x64, arm64 and Windows builds.
for (const name of ["sharp", "@img", "@emnapi", "detect-libc"]) rmSync(join(stage, "node_modules", name), { recursive: true, force: true });
for (const file of walk(stage)) if (file.endsWith(".node")) fail(`native module left in the stage: ${relative(stage, file)}`);

const secrets = knownSecrets().map((value) => Buffer.from(value));
const keyShape = /sk-or-v1-[0-9a-f]{32,}/;
let files = 0;
let bytes = 0;
for (const file of walk(stage)) {
  files += 1;
  const size = statSync(file).size;
  bytes += size;
  if (size > 32 * 1024 * 1024) continue;
  const data = readFileSync(file);
  if (secrets.some((secret) => data.includes(secret)) || keyShape.test(data.toString("latin1"))) {
    rmSync(stage, { recursive: true, force: true });
    fail(`a key was found in ${relative(stage, file)}; the stage was deleted. Nothing may bake a key into the build.`);
  }
}

const buildId = readFileSync(join(stage, ".next", "BUILD_ID"), "utf8").trim();
writeFileSync(join(stage, "desktop-stage.json"), `${JSON.stringify({ buildId, files, bytes }, null, 2)}\n`);
console.log(`desktop-stage: ${relative(root, stage)} ready (${files} files, ${(bytes / 1e6).toFixed(1)} MB, build ${buildId}, no key found)`);
