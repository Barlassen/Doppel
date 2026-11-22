"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { openUbsProfile } from "@/lib/accounts";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { ALEXIA_ID, listUbsProfiles, type UbsProfileSummary } from "@/lib/ubs";
import { employmentMsg, householdMsg } from "@/lib/ubs/map";

const field = "w-full min-w-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink";
const PAGE = 25;

/** Folds case and accents so "zurich" finds "Zurich" and "meric" finds "Meriç". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * "Open a UBS profile…": search the 1'200 fictional profiles of the UBS starter data and open one as a read-only
 * base account. Loaded lazily (the search summary is not part of the main bundle). Alexia, the starter kit's
 * reference example, is always first.
 */
export default function UbsPicker({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (id: string) => void }) {
  const { t, tm, fmt } = useI18n();
  const all = useMemo(() => listUbsProfiles(), []);
  const [query, setQuery] = useState("");
  const [employment, setEmployment] = useState("");
  const [household, setHousehold] = useState("");
  const [debtOnly, setDebtOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const employments = useMemo(() => [...new Set(all.map((p) => p.employment))].sort(), [all]);
  const households = useMemo(() => [...new Set(all.map((p) => p.household))].sort(), [all]);

  const matches = useMemo(() => {
    const q = fold(query.trim());
    const ageQuery = /^\d{1,2}$/.test(q) ? Number(q) : null;
    return all.filter(
      (p) =>
        (!employment || p.employment === employment) &&
        (!household || p.household === household) &&
        (!debtOnly || p.debtChf > 0) &&
        (!q || (ageQuery !== null ? p.age === ageQuery : fold(`${p.name} ${p.city} ${p.canton} ${p.id}`).includes(q))),
    );
  }, [all, query, employment, household, debtOnly]);

  useEffect(() => setLimit(PAGE), [query, employment, household, debtOnly]);

  // Accessible dialog: focus the search, Escape closes, Tab stays inside, focus returns on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
      } else if (ev.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (prev?.isConnected) prev.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  async function pick(p: UbsProfileSummary) {
    setLoading(p.id);
    setError(false);
    try {
      const id = await openUbsProfile(p.id);
      onOpened(id);
    } catch {
      setError(true);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="ubs-picker"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface p-4 shadow-2xl outline-none sm:rounded-2xl sm:p-6"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="label">{t("ubs.pickerKicker")}</div>
            <h2 id={titleId} className="font-serif text-2xl leading-tight">{t("ubs.pickerTitle")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition hover:border-ink-3 hover:text-ink"
          >
            {t("common.close")}
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-2">{t("ubs.pickerIntro", { total: all.length })}</p>

        <div className="grid grid-cols-2 gap-2 text-xs font-medium text-ink-2">
          <label className="col-span-2 min-w-0">
            <span className="sr-only">{t("ubs.searchLabel")}</span>
            <input
              ref={searchRef}
              type="search"
              className={field}
              placeholder={t("ubs.searchPlaceholder")}
              aria-label={t("ubs.searchLabel")}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              data-testid="ubs-search"
            />
          </label>
          <label className="min-w-0">
            <span className="sr-only">{t("ubs.filterEmployment")}</span>
            <select className={`${field} text-xs`} value={employment} onChange={(e) => setEmployment(e.currentTarget.value)} aria-label={t("ubs.filterEmployment")}>
              <option value="">{t("ubs.allEmployment")}</option>
              {employments.map((e) => (
                <option key={e} value={e}>{tm(employmentMsg(e))}</option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className="sr-only">{t("ubs.filterHousehold")}</span>
            <select className={`${field} text-xs`} value={household} onChange={(e) => setHousehold(e.currentTarget.value)} aria-label={t("ubs.filterHousehold")}>
              <option value="">{t("ubs.allHouseholds")}</option>
              {households.map((h) => (
                <option key={h} value={h}>{tm(householdMsg(h))}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2 font-normal">
            <input type="checkbox" checked={debtOnly} onChange={(e) => setDebtOnly(e.currentTarget.checked)} />
            {t("ubs.filterDebt")}
          </label>
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3" aria-live="polite">
          <span>{t("ubs.results", { count: matches.length })}</span>
          {error && <span className="text-bad">{t("ubs.openError")}</span>}
        </div>

        <ul className="mt-1.5 -mx-1 min-h-0 flex-1 overflow-y-auto" data-testid="ubs-results">
          {matches.slice(0, limit).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={loading !== null}
                onClick={() => pick(p)}
                data-ubs-id={p.id}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.id === ALEXIA_ID && (
                      <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-semibold text-accent">{t("ubs.reference")}</span>
                    )}
                    <span className="num text-[10px] text-ink-3">{p.id}</span>
                  </span>
                  <span className="block truncate text-[11px] text-ink-2">
                    {t("ubs.rowMeta", { age: p.age, city: p.city, employment: tm(employmentMsg(p.employment)), household: tm(householdMsg(p.household)) })}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[11px]">
                  <span className="num block font-medium text-ink">{fmt.chf(p.netWorthChf)}</span>
                  {p.debtChf > 0 ? (
                    <span className="num block text-bad">{t("ubs.rowDebt", { amount: p.debtChf })}</span>
                  ) : (
                    <span className="block text-ink-3">{t("ubs.rowGoals", { count: p.goalCount })}</span>
                  )}
                </span>
                {loading === p.id && <span className="pulse-soft text-xs text-ink-3">…</span>}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-2 py-3 text-sm text-ink-2">{t("ubs.noResults")}</li>}
        </ul>
        {matches.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE)}
            className="mt-2 self-center rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
          >
            {t("ubs.showMore", { count: Math.min(PAGE, matches.length - limit) })}
          </button>
        )}
        <p className="mt-3 text-[11px] text-ink-3">{t("ubs.pickerFootnote")}</p>
      </div>
    </div>
  );
}
