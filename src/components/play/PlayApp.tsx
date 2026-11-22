"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PROFILES } from "@/lib/data/profiles";
import type { Profile } from "@/lib/finance/types";
import { type Analysis, type DepthId, type EngineSettings, reviewMove } from "@/lib/game/engine";
import { type MoveLabel, type PresetId, type Weights, WEIGHT_PRESETS, mateValue } from "@/lib/game/evaluate";
import { type Game, currentPosition, isOver, legalMoves, newGame, play, truncate } from "@/lib/game/game";
import { toRecord } from "@/lib/game/notation";
import type { RegimeId } from "@/lib/game/regime";
import { accountOpening, playableUbsProfiles, ubsOpening } from "@/lib/game/start";
import type { GameState } from "@/lib/game/state";
import { LOCALES, LOCALE_NAMES, LOCALE_TAGS } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { ALEXIA_ID, loadUbsProfile } from "@/lib/ubs";
import { SiteNav } from "../SiteNav";
import { Disclosure } from "../ui";
import { boardLine } from "@/lib/game/board";
import { ChessBoard } from "./ChessBoard";
import { AnalysisPanel, Banner, DecisionArea, EndReview, EvalCard, LifeCard, MoveList, PositionPanel, SetupPanel, type MoveInfo } from "./Panels";
import { useEngine } from "./useEngine";

export interface Opening {
  id: string;
  state: GameState;
  profile: Profile;
}

const weightsKey = (w: Weights) => [w.goal, w.safe, w.wealth, w.down].join(",");
/** A position is identified by the moves that led to it (same game seed and profile). */
const posKey = (g: Game, turn: number) => turn + ":" + g.moves.slice(0, turn).map((m) => m.card).join(",");

