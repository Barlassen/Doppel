# Doppel: demo script and pitch notes

Three minutes. Write your own sentences; this file gives the order, what to click, and the numbers with their source. Rehearse the questions in [DECISIONS.md](DECISIONS.md).

Before going on stage: `npm run build && npm start` with `OPENROUTER_API_KEY` in `.env.local`, open the app on the Lukas profile, clear the scan cache (`localStorage` key `doppel:snap-cache:v1`, otherwise repeat samples show route "Cache"), and run `npx tsx scripts/engine-check.ts` once to confirm the numbers below have not moved.

## Demo steps

### 1. Lukas today (about 25 s)

Click: nothing. The Lukas profile loads.

On screen: Lukas, 31, Zürich, CHF 142k gross, goal CHF 1.4M net worth by 50. Headline 40%. "Disciplined you" 70%. Behaviour card.

Points to make:
- The 40% and the 70% are the same person in the same simulated markets. The difference is his habits, taken from three months of (fictional) transactions.
- The behaviour card finds a payday spending spike of 4.5x and 4 subscriptions, and his history of selling 60% of his equities in a drawdown. Payday spending costs 24 points, panic selling about 5 points. Median cost by age 50: CHF 131,000.
- No model was called. This is 1,000 Monte Carlo paths in TypeScript.

Source: `scripts/engine-check.ts` prints 40.3% / 69.6%, leakage −24.0 pp, panic −4.6 pp. Spike 4.52x, 4 subscriptions and CHF 131,092 come from `analyzeBehavior()` and `ideal.medianAtGoal − real.medianAtGoal` (`src/components/DoppelApp.tsx`, `behaviorCost`).

### 2. Snap a flat listing (about 40 s)

Click: sample **Listing** (4.5 rooms, 8050 Zürich, CHF 940,000). A review card appears with route "Local regex" and the OCR confidence. Click **Add to twin**.

On screen: odds go from 40% to 0%. The bank affordability card turns red.

Points to make:
- The listing was read by local OCR and regex. Zero tokens, nothing left the browser.
- Nothing entered the twin until Lukas confirmed the fields.
- The card runs the Swiss affordability rule (5% stress rate, 1% upkeep, amortisation, at most a third of gross income). At the purchase date his cost would be 38% of gross income. He is CHF 20,546 a year short; the most he could buy then is CHF 823,000.
- The same function runs inside every simulated future. In none of them does the bank lend, so the goal fails in all of them.

Source: `engine-check.ts` "after snapping the 940k Zürich listing": card FAIL 38.0%, max price CHF 823,000, bought in 0.0% of futures. The CHF 20,546 is `incomeGap` from `tragbarkeit()` in `src/lib/finance/swissRules.ts`. Browser route: `scripts/browser-smoke.mjs` asserts the listing resolves via `local-regex`.

### 3. Find my path (about 20 s)

Point at the **Find my path** card.

Points to make:
- The solver searches the simulator for the smallest change. Best result: buy 30 months later and spend CHF 1,200 a month less, which gives 81%.
- Delay alone only gets to 27%, and the card says "improves to" instead of pretending it solves the problem.
- Each recipe is re-scored on the same 1,000 paths as the headline, so after **Apply** the headline shows the same number. Plan A stays on the chart as a dotted line.

Source: `engine-check.ts` lists both recipes with "applied headline 81.0% ✓ consistent" and "26.8%".

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

Then expand one entry and click **Run the naive way (GPT-4o)**. This sends the original image to GPT-4o live and shows its tokens, cost and amount next to ours.

Points to make:
- Offline fallbacks and failed calls are listed separately and never counted as savings.
- The GPT-4o estimate uses the real image size and OpenAI's tile formula until the live check replaces it.

Source: browser routes asserted in `scripts/browser-smoke.mjs` (receipt, listing, payslip `local-regex`; note Tier 2). Exclusion rule in `totals()`, `src/lib/frugal/ledger.ts`. Tile formula in `src/lib/frugal/tokens.ts`.

### 6. Close with the benchmark (about 20 s)

Points to make, from [BENCHMARK.md](BENCHMARK.md), live run on 16 synthetic Swiss documents (7 clean, 9 degraded to look like phone photos):
- 16/16 amounts correct. GPT-4o with the whole image: also 16/16. Accuracy is equal; the difference is cost.
- 11 of 16 read with 0 tokens.
- 123 tokens per document against 966 (−87%). $0.02 against $2.61 per 1,000 documents.
- Say the limits out loud (next section).

## UBS: AI Financial Twin

- The twin is a simulation, not a chatbot: monthly steps to age 90 with salary noise, market crashes, BVG age credits, pillar 3a, AHV with the 13th pension, and the Swiss affordability rule at the purchase date.
- The behaviour model makes the gap between "Real you" and "Disciplined you" measurable in points and CHF.
- Retirement: Elena (44, Geneva) wants to retire at 58. Her money lasts to 90 in 30% of futures; at 62 it is 74% (`engine-check.ts`, "Elena retire at").
- Every number is reproducible: fixed seed 42, 1,000 paths (`src/lib/finance/scenario.ts`, `HEADLINE`).

## AXA: frugal multimodal AI

- Cheapest reader first: QR decode, then local OCR and regex, then a text model on at most 600 characters, then a 512px grayscale image to a small vision model only when OCR confidence is under 65% (`src/lib/snap/pipeline.ts`).
- What leaves the device: nothing for QR, cache, local regex and the engine. OCR text (max 600 characters) for the text model. A 512px grayscale JPEG for the vision model (11 to 17 KB in the benchmark). For the banker summary: the engine's final numbers plus the profile's name, age and city.
- Accounting: token counts come from OpenRouter's `usage` field. Calls without usage data show "usage unknown" and are excluded.

## Limits we state

- **Benchmark vs app.** The benchmark runs a Node copy of the cascade (`scripts/benchmark.ts`). It uses Tesseract `eng+deu` (the app adds `fra`) and accepts local regex at 75% OCR confidence; the app needs 80% plus a second field. With the app's gate at least two of the 11 local documents (OCR 75% and 79%) would go to the text model, so the app's local share on this set is at most 9/16. Not re-measured.
- **Latency.** The Doppel latency column in BENCHMARK.md includes the GPT-4o baseline call, because the timer starts before it. So we have no fair latency comparison. Local OCR is CPU-bound and takes seconds; do not claim Doppel is faster.
- **Test set.** 16 synthetic documents that we generated. No real user photos.
- **Energy.** The Wh figures are rough estimates from published per-token averages, not measurements.
- **In-app GPT-4o check.** The live button uses a longer prompt ("extract every financial detail", up to 400 output tokens) than the benchmark's baseline prompt. Its numbers will be higher than the benchmark's 966 tokens per document.
