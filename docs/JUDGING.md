# Judging and demo guide

State: `main` includes the UBS data layer (`docs/UBS.md`), Alexia's three paths, goals and debt, and the `/play` life game (phase 1; spec and implementation notes in `docs/PLAY.md`, checks in `npm run play:check`).

Rule for this page: quote numbers only from command output or a committed report, and name the command. Labels in quotes are the English UI strings in `src/lib/i18n/en.ts`.

## Rubric and evidence

| Criterion (weight) | What Doppel demonstrates | On screen | Reproduce | Honest gaps |
|---|---|---|---|---|
| Financial modelling and correctness (25) | Seeded Monte Carlo (1'000 paths, seed 42) plus Swiss mortgage, AHV/BVG and tax rules in TypeScript; no model does arithmetic | Hero odds, cone chart, "Decisions" cards: goals, debt, affordability, retirement | `npx tsx scripts/engine-check.ts` (built-in accounts); `npm run ubs:check` (UBS layer, Alexia's ledger) | Rates are fixed Doppel defaults, not calibrated forecasts; pension and tax are approximations (`src/lib/finance/pension.ts`) |
| Scenario and counterfactual exploration (20) | Typed what-ifs, Alexia's three paths, Plan A pin, goal solver | Command bar ("Ask your twin a what-if…"), "Pin as Plan A", Alexia's three paths card, Recipes | `npm run ubs:check` (checks 4, 5, 7) | Outcomes depend on the stated assumptions; the paths are the starter kit's illustrative amounts |
| Technical execution and validation (15) | Strict schemas, per-task byte and token caps on the only model route, deterministic checks | Inspector (header badge "Open the Frugal Pipeline Inspector") | `npx tsc --noEmit`; `npx tsx scripts/i18n-check.ts`; `npx tsx scripts/import-check.ts`; `npm run build` then `DOPPEL_SMOKE_PORT=<port> npm run smoke:browser` | Smoke test has no wizard/import steps yet (Task D, drafted only) |
| UX and communication (15) | Results first, details behind disclosures, four languages | Dashboard sections "Decisions", "Next steps", "Habits", "Your data" | Same smoke test (320 px overflow checks, locale switching) | Screenshots not re-checked after the UBS merge |
| Innovation and conceptual depth (15) | Behavioural twin from imported transactions and trades; frugal cascade with a token ledger; solver finds the smallest change | Habits section, Recipes, Inspector with the naive GPT-4o comparison | `npx tsx scripts/engine-check.ts` | Inspector's naive baseline is an estimate unless the live comparison is run |
| Responsible design and transparency (10) | Provenance labels (`ubs_synthetic`, `doppel_default`, `derived`, `user`), fictional data, no stock picks | "Where do these numbers come from?" panel on UBS profiles; Inspector | Read `src/app/api/twin/route.ts`, `src/lib/frugal/ledger.ts`, `docs/UBS.md` field-mapping table | Cloud routes send task payloads to OpenRouter (see below) |

## Five judge questions

**1. Which assumptions most affect the result?**
The market and household defaults live in one dated, sourced table, `BASELINE` in [params.ts](../src/lib/finance/params.ts) (`ASSUMPTIONS` in [monteCarlo.ts](../src/lib/finance/monteCarlo.ts) is built from it): equities 6.5% mean and 16% volatility, bonds 2% / 5%, cash 0.3%, inflation 1.2%, wage growth 1.2%, home price +1.5% / 5%, overdraft 6%. Five named economic scenarios (`ECONOMIES` in [economy.ts](../src/lib/finance/economy.ts)) replace the constants by year: for Barlas the goal odds are 92.0% in the baseline and 88.2% under three years of high inflation; for Meriç 58.7% and 18.7% (`scripts/engine-check.ts`, "Economic scenarios"). Savings rate, risk profile and retirement age are useful sensitivity inputs to explore; their relative influence has not been ranked by a sensitivity study. The mortgage test is driven by price, equity and income. Change one input in the command bar or on a card and compare against a pinned Plan A, so only that input differs. Each UBS parameter is labelled `ubs_synthetic`, `derived` or `doppel_default` in the provenance panel, and the open parameters are listed in `docs/REAL_WORLD_FACTORS.md`.

**2. How does a decision change the financial state?**
A what-if becomes a typed operation (`src/lib/twin/actions.ts`) on the scenario, then the seeded engine re-runs and the odds, chart and cards update. A life decision (child, car, partner, move, education, workload, self-employment) carries its own cash-flow model with sourced Swiss figures, and `outlook()` ([docs/ENGINE_API.md](ENGINE_API.md)) returns what follows: the itemised monthly budget, net worth in 1, 5 and 10 years, the lowest cash point and the goal odds against the plan without the decision. For Barlas, "Have a child in 2028" moves the goal odds from 92.0% to 50.9% and costs CHF 726 a month net over ten years (`scripts/engine-check.ts`, "Life decisions"). Click "Pin as Plan A" first and the chip shows the before/after odds for every change. On Alexia (P00001) the card "Alexia's three paths" shows each path's cash ledger and engine result for "Start working", "Master's degree" and "Move abroad"; "Apply" runs one, "Pin as Plan A" pins another. We do not label the path with the highest net worth as the best life decision; the card shows goal odds, cash-crunch risk and median net worth side by side.

