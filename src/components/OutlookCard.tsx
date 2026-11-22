"use client";

import type { BudgetItem, DecisionOutlook, Outlook } from "@/lib/finance/outlook";
import { dateCh } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/types";
import { CardHeader, Disclosure, oddsTone } from "./ui";

/** Lines of a decision that start within this many months of it are shown on the card; later ones are in the details. */
const EARLY_LINE_MONTHS = 12;

/**
 * "What happens next": the engine's outlook for the current plan. Four figures first (goal odds, monthly surplus,
 * lowest cash point, cash-crunch risk), each as before → after once the plan differs from the account's own; then
 * what each new decision costs per month, line by line. Horizons, the full budget and every parameter with its
 * source sit behind one disclosure.
 */
export function OutlookCard({ outlook, loading, start }: { outlook: Outlook | null; loading: boolean; start?: Date }) {
  const { t, tm, fmt, mounted } = useI18n();
  if (!outlook) {
    return (
      <section className="card p-5 sm:p-6 lg:col-span-2" data-testid="outlook-card">
        <CardHeader title={t("ux.out.title")} />
        <p className="pulse-soft text-sm text-ink-2">{t("ux.out.loading")}</p>
      </section>
    );
  }
  const o = outlook;
  const compared = o.goal.baselineProb !== undefined;
  const arrow = (before: string | undefined, after: string) => (compared && before !== undefined && before !== after ? t("common.arrow", { before, after }) : after);
  const when = (month: number) => (mounted || start ? fmt.monthYear(month, start) : "");
  const fresh = o.decisions.filter((d) => d.isNew);
  const low = o.cashLow.median;
  const signed = (item: Pick<BudgetItem, "flow">, amount: number) => (item.flow === "income" ? amount : -amount);

  return (
    <section className={`card p-5 sm:p-6 lg:col-span-2 ${loading ? "opacity-60" : ""}`} data-testid="outlook-card" aria-busy={loading}>
      <CardHeader
        title={t("ux.out.title")}
        aside={<span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-2" data-testid="outlook-economy">{t("ux.econ.chip", { name: o.economy.label })}</span>}
      />

      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        <Figure label={tm(o.goal.label)} tone={oddsTone(o.goal.prob)} testId="outlook-goal"
          value={arrow(o.goal.baselineProb !== undefined ? fmt.pct(o.goal.baselineProb) : undefined, fmt.pct(o.goal.prob))} sub={t("ux.out.goalSub")} />
        <Figure label={t("ux.out.surplus")} tone={o.budget.after.surplus < 0 ? "text-bad" : ""} testId="outlook-surplus"
          value={arrow(fmt.chf(o.budget.now.surplus), fmt.chf(o.budget.after.surplus))}
          sub={compared && fresh.length ? t("ux.out.from", { when: when(o.budget.after.month) }) : t("ux.out.perMonth")} />
        <Figure label={t("ux.out.cashLow")} tone={low.amount < 0 ? "text-bad" : ""} testId="outlook-cashlow"
          value={fmt.chf(low.amount)} sub={t("ux.out.cashLowAt", { when: when(low.month), age: low.age })} />
        <Figure label={t("ux.out.crunch")} tone={o.crunch.beforeGoal > 0.05 ? "text-bad" : ""} testId="outlook-crunch"
          value={arrow(o.crunch.baselineBeforeGoal !== undefined ? fmt.pct(o.crunch.baselineBeforeGoal) : undefined, fmt.pct(o.crunch.beforeGoal))} sub={t("ux.out.crunchSub")} />
      </dl>

      {o.inputsNeeded.length > 0 && (
        <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-ink" data-testid="outlook-needs">
          {t("ux.out.needs", { fields: [...new Set(o.inputsNeeded.map((n) => tm(n.label)))] })}
        </p>
      )}

      {fresh.length > 0 && (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2" data-testid="outlook-decisions">
          {fresh.map((d) => (
            <DecisionCost key={d.eventId} decision={d} when={when} />
          ))}
        </ul>
      )}

      <Disclosure summary={t("common.details")} className="mt-4" testId="outlook-details">
        <div className="space-y-4 text-xs">
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[17rem] text-left">
              <caption className="label mb-1 text-left">{t("ux.out.netWorth")}</caption>
              <thead className="text-[11px] text-ink-2">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium" />
                  {compared && <th scope="col" className="py-1 pr-2 text-right font-medium">{t("ux.out.before")}</th>}
                  <th scope="col" className="py-1 pr-2 text-right font-medium">{t(compared ? "ux.out.after" : "ux.out.median")}</th>
                  <th scope="col" className="py-1 text-right font-medium">{t("ux.out.range")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {o.netWorth.map((n) => (
                  <tr key={n.key} data-horizon={n.key}>
                    <th scope="row" className="py-1 pr-2 font-sans font-normal text-ink-2">{tm(n.label)} <span className="whitespace-nowrap">({n.age})</span></th>
                    {compared && <td className="py-1 pr-2 text-right">{n.baseline ? fmt.chfShort(n.baseline.p50) : "–"}</td>}
                    <td className="py-1 pr-2 text-right font-medium">{fmt.chfShort(n.p50)}</td>
                    <td className="py-1 text-right text-ink-2">{fmt.chfShort(n.p10)}–{fmt.chfShort(n.p90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="label mb-1">{t("ux.out.budget", { when: when(o.budget.after.month) })}</div>
            <ul className="num space-y-0.5">
              {o.budget.after.items.filter((i) => !i.info).map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="min-w-0 font-sans break-words text-ink-2">{tm(i.label)}</span>
                  <span className="shrink-0">{fmt.chfSigned(signed(i, i.amount))}</span>
                </li>
              ))}
              <li className="flex justify-between gap-2 border-t border-line pt-1 font-medium">
                <span className="font-sans">{t("ux.out.surplus")}</span>
                <span>{fmt.chfSigned(o.budget.after.surplus)}</span>
              </li>
            </ul>
          </div>

          {fresh.some((d) => d.lines.some((l) => (l.phases[0]?.fromMonth ?? 0) - d.month > EARLY_LINE_MONTHS)) && (
            <div>
              <div className="label mb-1">{t("ux.out.later")}</div>
              <ul className="num space-y-0.5">
                {fresh.flatMap((d) => d.lines.filter((l) => !l.info && (l.phases[0]?.fromMonth ?? 0) - d.month > EARLY_LINE_MONTHS).map((l) => (
                  <li key={`${d.eventId}-${l.id}`} className="flex justify-between gap-2">
                    <span className="min-w-0 font-sans break-words text-ink-2">{tm(l.label)} · {when(l.phases[0].fromMonth)}</span>
                    <span className="shrink-0">{t("common.perMonth", { amount: fmt.chfSigned(signed(l, l.phases[0].monthly)) })}</span>
                  </li>
                )))}
              </ul>
            </div>
          )}

          {o.retirement && (
            <p className="text-ink-2">
              {t("ux.out.retire", { age: o.retirement.age, income: o.retirement.incomeFromAhvAge, spending: o.retirement.spendingMonthly, lasts: o.retirement.lastsTo90Prob })}
            </p>
          )}

          {o.params.length > 0 && (
            <div>
              <div className="label mb-1">{t("ux.out.params")}</div>
              <ul className="space-y-1">
                {o.params.map((p, i) => (
                  <li key={`${p.eventId}-${p.id}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="min-w-0 break-words text-ink-2">
                      <span className="text-ink">{p.id}</span>{p.source ? ` · ${p.source}` : ""}{p.asOf ? ` · ${t("ux.econ.asOf", { date: dateCh(p.asOf) })}` : ""}
                    </span>
                    <span className="num shrink-0">
                      {fmt.num(p.value)} {p.unit} · {t((p.provenance === "user" ? "ux.out.yours" : `ubs.prov.${p.provenance}`) as MessageKey)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Disclosure>
    </section>
  );
}

function Figure({ label, value, sub, tone = "", testId }: { label: string; value: string; sub: string; tone?: string; testId: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3" data-testid={testId}>
      <dt className="text-[11px] font-medium break-words text-ink-2">{label}</dt>
      <dd className={`num mt-0.5 text-base font-semibold sm:text-lg ${tone}`}>{value}</dd>
      <dd className="num text-[11px] text-ink-2">{sub}</dd>
    </div>
  );
}

/** One new decision: its net cost per month in the first year, then its own cost and income lines and one-off payments. */
function DecisionCost({ decision: d, when }: { decision: DecisionOutlook; when: (month: number) => string }) {
  const { t, tm, fmt } = useI18n();
  const early = d.lines.filter((l) => !l.info && l.phases.length > 0 && l.phases[0].fromMonth - d.month <= EARLY_LINE_MONTHS);
  const net = d.netMonthly.year1;
  return (
    <li className="rounded-xl border border-line p-3 text-xs" data-decision={d.eventId} data-kind={d.kind}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium break-words">{tm(d.label)}</span>
        <span className={`num font-semibold ${net > 0 ? "text-bad" : net < 0 ? "text-good" : ""}`} data-testid="decision-net">
          {t(net >= 0 ? "ux.dec.costs" : "ux.dec.saves", { amount: Math.abs(net) })}
        </span>
      </div>
      <ul className="num mt-1.5 space-y-0.5" data-testid="decision-lines">
        {early.map((l) => (
          <li key={l.id} className="flex justify-between gap-2">
            <span className="min-w-0 font-sans break-words text-ink-2">
              {tm(l.label)}
              {l.phases[0].fromMonth > d.month ? ` · ${when(l.phases[0].fromMonth)}` : ""}
              {l.prob !== undefined ? ` · ${fmt.pct(l.prob)}` : ""}
            </span>
            <span className="shrink-0">{t("common.perMonth", { amount: fmt.chfSigned(l.flow === "income" ? l.phases[0].monthly : -l.phases[0].monthly) })}</span>
          </li>
        ))}
        {d.oneOffs.filter((x) => !x.transfer).slice(0, 2).map((x, i) => (
          <li key={`one-${i}`} className="flex justify-between gap-2">
            <span className="min-w-0 font-sans break-words text-ink-2">{tm(x.label)} · {when(x.month)}</span>
            <span className="shrink-0">{fmt.chfSigned(x.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="num mt-1.5 text-[11px] text-ink-2">{t("ux.out.avg", { y5: d.netMonthly.years5, y10: d.netMonthly.years10 })}</p>
    </li>
  );
}
