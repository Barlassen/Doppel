/**
 * Doppel Play: the chessboard view of a game.
 *
 * The financial engine decides everything (labels, values, check, mate). This module only *renders* a game as a
 * legal chess game, so that what a move did financially is also visible on the board:
 *  - every decision card moves the piece of its domain (king = liquidity, queen = human capital, knights = income,
 *    bishops = investments (light square: equities, dark square: bonds/3a), rooks = housing, pawns = habits and
 *    life choices); Life (Black) moves the piece of its event;
 *  - the move's quality follows the engine's label: best/good moves are safe and active, an inaccuracy is passive,
 *    a mistake or blunder leaves material en prise and Life's next hit takes it;
 *  - Life gives check exactly when the financial position is in check (buffer < 3 months or crunch risk), when the
 *    board allows it; positive Life events (windfall, promotion) leave a piece for the player to take;
 *  - the board never ends a game on its own: moves that would mate, stalemate or draw are avoided unless the
 *    financial game ended in mate (then Life tries to mate) or in a win (then the player tries to mate Life).
 *
 * Deterministic: same game, same labels → same board line (ties are broken by a hash, not by Math.random).
 * Uses chess.js only for legal move generation and attack maps. No numbers from here are shown as financial results.
 */
import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import type { Game } from "./game";

export type LifeTone = "hit" | "gift" | "quiet";

/** The domain each piece stands for (both colours). */
export const PIECE_DOMAIN: Record<PieceSymbol, string> = {
  k: "liquidity",
  q: "humanCapital",
  n: "income",
  b: "investments",
  r: "housing",
  p: "habits",
};

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Direction of a decision on the board: building moves forward, protecting moves back towards the king. */
export type Motion = "build" | "protect" | "spend" | "neutral";

interface PieceIntent {
  piece: PieceSymbol | null;
  motion?: Motion;
  /** A business move: push the business pawn (the most advanced pawn with the freest path). */
  business?: boolean;
  /** Promotion piece when the pawn reaches the last rank: rook = shop, queen = factory. */
  promote?: "r" | "q";
  /** Prefer the bishop on this square colour (equities = light, bonds/3a = dark). */
  bishop?: "light" | "dark";
  /** Prefer castling (buying a home). */
  castle?: boolean;
}

const CARD_INTENT: Record<string, PieceIntent> = {
  hold: { piece: null, motion: "neutral" },
  pathWork: { piece: "q", motion: "build" },
  pathMaster: { piece: "q", motion: "build" },
  pathMasterLoan: { piece: "q", motion: "build" },
  pathAbroad: { piece: "q", motion: "build" },
  bootcamp: { piece: "q", motion: "build" },
  sabbatical: { piece: "q", motion: "spend" },
  negotiate: { piece: "n", motion: "build" },
  partTime: { piece: "n", motion: "protect" },
  fullTime: { piece: "n", motion: "build" },
  sideJob: { piece: "n", motion: "build" },
  buyHome: { piece: "r", castle: true, motion: "build" },
  flatmates: { piece: "r", motion: "protect" },
  nicerFlat: { piece: "r", motion: "spend" },
  repayDebt: { piece: "r", motion: "protect" },
  buyCar: { piece: "p", motion: "spend" },
  sellCar: { piece: "p", motion: "protect" },
  cutSpending: { piece: "p", motion: "protect" },
  lifestyle: { piece: "p", motion: "spend" },
  subscriptions: { piece: "p", motion: "protect" },
  emergencyFund: { piece: "p", motion: "protect" },
  haveChild: { piece: "p", motion: "neutral" },
  movePartner: { piece: "p", motion: "neutral" },
  investMonthly: { piece: "b", bishop: "light", motion: "build" },
  investIdle: { piece: "b", bishop: "light", motion: "build" },
  moreEquity: { piece: "b", bishop: "light", motion: "build" },
  addBonds: { piece: "b", bishop: "dark", motion: "protect" },
  start3a: { piece: "b", bishop: "dark", motion: "build" },
  stop3a: { piece: "b", bishop: "dark", motion: "protect" },
  pauseInvest: { piece: "b", bishop: "dark", motion: "protect" },
  retireEarly: { piece: "q", motion: "protect" },
  workLonger: { piece: "q", motion: "build" },
  lumpSum: { piece: "b", bishop: "dark", motion: "neutral" },
  workInRetirement: { piece: "n", motion: "build" },
  downsize: { piece: "r", motion: "protect" },
  sellHome: { piece: "r", motion: "protect" },
  startBusiness: { piece: "p", motion: "build", business: true },
  growBusiness: { piece: "p", motion: "build", business: true },
  takeProfits: { piece: "p", motion: "build", business: true },
  reinvestProfits: { piece: "p", motion: "build", business: true },
  hireEmployee: { piece: "p", motion: "build", business: true },
  sellBusiness: { piece: "p", motion: "protect" },
  openShop: { piece: "p", motion: "build", business: true, promote: "r" },
  buildFactory: { piece: "p", motion: "build", business: true, promote: "q" },
};

