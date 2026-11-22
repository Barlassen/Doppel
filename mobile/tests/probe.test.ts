import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStatus, probeServer } from "../src/lib/probe.ts";

const answer = (ok: boolean, body: unknown) => async () => ({ ok, json: async () => body });

test("parseStatus accepts Doppel's /api/twin answer", () => {
  // The body the production server returned on the day this was written.
  const body = {
    ok: true,
    configured: true,
    provider: "openrouter.ai",
    textModel: "qwen/qwen3-30b-a3b-instruct-2507",
    visionModel: "qwen/qwen3-vl-30b-a3b-instruct",
    naiveModel: "openai/gpt-4o",
  };
  assert.deepEqual(parseStatus(body), {
    configured: true,
    provider: "openrouter.ai",
    textModel: "qwen/qwen3-30b-a3b-instruct-2507",
    version: undefined,
  });
  assert.deepEqual(parseStatus({ ok: true, configured: false }), {
    configured: false,
    provider: undefined,
    textModel: undefined,
    version: undefined,
  });
});

test("parseStatus refuses other JSON", () => {
  assert.equal(parseStatus(null), null);
  assert.equal(parseStatus("ok"), null);
  assert.equal(parseStatus({ ok: true }), null);
  assert.equal(parseStatus({ ok: false, configured: true }), null);
  assert.equal(parseStatus({ ok: "true", configured: true }), null);
});

test("probeServer asks <address>/api/twin", async () => {
  let asked = "";
  const result = await probeServer("http://192.168.1.20:3000", async (url) => {
    asked = url;
    return { ok: true, json: async () => ({ ok: true, configured: false }) };
  });
  assert.equal(asked, "http://192.168.1.20:3000/api/twin");
  assert.equal(result.kind, "ok");
});

test("probeServer tells a foreign server from a silent one", async () => {
  assert.equal((await probeServer("http://a", answer(true, { hello: "world" }))).kind, "notDoppel");
  assert.equal((await probeServer("http://a", answer(false, { ok: true, configured: true }))).kind, "notDoppel");
  const html = async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    },
  });
  assert.equal((await probeServer("http://a", html)).kind, "notDoppel");
  const refused = async () => {
    throw new TypeError("Network request failed");
  };
  assert.equal((await probeServer("http://a", refused)).kind, "unreachable");
});

test("probeServer gives up after the timeout", async () => {
  const never = (_url: string, init: { signal: AbortSignal }) =>
    new Promise<never>((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  assert.equal((await probeServer("http://a", never, 20)).kind, "unreachable");
});
