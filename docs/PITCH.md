# Doppel: demo script and pitch notes

Three minutes. Write your own sentences; this file gives the order, what to click, and the numbers with their source. Rehearse the questions in [DECISIONS.md](DECISIONS.md).

Before going on stage: `npm run build && npm start` with `OPENROUTER_API_KEY` in `.env.local`, open the app on Meriç's account (header switcher), clear the scan cache (`localStorage` key `doppel:snap-cache:v1`, otherwise repeat samples show route "Cache"), and run `npx tsx scripts/engine-check.ts` once to confirm the numbers below have not moved.

## Demo steps

### 1. Meriç today (about 25 s)

Click: switch the header account to Meriç.

On screen: Meriç, 27, Lausanne, CHF 92k gross, goal CHF 400k net worth by 40 with a flat in Renens. Headline 9%. "Disciplined you" 25%. Behaviour card.

Points to make:
- The 9% and the 25% are the same person in the same simulated markets. The difference is her habits, taken from five months of (fictional) transactions and trades.
- The behaviour card finds a payday spending spike of 1.8x, 5 subscriptions (two video and two music services overlap), food delivery 8 times a month, and that she sold 37% of her equities in the August 2026 drawdown. Payday spending costs 14 points. Median cost by age 40: CHF 25,100. Her flat is priced in today's CHF (CHF 540,000) and costs CHF 582,000 at the purchase date in five years; the bank lends in 12% of futures.
- Switch to Barlas (on track, 91%) and Oktay (off track, 0%) to show that every screen follows the account's own data.
- No model was called. This is 1,000 Monte Carlo paths in TypeScript.

Source: `scripts/engine-check.ts` prints 8.7% / 24.8%, leakage −14.2 pp, home bought in 12.1% of futures. Spike 1.82x, 5 subscriptions and CHF 25,089 come from `analyzeBehavior()` and `ideal.medianAtGoal − real.medianAtGoal` (`src/components/DoppelApp.tsx`, `behaviorCost`).

### 2. Snap a flat listing (about 40 s)

Click: sample **Listing** (4.5 rooms, 8050 Zürich, CHF 940,000). A review card appears with route "Local regex" and the OCR confidence. Click **Add to twin**.

On screen: odds go from 9% to 0%. The bank affordability card turns red.

Points to make:
- The listing was read by local OCR and regex. Zero tokens, nothing left the browser.
- Nothing entered the twin until Meriç confirmed the fields.
- The card runs the Swiss affordability rule (5% stress rate, 1% upkeep, amortisation, at most a third of gross income). At the purchase date the home costs CHF 1,013,000 (CHF 940,000 today, grown with home prices) and her cost would be 73% of gross income. She is CHF 115,533 a year short; the most she could buy then is CHF 563,000.
- The same function runs inside every simulated future. In none of them does the bank lend, so the goal fails in all of them.

Source: `engine-check.ts` "after snapping the 940k Zürich listing": card FAIL 72.7%, max price CHF 563,000, bought in 0.0% of futures. The CHF 115,533 is `incomeGap` from `tragbarkeit()` in `src/lib/finance/swissRules.ts`. Browser route: `scripts/browser-smoke.mjs` asserts the listing resolves via `local-regex`.

### 3. Find my path (about 20 s)

Point at the **Find my path** card.

Points to make:
- The solver searches a fixed set of levers (spending cut, investing idle cash, delaying the purchase, delay plus cut). With the CHF 940k listing no lever reaches the goal, and the card says "improves to" instead of pretending it solves the problem.
- Remove the listing (✕ on the timeline) to go back to her flat in Renens. Now two recipes reach 80%: spend CHF 470 a month less (83%), or buy 18 months later and spend CHF 400 a month less (82%). Investing the CHF 3k idle cash and maxing out 3a improves the odds to 50%; buying 18 months later alone to 48%. They are the best of those levers, not a proof that no better plan exists.
- Each recipe is re-scored on the same 1,000 paths as the headline, so after **Apply** the headline shows the same number. Plan A stays on the chart as a dotted line.

Source: `engine-check.ts` lists Meriç's recipes with "applied headline 83.3% ✓ consistent" and "82.4% ✓ consistent", and after the listing "improves to 0.0%".

### 4. One what-if (about 15 s)

Click the chip "What if I lose my job for 6 months in 2028?".

Points to make:
- The local parser handled it. The command bar says "Parsed locally · 0 tokens".
- If you have time, type a phrase the parser does not know, such as "my partner moves in and pays 1200 of the rent". That one goes to the small model, which may only return validated settings (here `expenseDelta −1200`). The engine does the rest. The Inspector shows the real token count of that call.

Source: local parser output in `engine-check.ts` ("Local parser" section). Op validation in `src/lib/twin/actions.ts` (`validateOps`) and `src/app/api/twin/route.ts` (`validatedOps`).

