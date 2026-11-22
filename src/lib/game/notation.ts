/**
 * Doppel Game Notation (DGN): the game record as JSON. Profile, regime, seed, settings, moves and Life's cards.
 * Replaying a record on the same opening position reproduces the game exactly (checked in scripts/play-check.ts).
 */
import { type Game, type GameSettings, newGame, play } from "./game";
import { realNetWorth, type GameState } from "./state";

export const DGN_FORMAT = "doppel-game-notation";

export interface GameRecord {
  format: typeof DGN_FORMAT;
  version: 1;
  profileId: string;
  profileName: string;
  settings: GameSettings;
  moves: { turn: number; age: number; card: string }[];
  lifeEvents: { turn: number; card: string | null }[];
  markets: { turn: number; bucket: number }[];
  result: GameState["status"];
  /** Net worth at the end, start-year CHF (rounded). */
  finalNetWorth: number;
}

export function toRecord(g: Game): GameRecord {
  const first = g.positions[0];
  const last = g.positions[g.positions.length - 1];
  return {
    format: DGN_FORMAT,
    version: 1,
    profileId: first.profileId,
    profileName: first.name,
    settings: g.settings,
    moves: g.moves.map((m) => ({ turn: m.turn, age: m.age, card: m.card })),
    lifeEvents: g.lifeEvents.map((l) => ({ turn: l.turn, card: l.card })),
    markets: g.moves.map((m) => ({ turn: m.turn, bucket: m.market })),
    result: last.status,
    finalNetWorth: Math.round(realNetWorth(last)),
  };
}

/** Replays a record from its opening position and checks that Life played the same cards and markets. */
export function replay(record: GameRecord, opening: GameState): Game {
  if (record.format !== DGN_FORMAT || record.version !== 1) throw new Error("Not a Doppel game record");
  if (record.profileId !== opening.profileId) throw new Error("The record belongs to another profile");
  let g = newGame(opening, record.settings);
  for (const m of record.moves) g = play(g, m.card);
  const again = toRecord(g);
  if (JSON.stringify(again.lifeEvents) !== JSON.stringify(record.lifeEvents) || JSON.stringify(again.markets) !== JSON.stringify(record.markets)) {
    throw new Error("Replay diverged from the record");
  }
  return g;
}
