/**
 * The analyst. Monte Carlo Tree Search over Black's decision nodes and Life's chance nodes (expectimax flavour):
 *
 *  - Decision nodes: the dealt hand (+ hold). The root tries every candidate on the SAME futures (common random
 *    numbers); deeper decision nodes pick by UCT. The tree is open-loop: a node is a sequence of moves, and the
 *    futures are re-sampled through it, so every visit to "buy now → then invest" improves the same statistics.
 *  - Chance nodes: one market bucket (five quintiles of the regime's returns) and Life's next card, sampled from
 *    pre-drawn futures. The realised year of the game is always one of these outcomes.
 *  - Leaves: a rollout of the existing simulator (`simulate`) to the analysis horizon, on a fixed seed → E.
 *  - Scoring: after the search, each candidate is re-scored with its own best continuation (principal variation)
 *    on all futures, so the losses compare moves on identical futures. Same idea as the goal solver's re-score.
 *
 * Deterministic: seeded futures, seeded leaves, no Math.random, no clock in the result. Fixed budgets.
 */
import { MIN_BUFFER_MONTHS, type GameState, balances, bufferMonths, debtTotal, monthlySurplus, stepYear } from "./state";
import { applyCard, cardById, dealHand, lifeDistribution, lifeEventFor, type CardParam } from "./cards";
import { type Evaluation, type MoveLabel, type Weights, evaluatePosition, labelFor, mateValue, moveAccuracy } from "./evaluate";
import { BUCKET_P, BUCKET_Z, MEDIAN_BUCKET, REGIME, type Regime, type RegimeId, bucketOf, hashSeed, marketYear, uniform } from "./regime";

export type DepthId = "1y" | "5y" | "goal";
export const DEPTHS: DepthId[] = ["1y", "5y", "goal"];

export interface EngineSettings {
  regime: RegimeId;
  depth: DepthId;
  weights: Weights;
  seed: number;
}

export interface Budget {
  /** Pre-drawn futures; each root candidate is searched on all of them. */
  scenarios: number;
  /** Maximum realised years inside the tree before the leaf rollout. */
  plies: number;
  /** Simulator paths per leaf rollout. */
  paths: number;
  /** UCT exploration constant (E is in [−0.2, 1]). */
  c: number;
}

export const DEFAULT_BUDGET: Budget = { scenarios: 40, plies: 2, paths: 96, c: 0.04 };

/** Age at which a move is judged. */
export function horizonAge(s: GameState, depth: DepthId): number {
  if (depth === "1y") return s.age + 1;
  if (depth === "5y") return s.age + 5;
  const end = s.startAge + s.endTurn;
  return Math.max(s.age + 1, s.goal.age > s.age ? s.goal.age : end);
}

/** The deterministic part of the check test (used inside the search): less than three months of buffer. */
export const bufferInCheck = (s: GameState) => bufferMonths(s) < MIN_BUFFER_MONTHS;

export interface DonutSlice {
  channel: "cashflow" | "liquidity" | "invested" | "property" | "pension" | "debt" | "goal";
  /** CHF (start-year money) versus holding; cashflow per year; goal in probability points. */
  value: number;
}

export interface CandidateEval {
  card: string;
  params: CardParam[];
  /** E at the analysis horizon (0..1, shown ×100). */
  e: number;
  /** E at a one-year horizon (for the sacrifice tag). */
  e1: number;
  parts: Omit<Evaluation, "e">;
  /** Share of searched futures in which a hard constraint breaks inside the tree. */
  mateShare: number;
  visits: number;
  /** This move and its best continuation, one card per year. */
  pv: string[];
  sacrifice: boolean;
  drain: boolean;
  lifeChoice: boolean;
  donut: DonutSlice[];
}

export interface Analysis {
  turn: number;
  age: number;
  horizonAge: number;
  depth: DepthId;
  plies: number;
  candidates: CandidateEval[];
  /** The hold reference (always computed, even when hold is not allowed in check). */
  hold: CandidateEval;
  holdAllowed: boolean;
  best: string;
  stats: { iterations: number; leafEvals: number; cacheHits: number; scenarios: number; paths: number };
}

