/**
 * Doppel Play: financial independence ("mating Life"), the goal capital, the legacy target and the game rating (Elo).
 * Every number comes from the deterministic simulator; nothing here is predicted by a model.
 *
 * - Financial independence at age A: if the player stopped working at A, liquid savings (cash, portfolio, 3a), the
 *   pension fund and AHV from 65 pay the household's spending until 95 in at least 90% of simulated futures.
 * - Goal capital: the liquid savings needed at 65 to cover the gap between spending and pensions until 95
 *   (one full simulation at the start; 30 years at 1% real). The evaluation bar measures progress towards it.
 * - Legacy target (the product owner's definition): per child, a good home, a good car and an education; without
 *   children, a good home and a care reserve. Doppel defaults, start-year CHF, shown on screen.
 * - Game rating: the outcome of the game against the outcome of holding every year on the same dice (same markets,
 *   same Life cards), so luck and a rich start count far less than the decisions.
 */
import { RETIREMENT_TAX_FACTOR, effectiveTaxRate } from "@/lib/finance/pension";
import { simulate } from "./sim";
import type { Regime } from "./regime";
import { type GameState, netWorth, toSimInput } from "./state";

/** Savings must last until this age. */
export const FI_END_AGE = 95;
/** Share of futures in which savings must last (the mate threshold). */
export const FI_THRESHOLD = 0.9;
export const FI_PATHS = 200;
/** Age at which the goal capital is measured (AHV reference age). */
export const GOAL_AGE = 65;
/** Real return used to turn a yearly gap into capital (conservative, after costs). */
export const GOAL_REAL_RATE = 0.01;

/** Legacy target parts (Doppel defaults, start-year CHF). */
export const LEGACY = { home: 1_000_000, car: 60_000, education: 120_000, careReserve: 150_000 } as const;

export function legacyTarget(children: number): number {
  return children > 0 ? children * (LEGACY.home + LEGACY.car + LEGACY.education) : LEGACY.home + LEGACY.careReserve;
}

/** P(liquid savings last until 95) if the player stops working at `retireAge` (at least next year). */
export function fiProbability(s: GameState, regime: Regime, retireAge: number, seed: number, paths = FI_PATHS): number {
  if (s.pension) {
    // Already retired: the money must not run out before 95 with the pensions in payment.
    const input = toSimInput(s, FI_END_AGE, regime, paths, seed);
    input.assumptions = { ...input.assumptions, endAge: FI_END_AGE };
    return 1 - simulate(input).crunchProb;
  }
  const input = toSimInput(s, s.age + 1, regime, paths, seed);
  const age = Math.max(s.age + 1, retireAge);
  input.profile = { ...input.profile, retirementAge: age };
  input.horizon = "full";
  input.assumptions = { ...input.assumptions, endAge: FI_END_AGE };
  // Phases (study, abroad, part-time) end at retirement: the person no longer works.
  input.phases = (input.phases ?? []).map((p) => ({ ...p, endMonth: Math.min(p.endMonth, (age - s.age) * 12) })).filter((p) => p.endMonth > p.startMonth);
  const res = simulate(input);
  return res.retirement?.lastsTo90Prob ?? 0;
}

/** Is the player financially independent now (could stop working next year)? */
export const isIndependent = (s: GameState, regime: Regime, seed: number) => fiProbability(s, regime, s.age + 1, seed) >= FI_THRESHOLD;

/**
 * Liquid capital needed at 65 (start-year CHF): the yearly gap between retirement spending and net pensions,
 * capitalised over 30 years at 1% real. Computed once at the start from a full simulation that retires at 65.
 */
export function goalCapital(s: GameState, regime: Regime, seed: number): number {
  const age = Math.max(GOAL_AGE, s.age + 1);
  const input = toSimInput(s, s.age + 1, regime, FI_PATHS, seed);
  input.profile = { ...input.profile, retirementAge: age };
  input.horizon = "full";
  input.assumptions = { ...input.assumptions, endAge: FI_END_AGE };
  const ret = simulate(input).retirement;
  if (!ret) return Math.max(10_000, netWorth(s));
  const netPension = ret.monthlyIncomeAtRetirement * (1 - effectiveTaxRate(s.marginalTaxRate) * RETIREMENT_TAX_FACTOR);
  const gapYear = Math.max(0, ret.monthlySpending - netPension) * 12;
  const years = FI_END_AGE - age;
  const annuity = (1 - Math.pow(1 + GOAL_REAL_RATE, -years)) / GOAL_REAL_RATE;
  return Math.round((gapYear * annuity) / 1000) * 1000;
}

// ---------------- game rating ----------------

export type GameOutcome =
  | { kind: "independent"; age: number; netWorth: number; legacy: number }
  | { kind: "mated"; age: number }
  | { kind: "timeUp"; age: number; fiProb: number; netWorth: number; legacy: number };

/** Outcome score on the rating scale (before comparing with holding). */
export function outcomeScore(o: GameOutcome, startAge: number, endAge: number): number {
  switch (o.kind) {
    case "mated":
      return 400 + (600 * (o.age - startAge)) / Math.max(1, endAge - startAge);
    case "timeUp":
      return 1000 + 400 * o.fiProb;
    case "independent": {
      const early = Math.max(-10, Math.min(20, GOAL_AGE - o.age));
      const legacy = Math.min(1, Math.max(0, o.netWorth / o.legacy));
      return 1500 + 25 * early + 400 * legacy;
    }
  }
}

/** Weight of the decisions (player − hold) in the rating; the rest is the reference line's own outcome. */
export const DECISION_WEIGHT = 0.6;

export interface Rating {
  elo: number;
  player: GameOutcome;
  hold: GameOutcome;
  playerScore: number;
  holdScore: number;
  tier: "mated" | "survived" | "independent65" | "early" | "legacy" | "grandmaster";
}

/**
 * Elo-like rating: 1200 + 0.6 × (player − hold) + 0.4 × (hold − 1200). Holding on the same dice is the reference:
 * the decisions (the difference to holding) weigh 60%, where the dice and the starting position put you 40%.
 */
export function rate(player: GameOutcome, hold: GameOutcome, startAge: number, endAge: number): Rating {
  const ps = outcomeScore(player, startAge, endAge);
  const hs = outcomeScore(hold, startAge, endAge);
  const elo = Math.round(Math.min(2800, Math.max(100, 1200 + DECISION_WEIGHT * (ps - hs) + (1 - DECISION_WEIGHT) * (hs - 1200))));
  const tier: Rating["tier"] =
    player.kind === "mated"
      ? "mated"
      : player.kind === "timeUp"
        ? "survived"
        : player.netWorth >= player.legacy
          ? elo >= 2400
            ? "grandmaster"
            : "legacy"
          : player.age < GOAL_AGE
            ? "early"
            : "independent65";
  return { elo, player, hold, playerScore: ps, holdScore: hs, tier };
}
