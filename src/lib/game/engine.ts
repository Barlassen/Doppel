/**
 * The analyst. Monte Carlo Tree Search over Black's decision nodes and Life's chance nodes (expectimax flavour):
 *
 *  - Decision nodes: the dealt hand (+ hold). The root tries every candidate on the SAME futures (common random
 *    numbers); deeper decision nodes pick by UCT. The tree is open-loop: a node is a sequence of moves, and the
 *    futures are re-sampled through it, so every visit to "buy now → then invest" improves the same statistics.
 *  - Chance nodes: one market bucket (five quintiles of the regime's returns) and Life's next card per year, sampled
 *    from pre-drawn futures. The realised year of the game is always one of these outcomes. A ply of the tree is a
 *    turn of the game: one year for the first ten years, then five years in which the player cannot move.
 *  - Leaves: a rollout of the game's simulator (`simulate`) to the analysis horizon → E. Every future has its own
 *    rollout seed, shared by all candidates, so the futures are independent samples and the candidates still meet
 *    identical markets.
 *  - Scoring: after the search, each candidate is re-scored with its own best continuation (principal variation)
 *    on all futures, so the losses compare moves on identical futures. Same idea as the goal solver's re-score.
 *    The loss is a mean of paired differences; its standard error is reported and used by the labels.
 *
 * Deterministic: seeded futures, seeded leaves, no Math.random, no clock in the result. Fixed budgets.
 */
import { LONG_TURN_YEARS, MIN_BUFFER_MONTHS, YEARLY_YEARS, type GameState, balances, bufferMonths, debtTotal, monthlySurplus, realNetWorth, stepYear, targetAt, turnYears } from "./state";
import { applyCard, cardById, dealHand, lifeDistribution, lifeEventFor, type CardParam, declaredChoice } from "./cards";
import { type Evaluation, type MoveLabel, type Weights, combine, evaluatePosition, labelFor, mateValue, moveAccuracy } from "./evaluate";
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
  /** Maximum realised turns inside the tree before the leaf rollout (a turn is one year, later five). */
  plies: number;
  /** Simulator paths per leaf rollout. */
  paths: number;
  /** UCT exploration constant (E is in [−0.2, 1]). */
  c: number;
  /** Next moves re-scored on all futures per root candidate (see `analyse`). */
  alternatives: number;
}

/** Longest analysis horizon in years (depth "goal"). */
export const MAX_HORIZON_YEARS = 12;

/**
 * 160 futures × 16 rollout paths each. The spread between futures (which year brings the job loss, the crash) is far
 * larger than the spread inside a rollout, and every future has its own rollout seed, so many futures with short
 * rollouts estimate a move's loss much more precisely than 40 futures × 96 paths did, at about the same cost.
 */
export const DEFAULT_BUDGET: Budget = { scenarios: 160, plies: 2, paths: 16, c: 0.04, alternatives: 2 };

/** The one-year evaluation behind the sacrifice tag is a single short rollout: it gets this many times the paths. */
const E1_PATHS = 4;

