"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Profile } from "@/lib/finance/types";
import { type CardParam, LIFE_PREFS, cardById, declaredChoice } from "@/lib/game/cards";
import type { Analysis, DepthId, MoveReview } from "@/lib/game/engine";
import { DEPTHS } from "@/lib/game/engine";
import { LABEL_GLYPH, PRESETS, type MoveLabel, type PresetId, type Weights } from "@/lib/game/evaluate";
import type { Game, LifeRecord, MoveRecord } from "@/lib/game/game";
import { REGIME, REGIMES, type RegimeId } from "@/lib/game/regime";
import { CREDIT_LINE, type GameState, bufferMonths, debtTotal, incomeAt, monthlyOutflow, monthlySurplus, netWorth, pensionNet, realNetWorth, targetAt } from "@/lib/game/state";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/types";
import { type UbsProfileSummary, ubsScenarioCatalog } from "@/lib/ubs";
import { CardHeader, Disclosure } from "../ui";
import { DonutTable, EvalBars, ImpactDonut, LinesChart } from "./Charts";
import type { Opening } from "./PlayApp";
import { cardGlyph } from "./ChessBoard";
import { cantonLine } from "../CantonLine";
import { type Rating, fiProbability } from "@/lib/game/independence";
import { rateGame } from "@/lib/game/rating";
import { LABEL_TONE, cardDesc, cardTitle, explain, paramLabel, paramValue } from "./text";

export interface MoveInfo {
  move: MoveRecord;
  analysis: Analysis | null;
  review: MoveReview | null;
  /** Realised minus expected, in points (null until the next position is reviewed). */
  luck: number | null;
  /** Life's card at the start of the next turn. */
  life: LifeRecord;
}

const DEPTH_KEY: Record<DepthId, MessageKey> = { "1y": "play.depth.y1", "5y": "play.depth.y5", goal: "play.depth.goal" };

function Segmented<T extends string>({ value, options, label, onChange, render }: { value: T; options: readonly T[]; label: string; onChange: (v: T) => void; render: (v: T) => string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-xl border border-line p-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`min-h-9 flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${value === o ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

function Chip({ children, tone = "text-ink-2" }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium ${tone}`}>{children}</span>;
}

// ---------------- setup ----------------

