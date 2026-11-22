"use client";

import { useId, useMemo, useState } from "react";
import type { Profile } from "@/lib/finance/types";
import type { StatementSummary } from "@/lib/import";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { twinPersona, type Figure, type HealthComponent, type HealthId, type Trait } from "@/lib/twin/persona";
import { CardHeader } from "./ui";

const TONE_BAR = (c: HealthComponent) => (c.points >= 15 ? "bg-good" : c.points >= 8 ? "bg-warn" : "bg-bad");
const TRAIT_DOT: Record<Trait["tone"], string> = { good: "bg-good", warn: "bg-warn", neutral: "bg-ink-3" };

/** Small outlined tag for a provenance or a source. */
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-block rounded border border-line px-1.5 py-px text-[11px] leading-4 text-ink-2">{children}</span>;
}

/** Score ring: the arc is decoration, the number inside is the value. */
function ScoreRing({ score, max, label, of }: { score: number; max: number; label: string; of: string }) {
  const r = 30;
  const circumference = 2 * Math.PI * r;
  const share = max > 0 ? Math.min(1, Math.max(0, score / max)) : 0;
  return (
    <div className="relative h-[76px] w-[76px] shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="6" style={{ stroke: "var(--surface-2)" }} />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${share * circumference} ${circumference}`}
          style={{ stroke: "var(--ink)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className="num text-xl leading-none font-semibold">{score}</span>
        <span className="num mt-0.5 text-[11px] leading-none text-ink-3">{of}</span>
      </div>
    </div>
  );
}

/**
 * The twin card: who the twin is. Identity, four monthly figures, the health score with its five components
 * (tap one for its basis and provenance), up to four habits with their evidence, and how much of the twin is
 * observed, entered or assumed. Every number comes from `twinPersona()`; nothing is computed here.
 */
export function TwinCard(props: { profile: Profile; summary?: StatementSummary }) {
  const { profile, summary } = props;
  const { t, tm, fmt } = useI18n();
  const persona = useMemo(() => twinPersona(profile, summary), [profile, summary]);
  const [open, setOpen] = useState<HealthId | null>(null);
  const baseId = useId();

  const { identity, money, balance, health, traits, dataQuality } = persona;
  const stats: { key: string; label: string; figure: Figure; sub: string }[] = [
    { key: "takeHome", label: t("twin.stat.takeHome"), figure: money.takeHome, sub: t(`twin.prov.${money.takeHome.provenance}`) },
    { key: "fixed", label: t("twin.stat.fixed"), figure: money.fixedCosts, sub: t(`twin.prov.${money.fixedCosts.provenance}`) },
    { key: "free", label: t("twin.stat.free"), figure: money.freeCash, sub: t(`twin.prov.${money.freeCash.provenance}`) },
    { key: "saved", label: t("twin.stat.saved"), figure: money.saved, sub: t("twin.stat.rate", { rate: money.savingRate }) },
  ];
  const quality = [
    { key: "observed", share: dataQuality.observed, label: t("twin.quality.observed"), bar: "bg-good" },
    { key: "entered", share: dataQuality.entered, label: t("twin.quality.entered"), bar: "bg-s1" },
    { key: "assumed", share: dataQuality.assumed, label: t("twin.quality.assumed"), bar: "bg-ink-3" },
  ];
  const next = dataQuality.missing[0];

  return (
    <section className="card p-4 sm:p-6" aria-label={t("twin.aria", { name: identity.name })} data-testid="twin-card">
      <CardHeader title={t("twin.title")} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.5fr)] lg:gap-6">
        {/* Who */}
        <div className="min-w-0">
          <p className="font-serif text-2xl leading-tight break-words sm:text-3xl" data-testid="twin-name">{identity.name}</p>
          <p className="mt-1.5 text-sm text-ink-2">
            <span className="num">{identity.age}</span> · {identity.city} · {tm(identity.stageLabel)}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
            {tm(identity.householdLabel)}
            {identity.householdProvenance === "doppel_default" && <Tag>{t("twin.assumed")}</Tag>}
          </p>
          <dl className="mt-3 flex items-baseline gap-2">
            <dt className="label">{t("twin.netWorth")}</dt>
            <dd className="num text-sm font-semibold">{fmt.chf(balance.netWorth)}</dd>
          </dl>
        </div>

        {/* Monthly figures */}
        <dl className="grid min-w-0 grid-cols-2 content-start gap-2 self-start" aria-label={t("twin.stat.perMonth")}>
          {stats.map((s) => (
            <div key={s.key} className="min-w-0 rounded-lg bg-surface-2 px-3 py-2.5" data-testid={`twin-stat-${s.key}`}>
              <dt className="label break-words">{s.label}</dt>
              <dd className="num mt-1 text-base leading-tight font-semibold break-words">{fmt.chf(s.figure.value)}</dd>
              <dd className="mt-0.5 text-[11px] leading-4 text-ink-3">{s.sub}</dd>
            </div>
          ))}
        </dl>

        {/* Health score */}
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <ScoreRing
                score={health.score}
                max={health.max}
                label={t("twin.health.scoreAria", { score: health.score, max: health.max })}
                of={t("twin.health.of", { max: health.max })}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="label mb-1.5">{t("twin.health.title")}</p>
              <ul className="space-y-1">
                {health.components.map((c) => {
                  const isOpen = open === c.id;
                  const panelId = `${baseId}-${c.id}`;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="block w-full cursor-pointer rounded-md py-1 text-left hover:bg-surface-2"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => setOpen(isOpen ? null : c.id)}
                        data-testid={`twin-health-${c.id}`}
                      >
                        <span className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate font-medium">{tm(c.label)}</span>
                          <span className="num shrink-0 text-ink-2">
                            <span className="sr-only">{t("twin.health.rowAria", { label: tm(c.label), points: c.points, max: c.max })}. </span>
                            <span aria-hidden="true">{c.points}/{c.max}</span>
                          </span>
                        </span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                          <span className={`block h-full rounded-full ${TONE_BAR(c)}`} style={{ width: `${(c.points / c.max) * 100}%` }} />
                        </span>
                        <span className="num mt-1 block text-[11px] leading-4 text-ink-3">{tm(c.reading)}</span>
                      </button>
                      <div id={panelId} hidden={!isOpen} className="mt-1 mb-1.5 rounded-md bg-surface-2 p-2 text-[11px] leading-4 text-ink-2">
                        <p>{tm(c.basis)}</p>
                        <p className="mt-1.5 flex flex-wrap gap-1">
                          <Tag>{t(`twin.prov.${c.provenance}`)}</Tag>
                          <Tag>{tm(c.benchmarkSource)}</Tag>
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-ink-3">{t("twin.health.note")}</p>
        </div>
      </div>

      {/* Habits and data quality */}
      <div className="mt-5 grid gap-4 border-t border-line pt-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-6">
        <div className="min-w-0">
          <p className="label mb-2">{t("twin.traits")}</p>
          {traits.length === 0 ? (
            <p className="text-xs text-ink-3">{t("twin.traitsNone")}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {traits.slice(0, 4).map((x) => (
                <li
                  key={x.id}
                  className="flex max-w-full flex-wrap items-center gap-x-1.5 rounded-full border border-line px-2.5 py-1 text-xs"
                  data-testid={`twin-trait-${x.id}`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TRAIT_DOT[x.tone]}`} aria-hidden="true" />
                  <span className="font-medium">{tm(x.label)}</span>
                  <span className="num text-ink-2">{tm(x.evidence)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          <p className="label mb-2">{t("twin.quality.title")}</p>
          <div
            className="flex h-1.5 gap-px overflow-hidden rounded-full bg-surface-2"
            role="img"
            aria-label={t("twin.quality.aria", { observed: dataQuality.observed, entered: dataQuality.entered, assumed: dataQuality.assumed })}
          >
            {quality.map((q) => (q.share > 0 ? <span key={q.key} className={`block h-full ${q.bar}`} style={{ width: `${q.share * 100}%` }} /> : null))}
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-4 text-ink-2" aria-hidden="true">
            {quality.map((q) => (
              <li key={q.key} className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${q.bar}`} />
                <span className="num">{fmt.pct(q.share)}</span> {q.label}
              </li>
            ))}
          </ul>
          {next && (
            <p className="mt-2 text-xs text-ink-2" data-testid="twin-next">
              <span className="label mr-1.5">{t("twin.quality.next")}</span>
              {tm(next.action)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
