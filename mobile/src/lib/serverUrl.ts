/**
 * Server address helpers. Pure (no React Native imports) so `npm test` can run them in plain Node.
 * The shell stores one thing: the origin of the Doppel server, e.g. `http://192.168.1.20:3000`.
 */

export type UrlProblem = "empty" | "scheme" | "host" | "port";
export type NormalizeResult = { ok: true; url: string } | { ok: false; problem: UrlProblem };

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV6 = /^\[[0-9a-f:.]{2,45}\]$/;

/**
 * Turn what a person typed or scanned into the server origin.
 * - no scheme means `http://` (a LAN dev server);
 * - only http and https are accepted; credentials are refused;
 * - path, query and fragment are dropped, because Doppel is served at the root;
 * - the host is lower-cased and a default port (80 / 443) is removed.
 */
export function normalizeServerUrl(input: string): NormalizeResult {
  let text = input.trim();
  if (!text) return { ok: false, problem: "empty" };
  if (/\s/.test(text)) return { ok: false, problem: "host" };

  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
  if (!scheme) {
    // "localhost:3000" has a colon but no scheme; "mailto:x" is a scheme without "//".
    if (/^[a-z][a-z0-9+.-]*:(?!\d|$)/i.test(text)) return { ok: false, problem: "scheme" };
    text = `http://${text}`;
  }
  const parts = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(text);
  if (!parts) return { ok: false, problem: "host" };
  const protocol = parts[1].toLowerCase();
  if (protocol !== "http" && protocol !== "https") return { ok: false, problem: "scheme" };

  const authority = parts[2].toLowerCase();
  if (!authority || authority.includes("@")) return { ok: false, problem: "host" };

  // "[::1]:3000" or "host:3000"; a bare host name cannot contain a colon.
  const split = authority.startsWith("[")
    ? /^(\[[^\]]*\])(?::(\d*))?$/.exec(authority)
    : /^([^:]*)(?::(\d*))?$/.exec(authority);
  if (!split) return { ok: false, problem: "host" };
  const host = split[1];
  let port = split[2] ?? "";
  if (split[2] === "") return { ok: false, problem: "port" };
  if (!(host.startsWith("[") ? IPV6.test(host) : HOSTNAME.test(host))) return { ok: false, problem: "host" };

  if (port) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return { ok: false, problem: "port" };
    const isDefault = (protocol === "http" && n === 80) || (protocol === "https" && n === 443);
    port = isDefault ? "" : String(n);
  }
  return { ok: true, url: `${protocol}://${host}${port ? `:${port}` : ""}` };
}

/** Origin of an absolute http(s) URL in the same normal form, or null for anything else. */
export function originOf(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  const result = normalizeServerUrl(url);
  return result.ok ? result.url : null;
}

export type NavigationKind = "internal" | "external";

/**
 * Where a navigation the WebView is about to make belongs.
 * `internal`: the Doppel server itself, or a document the page made (about:, blob:, data:).
 * `external`: another origin or another app's scheme (mailto:, tel:, …); opened by the system instead.
 */
export function classifyNavigation(url: string, serverUrl: string): NavigationKind {
  if (/^(about|blob|data|javascript):/i.test(url)) return "internal";
  const origin = originOf(url);
  return origin !== null && origin === serverUrl ? "internal" : "external";
}

/** Path of an absolute URL ("/play"), or "/" when it has none. */
export function pathOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(url);
  return match && match[1] ? match[1] : "/";
}
