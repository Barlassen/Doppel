"use client";

import { useMemo, useState } from "react";
import { merchantText } from "@/lib/data/merchants";
import type { Outlook } from "@/lib/finance/outlook";
import type { Profile } from "@/lib/finance/types";
import type { StatementSummary } from "@/lib/import";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/types";
import { flowAfter, moneyFlow, type FlowDecisionLine, type FlowGroup, type FlowRow, type FlowSegment } from "@/lib/twin/moneyFlow";
import { CardHeader } from "./ui";

const COLOR: Record<FlowSegment, string> = {
  housing: "var(--flow-housing)",
  fixed: "var(--flow-fixed)",
  everyday: "var(--flow-everyday)",
  invest: "var(--flow-invest)",
  left: "var(--flow-left)",
};
const SEGMENT_KEY: Record<FlowSegment, MessageKey> = {
  housing: "flow.segHousing",
  fixed: "flow.segFixed",
  everyday: "flow.segEveryday",
  invest: "flow.segInvest",
  left: "flow.segLeft",
};
const GROUPS: readonly FlowGroup[] = ["fixed", "variable", "saved"];
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_7rem_2.75rem]";

/** The decisions' own cost and income lines, once every new decision has started (from the engine's outlook). */
export function decisionLines(outlook: Outlook | null): FlowDecisionLine[] {
  if (!outlook || outlook.goal.baselineProb === undefined) return [];
  const fresh = new Set(outlook.decisions.filter((d) => d.isNew).map((d) => d.eventId));
  return outlook.budget.after.items
    .filter((i) => !i.info && i.eventId !== undefined && fresh.has(i.eventId) && i.amount !== 0)
    .map((i) => ({ id: `${i.eventId}-${i.id}`, label: i.label, monthly: i.flow === "income" ? i.amount : -i.amount }));
}

/**
 * "Where my money goes": take-home income as one stacked bar (housing, insurance and bills, everyday spending,
 * investing, what is left), then one row per category with amount, share of income and a thin bar. Month or year.
 * All figures come from `moneyFlow()`; nothing is computed here except the × 12 of the year view.
 */
