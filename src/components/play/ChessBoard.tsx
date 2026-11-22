"use client";

/**
 * Doppel Play: the chessboard. The financial game rendered as a legal chess game (see `src/lib/game/board.ts`).
 * Every number and label still comes from the engine; the board only shows them.
 */
import { useMemo, useState } from "react";
import type { Color, PieceSymbol, Square } from "chess.js";
import { type BoardLine, type BoardPly, boardSquares, kingSquare, pieceForCard, piecesForCards, previewMove } from "@/lib/game/board";
import { LABEL_GLYPH, type MoveLabel } from "@/lib/game/evaluate";
import type { GameState } from "@/lib/game/state";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/types";
import { CardHeader, Disclosure } from "../ui";
import type { MoveInfo } from "./Panels";
import { cardTitle } from "./text";

/** Filled glyphs for both colours, forced to text presentation (no emoji pawn). */
export const GLYPH: Record<PieceSymbol, string> = { k: "♚︎", q: "♛︎", r: "♜︎", b: "♝︎", n: "♞︎", p: "♟︎" };
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const LABEL_BG: Record<MoveLabel, string> = {
  brilliant: "bg-[#1baaa0]",
  best: "bg-good",
  good: "bg-[#6c9a5a]",
  inaccuracy: "bg-warn",
  mistake: "bg-[#e07a2e]",
  blunder: "bg-bad",
  lifeChoice: "bg-[#d9709a]",
};
const LABEL_STROKE: Record<MoveLabel, string> = {
  brilliant: "#1baaa0",
  best: "var(--good)",
  good: "#6c9a5a",
  inaccuracy: "var(--warn)",
  mistake: "#e07a2e",
  blunder: "var(--bad)",
  lifeChoice: "#d9709a",
};

function xy(sq: Square): [number, number] {
  return [sq.charCodeAt(0) - 97 + 0.5, 8 - Number(sq[1]) + 0.5];
}

function Arrow({ from, to, color }: { from: Square; to: Square; color: string }) {
  const [x1, y1] = xy(from);
  const [x2, y2] = xy(to);
  const L = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / L;
  const uy = (y2 - y1) / L;
  const ex = x2 - ux * 0.34;
  const ey = y2 - uy * 0.34;
  return (
    <g opacity={0.82}>
      <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={color} strokeWidth={0.17} strokeLinecap="round" />
      <polygon points={`${x2},${y2} ${ex - uy * 0.24},${ey + ux * 0.24} ${ex + uy * 0.24},${ey - ux * 0.24}`} fill={color} />
    </g>
  );
}

function Tray({ pieces, color, lead }: { pieces: PieceSymbol[]; color: Color; lead: number }) {
  const sorted = [...pieces].sort((a, b) => VALUE[a] - VALUE[b]);
  return (
    <span className="flex items-center text-base leading-none">
      <span aria-hidden="true" className={`tracking-[-0.2em] ${color === "w" ? "piece-w" : "piece-b"}`}>
        {sorted.map((p) => GLYPH[p]).join("")}
      </span>
      {lead > 0 && <span className="num ml-2 text-[11px] text-ink-3">+{lead}</span>}
    </span>
  );
}

export interface ChessBoardProps {
  line: BoardLine;
  moves: MoveInfo[];
  view: number | null;
  live: GameState;
  over: boolean;
  /** Engine value of the shown position (0..1), null while reviewing. */
  evalE: number | null;
  hand: string[];
  seed: number;
  onPlay: (card: string) => void;
}

