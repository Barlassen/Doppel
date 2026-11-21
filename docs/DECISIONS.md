# Doppel: design decisions and jury Q&A

This log records the design decisions found in the code, commit history, and benchmark, followed by questions for stage rehearsal. Where the repository does not record why a specific threshold, formula weight, or scope choice was made, the entry says `Reason: TEAM TO CONFIRM`.

---

## 1. Decision log

### 1. Deterministic TypeScript finance engine instead of LLM arithmetic
* **Decision:** Run all financial projections, Swiss mortgage rules, pension calculations, behavioural habits, and inverse goal solving in deterministic TypeScript (`0` tokens). Use language and vision models only to extract fields from ambiguous documents, parse free-form what-ifs that miss local regex, and narrate numbers the engine already computed.
* **Alternative rejected:** Prompting an LLM with the user's financial profile and asking it to project net worth or evaluate mortgage affordability ("LLM-does-the-maths").
* **Why:** An LLM cannot execute 1,000 monthly stochastic paths reproducibly or auditably, and sending the profile state on every turn costs ~980–1,130 tokens per question (`naiveReasoning()` in `src/lib/frugal/tokens.ts`).
* **Where it lives:** `src/lib/finance/monteCarlo.ts`, `src/lib/finance/swissRules.ts`, `src/lib/finance/pension.ts`, `src/lib/finance/behavioralEngine.ts`, `src/lib/finance/goalSolver.ts`.
* **Measured evidence:** one 1,000-path run to age 90 takes about 0.2 s in Node on our laptop (`scripts/engine-check.ts` prints the time per run; 193–227 ms in our last run) at 0 tokens and $0, with reproducible output on seed 42 (`HEADLINE` in `src/lib/finance/scenario.ts`).

### 2. Four-step multimodal snap cascade (QR -> local OCR + regex -> compact text LLM -> 512px vision LLM)
* **Decision:** Order document readers from cheapest to most expensive:
  1. Tier 0: `jsQR` across up to 4 crops/scales (`<= 1000px` full, bottom half, bottom-right, `<= 2000px` full with inversion) + SIX QR-bill parser (`0` tokens, `0` bytes sent).
  2. Cache: difference hash (`dHash`) + 512px FNV-1a luminance checksum in `localStorage` (`0` tokens).
  3. Tier 1 local: crop to ink, grayscale + 2–98 percentile contrast stretch, Tesseract.js (`eng+deu+fra`) in a Web Worker, and deterministic DE/FR/EN regex extraction (`0` tokens).
  4. Tier 1 cloud: if regex cannot resolve the document and OCR confidence is `>= 65%`, send at most 24 deduplicated lines (`<= 600` chars) to a small text model (`google/gemini-2.5-flash-lite`).
  5. Tier 2 cloud: only when OCR confidence is `< 65%`, compress the cropped image to a `<= 512px` grayscale JPEG (`q = 0.6`, ~11–17 KB) and send it to a small vision model.
* **Alternative rejected:** Sending every uploaded photo at full resolution straight to a frontier vision model (`openai/gpt-4o`), or sending all OCR text to an LLM without a local regex pass.
* **Why:** Swiss QR-bills already encode structured payment data in the QR payload; printed receipts, listings, and payslips follow fixed keyword patterns that regex can extract locally; handwriting and severely blurred photos drop Tesseract confidence below 65%, where only a vision model succeeds.
* **Where it lives:** `src/lib/snap/pipeline.ts`, `src/lib/snap/qrBill.ts`, `src/lib/snap/image.ts`, `src/lib/snap/ocr.ts`, `src/lib/snap/heuristics.ts`.
* **Measured evidence:** In `docs/BENCHMARK.md` (16 documents): 11/16 (69%) resolved at 0 tokens (2 QR, 9 local regex), 1/16 at Tier 1 text LLM (244 tokens), 4/16 at Tier 2 vision LLM (402–451 tokens, 11–17 KB JPEG). Average tokens dropped from 966 (measured live GPT-4o) to 123 (−87.3%), cost per 1,000 docs from $2.61 to $0.02 (−99.2%), with 16/16 amount accuracy on both sides.

