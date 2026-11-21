"use client";

import type { ReactNode } from "react";
import type { Text } from "@/lib/i18n/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Disclosure } from "./ui";

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
  children,
}: {
  name: string;
  age: number;
  city: string;
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
  children?: ReactNode;
}) {
  const { t, rich, fmt, mounted } = useI18n();
  const probColor = odds >= 0.8 ? "text-good" : odds >= 0.5 ? "text-warn" : "text-bad";
  return (
    <div>
      <div className="label">
        {rich("hero.who", { name: <span lang="de-CH">{name}</span>, age, city: <span lang="de-CH">{city}</span>, tagline })}
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
          <span className={`num text-xs ${impact.after > impact.before ? "text-good" : impact.after < impact.before ? "text-bad" : "text-ink-2"}`}>
            {t("common.deltaPp", { value: (impact.after >= impact.before ? "+" : "−") + fmt.int(Math.abs(Math.round((impact.after - impact.before) * 100))) })}
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
          {taxTip && <li>{taxTip}</li>}
        </ul>
      </Disclosure>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
