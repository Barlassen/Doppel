import type { Usage } from "@/lib/snap/types";

export interface LlmResponse<T> {
  ok: boolean;
  offline?: boolean;
  error?: string;
  data?: T;
  ms?: number;
  usage?: Omit<Usage, "mode">;
  usageKnown?: boolean;
  request?: unknown;
}

export async function callTwin<T>(body: Record<string, unknown>): Promise<LlmResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch("/api/twin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await res.json()) as LlmResponse<T>;
  } catch {
    return { ok: false, error: "GATEWAY_UNAVAILABLE", usageKnown: false };
  } finally {
    clearTimeout(timer);
  }
}