### 3. Amount-line OCR confidence penalty and 80% browser local-regex gate (vs 75% in the Node benchmark)
* **Decision:** In `src/lib/snap/ocr.ts`, compute OCR confidence as `min(pageConfidence, amountLineConfidence)` across lines matching `AMOUNT_CUE` (`CHF`, `k`, `Nettolohn`, `Total`, `Kaufpreis`, etc.). In `src/lib/snap/pipeline.ts`, accept `local-regex` only when `confidence >= 80`, `kind !== "other"`, `amount` is valid, and a supporting field (`merchant`, `rooms`, `location`, or `date`) is present.
* **Alternative rejected:** Using Tesseract's raw page-average confidence (`data.confidence`) and a 75% gate, as implemented in `scripts/benchmark.ts`.
* **Why:** Recorded in `src/lib/snap/ocr.ts:129` ("A page average can hide a poorly read amount among clear headings and footers") and commit `cea2853` (hardening the browser cascade against false local accepts). Why `scripts/benchmark.ts` kept the 75% threshold, page-average confidence, and `eng+deu` instead of syncing to the browser's 80% threshold and `eng+deu+fra`: **Reason: TEAM TO CONFIRM** (listed as an open item in `docs/ARCHITECTURE.md` Section 7).
* **Where it lives:** `src/lib/snap/ocr.ts:81,130-131`, `src/lib/snap/pipeline.ts:199-204`, `scripts/benchmark.ts:39-40,592-607`.
* **Measured evidence:** In `docs/BENCHMARK.md`, `receipt-photo-desk` (79% OCR) and `receipt-fr-photo` (75% OCR) resolve locally in the 75% Node benchmark with the right amounts, but would escalate to `text-llm` under the browser app's 80% gate.

### 4. Mandatory human review form before a scan mutates the twin
* **Decision:** Every scan opens `ReviewCard` (`src/components/SnapPanel.tsx`) displaying the tier, route, OCR confidence, and editable fields (`kind`, `amount`, `label`, `merchant`/`creditor`, `date`, `year`, `location`, `rooms`). *Add to twin* is disabled until `kind !== "other"` and `amount > 0`.
* **Alternative rejected:** Mutating the financial twin immediately after OCR or model extraction.
* **Why:** OCR or small models can misread noisy photos or encounter documents without a monetary amount (for example, a note reading only "Sabbatical in 2028"). Letting the user confirm or edit fields prevents bad extractions from silently altering the simulation.
* **Where it lives:** `src/components/SnapPanel.tsx:182-294`, `src/lib/snap/pipeline.ts:89-99`, `src/lib/snap/types.ts:64-68`.
* **Measured evidence:** `scripts/browser-smoke.mjs:167-176,251-275` verifies that editing fields in `ReviewCard` updates the twin with the user's edited values and that a year-only note (`year-only-note.png`) opens with `data-outcome="partial"`, blank amount, and a disabled submit button.

### 5. Single shared `tragbarkeit()` function for the Affordability Card and every Monte Carlo path
* **Decision:** Call the same `tragbarkeit()` function inside every simulated future at the home's purchase month and on the simulator's median purchase-date values for the UI card: `>= 20%` total equity, `>= 10%` hard equity (cash above a 3-month expense buffer + portfolio + pillar 3a, minus cantonal closing costs of 1.5% in ZH or 3% in GE), and imputed annual cost (`5%` stress interest + `1%` maintenance + 15-year amortisation of loan above `2/3` price) `<= 1/3` of gross income. When a path fails `tragbarkeit()`, the household keeps renting and the goal counts as missed (`houseFailed = true`).
* **Alternative rejected:** Checking affordability on today's static balances while the simulator buys the home unconditionally.
* **Why:** Recorded in commit `f114673` and `src/lib/finance/swissRules.ts:11-12`: using one function on purchase-date state ensures the Affordability Card and the headline goal probability never contradict each other.
* **Where it lives:** `src/lib/finance/swissRules.ts:78-107`, `src/lib/finance/monteCarlo.ts:296-328`, `src/components/DoppelApp.tsx:279-292`.
* **Measured evidence:** When Lukas snaps the CHF 940,000 Zürich listing (`scripts/engine-check.ts`), the card shows `FAIL` at `38.0%` cost-to-income (max price at purchase `CHF 823,000`), `boughtProb` drops to `0.0%`, and headline odds drop from `40.3%` to `0.0%`.