/** Every decision and every Life event the board knows (checks play random sequences of them). */
export const boardCards = () => ({ player: Object.keys(CARD_INTENT), life: Object.keys(LIFE_INTENT) });

/** How a decision moves on the board (for the legend and the panel). */
export const motionForCard = (card: string): Motion => CARD_INTENT[card]?.motion ?? "neutral";

const LIFE_INTENT: Record<string, { piece: PieceSymbol; tone: LifeTone }> = {
  lifeJobloss: { piece: "n", tone: "hit" },
  lifeEmergency: { piece: "n", tone: "hit" },
  lifeFamily: { piece: "n", tone: "hit" },
  lifeClaim: { piece: "n", tone: "hit" },
  lifeDrawdown: { piece: "b", tone: "hit" },
  lifeRate: { piece: "b", tone: "hit" },
  lifeInflation: { piece: "p", tone: "hit" },
  lifeEnergy: { piece: "p", tone: "hit" },
  lifeRent: { piece: "r", tone: "hit" },
  lifeMaintenance: { piece: "r", tone: "hit" },
  lifeRecession: { piece: "q", tone: "hit" },
  lifeCompound: { piece: "q", tone: "hit" },
  lifeCare: { piece: "n", tone: "hit" },
  lifeWindfall: { piece: "p", tone: "gift" },
  lifePromotion: { piece: "n", tone: "gift" },
};

/** The piece a decision card moves (null = any quiet move, e.g. holding). */
export const pieceForCard = (card: string): PieceSymbol | null => CARD_INTENT[card]?.piece ?? null;

export interface BoardPly {
  side: Color;
  san: string;
  from: Square;
  to: Square;
  piece: PieceSymbol;
  /** The piece the intent asked for, when another piece had to move instead (captured or no legal move). */
  wanted: PieceSymbol | null;
  captured: PieceSymbol | null;
  /** Piece a pawn promoted to (rook = shop, queen = factory). */
  promotion: PieceSymbol | null;
  /** The move gives check. */
  check: boolean;
  mate: boolean;
  /** Material the mover leaves en prise (0 = safe). */
  hangs: number;
  /** Financial card behind the ply (null for a quiet Life year). */
  card: string | null;
  fenAfter: string;
}

export interface BoardTurn {
  /** Position at the start of the turn (after Life's ply), as FEN. */
  fen: string;
  /** What the selector remembers at the start of the turn (repetition, last moves, the business pawn). */
  ctx: TurnCtx;
  /** Player's ply of this turn (absent while the turn is live). */
  white?: BoardPly;
  /** Life's reply (the event at the start of the next turn). */
  black?: BoardPly;
}

export interface BoardLine {
  startFen: string;
  turns: BoardTurn[];
  /** Pieces each side has taken so far (by the side that took them). */
  captured: { w: PieceSymbol[]; b: PieceSymbol[] };
  /** How the board shows a finished game. */
  result: null | "lifeMates" | "playerMates" | "playerResigns" | "lifeResigns" | "timeUp";
}

// ---------------------------------------------------------------- helpers

function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const c of parts.join("|")) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

const other = (c: Color): Color => (c === "w" ? "b" : "w");
const ALL_SQUARES: Square[] = "abcdefgh".split("").flatMap((f) => "12345678".split("").map((r) => (f + r) as Square));

/** Value of a piece as a capturer or a prize in an exchange (the king can take, but is never given up). */
const xv = (p: PieceSymbol) => (p === "k" ? 100 : VALUE[p]);

/**
 * Static exchange on one square: the material the owner of the piece on `sq` loses there when the other side
 * starts taking (0 = safe). Cheapest attacker first on both sides; pins and x-rays are not looked at.
 */
