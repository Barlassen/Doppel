/**
 * Doppel Play board checks: `npx tsx scripts/board-check.ts`. Exits 1 on any failure.
 *
 * 240 seeded board games of 16 turns (32 plies; random decisions, Life events and financial checks, spread over
 * the profiles) plus 10 games played through the financial simulator with their real hands (slow, so few):
 *  1. every rendered ply is a legal chess move (replayed with chess.js from the start position)
 *  2. the board never ends the game on its own while the financial game is still playing
 *  3. Life never gives check when the financial position is not in check
 *  4. no king move in the first 12 full moves unless castling or in check (both sides)
 *  5. what is offered is what moves: every decision offered on a piece is played by that piece, to that square
 *  6. no ply puts a piece where it is lost for less when a safe move existed (static exchange on the target)
 *  7. the same seed replays the same moves (rendered twice from scratch)
 *  8. the opening looks like one: centre pawn first, minor pieces out, castling
 *  9. rendering a game takes < 1 s
 */
import { Chess, type Move } from "chess.js";
import { QUIET_KING_MOVES, boardCards, boardLine, clearBoardCache, moveRisk, offersFor, previewMove } from "../src/lib/game/board";
import { WEIGHT_PRESETS } from "../src/lib/game/evaluate";
import { isOver, legalMoves, newGame, play, truncate, type Game } from "../src/lib/game/game";
import { PROFILES } from "../src/lib/data/profiles";
import { accountOpening, ubsOpening } from "../src/lib/game/start";
import { ALEXIA_ID } from "../src/lib/ubs";
import type { GameState } from "../src/lib/game/state";

const GAMES = Number(process.env.BOARD_GAMES ?? 240);
const TURNS = 16;
const REAL_GAMES = Number(process.env.BOARD_REAL ?? 10);
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  · " + detail : ""}`);
  if (!ok) failures++;
}

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => ((x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909)), (x >>>= 0) / 4294967296);
}

function randomGame(start: GameState, seed: number, turns: number): Game {
  const r = rng(seed);
  let g = newGame(start, { regime: seed % 3 === 0 ? "stress" : "normal", seed, depth: "goal", weights: WEIGHT_PRESETS.balanced, preset: "balanced" });
  while (!isOver(g) && g.moves.length < turns) {
    const hand = legalMoves(g);
    g = play(g, hand[Math.floor(r() * hand.length)]);
  }
  return g;
}

/** A board game without the financial simulator: random decisions, Life events and financial checks. */
function boardGame(start: GameState, seed: number, turns: number): Game {
  const r = rng(seed * 7919 + 13);
  const { player, life } = boardCards();
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const positions = Array.from({ length: turns + 1 }, (_, k) => ({ ...start, turn: k, status: "playing", check: k > 4 && r() < 0.15 }));
  const moves = Array.from({ length: turns }, () => ({ card: pick(player) }));
  const lifeEvents = [null, ...Array.from({ length: turns }, () => (r() < 0.6 ? { card: pick(life) } : { card: null }))];
  return { settings: { seed }, positions, moves, lifeEvents } as unknown as Game;
}

