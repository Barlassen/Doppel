import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { bridgeScript, navigateScript, parseBridgeMessage, PULL_FULL, PULL_SLACK, RELOAD_SCRIPT, setCameraScript } from "../src/lib/bridge.ts";
import type { BridgeMessage, CameraState } from "../src/lib/bridge.ts";

type Listener = (event: Record<string, unknown>) => void;

/** A page with just enough DOM for the injected script: listeners, history, matchMedia, one scroll offset. */
function page(camera: CameraState, options: { dark?: boolean; path?: string } = {}) {
  const messages: BridgeMessage[] = [];
  const listeners: Record<string, Listener[]> = {};
  const on = (type: string, listener: Listener) => void (listeners[type] ??= []).push(listener);
  const location = { pathname: options.path ?? "/", assigned: "" , assign(path: string) { this.assigned = path; } };
  const document = {
    documentElement: { scrollTop: 0 },
    links: [] as { href: string; clicked: number; click(): void }[],
    addEventListener: on,
    querySelector(selector: string) {
      return this.links.find((link) => selector === `a[href="${link.href}"]`) ?? null;
    },
  };
  const window: Record<string, unknown> = {
    scrollY: 0,
    location,
    document,
    history: {
      pushState(_state: unknown, _title: string, path: string) { location.pathname = path; },
      replaceState(_state: unknown, _title: string, path: string) { location.pathname = path; },
    },
    matchMedia: () => ({ matches: options.dark ?? false, addEventListener() {} }),
    addEventListener: on,
    setTimeout: (run: () => void) => { run(); return 0; },
    requestAnimationFrame: (run: () => void) => { run(); return 0; },
    ReactNativeWebView: {
      postMessage(raw: string) {
        const message = parseBridgeMessage(raw);
        if (!message) assert.fail(`the shell must understand ${raw}`);
        messages.push(message);
      },
    },
  };
  window.window = window;
  const context = vm.createContext(window);
  const run = (code: string) => vm.runInContext(code, context);
  const fire = (type: string, event: Record<string, unknown>) => (listeners[type] ?? []).forEach((l) => l(event));
  run(bridgeScript(camera));
  return { messages, window, document, location, run, fire };
}

const element = (attributes: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  tagName: "INPUT",
  type: "file",
  nodeType: 1,
  scrollTop: 0,
  parentElement: null,
  clicks: 0,
  attributes: { ...attributes },
  hasAttribute(name: string) { return name in this.attributes; },
  getAttribute(name: string) { return this.attributes[name] ?? null; },
  setAttribute(name: string, value: string) { this.attributes[name] = value; },
  removeAttribute(name: string) { delete this.attributes[name]; },
  closest: () => null,
  click() { this.clicks += 1; },
  ...extra,
});