**3. How did you verify the calculations?**
`npx tsx scripts/engine-check.ts` prints the engine numbers for Barlas, Meriç and Oktay, which must stay unchanged unless the engine changes on purpose. `npx tsx scripts/engine-regression.ts` holds one check per audit finding and per feature (same markets after a crash, indexed amounts, the bank test, each life decision's figures, the economic scenarios, and that the itemised budget of `outlook()` equals the simulated cash flow in accounting mode). `npm run ubs:check` runs eight checks, including that the engine in accounting mode reproduces the cash path in `scenario_config.json` for Alexia's three paths and that the built-in accounts match a stored fingerprint. `npx tsx scripts/import-check.ts` checks import round trips and `npx tsx scripts/i18n-check.ts` checks dictionary parity. `docs/BENCHMARK.md` and `docs/VISION_BENCHMARK.md` hold the measured model results and say whether a run was live or offline; we quote them, we do not re-run them for the demo.

**4. What happens when a constraint is violated?**
In the Monte Carlo twin an empty cash balance is borrowed at 6% a year and counted as a cash crunch, which lowers the goal odds and is shown as "Cash-crunch risk". The mortgage test (`src/lib/finance/swissRules.ts`) fails when imputed costs exceed one third of gross income or equity is below 20% of the price, and the affordability card then shows the highest price that passes. For Alexia's paths the card prints "Cash runs out in month N; lowest CHF X" when a path breaches zero. In `/play` the same idea is a rule of the game: under three months of cash is "check" and the player must respond; a payment that becomes impossible is "mate" (the in-app "How it works" text states both).

**5. What would you improve next?**
First, show the life decisions, economic scenarios and the outlook in the dashboard (the engine side is in `docs/ENGINE_API.md`), and source what the engine still asks the user for: rents by canton, the marriage tax effect, self-employed income volatility. Second, finish phases 2 and 3 of `/play` (`docs/PLAY.md`) and port the new web features to Pocket. Third, verify the bank CSV layouts against real exports and measure live misses on the vision benchmark with open-weight models (Task A). The UBS data stays labelled as the starter kit's synthetic input, separate from Doppel's derived estimates, and does not show real-world suitability.

## Responsible design

All people and records are fictional. Every parameter carries a provenance label, and calculated results, assumptions and uncertainty are shown apart. Doppel models asset classes and never recommends individual securities or reasons from hindsight. The deterministic engine does all arithmetic; models read documents, parse free-form what-ifs the local parsers miss, and narrate numbers the engine already computed. `/play` shows luck apart from decision quality: a move is judged on what it could do across simulated futures, not on how the realised year turned out.

What leaves the device, by route (`src/app/api/twin/route.ts` is the only route that calls a model):
- QR decode, cache, local OCR and regex, local what-if parsers, bank CSV and camt.053 parsing, categorisation by dictionary: nothing leaves the browser.
- Small text model (receipt or payslip text up to a few thousand characters, unknown merchants, free-form what-ifs): that text goes to OpenRouter.
- Vision model (floor plans, charts, documents the local route cannot read): a cropped, downscaled image goes to OpenRouter.
- "Explain" narration: name, age, city and the engine's results go to the model (the hint under the button says so). Offline it falls back to a template.
Every call is recorded in the token ledger (`src/lib/frugal/ledger.ts`) and listed in the Inspector, so the privacy boundary for a given action can be read there.

## Three-minute demo (Alexia, P00001)

Alexia is the UBS starter kit's reference profile: age 20, Lausanne, opening cash CHF 8'000 (`data/ubs/alexia-profile.json`). Read numbers off the screen; do not recite them from memory. Start on the dashboard with the built-in Barlas account.

- **0:00–0:30 Initial state.** Click the account switcher in the header (button "Switch account (current: Barlas)"). Choose "Open a UBS profile…", then click the first row, the one tagged "Reference example" (Alexia). Say: "A fictional UBS starter profile. Cash is an input; the odds are an output under assumptions." Open "Where do these numbers come from?" and point at the `UBS data` and `assumption` labels.
- **0:30–1:15 The three paths.** In "Decisions", find "Alexia's three paths". Click "Apply" on "Start working", read the headline odds, then "Apply" on "Master's degree". Click "Pin as Plan A" on one path and "Apply" on another; the Plan A chip now compares them. Say: "These are conditional comparisons under the starter kit's amounts, not a recommendation."
- **1:15–1:45 One snap.** In "Snap to twin" click the sample button for the payslip or receipt (sample list in `src/components/SnapPanel.tsx`). Review the extracted fields on the review card, edit one, confirm. Say that the receipt path ran locally at 0 tokens if the Inspector shows so. If you rely on a payslip, check first that the confirm step changes the twin for Alexia; if it does not, say that and move on.
- **1:45–2:15 `/play`.** Open `/play`, keep Alexia and start a game. Play two moves and read the engine review under the board: the move's label, its loss and the engine's best move. Say: "best means best under the stated assumptions across simulated futures; life decisions are never graded as best." `npm run play:check` runs the game's checks.
- **2:15–2:45 Inspector.** Click the header badge (title "Open the Frugal Pipeline Inspector"). Open the snap entry and show its route and steps. Distinguish local entries (0 tokens) from any measured cloud usage; quote the savings figure only from the Inspector row.
- **2:45–3:00 Validation.** In a prepared terminal run `npm run ubs:check` and say it holds the engine to the starter kit's own cash ledger for Alexia's paths. `npx tsx scripts/engine-check.ts` is the alternative for the built-in accounts.

**60-second offline fallback** (no network): the dashboard, what-if parser, Alexia's paths, Plan A and the Inspector all work offline. Open any account, type one of the example what-ifs ("What if I lose my job for 6 months in 2028?"), read the odds change, and open the Inspector to show the entry is labelled as a local parse. Say that "Explain" will use the offline template and that no cloud call ran. Finish with `npm run ubs:check`.

Warning: `npx tsx scripts/benchmark.ts` and `npx tsx scripts/vision-benchmark.ts` (offline) overwrite `docs/BENCHMARK.md` and `docs/VISION_BENCHMARK.md`, which hold live measurements. Do not run them as a demo step and do not commit their output without a key.

## Assumptions and limits

| Assumption | Value | Source file |
|---|---|---|
| Equity return / volatility | 6.5% / 16% a year | [monteCarlo.ts](../src/lib/finance/monteCarlo.ts) `ASSUMPTIONS` |
| Bond return / volatility | 2% / 5% | same |
| Cash rate / overdraft rate | 0.3% / 6% | same |
| Inflation / wage growth / wage volatility | 1.2% / 1.2% / 1% | same |
| Home price drift / volatility | 1.5% / 5% | same |
| Crash shock; retirement spending vs working life; end age | −30%; 80%; 90 | same |
| Pillar 2 interest | 1.25% | same; mapping in `docs/UBS.md` |
| Mortgage stress rate, maintenance, cost-to-income cap | 5%, 1% of price, 1/3 of gross income | [swissRules.ts](../src/lib/finance/swissRules.ts) |
| Minimum equity (hard minimum), amortisation | 20% (10% hard), to 2/3 of price in 15 years | same |
| Actual mortgage rate for cash flow | 1.8% (10-year fixed; an economic scenario sets the rate of the purchase year) | same; `BASELINE.mortgageRate` in `params.ts` |
| Pillar 3a maximum | CHF 7'258 (without a pension fund: 20% of earned income, at most CHF 36'288) | same |
| AHV maximum pension, full-pension income | CHF 2'520 a month (x13/12), CHF 90'720 | [pension.ts](../src/lib/finance/pension.ts) (2025/26 figures) |
| BVG coordination deduction, conversion rate at 65 | CHF 26'460; 5.5% (blended, below the 6.8% legal minimum on the mandatory part) | same |
| Payslip social deductions, effective tax | see constants; effective tax ≈ half the marginal rate | same |
| UBS profile mapping (gross income, pillar 2, spending, risk 'balanced', retirement 65) | derived or `doppel_default` as labelled | [docs/UBS.md](UBS.md) field table |