interface Outcome {
  bucket: number;
  life: string | null;
}

interface Line {
  e: Evaluation;
  seq: string[];
  mate: boolean;
}

interface Ctx {
  root: GameState;
  regime: Regime;
  settings: EngineSettings;
  budget: Budget;
  plies: number;
  hAge: number;
  leafSeed: number;
  cache: Map<string, Evaluation>;
  counters: { leafEvals: number; cacheHits: number };
}

/** Moves the engine considers for the player in a future year: the dealt hand without life choices. */
function options(s: GameState, seed: number): string[] {
  const h = dealHand(s, seed);
  const cards = h.cards.filter((c) => !cardById(c).lifeChoice);
  return [...cards, ...(h.holdAllowed || !cards.length ? ["hold"] : [])];
}

const fallback = (opts: string[]) => (opts.includes("hold") ? "hold" : opts[0]);

function leaf(ctx: Ctx, key: string, s: GameState): Evaluation {
  const hit = ctx.cache.get(key);
  if (hit) {
    ctx.counters.cacheHits++;
    return hit;
  }
  ctx.counters.leafEvals++;
  const e = evaluatePosition(s, ctx.hAge, ctx.regime, ctx.settings.weights, { paths: ctx.budget.paths, seed: ctx.leafSeed });
  ctx.cache.set(key, e);
  return e;
}

/** One year of Life inside the tree: the market bucket, then Life's next card, then the buffer check. */
function lifeYear(ctx: Ctx, after: GameState, pick: (s: GameState) => Outcome): { state: GameState; mate: boolean; outcome: Outcome } {
  const probe = pick(after);
  const yr = stepYear(after, marketYear(ctx.regime, probe.bucket));
  if (yr.mate) return { state: yr.state, mate: true, outcome: probe };
  const outcome = { bucket: probe.bucket, life: pick(yr.state).life };
  let st = yr.state;
  if (outcome.life) st = applyCard(st, outcome.life, ctx.regime).state;
  st.check = bufferInCheck(st) ? { reason: "buffer", crunchProb: 0, bufferMonths: bufferMonths(st) } : null;
  return { state: st, mate: false, outcome };
}

/**
 * Plays one line from the root: `a0`, then (per depth) a move chosen by `choose`, with outcomes from `pick`.
 * Returns the leaf evaluation (or the mate value) and the move sequence.
 */
function playLine(ctx: Ctx, a0: string, pickAt: (d: number) => (s: GameState) => Outcome, choose: (d: number, seq: string[], opts: string[]) => string): Line {
  let st = ctx.root;
  const seq = [a0];
  let path = "";
  for (let d = 0; ; d++) {
    const after = applyCard(st, seq[d], ctx.regime).state;
    if (d === ctx.plies) return { e: leaf(ctx, seq.join(">") + "|" + path, after), seq, mate: false };
    const y = lifeYear(ctx, after, pickAt(d));
    path += y.outcome.bucket + ":" + (y.outcome.life ?? "-") + ";";
    if (y.mate) return { e: mateValue(ctx.settings.weights), seq, mate: true };
    st = y.state;
    seq.push(choose(d + 1, seq, options(st, ctx.settings.seed)));
  }
}

/** Outcome of future j at depth d (uniforms are fixed per future: common random numbers). */
const sampled = (ctx: Ctx, j: number, d: number) => (s: GameState): Outcome => ({
  bucket: bucketOf(uniform(ctx.settings.seed, ctx.root.turn, "future", j, d, "market")),
  life: lifeEventFor(s, ctx.regime, uniform(ctx.settings.seed, ctx.root.turn, "future", j, d, "life")),
});

interface Stat {
  n: number;
  sum: number;
}

function mean(st: Stat | undefined) {
  return st && st.n ? st.sum / st.n : -Infinity;
}