### 6. Two-stage inverse goal solver (300-path search, 1,000-path seed-42 re-score) and "improves to" labelling
* **Decision:** Search candidate fixes (binary search on monthly spending cuts CHF 0–2,500, investing idle cash above the 3-month buffer + maxing 3a, delaying the home purchase in 6-month steps up to 120 months, and delay + spending cut combined) using 300 paths on seed 7 with `horizon: "goal"`. Re-score every candidate recipe on `HEADLINE` (`seed: 42, paths: 1000`). Mark recipes below 80% with `reaches: false` ("improves to X%").
* **Alternative rejected:** Displaying 300-path search probabilities directly (which did not match the headline after clicking *Apply*), or presenting a partial improvement as solving the goal.
* **Why:** Recorded in commit `f114673` and `src/lib/finance/goalSolver.ts:34-39`: 300-path goal-horizon search keeps solver latency under ~1 second, while re-scoring on seed 42 / 1,000 paths guarantees that clicking *Apply* produces the exact headline probability advertised on the recipe.
* **Where it lives:** `src/lib/finance/goalSolver.ts`, `src/components/Cards.tsx:223-283`.
* **Measured evidence:** `scripts/engine-check.ts` checks `after === rec.newProb` across all recipes on both profiles (`81.1% ✓ consistent`, `67.3% ✓ consistent`, `81.0% ✓ consistent`, `26.8% ✓ consistent`).

### 7. Separate per-path PRNG streams for markets vs behavioral coin flips
* **Decision:** Seed each Monte Carlo path independently via `pathSeed(seed, path)` (`mulberry32` + Box–Muller in `src/lib/finance/rng.ts`) for market returns and career wage draws, and derive a separate stream (`mulberry32(ps ^ 0x5bd1e995)`) for panic-selling coin flips. Simulate "Real you", "Disciplined you", Plan A, and Plan B on the same seed 42.
* **Alternative rejected:** Using `Math.random()` or a single shared PRNG stream per path (where one behavioral random draw shifts all subsequent market returns).
* **Why:** Recorded in `src/lib/finance/monteCarlo.ts:58,199` and `src/components/PlanCompare.tsx:14-15`: isolating the market stream ensures that "Real you", "Disciplined you", Plan A, Plan B, and `horizon: "goal"` runs see identical market returns in every month of every path.
* **Where it lives:** `src/lib/finance/rng.ts`, `src/lib/finance/monteCarlo.ts:59-65,197-200`, `src/lib/finance/scenario.ts:47-57`.
* **Measured evidence:** Switching off one habit at a time in `habitCosts()` (`scripts/engine-check.ts`) attributes Lukas's gap between 40.3% ("Real you") and 69.6% ("Disciplined you", CHF 131,092 median gap at age 50) into `−24.0 pp` from payday/impulse leakage and `−4.6 pp` from panic selling.

