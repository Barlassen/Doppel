/**
 * The server contract the shell relies on: `GET <address>/api/twin` answers
 * `{ ok: true, configured: boolean, … }`. Pure apart from the `fetch` it is handed.
 */

export const PROBE_PATH = "/api/twin";
export const PROBE_TIMEOUT_MS = 6000;

export type ServerStatus = {
  /** The assistant has a model key on the server. */
  configured: boolean;
  provider?: string;
  textModel?: string;
  /** Not part of the route today; shown when the server starts to report it. */
  version?: string;
};

export type ProbeResult =
  | { kind: "ok"; status: ServerStatus }
  | { kind: "unreachable" }
  | { kind: "notDoppel" };

const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** Read the JSON body of `/api/twin`; null when it is not Doppel's answer. */
export function parseStatus(body: unknown): ServerStatus | null {
  if (typeof body !== "object" || body === null) return null;
  const data = body as Record<string, unknown>;
  if (data.ok !== true || typeof data.configured !== "boolean") return null;
  return {
    configured: data.configured,
    provider: text(data.provider),
    textModel: text(data.textModel),
    version: text(data.version),
  };
}

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/** Ask the address whether it is a Doppel server. Never throws. */
export async function probeServer(
  serverUrl: string,
  fetchImpl: FetchLike,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${serverUrl}${PROBE_PATH}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { kind: "notDoppel" };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "notDoppel" };
    }
    const status = parseStatus(body);
    return status ? { kind: "ok", status } : { kind: "notDoppel" };
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
