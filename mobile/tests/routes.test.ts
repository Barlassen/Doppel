import assert from "node:assert/strict";
import { test } from "node:test";
import { routeForPath, urlForRoute } from "../src/lib/routes.ts";

test("routeForPath maps /play and below to play, the rest to the dashboard", () => {
  assert.equal(routeForPath("/"), "dashboard");
  assert.equal(routeForPath(""), "dashboard");
  assert.equal(routeForPath("/play"), "play");
  assert.equal(routeForPath("/play/"), "play");
  assert.equal(routeForPath("/play/review?move=3"), "play");
  assert.equal(routeForPath("/playground"), "dashboard");
  assert.equal(routeForPath("/anything-else"), "dashboard");
});

test("urlForRoute joins the server address and the path", () => {
  assert.equal(urlForRoute("http://192.168.1.20:3000", "dashboard"), "http://192.168.1.20:3000/");
  assert.equal(urlForRoute("http://192.168.1.20:3000", "play"), "http://192.168.1.20:3000/play");
});