export function MoneyFlow({ profile, summary, outlook }: { profile: Profile; summary?: StatementSummary; outlook: Outlook | null }) {
  const { t, tm, fmt } = useI18n();
  const [year, setYear] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const flow = useMemo(() => moneyFlow(profile, summary), [profile, summary]);
  const after = useMemo(() => flowAfter(flow, decisionLines(outlook)), [flow, outlook]);
  const k = year ? 12 : 1;
  const chf = (n: number) => fmt.chf(Math.round(n * k));
  const shortfall = Math.max(0, -flow.left);
  const whole = Math.max(flow.income, flow.spent + flow.invested, 1);
  const widest = Math.max(...flow.rows.map((r) => r.monthly), 1);
  const change = (before: string, next?: string) => (next !== undefined && next !== before ? t("common.arrow", { before, after: next }) : before);
  const rate = (r: number | null) => (r === null ? "–" : fmt.pct(r));

  return (
    <section className="card p-4 sm:p-6" data-testid="money-flow" aria-labelledby="flow-title">
      <CardHeader
        title={<span id="flow-title">{t("flow.title")}</span>}
        aside={
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] text-ink-2" data-testid="flow-basis">
              {flow.source === "profile" ? t("flow.fromProfile") : t(year ? "flow.basisYear" : "flow.basisMonth")}
            </span>
            <span className="flex rounded-full border border-line p-0.5 text-[11px]" role="group" aria-label={t("flow.period")}>
              {[false, true].map((y) => (
                <button key={String(y)} type="button" aria-pressed={year === y} onClick={() => setYear(y)} data-testid={y ? "flow-year" : "flow-month"}
                  className={`min-h-6 rounded-full px-2.5 py-0.5 font-medium ${year === y ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}>
                  {t(y ? "flow.year" : "flow.month")}
                </button>
              ))}
            </span>
          </div>
        }
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4" data-testid="flow-totals">
        <Total label={t("flow.income")} value={change(chf(flow.income), after && chf(after.income))} />
        <Total label={t("flow.spent")} value={change(chf(flow.spent), after && chf(after.spent))} />
        <Total label={t("flow.saved")} value={change(chf(flow.saved), after && chf(after.saved))} tone={(after ?? flow).saved < 0 ? "text-bad" : "text-good"} />
        <Total label={t("flow.rate")} value={change(rate(flow.savingRate), after && rate(after.savingRate))} tone={(after ?? flow).saved < 0 ? "text-bad" : ""} />
      </dl>

      <div
        className="mt-4 flex h-9 w-full overflow-hidden rounded-lg bg-surface-2"
        role="img"
        data-testid="flow-bar"
        aria-label={flow.segments.filter((s) => s.monthly > 0).map((s) => `${t(SEGMENT_KEY[s.id])} ${chf(s.monthly)}`).join(", ")}
      >
        {flow.segments.filter((s) => s.monthly > 0).map((s) => {
          const share = s.monthly / whole;
          return (
            <div key={s.id} className="flex h-full items-center justify-center overflow-hidden border-r border-surface last:border-r-0" style={{ width: `${share * 100}%`, background: COLOR[s.id] }}
              title={`${t(SEGMENT_KEY[s.id])} · ${chf(s.monthly)}`} data-segment={s.id}>
              {share >= 0.1 && <span className={`num text-[11px] font-semibold ${s.id === "left" ? "text-ink" : s.id === "housing" || s.id === "fixed" ? "text-surface" : "text-white"}`}>{fmt.pct(flow.income > 0 ? s.monthly / flow.income : share)}</span>}
            </div>
          );
        })}
      </div>
      {shortfall > 0 && (
        <div className="relative mt-1 h-1" aria-hidden="true">
          <div className="absolute right-0 h-1 rounded-full bg-bad" style={{ width: `${(shortfall / whole) * 100}%` }} />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {GROUPS.map((group) => {
          const rows = flow.rows.filter((r) => r.group === group);
          if (!rows.length) return null;
          const total = rows.reduce((a, r) => a + (r.shortfall ? -r.monthly : r.monthly), 0);
          return (
            <div key={group} data-flow-group={group}>
              <div className={`${ROW_GRID} border-b border-line pb-1`}>
                <h4 className="label">{t(`flow.${group}`)}</h4>
                <span className="hidden sm:block" />
                <span className="num text-right text-xs font-semibold">{chf(total)}</span>
                <span className="num text-right text-[11px] text-ink-2">{flow.income > 0 ? fmt.pct(total / flow.income) : ""}</span>
              </div>
              <ul>
                {rows.map((r) => (
                  <Row key={r.id} row={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} chf={chf} widest={widest} />
                ))}
              </ul>
            </div>
          );
        })}
        {after && (
          <div data-flow-group="decisions" data-testid="flow-decisions">
            <div className="border-b border-line pb-1"><h4 className="label">{t("flow.decisions")}</h4></div>
            <ul>
              {after.lines.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5 pr-[3.5rem] text-sm last:border-b-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2" style={{ borderColor: l.monthly < 0 ? "var(--bad)" : "var(--good)" }} aria-hidden="true" />
                    <span className="min-w-0 break-words">{tm(l.label)}</span>
                  </span>
                  <span className={`num shrink-0 text-right font-medium ${l.monthly < 0 ? "text-bad" : "text-good"}`}>{fmt.chfSigned(Math.round(l.monthly * k))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Total({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-ink-2">{label}</dt>
      <dd className={`num mt-0.5 text-lg leading-tight font-semibold break-words sm:text-xl ${tone}`}>{value}</dd>
    </div>
  );
}

function Row({ row, open, onToggle, chf, widest }: { row: FlowRow; open: boolean; onToggle: () => void; chf: (n: number) => string; widest: number }) {
  const { tm, fmt } = useI18n();
  const color = row.shortfall ? "var(--bad)" : COLOR[row.segment];
  const expandable = row.merchants.length > 0;
  const cells = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
        <span className="min-w-0 truncate first-letter:uppercase">{tm(row.label)}</span>
        {expandable && (
          <svg viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="order-last col-span-full mt-1 block h-1 overflow-hidden rounded-full bg-surface-2 sm:order-none sm:col-span-1 sm:mt-0 sm:h-1.5" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(1.5, (row.monthly / widest) * 100)}%`, background: color }} />
      </span>
      <span className={`num text-right font-medium ${row.shortfall ? "text-bad" : ""}`}>{row.shortfall ? chf(-row.monthly) : chf(row.monthly)}</span>
      <span className="num text-right text-[11px] text-ink-2">{fmt.pct(row.share)}</span>
    </>
  );
  return (
    <li className="border-b border-line/60 last:border-b-0" data-flow-row={row.id}>
      {expandable ? (
        <button type="button" onClick={onToggle} aria-expanded={open} className={`${ROW_GRID} w-full py-1.5 text-left text-sm hover:bg-surface-2/60`}>{cells}</button>
      ) : (
        <div className={`${ROW_GRID} py-1.5 text-sm`}>{cells}</div>
      )}
      {open && expandable && (
        <ul className="num mb-2 space-y-0.5 pl-[1.125rem] text-xs text-ink-2" data-testid="flow-merchants">
          {row.merchants.map((m) => (
            <li key={m.merchant} className="flex justify-between gap-3 pr-[3.5rem]">
              <span className="min-w-0 truncate font-sans">{tm(merchantText(m.merchant))}</span>
              <span className="shrink-0">{chf(m.monthly)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