export function exchangeLoss(ch: Chess, sq: Square): number {
  const p = ch.get(sq);
  if (!p || p.type === "k") return 0;
  const att = ch.attackers(sq, other(p.color)).map((a) => xv(ch.get(a)!.type)).sort((x, y) => x - y);
  if (!att.length) return 0;
  const def = ch.attackers(sq, p.color).map((a) => xv(ch.get(a)!.type)).sort((x, y) => x - y);
  const gains: number[] = [];
  let on = VALUE[p.type];
  for (let i = 0, j = 0, side = 0; ; side ^= 1) {
    if (side === 0) {
      if (i >= att.length) break;
      gains.push(on);
      on = att[i++];
    } else {
      if (j >= def.length) break;
      gains.push(on);
      on = def[j++];
    }
  }
  let v = 0;
  for (let k = gains.length - 1; k >= 0; k--) v = Math.max(0, gains[k] - v);
  return v;
}

/** Largest value the side `c` leaves en prise (by static exchange), and where. */
function hanging(ch: Chess, c: Color): { value: number; square: Square | null } {
  let best = { value: 0, square: null as Square | null };
  for (const sq of ALL_SQUARES) {
    const p = ch.get(sq);
    if (!p || p.color !== c || p.type === "k") continue;
    const loss = exchangeLoss(ch, sq);
    if (loss > best.value) best = { value: loss, square: sq };
  }
  return best;
}

/** Legal moves the piece type of side `c` would have if `c` were to move now. */
function mobility(ch: Chess, c: Color, piece: PieceSymbol): number {
  const parts = ch.fen().split(" ");
  parts[1] = c;
  parts[3] = "-";
  try {
    return (new Chess(parts.join(" "), { skipValidation: true }).moves({ verbose: true }) as Move[]).filter((m) => m.piece === piece).length;
  } catch {
    return 0;
  }
}

/** The white pawn with the best way to promotion: advanced, no pawn ahead on its file, a long free run. */
function chooseBusinessPawn(ch: Chess): Square | null {
  let best: { sq: Square; score: number } | null = null;
  for (const sq of ALL_SQUARES) {
    const p = ch.get(sq);
    if (!p || p.type !== "p" || p.color !== "w") continue;
    let free = 0;
    let pawnAhead = false;
    for (let r = Number(sq[1]) + 1; r <= 8; r++) {
      const q = ch.get((sq[0] + r) as Square);
      if (q) {
        if (q.type === "p") pawnAhead = true;
        break;
      }
      free++;
    }
    const score = Number(sq[1]) * 2 + free - (pawnAhead ? 6 : 0);
    if (!best || score > best.score) best = { sq, score };
  }
  return best?.sq ?? null;
}

/** Squares in front of the business pawn on its file (Life keeps them clear). */
const pathAhead = (sq: Square): Square[] => {
  const out: Square[] = [];
  for (let r = Number(sq[1]) + 1; r <= 8; r++) out.push((sq[0] + r) as Square);
  return out;
};

/** Free squares in front of a pawn after its move (to the last rank): a long free run marks the business pawn. */
function pawnRun(ch: Chess, m: Move): number {
  const f = m.to[0];
  const dir = m.color === "w" ? 1 : -1;
  let r = Number(m.to[1]) + dir;
  let free = 0;
  while (r >= 1 && r <= 8 && !ch.get((f + r) as Square)) {
    free++;
    r += dir;
  }
  return free;
}

const centre = (sq: Square) => {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  return -(Math.abs(3.5 - f) + Math.abs(3.5 - r));
};

interface Want {
  side: Color;
  piece: PieceSymbol | null;
  motion?: Motion;
  business?: boolean;
  promote?: "r" | "q";
  /** The business pawn to push (white). */
  bizSquare?: Square | null;
  /** Squares on the business pawn's path that Life keeps clear (black). */
  shield?: Square[];
  bishop?: "light" | "dark";
  castle?: boolean;
  /** Life must give check (financial check). */
  check?: boolean;
  /** This side should deliver mate (financial game over). */
  mate?: boolean;
}

/** What the selector remembers between plies: positions seen (repetition) and each side's last two destinations. */
interface Ctx {
  seen: Map<string, number>;
  recent: { w: Square[]; b: Square[] };
}

