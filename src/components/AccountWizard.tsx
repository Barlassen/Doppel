"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { createAccount } from "@/lib/accounts";
import { takeHomeMonth } from "@/lib/data/profiles";
import { monthlySpend } from "@/lib/finance/investBehavior";
import { SOCIAL_DEDUCTIONS } from "@/lib/finance/pension";
import { RISK_PROFILES, type RiskProfile } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { msg, type Msg } from "@/lib/i18n/types";
import { readStatement } from "@/lib/import";
import { buildReview, finalizeReview } from "@/lib/import/review";

const CANTONS: readonly { code: string; city: string; tax: number }[] = [
  { code: "ZH", city: "Zürich", tax: 22 },
  { code: "BE", city: "Bern", tax: 26 },
  { code: "VD", city: "Lausanne", tax: 29 },
  { code: "GE", city: "Genève", tax: 30 },
  { code: "BS", city: "Basel", tax: 25 },
  { code: "BL", city: "Liestal", tax: 24 },
  { code: "LU", city: "Luzern", tax: 20 },
  { code: "SG", city: "St. Gallen", tax: 23 },
  { code: "AG", city: "Aarau", tax: 21 },
  { code: "ZG", city: "Zug", tax: 14 },
  { code: "TI", city: "Lugano", tax: 24 },
  { code: "FR", city: "Fribourg", tax: 26 },
  { code: "VS", city: "Sion", tax: 24 },
  { code: "NE", city: "Neuchâtel", tax: 28 },
  { code: "SO", city: "Solothurn", tax: 24 },
  { code: "TG", city: "Frauenfeld", tax: 21 },
  { code: "GR", city: "Chur", tax: 21 },
  { code: "SZ", city: "Schwyz", tax: 16 },
  { code: "SH", city: "Schaffhausen", tax: 22 },
  { code: "AR", city: "Herisau", tax: 21 },
  { code: "AI", city: "Appenzell", tax: 18 },
  { code: "GL", city: "Glarus", tax: 20 },
  { code: "NW", city: "Stans", tax: 16 },
  { code: "OW", city: "Sarnen", tax: 17 },
  { code: "UR", city: "Altdorf", tax: 19 },
  { code: "JU", city: "Delémont", tax: 28 },
];

const EQUITY_SHARE: Record<RiskProfile, number> = {
  conservative: 0.3,
  balanced: 0.5,
  growth: 0.8,
};

const TOTAL_STEPS = 7;
const STEP_NUMS = [1, 2, 3, 4, 5, 6, 7] as const;
type StepNum = (typeof STEP_NUMS)[number];

/** Accepted ranges, shown in the validation messages. */
const LIMITS = {
  age: [18, 74],
  gross: 10_000_000,
  net: 1_000_000,
  tax: [5, 50],
  rent: 200_000,
  expenses: 500_000,
  balance: 50_000_000,
  goal: [10_000, 50_000_000],
  goalAge: 90,
} as const;

/** The sample offered in the statement step (generated, fictional: see scripts/make-import-samples.ts). */
const SAMPLE_STATEMENT = { file: "meric-postfinance.camt053.xml", label: "PostFinance · camt.053" } as const;

const field = "w-full min-w-0 rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink";
const pill = "rounded-full border border-line px-3 py-1.5 text-xs font-medium enabled:hover:border-ink-3 disabled:opacity-45";
const primary = "rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-bg disabled:opacity-45";

function grossFromTakeHome(netMonth: number, marginalRate: number): number {
  const keepAfterTax = Math.max(0.45, 1 - marginalRate * 0.62);
  const annualAfterSocial = (netMonth * 12) / keepAfterTax;
  const gross = annualAfterSocial / (1 - SOCIAL_DEDUCTIONS);
  return Math.max(0, Math.round(gross / 100) * 100);
}

/** A statement file picked in the wizard: handed to the dashboard, which runs the normal import review on it. */
export interface WizardStatement {
  fileName: string;
  bytes: Uint8Array;
}

/** What the statement step read from the file, per month. `null` fields were not in the file. */
interface StatementFacts {
  fileName: string;
  transactions: number;
  trades: number;
  months: number;
  spending: number | null;
  rent: number | null;
  /** Average salary and other income paid in, per month. */
  income: number | null;
}