### 8. Behavioural model formulas (payday window, leakage rate, panic-selling probability)
* **Decision:** Measure the payday spike by comparing daily discretionary spending (`dining`, `shopping`, `travel`, `subscriptions`) inside the 9-day payday window (25th to 2nd) against the other 22 days of the month across the 3-month baseline. Map that to `leakageRate = clamp(0.03 + min(0.1, max(0, paydaySpike - 1) * 0.03) + max(0, discretionaryShare - 0.25) * 0.3, 0, 0.3)` and `panicSellProb = soldInDrawdown ? clamp(0.3 + 0.6 * drawdownSellPct, 0, 0.95) : 0.08`, where a `> 15%` equity drawdown triggers selling `drawdownSellPct` into cash until at least 6 months pass and the equity index regains its old peak. Keep newly snapped receipts in `thisMonth` instead of merging them into the 3-month baseline.
* **Alternative rejected:** Letting a single snapped receipt alter the historical 3-month leakage rate, or modelling investors as re-entering equities immediately after a panic sale.
* **Why:** Keeping snapped receipts in `thisMonth` is documented in `src/lib/finance/behavioralEngine.ts:32-34` ("so a single receipt cannot distort the 3-month pattern"). The specific coefficients in `leakageRate` (`0.03`, `0.1`, `0.3`) and `panicSellProb` (`0.3 + 0.6 * drawdownSellPct`, base `0.08`) have no external citation in the repository. **Reason: TEAM TO CONFIRM** (for the specific coefficient values).
* **Where it lives:** `src/lib/finance/behavioralEngine.ts:28-78`, `src/lib/finance/monteCarlo.ts:48,259-274`.
* **Measured evidence:** On Lukas's 3-month history, `analyzeBehavior()` computes a `4.52x` payday spike, `13.0%` surplus leakage (`CHF 397/mo`), 4 recurring subscriptions, and `p = 0.66` panic-sell probability selling `60%` of equities (`scripts/engine-check.ts`).

### 9. Frugality ledger exclusion rule and non-inflated GPT-4o baselines
* **Decision:**
  1. Exclude `offline` fallbacks, `failed` extractions, and responses without provider usage (`usage-unknown`) from headline savings in `totals()` (`src/lib/frugal/ledger.ts`), displaying them in a separate "Excluded from savings" list.
  2. Calculate the estimated naive image baseline from each image's actual pixel dimensions using OpenAI's 512×512 tile formula (`85 + 170 * tiles` after fitting in 2048² and scaling the shortest side to `<= 768px`) + 160 prompt + 120 output tokens (`src/lib/frugal/tokens.ts`).
  3. Cap the profile state in the "LLM-does-the-maths" baseline at 2,400 characters (~600 tokens, excluding raw transaction logs).
  4. Provide an opt-in **"Run the naive way (GPT-4o)"** button in the Inspector that calls `openai/gpt-4o` live and replaces the estimate with measured usage.
* **Alternative rejected:** Counting offline fallbacks as "100% saved", upscaling small images to 2048×2048 before applying the tile formula, or including all 150 raw transaction rows in the reasoning baseline.
* **Why:** Recorded in commits `9f5aa69` and `30978fd`, `src/lib/frugal/ledger.ts:127-137`, and `src/lib/frugal/tokens.ts:63-79`: prevents offline runs or bloated baselines from exaggerating token and cost savings.
* **Where it lives:** `src/lib/frugal/ledger.ts`, `src/lib/frugal/tokens.ts`, `src/components/Inspector.tsx`.
* **Measured evidence:** Live comparison across 16 documents in `docs/BENCHMARK.md` measured 966 average GPT-4o tokens/doc ($0.00261/doc) vs 123 Doppel tokens/doc ($0.000020/doc).

### 10. Default cloud models (`google/gemini-2.5-flash-lite` vs `openai/gpt-4o`)
* **Decision:** Default `DOPPEL_TEXT_MODEL` and `DOPPEL_VISION_MODEL` to `google/gemini-2.5-flash-lite` ($0.10 / $0.40 per 1M input/output tokens) and `DOPPEL_NAIVE_MODEL` to `openai/gpt-4o` ($2.50 / $10.00 per 1M tokens) via OpenRouter.
* **Alternative rejected:** Sending Tier 1/2 calls to a frontier model, or benchmarking the cascade against sending the full image to the same small model (`google/gemini-2.5-flash-lite`).
* **Why:** `gemini-2.5-flash-lite` is used as a low-cost small model for compact text and 512px thumbnails, while `gpt-4o` high-detail models the common default of sending raw uploads to a frontier VLM. Why `docs/BENCHMARK.md` does not also include a `full image -> gemini-2.5-flash-lite` baseline column to separate architecture savings (87.3% fewer tokens) from model-unit-price differences: **Reason: TEAM TO CONFIRM**.
* **Where it lives:** `src/app/api/twin/route.ts:5-7`, `src/lib/frugal/tokens.ts:44-61`.
* **Measured evidence:** In `docs/BENCHMARK.md`, token reduction alone (independent of model price) is `−87.3%` (`123` vs `966` tokens/doc), with `11/16` documents using `0` tokens on any model.