/** No king walks in the opening: for this many full moves the king only moves to castle or out of check. */
export const QUIET_KING_MOVES = 12;

const rel = (sq: Square, c: Color) => (c === "w" ? Number(sq[1]) : 9 - Number(sq[1]));
const isCastle = (m: Move) => m.flags.includes("k") || m.flags.includes("q");
const posKey = (ch: Chess) => ch.fen().split(" ").slice(0, 2).join(" ");

/** Material the mover loses on the destination square beyond what the move took (0 = a safe move). */
export function moveRisk(ch: Chess, m: Move): number {
  ch.move(m);
  const loss = exchangeLoss(ch, m.to);
  ch.undo();
  return Math.max(0, loss - (m.captured ? VALUE[m.captured] : 0));
}

/**
 * The move selector, the same for both sides. Every legal move is scored and the best one is played:
 *  - referee: never ends the game on its own, no third repetition, no king move in the opening unless in check;
 *  - material: static exchange on the target square and on every piece left behind (a safe move always beats
 *    an unsafe one), captures that win material;
 *  - chess: centre pawns, knights and bishops out, castling, rooks to open files, no second move of a piece
 *    without a reason, no early queen, no pawn pushes in front of the castled king;
 *  - meaning: the decision's piece and direction (a bonus, never above the terms before);
 *  - ties: a hash of the game seed, the ply and the move.
 */
