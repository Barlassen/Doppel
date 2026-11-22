/**
 * Doppel Game Notation (DGN): the game record as JSON, complete enough to replay the game with nothing else at
 * hand. It holds the opening position (with the declared preferences), the game's settings, every move with the
 * market of each year it covered, Life's cards (also those inside a five-year turn), and, when the engine has
 * reviewed the moves, each review together with the depth and weights it was made with.
 * `replay` rebuilds the game from the record alone and checks it against what the record says happened.
 */
import type { DepthId, MoveReview } from "./engine";
import type { MoveLabel, PresetId, Weights } from "./evaluate";
import { type Game, type GameSettings, newGame, play } from "./game";
import { realNetWorth, type GameState } from "./state";

export const DGN_FORMAT = "doppel-game-notation";
export const DGN_VERSION = 2;

/** The engine's verdict on a move, as shown in the game (points = E × 100). */
export interface RecordedReview {
  label: MoveLabel;
  loss: number;
  /** Standard error of the loss (sampling noise). */
  lossSe: number;
  e: number;
  best: string;
  bestE: number;
  /** null for life decisions. */
  accuracy: number | null;
  sacrifice: boolean;
  drain: boolean;
  /** Luck of the turn in points (realised − expected), when it was computed. */
  luck: number | null;
}

export interface GameRecord {
  format: typeof DGN_FORMAT;
  version: typeof DGN_VERSION;
  profileId: string;
  profileName: string;
  /** The game's own settings: regime and seed fix Life's dice; depth, weights and preset are those at the start. */
  settings: GameSettings;
  /** Depth and weights the reviews below were made with (both can be changed during a game). null = not reviewed. */
  reviewedWith: { depth: DepthId; weights: Weights; preset: PresetId | "custom" } | null;
  /** Life preferences declared at the start (they change the hands that are dealt). */
  prefs: string[];
  /** The opening position, whole: the record replays without the profile it came from. */
  opening: GameState;
  moves: { turn: number; age: number; years: number; card: string; crunch: boolean; review: RecordedReview | null }[];
  /** Life's card at the start of each turn, and its cards in the earlier years of a five-year turn. */
  lifeEvents: { turn: number; card: string | null; earlier?: { turn: number; age: number; card: string }[] }[];
  /** The market bucket of every year played (0 = worst quintile … 4 = best); `turn` counts years. */
  markets: { turn: number; bucket: number }[];
  result: GameState["status"];
  /** Net worth at the end, start-year CHF (rounded). */
  finalNetWorth: number;
}

export interface RecordExtras {
  /** One entry per move (null = not reviewed yet). */
  reviews?: ((MoveReview & { luck?: number | null }) | null)[];
  reviewedWith?: GameRecord["reviewedWith"];
}

export function toRecord(g: Game, extras: RecordExtras = {}): GameRecord {
  const first = g.positions[0];
  const last = g.positions[g.positions.length - 1];
  const reviewed = extras.reviews?.some((r) => r) ? (extras.reviewedWith ?? { depth: g.settings.depth, weights: g.settings.weights, preset: g.settings.preset }) : null;
  return {
    format: DGN_FORMAT,
    version: DGN_VERSION,
    profileId: first.profileId,
    profileName: first.name,
    settings: g.settings,
    reviewedWith: reviewed,
    prefs: [...first.prefs],
    opening: first,
    moves: g.moves.map((m, k) => {
      const r = extras.reviews?.[k] ?? null;
      return {
        turn: m.turn,
        age: m.age,
        years: m.years,
        card: m.card,
        crunch: m.crunch,
        review: r && { label: r.label, loss: r.loss, lossSe: r.lossSe, e: r.e, best: r.best, bestE: r.bestE, accuracy: r.accuracy, sacrifice: r.sacrifice, drain: r.drain, luck: r.luck ?? null },
      };
    }),
    lifeEvents: g.lifeEvents.map((l) => ({
      turn: l.turn,
      card: l.card,
      ...(l.earlier?.length ? { earlier: l.earlier.map((e) => ({ turn: e.turn, age: e.age, card: e.card })) } : {}),
    })),
    markets: g.moves.flatMap((m) => m.buckets.map((bucket, y) => ({ turn: m.turn + y, bucket }))),
    result: last.status,
    finalNetWorth: Math.round(realNetWorth(last)),
  };
}

/**
 * Replays a record from the opening it carries (or from `opening`, which must then be the same profile) and checks
 * that Life played the same cards and markets and that the game ended the same way.
 */
export function replay(record: GameRecord, opening?: GameState): Game {
  if (record.format !== DGN_FORMAT || record.version !== DGN_VERSION) throw new Error("Not a Doppel game record (version " + DGN_VERSION + ")");
  const start = opening ?? record.opening;
  if (!start) throw new Error("The record has no opening position");
  if (record.profileId !== start.profileId) throw new Error("The record belongs to another profile");
  let g = newGame({ ...start, prefs: [...(record.prefs ?? start.prefs ?? [])] }, record.settings);
  for (const m of record.moves) g = play(g, m.card);
  const again = toRecord(g);
  if (JSON.stringify(again.lifeEvents) !== JSON.stringify(record.lifeEvents) || JSON.stringify(again.markets) !== JSON.stringify(record.markets)) {
    throw new Error("Replay diverged from the record");
  }
  if (again.result !== record.result || again.finalNetWorth !== record.finalNetWorth) throw new Error("Replay ended differently from the record");
  return g;
}