### 11. Self-hosted Tesseract.js runtime and `tessdata_fast` (`eng+deu+fra`)
* **Decision:** Copy `worker.min.js` and the three v7 LSTM WASM loaders (`lstm`, `simd-lstm`, `relaxedsimd-lstm`) from `node_modules` into `public/tesseract/runtime/` on `postinstall` (`scripts/copy-tesseract-assets.mjs`), commit `eng`, `deu`, and `fra` `.traineddata.gz` in `public/tesseract/`, and run OCR in a Web Worker with a 12 s init deadline and 8 s recognition deadline (`src/lib/snap/ocr.ts`).
* **Alternative rejected:** Fetching Tesseract worker scripts and language data from `cdn.jsdelivr.net` at runtime, or running OCR without a timeout.
* **Why:** Recorded in commit `cea2853` and `scripts/browser-smoke.mjs`: avoids third-party network requests during local scans, works offline after page load, and terminates/recreates the worker if recognition hangs or fails.
* **Where it lives:** `scripts/copy-tesseract-assets.mjs`, `src/lib/snap/ocr.ts`, `public/tesseract/`.
* **Measured evidence:** `scripts/browser-smoke.mjs:136-141,284-299,354` aborts all non-localhost requests, verifies `externalRequests` is empty, confirms `/tesseract/{eng,deu,fra}.traineddata.gz` load locally, and verifies recovery after a simulated worker failure.

### 12. Single hardened model gateway (`/api/twin`) with partial-field extraction recovery and dual op validation
* **Decision:** Funnel all model requests through `src/app/api/twin/route.ts` with byte caps (`3.5 MB` request, `256 KB` provider response), PNG/JPEG header dimension checks (`<= 512px` and `<= 1 MB` for Tier 2; `<= 2048px` and `<= 2.6 MB` for naive compare), rate limiting (12 req/min/IP, 6 in flight, 15 s timeout), and XML-delimited data blocks (`<document>`, `<events>`). Parse model JSON with `firstObject()`, keep valid extraction fields while dropping invalid optional ones (`validatedExtraction`), and validate what-if `ops` against `BOUNDS` on both the server (`validatedOps`) and the client (`validateOps` in `src/lib/twin/actions.ts`).
* **Alternative rejected:** Rejecting an entire extraction when an optional field like `category` is invalid, or applying unvalidated LLM ops to the scenario.
* **Why:** Recorded in commits `cea2853`, `279287d`, `30978fd`, and `src/app/api/twin/route.ts:248-252`: small models sometimes wrap JSON in an array or output an unexpected category string; dropping only the bad optional field saves the extracted CHF amount, while `BOUNDS` prevents out-of-range ops from breaking the simulator.
* **Where it lives:** `src/app/api/twin/route.ts`, `src/lib/twin/actions.ts:29-119`.
* **Measured evidence:** `scripts/engine-check.ts:151-163` verifies `validateOps` drops retirement age 40, risk profile `"yolo"`, month 9999, and unknown event IDs; `scripts/browser-smoke.mjs:111-131` verifies HTTP 400 on SVG upload and HTTP 413 on oversized bodies.