### 5. The Inspector (about 60 s)

Click the token badge in the header to open the Frugal Pipeline Inspector. Snap three samples in a row:

1. **QR-bill** (CHF 412). Route "QR · local". jsQR decodes the Swiss payment QR in the browser. Zero tokens, zero bytes sent.
2. **Receipt** (CHF 87.45) or **Payslip** (Nettolohn CHF 8,650). Route "Local regex". The payslip reader takes Nettolohn, not Bruttolohn.
3. **Note** (handwritten, "Sabbatical Japan, summer 2028, ≈ 25k"). OCR confidence falls under 65%, so a 512px grayscale JPEG goes to a small vision model. Show the image preview in the Inspector: this is everything that left the device.

Then expand one entry and click **Run the naive way (GPT-4o)**. This sends a JPEG of the document, capped at 2048px, to GPT-4o live and shows its tokens, cost and amount next to ours.

Points to make:
- Offline fallbacks and failed calls are listed separately and never counted as savings.
- The GPT-4o estimate uses the real image size and OpenAI's tile formula until the live check replaces it.

Source: browser routes asserted in `scripts/browser-smoke.mjs` (receipt, listing, payslip `local-regex`; note Tier 2). Exclusion rule in `totals()`, `src/lib/frugal/ledger.ts`. Tile formula in `src/lib/frugal/tokens.ts`.

### 6. Close with the benchmark (about 20 s)

Points to make, from [BENCHMARK.md](BENCHMARK.md), live run on 16 synthetic Swiss documents (7 clean, 9 degraded to look like phone photos):
- 16/16 amounts correct, within the benchmark's tolerance of CHF 0.05 or 0.5%. GPT-4o with the whole image: also 16/16. Only the amount is scored, not every field. On this set the difference is cost, not accuracy.
- 11 of 16 read with 0 tokens.
- 123 tokens per document against 966 (−87%). $0.02 against $2.61 per 1,000 documents.
- Say the limits out loud (next section).

## UBS: AI Financial Twin

- The twin is a simulation, not a chatbot: monthly steps to age 90 with salary noise, market crashes, BVG age credits, pillar 3a, AHV with the 13th pension, and the Swiss affordability rule at the purchase date.
- The behaviour model makes the gap between "Real you" and "Disciplined you" measurable in points and CHF.
- Retirement: Oktay (26, Basel) saves almost nothing. Retiring at 65, his savings last to 90 in 0.0% of futures; in the worst 10% they run out at 65 (`engine-check.ts`, "Oktay retire at").
- Every number is reproducible: fixed seed 42, 1,000 paths (`src/lib/finance/scenario.ts`, `HEADLINE`). Market and behaviour parameters are our assumptions, not calibrated on real clients, so the probabilities are outcomes of the model, not forecasts.

## AXA: frugal multimodal AI

- Cheapest reader first: QR decode, then local OCR and regex, then a text model on at most 600 characters, then a grayscale JPEG capped at 512px to a small vision model only when OCR confidence is under 65% or OCR fails (`src/lib/snap/pipeline.ts`).
- What leaves the device: nothing for QR, cache, local regex and the engine. OCR text (max 600 characters) for the text model. A 512px grayscale JPEG for the vision model (11 to 17 KB in the benchmark). For the banker summary: the engine's final numbers plus the profile's name, age and city.
- Accounting: token counts come from OpenRouter's `usage` field. Calls without usage data show "usage unknown" and are excluded.

## Limits we state

- **Benchmark vs app.** The benchmark runs a Node copy of the cascade (`scripts/benchmark.ts`). It uses Tesseract `eng+deu` (the app adds `fra`), uses page-average OCR confidence (the app takes the minimum of page confidence and amount-line confidence in `src/lib/snap/ocr.ts`), and accepts local regex at 75% OCR confidence (the app needs 80% plus a second field). The two receipts recorded at 75% and 79% do not meet the app's gate on those scores. Because the OCR setup differs too, we cannot give the app's local share on this set without re-measuring it.
- **Latency.** The Doppel latency column in BENCHMARK.md includes the GPT-4o baseline call, because the timer starts before it. So we have no fair latency comparison. Local OCR is CPU-bound and takes seconds; do not claim Doppel is faster.
- **Test set.** 16 synthetic documents that we generated. No real user photos.
- **Energy.** The Wh figures use fixed per-token coefficients from `src/lib/frugal/tokens.ts`. Nothing was measured, and the published reports behind them give per-query figures, not per-token rates for this pipeline.
- **In-app GPT-4o check.** The live button sends a JPEG capped at 2048px with a different prompt ("extract every financial detail", up to 400 output tokens) than the benchmark's baseline. Its token count can differ from the benchmark's 966 per document.
