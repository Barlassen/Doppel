"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { compileLife, kitaDailyTariff, REQUIRED_INPUTS } from "@/lib/finance/life";
import { ASSUMPTIONS } from "@/lib/finance/monteCarlo";
import type { DecisionOutlook } from "@/lib/finance/outlook";
import { CAR, CHILD, EDUCATION, type Param } from "@/lib/finance/params";
import type { Decision, DecisionKind, LifeEvent, Profile } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey, Msg, Text } from "@/lib/i18n/types";
import type { LifeInputNeeded } from "@/lib/finance/life";
import { BOUNDS, DECISION_CARRIER, validateOps, type Op } from "@/lib/twin/actions";
import { eventLabel } from "@/lib/twin/intents/shared";
import { CANTON_CODES } from "./cantons";
import { decisionCost } from "./OutlookCard";
import { CardHeader, EVENT_ICON } from "./ui";

/** What the picker offers: the engine's seven decision kinds plus the events that need no payload. */
export const PICK_KINDS = ["child", "car", "home", "partner", "move", "education", "workload", "selfEmployed", "jobloss", "windfall", "purchase"] as const;
export type PickKind = (typeof PICK_KINDS)[number];

const KIND_ICON: Record<PickKind, string> = {
  child: "👶", car: "🚗", home: "🏠", partner: "💍", move: "📦", education: "🎓", workload: "⏱", selfEmployed: "🧰", jobloss: "💼", windfall: "💰", purchase: "🎯",
};
/** Icon of an event in the list and on the chart: by decision kind first, then by event type. */
export function eventIcon(e: Pick<LifeEvent, "type" | "decision">): string {
  if (e.decision?.kind === "car") return e.decision.mode === "ga" ? "🚆" : "🚗";
  return e.decision ? KIND_ICON[e.decision.kind] : EVENT_ICON[e.type];
}

/** Icon of an outlook marker (`OutlookMarker.kind`): the decision's own markers, then the plain event types. */
export function markerIcon(kind: string): string {
  if (/^(child|kita|uni|apprentice)/.test(kind)) return KIND_ICON.child;
  if (/^(car|lease)/.test(kind)) return KIND_ICON.car;
  if (kind.startsWith("ga")) return "🚆";
  if (kind === "partner" || kind === "marriage") return KIND_ICON.partner;
  if (kind.startsWith("move")) return KIND_ICON.move;
  if (kind.startsWith("edu")) return KIND_ICON.education;
  if (/^(workload|sabbatical)/.test(kind)) return KIND_ICON.workload;
  if (kind.startsWith("self")) return KIND_ICON.selfEmployed;
  if (kind === "debtFree") return "✅";
  const type = kind.replace(/End$/, "") as LifeEvent["type"];
  return EVENT_ICON[type] ?? "•";
}

/** The picker kind of an existing event, or null when the event can only be moved or removed. */
function pickKindOf(e: LifeEvent): PickKind | null {
  if (e.decision) return e.decision.kind;
  return e.type === "house" ? "home" : e.type === "jobloss" ? "jobloss" : e.type === "income" ? "windfall" : e.type === "expense" ? "purchase" : null;
}

type Unit = "chf" | "chfMonth" | "chfYear" | "chfDay" | "percent" | "km" | "months" | "days" | "years";
interface Field {
  id: string;
  kind: "number" | "select" | "check" | "text";
  label: MessageKey;
  unit?: Unit;
  /** Sourced default the engine uses when the field is left empty: shown as placeholder with its provenance. */
  def?: (ctx: { profile: Profile; values: Values }) => Param | { value: number; provenance: "derived"; source: string } | undefined;
  options?: readonly string[];
  optionLabel?: (value: string) => MessageKey;
  /** Shown only when this returns true. */
  when?: (values: Values) => boolean;
  /** Payload stores a share (0.2) while the form shows percent (20). */
  share?: boolean;
  /** Required by the form itself (events without a decision payload). */
  required?: boolean;
  bound?: readonly [number, number];
}
type Values = Record<string, string | boolean>;