### 13. Swiss `Nettolohn` conversion (`×13`, marginal tax) and recurring bill duplicate check
* **Decision:** Match `Nettolohn` / `Salaire net` while excluding `Bruttolohn` / `Total Abzüge` (`src/lib/snap/heuristics.ts:212-215`). Convert monthly `Nettolohn` (after ~13% social deductions, before income tax, paid 13×/year) into annual gross salary and monthly after-tax take-home pay via `payslipToIncome()` (`src/lib/finance/pension.ts:76-92`), taxing the delta against the profile's current income at the marginal tax rate. For recurring bills (`Prämie`, `Krankenkasse`, `monthly`, `quartal`, `jahres`), check `alreadyBudgeted()` (`±5%` match in the same category across `>= 2` months) before adding a recurring expense.
* **Alternative rejected:** Treating a Swiss payslip's `Nettolohn` as after-tax monthly income × 12, or adding every snapped insurance QR-bill on top of existing expenses.
* **Why:** Recorded in `src/lib/finance/pension.ts:69-75` and `src/lib/twin/actions.ts:250-267`: Swiss payslips report pre-tax net pay ( typically 13 salaries/year), and a bill that matches an existing recurring payment in the transaction history is already part of `expensesMonth`.
* **Where it lives:** `src/lib/finance/pension.ts:68-92`, `src/lib/snap/heuristics.ts:210-250`, `src/lib/twin/actions.ts:242-326`.
* **Measured evidence:** In `scripts/engine-check.ts`, snapping the CHF 412 QR-bill for Lukas matches `Health insurance (CHF 412/mo)` and leaves odds unchanged (`40.3% -> 40.3%`), whereas for Elena it adds `CHF 412/month recurring` and lowers odds (`36.3% -> 27.0%`).

### 14. Deterministic Swiss number grouping (`groupCh`) and four-locale 0-token what-if parsers (EN/DE/FR/TR)
* **Decision:** Format Swiss thousands grouping with a deterministic regex helper (`groupCh()` in `src/lib/format.ts` and `src/lib/i18n/index.ts`, producing `1’362’649`) rather than `Intl.NumberFormat("de-CH")`. Render initial SSR HTML in English before applying the saved or browser locale on mount, and provide local 0-token regex what-if parsers in English, Swiss Standard German (`ss`, no `ß`), Swiss French (Romandie), and Turkish (`src/lib/twin/intents/`).
* **Alternative rejected:** Using `Intl.NumberFormat("de-CH")` during SSR and hydration, or routing non-English what-ifs to the LLM.
* **Why:** Recorded in `src/lib/format.ts:1-4` and commit `30978fd`: Node and Chromium output different apostrophe characters for `de-CH` (`'` vs `’`), causing React hydration mismatches. Why Turkish (`tr`) was chosen as the fourth locale alongside `en`, `de`, and `fr`: **Reason: TEAM TO CONFIRM**.
* **Where it lives:** `src/lib/format.ts`, `src/lib/i18n/`, `src/lib/twin/intents/`, `scripts/i18n-check.ts`.
* **Measured evidence:** `npm run i18n:check` passes 487 keys × 4 locales and all localized 0-token intent suites; `scripts/browser-smoke.mjs:300-355` verifies zero hydration errors and 320px layout across EN, DE, FR, and TR.

---

## 2. Likely jury questions and answers

### Q1. Why not just send every photo straight to GPT-4o (or a single vision LLM)?
Because most financial documents do not need vision tokens. A Swiss QR-bill already encodes the exact IBAN, creditor, and CHF amount in its SIX QR payload, which `jsQR` decodes locally in the browser at 0 tokens (`src/lib/snap/qrBill.ts`). Clean printed receipts, property listings, and payslips read at 0 tokens via local Tesseract OCR and regex (`src/lib/snap/heuristics.ts`). In our 16-document benchmark (`docs/BENCHMARK.md`), 11/16 documents resolved locally with 0 bytes leaving the device, cutting average tokens from 966 to 123 (−87.3%) and cost per 1,000 documents from $2.61 to $0.02 (−99.2%) with the same 16/16 amount accuracy. Caveat to say out loud: the benchmark uses a 75% local gate; the app uses 80% plus a second field, so in the app at most 9 of these 16 would stay local (Q10).

### Q2. Why not send the full image to Gemini 2.5 Flash-Lite every time instead of building a 4-tier cascade?
Two reasons: privacy and token volume. First, for the 11/16 documents resolved at Tier 0 (`qr`) and Tier 1 (`local-regex`), zero bytes leave the browser, so a client's payslip, address and IBAN stay on their device (`src/lib/snap/pipeline.ts`). Second, volume: only 5 of 16 documents make a cloud call at all, and those send at most 600 characters of text (244 tokens in the benchmark) or a 512px grayscale JPEG (11–17 KB, 402–451 tokens). Tokens drop by 87.3% against GPT-4o. We did not measure "full image to Flash-Lite" as a separate baseline (Decision 10), so we cannot say how much of the saving is the cascade and how much is the cheaper model.