Alexia's path amounts come from `data/ubs/scenario_config.json`; the engine adds returns, cash interest, pillar 2 and the habits model on top, and "Moving abroad" assumes no Swiss pension-fund credits (a Doppel assumption).

Known limits:
- All profiles are synthetic; UBS profiles carry no transactions and Doppel invents none, so the habits model uses neutral priors until a statement is imported.
- Bank CSV layouts follow typical exports and were not verified against real exports (the UI says "typical export, unverified").
- Skewed or poor photos can defeat OCR and vision extraction; the review card is where the user corrects them.
- Tax is a rough single-tariff approximation; cantonal and household detail is out of scope. Regional property prices are illustrative.
- Not modelled, and said so in `docs/ENGINE_API.md` §6: the rent rule tied to the reference interest rate (rents follow prices), SARON mortgages (the mortgage is a 10-year fixed), a lottery between economic regimes (the five scenarios are fixed paths, not forecasts), premium subsidies (IPV) and old-age care. The marriage tax effect, rents by canton, a car loan's interest rate and self-employed income have no sourced default: the twin asks for them and does not apply the decision until they are given.
- The assistant (`ask`) only sees figures the engine computed, each under a key that names its unit and time basis. An answer with a number that is not in those figures, or with a figure on the wrong time basis, is discarded. In live tests (EN and TR, `qwen3-30b`) it still attached a correct figure to the wrong thing once; that class of error is not caught.
- Parameters still open in `docs/REAL_WORLD_FACTORS.md`: two claims are marked unverified in `docs/WORKPLAN.md` (BVG minimum rate 2027 and the 29 Nov 2026 VAT vote).
- No benchmark or smoke run was performed in preparing this page.
