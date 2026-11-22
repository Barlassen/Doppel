"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { hydrateAccounts, useAccounts } from "@/lib/accounts";
import type { Profile } from "@/lib/finance/types";
import { type Analysis, type DepthId, type EngineSettings, reviewMove } from "@/lib/game/engine";
import { type MoveLabel, type PresetId, type Weights, WEIGHT_PRESETS } from "@/lib/game/evaluate";
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
import { EngineCancelled } from "./engineClient";
import { keyAction } from "./keys";
import { useEngine } from "./useEngine";

export interface Opening {
  id: string;
  state: GameState;
  profile: Profile;
}

const weightsKey = (w: Weights) => [w.goal, w.safe, w.wealth, w.down].join(",");
/** A position is identified by the moves that led to it (same game seed and profile). */
const posKey = (g: Game, turn: number) => turn + ":" + g.moves.slice(0, turn).map((m) => m.card).join(",");
/** Household preferences the profile's data suggests (derived): a family household has children. */
const suggestedPrefs = (household: string | undefined) => (household === "family" ? ["children"] : []);

export default function PlayApp() {
  const i18n = useI18n();
  const { t, locale, setLocale } = i18n;
  const engine = useEngine();

  // ---------------- setup ----------------
  const ubsProfiles = useMemo(() => [...playableUbsProfiles()].sort((a, b) => Number(b.id === ALEXIA_ID) - Number(a.id === ALEXIA_ID)), []);
  // Doppel's own accounts: the built-ins and the ones created in this browser (wizard), with their local data.
  // Opened UBS profiles are already in the UBS group. Before hydration this is the built-in list (as on the server).
  const { accounts: stored } = useAccounts();
  useEffect(() => hydrateAccounts(), []);
  const accounts = useMemo(() => stored.filter((a) => !a.ubs).map((a) => a.profile), [stored]);
  const [startId, setStartId] = useState(`ubs:${ALEXIA_ID}`);
  const [regime, setRegime] = useState<RegimeId>("normal");
  const [seed, setSeed] = useState(2026);
  const [depth, setDepth] = useState<DepthId>("goal");
  const [preset, setPreset] = useState<PresetId | "custom">("balanced");
  const [weights, setWeights] = useState<Weights>(WEIGHT_PRESETS.balanced);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [prefs, setPrefs] = useState<string[]>([]);
  // Suggested from the data (derived): a family household has children; nothing else is assumed. The suggestion
  // replaces the player's choices only when another profile is chosen, not when the same opening is loaded again
  // (the accounts list re-hydrates, or changes in another tab).
  const openingId = opening?.id;
  const household = opening?.profile.origin?.household;
  const derivedPrefs = useMemo(() => (openingId ? suggestedPrefs(household) : []), [openingId, household]);
  useEffect(() => setPrefs(derivedPrefs), [derivedPrefs]);

  useEffect(() => {
    let alive = true;
    const [kind, id] = startId.split(":");
    const load = async (): Promise<Opening> => {
      if (kind === "ubs") {
        const [state, profile] = await Promise.all([ubsOpening(id), loadUbsProfile(id)]);
        return { id: startId, state, profile };
      }
      const profile = accounts.find((p) => p.id === id) ?? accounts[0];
      return { id: startId, state: accountOpening(profile), profile };
    };
    load().then((o) => alive && setOpening(o));
    return () => {
      alive = false;
    };
  }, [startId, accounts]);

  // ---------------- game ----------------
  const [game, setGame] = useState<Game | null>(null);
  const [gameProfile, setGameProfile] = useState<Profile | null>(null);
  const [mainLine, setMainLine] = useState<{ game: Game; from: number } | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [compare, setCompare] = useState<"you" | "engine">("you");
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  /** Luck of each move (points), by the moves that led to the position after it. */
  const [lucks, setLucks] = useState<Record<string, number>>({});
  const [engineMs, setEngineMs] = useState(0);
  /** The one request the engine is working on (an object, so an old request can never clear a newer one). */
  const inflight = useRef<{ key: string } | null>(null);
  const failed = useRef(new Set<string>());
  const generation = useRef(0);
  /** Re-runs the review queue after a request ended without a result (failed or cancelled). */
  const [queueTick, nudgeQueue] = useReducer((n: number) => n + 1, 0);

  const startGame = useCallback(
    (o: Opening, declared: string[] = prefs) => {
      // A new game: whatever the engine is still computing belongs to the old one. Stop it, forget its failures.
      generation.current++;
      engine.reset();
      inflight.current = null;
      failed.current.clear();
      setGame(newGame({ ...o.state, prefs: declared }, { regime, seed, depth, weights, preset }));
      setGameProfile(o.profile);
      setAnalyses({});
      setLucks({});
      setMainLine(null);
      setView(null);
    },
    [engine, regime, seed, depth, weights, preset, prefs],
  );

  // The first opening that loads starts the demo game (Alexia by default), with the preferences its data suggests
  // (the state that holds them is only set in this same pass).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (opening && !autoStarted.current) {
      autoStarted.current = true;
      startGame(opening, suggestedPrefs(opening.profile.origin?.household));
    }
  }, [opening, startGame]);

  const engineSettings: EngineSettings | null = useMemo(
    () => (game ? { regime: game.settings.regime, seed: game.settings.seed, depth, weights } : null),
    [game, depth, weights],
  );
  const evalKey = `${depth}|${weightsKey(weights)}`;
  const analysisAt = useCallback((turn: number) => (game ? analyses[evalKey + "|" + posKey(game, turn)] : undefined), [analyses, evalKey, game]);

  const luckKey = useCallback((g: Game, move: number) => evalKey + "|luck|" + posKey(g, move + 1), [evalKey]);

  // Review queue, one request at a time: the move just played (its review, then its luck), the live position, then
  // older positions and their luck (after a depth or weights change).
  useEffect(() => {
    if (!game || !engineSettings || inflight.current) return;
    const n = game.positions.length;
    const older = Array.from({ length: Math.max(0, n - 2) }, (_, k) => n - 3 - k);
    const analysisJob = (k: number) => ({ kind: "analysis" as const, k, key: evalKey + "|" + posKey(game, k) });
    const luckJob = (k: number) => ({ kind: "luck" as const, k, key: luckKey(game, k) });
    const jobs = [analysisJob(n - 2), luckJob(n - 2), analysisJob(n - 1), ...older.map(analysisJob), ...older.map(luckJob)];
    const job = jobs.find((j) => {
      if (j.k < 0 || failed.current.has(j.key)) return false;
      // Only a position that is still to be played has moves to review; every played move has its luck.
      return j.kind === "analysis" ? game.positions[j.k].status === "playing" && !analyses[j.key] : j.k < game.moves.length && lucks[j.key] === undefined;
    });
    if (!job) return;
    const gen = generation.current;
    const token = { key: job.key };
    inflight.current = token;
    const request =
      job.kind === "analysis"
        ? engine.analyse(game.positions[job.k], engineSettings).then(({ analysis, ms }) => {
            if (gen !== generation.current) return;
            setEngineMs(ms);
            setAnalyses((prev) => ({ ...prev, [job.key]: analysis }));
          })
        : engine.luck(game.positions[job.k], game.moves[job.k].card, game.positions[job.k + 1], game.moves[job.k].crunch, engineSettings).then((l) => {
            if (gen !== generation.current) return;
            setLucks((prev) => ({ ...prev, [job.key]: l.luck * 100 }));
          });
    request
      .catch((error: unknown) => {
        // A cancelled request belongs to a game that was replaced; only a real engine error is remembered.
        if (!(error instanceof EngineCancelled) && gen === generation.current) failed.current.add(job.key);
      })
      .finally(() => {
        if (inflight.current === token) inflight.current = null;
        if (gen === generation.current) nudgeQueue();
      });
  }, [game, engineSettings, analyses, lucks, evalKey, luckKey, engine, queueTick]);

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
      // Luck: the realised turn against the expected turn, at the review's horizon (engine: turnLuck).
      const luck = lucks[luckKey(game, k)] ?? null;
      return { move: m, analysis: a ?? null, review, luck, life: game.lifeEvents[k + 1] };
    });
  }, [game, analysisAt, lucks, luckKey]);

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
  // The rules (which key, when it is ignored) are in keys.ts; Tab is left alone so the focus moves normally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const action = keyAction({ key: e.key, repeat: e.repeat, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, targetTag: el?.tagName, editable: el?.isContentEditable });
      if (!action) return;
      if (action.kind === "prev" || action.kind === "next") {
        if (!moves.length) return;
        e.preventDefault();
        if (action.kind === "prev") setView((v) => Math.max(0, (v ?? moves.length) - 1));
        else setView((v) => (v === null || v + 1 >= moves.length ? null : v + 1));
      } else if (action.kind === "card") {
        const c = view === null ? hand.filter((x) => x !== "hold")[action.index] : undefined;
        if (c) onPlay(c);
      } else if (action.kind === "hold") {
        if (view === null && hand.includes("hold")) onPlay("hold");
      } else {
        setCompare((c) => (c === "you" ? "engine" : "you"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moves.length, view, hand, onPlay]);

  const download = () => {
    if (!game) return;
    // The record carries the reviews as shown, and the depth and weights they were made with.
    const record = toRecord(game, { reviews: moves.map((m) => (m.review ? { ...m.review, luck: m.luck } : null)), reviewedWith: { depth, weights, preset } });
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
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
          accounts={accounts}
          startId={startId}
          onStartId={setStartId}
          regime={regime}
          onRegime={setRegime}
          seed={seed}
          onSeed={setSeed}
          opening={opening?.id === startId ? opening : null}
          onStart={() => opening && startGame(opening)}
          prefs={prefs}
          derivedPrefs={derivedPrefs}
          onPrefs={setPrefs}
        />

        {!game || !live || !viewedPos ? (
          <div className="card mt-4 p-6 text-sm text-ink-3 pulse-soft">{t("play.evalBar.waiting")}</div>
        ) : (
          <>
            <Banner position={live} atStart={game.moves.length === 0} boardCheck={!!line && line.turns.length > 1 && !!line.turns[line.turns.length - 2]?.black?.check} />
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
                <PositionPanel position={viewedPos} profile={gameProfile} turn={viewedTurn} regime={game.settings.regime} seed={game.settings.seed} />
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

