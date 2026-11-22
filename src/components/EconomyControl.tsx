"use client";

import { ECONOMIES, ECONOMY_IDS, economyTable, isEconomyId, type EconomyId, type EconomyScenario } from "@/lib/finance/economy";
import { PARAMS_AS_OF } from "@/lib/finance/params";
import { dateCh } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/types";
import { Disclosure } from "./ui";

/** The scenario id of a plan's economy (a custom scenario object has no picker entry and reads as the baseline). */
export const economyIdOf = (e: EconomyId | EconomyScenario | undefined): EconomyId => (isEconomyId(e) ? e : "baseline");

/** One decimal, or two when the value has them (1.25%). */
function percent(fmt: ReturnType<typeof useI18n>["fmt"], value: number): string {
  return fmt.pct(value, Math.abs(value * 100 - Math.round(value * 1000) / 10) < 1e-9 ? 1 : 2);
}

/** How a table value is printed, by the parameter's unit. */
function paramValue(fmt: ReturnType<typeof useI18n>["fmt"], value: number, unit: string): string {
  if (unit.startsWith("share")) return percent(fmt, value);
  if (unit.startsWith("CHF")) return fmt.chf(value);
  return fmt.num(value);
}

/** The picker in the hero's settings row: which economy the futures are drawn from. */
export function EconomySelect({ value, onChange, disabled }: { value: EconomyId; onChange: (id: EconomyId) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <label className="flex items-center gap-1.5 font-medium text-ink-2">
      {t("ux.econ.label")}
      <select
        data-testid="economy-select"
        className="min-h-7 rounded-full border border-line bg-surface px-2 text-xs font-medium text-ink"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value as EconomyId)}
      >
        {ECONOMY_IDS.map((id) => <option key={id} value={id}>{t(`economy.name.${id}`)}</option>)}
      </select>
    </label>
  );
}

/**
 * Under the settings row: one line on what the chosen economy changes (nothing for the baseline), and the dated,
 * sourced table of every baseline assumption and every value the scenario replaces, behind a disclosure.
 */
export function EconomyNote({ value }: { value: EconomyId }) {
  const { t, tm, fmt } = useI18n();
  const table = economyTable(value);
  return (
    <div className="mt-3 max-w-3xl text-xs text-ink-2" data-testid="economy-note">
      {value !== "baseline" && <p className="mb-1.5 text-ink" data-testid="economy-summary">{tm(ECONOMIES[value].summary)}</p>}
      <Disclosure summary={t("ux.econ.tableTitle", { date: dateCh(PARAMS_AS_OF) })} testId="economy-table">
        {table.phases.map((ph) => (
          <div key={ph.index} className="mb-3">
            <div className="label mb-1">{t("ux.econ.phase", { name: ph.label, from: ph.fromYear + 1, to: ph.fromYear + ph.years })}</div>
            <ul className="space-y-1">
              {ph.changes.map((c) => (
                <li key={c.field} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-ink">{t(`ux.econ.p.${c.field}` as MessageKey)}</span> · {c.source}
                  </span>
                  <span className="num shrink-0 text-ink">{t("common.arrow", { before: percent(fmt, c.baseline), after: percent(fmt, c.value) })}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="label mb-1">{t("economy.name.baseline")}</div>
        <ul className="space-y-1">
          {table.baseline.map((row) => (
            <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
              <span className="min-w-0 break-words">
                <span className="font-medium text-ink">{t(`ux.econ.p.${row.id}` as MessageKey)}</span> · {row.source} ({row.year})
              </span>
              <span className="num shrink-0 text-ink">{paramValue(fmt, row.value, row.unit)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2">{t("ux.econ.tableNote")}</p>
      </Disclosure>
    </div>
  );
}