/** Age at which a move is judged. */
export function horizonAge(s: GameState, depth: DepthId): number {
  if (depth === "1y") return s.age + 1;
  if (depth === "5y") return s.age + 5;
  // Long goals (financial independence at 65) are judged on the glide path at most 15 years ahead, so a review
  // stays within its time budget; the target there is the straight line from today to the goal (glideTarget).
  const end = s.startAge + s.endTurn;
  return Math.max(s.age + 1, Math.min(s.goal.age > s.age ? s.goal.age : end, s.age + MAX_HORIZON_YEARS));
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
  /**
   * Standard error of this move's loss against the best move, in E (×100 = points): the futures are paired, so it
   * is the spread of the per-future differences ÷ √futures. 0 for the best move itself.
   */
  lossSe: number;
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

interface Line {
  e: Evaluation;
  seq: string[];
  mate: boolean;
}

/** Life's dice in one year of a future: the market bucket, and Life's card for the position it meets. */
interface YearDraw {
  bucket: number;
  life: (s: GameState) => string | null;
}

interface Ctx {
  root: GameState;
  regime: Regime;
  settings: EngineSettings;
  budget: Budget;
  /** Years of each turn inside the tree (its length is the number of plies). */
  turns: number[];
  plies: number;
  hAge: number;
  /** Seed of the futures and of the rollouts (the game seed, unless a test varies the sampling alone). */
  sampleSeed: number;
  /** Tests: one rollout seed for every future, so a leaf is one deterministic function of the position. */
  fixedLeafSeed: boolean;
  cache: Map<string, Evaluation>;
  /** Per die (year + purpose): the stratum of each future. */
  strata: Map<string, number[]>;
  counters: { leafEvals: number; cacheHits: number };
}

/** Moves the engine considers for the player in a future year: the dealt hand without life choices. */
function options(s: GameState, seed: number): string[] {
  const h = dealHand(s, seed);
  const cards = h.cards.filter((c) => !cardById(c).lifeChoice);
  return [...cards, ...(h.holdAllowed || !cards.length ? ["hold"] : [])];
}

const fallback = (opts: string[]) => (opts.includes("hold") ? "hold" : opts[0]);

/**
 * Leaf evaluation on the rollout seed `tag` (the future's number). Lines of one future that reach the same position
 * share the rollout, so the search and the re-scoring pay for it once.
 */
function leaf(ctx: Ctx, tag: string, key: string, s: GameState): Evaluation {
  const id = ctx.fixedLeafSeed ? key : tag + "|" + key;
  const hit = ctx.cache.get(id);
  if (hit) {
    ctx.counters.cacheHits++;
    return hit;
  }
  ctx.counters.leafEvals++;
  const seed = ctx.fixedLeafSeed ? hashSeed(ctx.sampleSeed, "leaf") : hashSeed(ctx.sampleSeed, "leaf", tag);
  const e = evaluatePosition(s, ctx.hAge, ctx.regime, ctx.settings.weights, { paths: ctx.budget.paths, seed });
  ctx.cache.set(id, e);
  return e;
}

/**
 * One turn of Life inside the tree, as `advance` plays it: every year a market bucket (`stepYear`) and then Life's
 * card; after the turn the buffer check. `draw(y)` gives the dice of the y-th year of the turn.
 */
function lifeTurn(ctx: Ctx, after: GameState, years: number, draw: (y: number) => YearDraw): { state: GameState; mate: boolean; crunch: boolean; key: string } {
  let st = after;
  let key = "";
  let crunch = false;
  for (let y = 0; y < years; y++) {
    const d = draw(y);
    const yr = stepYear(st, marketYear(ctx.regime, d.bucket));
    crunch ||= yr.crunch;
    if (yr.mate) return { state: yr.state, mate: true, crunch: true, key: key + d.bucket + ":mate;" };
    st = yr.state;
    const life = d.life(st);
    if (life) st = applyCard(st, life, ctx.regime).state;
    key += d.bucket + ":" + (life ?? "-") + ";";
  }
  st.check = bufferInCheck(st) ? { reason: "buffer", crunchProb: 0, bufferMonths: bufferMonths(st) } : null;
  return { state: st, mate: false, crunch, key };
}

/**
 * Plays one line from the root: `a0`, then (per turn) a move chosen by `choose`, with the dice of `drawAt(year)`
 * (years counted from the root). Returns the leaf evaluation (or the mate value) and the move sequence.
 */
function playLine(ctx: Ctx, tag: string, a0: string, drawAt: (year: number) => YearDraw, choose: (d: number, seq: string[], opts: string[]) => string): Line {
  let st = ctx.root;
  const seq = [a0];
  let path = "";
  let year = 0;
  for (let d = 0; ; d++) {
    const after = applyCard(st, seq[d], ctx.regime).state;
    if (d === ctx.plies) return { e: leaf(ctx, tag, seq.join(">") + "|" + path, after), seq, mate: false };
    const from = year;
    const t = lifeTurn(ctx, after, ctx.turns[d], (y) => drawAt(from + y));
    year += ctx.turns[d];
    path += t.key;
    if (t.mate) return { e: mateValue(ctx.settings.weights), seq, mate: true };
    st = t.state;
    seq.push(choose(d + 1, seq, options(st, ctx.settings.seed)));
  }
}

/**
 * The uniform of future j for one die (a year's market, a year's Life card). The N futures are a Latin hypercube:
 * for every die the unit interval is cut into N strata and each future gets one of them (in a seeded random order),
 * so every market quintile and every Life card appears in its exact share of the futures. Each uniform is still
 * uniform on [0, 1), so the estimate stays unbiased; rare outcomes (a job loss in a bad year) are no longer over- or
 * under-drawn by chance, which is what made a move's loss jump between seeds.
 */
function stratified(ctx: Ctx, j: number, year: number, die: string): number {
  const id = year + die;
  let order = ctx.strata.get(id);
  if (!order) {
    const n = ctx.budget.scenarios;
    order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const k = Math.floor(uniform(ctx.sampleSeed, ctx.root.turn, "stratum", year, die, i) * (i + 1));
      [order[i], order[k]] = [order[k], order[i]];
    }
    ctx.strata.set(id, order);
  }
  return (order[j] + uniform(ctx.sampleSeed, ctx.root.turn, "future", j, year, die)) / order.length;
}

