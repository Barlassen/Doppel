/**
 * Doppel Play checks: `npm run play:check` (or `npx tsx scripts/play-check.ts`). Exits 1 on any failure.
 *
 *  1. same seed → same game (and the DGN record replays to the same game)
 *  2. the best move's loss is 0
 *  3. the sacrifice tag fires for a home purchase at goal depth, not at 1-year depth
 *  4. mate fires when a hard constraint breaks
 *  5. with a big budget, MCTS agrees with brute-force enumeration on a tiny tree
 *  6. E is never produced by the LLM (no model/network code in the game; E recomputes exactly)
 *  7. every card and every year keep the cash identity: opening + flows = closing, for every account
 *  8. the one-year stepper agrees with the Monte Carlo simulator on the expected year
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROFILES } from "../src/lib/data/profiles";
import { simulate } from "../src/lib/game/sim";
import type { Profile } from "../src/lib/finance/types";
import { ALL_CARDS, DECISION_CARDS, LIFE_CARDS, applyCard, dealHand } from "../src/lib/game/cards";
import { analyse, bruteForce, reviewMove } from "../src/lib/game/engine";
import { WEIGHT_PRESETS, combine, evaluatePosition, mateValue } from "../src/lib/game/evaluate";
import { advance, currentPosition, isOver, newGame, play, type Game, type GameSettings } from "../src/lib/game/game";
import { holdLine, rateGame } from "../src/lib/game/rating";
import { FI_THRESHOLD, fiProbability } from "../src/lib/game/independence";
import { replay, toRecord } from "../src/lib/game/notation";
import { BUCKET_Z, MEDIAN_BUCKET, REGIME, marketYear, type Regime, uniform } from "../src/lib/game/regime";
import { accountOpening, ubsOpening } from "../src/lib/game/start";
import { type GameState, initialState, ledgerError, netWorth, stepYear, toSimInput, monthlyOutflow, pensionNet } from "../src/lib/game/state";
import { ALEXIA_ID } from "../src/lib/ubs";

let failures = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  · " + detail : ""}`);
  if (!ok) failures++;
}
const pts = (e: number) => (e * 100).toFixed(2);

const settings = (over: Partial<GameSettings> = {}): GameSettings => ({
  regime: "normal",
  depth: "goal",
  weights: WEIGHT_PRESETS.balanced,
  seed: 2026,
  preset: "balanced",
  ...over,
});

/** Plays a whole game choosing the engine's best move each turn. */
function engineGame(start: GameState, s: GameSettings, budget = { scenarios: 12, paths: 48 }): { game: Game; picks: string[] } {
  let g = newGame(start, s);
  const picks: string[] = [];
  while (currentPosition(g).status === "playing") {
    const a = analyse(currentPosition(g), s, { budget });
    picks.push(a.best);
    g = play(g, a.best);
  }
  return { game: g, picks };
}

/** The same person one year after retiring at 65 (pensions in payment). */
function pensionerFor(s: GameState): GameState {
  return stepYear({ ...s, age: 65, retirementAge: 65 }, marketYear(REGIME.normal, MEDIAN_BUCKET)).state;
}

function profileFor(over: Partial<Profile>): Profile {
  return { ...PROFILES[1], events: [], transactions: [], trades: [], ...over };
}

