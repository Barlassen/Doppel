/**
 * The small script the shell injects into the Doppel page, and the messages it sends back.
 * Pure: the script is a string (Hermes cannot serialise functions), and `npm test` runs it against a stub page.
 *
 * What the script does, and why each part exists:
 *  - location: Next.js navigates with history.pushState, so the bottom bar learns the current path from here;
 *  - scheme: the page follows the WebView's prefers-color-scheme; the shell paints its bars to match it;
 *  - pull: react-native-webview's `pullToRefreshEnabled` is a no-op on Android, so the gesture is read here
 *    (only when the page and every scrolled ancestor of the touch are at the top, and never inside a dialog,
 *    a form control or a canvas) and the shell draws the indicator and reloads;
 *  - camera: on Android an `<input type="file" capture>` never answers when the host app declares the camera
 *    permission but has not been granted it, so the shell is asked for the permission first.
 */

export type CameraState = "granted" | "ask" | "denied";

export type BridgeMessage =
  | { t: "loc"; path: string }
  | { t: "scheme"; dark: boolean }
  | { t: "pull"; p: number }
  | { t: "pullEnd"; refresh: boolean }
  | { t: "camera" };

/** Pull distance in CSS px: nothing happens for the first `PULL_SLACK`, a release after `PULL_FULL` more reloads. */
export const PULL_SLACK = 24;
export const PULL_FULL = 96;

export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  switch (m.t) {
    case "loc":
      return typeof m.path === "string" && m.path.startsWith("/") ? { t: "loc", path: m.path } : null;
    case "scheme":
      return typeof m.dark === "boolean" ? { t: "scheme", dark: m.dark } : null;
    case "pull":
      return typeof m.p === "number" && Number.isFinite(m.p) ? { t: "pull", p: Math.max(0, m.p) } : null;
    case "pullEnd":
      return typeof m.refresh === "boolean" ? { t: "pullEnd", refresh: m.refresh } : null;
    case "camera":
      return { t: "camera" };
    default:
      return null;
  }
}

/** Tell an already loaded page the new camera permission state, and replay the tap that was waiting for it. */
export function setCameraScript(state: CameraState): string {
  return `window.__doppelShell && window.__doppelShell.setCamera(${JSON.stringify(state)}); true;`;
}

/**
 * Reload from inside the page. The library's own `reload()` first swaps the page for its loading view;
 * this keeps the current page on screen until the new one arrives.
 */
export const RELOAD_SCRIPT = "window.location.reload(); true;";

/** Go to a path of the web app: through its own link when there is one (no reload), else a normal load. */
export function navigateScript(path: string): string {
  const p = JSON.stringify(path);
  return `(function () {
  var a = document.querySelector('a[href=' + JSON.stringify(${p}) + ']');
  if (a) a.click(); else window.location.assign(${p});
})(); true;`;
}

export function bridgeScript(camera: CameraState): string {
  return `(function () {
  if (window.__doppelShell) return;
  var shell = (window.__doppelShell = { camera: ${JSON.stringify(camera)}, pending: null });
  function post(message) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(message)); } catch (e) {}
  }

  // --- location ---
  var lastPath = null;
  function reportLocation() {
    var path = window.location.pathname || '/';
    if (path !== lastPath) { lastPath = path; post({ t: 'loc', path: path }); }
  }
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = window.history[name];
    if (typeof original !== 'function') return;
    window.history[name] = function () {
      var result = original.apply(this, arguments);
      setTimeout(reportLocation, 0);
      return result;
    };
  });
  window.addEventListener('popstate', function () { setTimeout(reportLocation, 0); });
  reportLocation();

  // --- colour scheme ---
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function reportScheme() { post({ t: 'scheme', dark: !!(dark && dark.matches) }); }
  if (dark) {
    if (dark.addEventListener) dark.addEventListener('change', reportScheme);
    else if (dark.addListener) dark.addListener(reportScheme);
  }
  reportScheme();

  // --- file inputs that may open the camera ---
  document.addEventListener('click', function (event) {
    var input = event.target;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'file' || shell.camera === 'granted') return;
    var capture = input.hasAttribute('capture');
    var accept = (input.getAttribute('accept') || '').toLowerCase();
    if (!capture && accept && !/image|video|\\*\\/\\*/.test(accept)) return;
    if (shell.camera === 'ask') {
      event.preventDefault();
      event.stopImmediatePropagation();
      shell.pending = input;
      post({ t: 'camera' });
      return;
    }
    // Permission refused: a capture-only chooser would never answer, so open the plain file chooser.
    if (capture) {
      var value = input.getAttribute('capture');
      input.removeAttribute('capture');
      setTimeout(function () { input.setAttribute('capture', value); }, 0);
    }
  }, true);
  shell.setCamera = function (state) {
    shell.camera = state;
    var input = shell.pending;
    shell.pending = null;
    if (input && input.isConnected !== false) { try { input.click(); } catch (e) {} }
  };

  // --- pull to refresh ---
  var SLACK = ${PULL_SLACK}, FULL = ${PULL_FULL};
  var pull = null, queued = false;
  function pageTop() {
    return (window.scrollY || (document.documentElement && document.documentElement.scrollTop) || 0) <= 0;
  }
  function scrolledAncestor(node) {
    for (; node && node.nodeType === 1; node = node.parentElement) if (node.scrollTop > 0) return true;
    return false;
  }
  function excluded(node) {
    return !!(node && node.closest && node.closest(
      '[role="dialog"],[aria-modal="true"],dialog,input,textarea,select,canvas,[contenteditable="true"]'));
  }
  function flush() {
    queued = false;
    if (pull && pull.on) post({ t: 'pull', p: pull.p });
  }
  function end(refresh) {
    if (pull && pull.on) post({ t: 'pullEnd', refresh: refresh });
    pull = null;
  }
  var options = { passive: true, capture: true };
  document.addEventListener('touchstart', function (event) {
    pull = null;
    if (event.touches.length !== 1 || !pageTop() || scrolledAncestor(event.target) || excluded(event.target)) return;
    pull = { x: event.touches[0].clientX, y: event.touches[0].clientY, p: 0, on: false };
  }, options);
  document.addEventListener('touchmove', function (event) {
    if (!pull) return;
    var dx = Math.abs(event.touches[0].clientX - pull.x), dy = event.touches[0].clientY - pull.y;
    if (event.touches.length !== 1 || !pageTop() || (!pull.on && (dy < -8 || (dx > 12 && dx > dy)))) { end(false); return; }
    pull.p = Math.max(0, (dy - SLACK) / FULL);
    if (pull.p > 0) pull.on = true;
    if (pull.on && !queued) {
      queued = true;
      (window.requestAnimationFrame || setTimeout)(flush);
    }
  }, options);
  document.addEventListener('touchend', function () { end(!!pull && pull.p >= 1); }, options);
  document.addEventListener('touchcancel', function () { end(false); }, options);
})(); true;`;
}