export function SetupPanel(props: {
  ubsProfiles: UbsProfileSummary[];
  accounts: Profile[];
  startId: string;
  onStartId: (id: string) => void;
  regime: RegimeId;
  onRegime: (r: RegimeId) => void;
  seed: number;
  onSeed: (s: number) => void;
  opening: Opening | null;
  onStart: () => void;
  prefs: string[];
  derivedPrefs: string[];
  onPrefs: (p: string[]) => void;
}) {
  const { t, tm } = useI18n();
  const o = props.opening;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? props.ubsProfiles.filter((p) => `${p.name} ${p.id} ${p.city} ${p.canton} ${p.age}`.toLowerCase().includes(q) || `ubs:${p.id}` === props.startId)
    : props.ubsProfiles;
  const shownAccounts = q ? props.accounts.filter((p) => `${p.name} ${p.city} ${p.age}`.toLowerCase().includes(q) || `acct:${p.id}` === props.startId) : props.accounts;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="play-setup">
      <CardHeader title={<span id="play-setup">{t("play.setup.title")}</span>} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_6rem_auto] sm:items-end">
        <label className="block min-w-0 text-xs text-ink-2">
          <span className="mb-1 block font-medium">{t("play.setup.profile")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("prefs.search")}
            aria-label={t("prefs.search")}
            data-testid="play-profile-search"
            className="mb-1.5 min-h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
          />
          <select
            value={props.startId}
            onChange={(e) => props.onStartId(e.target.value)}
            className="min-h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
          >
            <optgroup label={t("play.setup.ubsGroup")}>
              {shown.map((p) => (
                <option key={p.id} value={`ubs:${p.id}`}>
                  {p.name}, {p.age} · {p.city} · {t(`play.ubs.employment.${p.employment}` as MessageKey)} ({p.id})
                </option>
              ))}
            </optgroup>
            <optgroup label={t("play.setup.accountsGroup")}>
              {shownAccounts.map((p) => (
                <option key={p.id} value={`acct:${p.id}`}>
                  {p.name}, {p.age} · {p.city}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="min-w-0 text-xs text-ink-2">
          <span className="mb-1 block font-medium">{t("play.setup.regime")}</span>
          <Segmented value={props.regime} options={REGIMES} label={t("play.setup.regime")} onChange={props.onRegime} render={(r) => t(`play.regime.${r}` as MessageKey)} />
        </div>
        <label className="block text-xs text-ink-2">
          <span className="mb-1 block font-medium">{t("play.setup.seed")}</span>
          <input
            type="number"
            inputMode="numeric"
            value={props.seed}
            onChange={(e) => props.onSeed(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            className="num min-h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
          />
        </label>
        <button type="button" onClick={props.onStart} disabled={!o} data-testid="play-start" className="min-h-10 rounded-lg bg-ink px-4 text-sm font-medium text-bg disabled:opacity-50">
          {t("play.setup.start")}
        </button>
      </div>
      {q && <p className="mt-1 text-[11px] text-ink-3">{t("prefs.count", { n: shown.length, total: props.ubsProfiles.length })}</p>}
      <fieldset className="mt-3" data-testid="play-prefs">
        <legend className="text-xs font-medium text-ink-2">{t("prefs.title")}</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {LIFE_PREFS.map((p) => {
            const on = props.prefs.includes(p);
            return (
              <label key={p} className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs ${on ? "border-s1 bg-s1/10 text-ink" : "border-line text-ink-2 hover:text-ink"}`}>
                <input type="checkbox" className="accent-[var(--series-1)]" checked={on} onChange={() => props.onPrefs(on ? props.prefs.filter((x) => x !== p) : [...props.prefs, p])} />
                {t(`prefs.item.${p}` as MessageKey)}
                {props.derivedPrefs.includes(p) && <span className="text-ink-3">· {t("prefs.suggested")}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
      {o && (
        <p className="mt-1 text-xs text-ink-2">
          <span className="font-medium text-ink">{o.profile.name}</span> · {tm(o.profile.tagline)} ·{" "}
          {t("play.setup.opening", { nw: netWorth(o.state), net: incomeAt(o.state, 0).net, target: o.state.goal.target, age: o.state.goal.age })}
          {debtTotal(o.state) > 0 && <> · {t("play.setup.debt", { amount: debtTotal(o.state) })}</>}
        </p>
      )}
    </section>
  );
}

// ---------------- banners ----------------

/**
 * `boardCheck`: Life's last move gives check on the board. The word "check" is used only then; a financial danger
 * the board cannot show as a check yet is a "threat" (the same forced response applies).
 */
export function Banner({ position: p, boardCheck, atStart = false }: { position: GameState; boardCheck: boolean; atStart?: boolean }) {
  const { t } = useI18n();
  let kind: "check" | "threat" | "mate" | "won" | "ended" | null = null;
  let text = "";
  if (p.status === "mate") {
    kind = "mate";
    text = t("play.banner.mate", { line: CREDIT_LINE });
  } else if (p.status === "won") {
    kind = "won";
    // An opening that is already independent: nothing was won by a move, and the banner says so.
    text = atStart ? t("play.banner.wonAtStart", { age: p.age }) : t("fi.won", { age: p.age });
  } else if (p.status === "ended") {
    kind = "ended";
    text = t("fi.ended", { age: p.age });
  } else if (p.check && boardCheck) {
    kind = "check";
    text = p.check.reason === "buffer" ? t("play.banner.checkBuffer", { months: p.check.bufferMonths }) : t("play.banner.checkCrunch", { p: p.check.crunchProb });
  } else if (p.check) {
    kind = "threat";
    text = p.check.reason === "buffer" ? t("threat.buffer", { months: p.check.bufferMonths }) : t("threat.crunch", { p: p.check.crunchProb });
  }
  if (!kind) return null;
  const tone = { check: "text-bad", threat: "text-warn", mate: "text-bad", won: "text-good", ended: "text-ink" }[kind];
  const accent = { check: "var(--bad)", threat: "var(--warn)", mate: "var(--bad)", won: "var(--good)", ended: "var(--ink-3)" }[kind];
  const glyph = { check: "+", threat: "!", mate: "#", won: "★", ended: "½" }[kind];
  return (
    <div role="status" aria-live="polite" data-banner={kind} className={`card mt-4 flex items-start gap-3 px-4 py-3 text-sm font-medium ${tone}`} style={{ borderLeft: `4px solid ${accent}` }}>
      <span aria-hidden="true" className="num text-lg leading-5">{glyph}</span>
      <span className="text-ink">{text}</span>
    </div>
  );
}

// ---------------- evaluation ----------------

export function EvalCard(props: {
  engineE: number | null;
  youE: number | null;
  positionAnalysis: Analysis | null;
  depth: DepthId;
  onDepth: (d: DepthId) => void;
  preset: PresetId | "custom";
  weights: Weights;
  onPreset: (p: PresetId) => void;
  onWeights: (w: Weights) => void;
  position: GameState;
}) {
  const { t, fmt } = useI18n();
  const a = props.positionAnalysis;
  const w = props.weights;
  const best = a?.candidates[0];
  const field = (k: keyof Weights, label: string) => (
    <label key={k} className="block text-xs text-ink-2">
      <span className="mb-1 block">{label}</span>
      <input
        type="number"
        min={0}
        max={1}
        step={0.05}
        value={w[k]}
        onChange={(e) => props.onWeights({ ...w, [k]: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })}
        className="num min-h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
      />
    </label>
  );
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="play-eval">
      <CardHeader
        title={<span id="play-eval">{t("play.evalBar.title")}</span>}
        aside={
          props.position.status !== "playing" ? undefined : best ? (
            <Chip>{t("play.evalBar.position")}: {t("play.evalBar.points", { e: best.e * 100 })}</Chip>
          ) : (
            <span className="text-xs text-ink-3 pulse-soft">{t("play.evalBar.waiting")}</span>
          )
        }
      />
      <EvalBars engine={props.engineE} you={props.youE} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="text-xs text-ink-2">
          <span className="mb-1 block font-medium">{t("play.setup.depth")}</span>
          <Segmented value={props.depth} options={DEPTHS} label={t("play.setup.depth")} onChange={props.onDepth} render={(d) => t(DEPTH_KEY[d])} />
        </div>
        <div className="text-xs text-ink-2">
          <span className="mb-1 block font-medium">{t("play.setup.weights")}</span>
          <Segmented
            value={props.preset === "custom" ? ("custom" as PresetId) : props.preset}
            options={PRESETS}
            label={t("play.setup.weights")}
            onChange={props.onPreset}
            render={(p) => t(`play.preset.${p}` as MessageKey)}
          />
        </div>
      </div>
      {a && best && (
        <p className="mt-2 text-xs text-ink-3">
          {t("play.evalBar.judged", { age: a.horizonAge, target: best.parts.target })}
          {props.preset === "custom" && <> · {t("play.setup.custom")}</>}
        </p>
      )}
      <Disclosure summary={t("play.evalBar.formulaTitle")} className="mt-3">
        <p className="num rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink">
          {t("play.evalBar.formula", { wg: fmt.num(w.goal, 2), ws: fmt.num(w.safe, 2), ww: fmt.num(w.wealth, 2), wd: fmt.num(w.down, 2) })}
        </p>
        <p className="mt-2 text-xs text-ink-3">{t("play.evalBar.formulaNote")}</p>
        <div className="mt-3 text-xs font-medium text-ink-2">{t("play.setup.editWeights")}</div>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {field("goal", t("play.setup.wGoal"))}
          {field("safe", t("play.setup.wSafe"))}
          {field("wealth", t("play.setup.wWealth"))}
          {field("down", t("play.setup.wDown"))}
        </div>
      </Disclosure>
    </section>
  );
}

// ---------------- position ----------------

export function PositionPanel({ position: p, profile, turn, regime, seed }: { position: GameState; profile: Profile | null; turn: number; regime: RegimeId; seed: number }) {
  const { t, tm, fmt } = useI18n();
  const k = p.priceIndex;
  const homeEq = p.home ? (p.home.value - p.home.mortgage) / k : 0;
  const debt = debtTotal(p) / k;
  const nw = realNetWorth(p);
  // Once a player who started working is retired, the pension fund is an annuity: progress is measured against
  // the liquid capital still needed (targetAt), not against the old target that included the fund.
  const goalNow = p.pension && p.goal.retired ? targetAt(p, p.age) : p.goal.target;
  const progress = Math.max(0, Math.min(1, nw / Math.max(1, goalNow)));
  const stat = (label: string, value: string, sub?: string) => (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <div className="truncate text-[11px] text-ink-3">{label}</div>
      <div className="num truncate text-sm font-semibold text-ink sm:text-base">{value}</div>
      {sub && <div className="truncate text-[11px] text-ink-2">{sub}</div>}
    </div>
  );
  const chips: string[] = [];
  for (const ph of p.phases) {
    const months = ph.end - Math.max(0, ph.start);
    const key = { study: "play.position.phaseStudy", jobless: "play.position.phaseJobless", leave: "play.position.phaseLeave", gap: "play.position.phaseGap", training: "play.position.phaseTraining", retiredWork: "retirePlay.phaseWork" }[ph.kind] as MessageKey;
    chips.push(t(key, { months }));
  }
  if (p.abroad) chips.push(t("play.position.abroad"));
  if (p.monthlyInvest > 0) chips.push(t("play.position.investing", { amount: p.monthlyInvest / k }));
  if (p.contributes3a && !p.abroad) chips.push(t("play.position.saving3a"));
  if (p.car) chips.push(t("play.position.car"));
  if (p.children) chips.push(t("play.position.children", { count: p.children }));
  for (const pref of p.prefs) chips.push("♡ " + t(`prefs.item.${pref}` as MessageKey));
  if (p.business) chips.push(t("biz.chip", { kind: t(`biz.${p.business.kind}` as MessageKey), capital: p.business.capital / k, years: p.business.years + 1 }));
  const news = p.businessNews[p.businessNews.length - 1];
  if (news && news.age === p.age - 1)
    chips.push(news.kind === "failed" ? t("biz.failed", { age: news.age, amount: news.amount / k }) : t("biz.profit", { kind: t(`biz.${p.business?.kind ?? "venture"}` as MessageKey), amount: news.amount / k }));
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="play-position" data-turn={turn}>
      <CardHeader
        title={<span id="play-position">{t("play.position.title")}</span>}
        aside={<Chip>{t("play.position.year", { turn: Math.min(p.turn + 1, p.endTurn), total: p.endTurn })} · {t("play.position.age", { age: p.age })}</Chip>}
      />
      <p className="text-sm text-ink-2">
        <span className="font-medium text-ink">{p.name}</span>
        {profile && <> · {tm(profile.tagline)}</>} · {p.city}
      </p>
      <p className="mb-3 text-[11px] text-ink-3" data-testid="play-canton">{cantonLine(t, p.canton, p.healthPremium / k)}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stat(t("play.position.netWorth"), fmt.chf(nw))}
        {stat(t("play.position.cash"), fmt.chf(p.cash / k), t("play.position.buffer", { months: Math.min(99, bufferMonths(p)) }))}
        {stat(t("play.position.invested"), fmt.chf(p.portfolio / k))}
        {stat(t("play.position.pension"), fmt.chf((p.pillar2 + p.pillar3a) / k))}
        {p.home ? stat(t("play.position.home"), fmt.chf(homeEq)) : null}
        {debt > 0 ? stat(t("play.position.debt"), fmt.chf(-debt)) : null}
        {stat(t("play.position.surplus"), fmt.chfSigned(monthlySurplus(p) / k))}
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between gap-2 text-xs text-ink-2">
          <span>{tm(p.goal.label)}</span>
          <span className="num">{t("fi.goalLine", { target: p.goal.target, age: p.goal.age })}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={t("play.position.goal")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full rounded-full bg-s1" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </div>
      )}
      <IndependenceLine position={p} regime={regime} seed={seed} />
      <p className="mt-2 text-[11px] text-ink-3">{t("play.position.startChf")}</p>
    </section>
  );
}

/**
 * The mate measure, live: the chance that savings (+ pensions) pay the spending until 95 if the player stopped
 * working now (retirees: with the pensions in payment). The win needs 90%. Same function as the game's win test.
 */
function IndependenceLine({ position: p, regime, seed }: { position: GameState; regime: RegimeId; seed: number }) {
  const { t } = useI18n();
  const prob = useMemo(() => (p.status === "playing" ? fiProbability(p, REGIME[regime], p.age + 1, seed) : null), [p, regime, seed]);
  const k = p.priceIndex;
  return (
    <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2" data-testid="play-fi">
      {prob !== null && (
        <p>
          <span className="font-medium text-ink">{t(p.pension ? "fi.lineRetired" : "fi.line", { p: prob })}</span>
        </p>
      )}
      {p.pension && <p className="mt-1">{t("fi.pensionNote", { pension: pensionNet(p) / k, spending: monthlyOutflow(p) / k })}</p>}
    </div>
  );
}

// ---------------- cards ----------------

function catalogLine(id: string): string | null {
  const s = ubsScenarioCatalog().find((c) => c.id === id);
  return s ? `${s.id} · ${s.scenario}: ${s.baseline} → ${s.intervention}` : null;
}

function Assumptions({ params, scenarioId }: { params: CardParam[]; scenarioId: string }) {
  const i = useI18n();
  const { t } = i;
  const line = scenarioId ? catalogLine(scenarioId) : null;
  if (!params.length && !line) return null;
  return (
    <Disclosure summary={t("play.move.assumptions")} className="mt-2">
      <dl className="space-y-1 text-xs">
        {params.map((p) => (
          <div key={p.key} className="flex flex-wrap items-baseline justify-between gap-x-2">
            <dt className="text-ink-2">{paramLabel(i, p.key)}</dt>
            <dd className="flex items-baseline gap-1.5">
              <span className="num font-medium text-ink">{paramValue(i, p)}</span>
              <span className={`rounded px-1 text-[10px] ${p.source === "ubs_synthetic_assumption" ? "bg-s1/15 text-s1" : "bg-surface-2 text-ink-3"}`} title={p.ref}>
                {t(`play.source.${p.source}` as MessageKey)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {line && <p className="mt-2 text-[11px] text-ink-3">{t("play.move.catalog", { id: line })}</p>}
    </Disclosure>
  );
}

function Tags({ id, declared }: { id: string; declared: boolean }) {
  const { t } = useI18n();
  const c = cardById(id);
  return (
    <span className="flex flex-wrap gap-1">
      {c.response && <Chip tone="text-good">{t("play.tag.response")}</Chip>}
      {c.recurring && <Chip tone="text-warn">{t("play.tag.recurring")}</Chip>}
      {declared && <Chip tone="text-s1">{t("play.tag.lifeChoice")}</Chip>}
    </span>
  );
}

export function LifeCard({ life, regime }: { life: LifeRecord | undefined; regime: RegimeId }) {
  const i = useI18n();
  const { t } = i;
  const card = life?.card ? cardById(life.card) : null;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="play-life">
      <CardHeader title={<span id="play-life">{t("play.life.title")}</span>} aside={<Chip>{t(`play.regime.${regime}` as MessageKey)}</Chip>} />
      {card && life ? (
        <div data-life={card.id}>
          <div className="text-xs text-ink-3">{t("play.life.plays")}</div>
          <div className="font-serif text-xl leading-tight">{cardTitle(i, card.id)}</div>
          <p className="mt-1 text-sm text-ink-2">{cardDesc(i, card.id, life.params)}</p>
          <Assumptions params={life.params} scenarioId={card.scenarioId} />
        </div>
      ) : (
        <p className="text-sm text-ink-2">{life?.turn === 0 ? t("play.life.opening") : t("play.life.quiet")}</p>
      )}
      {life?.earlier && life.earlier.length > 0 && (
        <div className="mt-3 border-t border-line pt-2" data-testid="play-life-earlier">
          <div className="text-xs text-ink-3">{t("fi.earlier")}</div>
          <ul className="mt-1 space-y-0.5 text-sm text-ink-2">
            {life.earlier.map((e) => (
              <li key={e.turn + e.card}>
                {t("play.position.age", { age: e.age })}: {cardTitle(i, e.card)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CardTile({ id, index, position, regime, onPlay, extra, onPreview }: { id: string; index?: number; position: GameState; regime: RegimeId; onPlay: () => void; extra?: ReactNode; onPreview?: (card: string | null) => void }) {
  const i = useI18n();
  const def = cardById(id);
  const params = useMemo(() => def.params(position, REGIME[regime]), [def, position, regime]);
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-3">
      <button
        type="button"
        onClick={onPlay}
        data-testid="play-card"
        data-card={id}
        onMouseEnter={() => onPreview?.(id)}
        onMouseLeave={() => onPreview?.(null)}
        onFocus={() => onPreview?.(id)}
        onBlur={() => onPreview?.(null)}
        aria-keyshortcuts={index ? String(index) : undefined}
        className="flex min-h-24 flex-1 flex-col items-start gap-1 rounded-lg p-1 text-left hover:bg-surface-2"
      >
        <span className="flex w-full items-start gap-2">
          {index !== undefined && (
            <span aria-hidden="true" className="num grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink text-xs font-semibold text-bg">{index}</span>
          )}
          <span className="font-serif text-lg leading-tight text-ink">
            {cardGlyph(id) && <span aria-hidden="true" className="piece-w mr-1.5 text-base">{cardGlyph(id)}</span>}
            {cardTitle(i, id)}
          </span>
        </span>
        <span className="text-xs text-ink-2">{cardDesc(i, id, params)}</span>
        <Tags id={id} declared={declaredChoice(position, id)} />
        {extra}
      </button>
      <Assumptions params={params} scenarioId={def.scenarioId} />
    </div>
  );
}

export function DecisionArea(props: {
  position: GameState;
  regime: RegimeId;
  hand: string[];
  reviewOf: MoveInfo | null;
  onPlay: (card: string) => void;
  onWhatIf: (card: string) => void;
  over: boolean;
  thinking: boolean;
  /** Tells the board which decision is under the pointer or the focus (its piece and target are shown there). */
  onPreview?: (card: string | null) => void;
}) {
  const i = useI18n();
  const { t } = i;
  if (props.reviewOf) {
    const r = props.reviewOf;
    const cands = r.analysis?.candidates ?? [];
    return (
      <section className="card p-4 sm:p-5" aria-labelledby="play-whatif">
        <CardHeader title={<span id="play-whatif">{t("play.moves.whatIf")}</span>} />
        <p className="mb-3 text-xs text-ink-3">{t("play.moves.whatIfHint", { turn: r.move.turn + 1 })}</p>
        {!r.analysis && <p className="text-sm text-ink-3 pulse-soft">{t("play.move.reviewing")}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {cands.map((c) => {
            const played = c.card === r.move.card;
            return played ? (
              <div key={c.card} className="rounded-xl border-2 border-s1 bg-surface p-3" data-card={c.card}>
                <div className="font-serif text-lg leading-tight">{cardTitle(i, c.card)}</div>
                <div className="num mt-1 text-xs text-ink-2">{t("play.evalBar.you")} · {t("play.evalBar.points", { e: c.e * 100 })}</div>
              </div>
            ) : (
              <CardTile
                key={c.card}
                id={c.card}
                position={props.position}
                regime={props.regime}
                onPlay={() => props.onWhatIf(c.card)}
                extra={<span className="num text-xs font-medium text-ink" data-testid="play-whatif">→ {t("play.evalBar.points", { e: c.e * 100 })}</span>}
              />
            );
          })}
        </div>
      </section>
    );
  }
  const cards = props.hand.filter((c) => c !== "hold");
  const holdAllowed = props.hand.includes("hold");
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="play-move">
      <CardHeader title={<span id="play-move">{t("play.move.title")}</span>} aside={props.thinking ? <span className="text-xs text-ink-3 pulse-soft">{t("play.evalBar.waiting")}</span> : undefined} />
      {props.over ? (
        <p className="text-sm text-ink-2">{t("play.move.over")}</p>
      ) : (
        <>
          <p className={`mb-3 text-xs ${props.position.check ? "font-medium text-warn" : "text-ink-3"}`}>{props.position.check ? t("threat.respond") : t("play.move.hint")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((c, k) => (
              <CardTile key={c} id={c} index={k + 1} position={props.position} regime={props.regime} onPlay={() => props.onPlay(c)} onPreview={props.onPreview} />
            ))}
          </div>
          {holdAllowed && (
            <button
              type="button"
              onClick={() => props.onPlay("hold")}
              data-testid="play-hold"
              onMouseEnter={() => props.onPreview?.("hold")}
              onMouseLeave={() => props.onPreview?.(null)}
              onFocus={() => props.onPreview?.("hold")}
              onBlur={() => props.onPreview?.(null)}
              aria-keyshortcuts="H"
              className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-left hover:bg-surface-2"
            >
              <span>
                <span className="block font-serif text-lg leading-tight">{t("play.move.hold")}</span>
                <span className="text-xs text-ink-2">{t("play.move.holdDesc")}</span>
              </span>
              <span aria-hidden="true" className="num grid h-6 w-6 place-items-center rounded-md border border-line text-xs font-semibold">H</span>
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ---------------- analysis ----------------

function LabelBadge({ label }: { label: MoveLabel }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-baseline gap-2 ${LABEL_TONE[label]}`}>
      <span className="num font-serif text-4xl leading-none">{LABEL_GLYPH[label]}</span>
      <span className="text-lg font-semibold">{t(`play.label.${label}` as MessageKey)}</span>
    </span>
  );
}

function LineRow({ label, pv, active, color }: { label: string; pv: string[]; active: boolean; color: string }) {
  const i = useI18n();
  return (
    <div className={`rounded-lg px-3 py-2 ${active ? "bg-surface-2" : ""}`} data-active={active}>
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
        {label}
      </div>
      <div className={`text-sm ${active ? "font-medium text-ink" : "text-ink-2"}`}>
        {pv.map((c, k) => (
          <span key={k}>
            {k > 0 && <span className="text-ink-3"> → </span>}
            {cardTitle(i, c)}
          </span>
        ))}
        {pv.length === 1 && <span className="text-ink-3"> → {i.t("play.review.thenHold")}</span>}
      </div>
    </div>
  );
}

function LuckMeter({ luck, bucket }: { luck: number | null; bucket: number }) {
  const { t } = useI18n();
  const x = luck === null ? 0 : Math.max(-10, Math.min(10, luck));
  return (
    <div className="mt-4 rounded-lg border border-line p-3" data-testid="play-luck">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="label">{t("play.review.luck")}</span>
        <span className="num text-sm font-semibold text-ink">{luck === null ? "—" : t("play.review.luckValue", { luck })}</span>
      </div>
      <div className="relative h-2 rounded-full bg-surface-2" role="meter" aria-label={t("play.review.luck")} aria-valuemin={-10} aria-valuemax={10} aria-valuenow={luck === null ? undefined : Math.round(x * 10) / 10}>
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-ink-3" aria-hidden="true" />
        {luck !== null && (
          <span
            className="absolute inset-y-0 rounded-full"
            style={{ left: x < 0 ? `${50 + x * 5}%` : "50%", width: `${Math.abs(x) * 5}%`, background: x < 0 ? "var(--series-2)" : "var(--series-1)" }}
          />
        )}
      </div>
      <p className="mt-2 text-xs text-ink-2">
        {t("play.review.market", { bucket: t(`play.market.b${bucket}` as MessageKey) })}.{" "}
        {luck === null ? t("play.review.luckPending") : luck > 0.5 ? t("play.review.luckGood") : luck < -0.5 ? t("play.review.luckBad") : t("play.review.luckEven")}
      </p>
    </div>
  );
}

/** Where the points difference between the played move and the best move comes from (weights × parts). */
function ScoreBreakdown({ mine, best, weights }: { mine: Analysis["candidates"][number]; best: Analysis["candidates"][number]; weights: Weights }) {
  const { t, fmt } = useI18n();
  const rows = [
    { key: "goal", v: weights.goal * (mine.parts.pGoal - best.parts.pGoal) },
    { key: "safety", v: weights.safe * (best.parts.pCrunch - mine.parts.pCrunch) },
    { key: "wealth", v: weights.wealth * (mine.parts.wealthScore - best.parts.wealthScore) },
    { key: "downside", v: -weights.down * (mine.parts.shortfall - best.parts.shortfall) },
  ].map((r) => ({ ...r, v: r.v * 100 }));
  const total = rows.reduce((a, r) => a + r.v, 0);
  return (
    <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2" data-testid="play-breakdown">
      <div className="mb-1 text-xs font-medium text-ink-2">{t("play.explain.breakdownTitle")}</div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-ink-2">{t(`play.explain.part.${r.key}` as MessageKey)}</dt>
            <dd className={`num text-right ${Math.abs(r.v) < 0.05 ? "text-ink-3" : r.v > 0 ? "text-good" : "text-bad"}`}>{fmt.signed(Math.round(r.v * 10) / 10)}</dd>
          </div>
        ))}
        <dt className="border-t border-line pt-0.5 font-medium text-ink">{t("play.explain.part.total")}</dt>
        <dd className="num border-t border-line pt-0.5 text-right font-medium text-ink">{fmt.signed(Math.round(total * 10) / 10)}</dd>
      </dl>
    </div>
  );
}

export function AnalysisPanel({ info, compare, onCompare, engineMs, weights }: { info: MoveInfo | null; compare: "you" | "engine"; onCompare: () => void; engineMs: number; weights: Weights }) {
  const i = useI18n();
  const { t } = i;
  const a = info?.analysis;
  const r = info?.review;
  const mine = a && r ? a.candidates.find((c) => c.card === r.card) ?? a.hold : null;
  const best = a?.candidates[0];
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="play-review" data-testid="play-review" data-label={r?.label ?? ""}>
      <CardHeader
        title={<span id="play-review">{t("play.review.title")}</span>}
        aside={
          r ? (
            <button type="button" aria-pressed={compare === "engine"} onClick={onCompare} className="min-h-8 rounded-full border border-line px-3 text-xs font-medium text-ink-2 hover:text-ink">
              {t("play.review.compare")} · {compare === "engine" ? t("play.review.lineEngine") : t("play.review.lineYou")}
            </button>
          ) : undefined
        }
      />
      {!info ? (
        <p className="text-sm text-ink-2">{t("play.review.empty")}</p>
      ) : !r || !a || !mine || !best ? (
        <p className="text-sm text-ink-3 pulse-soft">{t("play.move.reviewing")}</p>
      ) : (
        <>
          <div className="text-xs text-ink-3">{t("play.review.move", { turn: info.move.turn + 1, move: cardTitle(i, r.card) })}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <LabelBadge label={r.label} />
            {r.sacrifice && <Chip tone="text-good">{t("play.tag.sacrifice")}</Chip>}
            {r.drain && <Chip tone="text-warn">{t("play.tag.drain")}</Chip>}
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {r.loss > 0.005 ? t("play.review.loss", { loss: r.loss }) : t("play.review.noLoss")}
            {r.loss > 0.005 && r.lossSe >= 0.05 && <> <span className="text-ink-3" data-testid="play-loss-noise">{t("play.review.lossNoise", { se: r.lossSe })}</span></>}
            {r.best !== r.card && <> · <span className="font-medium text-ink">{t("play.review.bestIs", { move: cardTitle(i, r.best) })}</span></>}
          </p>
          <div className="mt-3 space-y-1">
            <LineRow label={t("play.review.lineEngine")} pv={r.bestPv} active={compare === "engine"} color="var(--series-2)" />
            <LineRow label={t("play.review.lineYou")} pv={r.pv} active={compare === "you"} color="var(--series-1)" />
          </div>
          <div className="mt-3 space-y-1.5 text-sm text-ink" data-testid="play-explain">
            {explain(i, a, r).map((s) => (
              <p key={s}>{s}</p>
            ))}
          </div>
          {r.card !== best.card && <ScoreBreakdown mine={mine} best={best} weights={weights} />}
          {r.card !== best.card && <p className="mt-2 text-xs text-ink-2">{t("play.explain.scoreVsRings", { age: a.horizonAge })}</p>}
          <div className="mt-4">
            <div className="label mb-2">{t("play.review.donutTitle")}</div>
            <div className={`grid gap-3 ${r.card !== best.card ? "grid-cols-2" : "grid-cols-1"}`}>
              {(compare === "engine" && r.card !== best.card ? [best, mine] : r.card !== best.card ? [mine, best] : [mine]).map((c) => (
                <ImpactDonut key={c.card} slices={c.donut} title={`${c.card === r.card ? t("play.review.donutYou") : t("play.review.donutBest")}: ${cardTitle(i, c.card)}`} />
              ))}
            </div>
            <DonutTable you={mine.donut} best={best.donut} showBest={r.card !== best.card} />
            <p className="mt-2 text-[11px] text-ink-3">{t("play.review.donutNote", { age: a.horizonAge })}</p>
          </div>
          <LuckMeter luck={info.luck} bucket={info.move.market} />
          <p className="mt-3 text-[11px] text-ink-3">
            {t("play.review.stats", { futures: a.stats.scenarios, moves: a.candidates.length + (a.holdAllowed ? 0 : 1), rollouts: a.stats.leafEvals, paths: a.stats.paths })}
            {engineMs > 0 && <> · {Math.round(engineMs)} ms</>}
          </p>
        </>
      )}
    </section>
  );
}

// ---------------- move list ----------------

export function MoveList({ moves, san, view, onView, mainLine, onMain, onExport }: { moves: MoveInfo[]; san?: { w?: string; b?: string }[]; view: number | null; onView: (k: number | null) => void; mainLine: number | null; onMain: () => void; onExport: () => void }) {
  const i = useI18n();
  const { t } = i;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="play-moves">
      <CardHeader
        title={<span id="play-moves">{t("play.moves.title")}</span>}
        aside={
          <button type="button" onClick={onExport} disabled={!moves.length} className="min-h-8 rounded-full border border-line px-3 text-xs font-medium text-ink-2 hover:text-ink disabled:opacity-50">
            {t("play.moves.export")}
          </button>
        }
      />
      {mainLine !== null && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs" data-testid="play-branch">
          <span className="font-medium text-ink">{t("play.moves.branch", { turn: mainLine + 1 })}</span>
          <button type="button" onClick={onMain} className="min-h-8 rounded-full border border-line bg-surface px-3 font-medium text-ink-2 hover:text-ink">
            {t("play.moves.main")}
          </button>
        </div>
      )}
      {!moves.length ? (
        <p className="text-sm text-ink-3">{t("play.moves.empty")}</p>
      ) : (
        <ol className="space-y-1">
          {moves.map((m, k) => {
            const selected = view === k || (view === null && k === moves.length - 1);
            const label = m.review?.label;
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => onView(k === moves.length - 1 && view === null ? k : k)}
                  aria-current={selected ? "true" : undefined}
                  data-testid="play-move"
                  className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${selected ? "bg-surface-2" : "hover:bg-surface-2"}`}
                >
                  <span className="num w-6 shrink-0 text-xs text-ink-3">{k + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">
                      {san?.[k]?.w && <span className="num mr-1.5 font-semibold">{san[k].w}</span>}
                      {cardTitle(i, m.move.card)}{" "}
                      {label && <span className={`num ${LABEL_TONE[label]}`}>{LABEL_GLYPH[label]}</span>}
                    </span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {t("play.position.age", { age: m.move.age })}
                      {m.move.years > 1 && <> · {t("fi.turnYears", { years: m.move.years })}</>} · {san?.[k]?.b && <span className="num">… {san[k].b} </span>}
                      {t("play.moves.life", { card: m.life.card ? cardTitle(i, m.life.card) : t("play.moves.quiet") })}
                    </span>
                  </span>
                  {m.luck !== null && <span className="num shrink-0 text-[11px] text-ink-3">{t("play.review.luckValue", { luck: m.luck })}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {view !== null && (
        <button type="button" onClick={() => onView(null)} className="mt-2 min-h-8 rounded-full border border-line px-3 text-xs font-medium text-ink-2 hover:text-ink">
          {t("play.moves.latest")}
        </button>
      )}
      <p className="mt-3 text-[11px] text-ink-3">{t("play.keys")}</p>
    </section>
  );
}

// ---------------- end of game ----------------

/** The game rating: computed after the review renders (it replays the game with "hold", about a second). */
function GameRating({ game }: { game: Game }) {
  const { t } = useI18n();
  const [rating, setRating] = useState<Rating | null>(null);
  useEffect(() => {
    let alive = true;
    setRating(null);
    const id = window.setTimeout(() => {
      const r = rateGame(game);
      if (alive) setRating(r);
    }, 50);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [game]);
  if (!rating) return <p className="mt-3 text-sm text-ink-3 pulse-soft">{t("fi.rating.computing")}</p>;
  const outcome = (o: Rating["player"]) =>
    o.kind === "independent"
      ? t("fi.rating.outcome.independent", { age: o.age })
      : o.kind === "mated"
        ? t("fi.rating.outcome.mated", { age: o.age })
        : t("fi.rating.outcome.timeUp", { age: o.age, p: o.fiProb });
  const kids = game.positions[game.positions.length - 1].children;
  const legacy = rating.player.kind === "mated" ? null : rating.player.legacy;
  return (
    <div className="mt-3 rounded-xl border border-line p-3" data-testid="play-rating" data-elo={rating.elo}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="label">{t("fi.rating.title")}</div>
        <Chip tone={rating.tier === "mated" ? "text-bad" : rating.tier === "survived" ? "text-ink-2" : "text-good"}>{t(`fi.rating.tier.${rating.tier}` as MessageKey)}</Chip>
      </div>
      <div className="num mt-1 font-serif text-4xl leading-tight text-ink">{rating.elo}</div>
      <dl className="mt-2 grid gap-1 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-2">{t("fi.rating.you")}</dt>
          <dd className="text-ink">{outcome(rating.player)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-2">{t("fi.rating.hold")}</dt>
          <dd className="text-ink">{outcome(rating.hold)}</dd>
        </div>
      </dl>
      {legacy !== null && (
        <p className="mt-2 text-xs text-ink-2">
          {kids > 0 ? t("fi.rating.legacyKids", { target: legacy }) : t("fi.rating.legacyNone", { target: legacy })}{" "}
          {t("fi.rating.yourNetWorth", { nw: rating.player.kind === "mated" ? 0 : rating.player.netWorth })}
        </p>
      )}
      <p className="mt-2 text-[11px] text-ink-3">{t("fi.rating.formula")}</p>
    </div>
  );
}

export function EndReview({ game, moves }: { game: Game; moves: MoveInfo[] }) {
  const i = useI18n();
  const { t, fmt } = i;
  const last = game.positions[game.positions.length - 1];
  const graded = moves.filter((m) => m.review?.accuracy !== null && m.review?.accuracy !== undefined);
  const accuracy = graded.length ? graded.reduce((s, m) => s + (m.review!.accuracy ?? 0), 0) / graded.length : null;
  const counts = new Map<MoveLabel, number>();
  for (const m of moves) if (m.review) counts.set(m.review.label, (counts.get(m.review.label) ?? 0) + 1);
  const moments: string[] = [];
  const losses = moves.filter((m) => m.review && !m.review.label.startsWith("life") && m.review.loss >= 0.5).sort((a, b) => b.review!.loss - a.review!.loss).slice(0, 2);
  for (const m of losses) moments.push(t("play.end.momentLoss", { turn: m.move.turn + 1, move: cardTitle(i, m.move.card), loss: m.review!.loss, best: cardTitle(i, m.review!.best) }));
  for (const m of moves.filter((x) => x.review?.sacrifice)) moments.push(t("play.end.momentSacrifice", { turn: m.move.turn + 1, move: cardTitle(i, m.move.card) }));
  const lucky = moves.filter((m) => m.luck !== null).sort((a, b) => Math.abs(b.luck!) - Math.abs(a.luck!))[0];
  if (lucky && Math.abs(lucky.luck!) >= 1) moments.push(t("play.end.momentLuck", { turn: lucky.move.turn + 1, luck: lucky.luck!, bucket: t(`play.market.b${lucky.move.market}` as MessageKey) }));
  const data = moves.filter((m) => m.review).map((m) => ({ year: m.move.turn + 1, you: m.review!.e * 100, engine: m.review!.bestE * 100 }));
  const result = last.status === "won" ? t("play.end.won") : last.status === "mate" ? t("play.end.mate") : t("play.end.ended");
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="play-end" data-testid="play-end">
      <CardHeader title={<span id="play-end">{t("play.end.title")}</span>} aside={<Chip tone={last.status === "won" ? "text-good" : last.status === "mate" ? "text-bad" : "text-ink-2"}>{t("play.end.result")}: {result}</Chip>} />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <div className="text-[11px] text-ink-3">{t("play.end.accuracy")}</div>
          <div className="num font-serif text-3xl leading-tight text-ink">{accuracy === null ? "—" : fmt.pct(accuracy / 100)}</div>
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <div className="text-[11px] text-ink-3">{t("play.end.netWorth")}</div>
          <div className="num font-serif text-3xl leading-tight text-ink">{fmt.chfShort(realNetWorth(last))}</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-3">{t("play.end.accuracyNote")}</p>
      <GameRating game={game} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[...counts.entries()].map(([label, n]) => (
          <Chip key={label} tone={LABEL_TONE[label]}>
            {LABEL_GLYPH[label]} {t(`play.label.${label}` as MessageKey)} · {n}
          </Chip>
        ))}
      </div>
      <div className="mt-4">
        <div className="label mb-1">{t("play.end.keyMoments")}</div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          {(moments.length ? moments : [t("play.end.noMoments")]).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
      {data.length > 0 && (
        <div className="mt-4">
          <div className="label mb-2">{t("play.end.chart")}</div>
          <LinesChart data={data} />
        </div>
      )}
    </section>
  );
}
