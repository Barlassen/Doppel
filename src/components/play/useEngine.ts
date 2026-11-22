"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Analysis, EngineSettings, TurnLuck } from "@/lib/game/engine";
import type { GameState } from "@/lib/game/state";
import { EngineClient, type WorkerLike } from "./engineClient";

export interface Engine {
  analyse: (state: GameState, settings: EngineSettings) => Promise<{ analysis: Analysis; ms: number }>;
  luck: (root: GameState, card: string, next: GameState, crunch: boolean, settings: EngineSettings) => Promise<TurnLuck>;
  /** A new game: stop the running review and drop what was queued (their promises reject with EngineCancelled). */
  reset: () => void;
}

/**
 * The engine in a Web Worker (see `EngineClient`). Without worker support it falls back to the main thread after a
 * frame, so the result is identical either way. The worker is terminated on unmount and on `reset()`.
 */
export function useEngine(): Engine {
  const client = useRef<EngineClient | null>(null);

  useEffect(
    () => () => {
      client.current?.dispose();
      client.current = null;
    },
    [],
  );

  return useMemo<Engine>(() => {
    const get = () => (client.current ??= new EngineClient(() => (typeof Worker === "undefined" ? null : (new Worker(new URL("./engine.worker.ts", import.meta.url)) as unknown as WorkerLike))));
    return {
      analyse: async (state, settings) => {
        const r = await get().run({ kind: "analyse", state, settings });
        if (r.kind !== "analyse") throw new Error("engine answered the wrong request");
        return { analysis: r.analysis, ms: r.ms };
      },
      luck: async (root, card, next, crunch, settings) => {
        const r = await get().run({ kind: "luck", root, card, next, crunch, settings });
        if (r.kind !== "luck") throw new Error("engine answered the wrong request");
        return r.luck;
      },
      reset: () => client.current?.reset(),
    };
  }, []);
}