async function main() {
  const starts: GameState[] = [await ubsOpening(ALEXIA_ID), ...PROFILES.map((p) => accountOpening(p))];
  let plies = 0;
  let illegal = 0;
  let early = 0;
  let falseCheck = 0;
  let finChecks = 0;
  let boardChecks = 0;
  let kingWalks = 0;
  let offered = 0;
  let offerMismatch = 0;
  let offerIllegal = 0;
  let unsafe = 0;
  let unsafeForced = 0;
  let replayDiff = 0;
  let shortGames = 0;
  let centreFirst = 0;
  let castled = { w: 0, b: 0 };
  let minorsOut = 0;
  let longGames = 0;
  let maxMs = 0;
  const samples: string[] = [];

  for (let i = 0; i < GAMES + REAL_GAMES; i++) {
    const seed = 1000 + i;
    const real = i >= GAMES;
    const make = () => (real ? randomGame(starts[i % starts.length], seed, TURNS) : boardGame(starts[i % starts.length], seed, TURNS));
    const game = make();
    clearBoardCache();
    const t0 = performance.now();
    const line = boardLine(game);
    maxMs = Math.max(maxMs, performance.now() - t0);
    const ch = new Chess();
    const sans: string[] = [];
    line.turns.forEach((turn, k) => {
      for (const ply of [turn.white, turn.black]) {
        if (!ply) continue;
        plies++;
        const full = Number(ch.fen().split(" ")[5]);
        const inCheck = ch.inCheck();
        const legal = ch.moves({ verbose: true }) as Move[];
        const m = legal.find((x) => x.from === ply.from && x.to === ply.to && (x.promotion ?? null) === ply.promotion);
        if (!m) {
          illegal++;
          continue;
        }
        const castle = m.flags.includes("k") || m.flags.includes("q");
        const kingWalk = (x: Move) => x.piece === "k" && !(x.flags.includes("k") || x.flags.includes("q"));
        if (kingWalk(m) && !inCheck && full <= QUIET_KING_MOVES) kingWalks++;
        // Safety: a risky target square is only allowed when every other allowed move was risky too.
        if (moveRisk(ch, m) > 0) {
          const safe = legal.some((x) => {
            if (x === m || (kingWalk(x) && !inCheck) || moveRisk(ch, x) > 0) return false;
            ch.move(x);
            const bad = ch.isGameOver() || ch.inCheck();
            ch.undo();
            return !bad;
          });
          if (safe) unsafe++;
          else unsafeForced++;
        }
        ch.move(m);
        sans.push(ply.san);
        if (castle) castled[ply.side]++;
        if (ch.isGameOver() && !(game.positions[k + 1] && game.positions[k + 1].status !== "playing")) early++;
      }
      if (turn.black) {
        const next = game.positions[k + 1];
        if (next.status === "playing") {
          if (next.check) {
            finChecks++;
            if (turn.black.check) boardChecks++;
          } else if (turn.black.check) falseCheck++;
        }
      }
    });
    if (line.turns.filter((t) => t.white).length * 2 < 30) shortGames++;
    else longGames++;
    if (/^[de]4$/.test(sans[0] ?? "") || /^N[cf]3$/.test(sans[0] ?? "")) centreFirst++;
    // Minor pieces out: after 10 full moves at most one white minor piece is still at home.
    if (line.turns.length > 10) {
      const at10 = new Chess(line.turns[10].fen);
      const home = ["b1", "c1", "f1", "g1"].filter((sq) => ["n", "b"].includes(at10.get(sq as "b1")?.type ?? "")).length;
      if (home <= 1) minorsOut++;
    }
    if (samples.length < 3) samples.push(sans.slice(0, 20).map((s, j) => (j % 2 === 0 ? `${j / 2 + 1}.${s}` : s)).join(" "));

    // What is offered is what moves: every decision of the hand, in the first turns and in every fifth turn.
    for (let k = 0; k < game.moves.length; k++) {
      const all = real && (k < 4 || k % 6 === 0);
      const at = all ? truncate(game, k) : game;
      const hand = all ? legalMoves(at) : [game.moves[k].card];
      const offers = offersFor(line, k, hand, seed, game.positions[k].business?.kind);
      const pos = new Chess(line.turns[k].fen);
      for (const o of offers) {
        offered++;
        const piece = pos.get(o.from);
        if (!piece || piece.color !== "w" || piece.type !== o.piece || !(pos.moves({ square: o.from, verbose: true }) as Move[]).some((x) => x.to === o.to)) offerIllegal++;
        const played = o.card === game.moves[k].card ? line.turns[k].white : boardLine(play(at, o.card)).turns[k].white;
        if (!played || played.from !== o.from || played.to !== o.to) offerMismatch++;
      }
      if (offers.length !== hand.length) offerIllegal++;
    }

    // Same seed, same moves: the same decisions played again and rendered from scratch.
    clearBoardCache();
    const again = boardLine(real && i % 3 ? game : make());
    if (JSON.stringify(again) !== JSON.stringify(line)) replayDiff++;
  }

  check("games are long enough to judge (30+ plies)", longGames >= Math.min(200, GAMES), `${longGames} of ${GAMES} games with 30+ plies, ${shortGames} shorter (the financial game ended), ${plies} plies in all`);
  check("every ply is a legal chess move", illegal === 0, `${illegal} illegal of ${plies}`);
  check("the board never ends a game that is still playing", early === 0, `${early} early game-overs`);
  check("Life never checks outside financial check", falseCheck === 0, `${falseCheck} false checks · ${boardChecks}/${finChecks} financial checks shown as a chess check`);
  check(`no king move in the first ${QUIET_KING_MOVES} moves unless castling or in check`, kingWalks === 0, `${kingWalks} king walks`);
  check("what is offered is what moves (piece and target square)", offerMismatch === 0 && offerIllegal === 0 && offered >= GAMES * 10, `${offered} offers, ${offerMismatch} played by another piece or to another square, ${offerIllegal} without a legal move`);
  check("no piece is put where it is lost for less while a safe move existed", unsafe === 0, `${unsafe} unsafe plies · ${unsafeForced} risky plies without a safe alternative`);
  check("the same seed replays the same moves", replayDiff === 0, `${replayDiff} of ${GAMES + REAL_GAMES} games differ`);
  check("openings: centre pawn or knight first, minor pieces out by move 10, castling", centreFirst === GAMES + REAL_GAMES && minorsOut >= longGames * 0.8 && castled.w >= longGames * 0.8, `first move in the centre ${centreFirst}/${GAMES + REAL_GAMES} · minors out by move 10 in ${minorsOut} games · castled: player ${castled.w}, Life ${castled.b}`);
  check("render time (a full line < 1 s)", maxMs < 1000, `slowest ${maxMs.toFixed(0)} ms`);
  // Promotion: the business pawn promotes to the asset chosen (rook = shop, queen = factory).
  const promoFen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 60";
  const shop = previewMove(promoFen, "openShop", 1);
  const factory = previewMove(promoFen, "buildFactory", 1);
  check("promotion: a shop makes a rook, a factory a queen", shop?.promotion === "r" && factory?.promotion === "q", `${shop?.san} · ${factory?.san}`);
  console.log("\nsample openings:\n" + samples.join("\n"));
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