export default function PlayApp() {
  const i18n = useI18n();
  const { t, locale, setLocale } = i18n;
  const runEngine = useEngine();

  // ---------------- setup ----------------
  const ubsProfiles = useMemo(() => [...playableUbsProfiles()].sort((a, b) => Number(b.id === ALEXIA_ID) - Number(a.id === ALEXIA_ID)), []);
  const [startId, setStartId] = useState(`ubs:${ALEXIA_ID}`);
  const [regime, setRegime] = useState<RegimeId>("normal");
  const [seed, setSeed] = useState(2026);
  const [depth, setDepth] = useState<DepthId>("goal");
  const [preset, setPreset] = useState<PresetId | "custom">("balanced");
  const [weights, setWeights] = useState<Weights>(WEIGHT_PRESETS.balanced);
  const [opening, setOpening] = useState<Opening | null>(null);

  useEffect(() => {
    let alive = true;
    const [kind, id] = startId.split(":");
    const load = async (): Promise<Opening> => {
      if (kind === "ubs") {
        const [state, profile] = await Promise.all([ubsOpening(id), loadUbsProfile(id)]);
        return { id: startId, state, profile };
      }
      const profile = PROFILES.find((p) => p.id === id) ?? PROFILES[0];
      return { id: startId, state: accountOpening(profile), profile };
    };
    load().then((o) => alive && setOpening(o));
    return () => {
      alive = false;
    };
  }, [startId]);

  // ---------------- game ----------------
  const [game, setGame] = useState<Game | null>(null);
  const [gameProfile, setGameProfile] = useState<Profile | null>(null);
  const [mainLine, setMainLine] = useState<{ game: Game; from: number } | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [compare, setCompare] = useState<"you" | "engine">("you");
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [engineMs, setEngineMs] = useState(0);
  const inflight = useRef<string | null>(null);
  const failed = useRef(new Set<string>());
  const generation = useRef(0);

  const startGame = useCallback(
    (o: Opening) => {
      generation.current++;
      inflight.current = null;
      setGame(newGame(o.state, { regime, seed, depth, weights, preset }));
      setGameProfile(o.profile);
      setAnalyses({});
      setMainLine(null);
      setView(null);
    },
    [regime, seed, depth, weights, preset],
  );

  // The first opening that loads starts the demo game (Alexia by default).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (opening && !autoStarted.current) {
      autoStarted.current = true;
      startGame(opening);
    }
  }, [opening, startGame]);

  const engineSettings: EngineSettings | null = useMemo(
    () => (game ? { regime: game.settings.regime, seed: game.settings.seed, depth, weights } : null),
    [game, depth, weights],
  );
  const evalKey = `${depth}|${weightsKey(weights)}`;
  const analysisAt = useCallback((turn: number) => (game ? analyses[evalKey + "|" + posKey(game, turn)] : undefined), [analyses, evalKey, game]);

  // Review queue: the move just played first, then the live position, then older positions (after a depth change).
  useEffect(() => {
    if (!game || !engineSettings || inflight.current) return;
    const n = game.positions.length;
    const order = [n - 2, n - 1, ...Array.from({ length: Math.max(0, n - 2) }, (_, k) => n - 3 - k)].filter((x) => x >= 0);
    const turn = order.find((k) => {
      const key = evalKey + "|" + posKey(game, k);
      return game.positions[k].status !== "mate" && !analyses[key] && !failed.current.has(key);
    });
    if (turn === undefined) return;
    const key = evalKey + "|" + posKey(game, turn);
    const gen = generation.current;
    inflight.current = key;
    runEngine(game.positions[turn], engineSettings)
      .then(({ analysis, ms }) => {
        if (gen !== generation.current) return;
        setEngineMs(ms);
        setAnalyses((prev) => ({ ...prev, [key]: analysis }));
      })
      .catch(() => failed.current.add(key))
      .finally(() => {
        if (inflight.current === key) inflight.current = null;
        if (gen === generation.current) setAnalyses((prev) => ({ ...prev }));
      });
  }, [game, engineSettings, analyses, evalKey, runEngine]);

  const live = game ? currentPosition(game) : null;
  const over = game ? isOver(game) : false;
  const hand = useMemo(() => (game && !isOver(game) ? legalMoves(game) : []), [game]);

  const onPlay = useCallback(
    (card: string) => {
      if (!game || isOver(game) || !legalMoves(game).includes(card)) return;
      setGame(play(game, card));
      setView(null);
    },
    [game],
  );

  const whatIf = useCallback(
    (turn: number, card: string) => {
      if (!game) return;
      if (!mainLine) setMainLine({ game, from: turn });
      else setMainLine({ ...mainLine, from: turn });
      setGame(play(truncate(game, turn), card));
      setView(null);
    },
    [game, mainLine],
  );

  const backToMain = useCallback(() => {
    if (!mainLine) return;
    setGame(mainLine.game);
    setMainLine(null);
    setView(null);
  }, [mainLine]);

  // ---------------- reviews, luck, accuracy ----------------
  const moves: MoveInfo[] = useMemo(() => {
    if (!game) return [];
    return game.moves.map((m, k) => {
      const a = analysisAt(k);
      const review = a ? reviewMove(a, m.card) : null;
      const next = game.positions[k + 1];
      const nextA = analysisAt(k + 1);
      const nextValue = next.status === "mate" ? mateValue(weights).e : nextA ? (nextA.candidates[0]?.e ?? nextA.hold.e) : null;
      const luck = review && nextValue !== null ? (nextValue - review.e) * 100 : null;
      return { move: m, analysis: a ?? null, review, luck, life: game.lifeEvents[k + 1] };
    });
  }, [game, analysisAt, weights]);

  const shown = view ?? (moves.length ? moves.length - 1 : null);

  // The board: the same game rendered as legal chess moves; re-rendered when a review (label) arrives.
  const labelsKey = moves.map((m) => m.review?.label ?? "").join(",");
  const line = useMemo(
    () => (game ? boardLine(game, labelsKey.split(",").map((l) => (l || null) as MoveLabel | null)) : null),
    [game, labelsKey],
  );
  const sanList = useMemo(() => (line ? line.turns.map((tn) => ({ w: tn.white?.san, b: tn.black?.san })) : []), [line]);
  const liveAnalysis = live && game ? analysisAt(game.positions.length - 1) : undefined;

  // ---------------- keyboard ----------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.key === "ArrowLeft" && moves.length) {
        e.preventDefault();
        setView((v) => Math.max(0, (v ?? moves.length) - 1));
      } else if (e.key === "ArrowRight" && moves.length) {
        e.preventDefault();
        setView((v) => (v === null || v + 1 >= moves.length ? null : v + 1));
      } else if (/^[1-4]$/.test(e.key) && view === null) {
        const cards = hand.filter((c) => c !== "hold");
        const c = cards[Number(e.key) - 1];
        if (c) onPlay(c);
      } else if ((e.key === "h" || e.key === "H") && view === null && hand.includes("hold")) {
        onPlay("hold");
      } else if (e.key === "Tab" && (document.activeElement === document.body || document.activeElement === null)) {
        e.preventDefault();
        setCompare((c) => (c === "you" ? "engine" : "you"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moves.length, view, hand, onPlay]);

  const download = () => {
    if (!game) return;
    const blob = new Blob([JSON.stringify(toRecord(game), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `doppel-game-${game.positions[0].profileId}-${game.settings.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const viewedPos = game && live ? (view !== null ? game.positions[view] : live) : null;
  const viewedTurn = view ?? (game ? game.positions.length - 1 : 0);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold text-white">D</span>
            <span className="font-serif text-2xl leading-none">Doppel</span>
            <SiteNav current="play" />
          </div>
          <div className="flex items-center rounded-full border border-line p-0.5" role="group" aria-label={t("lang.switcher")}>
            {LOCALES.map((option) => (
              <button
                key={option}
                type="button"
                lang={LOCALE_TAGS[option]}
                aria-label={LOCALE_NAMES[option]}
                aria-pressed={locale === option}
                onClick={() => setLocale(option)}
                className={`rounded-full px-2 py-1 text-[11px] font-medium ${locale === option ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:pt-8">
        <div className="mb-5">
          <div className="label mb-1">{t("play.kicker")}</div>
          <h1 className="font-serif text-3xl leading-tight sm:text-4xl">{t("play.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-2">{t("play.subtitle")}</p>
          <Disclosure summary={t("play.how.summary")} className="mt-3">
            <ul className="max-w-3xl list-disc space-y-1.5 pl-5 text-sm text-ink-2">
              <li>{t("play.how.turn")}</li>
              <li>{t("play.how.engine")}</li>
              <li>{t("play.how.eval")}</li>
              <li>{t("play.how.luck")}</li>
              <li>{t("play.how.rules")}</li>
              <li>{t("play.how.advice")}</li>
            </ul>
            <p className="mt-2 text-xs text-ink-3">{t("play.keys")}</p>
          </Disclosure>
        </div>

        <SetupPanel
          ubsProfiles={ubsProfiles}
          accounts={PROFILES}
          startId={startId}
          onStartId={setStartId}
          regime={regime}
          onRegime={setRegime}
          seed={seed}
          onSeed={setSeed}
          opening={opening?.id === startId ? opening : null}
          onStart={() => opening && startGame(opening)}
        />

        {!game || !live || !viewedPos ? (
          <div className="card mt-4 p-6 text-sm text-ink-3 pulse-soft">{t("play.evalBar.waiting")}</div>
        ) : (
          <>
            <Banner position={live} />
            <div className="mt-4 grid gap-4 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-7">
                {line && (
                  <ChessBoard
                    line={line}
                    moves={moves}
                    view={view}
                    live={live}
                    over={over}
                    evalE={view !== null ? moves[view]?.review?.e ?? null : liveAnalysis?.candidates[0]?.e ?? null}
                    hand={hand}
                    seed={game.settings.seed}
                    onPlay={onPlay}
                  />
                )}
                <EvalCard
                  engineE={shown !== null ? moves[shown]?.analysis?.candidates[0]?.e ?? null : liveAnalysis?.candidates[0]?.e ?? null}
                  youE={shown !== null ? moves[shown]?.review?.e ?? null : null}
                  positionAnalysis={view !== null ? moves[view]?.analysis ?? null : liveAnalysis ?? null}
                  depth={depth}
                  onDepth={setDepth}
                  preset={preset}
                  weights={weights}
                  onPreset={(p) => {
                    setPreset(p);
                    setWeights(WEIGHT_PRESETS[p]);
                  }}
                  onWeights={(w) => {
                    setPreset("custom");
                    setWeights(w);
                  }}
                  position={viewedPos}
                />
                <PositionPanel position={viewedPos} profile={gameProfile} turn={viewedTurn} />
                <LifeCard life={game.lifeEvents[viewedTurn]} regime={game.settings.regime} />
                <DecisionArea
                  position={viewedPos}
                  regime={game.settings.regime}
                  hand={view === null ? hand : []}
                  reviewOf={view !== null ? moves[view] : null}
                  onPlay={onPlay}
                  onWhatIf={(card) => view !== null && whatIf(view, card)}
                  over={over && view === null}
                  thinking={view === null && !liveAnalysis && !over}
                />
              </div>
              <div className="space-y-4 lg:col-span-5">
                {over && view === null && <EndReview game={game} moves={moves} />}
                <AnalysisPanel info={shown !== null ? moves[shown] ?? null : null} compare={compare} onCompare={() => setCompare((c) => (c === "you" ? "engine" : "you"))} engineMs={engineMs} weights={weights} />
                <MoveList
                  moves={moves}
                  san={sanList}
                  view={view}
                  onView={setView}
                  mainLine={mainLine ? mainLine.from : null}
                  onMain={backToMain}
                  onExport={download}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

