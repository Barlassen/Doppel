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
import type { MoveLabel } from "./evaluate";
import type { Game } from "./game";

export type Quality = "strong" | "passive" | "loose" | "blunder" | "neutral";
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
};

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
  lifeWindfall: { piece: "p", tone: "gift" },
  lifePromotion: { piece: "n", tone: "gift" },
};

/** The piece a decision card moves (null = any quiet move, e.g. holding). */
export const pieceForCard = (card: string): PieceSymbol | null => CARD_INTENT[card]?.piece ?? null;

export function qualityFor(label: MoveLabel | null | undefined): Quality {
  switch (label) {
    case "brilliant":
    case "best":
    case "good":
      return "strong";
    case "inaccuracy":
      return "passive";
    case "mistake":
      return "loose";
    case "blunder":
      return "blunder";
    default:
      return "neutral";
  }
}

export interface BoardPly {
  side: Color;
  san: string;
  from: Square;
  to: Square;
  piece: PieceSymbol;
  /** The piece the intent asked for, when another piece had to move instead (captured or no legal move). */
  wanted: PieceSymbol | null;
  captured: PieceSymbol | null;
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

/** Largest value the side `c` leaves en prise: attacked and undefended, or attacked by a cheaper piece. */
function hanging(ch: Chess, c: Color): { value: number; square: Square | null } {
  let best = { value: 0, square: null as Square | null };
  for (const sq of ALL_SQUARES) {
    const p = ch.get(sq);
    if (!p || p.color !== c || p.type === "k") continue;
    const attackers = ch.attackers(sq, other(c));
    if (!attackers.length) continue;
    const defended = ch.attackers(sq, c).length > 0;
    const cheapest = Math.min(...attackers.map((a) => VALUE[ch.get(a)!.type] || 100));
    const loss = defended ? Math.max(0, VALUE[p.type] - cheapest) : VALUE[p.type];
    if (loss > best.value) best = { value: loss, square: sq };
  }
  return best;
}

/** Was the captured piece free (the capturer is not lost back for more)? */
function captureGain(ch: Chess, m: Move): number {
  if (!m.captured) return 0;
  const gain = VALUE[m.captured];
  const recapture = ch.attackers(m.to, other(m.color)).length > 0 ? VALUE[m.piece] : 0;
  return gain - (ch.attackers(m.to, m.color).length > 0 ? Math.min(recapture, gain) : recapture);
}

/** How many checking moves `c` would have if it could move again now (Life's pressure on the player's king). */
function pressure(ch: Chess, c: Color): number {
  const parts = ch.fen().split(" ");
  parts[1] = c;
  parts[3] = "-";
  try {
    const probe = new Chess(parts.join(" "), { skipValidation: true });
    return probe.moves().filter((s) => /[+#]/.test(s)).length;
  } catch {
    return 0;
  }
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

/** Mate, stalemate or dead position. Repetition is tracked by `seen` (scanning chess.js' history is slow). */
const mateOrDraw = (ch: Chess) => ch.isCheckmate() || ch.isStalemate() || ch.isInsufficientMaterial();

const centre = (sq: Square) => {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  return -(Math.abs(3.5 - f) + Math.abs(3.5 - r));
};

interface Want {
  side: Color;
  piece: PieceSymbol | null;
  motion?: Motion;
  bishop?: "light" | "dark";
  castle?: boolean;
  quality?: Quality;
  tone?: LifeTone;
  /** Life must give check (financial check). */
  check?: boolean;
  /** This side should deliver mate (financial game over). */
  mate?: boolean;
  /** Square of a piece the opponent left hanging (prefer taking it). */
  target?: Square | null;
}

function pickMove(ch: Chess, w: Want, salt: string, seen: Map<string, number>): Move | null {
  const all = ch.moves({ verbose: true }) as Move[];
  if (!all.length) return null;
  const typed = w.piece ? all.filter((m) => m.piece === w.piece) : all;
  // Fall back to a related piece when the domain's piece is gone or stuck: pawns, then minor pieces.
  let pool = typed.length ? typed : all.filter((m) => m.piece !== "k").length ? all.filter((m) => m.piece !== "k") : all;
  // Check and mate follow the financial state, so any piece may deliver them when the domain's piece cannot.
  if ((w.check || w.mate) && !pool.some((m) => /[+#]/.test(m.san)) && all.some((m) => /[+#]/.test(m.san))) pool = all;
  // Phase 1 scores every candidate cheaply; phase 2 adds the expensive terms (pressure, freeing a blocked
  // piece: both need a fresh move generation) to the best few only.
  const scored: { m: Move; score: number; check: boolean }[] = [];
  for (const m of pool) {
    ch.move(m);
    const gameOver = mateOrDraw(ch);
    const mate = ch.isCheckmate();
    const check = ch.inCheck();
    const key = ch.fen().split(" ").slice(0, 2).join(" ");
    const rep = seen.get(key) ?? 0;
    const hang = hanging(ch, w.side).value;
    const gain = m.captured ? captureGain(ch, m) : 0;
    ch.undo();

    let s = 0;
    if (gameOver && !(w.mate && mate)) s -= 1000;
    if (w.mate) s += mate ? 500 : check ? 40 : 0;
    if (w.check) s += check ? 200 : -50;
    else if (check && !w.mate) s -= 120;
    s -= rep * 30;
    if (w.piece && m.piece !== w.piece) s -= 15;
    if (w.bishop && m.piece === "b") s += (ch.squareColor(m.from) === w.bishop ? 6 : -6);
    if (w.castle) s += m.flags.includes("k") || m.flags.includes("q") ? 60 : 0;
    else if (m.flags.includes("k") || m.flags.includes("q")) s += 3;
    if (m.piece === "k" && !m.flags.match(/[kq]/)) s -= 8;
    if (w.target && m.to === w.target) s += 25;
    const act = centre(m.to) - centre(m.from);
    // Direction follows the decision: building moves forward, protecting moves back towards the own king,
    // spending pushes a pawn or piece forward loosely (it does not develop, it only advances).
    const forward = (Number(m.to[1]) - Number(m.from[1])) * (w.side === "w" ? 1 : -1);
    if (w.motion === "build") s += 4 * Math.sign(forward) + forward;
    else if (w.motion === "protect") s += forward < 0 ? 8 : forward === 0 ? 2 : -6;
    else if (w.motion === "spend") s += forward > 0 ? 3 : 0;

    if (w.side === "w") {
      switch (w.quality ?? "neutral") {
        case "strong":
          s += 8 * gain + 2 * act - 25 * hang + (m.from[1] === "1" ? 3 : 0);
          break;
        case "neutral":
          s += 2 * gain + act - 25 * hang;
          break;
        case "passive":
          s += -2 * act - 25 * hang - (m.captured ? 10 : 0);
          break;
        case "loose":
          s += (hang >= 1 && hang <= 3 ? 40 : hang > 3 ? 10 : -10) - (m.captured ? 10 : 0);
          break;
        case "blunder":
          s += (hang >= 3 ? 40 + 2 * hang : hang > 0 ? 15 : -10) - (m.captured ? 10 : 0);
          break;
      }
    } else {
      switch (w.tone ?? "quiet") {
        case "hit":
          s += 10 * (m.captured ? Math.max(VALUE[m.captured], gain) : 0) + act - 6 * hang;
          break;
        case "gift":
          s += (hang >= 1 && hang <= 3 ? 30 : -5) - (m.captured ? 20 : 0);
          break;
        case "quiet":
          s += act - 15 * hang - (m.captured ? 20 : 0);
          break;
      }
    }
    s += hash(salt, m.san) * 0.9;
    scored.push({ m, score: s, check });
  }
  scored.sort((a, b) => b.score - a.score);
  let best: { m: Move; score: number } | null = null;
  for (const c of scored.slice(0, REFINE)) {
    let s = c.score;
    const lifePress = w.side === "b" && !c.check && !w.mate;
    const blocked = !typed.length && !!w.piece && c.m.piece !== w.piece;
    if (lifePress || blocked) {
      ch.move(c.m);
      // Life keeps pieces aimed at the king, so a financial check can show as a board check when it comes.
      if (lifePress) s += (w.check ? 15 : 2) * Math.min(3, pressure(ch, "b"));
      // A blocked domain piece: prefer the move that frees it (e.g. a pawn opens the queen's diagonal).
      if (blocked && mobility(ch, w.side, w.piece!) > 0) s += 12;
      ch.undo();
    }
    if (!best || s > best.score) best = { m: c.m, score: s };
  }
  return best?.m ?? null;
}

/** Candidates that get the expensive scoring terms. */
const REFINE = 6;

function doPly(ch: Chess, w: Want, salt: string, seen: Map<string, number>, card: string | null): BoardPly | null {
  const m = pickMove(ch, w, salt, seen);
  if (!m) return null;
  ch.move(m);
  const key = ch.fen().split(" ").slice(0, 2).join(" ");
  seen.set(key, (seen.get(key) ?? 0) + 1);
  return {
    side: m.color,
    san: m.san,
    from: m.from,
    to: m.to,
    piece: m.piece,
    wanted: w.piece && w.piece !== m.piece ? w.piece : null,
    captured: m.captured ?? null,
    check: ch.inCheck(),
    mate: ch.isCheckmate(),
    hangs: hanging(ch, m.color).value,
    card,
    fenAfter: ch.fen(),
  };
}

function whiteWant(card: string, label: MoveLabel | null | undefined, target: Square | null, mate = false): Want {
  const intent = CARD_INTENT[card] ?? { piece: null };
  return { side: "w", piece: intent.piece, motion: intent.motion, bishop: intent.bishop, castle: intent.castle, quality: qualityFor(label), target, mate };
}

// ---------------------------------------------------------------- public API

/** The board after a completed turn (both plies), for incremental rendering. */
interface Snapshot {
  fen: string;
  seen: [string, number][];
  turns: BoardTurn[];
  captured: { w: PieceSymbol[]; b: PieceSymbol[] };
  lifeTarget: Square | null;
  playerTarget: Square | null;
}
const LINE_CACHE = new Map<string, Snapshot>();

/**
 * Renders a game as a chess line. `labels[k]` is the engine's label of move k (null while it is not reviewed yet;
 * the move is then played as a neutral move and re-rendered when the review arrives).
 */
export function boardLine(game: Game, labels: (MoveLabel | null | undefined)[]): BoardLine {
  const salt = String(game.settings.seed);
  // Incremental: completed turns are cached by everything that shaped them, so a new review or a new move
  // only renders what changed (a long game re-renders in milliseconds instead of a few hundred).
  const keys: string[] = [];
  let key = salt + "|" + game.positions[0].profileId + "|" + game.positions[0].turn;
  for (let k = 0; k < game.moves.length; k++) {
    const life = game.lifeEvents[k + 1];
    const next = game.positions[k + 1];
    key += `|${game.moves[k].card}:${labels[k] ?? ""}:${life?.card ?? ""}:${life?.earlier?.map((e) => e.card).join("+") ?? ""}:${next.status}:${next.check ? 1 : 0}`;
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
  const seen = new Map<string, number>(snap?.seen ?? []);
  const turns: BoardTurn[] = snap ? snap.turns.slice() : [];
  const captured = { w: snap ? [...snap.captured.w] : ([] as PieceSymbol[]), b: snap ? [...snap.captured.b] : ([] as PieceSymbol[]) };
  let lifeTarget: Square | null = snap?.lifeTarget ?? null;
  let playerTarget: Square | null = snap?.playerTarget ?? null;
  let result: BoardLine["result"] = null;

  for (let k = start; k < game.positions.length; k++) {
    const turn: BoardTurn = { fen: ch.fen() };
    turns.push(turn);
    const move = game.moves[k];
    if (!move) break;
    const next = game.positions[k + 1];
    const white = doPly(ch, whiteWant(move.card, labels[k], playerTarget, next.status === "won"), salt + ":w" + k, seen, move.card);
    if (!white) break;
    turn.white = white;
    if (white.captured) captured.w.push(white.captured);
    const h = hanging(ch, "w");
    lifeTarget = white.hangs > 0 ? h.square : null;
    if (white.mate) {
      result = "playerMates";
      turns.push({ fen: ch.fen() });
      break;
    }
    if (next.status === "won") {
      result = "lifeResigns";
      turns.push({ fen: ch.fen() });
      break;
    }
    if (next.status === "ended") {
      result = "timeUp";
      turns.push({ fen: ch.fen() });
      break;
    }
    const life = game.lifeEvents[k + 1];
    const lifeCard = life?.card ?? life?.earlier?.[life.earlier.length - 1]?.card ?? null;
    const li = lifeCard ? LIFE_INTENT[lifeCard] : undefined;
    const want: Want = {
      side: "b",
      piece: li?.piece ?? null,
      tone: next.status === "mate" ? "hit" : li?.tone ?? (lifeTarget ? "hit" : "quiet"),
      check: next.status === "playing" && !!next.check,
      mate: next.status === "mate",
      target: li?.tone === "gift" ? null : lifeTarget,
    };
    const black = doPly(ch, want, salt + ":b" + k, seen, lifeCard);
    if (!black) break;
    turn.black = black;
    if (black.captured) captured.b.push(black.captured);
    playerTarget = black.hangs > 0 ? hanging(ch, "b").square : null;
    if (next.status === "mate") {
      result = black.mate ? "lifeMates" : "playerResigns";
      turns.push({ fen: ch.fen() });
      break;
    }
    if (LINE_CACHE.size > 600) LINE_CACHE.clear();
    LINE_CACHE.set(keys[k], { fen: ch.fen(), seen: [...seen], turns: turns.slice(), captured: { w: [...captured.w], b: [...captured.b] }, lifeTarget, playerTarget });
  }
  return { startFen: turns[0]?.fen ?? new Chess().fen(), turns, captured, result };
}

/**
 * The move a card *would* be played as from a turn's start position (for the engine's best-move arrow).
 * Uses the same rules as `boardLine`, with the given label.
 */
export function previewMove(fen: string, card: string, label: MoveLabel | null, seed: number): BoardPly | null {
  const ch = new Chess(fen);
  return doPly(ch, whiteWant(card, label, null), String(seed) + ":preview", new Map(), card);
}

/**
 * Squares of the player's pieces that hold the given decisions (for choosing a decision on the board).
 * A decision sits on every piece of its domain, even a blocked one (another piece then plays it, see `pickMove`);
 * when the domain has no piece left, it sits on the king. Holding sits on the king.
 */
export function piecesForCards(fen: string, cards: string[]): Map<Square, string[]> {
  const ch = new Chess(fen);
  const own = ALL_SQUARES.filter((sq) => ch.get(sq)?.color === "w");
  const king = own.find((sq) => ch.get(sq)?.type === "k");
  const out = new Map<Square, string[]>();
  for (const card of cards) {
    const want = pieceForCard(card);
    const intent = CARD_INTENT[card];
    let froms = want ? own.filter((sq) => ch.get(sq)?.type === want) : [];
    if (intent?.bishop) {
      const same = froms.filter((f) => ch.squareColor(f) === intent.bishop);
      if (same.length) froms = same;
    }
    if (want === "p") {
      // Eight pawns would all ring: keep the ones that can move, at most two.
      const mobile = froms.filter((f) => ch.moves({ square: f }).length > 0);
      froms = (mobile.length ? mobile : froms).sort((a, b) => Math.abs(a.charCodeAt(0) - 100.5) - Math.abs(b.charCodeAt(0) - 100.5)).slice(0, 2);
    }
    if (!froms.length && king) froms = [king];
    for (const f of froms) out.set(f, [...(out.get(f) ?? []), card]);
  }
  return out;
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