/**
 * Seven-step new-account wizard. The bank statement comes first among the data steps: what it shows (spending,
 * rent, salary payments) prefills the steps after it, and the file is reviewed on the dashboard once the account exists.
 *  1. name, age, canton/city
 *  2. bank statement (optional)
 *  3. income: gross or net
 *  4. rent & monthly spending
 *  5. balances: cash, portfolio, pillar 2, 3a
 *  6. risk profile
 *  7. goal: net-worth target at a given age, then create
 */
export function AccountWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (accountId: string, statement: WizardStatement | null) => void;
}) {
  const { t, tm, fmt } = useI18n();
  const titleId = useId();
  const fieldId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const stepHeadingRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const [step, setStep] = useState(0);
  /** Steps on which "Next" was pressed with invalid values: their messages stay visible. */
  const [attempted, setAttempted] = useState<ReadonlySet<number>>(new Set());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState("30");
  const [canton, setCanton] = useState("ZH");
  const [city, setCity] = useState("Zürich");
  const [cityTouched, setCityTouched] = useState(false);

  const [statement, setStatement] = useState<WizardStatement | null>(null);
  const [facts, setFacts] = useState<StatementFacts | null>(null);
  const [statementNote, setStatementNote] = useState<Msg | null>(null);
  const [statementError, setStatementError] = useState<Msg | null>(null);
  const [reading, setReading] = useState(false);

  const [incomeMode, setIncomeMode] = useState<"gross" | "net">("gross");
  const [grossInput, setGrossInput] = useState("85000");
  const [netInput, setNetInput] = useState("5400");
  const [taxRate, setTaxRate] = useState("22");
  const [taxTouched, setTaxTouched] = useState(false);

  const [rent, setRent] = useState("1650");
  const [expenses, setExpenses] = useState("3400");

  const [cash, setCash] = useState("15000");
  const [portfolio, setPortfolio] = useState("10000");
  const [pillar2, setPillar2] = useState("25000");
  const [pillar3a, setPillar3a] = useState("7000");

  const [riskProfile, setRiskProfile] = useState<RiskProfile>("balanced");
  const [goalTarget, setGoalTarget] = useState("500000");
  const [goalAge, setGoalAge] = useState("50");
  const [goalAgeTouched, setGoalAgeTouched] = useState(false);

  // Reset form state whenever the wizard opens.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setAttempted(new Set());
    setConfirmDiscard(false);
    setName("");
    setAge("30");
    setCanton("ZH");
    setCity("Zürich");
    setCityTouched(false);
    setStatement(null);
    setFacts(null);
    setStatementNote(null);
    setStatementError(null);
    setReading(false);
    setIncomeMode("gross");
    setGrossInput("85000");
    setNetInput("5400");
    setTaxRate("22");
    setTaxTouched(false);
    setRent("1650");
    setExpenses("3400");
    setCash("15000");
    setPortfolio("10000");
    setPillar2("25000");
    setPillar3a("7000");
    setRiskProfile("balanced");
    setGoalTarget("500000");
    setGoalAge("50");
    setGoalAgeTouched(false);
  }, [open]);

  // Closing throws the entries away, so it asks first once something was entered.
  const dirty = name.trim() !== "" || step > 0 || statement !== null;
  const dirtyRef = useRef(dirty);
  const confirmRef = useRef(confirmDiscard);
  useEffect(() => {
    dirtyRef.current = dirty;
    confirmRef.current = confirmDiscard;
  }, [dirty, confirmDiscard]);
  function requestClose() {
    if (dirtyRef.current && !confirmRef.current) setConfirmDiscard(true);
    else onClose();
  }
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });

  // Accessible dialog lifecycle: trap Tab, Escape closes (after a confirmation), restore focus on close.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const raf = requestAnimationFrame(() => {
      if (firstInputRef.current) firstInputRef.current.focus();
      else dialogRef.current?.focus();
    });

    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (confirmRef.current) setConfirmDiscard(false);
        else requestCloseRef.current();
        return;
      }
      if (ev.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]):not([type="file"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const inside = dialogRef.current.contains(document.activeElement);
        if (ev.shiftKey && (document.activeElement === first || !inside)) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && (document.activeElement === last || !inside)) {
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
      const prev = prevFocusRef.current;
      if (prev && prev.isConnected) prev.focus();
    };
  }, [open, onClose]);

  // A new step announces itself: focus moves to its heading ("Step 3 of 7 · Income").
  const firstStep = useRef(true);
  useEffect(() => {
    if (!open) {
      firstStep.current = true;
      return;
    }
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step, open]);

  if (!open) return null;

  const ageNum = Number(age);
  const taxPct = Number(taxRate);
  const marginalTaxRate = Number.isFinite(taxPct) ? Math.min(LIMITS.tax[1] / 100, Math.max(LIMITS.tax[0] / 100, taxPct / 100)) : 0.22;
  const grossVal = Number(grossInput);
  const netVal = Number(netInput);
  const computedGross =
    incomeMode === "gross"
      ? Number.isFinite(grossVal) && grossVal >= 0
        ? Math.round(grossVal)
        : 0
      : Number.isFinite(netVal) && netVal >= 0
        ? grossFromTakeHome(netVal, marginalTaxRate)
        : 0;
  const computedNet =
    incomeMode === "net"
      ? Number.isFinite(netVal) && netVal >= 0
        ? Math.round(netVal)
        : 0
      : takeHomeMonth(computedGross, marginalTaxRate);

  const rentNum = Number(rent);
  const expensesNum = Number(expenses);
  const cashNum = Number(cash);
  const portfolioNum = Number(portfolio);
  const pillar2Num = Number(pillar2);
  const pillar3aNum = Number(pillar3a);
  const targetNum = Number(goalTarget);
  const goalAgeNum = Number(goalAge);
  const minGoalAge = (Number.isInteger(ageNum) ? ageNum : LIMITS.age[0]) + 1;

  const nonNeg = (text: string, n: number, max: number) => text !== "" && Number.isFinite(n) && n >= 0 && n <= max;
  const amountError = (text: string, n: number, max: number): Msg | null => (nonNeg(text, n, max) ? null : msg("ux.wiz.errAmount", { max }));

  // One message per field; `null` = valid. A step is valid when all of its fields are.
  const errors = {
    name: name.trim() ? null : msg("ux.wiz.errName"),
    age: Number.isInteger(ageNum) && ageNum >= LIMITS.age[0] && ageNum <= LIMITS.age[1] ? null : msg("ux.wiz.errAge", { min: LIMITS.age[0], max: LIMITS.age[1] }),
    city: city.trim() ? null : msg("ux.wiz.errCity"),
    gross: incomeMode === "gross" ? amountError(grossInput, grossVal, LIMITS.gross) : null,
    net: incomeMode === "net" ? amountError(netInput, netVal, LIMITS.net) : null,
    tax: taxRate !== "" && Number.isFinite(taxPct) && taxPct >= LIMITS.tax[0] && taxPct <= LIMITS.tax[1] ? null : msg("ux.wiz.errTax", { min: LIMITS.tax[0], max: LIMITS.tax[1] }),
    rent: amountError(rent, rentNum, LIMITS.rent),
    expenses: amountError(expenses, expensesNum, LIMITS.expenses),
    cash: amountError(cash, cashNum, LIMITS.balance),
    portfolio: amountError(portfolio, portfolioNum, LIMITS.balance),
    pillar2: amountError(pillar2, pillar2Num, LIMITS.balance),
    pillar3a: amountError(pillar3a, pillar3aNum, LIMITS.balance),
    goalTarget: goalTarget !== "" && Number.isFinite(targetNum) && targetNum >= LIMITS.goal[0] && targetNum <= LIMITS.goal[1] ? null : msg("ux.wiz.errGoal", { min: LIMITS.goal[0], max: LIMITS.goal[1] }),
    goalAge: goalAge !== "" && Number.isInteger(goalAgeNum) && goalAgeNum >= minGoalAge && goalAgeNum <= LIMITS.goalAge ? null : msg("ux.wiz.errGoalAge", { min: minGoalAge, max: LIMITS.goalAge }),
  } satisfies Record<string, Msg | null>;
  type FieldName = keyof typeof errors;
  const STEP_FIELDS: readonly (readonly FieldName[])[] = [
    ["name", "age", "city"],
    [],
    ["gross", "net", "tax"],
    ["rent", "expenses"],
    ["cash", "portfolio", "pillar2", "pillar3a"],
    [],
    ["goalTarget", "goalAge"],
  ];
  const stepValid = (s: number) => STEP_FIELDS[s].every((f) => errors[f] === null);
  const allValid = STEP_NUMS.every((_, i) => stepValid(i));
  /** Shown after "Next" was pressed on the step, or as soon as a filled-in value is out of range. */
  const shown = (f: FieldName, value: string): Msg | null => (errors[f] && (attempted.has(step) || value.trim() !== "") ? errors[f] : null);

  const totalNetWorth = [cashNum, portfolioNum, pillar2Num, pillar3aNum].reduce((s, n) => s + (Number.isFinite(n) && n >= 0 ? n : 0), 0);

  function onCantonChange(nextCode: string) {
    setCanton(nextCode);
    const meta = CANTONS.find((c) => c.code === nextCode);
    if (!meta) return;
    if (!cityTouched) setCity(meta.city);
    if (!taxTouched) setTaxRate(String(meta.tax));
  }

  /** Reads the picked statement in the browser (0 tokens) and prefills the steps after this one from it. */
  function loadStatement(fileName: string, bytes: Uint8Array) {
    setStatementError(null);
    setStatementNote(null);
    setFacts(null);
    const result = readStatement(fileName, bytes);
    if (result.kind === "error") {
      setStatement(null);
      setStatementError(result.error);
      return;
    }
    setStatement({ fileName, bytes });
    if (result.kind === "mapping") {
      setStatementNote(msg("ux.wiz.stmtMapping", { file: fileName }));
      return;
    }
    const review = buildReview(result.parsed, { transactions: [], trades: [], refs: new Set() });
    const { transactions, trades } = finalizeReview(review);
    const spend = monthlySpend(transactions);
    const incomeRows = review.rows.filter((r) => r.kind === "income");
    const months = new Set(review.rows.map((r) => r.date.slice(0, 7))).size;
    const income = months && incomeRows.length ? incomeRows.reduce((sum, r) => sum - r.amount, 0) / months : null;
    setFacts({
      fileName,
      transactions: transactions.length,
      trades: trades.length,
      months: spend.months || months,
      spending: spend.months ? spend.average : null,
      rent: spend.months && spend.rent > 0 ? spend.rent : null,
      income,
    });
    if (spend.months) {
      setExpenses(String(Math.round(spend.average / 10) * 10));
      if (spend.rent > 0) setRent(String(Math.round(spend.rent)));
    }
    // What is paid in each month is taken as take-home pay (the engine's `netIncomeMonth`); the income step shows the
    // gross salary that follows from it and lets the user correct both.
    if (income && income > 0) {
      setIncomeMode("net");
      setNetInput(String(Math.round(income)));
    }
  }

  async function pickStatement(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReading(true);
    try {
      loadStatement(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch {
      setStatementError(msg("data.unreadable"));
    } finally {
      setReading(false);
    }
  }

  async function sampleStatement() {
    setReading(true);
    try {
      const res = await fetch(`/samples/imports/${SAMPLE_STATEMENT.file}`);
      if (!res.ok) throw new Error(String(res.status));
      loadStatement(SAMPLE_STATEMENT.file, new Uint8Array(await res.arrayBuffer()));
    } catch {
      setStatementError(msg("data.unreadable"));
    } finally {
      setReading(false);
    }
  }

  function finish() {
    if (!allValid) return;
    const finalExpenses = Math.max(Math.round(rentNum), Math.round(expensesNum));
    const finalTarget = Math.round(targetNum);
    const finalGoalAge = Math.round(goalAgeNum);
    const id = createAccount({
      name: name.trim().slice(0, 60),
      age: ageNum,
      city: city.trim().slice(0, 60),
      canton,
      grossIncomeYear: computedGross,
      netIncomeMonth: computedNet,
      marginalTaxRate,
      rentMonth: Math.round(rentNum),
      expensesMonth: finalExpenses,
      cash: Math.round(cashNum),
      portfolio: Math.round(portfolioNum),
      pillar2: Math.round(pillar2Num),
      pillar3a: Math.round(pillar3aNum),
      riskProfile,
      goal: {
        label:
          finalTarget >= 1_000_000
            ? { key: "profile.goal", params: { target: finalTarget, age: finalGoalAge } }
            : { key: "profile.goalK", params: { target: finalTarget, age: finalGoalAge } },
        target: finalTarget,
        age: finalGoalAge,
      },
    });
    onCreated(id, statement);
  }

  function submit() {
    if (!stepValid(step)) {
      setAttempted((prev) => new Set(prev).add(step));
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
      return;
    }
    if (allValid) finish();
    else {
      // An earlier step was skipped over with the pills: go back to the first one that needs attention.
      const bad = STEP_NUMS.findIndex((_, i) => !stepValid(i));
      setAttempted((prev) => new Set(prev).add(bad));
      setStep(bad);
    }
  }

  /** A labelled input with its validation message (linked with aria-describedby, announced when it appears). */
  const input = (
    f: FieldName,
    label: string,
    value: string,
    onChange: (v: string) => void,
    props: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> } = {},
    className = "block min-w-0",
  ): ReactNode => {
    const error = shown(f, value);
    const id = `${fieldId}-${f}`;
    return (
      <label className={className}>
        {label}
        <input
          {...props}
          id={id}
          className={`${field} mt-1 ${error ? "border-bad" : "border-line"}`}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
        {error && <span id={`${id}-error`} role="alert" className="mt-1 block text-[11px] font-normal text-bad">{tm(error)}</span>}
      </label>
    );
  };
  const amount = { type: "number", inputMode: "numeric", min: 0, step: "any" } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={requestClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 shadow-2xl outline-none sm:rounded-2xl sm:p-6"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 id={titleId} className="min-w-0 font-serif text-2xl leading-tight">
            {t("data.wizardTitle")}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label={t("data.wizardCloseAria")}
            className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition hover:border-ink-3 hover:text-ink"
          >
            {t("common.close")}
          </button>
        </div>

        {confirmDiscard && (
          <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs" data-testid="wizard-discard">
            <span>{t("ux.wiz.discardAsk")}</span>
            <span className="flex gap-2">
              <button type="button" className={pill} onClick={() => setConfirmDiscard(false)}>{t("ux.wiz.keep")}</button>
              <button type="button" className={`${pill} text-bad`} onClick={onClose}>{t("ux.wiz.discard")}</button>
            </span>
          </div>
        )}

        {/* Step pills (1..7), compact so 320px viewports never overflow */}
        <div className="mb-4 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("data.wizardStepsAria")}>
            {STEP_NUMS.map((n, idx) => {
              const active = step === idx;
              const reachable = idx <= step || STEP_NUMS.slice(0, idx).every((_, i) => stepValid(i));
              return (
                <button
                  key={n}
                  type="button"
                  disabled={!reachable}
                  aria-current={active ? "step" : undefined}
                  aria-label={`${n}. ${t(`data.wizardStep.s${n as StepNum}`)}`}
                  onClick={() => setStep(idx)}
                  className={`grid size-7 place-items-center rounded-full text-xs font-semibold transition ${
                    active
                      ? "bg-ink text-bg"
                      : reachable
                        ? "border border-line bg-surface-2 text-ink hover:border-ink-3"
                        : "border border-line text-ink-3 opacity-45"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div ref={stepHeadingRef} tabIndex={-1} className="text-xs font-medium text-ink-2 outline-none" data-testid="wizard-step">
            {t("data.wizardStepOf", { step: step + 1, total: TOTAL_STEPS })} ·{" "}
            <span className="text-ink">{t(`data.wizardStep.s${(step + 1) as StepNum}`)}</span>
          </div>
        </div>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="min-w-0 space-y-4"
        >
          {step === 0 && (
            <div className="grid grid-cols-2 gap-3 text-xs font-medium text-ink-2">
              {input("name", t("data.wizardName"), name, setName, { ref: firstInputRef, maxLength: 60, placeholder: t("data.wizardNamePlaceholder"), autoComplete: "off" }, "col-span-2 min-w-0")}
              {input("age", t("data.wizardAge"), age, (nextAge) => {
                setAge(nextAge);
                const n = Number(nextAge);
                if (!goalAgeTouched && Number.isInteger(n) && n >= LIMITS.age[0]) setGoalAge(String(Math.min(85, Math.max(50, n + 15))));
              }, { type: "number", inputMode: "numeric", min: LIMITS.age[0], max: LIMITS.age[1] }, "min-w-0")}
              <label className="min-w-0">
                {t("data.wizardCanton")}
                <select className={`${field} mt-1 border-line`} value={canton} onChange={(e) => onCantonChange(e.currentTarget.value)}>
                  {CANTONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.city}
                    </option>
                  ))}
                </select>
              </label>
              {input("city", t("data.wizardCity"), city, (v) => {
                setCityTouched(true);
                setCity(v);
              }, { maxLength: 60 }, "col-span-2 min-w-0")}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3 text-xs text-ink-2" data-testid="wizard-statement">
              <p className="text-sm">{t("ux.wiz.stmtIntro")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg disabled:opacity-45" disabled={reading} onClick={() => fileInput.current?.click()}>
                  {t(statement ? "ux.wiz.stmtChange" : "data.chooseFile")}
                </button>
                <button type="button" className={pill} disabled={reading} onClick={() => void sampleStatement()}>
                  {t("ux.wiz.stmtSample", { label: SAMPLE_STATEMENT.label })}
                </button>
              </div>
              <input ref={fileInput} type="file" accept=".csv,.txt,.xml,text/csv,application/xml,text/xml" className="hidden" aria-label={t("data.chooseFile")} onChange={pickStatement} />
              <p>{t("data.formats")}</p>
              <div role="status">
                {reading && <p>{t("data.reading")}</p>}
                {facts && (
                  <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-xl bg-surface-2 p-3" data-testid="wizard-facts">
                    <dt className="col-span-2 mb-1 font-sans font-semibold text-ink">
                      {t("ux.wiz.factsTitle", { file: facts.fileName, transactions: facts.transactions, months: facts.months })}
                    </dt>
                    {facts.income !== null && (<><dt>{t("ux.wiz.factIncome")}</dt><dd className="text-right text-ink">{t("common.perMonth", { amount: fmt.chf(facts.income) })}</dd></>)}
                    {facts.spending !== null && (<><dt>{t("ux.wiz.factSpending")}</dt><dd className="text-right text-ink">{t("common.perMonth", { amount: fmt.chf(facts.spending) })}</dd></>)}
                    {facts.rent !== null && (<><dt>{t("ux.wiz.factRent")}</dt><dd className="text-right text-ink">{t("common.perMonth", { amount: fmt.chf(facts.rent) })}</dd></>)}
                    {facts.trades > 0 && (<><dt>{t("ux.wiz.factTrades")}</dt><dd className="text-right text-ink">{fmt.int(facts.trades)}</dd></>)}
                    <dd className="col-span-2 mt-1 font-sans">{t("ux.wiz.factsNext")}</dd>
                  </dl>
                )}
                {statementNote && <p className="rounded-xl bg-surface-2 p-3">{tm(statementNote)}</p>}
              </div>
              {statementError && <p role="alert" className="text-bad">{tm(statementError)}</p>}
              {!statement && !reading && <p>{t("ux.wiz.stmtSkip")}</p>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3 text-xs font-medium text-ink-2">
              <fieldset className="min-w-0">
                <legend className="mb-1.5 text-xs font-medium text-ink-2">{t("data.wizardIncomeMode")}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["gross", "net"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={incomeMode === m}
                      onClick={() => {
                        if (m === incomeMode) return;
                        if (m === "net") setNetInput(String(computedNet));
                        else setGrossInput(String(computedGross));
                        setIncomeMode(m);
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        incomeMode === m ? "bg-ink text-bg" : "border border-line text-ink-2 hover:text-ink"
                      }`}
                    >
                      {t(m === "gross" ? "data.wizardIncomeGross" : "data.wizardIncomeNet")}
                    </button>
                  ))}
                </div>
              </fieldset>
              {incomeMode === "gross"
                ? input("gross", t("data.wizardGrossField"), grossInput, setGrossInput, { ...amount, max: LIMITS.gross })
                : input("net", t("data.wizardNetField"), netInput, setNetInput, { ...amount, max: LIMITS.net })}
              {input("tax", t("data.wizardTaxRate"), taxRate, (v) => {
                setTaxTouched(true);
                setTaxRate(v);
              }, { type: "number", inputMode: "decimal", min: LIMITS.tax[0], max: LIMITS.tax[1], step: "any" })}
              <p className="num rounded-lg bg-surface-2 px-3 py-2 text-xs font-normal text-ink-2">
                {t("data.wizardIncomeSummary", { gross: computedGross, net: computedNet })}
                {facts?.income != null && <> · {t("ux.wiz.fromStatement")}</>}
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-xs font-medium text-ink-2">
              {input("rent", t("data.wizardRent"), rent, setRent, { ...amount, max: LIMITS.rent })}
              {input("expenses", t("data.wizardExpenses"), expenses, setExpenses, { ...amount, max: LIMITS.expenses })}
              {errors.rent === null && errors.expenses === null && rentNum > expensesNum && (
                <p role="status" className="text-xs font-normal text-warn">{t("ux.wiz.rentAboveSpending", { amount: rentNum })}</p>
              )}
              {facts?.spending != null && <p className="text-xs font-normal text-ink-2">{t("ux.wiz.fromStatement")}</p>}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 text-xs font-medium text-ink-2">
              <div className="grid grid-cols-2 gap-2.5">
                {input("cash", t("data.wizardCash"), cash, setCash, { ...amount, max: LIMITS.balance }, "min-w-0")}
                {input("portfolio", t("data.wizardPortfolio"), portfolio, setPortfolio, { ...amount, max: LIMITS.balance }, "min-w-0")}
                {input("pillar2", t("data.wizardPillar2"), pillar2, setPillar2, { ...amount, max: LIMITS.balance }, "min-w-0")}
                {input("pillar3a", t("data.wizardPillar3a"), pillar3a, setPillar3a, { ...amount, max: LIMITS.balance }, "min-w-0")}
              </div>
              <p className="num rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-ink">
                {t("data.wizardNetWorth", { amount: totalNetWorth })}
              </p>
            </div>
          )}

          {step === 5 && (
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-xs text-ink-2">{t("data.wizardRiskIntro")}</legend>
              <div className="space-y-2">
                {RISK_PROFILES.map((r) => {
                  const selected = riskProfile === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setRiskProfile(r)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                        selected ? "border-ink bg-surface-2 font-semibold" : "border-line hover:border-ink-3"
                      }`}
                    >
                      <span>{t(`risk.${r}`)}</span>
                      <span className="num text-xs text-ink-2">{t("invest.equities", { share: EQUITY_SHARE[r] })}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {step === 6 && (
            <div className="space-y-3 text-xs font-medium text-ink-2">
              <div className="grid grid-cols-2 gap-3">
                {input("goalTarget", t("data.wizardGoalTarget"), goalTarget, setGoalTarget, { ...amount, min: LIMITS.goal[0], max: LIMITS.goal[1] }, "col-span-2 min-w-0 sm:col-span-1")}
                {input("goalAge", t("data.wizardGoalAge"), goalAge, (v) => {
                  setGoalAgeTouched(true);
                  setGoalAge(v);
                }, { type: "number", inputMode: "numeric", min: minGoalAge, max: LIMITS.goalAge }, "col-span-2 min-w-0 sm:col-span-1")}
              </div>
              {allValid && (
                <div className="rounded-xl bg-surface-2 p-3 font-normal" data-testid="wizard-summary">
                  <div className="font-semibold break-words text-ink">
                    {name.trim()} ({ageNum}) · {city.trim()} ({canton})
                  </div>
                  <div className="num mt-1">
                    {fmt.chf(totalNetWorth)} · {t(`risk.${riskProfile}`)} · {t("data.wizardGoalPreview", { target: targetNum, age: goalAgeNum })}
                  </div>
                  {statement && <div className="mt-1 break-words">{t("ux.wiz.summaryStatement", { file: statement.fileName })}</div>}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            {step > 0 ? (
              <button type="button" className={pill} onClick={() => setStep(step - 1)}>
                {t("data.wizardBack")}
              </button>
            ) : (
              <button type="button" className={pill} onClick={requestClose}>
                {t("data.cancel")}
              </button>
            )}
            <button type="submit" className={primary} disabled={reading} data-testid="wizard-next">
              {step < TOTAL_STEPS - 1 ? t("data.wizardNext") : t(statement ? "ux.wiz.createAndReview" : "data.wizardCreate")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