function makeCtx(root: GameState, settings: EngineSettings, budget: Budget, regime?: Regime): Ctx {
  const hAge = horizonAge(root, settings.depth);
  return {
    root,
    regime: regime ?? REGIME[settings.regime],
    settings,
    budget,
    plies: Math.max(0, Math.min(budget.plies, hAge - root.age - 1)),
    hAge,
    leafSeed: hashSeed(settings.seed, "leaf"),
    cache: new Map(),
    counters: { leafEvals: 0, cacheHits: 0 },
  };
}

function averaged(lines: Line[]): { e: Evaluation; mateShare: number } {
  const n = lines.length;
  const acc = { pGoal: 0, pCrunch: 0, median: 0, p10: 0, target: 0, wealthScore: 0, shortfall: 0, e: 0 };
  for (const l of lines) for (const k of Object.keys(acc) as (keyof Evaluation)[]) acc[k] += l.e[k] / n;
  return { e: acc, mateShare: lines.filter((l) => l.mate).length / n };
}

/** The deterministic expected path (median market, quiet years, holding) used for the impact donut. */
function project(s: GameState, years: number, r: Regime): GameState {
  let st = s;
  for (let y = 0; y < years; y++) st = stepYear(st, marketYear(r, MEDIAN_BUCKET)).state;
  return st;
}

function donut(move: GameState, hold: GameState, years: number, r: Regime, dGoal: number): DonutSlice[] {
  const a = project(move, years, r);
  const b = project(hold, years, r);
  const ka = a.priceIndex;
  const ba = balances(a);
  const bb = balances(b);
  const eq = (x: typeof ba) => x.homeValue - x.mortgage;
  return [
    { channel: "cashflow", value: ((monthlySurplus(a) - monthlySurplus(b)) * 12) / ka },
    { channel: "liquidity", value: (ba.cash - bb.cash) / ka },
    { channel: "invested", value: (ba.portfolio - bb.portfolio) / ka },
    { channel: "property", value: (eq(ba) - eq(bb)) / ka },
    { channel: "pension", value: (ba.pillar2 + ba.pillar3a - bb.pillar2 - bb.pillar3a) / ka },
    { channel: "debt", value: (debtTotal(b) - debtTotal(a)) / ka },
    { channel: "goal", value: dGoal },
  ];
}

export interface AnalyseOptions {
  budget?: Partial<Budget>;
  /** Tests only: a custom regime (e.g. a tiny chance tree). */
  regime?: Regime;
  /** Root candidates instead of the dealt hand (tests). */
  candidates?: string[];
}

function rootActions(root: GameState, seed: number, opts: AnalyseOptions): { actions: string[]; holdAllowed: boolean } {
  if (opts.candidates) return { actions: opts.candidates, holdAllowed: opts.candidates.includes("hold") };
  const hand = dealHand(root, seed);
  return { actions: [...hand.cards, ...(hand.holdAllowed ? ["hold"] : [])], holdAllowed: hand.holdAllowed };
}

