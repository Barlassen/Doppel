/**
 * Doppel Play board checks: `npx tsx scripts/board-check.ts`. Exits 1 on any failure.
 *
 *  1. every rendered ply is a legal chess move (replayed with chess.js from the start position)
 *  2. the board never ends the game on its own while the financial game is still playing
 *  3. Life never gives check when the financial position is not in check
 *  4. after the opening (3 Life moves), Life gives check in ≥ 45% of the positions in financial check, and only ever
 *     misses when no checking move exists (the UI then shows an amber ring on the king, never a check glow)
 *  5. blunders leave material en prise more often than best moves do
 *  6. same game + labels → same board line (determinism)
 *  7. rendering a 40-turn game takes < 1 s, and re-rendering after a new review (last label) < 60 ms
 */
import { Chess } from "chess.js";
import { boardLine, previewMove } from "../src/lib/game/board";
import type { MoveLabel } from "../src/lib/game/evaluate";
import { WEIGHT_PRESETS } from "../src/lib/game/evaluate";
import { currentPosition, isOver, legalMoves, newGame, play, type Game } from "../src/lib/game/game";
import { PROFILES } from "../src/lib/data/profiles";
import { accountOpening, ubsOpening } from "../src/lib/game/start";
import { ALEXIA_ID } from "../src/lib/ubs";
import type { GameState } from "../src/lib/game/state";

/** In the first Life moves a chess check is impossible or nearly so; the UI shows the financial check as a king halo. */
const OPENING_TURNS = 3;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  · " + detail : ""}`);
  if (!ok) failures++;
}

const LABELS: MoveLabel[] = ["best", "good", "inaccuracy", "mistake", "blunder", "brilliant", "lifeChoice"];
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => ((x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909)), (x >>>= 0) / 4294967296);
}

function randomGame(start: GameState, seed: number, turns: number): { game: Game; labels: MoveLabel[] } {
  const r = rng(seed);
  let g = newGame(start, { regime: seed % 3 === 0 ? "stress" : "normal", seed, depth: "goal", weights: WEIGHT_PRESETS.balanced, preset: "balanced" });
  const labels: MoveLabel[] = [];
  while (!isOver(g) && g.moves.length < turns) {
    const hand = legalMoves(g);
    g = play(g, hand[Math.floor(r() * hand.length)]);
    labels.push(LABELS[Math.floor(r() * LABELS.length)]);
  }
  return { game: g, labels };
}

async function main() {
  const starts: GameState[] = [await ubsOpening(ALEXIA_ID), ...PROFILES.map((p) => accountOpening(p))];
  let illegal = 0;
  let symbolic = 0;
  let early = 0;
  let falseCheck = 0;
  let finChecks = 0;
  let boardChecks = 0;
  let missedAvailable = 0;
  const missTurns: number[] = [];
  let startChecks = 0;
  const hangBy: Record<string, { n: number; hang: number }> = {};
  let maxMs = 0;
  let maxIncrementalMs = 0;
  let games = 0;

  for (let i = 0; i < 48; i++) {
    const { game, labels } = randomGame(starts[i % starts.length], 1000 + i, 40);
    if (game.positions[0].check) startChecks++;
    const t0 = performance.now();
    const line = boardLine(game, labels);
    maxMs = Math.max(maxMs, performance.now() - t0);
    games++;
    const ch = new Chess();
    line.turns.forEach((turn, k) => {
      for (const ply of [turn.white, turn.black]) {
        if (!ply) continue;
        if (ply.symbolic) {
          // A symbolic promotion (business pawn blocked): replay it as the board did and count it apart.
          symbolic++;
          ch.load(ply.fenAfter);
        } else {
          try {
            ch.move({ from: ply.from, to: ply.to, promotion: ply.promotion ?? "q" });
          } catch {
            illegal++;
          }
        }
        if (ch.isGameOver() && !(game.positions[k + 1] && game.positions[k + 1].status !== "playing")) early++;
      }
      if (turn.white) {
        const l = labels[k];
        const b = (hangBy[l] ??= { n: 0, hang: 0 });
        b.n++;
        if (turn.white.hangs > 0) b.hang++;
      }
      if (turn.black) {
        const next = game.positions[k + 1];
        if (next.status === "playing") {
          if (next.check && k >= OPENING_TURNS) {
            finChecks++;
            if (turn.black.check) boardChecks++;
            else missTurns.push(k);
            if (!turn.black.check && new Chess(turn.white!.fenAfter).moves().some((s) => /[+#]/.test(s))) missedAvailable++;
          } else if (!next.check && turn.black.check) falseCheck++;
        }
      }
    });
    // A new review changes only the last label: the cached turns make that re-render cheap.
    const relabelled = labels.map((l, j) => (j === labels.length - 1 ? (l === "best" ? "blunder" : "best") : l));
    const t1 = performance.now();
    boardLine(game, relabelled);
    maxIncrementalMs = Math.max(maxIncrementalMs, performance.now() - t1);
    const again = boardLine(game, labels);
    if (JSON.stringify(again) !== JSON.stringify(line)) check(`determinism game ${i}`, false);
    void currentPosition;
  }
  check("every ply is a legal chess move (symbolic business promotions apart)", illegal === 0, `${illegal} illegal · ${symbolic} symbolic promotions`);
  check("the board never ends a game that is still playing", early === 0, `${early} early game-overs`);
  check("Life never checks outside financial check", falseCheck === 0, `${falseCheck} false checks`);
  const rate = finChecks ? boardChecks / finChecks : 1;
  check("Life checks when the position is in financial check (after the opening)", rate >= 0.45, `${boardChecks}/${finChecks} = ${(rate * 100).toFixed(0)}% · missed with a check available: ${missedAvailable} · games starting in check: ${startChecks} · missed at turns ${missTurns.join(",")}`);
  check("Life only misses a financial check when no checking move exists", missedAvailable === 0, `${missedAvailable} missed with a check available`);
  const hr = (l: string) => (hangBy[l] ? hangBy[l].hang / hangBy[l].n : 0);
  check("blunders hang material more often than best moves", hr("blunder") > hr("best") + 0.3, `blunder ${(hr("blunder") * 100).toFixed(0)}% · mistake ${(hr("mistake") * 100).toFixed(0)}% · best ${(hr("best") * 100).toFixed(0)}% · good ${(hr("good") * 100).toFixed(0)}%`);
  check("render time (full line < 1 s, after a new review < 60 ms)", maxMs < 1000 && maxIncrementalMs < 60, `${games} games, slowest full ${maxMs.toFixed(0)} ms, slowest incremental ${maxIncrementalMs.toFixed(1)} ms`);
  // Promotion: the business pawn promotes to the asset chosen (rook = shop, queen = factory).
  const promoFen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
  const shop = previewMove(promoFen, "openShop", "best", 1);
  const factory = previewMove(promoFen, "buildFactory", "best", 1);
  check("promotion: a shop makes a rook, a factory a queen", shop?.promotion === "r" && factory?.promotion === "q", `${shop?.san} · ${factory?.san}`);
  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall board checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