/** The dice of future j in a year (fixed per future and shared by every candidate: common random numbers). */
const sampled = (ctx: Ctx, j: number) => (year: number): YearDraw => ({
  bucket: bucketOf(stratified(ctx, j, year, "market")),
  life: (s) => lifeEventFor(s, ctx.regime, stratified(ctx, j, year, "life")),
});

/**
 * The turns the tree realises before the rollout: at most `maxPlies`, and only turns that end at least a year
 * before the horizon (the rollout needs a year). Same schedule as the game (`turnYears`).
 */
export function treeTurns(root: GameState, hAge: number, maxPlies: number): number[] {
  const turns: number[] = [];
  let age = root.age;
  let turn = root.turn;
  while (turns.length < maxPlies) {
    const years = Math.max(1, Math.min(turn < YEARLY_YEARS ? 1 : LONG_TURN_YEARS, root.endTurn - turn));
    if (age + years > hAge - 1) break;
    turns.push(years);
    age += years;
    turn += years;
  }
  return turns;
}

interface Stat {
  n: number;
  sum: number;
}

function mean(st: Stat | undefined) {
  return st && st.n ? st.sum / st.n : -Infinity;
}

function makeCtx(root: GameState, settings: EngineSettings, budget: Budget, opts: AnalyseOptions): Ctx {
  const hAge = opts.horizonAge ?? horizonAge(root, settings.depth);
  const turns = treeTurns(root, hAge, budget.plies);
  return {
    root,
    regime: opts.regime ?? REGIME[settings.regime],
    settings,
    budget,
    turns,
    plies: turns.length,
    hAge,
    sampleSeed: opts.sampleSeed ?? settings.seed,
    fixedLeafSeed: !!opts.fixedLeafSeed,
    cache: new Map(),
    strata: new Map(),
    counters: { leafEvals: 0, cacheHits: 0 },
  };
}

/**
 * The mean line. E and its four terms are averaged over every future (a mated future has the mate value). The
 * money figures (median, p10, target) are averaged over the futures that survive the tree: a mated line has no
 * net worth to show, and its placeholder zeros would distort what the review displays.
 */
