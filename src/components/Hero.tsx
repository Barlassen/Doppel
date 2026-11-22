"use client";

import type { ReactNode } from "react";
import type { Text } from "@/lib/i18n/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Disclosure, oddsTone } from "./ui";

export interface HeroImpact {
  label: Text;
  before: number;
  after: number;
}

/**
 * Identity, headline odds and one supporting line. Net worth, crunch risk, the simulation stats and the 3a tax
 * sentence sit one click away under "How is this calculated?". `children` is the settings row.
 */
export function Hero({
  name,
  age,
  city,
  cityLang,
  tagline,
  goal,
  odds,
  ideal,
  fresh,
  netWorth,
  crunch,
  sim,
  impact,
  taxTip,
  notes,
  children,
}: {
  name: string;
  age: number;
  city: string;
  /** Language of the city name, so uppercase labels keep its own casing (Zürich, not ZÜRİCH). */
  cityLang: string;
  tagline: Text;
  goal: Text;
  odds: number;
  ideal: number;
  fresh: boolean;
  netWorth: number;
  crunch: number;
  sim: { paths: number; ms: number };
  impact: HeroImpact | null;
  taxTip?: ReactNode;
  /** Extra lines under "How is this calculated?" (e.g. the debt in net worth). */
  notes?: ReactNode;
  children?: ReactNode;
}) {
  const { t, rich, fmt, mounted } = useI18n();
  const probColor = oddsTone(odds);
  // The change in points is taken from the two rounded figures on screen, so "91% → 90%" always reads "−1".
  const delta = impact ? Math.round(impact.after * 100) - Math.round(impact.before * 100) : 0;
  return (
    <div>
      <div className="label">
        {rich("hero.who", { name: <span>{name}</span>, age, city: <span lang={cityLang}>{city}</span>, tagline })}
      </div>
      <h1 className="mt-1.5 font-serif text-4xl leading-tight sm:text-5xl">
        {t("hero.goal", { goal })}{" "}
        <span className={`num ${probColor} ${fresh ? "" : "opacity-60"}`}>{fmt.pct(odds)}</span>
      </h1>
      <p className="mt-1.5 text-[15px] text-ink-2">
        {rich("hero.disciplined", { odds: <b className="num font-semibold text-ink">{fmt.pct(ideal)}</b> })}{" "}
        {rich("hero.crunch", { risk: <b className="num font-semibold text-ink">{fmt.pct(crunch)}</b> })}
      </p>
      {impact && (
        <p className="mt-1 text-sm">
          <span className="text-ink-2">{t("impact.line", { label: impact.label })}</span>
          <b className="num">
            {t("common.arrow", { before: fmt.pct(impact.before), after: fmt.pct(impact.after) })}
          </b>{" "}
          <span className={`num text-xs ${delta > 0 ? "text-good" : delta < 0 ? "text-bad" : "text-ink-2"}`}>
            {t("common.deltaPp", { value: delta === 0 ? "±0" : fmt.signed(delta) })}
          </span>
        </p>
      )}
      <Disclosure summary={t("common.howCalculated")} className="mt-1.5">
        <ul className="max-w-3xl space-y-1 text-xs text-ink-2">
          <li>
            {rich("hero.netWorth", { amount: <b className="num text-ink">{fmt.chf(netWorth)}</b> })} {t("hero.netWorthNote")}
          </li>
          {mounted && (
            <li>
              {rich("hero.simulated", { paths: fmt.int(sim.paths), ms: <span className="num">{Math.round(sim.ms)}</span> })}{" "}
              {t("chart.engine")}
            </li>
          )}
          {notes}
          {taxTip && <li>{taxTip}</li>}
        </ul>
      </Disclosure>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
