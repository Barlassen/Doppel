# UBS synthetic data in Doppel

The UBS LauzHack 2026 starter data (`data/ubs/`, all people fictional) is converted at build time and used by the dashboard and by `/play`.

## Pipeline

`npm run ubs:build` (`scripts/build-ubs-data.ts`) validates the CSV joins (cash in profiles = accounts = assets, known ids, no NaN) and writes `src/lib/ubs/generated/`:

| File | Content | Loaded |
|---|---|---|
| `summary.ts` | 1'200 compact search rows | with the picker (lazy chunk, ~20 kB gzip) |
| `details-00.ts` … `details-11.ts` | full records, 100 profiles each | one dynamic import per opened profile |
| `meta.ts` | as-of date, goal-name and priority tables | main bundle (< 1 kB) |
| `catalog.ts`, `assumptions.ts`, `alexia.ts` | 120 scenarios, S001 assumptions, Alexia's paths | with the Alexia card or `/play` |

The output is committed. Rerun the script only when `data/ubs` changes. `synthetic-transactions.csv` and `life-events.csv` are named in the starter README but not shipped.

## API (`@/lib/ubs`)

```ts
ALEXIA_ID = "P00001"
listUbsProfiles(): UbsProfileSummary[]          // Alexia first; netWorthChf = UBS assets − UBS debt (no Doppel estimates)
loadUbsProfile(id): Promise<Profile>            // full Doppel profile, fresh copy per call
ubsScenarioCatalog(): UbsScenario[]
ubsAssumptions(scenarioId, profileId?): UbsAssumption[]
alexiaPaths(): AlexiaPath[]
```

Code that only opens a profile imports `@/lib/ubs/load`, which keeps the search summary out of the bundle. The accounts store adds `openUbsProfile(id)`. It closes a profile through `deleteAccount(id)` and persists the opened ids in `doppel:accounts:v1` as `ubs: string[]`.

## Field mapping (`src/lib/ubs/map.ts`)

Each field's provenance is stored in `Profile.provenance` and shown under "Where do these numbers come from?".

| Doppel field | Value | Provenance |
|---|---|---|
| name, age, city, canton, employment, household | as given | `ubs_synthetic` |
| `asOf` | 2025-01-01 = month 0 (chart years and timeline dates follow it) | `ubs_synthetic` |
| `cash` | opening cash (+ other assets, none in the data) | `ubs_synthetic` |
| `portfolio` | investment portfolio | `ubs_synthetic` |
| `netIncomeMonth` | reference net income, read as take-home after tax | `ubs_synthetic` |
| `rentMonth` | reference rent | `ubs_synthetic` |
| `liabilities` | principal and rate | `ubs_synthetic` |
| loan payment | the data has 0, so the annuity over 60 months is used | `derived` |
| `goals`, `goal` | all goals; the primary goal (highest priority, then earliest date) is the headline; age = start age + years from the as-of date | `ubs_synthetic` |
| goal metric | emergency savings → cash; housing deposit → cash + portfolio + 3a; education, career → cash + portfolio; resilience, retirement → net worth | `doppel_default` |
| `grossIncomeYear` | net × 12 ÷ (1 − ½ × marginal rate) ÷ (1 − 13%), rounded to CHF 100 (the payslip rule run backwards). Retirees: the former salary implied by the AHV part of the pension | `derived` |
| `pillar2` | BVG age credits on the coordinated salary from age 25 at 1.25% interest, with salaries deflated by wage growth. Unemployed: estimated on gross ÷ 0.7. Self-employed: 0. Retirees: the capital whose BVG annuity, together with AHV, pays the reported pension | `derived` (self-employed: `doppel_default`) |
| `bvgInsured` | false for self-employed and unemployed people | `derived` |
| `investShare` | portfolio ÷ (cash + portfolio), capped at 90% | `derived` |
| `marginalTaxRate` | brackets on yearly take-home pay: 8 / 15 / 22 / 27 / 31 / 35 / 38% | `doppel_default` |
| `expensesMonth` | rent + max(minimum living cost by household, 75% of take-home after rent and loan payments) | `doppel_default` |
| `pillar3a`, `contributes3a` | 0, no | `doppel_default` |
| `riskProfile` | balanced (conservative for retirees) | `doppel_default` |
| `retirementAge` | 65 (retirees: their age, so the pension starts in month 0) | `doppel_default` / `derived` |
| `transactions`, `trades`, `history` | empty or neutral | `doppel_default` |

**Transactions: none are synthesised.** A generated history would let the behaviour model "discover" habits that Doppel made up. With no transactions, `analyzeBehavior()` infers nothing. It keeps the neutral priors that every account has (3% leakage floor, 8% chance of a panic sale) and shows a "No transaction history" insight. Importing a statement calibrates spending and habits through the normal local layer.

## Liabilities (`src/lib/finance/debt.ts`)

- **Annuity:** payment = P·r / (1 − (1 + r)^−n), with r = annual rate / 12 and n = 60 months by default.
- **Monthly step:** interest = balance × r. The payment is min(payment, balance + interest). The balance falls by payment − interest.
- **Extra payments:** applied to the loan with the highest rate first.
- **Determinism:** payments are fixed and always made, so the schedule is the same in every simulated future. It is computed once and treated as a cash outflow, so a shortfall is a cash crunch.
- **Mortgage liabilities:** without a payment, a mortgage liability is interest-only. A home bought through a `house` event keeps its own mortgage logic.
- **Net worth:** assets − liabilities in the hero, the switcher, the chart, the goal test and the solver.
- **Bank test:** `tragbarkeit()` adds yearly payments on other loans to the imputed costs in the ⅓-of-income test, and `maxLoanForIncome()` subtracts them from the budget.
- **Solver lever:** "pay down debt" finds the smallest extra monthly payment that reaches 80%. Otherwise it offers half of today's surplus, labelled "improves to". When a home is planned, it reports the bank-test pass rate.

## Multiple goals

`simulate()` returns `goals[]` for `profile.goals`. Every goal is scored on the same futures. A goal counts as reached if no cash crunch happened before its date, no planned home purchase failed, and its metric at its date (in today's CHF) is at or above the target. The primary goal's odds equal the headline exactly.

## Alexia's paths

`scenario_config.json` phases become `Scenario.phases`: nominal net income and spending, not indexed and not scaled by career luck. After the last phase ends, it continues indexed with wages and prices. One-off costs become dated expense events. For the master's, the S001 tuition (CHF 8'000 a year for 2 years) replaces the config's one-off costs. It is on by default, can be toggled, and is never counted twice. Moving abroad turns off Swiss pension-fund credits during the phase. In accounting mode (every rate zero), the engine's cash equals the config ledger over 120 months (`ubs-check`).

## Validation

`npm run ubs:check` covers:
- all profiles load without NaN;
- net worth = assets − liabilities, including the simulator's month 0;
- amortisation identities;
- Alexia's ledger;
- goal odds bounds, primary goal = headline, and monotonicity in the target;
- the gross ↔ net round trip;
- retirees' month-0 pension;
- debt in the bank test;
- consistency of the debt recipe;
- the built-in accounts, which must be bit-identical to `scripts/fixtures/persona-golden.json`.
