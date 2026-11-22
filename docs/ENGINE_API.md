# Engine API: life decisions, economy, outlook

This document is for whoever wires the UI. It covers what the engine added on top of `simulate()`:

1. **Life decisions**: an event can carry a `decision` (child, car, partner, move, education, workload, self-employment) that the engine turns into itemised cash flows.
2. **Economy**: `SimInput.economy` / `Scenario.economy` picks a named economic scenario. Every baseline assumption is in one dated, sourced table.
3. **Outlook**: `outlook(profile, scenario)` answers "where am I heading" and "what does this decision change" from the same seeded simulation as the headline.

Everything is deterministic TypeScript in `src/lib/finance/`. No network calls, no LLM. All CHF amounts are **today's CHF** unless a field says otherwise. Functions return `Msg` descriptors and raw numbers; the UI formats them.

Verification: `npx tsx scripts/engine-regression.ts` (one check per item below) and `npx tsx scripts/engine-check.ts` (prints the numbers used in the docs).

---

## 1. Files

| File | What it holds |
|---|---|
| `src/lib/finance/params.ts` | The parameter table: `BASELINE`, `REGIMES`, `TRANSMISSION`, `CHILD`, `CAR`, `EDUCATION`, `HOME`, `PENSION`, `FAMILY_ALLOWANCES`. Each entry is `{ value, unit, asOf, year, source, url?, provenance, estimate? }`. |
| `src/lib/finance/economy.ts` | `ECONOMIES`, `ECONOMY_IDS`, `resolveEconomy()`, `economyTable()`, `economyYears()`, `jobLossRiskFor()`. |
| `src/lib/finance/life.ts` | `compileLife()`, `carVsTransit()`, `kitaDailyTariff()`, `REQUIRED_INPUTS`. |
| `src/lib/finance/outlook.ts` | `outlook()` and its result types. |
| `src/lib/finance/types.ts` | `Decision` and its seven payloads, `LifeEvent.decision`, `SimInput.economy`, `SimInput.detail`, `SimDetail`, `BudgetLine`. |
| `src/lib/twin/actions.ts` | `Op.add.decision`, `set economy`, `validateDecision()`, `DECISION_BOUNDS`, `DECISION_CARRIER`, `minExpenseDelta()`, `applyScenarioOpsChecked()`, `updateDecision()`. |
| `src/lib/twin/facts.ts` | `outlookFacts()`: the facts object for the `ask` task, built from an `outlook()` result. |
| `src/app/api/twin/commandOps.ts` | The `command` prompt and the server-side check of the model's ops. |
| `src/lib/twin/intents/life.ts` | The shared parser logic for decisions; each language file passes its vocabulary. |
| `src/lib/i18n/*.ts` | New groups `economy`, `life`, `outlook` (all four languages). |

---

## 2. Life decisions

### 2.1 Data model

```ts
interface LifeEvent {
  id: string; type: EventType; label: string; labelMsg?: Msg;
  month: number;            // months from today
  amount: number;           // legacy model; for a decision: only what a timeline shows (a car's price), else 0
  durationMonths?: number;
  nominal?: boolean;        // true = `amount` is nominal CHF at its date (UBS starter-kit costs); default: today's CHF
  decision?: Decision;      // present = the engine models the event from this payload
}
type Decision = ChildDecision | CarDecision | PartnerDecision | MoveDecision
              | EducationDecision | WorkloadDecision | SelfEmployedDecision;
```

`EventType` is unchanged (`house | child | jobloss | crash | raise | expense | income`), so existing UI code (`EVENT_ICON`, the timeline) keeps compiling. A decision travels on a **carrier type** (`DECISION_CARRIER`): child → `child`, car / move / education → `expense`, partner → `income`, workload / self-employment → `raise`. To draw a decision properly, switch on `event.decision?.kind` first.

Events stored before decisions existed have no `decision` and behave exactly as before (a `child` event is CHF `amount`/month for `durationMonths`).