function pickMove(ch: Chess, w: Want, salt: string, ctx: Ctx): Move | null {
  const all = ch.moves({ verbose: true }) as Move[];
  if (!all.length) return null;
  const c = w.side;
  const fenParts = ch.fen().split(" ");
  const clock = Number(fenParts[4]);
  const full = Number(fenParts[5]);
  const opening = full <= QUIET_KING_MOVES;
  const inCheck = ch.inCheck();
  const recent = ctx.recent[c];
  const back = c === "w" ? "1" : "8";
  // Minor pieces still at home: while two or more wait, the queen and the rooks stay back.
  let minorsHome = 0;
  for (const f of "bcfg") {
    const p = ch.get((f + back) as Square);
    if (p && p.color === c && (p.type === "n" || p.type === "b")) minorsHome++;
  }
  let kingFile = "e";
  const ownPawnFiles = new Set<string>();
  for (const sq of ALL_SQUARES) {
    const p = ch.get(sq);
    if (!p || p.color !== c) continue;
    if (p.type === "k") kingFile = sq[0];
    if (p.type === "p") ownPawnFiles.add(sq[0]);
  }
  const shelter = kingFile >= "f" ? "fgh" : kingFile <= "c" ? "abc" : "";
  const domainFree = w.piece ? all.some((m) => m.piece === w.piece) : true;

  const scored: { m: Move; score: number }[] = [];
  for (const m of all) {
    const threatened = exchangeLoss(ch, m.from) > 0;
    ch.move(m);
    const check = ch.inCheck();
    const stuck = ch.moves().length === 0;
    const mate = check && stuck;
    const gameOver = stuck || ch.isInsufficientMaterial();
    const rep = ctx.seen.get(posKey(ch)) ?? 0;
    const risk = Math.max(0, exchangeLoss(ch, m.to) - (m.captured ? VALUE[m.captured] : 0));
    const worst = hanging(ch, c).value;
    ch.undo();

    let s = 0;
    // Referee.
    if (gameOver && !(w.mate && mate)) s -= 100000;
    if (w.mate && mate) s += 90000;
    if (rep >= 2) s -= 50000;
    else if (rep === 1) s -= 45;
    const castle = isCastle(m);
    if (m.piece === "k" && !castle && !inCheck) s -= opening ? 20000 : 28;
    if (c === "b" && check && !w.check && !w.mate) s -= 10000;
    if (w.check && check) s += 400;
    if (clock >= 60 && (m.piece === "p" || m.captured)) s += clock >= 90 ? 5000 : 300;

    // Material.
    if (risk > 0) s -= 2000 + 100 * risk;
    s += 100 * (m.captured ? VALUE[m.captured] : 0) - 100 * worst;

    // Chess.
    const rank = rel(m.to, c);
    const fromRank = rel(m.from, c);
    const file = m.to[0];
    const forward = rank - fromRank;
    const act = centre(m.to) - centre(m.from);
    if (castle) s += 45;
    if (opening && recent.includes(m.from) && !m.captured && !threatened) s -= 24;
    switch (m.piece) {
      case "p":
        if (m.promotion) s += w.promote ? (m.promotion === w.promote ? 300 : -300) : m.promotion === "q" ? -20 : -60;
        if (opening && !m.captured) {
          if (file === "d" || file === "e") s += rank === 4 ? 30 : rank === 3 ? 14 : -6;
          else if (file === "c") s += rank === 4 ? 12 : rank === 3 ? 6 : -8;
          else s -= file === "f" ? 14 : 16;
        } else if (!opening) s += 3 + (rank >= 6 ? 4 : 0);
        if (shelter.includes(m.from[0]) && fromRank <= 3) s -= 16;
        break;
      case "n":
        if (opening && fromRank === 1) s += rank === 3 && (file === "c" || file === "f") ? 28 : file === "a" || file === "h" ? -18 : 14;
        s += 3 * act;
        break;
      case "b":
        if (opening && fromRank === 1) s += 22;
        // Do not shut the own centre pawn in.
        if (rank === 3 && (file === "d" || file === "e") && ch.get((file + (c === "w" ? "2" : "7")) as Square)?.type === "p") s -= 20;
        s += 2 * act;
        break;
      case "r":
        if (!castle) {
          if (opening && fromRank === 1 && (m.from[0] === "a" || m.from[0] === "h") && kingFile === "e") s -= 26;
          if (!ownPawnFiles.has(file) && m.from[0] !== file) s += 14;
          if (minorsHome >= 2) s -= 10;
        }
        break;
      case "q":
        if (minorsHome >= 2) s -= 26;
        s += act;
        break;
    }

    // Meaning: the decision's piece and direction.
    const domainMove = !!w.piece && (m.piece === w.piece || (w.piece === "r" && castle));
    if (domainMove) s += 38;
    if (w.bishop && m.piece === "b") s += ch.squareColor(m.from) === w.bishop ? 8 : -8;
    if (w.castle && castle) s += 200;
    if (w.business && w.bizSquare && m.from === w.bizSquare) s += 60 + 3 * pawnRun(ch, m) + rank + (m.captured ? 10 : 0);
    // Life keeps the business pawn's way clear: it does not block it, and gets out of it when it can.
    if (w.shield?.length) {
      if (w.shield.includes(m.to)) s -= 40;
      if (w.shield.includes(m.from)) s += 30;
    }
    if (m.piece === "p") {
      // A pawn cannot step back: a protecting pawn takes one careful step, a building or spending one strides.
      if (w.motion === "protect") s += forward === 1 ? 5 : -5;
      else if (w.motion === "build" || w.motion === "spend") s += forward === 2 ? 4 : 0;
    } else if (!castle) {
      if (w.motion === "build") s += forward > 0 ? 6 : forward < 0 ? -4 : 0;
      else if (w.motion === "protect") s += forward < 0 ? 8 : forward === 0 ? 3 : -4;
      else if (w.motion === "spend") s += forward > 0 ? 3 : 0;
    }
    s += hash(salt, m.san) * 0.9;
    scored.push({ m, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  // The decision's piece is shut in (a queen or a bishop behind its pawns): prefer the move that frees it.
  let best: { m: Move; score: number } | null = null;
  for (const cand of scored.slice(0, REFINE)) {
    let s = cand.score;
    if (!domainFree && w.piece && cand.m.piece !== w.piece) {
      ch.move(cand.m);
      if (mobility(ch, c, w.piece) > 0) s += 18;
      ch.undo();
    }
    if (!best || s > best.score) best = { m: cand.m, score: s };
  }
  return best?.m ?? null;
}

/** Candidates that get the expensive scoring term. */
const REFINE = 6;

function doPly(ch: Chess, w: Want, salt: string, ctx: Ctx, card: string | null): BoardPly | null {
  const m = pickMove(ch, w, salt, ctx);
  if (!m) return null;
  ch.move(m);
  const key = posKey(ch);
  ctx.seen.set(key, (ctx.seen.get(key) ?? 0) + 1);
  ctx.recent[m.color] = [...ctx.recent[m.color], m.to].slice(-2);
  return {
    side: m.color,
    san: m.san,
    from: m.from,
    to: m.to,
    piece: m.piece,
    wanted: w.piece && w.piece !== m.piece && !(w.piece === "r" && isCastle(m)) ? w.piece : null,
    captured: m.captured ?? null,
    promotion: m.promotion ?? null,
    check: ch.inCheck(),
    mate: ch.isCheckmate(),
    hangs: hanging(ch, m.color).value,
    card,
    fenAfter: ch.fen(),
  };
}

/** The business pawn of this turn: the tracked one while it stands, otherwise the pawn with the best run. */
function businessPawn(ch: Chess, tracked: Square | null): Square | null {
  const p = tracked ? ch.get(tracked) : null;
  return p && p.type === "p" && p.color === "w" ? tracked : chooseBusinessPawn(ch);
}

/** The player's ply for a decision: only the position, the decision, the turn and the seed decide it. */
function playerPly(ch: Chess, card: string, k: number, seed: number, ctx: Ctx, biz: Square | null, bizKind: string | null | undefined): { ply: BoardPly | null; biz: Square | null } {
  const intent = CARD_INTENT[card] ?? { piece: null };
  const want: Want = { side: "w", piece: intent.piece, motion: intent.motion, business: intent.business, promote: intent.promote, bishop: intent.bishop, castle: intent.castle };
  // A shop or a factory bought earlier: the business pawn promotes to it once it really reaches the last rank.
  if (want.business && !want.promote) want.promote = bizKind === "shop" ? "r" : bizKind === "factory" ? "q" : undefined;
  if (want.business) {
    biz = businessPawn(ch, biz);
    want.bizSquare = biz;
  }
  const ply = doPly(ch, want, `${seed}:w${k}`, ctx, card);
  if (ply && biz && ply.from === biz) biz = ply.promotion ? null : ply.to;
  return { ply, biz };
}

// ---------------------------------------------------------------- public API

/** What a turn starts from besides the position (kept so a decision can be previewed exactly as it will be played). */
export interface TurnCtx {
  seen: [string, number][];
  recent: { w: Square[]; b: Square[] };
  biz: Square | null;
}

/** The board after a completed turn (both plies), for incremental rendering. */
interface Snapshot {
  fen: string;
  ctx: TurnCtx;
  turns: BoardTurn[];
  captured: { w: PieceSymbol[]; b: PieceSymbol[] };
}
const LINE_CACHE = new Map<string, Snapshot>();
/** Forgets the rendered lines (checks use it to prove that a replay renders the same moves from scratch). */
export const clearBoardCache = () => LINE_CACHE.clear();
const freeze = (ctx: Ctx, biz: Square | null): TurnCtx => ({ seen: [...ctx.seen], recent: { w: [...ctx.recent.w], b: [...ctx.recent.b] }, biz });
const thaw = (t: TurnCtx | undefined): Ctx => ({ seen: new Map(t?.seen ?? []), recent: { w: [...(t?.recent.w ?? [])], b: [...(t?.recent.b ?? [])] } });

/**
 * Renders a game as a chess line. The line depends on the game only (its decisions, Life's events and the seed),
 * never on the engine's review: a move does not change after it was played.
 */
export function boardLine(game: Game): BoardLine {
  const seed = game.settings.seed;
  // Incremental: completed turns are cached by everything that shaped them, so a new move only renders itself.
  const keys: string[] = [];
  let key = seed + "|" + game.positions[0].profileId + "|" + game.positions[0].turn;
  for (let k = 0; k < game.moves.length; k++) {
    const life = game.lifeEvents[k + 1];
    const next = game.positions[k + 1];
    key += `|${game.moves[k].card}:${game.positions[k].business?.kind ?? ""}:${life?.card ?? ""}:${life?.earlier?.map((e) => e.card).join("+") ?? ""}:${next.status}:${next.check ? 1 : 0}:${next.business ? 1 : 0}`;
    keys.push(key);
  }
  let start = 0;
  let snap: Snapshot | undefined;
  for (let k = keys.length - 1; k >= 0; k--) {
    snap = LINE_CACHE.get(keys[k]);
    if (snap) {
      start = k + 1;
      break;
    }
  }
  const ch = new Chess(snap?.fen);
  const ctx = thaw(snap?.ctx);
  let bizSquare: Square | null = snap?.ctx.biz ?? null;
  const turns: BoardTurn[] = snap ? snap.turns.slice() : [];
  const captured = { w: snap ? [...snap.captured.w] : ([] as PieceSymbol[]), b: snap ? [...snap.captured.b] : ([] as PieceSymbol[]) };
  let result: BoardLine["result"] = null;
  const end = (r: BoardLine["result"]) => {
    result = r;
    turns.push({ fen: ch.fen(), ctx: freeze(ctx, bizSquare) });
  };

  for (let k = start; k < game.positions.length; k++) {
    const turn: BoardTurn = { fen: ch.fen(), ctx: freeze(ctx, bizSquare) };
    turns.push(turn);
    const move = game.moves[k];
    if (!move) break;
    const next = game.positions[k + 1];
    const played = playerPly(ch, move.card, k, seed, ctx, bizSquare, game.positions[k].business?.kind);
    const white = played.ply;
    if (!white) break;
    bizSquare = played.biz;
    turn.white = white;
    if (white.captured) captured.w.push(white.captured);
    if (next.status === "won") {
      end("lifeResigns");
      break;
    }
    if (next.status === "ended") {
      end("timeUp");
      break;
    }
    const life = game.lifeEvents[k + 1];
    const lifeCard = life?.card ?? life?.earlier?.[life.earlier.length - 1]?.card ?? null;
    const li = lifeCard ? LIFE_INTENT[lifeCard] : undefined;
    const want: Want = {
      side: "b",
      piece: li?.piece ?? null,
      motion: li ? (li.tone === "hit" ? "build" : "protect") : "neutral",
      check: next.status === "playing" && !!next.check,
      mate: next.status === "mate",
      shield: next.business && bizSquare ? pathAhead(bizSquare) : undefined,
    };
    const black = doPly(ch, want, `${seed}:b${k}`, ctx, lifeCard);
    if (!black) break;
    turn.black = black;
    if (black.captured) captured.b.push(black.captured);
    if (bizSquare && black.to === bizSquare) bizSquare = null;
    if (next.status === "mate") {
      end(black.mate ? "lifeMates" : "playerResigns");
      break;
    }
    if (LINE_CACHE.size > 600) LINE_CACHE.clear();
    LINE_CACHE.set(keys[k], { fen: ch.fen(), ctx: freeze(ctx, bizSquare), turns: turns.slice(), captured: { w: [...captured.w], b: [...captured.b] } });
  }
  return { startFen: turns[0]?.fen ?? new Chess().fen(), turns, captured, result };
}

/** A decision as the board offers it: the piece that will move and where it lands. */
export interface Offer {
  card: string;
  from: Square;
  to: Square;
  san: string;
  piece: PieceSymbol;
  promotion: PieceSymbol | null;
}

/**
 * The chess move each decision would be played as in turn `k` of the line: exactly the ply `boardLine` renders
 * when the decision is taken (same position, same memory, same seed). A decision has one move, so it sits on
 * one piece: the one that moves.
 */
export function offersFor(line: BoardLine, k: number, cards: string[], seed: number, bizKind?: string | null): Offer[] {
  const turn = line.turns[k];
  if (!turn) return [];
  const out: Offer[] = [];
  for (const card of cards) {
    const { ply } = playerPly(new Chess(turn.fen), card, k, seed, thaw(turn.ctx), turn.ctx.biz, bizKind);
    if (ply) out.push({ card, from: ply.from, to: ply.to, san: ply.san, piece: ply.piece, promotion: ply.promotion });
  }
  return out;
}

/** The move a decision would be played as from a bare position (no game memory). */
export function previewMove(fen: string, card: string, seed: number, bizKind?: string | null): BoardPly | null {
  return playerPly(new Chess(fen), card, 0, seed, thaw(undefined), null, bizKind).ply;
}

/** 8×8 board for rendering, rank 8 first. */
export function boardSquares(fen: string): { square: Square; piece: { type: PieceSymbol; color: Color } | null }[][] {
  const ch = new Chess(fen);
  return ch.board().map((row, r) => row.map((cell, f) => ({ square: ("abcdefgh"[f] + (8 - r)) as Square, piece: cell ? { type: cell.type, color: cell.color } : null })));
}

export const kingSquare = (fen: string, c: Color): Square | null => {
  const ch = new Chess(fen);
  return ALL_SQUARES.find((sq) => {
    const p = ch.get(sq);
    return p && p.type === "k" && p.color === c;
  }) ?? null;
};
