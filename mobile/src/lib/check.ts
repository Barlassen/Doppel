import * as Network from "expo-network";
import { probeServer } from "./probe";
import type { ServerStatus } from "./probe";

export type FailureKind = "offline" | "unreachable" | "notDoppel" | "page";
export type Failure = { kind: FailureKind; detail?: string };

export type CheckResult = { ok: true; status: ServerStatus } | { ok: false; failure: Failure };

/** Probe the server; when nothing answers, say whether the phone has a network at all. */
export async function checkServer(serverUrl: string): Promise<CheckResult> {
  const result = await probeServer(serverUrl, fetch);
  if (result.kind === "ok") return { ok: true, status: result.status };
  if (result.kind === "notDoppel") return { ok: false, failure: { kind: "notDoppel" } };
  let connected = true;
  try {
    connected = (await Network.getNetworkStateAsync()).isConnected !== false;
  } catch {
    // Unknown network state: report the server as unreachable, which is what was observed.
  }
  return { ok: false, failure: { kind: connected ? "unreachable" : "offline" } };
}