Every payload field is optional. A missing value uses the sourced default of `params.ts`. Where `docs/REAL_WORLD_FACTORS.md` has no source, the engine invents nothing: the effect stays zero and the field is returned in `inputsNeeded`.

| Decision | Fields (all optional unless marked) | Sourced defaults | Asked from the user (`inputsNeeded`) |
|---|---|---|---|
| `child` | `ageYears`, `kitaDaysPerWeek`, `kitaDailyChf`, `tertiaryTrack` (`auto` \| `university` \| `apprenticeship`), `uniLivesAway`, `uniProb`, `directMonthly`, `parentWorkloadPct` + `parentWorkloadMonths` | direct cost 850 / 950 / 1'200 by age (BFS HABE), daycare 3 days at CHF 120 (City of Zürich income ramp 25–120 in ZH), family allowances of all 26 cantons (BSV), child deduction 6'800 + CHF 263 and childcare deduction up to 25'000 (ESTV), university 43% (BFS), tuition 1'460/yr (ETH), student living 1'500 / 700 | – (a parent's reduced workload is only applied when both fields are given) |
| `car` | **`mode`** (`owned` \| `leased` \| `ga`), `price`, `annualKm`, `replaceYears`, `resaleShare`, `leaseMonthly`, `fixedMonthly`, `variablePerKm`, `replacesMonthly`, `gaClass`, `durationMonths`, `financed`, `downPayment`, `loanRate`, `loanTermMonths` | price 45'000, 12'000 km, insurance + road tax + parking 310 (owned) / 280 (leased), CHF 0.276/km for fuel or electricity, tyres and maintenance (TCS 2026), replacement after 10 years at 20% resale, lease = 50% of the price over 4 years (TCS rule), GA 4'095 / 6'770 a year (SBB), loan term 60 months | the loan's interest rate, when `financed` |
| `partner` | `married`, `netIncomeMonth`, `grossIncomeYear`, `expensesMonth`, `rentMonth`, `taxDeltaYear`, `savings` | gross derived from net; a married couple's AHV capped at 150% (AHVG Art. 35) | partner's income, added living costs, shared rent, tax change of the marriage |
| `move` | `canton`, `city`, `rentMonth`, `movingCost` | income-tax index and mean health premiums of the cantons (`canton.ts`) | new rent, moving cost; the tax difference when a canton has no tax data |
| `education` | `program` (`master` \| `bachelor` \| `other`), `tuitionYear`, `durationMonths`, `workloadPct`, `raiseAfterYear` | tuition 1'460/yr, 24 / 36 months | workload while studying, salary change afterwards; for `other` also tuition and length |
| `workload` | **`percent`** (0 = sabbatical), `durationMonths` | – | – |
| `selfEmployed` | `netIncomeMonth`, `incomeVolatility`, `durationMonths` | no pension-fund credits; pillar 3a ceiling 20% of income up to 36'288 (BSV) | business income, its volatility |

One-off decisions without a payload use the existing types: an inheritance or windfall is an `income` event, a large purchase or a heat-pump retrofit an `expense` event. Their `amount` is in today's CHF and is paid in the CHF of its date.

What the engine does with each decision, month by month:

- **Child**: direct cost by age band (a second child costs less), daycare from age 0.5 to 4.5, child allowance until 16 and education allowance while in training (both after tax), the tax saved by the child and childcare deductions, then from 16 either an apprenticeship (cost falls by half the apprentice wage, independent at 19) or the way to university (school until 19, then tuition and living costs until 24). With `tertiaryTrack: "auto"` the track is drawn once per simulated future on its own random stream, so markets are unchanged.
- **Car**: purchase one-off, replacement every `replaceYears` net of resale, sale at the end; monthly fixed and per-km costs until age 80. Leased: instalment instead of the purchase. `ga`: the travelcard's yearly price. A car is not counted as an asset in net worth.
  - **Financed** (`financed: true`): the first purchase is paid with a down payment and a loan. The instalment is the annuity `P × r / (1 − (1 + r)^−n)` with `r = loanRate / 12`; it is fixed in the CHF of the purchase date (it shrinks in today's CHF), the outstanding balance is a liability in net worth until it is repaid, and `LifePlan.loans[]` holds payment, total interest and the balance by month. Replacements are paid from savings. Without `loanRate` the loan is costed at 0% and the rate is listed in `inputsNeeded`.
  - Loan and leasing instalments are debt obligations: a later home purchase counts them in the bank's one-third test (`house.medianOtherDebtYear`).
- **Partner**: the partner's salary until the user retires (same retirement date assumed), their own pension-fund credits, their AHV, the couple cap if married. Rent and living costs as given.
- **Move**: new rent from the move on, the canton's tax and premium level, a one-off moving cost.
- **Education**: tuition for the duration, the workload kept while studying, a salary change afterwards.
- **Workload**: the user's salary and BVG credits scale with the percentage (take-home pay scales proportionally, which is slightly conservative). The latest decision in force wins.
- **Self-employment**: the given take-home pay, no BVG credits, the large pillar 3a ceiling, and a yearly income factor with the given volatility (mean 1, own random stream).

### 2.2 Functions

```ts
compileLife(profile: Profile, events: readonly LifeEvent[], months: number, retireMonth: number): LifePlan
```
Pure. `simulate()` calls it itself; call it directly only to list lines, markers, `inputsNeeded` or `params` without simulating. `LifePlan.lines[]` are `{ id, eventId, kind, flow, label: Msg, monthly: Float64Array, provenance, source?, url?, estimate?, structural?, alt?, altWhen?, fixedFrom?, obligation? }` (`fixedFrom` = a contract fixed in the CHF of that month, i.e. a loan instalment; `obligation` = counted as debt service by the bank test). `LifePlan.params[]` lists every value used with `provenance` (`doppel_default` | `derived` | `user`), `source` and `asOf`.

```ts
carVsTransit(d?: Partial<CarDecision>): { mode, carMonthly, fixed, running, capital, gaMonthly, halfFareMonthly, differenceMonthly }
```
Monthly cost of a car against a GA, no simulation. With no argument: the TCS reference car, CHF 886/month against CHF 341.

```ts
validateDecision(raw: unknown): Decision | null      // src/lib/twin/actions.ts
```
Known kind, known fields, every number inside `DECISION_BOUNDS`; anything else returns `null`.

### 2.3 Ops and parsers

```ts
type Op =
  | { op: "add"; type: EventType; label: string; labelMsg?: Msg; month: number; amount: number; duration?: number; decision?: Decision }
  | { op: "shift"; id: string; months: number }
  | { op: "remove"; id: string }
  | { op: "set"; key: SetKey; value: number | string | boolean };   // SetKey now includes "economy"
```

`validateOps()` validates the payload, sets the carrier type and the shown amount. `applyOps()` copies `decision` onto the event; a new partner or self-employment replaces the old one. `applyScenarioOps(s, ops, source, { profile })` takes an optional profile: with it a spending cut is limited to what the engine can apply (`minExpenseDelta()`, not below the rent).

### 2.3a Decisions that still need figures

A decision whose effect depends on a figure without a sourced default (a partner's income, the rent after a move, a loan's interest rate, …) must not be shown as if it had no effect. Three functions make the state explicit:

```ts
inputsNeededFor(profile, events): LifeInputNeeded[]          // life.ts; no simulation. [] = complete
applyScenarioOpsChecked(s, ops, profile, source?): {          // actions.ts
  state: "applied" | "needsInput";
  scenario: Scenario;        // the new scenario when applied, the UNCHANGED one when input is needed
  pending?: Scenario;        // what it would be: complete it with updateDecision() and use it
  needsInput: LifeInputNeeded[];   // { eventId, kind, field, label: Msg } of the new decisions
}
updateDecision(events, eventId, patch): LifeEvent[]           // merges fields into the decision, validated like an op
```

`outlook()` reports the same: `state: "ok" | "needsInput"`, `needsInput: { eventId, kind, label, isNew, fields }[]`, and `decisions[].inputsNeeded`. With `state: "needsInput"` the missing part counts as zero in the numbers, so block on it: ask for the fields, call `updateDecision()`, then simulate. Use `life.need.title` and `life.need.blocked` for the message. Zero is a valid answer (a user may enter 0 for the moving cost).

`applyScenarioOps()` itself is unchanged and still applies such a decision; use the checked variant on user input.

The four local parsers recognise the decisions (0 tokens). Examples for chips are in `life.examples.*`:

| Key | EN | DE | FR | TR |
|---|---|---|---|---|
| `car` | Buy a car for 35k in 2027 | 2027 ein Auto für 35k kaufen | Acheter une voiture pour 35k en 2027 | 2027'de 35 bine araba alsam |
| `lease` | Lease a car for 500 a month | Auto leasen für 500 pro Monat | Leasing d'une voiture pour 500 par mois | Ayda 500'e araba kiralasam |
| `child` | Have a child in 2028 | 2028 ein Kind bekommen | Avoir un enfant en 2028 | 2028'de çocuğumuz olursa |
| `workload` | Work 80% | 80% arbeiten | Travailler à 80 % | %80 çalışsam |
| `move` | Move to Zug | Nach Zug ziehen | Déménager à Zoug | Zug'a taşınsam |
| `marry` | Get married in 2027 | 2027 heiraten | Se marier en 2027 | 2027'de evlensem |
| `master` | Start a master's in 2027 | 2027 einen Master beginnen | Commencer un master en 2027 | 2027'de yüksek lisansa başlasam |
| `economy` | What if inflation stays high? | Was, wenn die Inflation hoch bleibt? | Et si l'inflation reste élevée ? | Enflasyon yüksek kalırsa? |

Also parsed: a GA travelcard, a leased car with its list price, a child's university or apprenticeship track and daycare days, a sabbatical with its length, a move with the rent, a partner's income, a full-time master's, self-employment with its income, an inheritance, a large purchase ("buy a boat for 50k in 2030"; not in Turkish), a heat-pump retrofit, and the economic scenario.

The model route `/api/twin` accepts the same decisions for what-ifs the local parsers miss (`task: "command"`, see `docs/ARCHITECTURE.md` §5). Its answer is `{ ops, dropped, unstated }`: `dropped` ops were invalid, `unstated` counts fields the model filled in although the user never gave them (they are removed, the engine's default applies). Pass `ops` through `validateOps()` as before.

### 2.4 Example

```ts
import { baseScenario, simInputFor } from "@/lib/finance/scenario";
import { simulate } from "@/lib/finance/monteCarlo";
import { applyScenarioOps, validateOps } from "@/lib/twin/actions";

const s0 = baseScenario(profile);
const ops = validateOps(
  [
    { op: "add", type: "child", label: "Baby", month: 20, decision: { kind: "child", kitaDaysPerWeek: 3 } },
    { op: "add", type: "expense", label: "Car", month: 12, decision: { kind: "car", mode: "leased", leaseMonthly: 450 } },
  ],
  s0.events,
);
const s1 = applyScenarioOps(s0, ops, "command", { profile });
const result = simulate(simInputFor(profile, s1, behavior));
result.successProb;              // goal odds with both decisions
result.life?.alternatives;       // [{ eventId, prob: 0.43, share: 0.431 }]  the child's university draw
result.life?.inputsNeeded;       // number of inputs the model still needs
```

---

### 2.5 The solver's mobility lever

`solveGoal()` returns `carToGa?: CarToGaLever` when the plan holds a bought or leased car, the goal is below 80% and a GA travelcard instead of the car raises the odds. It is not in `recipes` (its patch replaces events, which `Recipe.apply` cannot express):

```ts
const sol = solveGoal(simInputFor(profile, scenario, behavior));
if (sol.carToGa) {
  sol.carToGa.title; sol.carToGa.detail;            // Msg: "GA travelcard instead of the car", monthly costs
  sol.carToGa.newProb; sol.carToGa.reaches;         // scored like the headline
  const next = applyCarToGa(scenario, sol.carToGa); // the scenario with the cars replaced
}
```

## 3. Economy

### 3.1 The baseline table

`BASELINE` in `params.ts` is the single place for the baseline assumptions. `ASSUMPTIONS` in `monteCarlo.ts` is built from it.

| Id | Value | Source |
|---|---:|---|
| `inflation` | 1.2% | Doppel assumption inside the SNB's price-stability range; SECO forecast 2026: 0.6% |
| `wageGrowth` | 1.2% (0% real) | Doppel assumption; BFS wage index 2025: +1.8% |
| `wageVol` | 1.0% | Doppel assumption (career luck) |
| `equityMu` / `equitySigma` | 6.5% / 16% | Doppel assumption |
| `bondMu` / `bondSigma` | 2.0% / 5% | Doppel assumption |
| `cashRate` | 0.3% | Doppel assumption at an SNB policy rate of 0% |
| `overdraftRate` | 6.0% | Doppel assumption |
| `homeMu` / `homeSigma` | 1.5% / 5% | Doppel assumption |
| `pillar2Rate` | 1.25% | BVG minimum interest rate 2024–2026 |
| `mortgageRate` | 1.8% | 10-year fixed, market average 2026 (Comparis) |
| `unemploymentReplacement` / `unemploymentInsuredCap` | 70% / CHF 148'200 | AVIG / UVG |
| `unemploymentRate` | 3.1% | SECO forecast 2026 (context; the baseline has no random job loss) |
| `crashShock` | −30% | Doppel assumption for a "market crash" event |
| `retirementSpending`, `raiseNetShare`, `panicDrawdown` | 0.8, 0.72, 0.15 | Doppel assumptions |
| `healthExcessGrowth` | 2.5 pp | BAG 1996–2026 (3.2 pp above prices), conservative |

Every row has `asOf: "2026-11-22"`. `economyTable(id)` returns the rows plus, per phase of a scenario, each changed value with its baseline value and source: use it for an "assumptions and sources" disclosure.

### 3.2 Scenarios

`SimInput.economy` and `Scenario.economy` take an id or a custom `EconomyScenario`. Absent = `baseline`, bit-identical to a run without the parameter.

| Id | What changes | Then |
|---|---|---|
| `baseline` | nothing | – |
| `high_inflation` | 3 years: CPI 3.8%, nominal wages 2.7% (real −1.1 pp against the price-stability regime), mortgages 4.8%, cash 3.25%, BVG interest 2.4%; shares, bonds and property keep their real return | baseline |
| `recession` | month 0: shares −30%; 2 years: job-loss risk 3.8% a year (unemployment 5% instead of 3.1%; 6-month spell at 70% of the insured salary), CPI 0.2%, mortgages 1.5%, no interest on cash; 5 more years of the low-rate regime | baseline |
| `low_rates` | 7 years: CPI 0.2%, nominal wages 0.1%, mortgages 1.5%, no interest on cash | baseline |
| `climate_transition` | 10 years: share returns −0.4 pp a year (Mercer / Ortec citing NGFS, disorderly transition) | baseline |

Rules that hold for every scenario:

- The regime values (CPI, real wage drift, policy rate, 10-year mortgage rate) and the phase lengths (1 / (1 − yearly stay probability)) come from `REGIMES`, which copies `docs/REAL_WORLD_FACTORS.md` §2.2 A. That section is a design proposal anchored on Swiss episodes (1974, 1991, 2015–2022); the values are marked `estimate`.
- Real wages use the regime's drift relative to the price-stability regime, on top of the baseline's 0%. Shares, bonds and property keep the baseline's real return, so their nominal return moves with inflation. No regime-specific market return is assumed, because the sources give none.
- A home bought through a `house` event locks the mortgage rate of its purchase year for 10 years, then resets to the rate of that year. The bank test uses `max(5%, market rate)`. `SimResult.house.mortgageRate` is set when the rate differs from the baseline.
- The job-loss risk, the drawn life outcomes and self-employed income luck each have their own random stream. Market draws are the same in every scenario; only their mean and volatility change.
- The recession's unemployment rate (5%) is a scenario assumption, not a forecast.

A custom scenario:

```ts
const mine: EconomyScenario = {
  id: "my-stress",
  label: { key: "economy.name.high_inflation" },
  summary: { key: "economy.summary.baseline" },
  phases: [{ years: 5, label: { key: "economy.phase.high" }, regime: { inflation: 0.03, wageGrowth: 0.02, mortgageRate: 0.04 }, equityShock: -0.2, sources: [] }],
};
simulate({ ...simInputFor(profile, scenario), economy: mine });
```
Values are limited to plausible bounds; non-finite values are ignored.

### 3.3 Example

```ts
import { ECONOMIES, ECONOMY_IDS, economyTable } from "@/lib/finance/economy";

for (const id of ECONOMY_IDS) {
  const r = simulate({ ...simInputFor(profile, scenario, behavior), economy: id });
  console.log(ECONOMIES[id].label, r.successProb, r.retirement?.lastsTo90Prob);
}
// As a what-if: the op, or the scenario field directly.
const s2 = applyScenarioOps(scenario, [{ op: "set", key: "economy", value: "recession" }]);
const rows = economyTable("recession");   // baseline rows + what each phase changes, with sources
```

Measured (`scripts/engine-check.ts`, real twin, headline seed): Barlas 92.0% in the baseline, 88.2% under high inflation; Meriç 58.7% → 18.7% (the flat is bought in 28.9% of futures instead of 84.5%).

---

## 4. Outlook

```ts
outlook(profile: Profile, scenario: Scenario, opts?: {
  baseline?: Scenario | null;      // default: baseScenario(profile); null = no comparison
  behavior?: BehaviorParams;       // the "real" twin, used for both runs
  economy?: EconomyId | EconomyScenario;   // for both runs (default: each scenario's own)
  paths?: number; seed?: number;   // default: HEADLINE (1,000 paths, seed 42)
  now?: Date;                      // month 0 on the calendar when the profile has no asOf
}): Outlook
```

Two full simulations with `detail: true`; about 0.7–1.5 s in Node for the built-in accounts. Call it on demand (after a change settles), not on every keystroke.

```ts
interface Outlook {
  startYear: number; age: number;
  economy: { id: string; label: Msg; summary: Msg };
  budget: {
    now: BudgetSnapshot;          // month 0 of the baseline
    after: BudgetSnapshot;        // first month in which every new decision has started
    years: BudgetSnapshot[];      // the scenario in 1, 5 and 10 years
    surplusDelta?: number;        // after.surplus − baseline surplus in the same month
  };
  netWorth: HorizonPoint[];       // keys y1, y5, y10, goal, retirement: p10, p50, p90, baseline, deltaP50
  cashLow: { median: CashPoint; p10: CashPoint; liquidMedian: CashPoint; baselineMedian?: CashPoint };
  crunch: { beforeGoal: number; within: { years: 1 | 5 | 10; prob: number }[]; baselineBeforeGoal?: number };
  goal: { label: Msg; target: number; month: number; prob: number; median: number; baselineProb?: number; deltaProb?: number };
  retirement?: { age; incomeMonthly; incomeFromAhvAge; spendingMonthly; gapMonthly; lastsTo90Prob; depletionAgeP10; baseline? };
  decisions: DecisionOutlook[];
  markers: OutlookMarker[];       // { month, year, ym, age, kind, label, eventId?, amount? }
  state: "ok" | "needsInput";     // needsInput: a decision lacks a figure; its missing part counts as zero (§2.3a)
  needsInput: OutlookNeed[];      // { eventId, kind, label, isNew, fields: LifeInputNeeded[] }
  inputsNeeded: LifeInputNeeded[];// the same as a flat list: { eventId, kind, field, label: Msg }
  params: LifeParamUsed[];        // { eventId, kind, id, value, unit, provenance, source?, url?, asOf?, estimate? }
  sim: SimResult; baselineSim?: SimResult;
}
```

- `BudgetSnapshot` = `{ month, year, ym, age, income, expenses, surplus, items[] }`. An item is `{ id, kind, flow, label: Msg, amount, eventId?, provenance?, source?, estimate?, info?, prob?, transfer? }`.
  - `kind`: `income`, `partnerIncome`, `pension`, `rent`, `health`, `living`, `debt`, `home`, `event`, or a decision kind. Items with an `eventId` are the decision's own lines.
  - `info: true`: already inside another item (a lower salary is inside `income`); show it as an explanation, it is not part of the totals.
  - `prob`: the item belongs to a drawn outcome (a child's track); `amount` is the expected value.
  - `transfer: true`: a payment that builds an asset (mortgage amortisation, home equity); in the budget, not a cost.
- `DecisionOutlook` = `{ eventId, kind, label, month, isNew, lines[], oneOffs[], byYear[], netMonthly: { year1, years5, years10 }, totalNet }`. `lines[].phases` are the constant stretches `{ fromMonth, toMonth, monthly }` of each line. `byYear` counts 12-month periods from the decision's start; its net cost includes the income the decision costs (also `info` lines) and excludes transfers.
- `cashLow` is the lowest month-end bank cash during working life in the median future and in the weakest 10%; `liquidMedian` is cash plus portfolio.
- Markers: decision markers (`childBirth`, `kitaStart`, `kitaEnd`, `childSchool`, `childTeen`, `childTrack`, `apprenticeStart`, `uniStart`, `childIndependent`, `carPurchase`, `carReplacement`, `carEnd`, `carLoanEnd`, `leaseStart`, `gaStart`, `partner`, `move`, `eduStart`, `eduEnd`, `workloadStart`, `workloadEnd`, `selfStart`, `selfEnd`), the old event types with `childEnd` / `joblossEnd`, and `debtFree`, `retirement`, `ahv`, `goal`.
- `ym` is yyyymm; the i18n format `{x:ym}` prints it.

The budget lines are the engine's own schedule: in accounting mode the sum of the lines equals the simulated month-on-month cash change (checked for 400 months in `engine-regression.ts`).

### 4.1 Example

```ts
import { outlook } from "@/lib/finance/outlook";

const o = outlook(profile, scenario, { behavior });
o.goal.prob;                        // equals the headline odds of `scenario`
o.goal.deltaProb;                   // against the profile's own plan
o.budget.after.items.filter((i) => i.eventId);   // the decisions' lines in the first month all of them run
o.netWorth.find((n) => n.key === "y10")?.deltaP50;
o.cashLow.median;                   // { amount, month, year, ym, age }
o.decisions.filter((d) => d.isNew).map((d) => d.netMonthly);
o.markers;                          // for chart markers, sorted by month
o.inputsNeeded;                     // ask the user for these; until then the effect is zero
```

Measured for Barlas, "Have a child in 2028" (`scripts/engine-check.ts`): goal odds 92.0% → 50.9%, the monthly surplus falls by CHF 543 at the birth, the child costs CHF 710/month net in the first year and CHF 726/month over ten years, median net worth in ten years is CHF 81'899 lower.

---

## 5. Changes to existing results

These fields changed meaning or are new. They matter for existing cards.

| Field | Change |
|---|---|
| `SimResult.house.price` | Now the price **at the purchase date** in nominal CHF (the entered price grown with the home-price drift). `priceToday` is the entered price. The card and the simulation use the same number, as before. |
| `SimResult.house.mortgageRate` | Present only when an economic scenario moves the rate off the baseline. Pass `stressRate: max(0.05, mortgageRate)` to `checkAffordability()` to keep the card identical to the simulation in that case. |
| `SimResult.expenseDeltaApplied` | The spending change the engine applied. It differs from `scenario.expenseDelta` when a cut would go below the rent. |
| `RetirementStats.monthlyIncomeAtRetirement` | BVG at the retirement date, plus AHV only if the retirement age is 65 or later. |
| `RetirementStats.monthlyIncomeFromAhvAge`, `bvgMonthlyAtAhvAge`, `bvgMonthlyAtEnd` | New. The BVG annuity is fixed in nominal CHF, so in today's CHF it shrinks after retirement. |
| `RetirementStats` for a retiree | Now returned when the profile is already retired at the start. |
| `SimResult.economy`, `SimResult.life` | Present only for a non-baseline economy / when a decision is in the scenario. |
| `tragbarkeit()` | Pillar 2 may fund equity above 20% (the 10% hard-equity rule is unchanged). Optional `stressRate`. |
| `SimResult.house.medianOtherDebtYear` | Also present when a decision adds a loan or leasing instalment (before: only with `profile.liabilities`). |
| Crash events and scenario shocks with the behavioural twin | The ordinary panic episodes follow the drawn returns only; a crash has its own reaction (own coin, own parked money, back in the market when it has regained its pre-crash level). A crash therefore never raises the odds on the same futures. Runs without a crash or shock are bit-identical to before. |
| `Profile.healthPremiumMonth` of the built-in accounts | Set from their statements (318 / 428 / 372, `provenance.healthPremiumMonth: "derived"`); the canton's mean is the fallback. The `health` budget line carries the provenance (`derived` / `user` / `doppel_default`). |
| Goal scoring | A failed home purchase fails a goal only when the home was planned on or before that goal's date. |
| One-off `expense` / `income` events, the pillar 3a ceiling | In today's CHF, paid in the CHF of their date. |

---

## 6. Not modelled

- The marriage tax effect, a partner's living costs, rents by canton, moving costs, self-employed income and its volatility, and the income effect of further education have no source in `docs/REAL_WORLD_FACTORS.md`. They are user inputs.
- Subsidised daycare tariffs outside the City of Zürich ramp; premium subsidies (IPV); a child's own health premium growing faster than prices.
- A car loan's interest rate has no sourced default (user input). A car bought from savings that the cash cannot cover is a cash crunch. The car's value is not in net worth; a car's cost is not split into insurance, tax and parking (TCS publishes the group totals); replacements are not financed.
- The rent rule tied to the reference interest rate; SARON mortgages; bond losses when rates rise; a regime lottery (scenarios are fixed paths).
- Premium subsidies (IPV); old-age care.
- `pocket/` (the Kotlin port) does not know decisions or economies yet.

## 7. Facts for the assistant (`ask`)

```ts
import { outlookFacts } from "@/lib/twin/facts";
import { askTwin, askErrorMsg } from "@/lib/llm";

const o = outlook(profile, scenario, { behavior });
const facts = outlookFacts(o, {
  profile: effectiveProfile(profile, scenario),
  locale,
  scenario: "Have a child in 2028",          // optional: the what-if as typed
  disciplined: simulate(simInputFor(profile, scenario)),   // optional: for the habit figures
  topHabit, bestMove,                         // optional
  extra: summaryAskFacts(statement),          // optional: further listed facts
});
const r = await askTwin(question, facts, locale);   // r.ok ? r.data : askErrorMsg(r)
```

Build the facts with this function only. Every key of `ASK_FACT_KEYS` names its unit and time basis, because the model reads the key to say what a number means: `_chf`, `_pct`, `_per_month`, `_total` / `_by_goal_date` (a sum over a period), `_today` / `_in_10_years` / `_at_goal_date` (a level), `_median` / `_weak_case` / `_strong_case` (which simulated futures). Examples: `habit_cost_by_goal_date_chf`, `surplus_change_per_month_from_decision_chf`, `decision_net_cost_first_12_months_total_chf`, `net_worth_in_10_years_median_chf`, `lowest_cash_month`, `decision_line_1…6` (the decision's own lines as text), `decision_inputs_missing`, `economy_scenario`.

The gateway refuses an answer that contains a number not in the facts or the question (`UNGROUNDED_ANSWER`, also for numbers spelled out) or that quotes a figure on another basis than its key states, e.g. a total by the goal date as a yearly cost (`MISLABELED_ANSWER`). `askErrorMsg()` maps both to the same message.
