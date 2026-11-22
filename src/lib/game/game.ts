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
import { simulate } from "./sim";
import { applyCard, dealHand, lifeEventFor, type CardParam } from "./cards";
import type { DepthId, EngineSettings } from "./engine";
import type { PresetId } from "./evaluate";
import { REGIME, bucketOf, hashSeed, marketYear, uniform } from "./regime";
import { isIndependent } from "./independence";
import { type GameState, type Ledger, MIN_BUFFER_MONTHS, bufferMonths, stepYear, toSimInput, turnYears } from "./state";

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
  /** Life's cards in the earlier years of a multi-year turn (the turn boundary's card is `card`). */
  earlier?: { turn: number; age: number; card: string; params: CardParam[] }[];
}

export interface MoveRecord {
  turn: number;
  age: number;
  /** Years this turn covered (1 for the first ten years, then 5). */
  years: number;
  card: string;
  params: CardParam[];
  /** Market bucket of the year that followed (0 = worst quintile … 4 = best). */
  market: number;
  /** Market bucket of every year of the turn (one for a one-year turn, up to five later). */
  buckets: number[];
  /** A cash crunch during the turn: the account stayed below zero with nothing left to sell. */
  crunch: boolean;
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

/**
 * The opening position. A working-age profile that is already financially independent has nothing left to win:
 * the game says so at once (status "won" with no move played) instead of crediting the first move with the win.
 */
export function newGame(start: GameState, settings: GameSettings): Game {
  const s: GameState = { ...start, check: null };
  if (s.status === "playing" && !s.pension && isIndependent(s, REGIME[settings.regime], settings.seed)) {
    s.status = "won";
    s.goalReached = true;
  } else if (s.status === "playing") {
    s.check = checkTest(s, settings);
  }
  return { settings, positions: [s], moves: [], lifeEvents: [{ turn: 0, card: null, params: [] }] };
}

export const currentPosition = (g: Game) => g.positions[g.positions.length - 1];

export function legalMoves(g: Game): string[] {
  const s = currentPosition(g);
  const h = dealHand(s, g.settings.seed);
  return [...h.cards, ...(h.holdAllowed ? ["hold"] : [])];
}

export const marketBucket = (seed: number, turn: number) => bucketOf(uniform(seed, turn, "market"));

/** Plays the player's move and the year(s) that follow (see `turnYears`). */
export function play(g: Game, card: string): Game {
  const pos = currentPosition(g);
  if (pos.status !== "playing") throw new Error("The game is over");
  if (!legalMoves(g).includes(card)) throw new Error("Illegal move " + card);
  return advance(g, card);
}

/**
 * The turn without the legality test (the "hold every year" reference line of the game rating uses it).
 * Each year: one seeded market bucket → `stepYear`; inside a multi-year turn Life also draws its card every year.
 * After the turn: mate, financial independence (the win: Life is mated), the end age, or Life's card + check test.
 */
export function advance(g: Game, card: string): Game {
  const pos = currentPosition(g);
  if (pos.status !== "playing") throw new Error("The game is over");
  const regime = REGIME[g.settings.regime];
  const moved = applyCard(pos, card, regime);
  const years = turnYears(pos);
  let st = moved.state;
  let firstBucket = 0;
  let yearLedger: Ledger | null = null;
  let soldToCover = 0;
  let mate = false;
  let crunch = false;
  const buckets: number[] = [];
  const earlier: NonNullable<LifeRecord["earlier"]> = [];
  for (let y = 0; y < years; y++) {
    const bucket = marketBucket(g.settings.seed, st.turn);
    if (y === 0) firstBucket = bucket;
    buckets.push(bucket);
    const yr = stepYear(st, marketYear(regime, bucket));
    crunch ||= yr.crunch;
    yearLedger = yr.ledger;
    soldToCover += yr.soldToCover;
    st = yr.state;
    if (yr.mate) {
      mate = true;
      break;
    }
    if (y < years - 1) {
      const id = lifeEventFor(st, regime, uniform(g.settings.seed, st.turn, "life"));
      if (id) {
        const res = applyCard(st, id, regime);
        st = res.state;
        earlier.push({ turn: st.turn, age: st.age, card: id, params: res.params });
      }
    }
  }
  let next = st;
  let life: LifeRecord = { turn: next.turn, card: null, params: [], ...(earlier.length ? { earlier } : {}) };
  next.check = null;
  if (mate) {
    next.status = "mate";
  } else if (!g.positions[0].pension && isIndependent(next, regime, g.settings.seed)) {
    // Independence is the win for players who start working; a retiree's game is to last its 15 years.
    next.status = "won";
    next.goalReached = true;
  } else if (next.turn >= next.endTurn) {
    next.status = "ended";
  } else {
    const id = lifeEventFor(next, regime, uniform(g.settings.seed, next.turn, "life"));
    if (id) {
      const res = applyCard(next, id, regime);
      next = res.state;
      life = { ...life, turn: next.turn, card: id, params: res.params };
    }
    next.check = checkTest(next, g.settings);
  }
  const record: MoveRecord = {
    turn: pos.turn,
    age: pos.age,
    years,
    card,
    params: moved.params,
    market: firstBucket,
    buckets,
    crunch,
    cardLedger: moved.ledger,
    yearLedger: yearLedger!,
    soldToCover,
  };
  return { settings: g.settings, positions: [...g.positions, next], moves: [...g.moves, record], lifeEvents: [...g.lifeEvents, life] };
}

/** The game up to the start of `turn` (for "what if I had played X here?"). */
export function truncate(g: Game, turn: number): Game {
  return { settings: g.settings, positions: g.positions.slice(0, turn + 1), moves: g.moves.slice(0, turn), lifeEvents: g.lifeEvents.slice(0, turn + 1) };
}

export const isOver = (g: Game) => currentPosition(g).status !== "playing";