/** Full review of a position: every candidate scored, the best move, the principal variations and the donuts. */
export function analyse(root: GameState, settings: EngineSettings, opts: AnalyseOptions = {}): Analysis {
  const budget = { ...DEFAULT_BUDGET, ...opts.budget };
  const ctx = makeCtx(root, settings, budget, opts.regime);
  const { actions, holdAllowed } = rootActions(root, settings.seed, opts);
  const roots = actions.includes("hold") ? actions : [...actions, "hold"];
  const N = ctx.plies === 0 ? 1 : budget.scenarios;
  const stats = new Map<string, Stat>();
  let iterations = 0;

  // ---- search: UCT below the root, every root candidate on every future ----
  if (ctx.plies > 0) {
    for (let j = 0; j < N; j++) {
      for (const a0 of roots) {
        const line = playLine(ctx, a0, (d) => sampled(ctx, j, d), (d, seq, opts) => {
          const prefix = seq.join(">");
          const untried = opts.find((o) => !stats.get(prefix + ">" + o)?.n);
          if (untried) return untried;
          const total = opts.reduce((s, o) => s + (stats.get(prefix + ">" + o)?.n ?? 0), 0);
          let best = opts[0];
          let bestU = -Infinity;
          for (const o of opts) {
            const st = stats.get(prefix + ">" + o)!;
            const u = st.sum / st.n + budget.c * Math.sqrt(Math.log(total) / st.n);
            if (u > bestU) {
              bestU = u;
              best = o;
            }
          }
          return best;
        });
        iterations++;
        for (let k = 1; k <= line.seq.length; k++) {
          const key = line.seq.slice(0, k).join(">");
          const st = stats.get(key) ?? { n: 0, sum: 0 };
          st.n++;
          st.sum += line.e.e;
          stats.set(key, st);
        }
      }
    }
  }

  const pvOf = (a0: string): string[] => {
    const seq = [a0];
    for (let d = 1; d <= ctx.plies; d++) {
      const prefix = seq.join(">") + ">";
      let best: string | null = null;
      let bestN = 0;
      for (const [k, st] of stats) {
        if (!k.startsWith(prefix) || k.slice(prefix.length).includes(">")) continue;
        const move = k.slice(prefix.length);
        if (st.n > bestN || (st.n === bestN && best !== null && mean(st) > mean(stats.get(prefix + best)))) {
          best = move;
          bestN = st.n;
        }
      }
      if (!best) break;
      seq.push(best);
    }
    return seq;
  };

  // ---- scoring: each candidate with its own continuation on all N futures ----
  const hAgeYears = ctx.hAge - root.age;
  const scored = new Map<string, CandidateEval>();
  const holdState = applyCard(root, "hold", ctx.regime).state;
  for (const a0 of roots) {
    const pv = pvOf(a0);
    const lines: Line[] = [];
    for (let j = 0; j < N; j++) {
      lines.push(playLine(ctx, a0, (d) => sampled(ctx, j, d), (d, _seq, opts) => (pv[d] && opts.includes(pv[d]) ? pv[d] : fallback(opts))));
    }
    const { e, mateShare } = averaged(lines);
    const move = applyCard(root, a0, ctx.regime);
    const e1 = evaluatePosition(move.state, root.age + 1, ctx.regime, settings.weights, { paths: budget.paths, seed: ctx.leafSeed }).e;
    ctx.counters.leafEvals++;
    const { e: score, ...parts } = e;
    scored.set(a0, {
      card: a0,
      params: move.params,
      e: score,
      e1,
      parts,
      mateShare,
      visits: stats.get(a0)?.n ?? 1,
      pv,
      sacrifice: false,
      drain: false,
      lifeChoice: !!cardById(a0).lifeChoice,
      donut: donut(move.state, holdState, hAgeYears, ctx.regime, 0),
    });
  }
  const hold = scored.get("hold")!;
  const EPS = 0.001;
  for (const c of scored.values()) {
    if (c.card === "hold") continue;
    const def = cardById(c.card);
    c.sacrifice = c.e1 < hold.e1 - EPS && c.e > hold.e + EPS;
    c.drain = !!def.recurring && c.e < hold.e - EPS && c.e1 <= hold.e1;
    c.donut = c.donut.map((s) => (s.channel === "goal" ? { ...s, value: c.parts.pGoal - hold.parts.pGoal } : s));
  }
  // Life choices are scored and shown, but the engine never names one as the best move.
  const candidates = actions.map((a) => scored.get(a)!).sort((x, y) => Number(x.lifeChoice) - Number(y.lifeChoice) || y.e - x.e);
  return {
    turn: root.turn,
    age: root.age,
    horizonAge: ctx.hAge,
    depth: settings.depth,
    plies: ctx.plies,
    candidates,
    hold,
    holdAllowed,
    best: candidates[0]?.card ?? "hold",
    stats: { iterations, ...ctx.counters, scenarios: N, paths: budget.paths },
  };
}

// ---------------- the review of a move ----------------

export interface MoveReview {
  card: string;
  e: number;
  best: string;
  bestE: number;
  /** Loss in points (E × 100): 0 for the best move. */
  loss: number;
  label: MoveLabel;
  sacrifice: boolean;
  drain: boolean;
  /** null for life choices (not graded). */
  accuracy: number | null;
  pv: string[];
  bestPv: string[];
}

