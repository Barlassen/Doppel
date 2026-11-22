import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyNavigation, normalizeServerUrl, originOf, pathOf } from "../src/lib/serverUrl.ts";

const ok = (input: string) => {
  const result = normalizeServerUrl(input);
  assert.equal(result.ok, true, `${input} should be accepted`);
  return result.ok ? result.url : "";
};
const problem = (input: string) => {
  const result = normalizeServerUrl(input);
  assert.equal(result.ok, false, `${input} should be refused`);
  return result.ok ? "" : result.problem;
};

test("normalizeServerUrl keeps a plain LAN address", () => {
  assert.equal(ok("http://192.168.1.20:3000"), "http://192.168.1.20:3000");
});

test("normalizeServerUrl adds http:// and trims", () => {
  assert.equal(ok("  192.168.1.20:3000 \n"), "http://192.168.1.20:3000");
  assert.equal(ok("localhost:3000"), "http://localhost:3000");
  assert.equal(ok("my-mac.local:3000"), "http://my-mac.local:3000");
});

test("normalizeServerUrl drops path, query and fragment", () => {
  assert.equal(ok("http://192.168.1.20:3000/"), "http://192.168.1.20:3000");
  assert.equal(ok("http://192.168.1.20:3000/play?x=1#top"), "http://192.168.1.20:3000");
});

test("normalizeServerUrl lower-cases and removes default ports", () => {
  assert.equal(ok("HTTPS://Doppel.Example.CH:443/play"), "https://doppel.example.ch");
  assert.equal(ok("http://example.ch:80"), "http://example.ch");
  assert.equal(ok("https://example.ch:8443"), "https://example.ch:8443");
});

test("normalizeServerUrl accepts a bracketed IPv6 address", () => {
  assert.equal(ok("http://[::1]:3000"), "http://[::1]:3000");
  assert.equal(ok("[fe80::1]"), "http://[fe80::1]");
});

test("normalizeServerUrl names the problem", () => {
  assert.equal(problem(""), "empty");
  assert.equal(problem("   "), "empty");
  assert.equal(problem("ftp://192.168.1.20"), "scheme");
  assert.equal(problem("mailto:someone@example.ch"), "scheme");
  assert.equal(problem("exp://192.168.1.20:8081"), "scheme");
  assert.equal(problem("http://"), "host");
  assert.equal(problem("http://user:pw@192.168.1.20:3000"), "host");
  assert.equal(problem("http://exa mple.ch"), "host");
  assert.equal(problem("http://-bad-.ch"), "host");
  assert.equal(problem("http://a:b:c"), "host");
  assert.equal(problem("192.168.1.20:"), "port");
  assert.equal(problem("192.168.1.20:0"), "port");
  assert.equal(problem("192.168.1.20:70000"), "port");
});

test("originOf only reads absolute http(s) URLs", () => {
  assert.equal(originOf("http://192.168.1.20:3000/play"), "http://192.168.1.20:3000");
  assert.equal(originOf("192.168.1.20:3000"), null);
  assert.equal(originOf("about:blank"), null);
});

test("classifyNavigation keeps the server inside and sends the rest out", () => {
  const server = "http://192.168.1.20:3000";
  assert.equal(classifyNavigation("http://192.168.1.20:3000/play", server), "internal");
  assert.equal(classifyNavigation("HTTP://192.168.1.20:3000/", server), "internal");
  assert.equal(classifyNavigation("about:blank", server), "internal");
  assert.equal(classifyNavigation("blob:http://192.168.1.20:3000/abc", server), "internal");
  assert.equal(classifyNavigation("http://192.168.1.20:3001/", server), "external");
  assert.equal(classifyNavigation("https://192.168.1.20:3000/", server), "external");
  assert.equal(classifyNavigation("https://www.ubs.com/", server), "external");
  assert.equal(classifyNavigation("mailto:someone@example.ch", server), "external");
  assert.equal(classifyNavigation("tel:+41000000000", server), "external");
});

test("pathOf reads the path of an absolute URL", () => {
  assert.equal(pathOf("http://192.168.1.20:3000"), "/");
  assert.equal(pathOf("http://192.168.1.20:3000/play?x=1"), "/play");
  assert.equal(pathOf("http://192.168.1.20:3000/play/review#a"), "/play/review");
});
