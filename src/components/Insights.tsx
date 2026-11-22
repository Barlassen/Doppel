"use client";

import { useMemo, type ReactNode } from "react";
import type { Profile } from "@/lib/finance/types";
import { dateCh, dayMonthCh } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { StatementSummary } from "@/lib/import";
import { spendingInsights } from "@/lib/twin/insights";
import { CardHeader, Disclosure } from "./ui";

const TOP_RECURRING = 5;
const TOP_CHANGES = 3;
const DAY_MS = 86_400_000;
const ymNumber = (ym: string) => Number(ym.replace("-", ""));
const dayOffset = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/**
 * Spending insights read from the bookings: what recurs, how the latest month differs from the usual, and what next
 * month looks like. Three small panels; the full lists, the noise rule and the arithmetic sit behind one disclosure.
 * Renders nothing for a profile without transactions.
 */
export function Insights(props: { profile: Profile; summary?: StatementSummary }) {
  const { profile, summary } = props;
  const { t, tm, fmt } = useI18n();
  const s = useMemo(() => spendingInsights(profile, summary), [profile, summary]);
  if (!s) return null;

  const { recurring, monthOverMonth: mom, forecast, runway } = s;
  const estimate = <Tag>{t("insights.estimate")}</Tag>;
  const observed = <Tag>{t("insights.observed")}</Tag>;
  const pctText = (p: number | null) => (p === null ? "" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${fmt.pct(Math.abs(p))}`);
  const changes = mom.changes.slice(0, TOP_CHANGES);
  const variableRange = t("insights.range", { low: fmt.chf(forecast.variable.min), high: fmt.chf(forecast.variable.max) });
  const resultRange = t("insights.range", { low: fmt.chfSigned(forecast.result.low), high: fmt.chfSigned(forecast.result.high) });

  return (
    <section className="card p-5 sm:p-6 lg:col-span-2" data-testid="insights-card" aria-label={t("insights.title")}>
      <CardHeader title={t("insights.title")} aside={<span className="text-[11px] text-ink-3">{t("insights.asOf", { date: dateCh(s.asOf) })}</span>} />

      <div className="grid gap-3 md:grid-cols-3">
        {/* Recurring */}
        <Panel title={t("insights.recurring")} testId="insights-recurring">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="num font-serif text-2xl leading-tight">{fmt.chf(recurring.yearlyTotal.value)}</span>
            <span className="text-xs text-ink-2">{t("insights.perYear")}</span>
            {estimate}
          </p>
          {recurring.items.length ? (
            <ul className="mt-2.5 space-y-1 text-[13px]">
              {recurring.items.slice(0, TOP_RECURRING).map((r) => (
                <li key={r.merchant} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-ink-2">{tm(r.label)}</span>
                  <span className="num shrink-0">{fmt.chf(r.yearlyCost)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-ink-2">{t("insights.noRecurring")}</p>
          )}
          {recurring.overlaps.length > 0 && (
            <p className="mt-2.5 flex flex-wrap gap-1.5">
              {recurring.overlaps.map((o) => (
                <span key={o.family} className="rounded-full border border-warn px-2 py-0.5 text-[11px] font-medium text-warn" data-testid="insights-overlap">
                  {tm(o.label)}
                </span>
              ))}
            </p>
          )}
        </Panel>

        {/* This month vs usual */}
        <Panel title={t("insights.vsUsual")} aside={mom.latest ? fmt.ym(ymNumber(mom.latest)) : undefined} testId="insights-changes">
          {!mom.latest ? (
            <p className="text-[13px] text-ink-2">{t("insights.tooShort")}</p>
          ) : changes.length ? (
            <ul className="space-y-2 text-[13px]">
              {changes.map((c) => {
                const up = c.delta > 0;
                return (
                  <li key={c.category} className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <Arrow up={up} />
                      <span className="sr-only">{t(up ? "insights.up" : "insights.down")}</span>
                      <span className="min-w-0 truncate first-letter:uppercase">{tm(c.label)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`num block font-medium ${up ? "text-bad" : "text-good"}`}>{fmt.chfSigned(c.delta)}</span>
                      <span className="num block text-[11px] text-ink-3">{pctText(c.pct) || t("insights.usual", { amount: c.usual })}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-2">{t("insights.noChange")}</p>
          )}
          {mom.latest && <p className="mt-2.5">{observed}</p>}
        </Panel>

        {/* Next month */}
        <Panel title={t("insights.nextMonth")} aside={fmt.ym(ymNumber(forecast.month))} testId="insights-forecast">
          <dl className="space-y-1 text-[13px]">
            <Row label={t("insights.income")} sub={tm(forecast.income.label)} value={fmt.chfSigned(forecast.income.value)} />
            <Row label={t("insights.fixed")} value={fmt.chfSigned(-forecast.fixed.value)} />
            <Row label={t("insights.variable")} sub={variableRange} value={fmt.chfSigned(-forecast.variable.value)} />
            <div className="flex items-start justify-between gap-2 border-t border-line pt-1.5">
              <dt className="min-w-0 font-medium">
                {t("insights.result")} {estimate}
              </dt>
              <dd className="shrink-0 text-right">
                <span className={`num block font-semibold ${forecast.result.value < 0 ? "text-bad" : "text-good"}`} data-testid="insights-result">
                  {fmt.chfSigned(forecast.result.value)}
                </span>
                <span className="num block text-[11px] text-ink-3">{resultRange}</span>
              </dd>
            </div>
          </dl>
          <div className="mt-3">
            <p className="text-[11px] text-ink-3">{t("insights.upcoming")}</p>
            {forecast.upcoming.length ? (
              <>
                <ol className="relative mt-1.5 h-4" aria-label={t("insights.upcoming")}>
                  <li aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-line" />
                  {forecast.upcoming.map((u) => {
                    const big = u.amount >= 500;
                    return (
                      <li
                        key={`${u.date}-${u.merchant}`}
                        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${big ? "h-3 w-3 bg-ink" : "h-2 w-2 bg-ink-3"}`}
                        style={{ left: `${(dayOffset(s.asOf, u.date) / forecast.upcomingDays) * 100}%` }}
                        title={`${dayMonthCh(u.date)} · ${tm(u.label)} · ${fmt.chf(u.amount)}`}
                      >
                        <span className="sr-only">{`${dayMonthCh(u.date)} ${tm(u.label)} ${fmt.chf(u.amount)}`}</span>
                      </li>
                    );
                  })}
                </ol>
                <p className="num mt-1 flex justify-between text-[11px] text-ink-3" aria-hidden>
                  <span>{dayMonthCh(s.asOf)}</span>
                  <span>{dayMonthCh(forecast.upcoming[forecast.upcoming.length - 1].date)}</span>
                </p>
              </>
            ) : (
              <p className="mt-1 text-[13px] text-ink-2">{t("insights.noUpcoming")}</p>
            )}
          </div>
        </Panel>
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]" data-testid="insights-runway">
        <span className="text-ink-2">{t("insights.runway")}</span>
        <span className="num font-medium">{t("insights.runwayMonths", { months: runway.months.value })}</span>
        {runway.belowZero && <span className="text-ink-2">{t("insights.belowZero", { when: ymNumber(runway.belowZero) })}</span>}
        {estimate}
      </p>

      <Disclosure summary={t("insights.details")} className="mt-3" testId="insights-details">
        <div className="space-y-5 text-[13px]">
          <Table
            caption={t("insights.allRecurring")}
            head={[t("insights.col.merchant"), t("insights.col.cadence"), t("insights.col.amount"), t("insights.col.perYear"), t("insights.col.next")]}
            rows={recurring.items.map((r) => [tm(r.label), tm(r.cadenceLabel), fmt.chf(r.amount), fmt.chf(r.yearlyCost), dayMonthCh(r.nextDate)])}
          />
          {recurring.overlaps.length > 0 && (
            <ul className="space-y-1 text-ink-2">
              {recurring.overlaps.map((o) => (
                <li key={o.family}>
                  <span className="text-ink">{tm(o.label)}</span> · {o.merchants.join(" · ")} · {t("insights.overlapSaving", { amount: o.yearlySaving })}
                </li>
              ))}
            </ul>
          )}
          {mom.latest && (
            <Table
              caption={`${t("insights.vsUsual")} · ${fmt.ym(ymNumber(mom.latest))}`}
              head={[t("insights.col.category"), t("insights.col.month"), t("insights.col.usual"), t("insights.col.change"), ""]}
              rows={mom.all.map((c) => [tm(c.label), fmt.chf(c.latest), fmt.chf(c.usual), fmt.chfSigned(c.delta), pctText(c.pct)])}
            />
          )}
          <Table
            caption={t("insights.byMonth")}
            head={[t("insights.col.month"), t("insights.col.amount"), ""]}
            rows={mom.months.map((m) => [fmt.ym(ymNumber(m.month)), fmt.chf(m.total), m.full ? "" : t("insights.partial")])}
          />
          {mom.largest.length > 0 && (
            <Table
              caption={t("insights.largest")}
              head={[t("insights.col.merchant"), t("insights.col.next"), t("insights.col.amount")]}
              hideHead
              rows={mom.largest.map((x) => [x.merchant, dayMonthCh(x.date), fmt.chf(x.amount)])}
            />
          )}
          {forecast.upcoming.length > 0 && (
            <Table
              caption={t("insights.upcoming")}
              head={[t("insights.col.merchant"), t("insights.col.next"), t("insights.col.amount")]}
              hideHead
              rows={forecast.upcoming.map((u) => [tm(u.label), dayMonthCh(u.date), fmt.chf(u.amount)])}
            />
          )}
          <ul className="space-y-1 text-xs text-ink-2">
            <li>{tm(mom.rule.label)}</li>
            <li>{t("insights.yearlyNote")}</li>
            <li>{t("insights.variableNote")}</li>
            <li>{tm(runway.label)}</li>
          </ul>
        </div>
      </Disclosure>
    </section>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-full border border-line px-1.5 py-px align-middle text-[10px] font-normal leading-4 text-ink-2">{children}</span>;
}

function Panel({ title, aside, children, testId }: { title: string; aside?: string; children: ReactNode; testId: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 p-3.5" data-testid={testId}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <h4 className="label">{title}</h4>
        {aside && <span className="num text-[11px] text-ink-3">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, sub, value }: { label: string; sub?: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="min-w-0 text-ink-2">
        {label}
        {sub && <span className="num block text-[11px] text-ink-3">{sub}</span>}
      </dt>
      <dd className="num shrink-0">{value}</dd>
    </div>
  );
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 10 10" className={`h-2.5 w-2.5 shrink-0 ${up ? "text-bad" : "text-good"}`} fill="currentColor">
      <path d={up ? "M5 1 9.5 9h-9z" : "M5 9 .5 1h9z"} />
    </svg>
  );
}

function Table({ caption, head, rows, hideHead }: { caption: string; head: string[]; rows: string[][]; hideHead?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="label mb-1.5 text-left">{caption}</caption>
        <thead className={hideHead ? "sr-only" : ""}>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className={`pb-1 text-[11px] font-medium text-ink-3 ${i ? "pl-3 text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-line">
              {row.map((cell, i) => (
                <td key={i} className={`py-1 ${i ? "num whitespace-nowrap pl-3 text-right" : "text-ink-2"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