async function main() {
  const alexia = await ubsOpening(ALEXIA_ID);
  const S = settings();

  // ---------- worked example: Alexia's first move ----------
  {
    const t0 = performance.now();
    const a = analyse(currentPosition(newGame(alexia, S)), S);
    const ms = performance.now() - t0;
    console.log(`Alexia, turn 1 (age ${alexia.age}), depth goal → horizon age ${a.horizonAge}, plies ${a.plies}, ${a.stats.leafEvals} leaf rollouts (${a.stats.cacheHits} cached), ${ms.toFixed(0)} ms`);
    for (const c of a.candidates) {
      const r = reviewMove(a, c.card);
      console.log(`  ${c.card.padEnd(15)} E ${pts(c.e).padStart(6)}  E1y ${pts(c.e1).padStart(6)}  P(goal) ${(c.parts.pGoal * 100).toFixed(0).padStart(3)}%  P(crunch) ${(c.parts.pCrunch * 100).toFixed(0).padStart(3)}%  median CHF ${Math.round(c.parts.median).toLocaleString("en").padStart(8)}  mate ${(c.mateShare * 100).toFixed(0).padStart(3)}%  loss ${r.loss.toFixed(2).padStart(6)} ${r.label.padEnd(10)} pv ${c.pv.join(" → ")}`);
    }
    console.log(`  hold reference E ${pts(a.hold.e)}`);
  }

  // ---------- 1. same seed → same game; the record replays ----------
  {
    const one = engineGame(alexia, S);
    const two = engineGame(alexia, S);
    const same = JSON.stringify(one.game) === JSON.stringify(two.game);
    check("same seed → same game", same, `${one.picks.length} moves, result ${currentPosition(one.game).status}: ${one.picks.join(", ")}`);
    const record = toRecord(one.game);
    const replayed = replay(JSON.parse(JSON.stringify(record)), alexia);
    check("game record (DGN) replays to the same game", JSON.stringify(replayed) === JSON.stringify(one.game), `${JSON.stringify(record).length} bytes`);
    const other = engineGame(alexia, settings({ seed: 7 }));
    check("a different seed gives a different game", JSON.stringify(other.game.lifeEvents) !== JSON.stringify(one.game.lifeEvents) || JSON.stringify(other.game.moves.map((m) => m.market)) !== JSON.stringify(one.game.moves.map((m) => m.market)));
  }

  // ---------- 2. best move loss = 0 ----------
  {
    const positions: GameState[] = [alexia];
    let g = newGame(alexia, S);
    g = play(g, "pathWork");
    positions.push(currentPosition(g));
    for (const p of PROFILES) positions.push(accountOpening(p));
    let ok = true;
    const seen: string[] = [];
    for (const pos of positions) {
      const a = analyse(pos, S, { budget: { scenarios: 12, paths: 48 } });
      const r = reviewMove(a, a.best);
      ok &&= r.loss === 0 && (r.label === "best" || r.label === "brilliant");
      for (const c of a.candidates) ok &&= reviewMove(a, c.card).loss >= 0;
      seen.push(`${pos.name}: ${a.best} ${r.label}`);
    }
    check("the best move's loss is 0 (and no move has a negative loss)", ok, seen.join("; "));
  }

  // ---------- 3. sacrifice: a home purchase at goal depth, not at 1-year depth ----------
  {
    const buyer = initialState(
      profileFor({ id: "buyer", name: "Test buyer", age: 32, canton: "ZH", city: "Zürich", grossIncomeYear: 150_000, netIncomeMonth: 9000, expensesMonth: 6200, rentMonth: 3200, cash: 260_000, portfolio: 0, pillar2: 90_000, pillar3a: 30_000, investShare: 0, riskProfile: "conservative", marginalTaxRate: 0.3, goal: { label: { key: "profile.goalK", params: { target: 1_100_000, age: 52 } }, target: 1_100_000, age: 52 } }),
      { lengthTurns: 20, ubs: { alexiaPaths: null, s001: null } },
    );
    buyer.check = null;
    const cands = ["buyHome", "hold"];
    const goal = analyse(buyer, S, { candidates: cands });
    const short = analyse(buyer, settings({ depth: "1y" }), { candidates: cands });
    const g = goal.candidates.find((c) => c.card === "buyHome")!;
    const s = short.candidates.find((c) => c.card === "buyHome")!;
    const price = g.params.find((p) => p.key === "price")?.value ?? 0;
    check("sacrifice tag: home purchase at goal depth", g.sacrifice, `price CHF ${price.toLocaleString("en")}: E1y ${pts(g.e1)} vs hold ${pts(goal.hold.e1)}, E(goal age) ${pts(g.e)} vs hold ${pts(goal.hold.e)}`);
    check("no sacrifice tag at 1-year depth", !s.sacrifice, `E1y ${pts(s.e)} vs hold ${pts(short.hold.e)}`);
    check("the verdict flips with depth (best at goal depth, not at 1 year)", goal.best === "buyHome" && short.best === "hold", `goal: ${goal.best} · 1y: ${short.best}`);
  }

  // ---------- 4. mate when a hard constraint breaks ----------
  {
    const broke = initialState(
      profileFor({ id: "broke", name: "Test broke", age: 30, grossIncomeYear: 36_000, netIncomeMonth: 2400, expensesMonth: 7200, rentMonth: 1800, cash: 3000, portfolio: 0, pillar2: 0, pillar3a: 0 }),
      { lengthTurns: 10, ubs: { alexiaPaths: null, s001: null } },
    );
    const yr = stepYear(broke, marketYear(REGIME.normal, MEDIAN_BUCKET));
    check("mate: the year breaks the credit line and the arrears cap", yr.mate, `min cash CHF ${Math.round(yr.minCash).toLocaleString("en")}`);
    // A smaller shortfall becomes arrears (a loan) and leaves the player in check, not mate.
    const tight = { ...broke, expenses: 3900, rent: 1800 };
    const yt = stepYear(tight, marketYear(REGIME.normal, MEDIAN_BUCKET));
    const arrears = yt.state.debts.find((d) => d.id === "debt-arrears");
    check("arrears: a shortfall under the cap becomes a 10% loan, not mate", !yt.mate && !!arrears && arrears.principal > 0 && ledgerError(yt.ledger) < 1e-6, `arrears CHF ${Math.round(arrears?.principal ?? 0).toLocaleString("en")} · ledger error ${ledgerError(yt.ledger).toExponential(1)}`);
    let g = newGame(broke, S);
    const legal = currentPosition(g).check ? "in check" : "not in check";
    const move = analyse(currentPosition(g), S, { budget: { scenarios: 8, paths: 32 } });
    g = play(g, move.best);
    check("mate ends the game", currentPosition(g).status === "mate", `${legal}, played ${move.best}, status ${currentPosition(g).status}`);
    const sure = analyse(broke, S, { candidates: ["hold"], budget: { scenarios: 8, paths: 32 } });
    check("a line that is mated in every future scores the mate value", Math.abs(sure.hold.e - mateValue(S.weights).e) < 1e-12 && sure.hold.mateShare === 1, `E ${pts(sure.hold.e)}`);
  }

  // ---------- 5. MCTS = brute force on a tiny tree ----------
  {
    // Two Life cards that matter (a job gap, a market drawdown) on a position with little room.
    const tiny: Regime = { ...REGIME.stress, eventProb: 0.4, lifeWeights: { lifeJobloss: 1, lifeDrawdown: 1 } };
    const pos = { ...accountOpening(PROFILES[2]), cash: 9000, portfolio: 12_000, check: null };
    const cands = ["investIdle", "cutSpending", "hold"];
    const opts = { regime: tiny, candidates: cands, budget: { plies: 1, paths: 32, scenarios: 1500 } };
    const t0 = performance.now();
    const exact = bruteForce(pos, S, opts);
    const t1 = performance.now();
    const mcts = analyse(pos, S, opts);
    const t2 = performance.now();
    const bfBest = [...exact.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const worst = Math.max(...mcts.candidates.map((c) => Math.abs(c.e - exact.get(c.card)!)));
    check("MCTS agrees with brute force on the best move", mcts.best === bfBest, `${mcts.best} vs ${bfBest}`);
    check("MCTS values match the exact expectimax values", worst < 0.005, `max |ΔE| ${(worst * 100).toFixed(3)} pts · ${mcts.candidates.map((c) => `${c.card} ${pts(c.e)}/${pts(exact.get(c.card)!)}`).join(", ")} · brute force ${(t1 - t0).toFixed(0)} ms, MCTS ${(t2 - t1).toFixed(0)} ms`);
  }

  // ---------- 6. E is never produced by the LLM ----------
  {
    const dir = join(process.cwd(), "src", "lib", "game");
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), "utf8");
      if (/from ["']@\/lib\/llm|\/api\/|fetch\(|openrouter|XMLHttpRequest|Math\.random\(/i.test(text)) offenders.push(f);
    }
    check("no model, network or Math.random code in src/lib/game", offenders.length === 0, offenders.join(", ") || readdirSync(dir).join(" "));
    const working = currentPosition(play(newGame(alexia, S), "pathWork"));
    const e1 = evaluatePosition(working, 27, REGIME.normal, S.weights, { paths: 64, seed: 9 });
    const e2 = evaluatePosition(working, 27, REGIME.normal, S.weights, { paths: 64, seed: 9 });
    const recombined = combine({ pGoal: e1.pGoal, pCrunch: e1.pCrunch, median: e1.median, p10: e1.p10, target: e1.target }, S.weights).e;
    const manual = 0.4 * 0.5 + 0.3 * (1 - 0.1) + 0.2 * 0.75 - 0.1 * 0.5;
    const formula = combine({ pGoal: 0.5, pCrunch: 0.1, median: 200_000, p10: 50_000, target: 100_000 }, S.weights).e;
    check("E is deterministic and equals the formula", e1.e === e2.e && Math.abs(recombined - e1.e) < 1e-12 && Math.abs(formula - manual) < 1e-12, `E ${pts(e1.e)} · formula example ${pts(formula)} = ${pts(manual)}`);
  }

  // ---------- 7. cash identity for every card and every year ----------
  {
    const samples: GameState[] = [alexia];
    let g = newGame(alexia, S);
    g = play(g, "pathWork");
    samples.push(currentPosition(g));
    for (const p of PROFILES) samples.push(accountOpening(p));
    const owner = applyCard(samples[samples.length - 2], "buyHome", REGIME.normal);
    samples.push(owner.state);
    const indebted = applyCard(applyCard(samples[1], "buyCar", REGIME.normal).state, "pathWork", REGIME.normal).state;
    samples.push({ ...indebted, cash: 1500 });
    const student = applyCard(alexia, "pathMasterLoan", REGIME.normal).state;
    samples.push(student);
    const rich = { ...accountOpening(PROFILES[1]), cash: 150_000, gross: 140_000, net: 8400 };
    samples.push(rich, applyCard(rich, "partTime", REGIME.normal).state);
    // Retirement: a worker close to retirement, a pensioner (renting and owning), and an 81-year-old.
    const nearRetirement = { ...accountOpening(PROFILES[1]), age: 62, pillar2: 380_000, pillar3a: 60_000 };
    samples.push(nearRetirement);
    const pensioner = stepYear({ ...nearRetirement, age: 65, retirementAge: 65 }, marketYear(REGIME.normal, MEDIAN_BUCKET)).state;
    samples.push(pensioner, { ...pensioner, age: 81 });
    samples.push(stepYear({ ...owner.state, age: 65, retirementAge: 65 }, marketYear(REGIME.normal, MEDIAN_BUCKET)).state);
    // Business: a new venture, and one that survived four years (promotion to a shop or a factory).
    const founder = { ...rich, portfolio: 300_000 };
    const venture = applyCard(founder, "startBusiness", REGIME.normal).state;
    samples.push(venture, { ...venture, business: { ...venture.business!, years: 4, policy: "withdraw" as const } });
    let worst = 0;
    let cards = 0;
    let years = 0;
    const exercised = new Set<string>();
    for (const s of samples) {
      for (const c of ALL_CARDS) {
        if (!c.eligible(s)) continue;
        for (const r of [REGIME.calm, REGIME.stress]) {
          const res = applyCard(s, c.id, r);
          worst = Math.max(worst, ledgerError(res.ledger));
          cards++;
          exercised.add(c.id);
        }
      }
      for (let b = 0; b < BUCKET_Z.length; b++) {
        const yr = stepYear(s, marketYear(REGIME.normal, b));
        worst = Math.max(worst, ledgerError(yr.ledger));
        years++;
      }
    }
    const missing = [...DECISION_CARDS, ...LIFE_CARDS].filter((c) => !exercised.has(c.id)).map((c) => c.id);
    check("cash identity: opening + flows = closing (every account, every card, every year)", worst < 1e-6, `${cards} card transitions, ${years} years, max error CHF ${worst.toExponential(1)}${missing.length ? " · not exercised: " + missing.join(", ") : ""}`);
  }

  // ---------- 8. the stepper and the simulator agree on the expected year ----------
  {
    let worst = 0;
    const rows: string[] = [];
    for (const start of [accountOpening(PROFILES[0]), accountOpening(PROFILES[1]), accountOpening(PROFILES[2])]) {
      const nwTree = [0, 1, 2, 3, 4].reduce((sum, b) => sum + netWorth(stepYear(start, marketYear(REGIME.normal, b)).state) / 5, 0);
      const res = simulate({ ...toSimInput(start, start.age + 1, REGIME.normal, 4000, 11), shocks: undefined });
      // simulate's bands are real (deflated): compare nominal by inflating back one year.
      const nwSim = res.bands[1].p50 * (1 + REGIME.normal.inflation);
      const rel = Math.abs(nwTree - nwSim) / Math.max(1, nwSim);
      worst = Math.max(worst, rel);
      rows.push(`${start.name} ${Math.round(nwTree).toLocaleString("en")} vs ${Math.round(nwSim).toLocaleString("en")}`);
    }
    check("one-year stepper ≈ simulator median (within 3%)", worst < 0.03, rows.join(" · ") + ` · worst ${(worst * 100).toFixed(1)}%`);
  }

  // ---------- 9. long game: turn schedule, retirement, independence, rating ----------
  {
    // Turns: yearly for ten years, then five-year turns, up to age 80.
    let g = newGame(accountOpening(PROFILES[0]), S);
    const lengths: number[] = [];
    while (!isOver(g) && g.moves.length < 13) {
      g = advance(g, "hold");
      lengths.push(g.moves[g.moves.length - 1].years);
    }
    const scheduleOk = lengths.slice(0, 10).every((y) => y === 1) && lengths.slice(10).every((y) => y === 5);
    check("turns: ten one-year turns, then five-year turns", scheduleOk || isOver(g), `${lengths.join(",")} · end age ${accountOpening(PROFILES[0]).age + accountOpening(PROFILES[0]).endTurn}`);

    // Retirement: pension fund → annuity, 3a paid out, AHV from 65; the ledger still balances.
    const worker = { ...accountOpening(PROFILES[1]), age: 65, retirementAge: 65, pillar2: 400_000, pillar3a: 80_000 };
    const yr = stepYear(worker, marketYear(REGIME.normal, MEDIAN_BUCKET));
    const p = yr.state.pension;
    const ok = !!p && yr.state.pillar2 === 0 && yr.state.pillar3a === 0 && Math.abs(p.bvgMonth - (400_000 * 0.055) / 12) < 1 && p.ahvMonth > 0 && ledgerError(yr.ledger) < 1e-6;
    check("retirement: annuity at the conversion rate, 3a paid out, AHV, ledger balances", ok, p ? `BVG CHF ${Math.round(p.bvgMonth)}/mo · AHV CHF ${Math.round(p.ahvMonth)}/mo · ledger error ${ledgerError(yr.ledger).toExponential(1)}` : "no pension");

    // Lump sum: capital into the portfolio after the withdrawal tax, no annuity.
    const lump = applyCard({ ...worker, age: 64 }, "lumpSum", REGIME.normal).state;
    const yl = stepYear({ ...lump, age: 65 }, marketYear(REGIME.normal, MEDIAN_BUCKET));
    const lp = yl.state.pension;
    check("lump sum: the pension fund is paid out as capital, no annuity", !!lp && lp.bvgMonth === 0 && yl.state.portfolio > lump.portfolio + 400_000 * 0.9 && ledgerError(yl.ledger) < 1e-6, `portfolio CHF ${Math.round(lump.portfolio).toLocaleString("en")} → ${Math.round(yl.state.portfolio).toLocaleString("en")} · BVG annuity ${Math.round(lp?.bvgMonth ?? -1)}`);

    // A retiree whose savings run out before 95 is not independent; one whose pensions cover the spending is.
    const pensioner = pensionerFor(worker);
    const retiredShort = { ...pensioner, cash: 20_000, portfolio: 120_000, expenses: pensionNet(pensioner) + 1500, expenseDelta: 0 };
    const retiredFine = { ...retiredShort, expenses: pensionNet(retiredShort) * 0.9, rent: 0 };
    const pShort = fiProbability(retiredShort, REGIME.normal, retiredShort.age + 1, 7);
    const pFine = fiProbability(retiredFine, REGIME.normal, retiredFine.age + 1, 7);
    check("retiree independence: savings must cover the pension gap until 95", pShort < FI_THRESHOLD && pFine >= FI_THRESHOLD, `gap CHF ${Math.round(monthlyOutflow(retiredShort) - pensionNet(retiredShort))}/mo: ${(pShort * 100).toFixed(0)}% · pensions cover spending: ${(pFine * 100).toFixed(0)}%`);

    // Independence ends the game as a win.
    const rich = { ...accountOpening(PROFILES[1]), age: 55, cash: 400_000, portfolio: 3_000_000, check: null };
    const won = advance(newGame(rich, S), "hold");
    check("independence (savings last to 95 in ≥ 90% of futures) wins the game", currentPosition(won).status === "won", `status ${currentPosition(won).status} at ${currentPosition(won).age}`);

    // Rating: deterministic, and holding scores exactly the reference formula.
    const holdGame = holdLine(newGame(accountOpening(PROFILES[0]), S));
    const r1 = rateGame(holdGame);
    const r2 = rateGame(holdGame);
    const expected = Math.round(1200 + 0.4 * (r1.holdScore - 1200));
    check("rating: deterministic; holding every year rates 1200 + 0.4 × (outcome − 1200)", r1.elo === r2.elo && r1.elo === expected && r1.playerScore === r1.holdScore, `Elo ${r1.elo} (${r1.tier}) · outcome ${r1.player.kind} at ${r1.player.age}`);
  }

  // ---------- 10. declared life preferences ----------
  {
    const base = { ...accountOpening(PROFILES[1]), check: null };
    const cands = ["haveChild", "hold"];
    const undeclared = analyse(base, S, { candidates: cands, budget: { scenarios: 8, paths: 32 } });
    const declared = analyse({ ...base, prefs: ["children"] }, S, { candidates: cands, budget: { scenarios: 8, paths: 32 } });
    const lu = reviewMove(undeclared, "haveChild").label;
    const ld = reviewMove(declared, "haveChild").label;
    const dealt = dealHand({ ...base, prefs: ["children"] }, S.seed).cards.includes("haveChild");
    check("preferences: a declared choice is not graded (♡) and is dealt; undeclared it is graded", ld === "lifeChoice" && lu !== "lifeChoice" && dealt, `undeclared ${lu} · declared ${ld} · dealt ${dealt}`);
  }

  // ---------- 11. business: survival calibrated to the BFS (about half of new firms after five years) ----------
  {
    let alive = 0;
    const n = 600;
    for (let i = 0; i < n; i++) {
      let st: GameState = { ...accountOpening(PROFILES[1]), profileId: "founder-" + i, cash: 200_000 };
      st = applyCard(st, "startBusiness", REGIME.normal).state;
      for (let y = 0; y < 5 && st.business; y++) st = stepYear(st, marketYear(REGIME.normal, Math.floor(uniform(i, y, "bucket") * 5))).state;
      if (st.business) alive++;
    }
    const share = alive / n;
    check("business: about half of new ventures survive five years (BFS: 47.8–50.1%)", share > 0.4 && share < 0.6, `${(share * 100).toFixed(1)}% of ${n} ventures alive after 5 years`);
    const shopState = applyCard({ ...accountOpening(PROFILES[1]), cash: 300_000, business: { kind: "venture" as const, capital: 60_000, years: 4, profitRate: 0.15, hazard: 0.12, policy: "reinvest" as const, staff: 0 } }, "openShop", REGIME.normal);
    check("business: promotion to a shop adds the asset and its loan, ledger balances", shopState.state.business?.kind === "shop" && shopState.state.debts.some((d) => d.id === "debt-shop") && ledgerError(shopState.ledger) < 1e-6, `capital CHF ${Math.round(shopState.state.business?.capital ?? 0).toLocaleString("en")}`);
  }

  // ---------- budget: a review takes about a second ----------
  {
    const t0 = performance.now();
    const a = analyse(accountOpening(PROFILES[0]), S);
    const ms = performance.now() - t0;
    check("a review fits the budget (< 2.5 s in Node)", ms < 2500, `${a.candidates.length} candidates, ${a.stats.iterations} iterations, ${a.stats.leafEvals} rollouts × ${a.stats.paths} paths, ${ms.toFixed(0)} ms`);
  }

  console.log("");
  for (const r of results) console.log(r);
  console.log(failures ? `\n${failures} check(s) failed` : `\nAll ${results.length} Doppel Play checks passed`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