const mode = (v: Values) => (typeof v.mode === "string" && v.mode ? v.mode : "owned");
const leaseDefault = (v: Values) => {
  const price = Number(v.price) > 0 ? Number(v.price) : CAR.price.value;
  return { value: Math.round((CAR.leaseBudgetShare.value * price) / (CAR.leaseTermYears.value * 12)), provenance: "derived" as const, source: CAR.leaseBudgetShare.source };
};

/** The few inputs that matter per kind. Everything else keeps the engine's sourced default. */
const FIELDS: Record<PickKind, Field[]> = {
  child: [
    { id: "ageYears", kind: "number", label: "ux.dec.f.childAge", unit: "years" },
    { id: "kitaDaysPerWeek", kind: "number", label: "ux.dec.f.kitaDays", unit: "days", def: () => CHILD.kitaDaysPerWeek },
    {
      id: "kitaDailyChf", kind: "number", label: "ux.dec.f.kitaDaily", unit: "chfDay",
      def: ({ profile }) => ({ value: kitaDailyTariff(profile.canton, profile.grossIncomeYear).value, provenance: "derived", source: CHILD.kitaDaily.source }),
    },
    { id: "tertiaryTrack", kind: "select", label: "ux.dec.f.track", options: ["auto", "university", "apprenticeship"], optionLabel: (v) => `ux.dec.track.${v}` as MessageKey },
  ],
  car: [
    { id: "mode", kind: "select", label: "ux.dec.f.carMode", options: ["owned", "leased", "ga"], optionLabel: (v) => `ux.dec.carMode.${v}` as MessageKey },
    { id: "price", kind: "number", label: "ux.dec.f.carPrice", unit: "chf", def: () => CAR.price, when: (v) => mode(v) !== "ga" },
    { id: "leaseMonthly", kind: "number", label: "ux.dec.f.lease", unit: "chfMonth", def: ({ values }) => leaseDefault(values), when: (v) => mode(v) === "leased" },
    { id: "annualKm", kind: "number", label: "ux.dec.f.km", unit: "km", def: () => CAR.annualKm, when: (v) => mode(v) !== "ga" },
    { id: "gaClass", kind: "select", label: "ux.dec.f.gaClass", options: ["2", "1"], optionLabel: (v) => `ux.dec.gaClass.c${v}` as MessageKey, when: (v) => mode(v) === "ga" },
    { id: "replacesMonthly", kind: "number", label: "ux.dec.f.replaces", unit: "chfMonth" },
  ],
  home: [{ id: "amount", kind: "number", label: "ux.dec.f.homePrice", unit: "chf", required: true, bound: BOUNDS.housePrice }],
  partner: [
    { id: "married", kind: "check", label: "ux.dec.f.married" },
    { id: "netIncomeMonth", kind: "number", label: "life.need.partnerIncome", unit: "chfMonth" },
    { id: "expensesMonth", kind: "number", label: "life.need.partnerExpenses", unit: "chfMonth" },
    { id: "rentMonth", kind: "number", label: "life.need.partnerRent", unit: "chfMonth" },
    { id: "taxDeltaYear", kind: "number", label: "life.need.marriageTax", unit: "chfYear", when: (v) => v.married === true },
  ],
  move: [
    { id: "city", kind: "text", label: "ux.dec.f.city" },
    { id: "canton", kind: "select", label: "ux.dec.f.canton", options: ["", ...CANTON_CODES] },
    { id: "rentMonth", kind: "number", label: "life.need.moveRent", unit: "chfMonth" },
    { id: "movingCost", kind: "number", label: "life.need.movingCost", unit: "chf" },
  ],
  education: [
    { id: "program", kind: "select", label: "ux.dec.f.program", options: ["master", "bachelor", "other"], optionLabel: (v) => `ux.dec.program.${v}` as MessageKey },
    { id: "tuitionYear", kind: "number", label: "life.need.eduTuition", unit: "chfYear", def: ({ values }) => (values.program === "other" ? undefined : EDUCATION.tuitionYear) },
    {
      id: "durationMonths", kind: "number", label: "life.need.eduDuration", unit: "months",
      def: ({ values }) => (values.program === "other" ? undefined : values.program === "bachelor" ? EDUCATION.bachelorMonths : EDUCATION.masterMonths),
    },
    { id: "workloadPct", kind: "number", label: "life.need.eduWorkload", unit: "percent" },
    { id: "raiseAfterYear", kind: "number", label: "life.need.eduRaise", unit: "chfYear" },
  ],
  workload: [
    { id: "percent", kind: "number", label: "ux.dec.f.workload", unit: "percent", required: true },
    { id: "durationMonths", kind: "number", label: "ux.dec.f.duration", unit: "months" },
  ],
  selfEmployed: [
    { id: "netIncomeMonth", kind: "number", label: "life.need.selfIncome", unit: "chfMonth" },
    { id: "incomeVolatility", kind: "number", label: "life.need.selfVolatility", unit: "percent", share: true },
    { id: "durationMonths", kind: "number", label: "ux.dec.f.duration", unit: "months" },
  ],
  jobloss: [{ id: "duration", kind: "number", label: "ux.dec.f.joblossMonths", unit: "months", required: true, bound: BOUNDS.duration }],
  windfall: [{ id: "amount", kind: "number", label: "ux.dec.f.amount", unit: "chf", required: true, bound: BOUNDS.oneOff }],
  purchase: [
    { id: "name", kind: "text", label: "ux.dec.f.name" },
    { id: "amount", kind: "number", label: "ux.dec.f.amount", unit: "chf", required: true, bound: BOUNDS.oneOff },
  ],
};

