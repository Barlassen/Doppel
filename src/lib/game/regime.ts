/**
 * Life's strength: the economic regime. It sets how often Life plays an event card, how hard events hit, and the
 * return / inflation paths used both by the realised year and by the engine's rollouts.
 *
 * Chance in the game tree is discrete so it can be enumerated (brute-force check) or sampled (MCTS):
 *  - market year: one of five equally likely quintile buckets of a normal draw (z = conditional quintile means)
 *  - life event: "quiet year" or one applicable Life card, weighted by the regime
 */
import { ASSUMPTIONS, type SimAssumptions } from "./sim";

export type RegimeId = "calm" | "normal" | "stress";
export const REGIMES: RegimeId[] = ["calm", "normal", "stress"];

export interface Regime {
  id: RegimeId;
  /** Probability that Life plays an event card in a year (otherwise a quiet year). */
  eventProb: number;
  /** Multiplier on event amounts (drawdown depth, emergency size, …). */
  severity: number;
  equity: { mu: number; sigma: number };
  bonds: { mu: number; sigma: number };
  home: { mu: number; sigma: number };
  inflation: number;
  wageGrowth: number;
  /** Random shocks inside the leaf rollouts (beyond the searched years). */
  shocks: { jobLossProbYear: number; jobLossMonths: number; crashProbYear: number };
  /** Relative weight of each Life card (missing = 0, i.e. never drawn in this regime). */
  lifeWeights: Record<string, number>;
}

const base = ASSUMPTIONS;

export const REGIME: Record<RegimeId, Regime> = {
  calm: {
    id: "calm",
    eventProb: 0.35,
    severity: 0.7,
    equity: { mu: 0.07, sigma: 0.12 },
    bonds: { mu: 0.02, sigma: 0.04 },
    home: { mu: 0.02, sigma: 0.04 },
    inflation: 0.008,
    wageGrowth: 0.015,
    shocks: { jobLossProbYear: 0.02, jobLossMonths: 4, crashProbYear: 0.02 },
    lifeWeights: {
      "lifeWindfall": 3, "lifePromotion": 3, "lifeEmergency": 2, "lifeClaim": 2, "lifeRent": 1.5, "lifeMaintenance": 1,
      "lifeDrawdown": 1, "lifeJobloss": 1, "lifeInflation": 0.5, "lifeEnergy": 0.5, "lifeCare": 3, "lifeFamily": 1, "lifeRate": 0.5,
    },
  },
  normal: {
    id: "normal",
    eventProb: 0.5,
    severity: 1,
    equity: { ...base.equity },
    bonds: { ...base.bonds },
    home: { ...base.home },
    inflation: base.inflation,
    wageGrowth: base.wageGrowth,
    shocks: { jobLossProbYear: 0.04, jobLossMonths: 6, crashProbYear: 0.05 },
    lifeWeights: {
      "lifeWindfall": 1.5, "lifePromotion": 2, "lifeEmergency": 2, "lifeClaim": 2, "lifeRent": 2, "lifeMaintenance": 1.5,
      "lifeDrawdown": 2, "lifeJobloss": 2, "lifeInflation": 1.5, "lifeEnergy": 1, "lifeCare": 3, "lifeFamily": 1.5, "lifeRate": 1.5,
      "lifeRecession": 1,
    },
  },
  stress: {
    id: "stress",
    eventProb: 0.7,
    severity: 1.4,
    equity: { mu: 0.035, sigma: 0.22 },
    bonds: { mu: 0.025, sigma: 0.07 },
    home: { mu: 0.0, sigma: 0.07 },
    inflation: 0.03,
    wageGrowth: 0.005,
    shocks: { jobLossProbYear: 0.08, jobLossMonths: 8, crashProbYear: 0.1 },
    lifeWeights: {
      "lifeWindfall": 0.5, "lifePromotion": 0.5, "lifeEmergency": 2, "lifeClaim": 1.5, "lifeRent": 2, "lifeMaintenance": 2,
      "lifeDrawdown": 3, "lifeJobloss": 3, "lifeInflation": 3, "lifeEnergy": 2, "lifeCare": 3, "lifeFamily": 1.5, "lifeRate": 2.5,
      "lifeRecession": 2.5, "lifeCompound": 1.5,
    },
  },
};

/** Conditional means of the five quintiles of a standard normal: each bucket has probability 1/5. */
export const BUCKET_Z = [-1.4, -0.53, 0, 0.53, 1.4] as const;
export const BUCKET_P = 0.2;
export const MEDIAN_BUCKET = 2;

export interface MarketYear {
  bucket: number;
  equity: number;
  bonds: number;
  home: number;
  inflation: number;
  wage: number;
}

/** The yearly returns of one market bucket. Bonds and property move partly with equities. */
export function marketYear(r: Regime, bucket: number): MarketYear {
  const z = BUCKET_Z[bucket];
  return {
    bucket,
    equity: r.equity.mu + r.equity.sigma * z,
    bonds: r.bonds.mu + r.bonds.sigma * 0.3 * z,
    home: r.home.mu + r.home.sigma * 0.5 * z,
    inflation: r.inflation,
    wage: r.wageGrowth + 0.005 * z,
  };
}

/** The simulator overrides for a regime: same means and volatilities as the tree's buckets. */
export function simAssumptions(r: Regime): Partial<SimAssumptions> {
  return { equity: r.equity, bonds: r.bonds, home: r.home, inflation: r.inflation, wageGrowth: r.wageGrowth };
}

/** Bucket index for a uniform draw. */
export const bucketOf = (u: number) => Math.min(BUCKET_Z.length - 1, Math.floor(u * BUCKET_Z.length));

// ---------------- seeded uniforms (no Math.random anywhere in the game) ----------------

/** 32-bit hash of a seed and labels: independent, reproducible streams per (game seed, turn, purpose). */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Uniform in [0, 1) from a hash. */
export const uniform = (...parts: (number | string)[]) => hashSeed(...parts) / 4294967296;
