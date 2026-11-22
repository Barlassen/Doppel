/**
 * The client side of the engine worker, without React: one worker, requests answered by id, and `reset()`.
 *
 * `reset()` is what a new game calls: it terminates the worker (a review that is still running belongs to the old
 * game and would only delay the new one), rejects everything that was waiting with `EngineCancelled`, and starts a
 * fresh worker on the next request. Answers that arrive from a terminated worker are ignored.
 * Without worker support the request runs on the main thread after a frame, with the same result.
 */
import { analyse, turnLuck, type Analysis, type EngineSettings, type TurnLuck } from "@/lib/game/engine";
import type { GameState } from "@/lib/game/state";

export type EngineRequest =
  | { kind: "analyse"; state: GameState; settings: EngineSettings }
  | { kind: "luck"; root: GameState; card: string; next: GameState; crunch: boolean; settings: EngineSettings };

export type EngineResult = { kind: "analyse"; analysis: Analysis; ms: number } | { kind: "luck"; luck: TurnLuck; ms: number };

export interface EngineMessage {
  id: number;
  result?: EngineResult;
  error?: string;
}

/** The part of a Worker the client uses (a test passes a fake). */
export interface WorkerLike {
  postMessage(message: { id: number; request: EngineRequest }): void;
  terminate(): void;
  onmessage: ((event: { data: EngineMessage }) => void) | null;
}

export class EngineCancelled extends Error {
  constructor() {
    super("engine request cancelled");
    this.name = "EngineCancelled";
  }
}

/** Runs a request where it is called (the worker and the main-thread fallback share it). */
export function compute(request: EngineRequest, now: () => number = () => performance.now()): EngineResult {
  const t0 = now();
  if (request.kind === "analyse") {
    const analysis = analyse(request.state, request.settings);
    return { kind: "analyse", analysis, ms: now() - t0 };
  }
  const luck = turnLuck(request.root, request.card, request.next, request.crunch, request.settings);
  return { kind: "luck", luck, ms: now() - t0 };
}

interface Pending {
  resolve: (r: EngineResult) => void;
  reject: (e: Error) => void;
}

export class EngineClient {
  private worker: WorkerLike | null = null;
  private workerFailed = false;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  /** `makeWorker` returns null (or throws) where workers are not available. */
  constructor(
    private readonly makeWorker: () => WorkerLike | null,
    private readonly defer: (run: () => void) => void = (run) => void setTimeout(run, 16),
  ) {}

  private ensureWorker(): WorkerLike | null {
    if (this.worker || this.workerFailed) return this.worker;
    try {
      const w = this.makeWorker();
      if (!w) {
        this.workerFailed = true;
        return null;
      }
      w.onmessage = (event) => {
        // A terminated worker can still deliver a message that was already queued: it is not ours any more.
        if (this.worker !== w) return;
        const p = this.pending.get(event.data.id);
        if (!p) return;
        this.pending.delete(event.data.id);
        if (event.data.result) p.resolve(event.data.result);
        else p.reject(new Error(event.data.error ?? "engine error"));
      };
      this.worker = w;
    } catch {
      this.workerFailed = true;
    }
    return this.worker;
  }

  run(request: EngineRequest): Promise<EngineResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const w = this.ensureWorker();
      if (w) {
        w.postMessage({ id, request });
        return;
      }
      this.defer(() => {
        const p = this.pending.get(id);
        if (!p) return; // cancelled before it started
        this.pending.delete(id);
        try {
          p.resolve(compute(request));
        } catch (error) {
          p.reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  /** Requests still waiting for an answer. */
  get waiting(): number {
    return this.pending.size;
  }

  /** Stops the running work and drops what was queued; the next request starts a fresh worker. */
  reset() {
    this.worker?.terminate();
    this.worker = null;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) p.reject(new EngineCancelled());
  }

  dispose() {
    this.reset();
  }
}