function averaged(lines: Line[]): { e: Evaluation; mateShare: number } {
  const n = lines.length;
  const alive = lines.filter((l) => !l.mate);
  const acc = { pGoal: 0, pCrunch: 0, median: 0, p10: 0, target: 0, wealthScore: 0, shortfall: 0, e: 0 };
  for (const l of lines) for (const k of ["pGoal", "pCrunch", "wealthScore", "shortfall", "e"] as const) acc[k] += l.e[k] / n;
  for (const l of alive) for (const k of ["median", "p10", "target"] as const) acc[k] += l.e[k] / alive.length;
  if (!alive.length) acc.target = lines[0]?.e.target ?? 1;
  return { e: acc, mateShare: (n - alive.length) / n };
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
  /** Tests: seed of the sampled futures and rollouts alone (the hands of future years stay those of the game seed). */
  sampleSeed?: number;
  /** Tests: one rollout seed for all futures (the brute-force comparison needs a leaf to be one function). */
  fixedLeafSeed?: boolean;
  /** Judge at this age instead of the depth's horizon (the realised value of a move at its own horizon). */
  horizonAge?: number;
}

function rootActions(root: GameState, seed: number, opts: AnalyseOptions): { actions: string[]; holdAllowed: boolean } {
  if (opts.candidates) return { actions: opts.candidates, holdAllowed: opts.candidates.includes("hold") };
  const hand = dealHand(root, seed);
  return { actions: [...hand.cards, ...(hand.holdAllowed ? ["hold"] : [])], holdAllowed: hand.holdAllowed };
}