export function ChessBoard({ line, moves, view, live, over, evalE, hand, seed, onPlay }: ChessBoardProps) {
  const i = useI18n();
  const { t } = i;
  const [selected, setSelected] = useState<Square | null>(null);

  const reviewing = view !== null;
  const turn = reviewing ? line.turns[view] : line.turns[line.turns.length - 1];
  const fen = reviewing ? turn?.white?.fenAfter ?? turn?.fen : turn?.fen;
  const lastPly: BoardPly | undefined = reviewing ? turn?.white : line.turns[line.turns.length - 2]?.black ?? line.turns[line.turns.length - 2]?.white;
  const info = reviewing ? moves[view] : undefined;
  const label = info?.review?.label ?? null;

  // Captures up to the shown ply.
  const taken = useMemo(() => {
    const out = { w: [] as PieceSymbol[], b: [] as PieceSymbol[] };
    const upto = reviewing ? view : line.turns.length;
    line.turns.forEach((tn, k) => {
      if (k > upto) return;
      if (tn.white?.captured) out.w.push(tn.white.captured);
      if (k < upto && tn.black?.captured) out.b.push(tn.black.captured);
    });
    return out;
  }, [line, reviewing, view]);
  const material = taken.w.reduce((a, p) => a + VALUE[p], 0) - taken.b.reduce((a, p) => a + VALUE[p], 0);

  const squares = useMemo(() => (fen ? boardSquares(fen) : []), [fen]);
  const cards = useMemo(() => hand.filter((c) => c !== "hold"), [hand]);
  const holdAllowed = hand.includes("hold");
  const playable = useMemo(() => {
    if (reviewing || over || !fen) return new Map<Square, string[]>();
    const map = piecesForCards(fen, cards);
    const king = kingSquare(fen, "w");
    if (holdAllowed && king) map.set(king, [...(map.get(king) ?? []), "hold"]);
    return map;
  }, [reviewing, over, fen, cards, holdAllowed]);
  const sel = selected && playable.has(selected) ? selected : null;
  const selType: PieceSymbol = (sel && squares.flat().find((c) => c.square === sel)?.piece?.type) || "p";

  const best = useMemo(() => {
    if (!reviewing || !info?.review || !turn?.fen) return null;
    if (info.review.best === info.move.card) return null;
    const p = previewMove(turn.fen, info.review.best, "best", seed);
    // Two decisions can land on the same chess move (a blocked piece freed by the same pawn): no arrow then.
    return p ? { ...p, sameSquares: !!turn.white && p.from === turn.white.from && p.to === turn.white.to } : null;
  }, [reviewing, info, turn, seed]);

  const finCheck = !reviewing && live.status === "playing" && !!live.check;
  const boardCheck = !reviewing && lastPly?.side === "b" && lastPly.check;
  const whiteKing = fen ? kingSquare(fen, "w") : null;
  const pct = evalE === null ? 50 : Math.max(3, Math.min(97, evalE * 100));

  const pieceName = (p: PieceSymbol) => t(`board.piece.${p}` as MessageKey);
  const domain = (p: PieceSymbol) => t(`board.domain.${p}` as MessageKey);

  function plyNotes(ply: BoardPly) {
    const notes: { text: string; tone: "bad" | "good" | "warn" }[] = [];
    if (ply.captured) notes.push(ply.side === "w" ? { text: t("board.took", { piece: pieceName(ply.captured), domain: domain(ply.captured) }), tone: "good" } : { text: t("board.lost", { piece: pieceName(ply.captured), domain: domain(ply.captured) }), tone: "bad" });
    if (ply.side === "w" && ply.wanted) notes.push({ text: t("board.substituted", { wanted: pieceName(ply.wanted), piece: pieceName(ply.piece) }), tone: "warn" });
    if (ply.side === "w" && ply.hangs > 0) notes.push({ text: t("board.hangs"), tone: "warn" });
    if (ply.promotion) notes.push({ text: t("biz.promoted", { piece: pieceName(ply.promotion), asset: t(ply.promotion === "q" ? "biz.factory" : ply.promotion === "r" ? "biz.shop" : "biz.venture") }), tone: "good" });
    if (ply.symbolic) notes.push({ text: t("biz.symbolic"), tone: "warn" });
    return notes;
  }

  // Live: the player's last move and Life's reply (the verdict sits right under the board, also on phones).
  const prevTurn = line.turns[line.turns.length - 2];
  const shownPlies: BoardPly[] = (reviewing ? [turn?.white, turn?.black] : [prevTurn?.white, prevTurn?.black]).filter((p): p is BoardPly => !!p);
  const lastInfo = moves[moves.length - 1];
  const plyLabel = reviewing ? label : lastInfo?.review?.label ?? null;
  const resultKey = !reviewing && line.result ? (`board.result.${line.result}` as MessageKey) : null;

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="play-board">
      <CardHeader title={<span id="play-board">{t("board.title")}</span>} aside={<span className="text-xs text-ink-3">{t("play.position.age", { age: reviewing ? info?.move.age ?? live.age : live.age })}</span>} />
      <div className="mx-auto max-w-[520px]">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <span aria-hidden="true" className="piece-b text-base">{GLYPH.k}</span>
            {t("board.life")}
          </span>
          <Tray pieces={taken.b} color="w" lead={material < 0 ? -material : 0} />
        </div>
        <div className="flex gap-1.5">
          <div className="relative w-3.5 shrink-0 overflow-hidden rounded border border-line bg-[#2b2a27]" role="img" aria-label={t("board.evalLabel")}>
            <div className="absolute inset-x-0 bottom-0 bg-[#f3f1ea] transition-[height] duration-300" style={{ height: `${pct}%` }} />
          </div>
          <div className="relative grid flex-1 grid-cols-8 grid-rows-8 overflow-hidden rounded-md border border-line select-none" style={{ aspectRatio: "1", containerType: "inline-size" }} role="grid" aria-label={t("board.boardLabel")} data-testid="play-board">
            {squares.flat().map(({ square, piece }) => {
              const f = square.charCodeAt(0) - 97;
              const r = Number(square[1]);
              const light = (f + r) % 2 === 1;
              const last = lastPly && (lastPly.from === square || lastPly.to === square);
              const isKing = whiteKing === square;
              // Red: a real chess check on the board. Amber: financial check the board cannot show as a check yet.
              const isKingInCheck = isKing && !reviewing && !!boardCheck;
              const isKingWarned = isKing && finCheck && !boardCheck;
              const canSelect = playable.has(square);
              const isSel = sel === square;
              return (
                <div
                  key={square}
                  role="gridcell"
                  aria-label={piece ? `${square}: ${pieceName(piece.type)}` : square}
                  className={`relative flex items-center justify-center ${light ? "bg-[#ebe4d3]" : "bg-[#a98d6b]"}`}
                >
                  {last && <span aria-hidden="true" className="absolute inset-0 bg-[#f1c84b]/45" />}
                  {isSel && <span aria-hidden="true" className="absolute inset-0 bg-s1/35" />}
                  {isKingInCheck && <span aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle,rgba(220,40,30,.85)_0,transparent_70%)]" />}
                  {isKingWarned && <span aria-hidden="true" className="absolute inset-[6%] rounded-full border-[3px] border-dashed border-warn" />}
                  {f === 0 && <span aria-hidden="true" className={`absolute top-0.5 left-0.5 text-[9px] font-semibold ${light ? "text-[#a98d6b]" : "text-[#ebe4d3]"}`}>{r}</span>}
                  {r === 1 && <span aria-hidden="true" className={`absolute right-0.5 bottom-0 text-[9px] font-semibold ${light ? "text-[#a98d6b]" : "text-[#ebe4d3]"}`}>{square[0]}</span>}
                  {piece &&
                    (canSelect ? (
                      <button
                        type="button"
                        onClick={() => setSelected(isSel ? null : square)}
                        aria-label={t("board.selectPiece", { piece: pieceName(piece.type), domain: domain(piece.type) })}
                        aria-pressed={isSel}
                        className={`relative z-[1] grid h-full w-full place-items-center rounded-full ring-2 ring-inset ring-s1/70 hover:bg-s1/15 ${piece.color === "w" ? "piece-w" : "piece-b"} chess-glyph`}
                      >
                        {GLYPH[piece.type]}
                      </button>
                    ) : (
                      <span aria-hidden="true" className={`relative z-[1] ${piece.color === "w" ? "piece-w" : "piece-b"} chess-glyph`}>
                        {GLYPH[piece.type]}
                      </span>
                    ))}
                  {reviewing && label && lastPly?.to === square && (
                    <span aria-hidden="true" className={`absolute -top-0.5 -right-0.5 z-[3] grid h-4 min-w-4 place-items-center rounded-full px-0.5 text-[9px] font-extrabold text-white shadow ${LABEL_BG[label]}`}>
                      {LABEL_GLYPH[label]}
                    </span>
                  )}
                </div>
              );
            })}
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-[4] h-full w-full" viewBox="0 0 8 8" preserveAspectRatio="none">
              {best && !best.sameSquares && <Arrow from={best.from} to={best.to} color="var(--good)" />}
              {reviewing && label && lastPly && best && !best.sameSquares && <Arrow from={lastPly.from} to={lastPly.to} color={LABEL_STROKE[label]} />}
            </svg>
            {resultKey && (
              <div className="absolute inset-x-0 top-1/2 z-[5] mx-4 -translate-y-1/2 rounded-xl bg-surface/95 p-3 text-center text-sm font-medium text-ink shadow" data-testid="play-board-result">
                {t(resultKey)}
              </div>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <span aria-hidden="true" className="piece-w text-base">{GLYPH.k}</span>
            {t("board.you")}
          </span>
          <Tray pieces={taken.w} color="b" lead={material > 0 ? material : 0} />
        </div>

        {/* What the shown plies mean. */}
        <div className="mt-3 space-y-2 text-sm" aria-live="polite">
          {!reviewing && live.debts.some((d) => d.id === "debt-arrears" && d.principal > 0) && (
            <p className="rounded-lg border-l-4 border-bad bg-bad/10 px-3 py-2 text-xs text-ink" data-testid="play-arrears">{t("board.arrears")}</p>
          )}
          {finCheck && (
            <p className={`rounded-lg border-l-4 px-3 py-2 text-xs text-ink ${boardCheck ? "border-bad bg-bad/10" : "border-warn bg-warn/10"}`}>
              {boardCheck ? t("board.finCheck") : t("threat.board")}
            </p>
          )}
          {shownPlies.map((ply) => {
            const isWhite = ply.side === "w";
            const title = ply.card ? cardTitle(i, ply.card) : t("board.quiet");
            return (
              <div key={ply.side + ply.san} className="rounded-lg bg-surface-2 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="num font-semibold text-ink">{isWhite ? "" : "… "}{ply.san}</span>
                  {isWhite && plyLabel && <span className={`num rounded-full px-1.5 text-[11px] font-bold text-white ${LABEL_BG[plyLabel]}`}>{LABEL_GLYPH[plyLabel]}</span>}
                  <span className="text-ink">{isWhite ? t("board.yourMove", { card: title }) : t("board.lifeMove", { card: title })}</span>
                </div>
                <div className="text-[11px] text-ink-3">
                  {GLYPH[ply.piece]} {pieceName(ply.piece)} · {domain(ply.piece)}
                </div>
                {plyNotes(ply).map((n) => (
                  <p key={n.text} className={`mt-1 text-xs ${n.tone === "bad" ? "text-bad" : n.tone === "good" ? "text-good" : "text-warn"}`}>
                    {n.text}
                  </p>
                ))}
              </div>
            );
          })}
          {!reviewing && lastInfo?.review && (
            <p className="text-xs text-ink-2" data-testid="play-board-verdict">
              {lastInfo.review.loss > 0.005 ? t("play.review.loss", { loss: lastInfo.review.loss }) : t("play.review.noLoss")}
              {lastInfo.review.best !== lastInfo.move.card && <> · {t("play.review.bestIs", { move: cardTitle(i, lastInfo.review.best) })}</>}{" "}
              <a href="#play-review" className="font-medium text-s1 underline-offset-2 hover:underline lg:hidden">{t("board.details")}</a>
            </p>
          )}
          {best && info?.review && (
            <p className="text-xs text-ink-2">
              {!best.sameSquares && <span className="font-medium text-good">→ {best.san} </span>}
              {t("board.best", { card: cardTitle(i, info.review.best) })}
            </p>
          )}
        </div>

        {/* Decisions of the selected piece. */}
        {!reviewing && !over && (
          <div className="mt-3">
            {sel ? (
              <div className="rounded-xl border border-line p-3" data-testid="play-board-decisions">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-ink-2">
                  <span>
                    {GLYPH[selType]} {t("board.decisionsOf", { piece: pieceName(selType), domain: domain(selType) })}
                  </span>
                  <button type="button" onClick={() => setSelected(null)} className="min-h-8 rounded-full border border-line px-3 text-xs hover:bg-surface-2">
                    {t("board.close")}
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {playable.get(sel)!.map((card) => (
                    <button
                      key={card}
                      type="button"
                      data-testid="play-board-card"
                      data-card={card}
                      onClick={() => {
                        setSelected(null);
                        onPlay(card);
                      }}
                      className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      <span aria-hidden="true" className="num grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink text-xs font-semibold text-bg">{card === "hold" ? "H" : cards.indexOf(card) + 1}</span>
                      <span className="font-serif leading-tight text-ink">{cardTitle(i, card)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              playable.size > 0 && <p className="text-xs text-ink-3">{t("board.pick")}</p>
            )}
          </div>
        )}

        <Disclosure summary={t("board.legend.summary")} className="mt-3">
          <ul className="space-y-1.5 text-xs text-ink-2">
            {(["k", "q", "n", "b", "r", "p"] as PieceSymbol[]).map((p) => (
              <li key={p} className="flex gap-2">
                <span aria-hidden="true" className="piece-w w-5 shrink-0 text-center text-base leading-none">{GLYPH[p]}</span>
                <span>{t(`board.legend.${p}` as MessageKey)}</span>
              </li>
            ))}
            <li className="flex gap-2">
              <span aria-hidden="true" className="piece-b w-5 shrink-0 text-center text-base leading-none">{GLYPH.k}</span>
              <span>{t("board.legend.life")}</span>
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-ink-3">{t("board.legend.motion")}</p>
          <p className="mt-1 text-[11px] text-ink-3">{t("biz.legend")}</p>
          <p className="mt-1 text-[11px] text-ink-3">{t("board.legend.rule")}</p>
        </Disclosure>
      </div>
    </section>
  );
}

/** The piece glyph a decision card moves (for card tiles). */
export const cardGlyph = (card: string) => {
  const p = pieceForCard(card);
  return p ? GLYPH[p] : null;
};