const click = (target: unknown) => {
  const event = { target, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
  return event;
};

const touch = (target: unknown, x: number, y: number) => ({ target, touches: [{ clientX: x, clientY: y }] });

test("the injected scripts are valid JavaScript", () => {
  for (const camera of ["granted", "ask", "denied"] as const) new vm.Script(bridgeScript(camera));
  new vm.Script(setCameraScript("granted"));
  new vm.Script(navigateScript("/play"));
  new vm.Script(RELOAD_SCRIPT);
});

test("the page reports its path and colour scheme on load, and the path again on client-side navigation", () => {
  const p = page("granted", { dark: true, path: "/play" });
  assert.deepEqual(p.messages, [{ t: "loc", path: "/play" }, { t: "scheme", dark: true }]);
  p.run("history.pushState(null, '', '/')");
  assert.deepEqual(p.messages.at(-1), { t: "loc", path: "/" });
  p.run("history.replaceState(null, '', '/')");
  assert.equal(p.messages.length, 3, "an unchanged path is not reported twice");
});

test("injecting twice installs one bridge", () => {
  const p = page("granted");
  const before = p.messages.length;
  p.run(bridgeScript("granted"));
  assert.equal(p.messages.length, before);
});

test("a photo input waits for the camera permission, a statement input does not", () => {
  const p = page("ask");
  const statement = click(element({ accept: ".csv,.txt,.xml,.sta,.mt940,.940,text/csv,application/xml,text/xml" }));
  p.fire("click", statement);
  assert.equal(statement.prevented, false);

  const photo = element({ accept: "image/*", capture: "environment" });
  const event = click(photo);
  p.fire("click", event);
  assert.equal(event.prevented, true);
  assert.deepEqual(p.messages.at(-1), { t: "camera" });

  p.run(setCameraScript("granted"));
  assert.equal(photo.clicks, 1, "the waiting tap is replayed");
  const again = click(photo);
  p.fire("click", again);
  assert.equal(again.prevented, false);
});

test("with the camera refused, a capture input falls back to the file chooser", () => {
  const p = page("denied");
  const photo = element({ accept: "image/*", capture: "environment" });
  let duringClick: boolean | null = null;
  (p.window as { setTimeout: unknown }).setTimeout = (run: () => void) => {
    duringClick = photo.hasAttribute("capture");
    run();
  };
  const event = click(photo);
  p.fire("click", event);
  assert.equal(event.prevented, false);
  assert.equal(duringClick, false, "capture is off while the chooser opens");
  assert.equal(photo.getAttribute("capture"), "environment", "and restored afterwards");
});

test("a pull from the top of the page reports progress and asks for a reload past the threshold", () => {
  const p = page("granted");
  const target = element({}, { tagName: "DIV" });
  p.messages.length = 0;
  p.fire("touchstart", touch(target, 100, 100));
  p.fire("touchmove", touch(target, 100, 100 + PULL_SLACK));
  assert.equal(p.messages.length, 0, "nothing inside the slack");
  p.fire("touchmove", touch(target, 100, 100 + PULL_SLACK + PULL_FULL / 2));
  assert.deepEqual(p.messages.at(-1), { t: "pull", p: 0.5 });
  p.fire("touchmove", touch(target, 100, 100 + PULL_SLACK + PULL_FULL));
  p.fire("touchend", { touches: [] });
  assert.deepEqual(p.messages.at(-1), { t: "pullEnd", refresh: true });
});

test("a short pull is released without a reload", () => {
  const p = page("granted");
  const target = element({}, { tagName: "DIV" });
  p.messages.length = 0;
  p.fire("touchstart", touch(target, 100, 100));
  p.fire("touchmove", touch(target, 100, 100 + PULL_SLACK + PULL_FULL / 2));
  p.fire("touchend", { touches: [] });
  assert.deepEqual(p.messages.at(-1), { t: "pullEnd", refresh: false });
});

test("no pull when the page or a container is scrolled, in a dialog, or on a sideways swipe", () => {
  const scrolledPage = page("granted");
  scrolledPage.window.scrollY = 40;
  const inDialog = page("granted");
  const inScroller = page("granted");
  const sideways = page("granted");
  const plain = element({}, { tagName: "DIV" });
  const cases: [ReturnType<typeof page>, unknown, number][] = [
    [scrolledPage, plain, 100],
    [inDialog, element({}, { tagName: "DIV", closest: () => ({}) }), 100],
    [inScroller, element({}, { tagName: "DIV", parentElement: { nodeType: 1, scrollTop: 12, parentElement: null } }), 100],
    [sideways, plain, 300],
  ];
  for (const [p, target, x] of cases) {
    p.messages.length = 0;
    p.fire("touchstart", touch(target, 100, 100));
    p.fire("touchmove", touch(target, x, 100 + PULL_SLACK - 4));
    p.fire("touchmove", touch(target, x, 100 + PULL_SLACK + PULL_FULL * 2));
    p.fire("touchend", { touches: [] });
    assert.deepEqual(p.messages, []);
  }
});

test("navigateScript uses the page's own link when there is one", () => {
  const p = page("granted");
  const link = { href: "/play", clicked: 0, click() { this.clicked += 1; } };
  p.document.links.push(link);
  p.run(navigateScript("/play"));
  assert.equal(link.clicked, 1);
  p.run(navigateScript("/"));
  assert.equal(p.location.assigned, "/");
});

test("parseBridgeMessage refuses anything it does not know", () => {
  assert.equal(parseBridgeMessage("not json"), null);
  assert.equal(parseBridgeMessage("null"), null);
  assert.equal(parseBridgeMessage('{"t":"loc","path":"play"}'), null);
  assert.equal(parseBridgeMessage('{"t":"scheme","dark":"yes"}'), null);
  assert.equal(parseBridgeMessage('{"t":"pull","p":null}'), null);
  assert.equal(parseBridgeMessage('{"t":"reload"}'), null);
  assert.deepEqual(parseBridgeMessage('{"t":"pull","p":-1}'), { t: "pull", p: 0 });
});
