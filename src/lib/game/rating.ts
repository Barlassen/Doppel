/**
 * Doppel Play: the game rating at the end of a game. The reference is the same game with "hold" every turn, on the
 * same dice (market buckets and Life's cards depend only on the game seed and the year), so luck and the starting
 * position largely cancel out. Deterministic; no model.
 */
import { advance, currentPosition, isOver, newGame, type Game } from "./game";
import { FI_END_AGE, type GameOutcome, type Rating, fiProbability, legacyTarget, rate } from "./independence";
import { REGIME } from "./regime";
import { type GameState, realNetWorth } from "./state";

function outcomeOf(g: Game): GameOutcome {
  const last = currentPosition(g);
  const legacy = legacyTarget(last.children);
  if (last.status === "mate") return { kind: "mated", age: last.age };
  if (last.status === "won") return { kind: "independent", age: last.age, netWorth: realNetWorth(last), legacy };
  const fiProb = fiProbability(last, REGIME[g.settings.regime], Math.min(FI_END_AGE - 1, last.age + 1), g.settings.seed);
  return { kind: "timeUp", age: last.age, fiProb, netWorth: realNetWorth(last), legacy };
}

/** The reference line: the same start and dice, holding every turn. */
export function holdLine(g: Game): Game {
  let h = newGame(g.positions[0] as GameState, g.settings);
  while (!isOver(h)) h = advance(h, "hold");
  return h;
}

export function rateGame(g: Game): Rating {
  const start = g.positions[0];
  const endAge = start.age + start.endTurn;
  return rate(outcomeOf(g), outcomeOf(holdLine(g)), start.age, endAge);
}
