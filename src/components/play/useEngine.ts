"use client";

import { useCallback, useEffect, useRef } from "react";
import { analyse, type Analysis, type EngineSettings } from "@/lib/game/engine";
import type { GameState } from "@/lib/game/state";

type Pending = { resolve: (a: { analysis: Analysis; ms: number }) => void; reject: (e: Error) => void };

/**
 * The engine in a Web Worker (one request at a time, in order). Without worker support it falls back to the
 * main thread after a frame, so the result is identical either way.
 */
export function useEngine() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  useEffect(() => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL("./engine.worker.ts", import.meta.url));
      w.onmessage = (event: MessageEvent<{ id: number; analysis?: Analysis; ms?: number; error?: string }>) => {
        const p = pending.current.get(event.data.id);
        if (!p) return;
        pending.current.delete(event.data.id);
        if (event.data.analysis) p.resolve({ analysis: event.data.analysis, ms: event.data.ms ?? 0 });
        else p.reject(new Error(event.data.error ?? "engine error"));
      };
      worker.current = w;
    } catch {
      worker.current = null;
    }
    const waiting = pending.current;
    return () => {
      w?.terminate();
      worker.current = null;
      for (const p of waiting.values()) p.reject(new Error("engine stopped"));
      waiting.clear();
    };
  }, []);

  return useCallback((state: GameState, settings: EngineSettings): Promise<{ analysis: Analysis; ms: number }> => {
    const w = worker.current;
    if (!w) {
      return new Promise((resolve) =>
        setTimeout(() => {
          const t0 = performance.now();
          resolve({ analysis: analyse(state, settings), ms: performance.now() - t0 });
        }, 16),
      );
    }
    const id = nextId.current++;
    return new Promise((resolve, reject) => {
      pending.current.set(id, { resolve, reject });
      w.postMessage({ id, state, settings });
    });
  }, []);
}
