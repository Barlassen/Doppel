/// <reference lib="webworker" />
/**
 * Doppel Play engine worker: runs the MCTS review and the luck of a turn off the main thread under the fixed
 * budget. Pure computation on the positions it is sent; it never touches the network, storage or a model.
 */
import { compute, type EngineRequest } from "./engineClient";

self.onmessage = (event: MessageEvent<{ id: number; request: EngineRequest }>) => {
  const { id, request } = event.data;
  try {
    self.postMessage({ id, result: compute(request) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
