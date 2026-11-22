/// <reference lib="webworker" />
/**
 * Doppel Play engine worker: runs the MCTS review off the main thread under the fixed budget. Pure computation on
 * the position it is sent; it never touches the network, storage or a model.
 */
import { analyse, type EngineSettings } from "@/lib/game/engine";
import type { GameState } from "@/lib/game/state";

export interface EngineRequest {
  id: number;
  state: GameState;
  settings: EngineSettings;
}

self.onmessage = (event: MessageEvent<EngineRequest>) => {
  const { id, state, settings } = event.data;
  try {
    const t0 = performance.now();
    const analysis = analyse(state, settings);
    self.postMessage({ id, analysis, ms: performance.now() - t0 });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