### Q3. How do we know your token and cost savings numbers are real and not a rigged baseline?
Three checks in the code:
1. Offline fallbacks, failed extractions, and responses missing OpenRouter `usage` are excluded from headline savings by `exclusionReason()` in `src/lib/frugal/ledger.ts:132-137` and listed separately under *Excluded from savings*.
2. Our estimated GPT-4o baseline (`naiveSnap()` in `src/lib/frugal/tokens.ts:24-38,94-108`) uses each image's actual pixel dimensions (no upscaling) in OpenAI's 512×512 tile formula (`85 + 170 * tiles`) plus 160 prompt and 120 completion tokens, and `naiveReasoning()` caps twin state at 2,400 chars (~600 tokens) instead of dumping 150 raw transactions.
3. Both the benchmark (`docs/BENCHMARK.md`) and the in-app **Run the naive way (GPT-4o)** button (`src/components/Inspector.tsx:172-218`) call `openai/gpt-4o` live via OpenRouter and report the measured token count, cost, and extracted amount.

### Q4. What happens when local OCR or the model misreads an amount?
Two layers catch it. First, inside the cascade (`src/lib/snap/ocr.ts:130-131` and `src/lib/snap/pipeline.ts:199-204`), OCR confidence is penalized by the lowest-confidence line containing an amount cue, and `local-regex` is only accepted when confidence is `>= 80%` and a second structural field (`merchant`, `rooms`, `location`, or `date`) is extracted; payslips explicitly match `Nettolohn`/`Salaire net` and exclude `Bruttolohn`/`Total Abzüge` (`src/lib/snap/heuristics.ts:212-215`). Second, every scan opens `ReviewCard` (`src/components/SnapPanel.tsx:182-294`) before touching the twin: the user sees the extracted fields, can edit any number, and must click *Add to twin* (which is disabled if the amount is missing, as tested by `year-only-note.png` in `scripts/browser-smoke.mjs:251-275`).

### Q5. Why use a 1,000-path Monte Carlo simulator instead of a single compound-interest projection?
A single average-return curve hides sequence-of-returns risk, cash crunches, and path-dependent gates like the Swiss bank affordability test (`tragbarkeit()` in `src/lib/finance/swissRules.ts`) and panic selling in `> 15%` drawdowns (`src/lib/finance/monteCarlo.ts:258-274`). In our simulator, `tragbarkeit()` runs inside every path at the purchase month using that future's equity and salary; if a market dip before month 24 erodes equity below 20%, the bank refuses the loan in that path. Similarly, retirement sustainability depends on whether savings survive bad early-retirement years (`depletionAgeP10` in `src/lib/finance/monteCarlo.ts:446-461`), which a single mean projection cannot compute.

### Q6. Why doesn't the LLM compute the financial projection or the "Find my path" recommendations?
Because financial rules and inverse search require exact consistency across runs. `solveGoal()` (`src/lib/finance/goalSolver.ts`) runs a binary search over monthly spending cuts and 6-month home-purchase delays across hundreds of simulated futures, then re-scores each candidate recipe on seed 42 and 1,000 paths (`HEADLINE`). When the user clicks *Apply*, the hero headline lands on the exact percentage shown on the recipe card (`81.0% -> 81.0%`, verified by `npx tsx scripts/engine-check.ts`). An LLM guessing a spending cut would neither obey Swiss `Tragbarkeit` math nor match the simulator when applied.

### Q7. How does the Behavioural Twin measure the cost of habits, and why are "Real you" and "Disciplined you" comparable?
`analyzeBehavior()` (`src/lib/finance/behavioralEngine.ts`) scans the profile's 3-month transaction history for a payday spending spike (days 25–2 vs days 3–24), recurring subscriptions (same merchant in `>= 2` months), and past drawdown selling (`history.soldInDrawdown`). `simulate()` then runs twice on seed 42: once without behavioral parameters ("Disciplined you") and once with them ("Real you"). Because `monteCarlo.ts:197-200` uses a separate PRNG stream for behavioral coin flips, both twins face identical market returns in every month of all 1,000 paths. For Lukas, habits drop goal odds from `69.6%` to `40.3%` and cost `CHF 131,092` at age 50 (`−24.0 pp` from payday leakage, `−4.6 pp` from panic selling).

