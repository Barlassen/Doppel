/**
 * The turn loop (one turn = one year):
 *   1. Life moves: a Life card drawn with the game seed and the regime (none on the opening turn).
 *   2. Check test on the new position: buffer under 3 months, or P(cash crunch within 12 months) above 20%.
 *   3. Black moves: one card from the dealt hand, or hold (not allowed in check).
 *   4. (UI) The engine reviews the move from the analysis of the position.
 *   5. The year plays out: one seeded market bucket → `stepYear`. A hard constraint breaking is mate.
 *   6. Win when the goal is reached at the goal age with a 3-month buffer; the game ends after its length.
 *
 * Immutable: `play` returns a new Game. Life's dice depend only on (seed, turn), so a branch ("what if I had played
 * X?") faces the same markets and the same draws for Life as the main line.
 */
import { simulate } from "@/lib/finance/monteCarlo";
import { applyCard, dealHand, lifeEventFor, type CardParam } from "./cards";
import type { DepthId, EngineSettings } from "./engine";
import type { PresetId } from "./evaluate";
import { REGIME, bucketOf, hashSeed, marketYear, uniform } from "./regime";
import { type GameState, type Ledger, MIN_BUFFER_MONTHS, bufferMonths, realNetWorth, stepYear, toSimInput } from "./state";

export const CHECK_CRUNCH = 0.2;
export const CHECK_PATHS = 200;

export interface GameSettings extends EngineSettings {
  preset: PresetId | "custom";
  depth: DepthId;
}

export interface LifeRecord {
  turn: number;
  card: string | null;
  params: CardParam[];
}

export interface MoveRecord {
  turn: number;
  age: number;
  card: string;
  params: CardParam[];
  /** Market bucket of the year that followed (0 = worst quintile … 4 = best). */
  market: number;
  cardLedger: Ledger;
  yearLedger: Ledger;
  soldToCover: number;
}

export interface Game {
  settings: GameSettings;
  /** positions[t]: the position at the start of turn t, after Life's card and the check test. */
  positions: GameState[];
  moves: MoveRecord[];
  /** lifeEvents[t]: Life's card at the start of turn t. */
  lifeEvents: LifeRecord[];
}

/** Check test: three months of buffer, then P(cash crunch in the next 12 months) when holding. */
export function checkTest(s: GameState, settings: EngineSettings): GameState["check"] {
  const months = bufferMonths(s);
  if (months < MIN_BUFFER_MONTHS) return { reason: "buffer", crunchProb: 1, bufferMonths: months };
  const r = REGIME[settings.regime];
  const res = simulate(toSimInput(s, s.age + 1, r, CHECK_PATHS, hashSeed(settings.seed, "check")));
  return res.crunchProb > CHECK_CRUNCH ? { reason: "crunch", crunchProb: res.crunchProb, bufferMonths: months } : null;
}

export function newGame(start: GameState, settings: GameSettings): Game {
  const s = { ...start, check: checkTest(start, settings) };
  return { settings, positions: [s], moves: [], lifeEvents: [{ turn: 0, card: null, params: [] }] };
}

export const currentPosition = (g: Game) => g.positions[g.positions.length - 1];

export function legalMoves(g: Game): string[] {
  const s = currentPosition(g);
  const h = dealHand(s, g.settings.seed);
  return [...h.cards, ...(h.holdAllowed ? ["hold"] : [])];
}

export const marketBucket = (seed: number, turn: number) => bucketOf(uniform(seed, turn, "market"));

/** Plays Black's move and the year that follows. */
export function play(g: Game, card: string): Game {
  const pos = currentPosition(g);
  if (pos.status !== "playing") throw new Error("The game is over");
  if (!legalMoves(g).includes(card)) throw new Error("Illegal move " + card);
  const regime = REGIME[g.settings.regime];
  const moved = applyCard(pos, card, regime);
  const bucket = marketBucket(g.settings.seed, pos.turn);
  const yr = stepYear(moved.state, marketYear(regime, bucket));
  let next = yr.state;
  let life: LifeRecord = { turn: next.turn, card: null, params: [] };
  next.check = null;
  if (yr.mate) {
    next.status = "mate";
  } else if (next.age >= next.goal.age && !next.goalReached && realNetWorth(next) >= next.goal.target && bufferMonths(next) >= MIN_BUFFER_MONTHS) {
    next.status = "won";
    next.goalReached = true;
  } else if (next.turn >= next.endTurn) {
    next.status = "ended";
  } else {
    const id = lifeEventFor(next, regime, uniform(g.settings.seed, next.turn, "life"));
    if (id) {
      const res = applyCard(next, id, regime);
      next = res.state;
      life = { turn: next.turn, card: id, params: res.params };
    }
    next.check = checkTest(next, g.settings);
  }
  const record: MoveRecord = {
    turn: pos.turn,
    age: pos.age,
    card,
    params: moved.params,
    market: bucket,
    cardLedger: moved.ledger,
    yearLedger: yr.ledger,
    soldToCover: yr.soldToCover,
  };
  return { settings: g.settings, positions: [...g.positions, next], moves: [...g.moves, record], lifeEvents: [...g.lifeEvents, life] };
}

/** The game up to the start of `turn` (for "what if I had played X here?"). */
export function truncate(g: Game, turn: number): Game {
  return { settings: g.settings, positions: g.positions.slice(0, turn + 1), moves: g.moves.slice(0, turn), lifeEvents: g.lifeEvents.slice(0, turn + 1) };
}

export const isOver = (g: Game) => currentPosition(g).status !== "playing";
