"use client";

import { useMemo } from "react";
import { debtSchedule, DEFAULT_LOAN_TERM_MONTHS } from "@/lib/finance/debt";
import type { GoalStats, Liability, Profile, ProfileGoal, Provenance } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/types";
import { provenanceRows } from "@/lib/ubs/map";
import { CardHeader, Disclosure } from "./ui";

const PROVENANCE_STYLE: Record<Provenance, string> = {
  ubs_synthetic: "bg-accent/12 text-accent",
  derived: "bg-surface-2 text-ink-2",
  doppel_default: "bg-warn/12 text-warn",
};
const PROVENANCE_KEY: Record<Provenance, MessageKey> = {
  ubs_synthetic: "ubs.prov.ubs_synthetic",
  derived: "ubs.prov.derived",
  doppel_default: "ubs.prov.doppel_default",
};

export function ProvenanceBadge({ value }: { value: Provenance }) {
  const { t } = useI18n();
  return (
    <span data-provenance={value} className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${PROVENANCE_STYLE[value]}`}>
      {t(PROVENANCE_KEY[value])}
    </span>
  );
}

/** Month 0 of a dataset profile as a Date (UTC midnight), for month → calendar labels. */
export const startDate = (p: Pick<Profile, "asOf">): Date | undefined => (p.asOf ? new Date(p.asOf + "T00:00:00Z") : undefined);

/**
 * One line under the hero for profiles loaded from the UBS starter data: what it is, the snapshot date, and a
 * disclosure that lists every input with its source (UBS data, derived with Swiss rules, Doppel default).
 */
export function UbsSourceNote({ profile }: { profile: Profile }) {
  const { t, tm, fmt } = useI18n();
  const rows = useMemo(() => provenanceRows(profile), [profile]);
  if (!profile.origin) return null;
  const start = startDate(profile);
  return (
    <div className="mt-4 text-xs text-ink-2" data-testid="ubs-source">
      <p>
        {t("ubs.sourceLine", { id: profile.origin.id, date: start ? fmt.ym(start.getUTCFullYear() * 100 + start.getUTCMonth() + 1) : "" })}
      </p>
      <Disclosure summary={t("ubs.sourceTitle")} className="mt-1.5">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(["ubs_synthetic", "derived", "doppel_default"] as const).map((p) => (
            <span key={p} className="flex items-center gap-1.5">
              <ProvenanceBadge value={p} />
              <span>{t(`ubs.provHint.${p}` as MessageKey)}</span>
            </span>
          ))}
        </div>
        <ul className="mt-3 max-w-3xl divide-y divide-line">
          {rows.map((r) => (
            <li key={r.field} className="py-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="font-medium text-ink">{t(`ubs.field.${r.field}` as MessageKey)}</span>
                <span className="flex items-center gap-2">
                  <span className="num text-ink">
                    {"chf" in r.value ? fmt.chf(r.value.chf) : "pct" in r.value ? fmt.pct(r.value.pct) : tm(r.value.text)}
                  </span>
                  <ProvenanceBadge value={r.provenance} />
                </span>
              </div>
              <div className="mt-0.5">{tm(r.note)}</div>
            </li>
          ))}
        </ul>
        <p className="mt-2">{t("ubs.sourceFooter")}</p>
      </Disclosure>
    </div>
  );
}

/** Loans in the starter data: balance, payment, payoff date, and an extra-payment stepper (the solver's debt lever). */
export function DebtCard({
  liabilities,
  extra,
  onExtra,
  start,
  disabled,
}: {
  liabilities: Liability[];
  extra: number;
  onExtra: (value: number) => void;
  start?: Date;
  disabled?: boolean;
}) {
  const { t, tm, fmt, rich, mounted } = useI18n();
  const base = useMemo(() => debtSchedule(liabilities, 1200, 0), [liabilities]);
  const withExtra = useMemo(() => (extra > 0 ? debtSchedule(liabilities, 1200, extra) : base), [liabilities, extra, base]);
  const total = base.opening;
  const service = base.service[0] ?? 0;
  const when = (n: number | null) => (n === null ? "" : mounted || start ? fmt.monthYear(n - 1, start) : "");
  const saved = base.interestPaid - withExtra.interestPaid;
  const anyDerived = liabilities.some((l) => l.paymentDerived);
  const STEP = 100;
  return (
    <section className="card p-5 sm:p-6" data-testid="debt-card">
      <CardHeader
        title={t("ubs.debtTitle")}
        aside={<span className="num rounded-full bg-bad/12 px-2.5 py-0.5 text-xs font-semibold text-bad">{fmt.chf(total)}</span>}
      />
      <p className="text-sm text-ink-2">
        {rich("ubs.debtLine", {
          payment: <b className="num text-ink">{fmt.chf(service)}</b>,
          months: <b className="num text-ink">{withExtra.debtFreeMonth ?? "–"}</b>,
          when: when(withExtra.debtFreeMonth),
        })}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-ink-2">{t("ubs.debtExtra")}</span>
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-line px-1">
          <button
            type="button"
            className="rounded-full px-1.5 py-0.5 text-ink-2 hover:text-ink disabled:opacity-40"
            disabled={disabled || extra <= 0}
            onClick={() => onExtra(Math.max(0, extra - STEP))}
            aria-label={t("ubs.debtLess")}
            title={t("ubs.debtLess")}
          >
            −
          </button>
          <span className="num font-medium whitespace-nowrap" data-testid="debt-extra">{t("common.perMonth", { amount: fmt.chf(extra) })}</span>
          <button
            type="button"
            className="rounded-full px-1.5 py-0.5 text-ink-2 hover:text-ink disabled:opacity-40"
            disabled={disabled || extra >= 2000 || withExtra.debtFreeMonth === 1}
            onClick={() => onExtra(extra + STEP)}
            aria-label={t("ubs.debtMore")}
            title={t("ubs.debtMore")}
          >
            +
          </button>
        </div>
      </div>
      {extra > 0 && saved > 0 && (
        <p className="mt-2 rounded-lg bg-good/10 px-3 py-2 text-xs text-ink">
          {t("ubs.debtSaved", { saved, months: (base.debtFreeMonth ?? 0) - (withExtra.debtFreeMonth ?? 0) })}
        </p>
      )}
      <Disclosure summary={t("common.details")} className="mt-4">
        <ul className="divide-y divide-line text-xs">
          {liabilities.map((l) => (
            <li key={l.id} className="py-2 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 font-medium">
                <span>{t("ubs.loanLine", { label: tm(l.label), rate: l.annualRate })}</span>
                <span className="num">{fmt.chf(l.principal)}</span>
              </div>
              <div className="mt-0.5 text-ink-2">
                {t("ubs.loanPayment", { amount: Math.round(l.monthlyPayment) })}
                {l.paymentDerived ? <> · {t("ubs.loanDerived", { months: l.termMonths ?? DEFAULT_LOAN_TERM_MONTHS })}</> : null}
              </div>
            </li>
          ))}
        </ul>
        <dl className="num mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-line pt-3 text-xs">
          <dt className="text-ink-2">{t("ubs.debtInterest")}</dt>
          <dd className="text-right">{fmt.chf(withExtra.interestPaid)}</dd>
        </dl>
        <p className="mt-3 text-xs text-ink-2">
          {t("ubs.debtFootnote")} {anyDerived ? t("ubs.debtDerivedNote", { months: DEFAULT_LOAN_TERM_MONTHS }) : null}
        </p>
      </Disclosure>
    </section>
  );
}

const PRIORITY_KEY: Record<ProfileGoal["priority"], MessageKey> = {
  high: "ubs.priority.high",
  medium: "ubs.priority.medium",
  low: "ubs.priority.low",
};
const METRIC_KEY: Record<NonNullable<ProfileGoal["metric"]>, MessageKey> = {
  netWorth: "ubs.metric.netWorth",
  cash: "ubs.metric.cash",
  liquid: "ubs.metric.liquid",
  deposit: "ubs.metric.deposit",
};

/** Every goal of the profile with its odds from the same simulated futures as the headline. */
export function GoalsCard({ goals, stats, fresh }: { goals: ProfileGoal[]; stats?: GoalStats[]; fresh: boolean }) {
  const { t, tm, fmt } = useI18n();
  const byId = new Map(stats?.map((s) => [s.id, s]) ?? []);
  return (
    <section className="card p-5 sm:p-6" data-testid="goals-card">
      <CardHeader title={t("ubs.goalsTitle")} />
      <ul className="divide-y divide-line">
        {goals.map((g) => {
          const s = byId.get(g.id);
          const color = !s ? "text-ink-3" : s.prob >= 0.8 ? "text-good" : s.prob >= 0.5 ? "text-warn" : "text-bad";
          return (
            <li key={g.id} className="py-2.5 first:pt-0" data-goal={g.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium break-words">{tm(g.label)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5">{t(PRIORITY_KEY[g.priority])}</span>
                    {g.primary && <span className="rounded-full bg-ink px-2 py-0.5 text-bg">{t("ubs.headline")}</span>}
                    <span>{t(METRIC_KEY[g.metric ?? "netWorth"])}</span>
                  </div>
                </div>
                <div className={`num shrink-0 text-right text-lg font-semibold ${color} ${fresh ? "" : "opacity-60"}`}>
                  {s ? fmt.pct(s.prob) : "–"}
                </div>
              </div>
              {s && <div className="num mt-0.5 text-xs text-ink-2">{t("ubs.goalMedian", { amount: s.median })}</div>}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-2">{t("ubs.goalsFootnote")}</p>
    </section>
  );
}