### Q8. How accurate is your Swiss financial modelling (mortgages, AHV, BVG, 3a, taxes)?
It implements standard Swiss planning rules and states its approximations openly (`src/lib/finance/swissRules.ts`, `src/lib/finance/pension.ts`):
* **Mortgages (`tragbarkeit`):** 20% minimum equity, `>= 10%` hard equity (not Pillar 2), 3-month cash buffer reserved, cantonal closing costs (ZH 1.5%, GE 3%) paid from hard equity, 5% stress interest + 1% upkeep + 15-year amortisation down to `2/3` price `<= 1/3` gross income, and 1.8% actual mortgage rate in cash flow.
* **Pillar 1 (AHV):** 2025/26 max single pension CHF 2,520/mo scaled by income, `× 13/12` for the 13th AHV pension, `× 90%` gap factor, paid from age 65.
* **Pillar 2 (BVG):** coordination deduction CHF 26,460, age credits 7/10/15/18%, 1.25% interest, 5.5% blended conversion rate at 65 (−0.15 pp per year of early retirement), credits paused during unemployment.
* **Pillar 3a & payslips:** CHF 7,258/yr limit, marginal-rate tax refund credited annually, 6% withdrawal tax from age 60; payslip `Nettolohn` converted via 13 salaries and ~13% social deductions (`payslipToIncome()`).

### Q9. What data leaves the user's device on each action?
The Inspector (`src/components/Inspector.tsx`) records `bytesSent` and the exact payload for every call:
* **0 bytes leave the browser** for Tier 0 QR-bills, repeat-image cache hits, Tier 1 local-regex scans, local what-if commands (EN/DE/FR/TR), and all Monte Carlo / affordability / solver runs. Even Tesseract's worker and `.traineddata.gz` files are self-hosted in `public/tesseract/` (`scripts/browser-smoke.mjs` verifies zero external network requests).
* **<= 600 characters of filtered OCR text** (never the image) leave the browser on a Tier 1 `text-llm` scan.
* **A `<= 512px` grayscale JPEG (~11–17 KB)** (never the full-resolution photo) leaves the browser on a Tier 2 `vision-llm` scan.
* **Aggregate summary numbers only** (never raw transactions or IBANs) leave the browser when the user clicks *Explain my situation* (`narrate` task in `src/components/DoppelApp.tsx:413-426`).

### Q10. What are the main limitations of your current prototype and benchmark?
We list five in `README.md`, `docs/PITCH.md`, and `docs/BENCHMARK.md`:
1. **Benchmark vs browser gate:** `scripts/benchmark.ts` runs a Node mirror with `eng+deu`, page-average OCR confidence, and a 75% `local-regex` threshold; the browser app uses `eng+deu+fra`, `min(pageConfidence, amountLineConfidence)`, and an 80% threshold, which would send at least 2 of the 11 local benchmark documents (75% and 79% OCR) to `text-llm`.
2. **Benchmark latency column:** `runDoc()` in `scripts/benchmark.ts` starts the timer before the live GPT-4o baseline call, so the `Latency` column in `docs/BENCHMARK.md` includes both GPT-4o and the Doppel cascade.
3. **Synthetic evaluation set:** All 16 benchmark documents are synthetic SVGs and `sharp`-degraded JPEGs, not real camera photos.
4. **Energy figures:** Wh numbers (`0.0006 Wh/tok` frontier, `0.0002 Wh/tok` small model, `0.002 Wh` local pass in `src/lib/frugal/tokens.ts`) are order-of-magnitude estimates from published averages, not hardware measurements.
5. **Single-lever solver:** `solveGoal()` searches single levers plus one delay + spending-cut combination, and runs on the main thread (1,000 paths chunked via `setTimeout` in `DoppelApp.tsx`) rather than in a Web Worker.