export function reviewMove(a: Analysis, card: string): MoveReview {
  const mine = a.candidates.find((c) => c.card === card) ?? (card === "hold" ? a.hold : undefined);
  if (!mine) throw new Error("Move " + card + " was not a candidate");
  const best = a.candidates[0];
  const loss = Math.max(0, (best.e - mine.e) * 100);
  const lossPts = card === best.card ? 0 : loss;
  return {
    card,
    e: mine.e,
    best: best.card,
    bestE: best.e,
    loss: lossPts,
    label: labelFor(lossPts, mine.sacrifice, mine.lifeChoice),
    sacrifice: mine.sacrifice,
    drain: mine.drain,
    accuracy: mine.lifeChoice ? null : moveAccuracy(lossPts),
    pv: mine.pv,
    bestPv: best.pv,
  };
}

// ---------------- exact enumeration (validation of the search on a tiny tree) ----------------

/** All outcomes of one year with their exact probabilities, given the position after the move. */
function enumerateYear(ctx: Ctx, after: GameState): { p: number; state: GameState | null; key: string }[] {
  const out: { p: number; state: GameState | null; key: string }[] = [];
  for (let b = 0; b < BUCKET_Z.length; b++) {
    const yr = stepYear(after, marketYear(ctx.regime, b));
    if (yr.mate) {
      out.push({ p: BUCKET_P, state: null, key: b + ":mate" });
      continue;
    }
    for (const { id, p } of lifeDistribution(yr.state, ctx.regime)) {
      let st = yr.state;
      if (id) st = applyCard(st, id, ctx.regime).state;
      st.check = bufferInCheck(st) ? { reason: "buffer", crunchProb: 0, bufferMonths: bufferMonths(st) } : null;
      out.push({ p: BUCKET_P * p, state: st, key: b + ":" + (id ?? "-") });
    }
  }
  return out;
}

/**
 * Brute force: the exact expected E of every open-loop plan (one move per year, falling back to hold when a card
 * is not dealt), maximised over continuations. Exponential, so only for tiny trees in `scripts/play-check.ts`.
 */
export function bruteForce(root: GameState, settings: EngineSettings, opts: AnalyseOptions = {}): Map<string, number> {
  const budget = { ...DEFAULT_BUDGET, ...opts.budget };
  const ctx = makeCtx(root, settings, budget, opts.regime);
  const { actions } = rootActions(root, settings.seed, opts);

  // Moves that can be dealt at each depth (union over every reachable position).
  const movesAt: Set<string>[] = Array.from({ length: ctx.plies + 1 }, () => new Set<string>());
  const explore = (st: GameState, d: number, seq: string[]) => {
    for (const a of d === 0 ? actions : options(st, settings.seed)) {
      movesAt[d].add(a);
      if (d === ctx.plies) continue;
      for (const o of enumerateYear(ctx, applyCard(st, a, ctx.regime).state)) if (o.state) explore(o.state, d + 1, [...seq, a]);
    }
  };
  explore(root, 0, []);

  const value = (plan: string[]) => {
    const rec = (st: GameState, d: number, seq: string[], path: string): number => {
      const opts = d === 0 ? actions : options(st, settings.seed);
      const move = opts.includes(plan[d]) ? plan[d] : fallback(opts);
      const s2 = [...seq, move];
      const after = applyCard(st, move, ctx.regime).state;
      if (d === ctx.plies) return leaf(ctx, s2.join(">") + "|" + path, after).e;
      let v = 0;
      for (const o of enumerateYear(ctx, after)) v += o.p * (o.state ? rec(o.state, d + 1, s2, path + o.key + ";") : mateValue(settings.weights).e);
      return v;
    };
    return rec(root, 0, [], "");
  };

  const plans: string[][] = [];
  const build = (d: number, acc: string[]) => {
    if (d > ctx.plies) return void plans.push(acc);
    for (const m of movesAt[d]) build(d + 1, [...acc, m]);
  };
  build(1, []);
  const result = new Map<string, number>();
  for (const a0 of actions) {
    let best = -Infinity;
    for (const tail of plans.length ? plans : [[]]) best = Math.max(best, value([a0, ...tail]));
    result.set(a0, best);
  }
  return result;
}
