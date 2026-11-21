import type { Usage } from "@/lib/snap/types";

export interface LlmResponse<T> {
  ok: boolean;
  offline?: boolean;
  error?: string;
  data?: T;
  ms?: number;
  usage?: Omit<Usage, "mode">;
  request?: unknown;
}

export async function callTwin<T>(body: Record<string, unknown>): Promise<LlmResponse<T>> {
  try {
    const res = await fetch("/api/twin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as LlmResponse<T>;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
