"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createAccount } from "@/lib/accounts";
import { takeHomeMonth } from "@/lib/data/profiles";
import { SOCIAL_DEDUCTIONS } from "@/lib/finance/pension";
import { RISK_PROFILES, type RiskProfile } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";

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

const field = "w-full min-w-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink";
const pill = "rounded-full border border-line px-3 py-1.5 text-xs font-medium enabled:hover:border-ink-3 disabled:opacity-45";
const primary = "rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-bg disabled:opacity-45";

function grossFromTakeHome(netMonth: number, marginalRate: number): number {
  const keepAfterTax = Math.max(0.45, 1 - marginalRate * 0.62);
  const annualAfterSocial = (netMonth * 12) / keepAfterTax;
  const gross = annualAfterSocial / (1 - SOCIAL_DEDUCTIONS);
  return Math.max(0, Math.round(gross / 100) * 100);
}

/**
 * Seven-step new-account wizard:
 *  1. name, age, canton/city
 *  2. income: gross or net
 *  3. rent & monthly spending
 *  4. balances: cash, portfolio, pillar 2, 3a
 *  5. risk profile
 *  6. goal: net-worth target at a given age
 *  7. optional statement import
 */
export function AccountWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (accountId: string, withImport: boolean) => void;
}) {
  const { t, fmt } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [age, setAge] = useState("30");
  const [canton, setCanton] = useState("ZH");
  const [city, setCity] = useState("Zürich");
  const [cityTouched, setCityTouched] = useState(false);

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
    setName("");
    setAge("30");
    setCanton("ZH");
    setCity("Zürich");
    setCityTouched(false);
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

  // Accessible dialog lifecycle: trap Tab, Escape closes, restore focus on close.
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
        onClose();
        return;
      }
      if (ev.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
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
      const prev = prevFocusRef.current;
      if (prev && prev.isConnected) prev.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const ageNum = Number(age);
  const taxPct = Number(taxRate);
  const marginalTaxRate = Number.isFinite(taxPct) ? Math.min(0.5, Math.max(0.05, taxPct / 100)) : 0.22;
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

  const nonNeg = (n: number, max = 50_000_000) => Number.isFinite(n) && n >= 0 && n <= max;

  const stepValid = (s: number): boolean => {
    switch (s) {
      case 0:
        return (
          name.trim().length > 0 &&
          Number.isInteger(ageNum) &&
          ageNum >= 18 &&
          ageNum <= 74 &&
          city.trim().length > 0
        );
      case 1:
        return (
          (incomeMode === "gross" ? nonNeg(grossVal, 10_000_000) && grossInput !== "" : nonNeg(netVal, 1_000_000) && netInput !== "") &&
          Number.isFinite(taxPct) &&
          taxPct >= 5 &&
          taxPct <= 50
        );
      case 2:
        return rent !== "" && expenses !== "" && nonNeg(rentNum, 200_000) && nonNeg(expensesNum, 500_000);
      case 3:
        return (
          cash !== "" &&
          portfolio !== "" &&
          pillar2 !== "" &&
          pillar3a !== "" &&
          nonNeg(cashNum) &&
          nonNeg(portfolioNum) &&
          nonNeg(pillar2Num) &&
          nonNeg(pillar3aNum)
        );
      case 4:
        return RISK_PROFILES.includes(riskProfile);
      case 5:
        return (
          goalTarget !== "" &&
          goalAge !== "" &&
          Number.isFinite(targetNum) &&
          targetNum >= 10_000 &&
          targetNum <= 50_000_000 &&
          Number.isInteger(goalAgeNum) &&
          goalAgeNum > (Number.isInteger(ageNum) ? ageNum : 18) &&
          goalAgeNum <= 90
        );
      case 6:
        return [0, 1, 2, 3, 4, 5].every(stepValid);
      default:
        return false;
    }
  };

  const allValid = [0, 1, 2, 3, 4, 5].every(stepValid);
  const currentValid = stepValid(step);
  const totalNetWorth =
    (nonNeg(cashNum) ? cashNum : 0) +
    (nonNeg(portfolioNum) ? portfolioNum : 0) +
    (nonNeg(pillar2Num) ? pillar2Num : 0) +
    (nonNeg(pillar3aNum) ? pillar3aNum : 0);

  function onCantonChange(nextCode: string) {
    setCanton(nextCode);
    const meta = CANTONS.find((c) => c.code === nextCode);
    if (!meta) return;
    if (!cityTouched) setCity(meta.city);
    if (!taxTouched) setTaxRate(String(meta.tax));
  }

  function finish(withImport: boolean) {
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
    onCreated(id, withImport);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 shadow-2xl outline-none sm:rounded-2xl sm:p-6"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="label">{t("data.wizardKicker")}</div>
            <h2 id={titleId} className="font-serif text-2xl leading-tight">
              {t("data.wizardTitle")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("data.wizardCloseAria")}
            className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition hover:border-ink-3 hover:text-ink"
          >
            {t("common.close")}
          </button>
        </div>

        {/* Step pills (1..7) — compact so 320px viewports never overflow */}
        <div className="mb-4 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("data.wizardStepsAria")}>
            {STEP_NUMS.map((n, idx) => {
              const active = step === idx;
              const reachable = idx <= step || [0, 1, 2, 3, 4, 5].slice(0, idx).every(stepValid);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={!reachable}
                  aria-current={active ? "step" : undefined}
                  aria-label={`${n}. ${t(`data.wizardStep.s${n as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)}`}
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
          <div className="text-xs font-medium text-ink-2">
            {t("data.wizardStepOf", { step: step + 1, total: TOTAL_STEPS })} ·{" "}
            <span className="text-ink">{t(`data.wizardStep.s${(step + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)}</span>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!currentValid) return;
            if (step < TOTAL_STEPS - 1) setStep(step + 1);
            else finish(false);
          }}
          className="min-w-0 space-y-4"
        >
          {step === 0 && (
            <div className="grid grid-cols-2 gap-3 text-xs font-medium text-ink-2">
              <label className="col-span-2 min-w-0">
                {t("data.wizardName")}
                <input
                  ref={firstInputRef}
                  className={`${field} mt-1`}
                  required
                  maxLength={60}
                  placeholder={t("data.wizardNamePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                />
              </label>
              <label className="min-w-0">
                {t("data.wizardAge")}
                <input
                  className={`${field} mt-1`}
                  type="number"
                  inputMode="numeric"
                  min={18}
                  max={74}
                  required
                  value={age}
                  onChange={(e) => {
                    const nextAge = e.currentTarget.value;
                    setAge(nextAge);
                    const n = Number(nextAge);
                    if (!goalAgeTouched && Number.isInteger(n) && n >= 18) {
                      setGoalAge(String(Math.min(85, Math.max(50, n + 15))));
                    }
                  }}
                />
              </label>
              <label className="min-w-0">
                {t("data.wizardCanton")}
                <select className={`${field} mt-1`} value={canton} onChange={(e) => onCantonChange(e.currentTarget.value)}>
                  {CANTONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.city}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 min-w-0">
                {t("data.wizardCity")}
                <input
                  className={`${field} mt-1`}
                  required
                  maxLength={60}
                  value={city}
                  onChange={(e) => {
                    setCityTouched(true);
                    setCity(e.currentTarget.value);
                  }}
                />
              </label>
            </div>
          )}

          {step === 1 && (
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
              {incomeMode === "gross" ? (
                <label className="block min-w-0">
                  {t("data.wizardGrossField")}
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={10_000_000}
                    step={500}
                    required
                    value={grossInput}
                    onChange={(e) => setGrossInput(e.currentTarget.value)}
                  />
                </label>
              ) : (
                <label className="block min-w-0">
                  {t("data.wizardNetField")}
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={1_000_000}
                    step={50}
                    required
                    value={netInput}
                    onChange={(e) => setNetInput(e.currentTarget.value)}
                  />
                </label>
              )}
              <label className="block min-w-0">
                {t("data.wizardTaxRate")}
                <input
                  className={`${field} mt-1`}
                  type="number"
                  inputMode="decimal"
                  min={5}
                  max={50}
                  step={1}
                  required
                  value={taxRate}
                  onChange={(e) => {
                    setTaxTouched(true);
                    setTaxRate(e.currentTarget.value);
                  }}
                />
              </label>
              <p className="num rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
                {t("data.wizardIncomeSummary", { gross: computedGross, net: computedNet })}
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3 text-xs font-medium text-ink-2">
              <label className="block min-w-0">
                {t("data.wizardRent")}
                <input
                  className={`${field} mt-1`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={200_000}
                  step={50}
                  required
                  value={rent}
                  onChange={(e) => {
                    const nextRent = e.currentTarget.value;
                    setRent(nextRent);
                    const r = Number(nextRent);
                    if (Number.isFinite(r) && r > expensesNum) setExpenses(String(Math.round(r)));
                  }}
                />
              </label>
              <label className="block min-w-0">
                {t("data.wizardExpenses")}
                <input
                  className={`${field} mt-1`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={500_000}
                  step={50}
                  required
                  value={expenses}
                  onChange={(e) => setExpenses(e.currentTarget.value)}
                />
              </label>
              <p className="text-xs text-ink-3">{t("data.wizardRentHint")}</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-xs font-medium text-ink-2">
              <div className="grid grid-cols-2 gap-2.5">
                <label className="min-w-0">
                  {t("data.wizardCash")}
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={500}
                    required
                    value={cash}
                    onChange={(e) => setCash(e.currentTarget.value)}
                  />
                </label>
                <label className="min-w-0">
                  {t("data.wizardPortfolio")}
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={500}
                    required
                    value={portfolio}
                    onChange={(e) => setPortfolio(e.currentTarget.value)}
                  />
                </label>
                <label className="min-w-0">
                  {t("data.wizardPillar2")}
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={500}
                    required
                    value={pillar2}
                    onChange={(e) => setPillar2(e.currentTarget.value)}
                  />
                </label>
                <label className="min-w-0">
                  {t("data.wizardPillar3a")}
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={500}
                    required
                    value={pillar3a}
                    onChange={(e) => setPillar3a(e.currentTarget.value)}
                  />
                </label>
              </div>
              <p className="num rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-ink">
                {t("data.wizardNetWorth", { amount: totalNetWorth })}
              </p>
            </div>
          )}

          {step === 4 && (
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

          {step === 5 && (
            <div className="space-y-3 text-xs font-medium text-ink-2">
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 min-w-0 sm:col-span-1">
                  {t("data.wizardGoalTarget")}
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    inputMode="numeric"
                    min={10_000}
                    max={50_000_000}
                    step={10_000}
                    required
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.currentTarget.value)}
                  />
                </label>
                <label className="col-span-2 min-w-0 sm:col-span-1">
                  {t("data.wizardGoalAge")}
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    inputMode="numeric"
                    min={(Number.isInteger(ageNum) ? ageNum : 18) + 1}
                    max={90}
                    required
                    value={goalAge}
                    onChange={(e) => {
                      setGoalAgeTouched(true);
                      setGoalAge(e.currentTarget.value);
                    }}
                  />
                </label>
              </div>
              {stepValid(5) && (
                <p className="num rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
                  {t("data.wizardGoalPreview", { target: targetNum, age: goalAgeNum })}
                </p>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3 text-xs text-ink-2">
              <div className="rounded-xl bg-surface-2 p-3">
                <div className="font-semibold text-ink">
                  {name.trim()} ({ageNum}) · {city.trim()} ({canton})
                </div>
                <div className="num mt-1 text-ink-2">
                  {fmt.chf(totalNetWorth)} · {t(`risk.${riskProfile}`)} · {t("data.wizardGoalPreview", { target: targetNum, age: goalAgeNum })}
                </div>
              </div>
              <p className="leading-relaxed">{t("data.wizardImportIntro")}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            {step > 0 ? (
              <button type="button" className={pill} onClick={() => setStep(step - 1)}>
                {t("data.wizardBack")}
              </button>
            ) : (
              <button type="button" className={pill} onClick={onClose}>
                {t("data.cancel")}
              </button>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {step < TOTAL_STEPS - 1 ? (
                <button type="submit" className={primary} disabled={!currentValid}>
                  {t("data.wizardNext")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={pill}
                    disabled={!allValid}
                    onClick={() => finish(true)}
                  >
                    {t("data.wizardCreateAndImport")}
                  </button>
                  <button type="submit" className={primary} disabled={!allValid}>
                    {t("data.wizardCreate")}
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