/** Full review of a position: every candidate scored, the best move, the principal variations and the donuts. */
export function analyse(root: GameState, settings: EngineSettings, opts: AnalyseOptions = {}): Analysis {
  const budget = { ...DEFAULT_BUDGET, ...opts.budget };
  const ctx = makeCtx(root, settings, budget, opts);
  const { actions, holdAllowed } = rootActions(root, settings.seed, opts);
  const roots = actions.includes("hold") ? actions : [...actions, "hold"];
  const N = budget.scenarios;
  const stats = new Map<string, Stat>();
  let iterations = 0;

  // ---- search: UCT below the root, every root candidate on every future ----
  // The search only proposes continuations (the two most visited replies at each ply); which of them is better is
  // decided afterwards on paired futures. Half of the futures are enough for that, and that pays for the paired heats.
  if (ctx.plies > 0) {
    for (let j = 0; j < Math.ceil(N / 2); j++) {
      for (const a0 of roots) {
        const line = playLine(ctx, String(j), a0, sampled(ctx, j), (d, seq, opts) => {
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

  /** Children of a prefix, most visited first. */
  const childrenOf = (prefix: string): string[] =>
    [...stats.entries()]
      .filter(([k]) => k.startsWith(prefix + ">") && !k.slice(prefix.length + 1).includes(">"))
      .sort((x, y) => y[1].n - x[1].n || mean(y[1]) - mean(x[1]))
      .map(([k]) => k.slice(prefix.length + 1));

  const pvOf = (a0: string, start: string[] = [a0]): string[] => {
    const seq = [...start];
    for (let d = seq.length; d <= ctx.plies; d++) {
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

  /**
   * The move after next. The search cannot tell two continuations apart that differ by a fraction of a point: its
   * statistics come from different futures for each of them, and the plan it happened to prefer then moved every
   * loss of the position (a plan worth 0.2 points less for the best move makes every other move look 0.2 points
   * better). So the two most visited second replies are compared on the same futures, an eighth of them, and the
   * better one is kept; its lines are reused by the full scoring.
   */
  const refine = (a0: string, plan: string[], run: (plan: string[], j: number) => Line): string[] => {
    if (ctx.plies < 2 || plan.length < 3) return plan;
    const seconds = childrenOf(plan.slice(0, 2).join(">")).slice(0, budget.alternatives);
    if (seconds.length < 2) return plan;
    const heat = Math.min(N, Math.max(8, Math.ceil(N / 8)));
    let best = plan;
    let bestE = -Infinity;
    for (const m of seconds) {
      const variant = pvOf(a0, [plan[0], plan[1], m]);
      let sum = 0;
      for (let j = 0; j < heat; j++) sum += run(variant, j).e.e;
      if (sum > bestE + 1e-12) {
        bestE = sum;
        best = variant;
      }
    }
    return best;
  };

  // ---- scoring: each candidate with its own continuation on all N futures ----
  const hAgeYears = ctx.hAge - root.age;
  const scored = new Map<string, CandidateEval>();
  /** E of each candidate's line on every future (paired across candidates). */
  const perFuture = new Map<string, number[]>();
  const holdState = applyCard(root, "hold", ctx.regime).state;
  for (const a0 of roots) {
    // Visit counts favour continuations that are dealt in many futures, not the best ones: re-score the most
    // visited next moves on all futures (open loop, hold when not dealt) and keep the best plan.
    const run = (plan: string[], j: number) => playLine(ctx, String(j), a0, sampled(ctx, j), (d, _seq, opts) => (plan[d] && opts.includes(plan[d]) ? plan[d] : fallback(opts)));
    const firsts = ctx.plies > 0 ? childrenOf(a0).slice(0, budget.alternatives) : [];
    const plans = firsts.length ? firsts.map((m) => refine(a0, pvOf(a0, [a0, m]), run)) : [pvOf(a0)];
    let pv = plans[0];
    let best: ReturnType<typeof averaged> | null = null;
    for (const plan of plans) {
      const lines: Line[] = [];
      for (let j = 0; j < N; j++) lines.push(run(plan, j));
      const res = averaged(lines);
      if (!best || res.e.e > best.e.e + 1e-12) {
        best = res;
        pv = plan;
        perFuture.set(a0, lines.map((l) => l.e.e));
      }
    }
    const { e, mateShare } = best!;
    const move = applyCard(root, a0, ctx.regime);
    const e1 = evaluatePosition(move.state, root.age + 1, ctx.regime, settings.weights, { paths: budget.paths * E1_PATHS, seed: hashSeed(ctx.sampleSeed, "leaf") }).e;
    ctx.counters.leafEvals++;
    const { e: score, ...parts } = e;
    scored.set(a0, {
      card: a0,
      params: move.params,
      e: score,
      e1,
      parts,
      mateShare,
      lossSe: 0,
      visits: stats.get(a0)?.n ?? 1,
      pv,
      sacrifice: false,
      drain: false,
      lifeChoice: declaredChoice(root, a0),
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
  // Life decisions (children, a partner, a sabbatical) and declared preferences are scored and shown, but the engine
  // never names one as the best move: a higher simulated net worth is not the best *life* decision (UBS guidance).
  // Undeclared, they are still graded against the best other move (their loss is 0 if they score higher).
  const lifeType = (c: CandidateEval) => c.lifeChoice || !!cardById(c.card).lifeChoice;
  const candidates = actions.map((a) => scored.get(a)!).sort((x, y) => Number(lifeType(x)) - Number(lifeType(y)) || y.e - x.e);
  // The loss of a move is the mean of its per-future differences to the best move; the futures are shared, so the
  // standard error is that of a paired difference.
  const top = candidates[0] ? perFuture.get(candidates[0].card)! : [];
  for (const c of scored.values()) {
    const mine = perFuture.get(c.card)!;
    if (c === candidates[0] || N < 2 || !top.length) continue;
    const d = top.map((v, j) => v - mine[j]);
    const mean = d.reduce((a, b) => a + b, 0) / N;
    const variance = d.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (N - 1);
    c.lossSe = Math.sqrt(variance / N);
  }
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
  /** Standard error of the loss in points (sampling noise of the paired futures). */
  lossSe: number;
  label: MoveLabel;
  sacrifice: boolean;
  drain: boolean;
  /** null for life decisions (declared or not): they never count towards the accuracy. */
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
  const lossSe = card === best.card ? 0 : mine.lossSe * 100;
  // A life decision (children, a partner, a sabbatical; any declared preference) is never the best or a brilliant
  // move and never counts towards the accuracy: a higher simulated net worth is not the best *life* decision.
  // Declared, it is not graded at all. Undeclared, it is graded when it costs points against the best other move.
  const lifeDecision = mine.lifeChoice || !!cardById(card).lifeChoice;
  const graded = labelFor(lossPts, mine.sacrifice, mine.lifeChoice, lossSe);
  return {
    card,
    e: mine.e,
    best: best.card,
    bestE: best.e,
    loss: lossPts,
    lossSe,
    label: lifeDecision && (graded === "best" || graded === "brilliant") ? "lifeChoice" : graded,
    sacrifice: mine.sacrifice,
    drain: mine.drain,
    accuracy: lifeDecision ? null : moveAccuracy(lossPts),
    pv: mine.pv,
    bestPv: best.pv,
  };
}

// ---------------- luck: the realised turn against the expected turn ----------------

export interface TurnLuck {
  /** realised − expected, in E (×100 = points). Averages zero over the turns Life can play. */
  luck: number;
  realised: number;
  expected: number;
}

/**
 * The value of a position at the end of a turn, judged at the analysis horizon `ctx.hAge`: a hold rollout to the
 * horizon, or the position's own net worth when the horizon is reached. A cash crunch during the turn counts as
 * the evaluation counts it (no goal, crunch).
 */
function positionValue(ctx: Ctx, s: GameState, crunch: boolean, seed: number): number {
  const w = ctx.settings.weights;
  if (s.status === "mate") return mateValue(w).e;
  if (ctx.hAge > s.age) {
    const e = evaluatePosition(s, ctx.hAge, ctx.regime, w, { paths: ctx.budget.paths, seed });
    return crunch ? combine({ ...e, pGoal: 0, pCrunch: 1 }, w).e : e.e;
  }
  const nw = realNetWorth(s);
  const target = targetAt(s, ctx.hAge);
  return combine({ pGoal: !crunch && nw >= target ? 1 : 0, pCrunch: crunch ? 1 : 0, median: nw, p10: nw, target }, w).e;
}

/**
 * Luck of a turn, kept apart from the quality of the move: the position Life really left (`next`) against the
 * positions it leaves on average after the same move, both valued the same way at the same horizon, on the same
 * rollout seeds. The game's dice have the distribution of the engine's futures, so over many turns luck averages
 * zero by construction; comparing the evaluation before and after a turn does not (uncertainty that resolves
 * raises E on its own, and the horizon moves).
 */
export function turnLuck(root: GameState, card: string, next: GameState, crunch: boolean, settings: EngineSettings, opts: AnalyseOptions = {}): TurnLuck {
  const budget = { ...DEFAULT_BUDGET, ...opts.budget };
  const ctx = makeCtx(root, settings, budget, opts);
  const after = applyCard(root, card, ctx.regime).state;
  const years = turnYears(root);
  const n = budget.scenarios;
  // A rollout is only needed while the horizon lies ahead; otherwise the realised value is the position itself.
  const rollout = next.status !== "mate" && ctx.hAge > next.age;
  let expected = 0;
  let realised = rollout ? 0 : positionValue(ctx, next, crunch, 0);
  for (let j = 0; j < n; j++) {
    const seed = hashSeed(ctx.sampleSeed, "luck", j);
    const t = lifeTurn(ctx, after, years, sampled(ctx, j));
    expected += (t.mate ? mateValue(settings.weights).e : positionValue(ctx, t.state, t.crunch, seed)) / n;
    if (rollout) realised += positionValue(ctx, next, crunch, seed) / n;
  }
  return { luck: realised - expected, realised, expected };
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
  const ctx = makeCtx(root, settings, budget, { ...opts, fixedLeafSeed: true });
  if (ctx.turns.some((y) => y !== 1)) throw new Error("bruteForce enumerates one-year turns only");
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
      if (d === ctx.plies) return leaf(ctx, "", s2.join(">") + "|" + path, after).e;
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