/** Months from the plan's start until a decision usually begins, per kind (a prefill, not an engine value). */
const DEFAULT_LEAD_MONTHS: Record<PickKind, number> = {
  child: 24, car: 12, home: 60, partner: 12, move: 12, education: 12, workload: 6, selfEmployed: 12, jobloss: 12, windfall: 12, purchase: 12,
};
const INITIAL: Partial<Record<PickKind, Values>> = { car: { mode: "owned" }, workload: { percent: "80" }, jobloss: { duration: "6" }, education: { program: "master" } };

interface Draft {
  kind: PickKind;
  /** yyyy-mm. */
  when: string;
  values: Values;
  /** Id of the event being edited. */
  editId?: string;
}

const DRAFT_ID = "draft";
const isDecisionKind = (k: PickKind): k is DecisionKind => k in DECISION_CARRIER;
const pad = (n: number) => String(n).padStart(2, "0");
const ymOf = (start: Date, month: number) => {
  const d = new Date(Date.UTC(start.getFullYear(), start.getMonth() + month, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const monthOf = (start: Date, when: string): number | null => {
  const m = /^(\d{4})-(\d{1,2})$/.exec(when.trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return (Number(m[1]) - start.getFullYear()) * 12 + (Number(m[2]) - 1 - start.getMonth());
};

/** The decision payload of a draft: only the fields the user filled in (empty = the engine's sourced default). */
function payloadOf(kind: DecisionKind, values: Values): Decision {
  const out: Record<string, unknown> = { kind };
  for (const f of FIELDS[kind]) {
    if (f.when && !f.when(values)) continue;
    const v = values[f.id];
    if (f.kind === "check") {
      if (v === true) out[f.id] = true;
    } else if (f.kind === "number") {
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) out[f.id] = f.share ? Number(v) / 100 : Number(v);
    } else if (typeof v === "string" && v.trim() !== "") {
      out[f.id] = f.id === "gaClass" ? Number(v) : v.trim();
    }
  }
  return out as unknown as Decision;
}

function labelOf(kind: PickKind, values: Values): { label: string; labelMsg?: Msg } {
  const text = (k: string) => (typeof values[k] === "string" ? (values[k] as string).trim() : "");
  switch (kind) {
    case "child": return eventLabel({ key: "event.baby" });
    case "car": return eventLabel({ key: mode(values) === "ga" ? "life.event.ga" : mode(values) === "leased" ? "life.event.carLease" : "life.event.car" });
    case "home": return eventLabel({ key: "event.home" });
    case "partner": return eventLabel({ key: values.married === true ? "life.event.marriage" : "life.event.partner" });
    case "move": {
      const place = text("city") || text("canton");
      return eventLabel(place ? { key: "life.event.moveTo", params: { place } } : { key: "life.event.move" });
    }
    case "education": return eventLabel({ key: values.program === "bachelor" ? "life.event.bachelor" : values.program === "other" ? "life.event.education" : "life.event.master" });
    case "workload": return eventLabel(Number(values.percent) === 0 ? { key: "life.event.sabbatical" } : { key: "life.event.workload", params: { percent: Number(values.percent) || 0 } });
    case "selfEmployed": return eventLabel({ key: "life.event.selfEmployed" });
    case "jobloss": return eventLabel({ key: "event.jobLoss" });
    case "windfall": return eventLabel({ key: "life.event.inheritance" });
    case "purchase": return text("name") ? { label: text("name").slice(0, 60) } : eventLabel({ key: "life.event.purchase" });
  }
}

/** The `add` op of a draft, or null while the date is missing. */
function opOf(draft: Draft, start: Date): Extract<Op, { op: "add" }> | null {
  const month = monthOf(start, draft.when);
  if (month === null) return null;
  const { kind, values } = draft;
  const label = labelOf(kind, values);
  const amount = Number(values.amount);
  if (isDecisionKind(kind)) return { op: "add", type: DECISION_CARRIER[kind], ...label, month, amount: 0, decision: payloadOf(kind, values) };
  if (kind === "home") return { op: "add", type: "house", ...label, month, amount };
  if (kind === "jobloss") return { op: "add", type: "jobloss", ...label, month, amount: 0, duration: Number(values.duration) };
  return { op: "add", type: kind === "windfall" ? "income" : "expense", ...label, month, amount };
}

/** A draft from an existing event (edit) or from an op that still needs inputs (what-if bar, confirmed statement fact). */
function draftFrom(source: { type: LifeEvent["type"]; month: number; amount: number; durationMonths?: number; duration?: number; decision?: Decision; label: string; labelMsg?: Msg }, start: Date, editId?: string): Draft | null {
  const kind: PickKind | null = source.decision
    ? source.decision.kind
    : source.type === "house" ? "home" : source.type === "jobloss" ? "jobloss" : source.type === "income" ? "windfall" : source.type === "expense" ? "purchase" : null;
  if (!kind) return null;
  const values: Values = {};
  if (source.decision) {
    for (const f of FIELDS[kind]) {
      const v = (source.decision as unknown as Record<string, unknown>)[f.id];
      if (v === undefined || v === null) continue;
      values[f.id] = f.kind === "check" ? v === true : f.share && typeof v === "number" ? String(Math.round(v * 1000) / 10) : String(v);
    }
  } else {
    if (source.amount) values.amount = String(source.amount);
    const duration = source.durationMonths ?? source.duration;
    if (duration) values.duration = String(duration);
    if (kind === "purchase" && !source.labelMsg) values.name = source.label;
  }
  return { kind, when: ymOf(start, Math.max(0, source.month)), values: { ...INITIAL[kind], ...values }, editId };
}

const field = "w-full min-w-0 rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink";
const pill = "rounded-full border border-line px-3 py-1.5 text-xs font-medium enabled:hover:border-ink-3 disabled:opacity-45";
const primary = "rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-bg disabled:opacity-45";
const iconBtn = "num grid min-h-7 min-w-7 place-items-center rounded-md px-1.5 text-[11px] text-ink-2 transition hover:bg-surface hover:text-ink";

/**
 * "Your decisions": every event of the plan with its first-year cost, and one "Add a decision" entry that opens a
 * picker of the kinds the engine models. Each kind has a short form; empty fields keep the engine's sourced default
 * (shown as placeholder with its provenance); inputs the engine cannot source are required before Apply.
 */
export function DecisionsCard({
  profile,
  events,
  start,
  outlooks,
  needs,
  seed,
  disabled,
  onApply,
  onShift,
  onRemove,
}: {
  profile: Profile;
  events: LifeEvent[];
  /** Month 0 of the plan on the calendar. */
  start: Date;
  /** Per-decision results of the outlook, for the cost next to each row. */
  outlooks?: readonly DecisionOutlook[];
  /** Inputs the applied decisions still lack. */
  needs?: readonly LifeInputNeeded[];
  /** An op to open in the form (a what-if or a confirmed statement fact that still needs inputs). */
  seed?: { token: number; op: Extract<Op, { op: "add" }> } | null;
  disabled?: boolean;
  onApply: (ops: Op[], label: Text) => void;
  onShift: (id: string, months: number) => void;
  onRemove: (id: string) => void;
}) {
  const { t, tm, fmt, mounted } = useI18n();
  const formId = useId();
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tried, setTried] = useState(false);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const sorted = useMemo(() => [...events].sort((a, b) => a.month - b.month), [events]);

  function open(next: Draft | null) {
    setDraft(next);
    setPicking(false);
    setTried(false);
  }
  function close() {
    open(null);
    requestAnimationFrame(() => addButton.current?.focus());
  }
  useEffect(() => {
    if (draft) heading.current?.focus();
  }, [draft?.kind, draft?.editId]); // eslint-disable-line react-hooks/exhaustive-deps -- focus once per opened form

  const seedToken = seed?.token;
  useEffect(() => {
    if (!seed) return;
    const next = draftFrom({ ...seed.op, durationMonths: seed.op.duration }, start);
    if (!next) return;
    open(next);
    root.current?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per hand-over
  }, [seedToken]);

  // The draft as the engine sees it: validation by the op bounds, missing inputs from the life model itself.
  const op = draft ? opOf(draft, start) : null;
  const validOp = op ? validateOps([op], events.filter((e) => e.id !== draft?.editId))[0] : undefined;
  const missing = useMemo(() => {
    if (!draft || !op || !op.decision) return [] as LifeInputNeeded[];
    const months = (ASSUMPTIONS.endAge - profile.age) * 12;
    const draftEvent: LifeEvent = { id: DRAFT_ID, type: op.type, label: op.label, month: Math.max(0, op.month), amount: 0, decision: op.decision };
    const others = events.filter((e) => e.id !== draft.editId);
    return compileLife(profile, [...others, draftEvent], months, Math.max(0, (profile.retirementAge - profile.age) * 12)).inputsNeeded.filter((n) => n.eventId === DRAFT_ID);
  }, [draft, op, events, profile]);
  const missingIds = new Set(missing.map((n) => n.field));
  const shown = draft ? FIELDS[draft.kind].filter((f) => !f.when || f.when(draft.values)) : [];
  const emptyRequired = draft ? shown.filter((f) => f.required && String(draft.values[f.id] ?? "").trim() === "") : [];
  const dateOk = draft ? (monthOf(start, draft.when) ?? -1) >= 0 : false;
  const ready = !!draft && dateOk && !!validOp && missing.length === 0 && emptyRequired.length === 0;

  function apply() {
    if (!draft || !op) return;
    if (!ready) {
      setTried(true);
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    onApply(draft.editId ? [{ op: "remove", id: draft.editId }, op] : [op], op.labelMsg ?? op.label);
    close();
  }

  const set = (id: string, value: string | boolean) => setDraft((d) => (d ? { ...d, values: { ...d.values, [id]: value } } : d));
  const unit = (u?: Unit) => (u ? t(`ux.dec.unit.${u}`) : "");

  const renderField = (f: Field): ReactNode => {
    if (!draft) return null;
    const id = `${formId}-${f.id}`;
    const value = draft.values[f.id];
    const text = typeof value === "string" ? value : "";
    const def = f.def?.({ profile, values: draft.values });
    // Required = the form needs it, or the engine has no sourced value for it (REQUIRED_INPUTS) and still lacks one.
    const sourced = isDecisionKind(draft.kind) && REQUIRED_INPUTS[draft.kind].includes(f.id);
    const required = !!f.required || (sourced && (missingIds.has(f.id) || text.trim() !== ""));
    const lacking = (f.required && text.trim() === "") || missingIds.has(f.id);
    const invalid = tried && lacking;
    if (f.kind === "check") {
      return (
        <label key={f.id} className="col-span-2 flex items-center gap-2 text-xs font-medium text-ink-2">
          <input type="checkbox" checked={value === true} onChange={(e) => set(f.id, e.currentTarget.checked)} className="accent-[var(--series-1)]" />
          {t(f.label)}
        </label>
      );
    }
    return (
      <label key={f.id} className={`min-w-0 text-xs font-medium text-ink-2 ${f.kind === "text" ? "col-span-2" : ""}`}>
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span>{t(f.label)}{f.unit ? ` (${unit(f.unit)})` : ""}</span>
          {required && <span className="text-[11px] font-semibold text-accent" data-required={f.id}>{t("ux.dec.required")}</span>}
        </span>
        {f.kind === "select" ? (
          <select id={id} className={`${field} mt-1 border-line`} value={text} onChange={(e) => set(f.id, e.currentTarget.value)}>
            {f.options!.map((o) => <option key={o} value={o}>{o === "" ? t("ux.dec.sameCanton") : f.optionLabel ? t(f.optionLabel(o)) : o}</option>)}
          </select>
        ) : (
          <input
            id={id}
            className={`${field} mt-1 ${invalid ? "border-bad" : "border-line"}`}
            type={f.kind === "number" ? "number" : "text"}
            inputMode={f.kind === "number" ? "decimal" : undefined}
            step="any"
            maxLength={f.kind === "text" ? 40 : undefined}
            value={text}
placeholder={def ? String(def.value) : undefined}
            aria-required={required || undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={def || invalid ? `${id}-hint` : undefined}
            onChange={(e) => set(f.id, e.currentTarget.value)}
          />
        )}
        {(def || invalid) && (
          <span id={`${id}-hint`} className={`mt-0.5 block text-[11px] font-normal ${invalid ? "text-bad" : "text-ink-2"}`} title={def?.source}>
            {invalid ? t("ux.dec.errRequired") : t("ux.dec.default", { value: Number.isInteger(def!.value) ? fmt.int(def!.value) : fmt.num(def!.value), provenance: t(`ubs.prov.${def!.provenance}` as MessageKey) })}
          </span>
        )}
      </label>
    );
  };

  return (
    <section ref={root} className="card scroll-mt-24 p-5 sm:p-6 lg:col-span-2" data-testid="decisions-card">
      <CardHeader
        title={t("ux.dec.title")}
        aside={
          <button ref={addButton} type="button" className={primary} disabled={disabled} aria-expanded={picking || !!draft} onClick={() => (draft ? close() : setPicking((v) => !v))} data-testid="add-decision">
            {t("ux.dec.add")}
          </button>
        }
      />

      {picking && (
        <div className="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6" role="group" aria-label={t("ux.dec.pickAria")} data-testid="decision-picker">
          {PICK_KINDS.map((k) => (
            <button key={k} type="button" data-kind={k}
              onClick={() => open({ kind: k, when: ymOf(start, DEFAULT_LEAD_MONTHS[k]), values: { ...INITIAL[k] } })}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-xs font-medium hover:border-ink-3">
              <span aria-hidden="true">{KIND_ICON[k]}</span>
              <span className="min-w-0 break-words">{t(`ux.dec.kind.${k}`)}</span>
            </button>
          ))}
        </div>
      )}

      {draft && (
        <form className="mb-4 space-y-3 rounded-xl border border-line bg-surface-2 p-3" noValidate data-testid="decision-form" data-kind={draft.kind}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}
          onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <h4 ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">
            <span aria-hidden="true">{KIND_ICON[draft.kind]} </span>{t(`ux.dec.kind.${draft.kind}`)}
          </h4>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <label className="min-w-0 text-xs font-medium text-ink-2">
              {t("ux.dec.when")}
              <input className={`${field} mt-1 ${tried && !dateOk ? "border-bad" : "border-line"}`} type="month" placeholder="2028-07" min={ymOf(start, 0)} value={draft.when}
                aria-invalid={(tried && !dateOk) || undefined} onChange={(e) => setDraft({ ...draft, when: e.currentTarget.value })} />
            </label>
            {shown.map(renderField)}
          </div>
          <div role="alert" className="text-xs text-bad">
            {tried && !dateOk && <p>{t("ux.dec.errDate")}</p>}
            {tried && dateOk && missing.length === 0 && emptyRequired.length === 0 && !validOp && <p>{t("ux.dec.errRange")}</p>}
            {tried && missing.length > 0 && <p data-testid="decision-missing">{t("ux.dec.errMissing", { fields: missing.map((n) => n.label) })}</p>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className={pill} onClick={close}>{t("data.cancel")}</button>
            <button type="submit" className={primary} disabled={disabled} data-testid="decision-apply">{t(draft.editId ? "data.save" : "ux.dec.apply")}</button>
          </div>
        </form>
      )}

      {sorted.length === 0 ? (
        !draft && !picking && <p className="text-sm text-ink-2">{t("ux.dec.empty")}</p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2" data-testid="decision-list">
          {sorted.map((e) => {
            const label = e.labelMsg ?? e.label;
            const result = outlooks?.find((d) => d.eventId === e.id);
            const cost = result ? decisionCost(result) : null;
            const lacking = needs?.filter((n) => n.eventId === e.id) ?? [];
            const editable = pickKindOf(e) !== null;
            const action = (name: string) => t("timeline.eventAction", { label, action: name });
            return (
              <li key={e.id} data-event={e.id} data-kind={e.decision?.kind ?? e.type} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <span aria-hidden="true">{eventIcon(e)}</span>
                <div className="min-w-0 flex-1 basis-40">
                  <div className="font-medium break-words">{tm(label)}</div>
                  <div className="num text-xs text-ink-2">
                    {mounted && t("timeline.when", { date: fmt.monthYear(e.month, start), age: profile.age + Math.floor(e.month / 12) })}
                    {/* A modelled decision shows what it costs per month; a one-off event shows its amount. */}
                    {e.decision && cost && Math.round(cost.amount) !== 0
                      ? <> · {t(cost.key, { amount: Math.abs(cost.amount) })}</>
                      : !e.decision && e.amount !== 0 && t(e.type === "child" ? "timeline.amountMonthly" : "timeline.amount", { amount: e.amount })}
                  </div>
                  {lacking.length > 0 && <div className="mt-0.5 text-xs text-warn" data-testid="decision-needs">{t("ux.dec.errMissing", { fields: lacking.map((n) => n.label) })}</div>}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {editable && (
                    <button type="button" className={iconBtn} title={action(t("ux.dec.edit"))} aria-label={action(t("ux.dec.edit"))} onClick={() => open(draftFrom(e, start, e.id))}>✎</button>
                  )}
                  <button type="button" className={iconBtn} title={action(t("timeline.earlier"))} aria-label={action(t("timeline.earlier"))} onClick={() => onShift(e.id, -6)}>{t("timeline.earlierShort")}</button>
                  <button type="button" className={iconBtn} title={action(t("timeline.later"))} aria-label={action(t("timeline.later"))} onClick={() => onShift(e.id, 6)}>{t("timeline.laterShort")}</button>
                  <button type="button" className={iconBtn} title={action(t("common.remove"))} aria-label={action(t("common.remove"))} onClick={() => onRemove(e.id)}>✕</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
