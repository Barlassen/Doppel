# Doppel: technical design

## 1. Who does which job

Numbers come from code. Models read documents and language, and only when local code cannot.

| Job | Done by | Model cost |
|---|---|---|
| Read a Swiss QR-bill | `jsQR` at up to four crops/scales + SIX payload parser | 0 tokens |
| Repeat snap of the same image | Local fingerprint cache (`route: "cache"`) | 0 tokens |
| Read clean printed docs (receipts, listings, payslips) | Canvas cleanup + Tesseract.js (`eng+deu+fra`, self-hosted worker) → DE/FR/EN regex (`local-regex`) | 0 tokens |
| Read printed text the regex cannot finish | ≤ 600 chars of filtered OCR lines → small text model (`text-llm`) | output ≤ 160 tokens |
| Read handwriting, dim or blurred photos | 512px grayscale JPEG → small vision model (`vision-llm`), only when OCR confidence < 65% | output ≤ 160 tokens |
| Understand a what-if | Local regex intent parsers (EN/DE/FR/TR) → small model only on a miss | 0, or output ≤ 150 tokens |
| Simulate the future | Monte Carlo in TypeScript, 1,000 paths | 0 tokens |
| Swiss mortgage, pension, 3a rules | Deterministic functions | 0 tokens |
| Fix the plan | Inverse solver over the simulator | 0 tokens |
| Explain the result | Small model given only the engine's final numbers | output ≤ 160 tokens, on demand |

Output caps are the `max_tokens` values in `src/app/api/twin/route.ts`. Measured token totals per call are in the Inspector and in [BENCHMARK.md](BENCHMARK.md). In Node, `scripts/engine-check.ts` prints the simulation time (85 to 175 ms per 1,000-path run on the dev machine) and the solver time (190 to 340 ms).

## 2. Code map

```
src/
  app/
    page.tsx                 → <DoppelApp/>
    api/twin/route.ts        → the only route that calls a model (OpenRouter):
                               extract_text | extract_image | command | narrate | naive_compare
  components/
    DoppelApp.tsx            → state, wiring, ledger
    ConeChart.tsx            → p10–p90 cone + medians (real, disciplined, Plan A), Recharts
    SnapPanel.tsx            → drop / camera / samples → runSnap() → review form
    CommandBar.tsx           → text + browser speech recognition
    Cards.tsx                → timeline, affordability, behaviour, recipes
    Inspector.tsx            → Frugal Pipeline Inspector + live GPT-4o check + header badge
  lib/
    finance/
      types.ts               → Profile, LifeEvent, SimInput / SimResult
      rng.ts                 → mulberry32 + Box–Muller (seeded)
      monteCarlo.ts          → simulate()
      pension.ts             → AHV, BVG credits and conversion
      swissRules.ts          → tragbarkeit(), checkAffordability(), maxAffordablePrice(), 3a
      behavioralEngine.ts    → analyzeBehavior() from transactions + history
      goalSolver.ts          → solveGoal() → recipes
      scenario.ts            → Scenario overrides, habit costs, cost of waiting
    snap/
      pipeline.ts            → the tier cascade (runSnap)
      qrBill.ts              → Swiss QR-bill payload parser
      image.ts               → load, resize, crop to ink, grayscale/contrast, 512px JPEG, fingerprint
      ocr.ts                 → Tesseract worker, line filtering and compression
      heuristics.ts          → DE/FR/EN keyword classifier + regex extractor
    twin/actions.ts          → ops (add / shift / remove / set), validation, extraction → twin update
    twin/intents/            → local what-if parsers per language
    frugal/tokens.ts         → naive baselines (actual image size, GPT-4o tile formula), energy assumptions
    frugal/ledger.ts         → ledger entries + totals() with the exclusion rule
    data/profiles.ts         → Lukas (ZH) and Elena (GE), fictional, 3 months of transactions
scripts/
  make-samples.ts            → the 5 sample documents in public/samples/
  benchmark.ts               → 11 heuristic unit checks + 16-doc benchmark (Node copy of the cascade) → docs/BENCHMARK.md
  engine-check.ts            → finance engine on both profiles and the demo snaps
  browser-smoke.mjs          → headless Chromium run of the real pipeline without a key (pipeline-check.ts calls it)
  e2e-live.mjs               → stage demo with real OpenRouter calls
```

## 3. Snap cascade (`src/lib/snap/pipeline.ts`)

```
image ─► decode; keep a ≤ 2048px JPEG in the browser for the optional GPT-4o check
      ├─► fingerprint cache hit (dHash + 512px checksum) ───────────────► route "cache"       0 tokens
      ├─► Tier 0: jsQR on full ≤1000px, bottom half, bottom-right, full ≤2000px
      │      "SPC/0200…" payload ──► parse QR-bill ───────────────────────► route "qr"          0 tokens
      ├─► resize ≤ 1600px, crop to ink, grayscale + 2–98 percentile stretch
      ├─► Tesseract eng+deu+fra: keep lines with conf ≥ 45, dedupe, ≤ 24 lines, ≤ 600 chars
      │   confidence = min(page confidence, confidence of lines with an amount cue)
      │     ├─► conf ≥ 80, kind known, amount, plus merchant/rooms/location/date ► "local-regex"  0 tokens
      │     ├─► conf ≥ 65 ──► compact text ──► small text model ───────────────► "text-llm"
      │     └─► conf < 65 ──► 512px grayscale JPEG q0.6 ──► small vision model ─► "vision-llm"
      └─► no key or model error: local heuristics ──────────────────────────────► "offline-heuristic" (excluded from savings)
```

- **Extraction schema:** `kind, amount, merchant, date, location, rooms, category, label, year, iban, message`.
- **Result (`SnapResult`):** `tier`, `route`, `outcome` (`ok | partial | failed`), `usageKnown`, optional `fieldsMissing`, and the client-side `naiveImage` for the live GPT-4o check.
- **Review:** every result opens a review form (route, OCR confidence, editable fields). Nothing changes the twin until the user presses *Add to twin*.
- **Mapping (`extractionToUpdate`, `twin/actions.ts`):** listing → house event; receipt → transaction (feeds the behaviour model); bill → recurring cost unless the same amount is already budgeted; payslip → net monthly income (`Nettolohn` / `Salaire net`, never `Bruttolohn`); note → planned expense.

[BENCHMARK.md](BENCHMARK.md) measures a Node copy of this cascade. Its thresholds and OCR languages differ from the code above; the differences are listed there.

## 4. Finance engine

### Monte Carlo (`monteCarlo.ts`, `pension.ts`, `scenario.ts`)
* Monthly steps, 1,000 seeded paths (seed 42), horizon to age 90.
* Equity 6.5% / 16% vol, bonds 2% / 5% vol, cash 0.3%, inflation 1.2%, wage growth 1.2% with career noise,
  home +1.5%/yr with 5%/yr volatility. Equity share by risk profile 30/50/80%; 3a at 45% equity.
* BVG: age credits 7/10/15/18% on the coordinated salary, 1.25% interest.
* Events: house (bought only if the bank test passes in that path; closing costs GE 3% / ZH 1.5%; mortgage cost
  recomputed monthly: interest on the current loan, amortisation down to ⅔, inflated upkeep), child (monthly cost),
  job loss (70% of insured salary, capped at CHF 148,200), raise, crash (−30% equity), one-off expense or income.
* Retirement: AHV (maximum × 13/12 × 90%, from 65), pension-fund annuity (5.5% conversion at 65, 0.15 pp lower per
  year earlier), 3a paid out from 60, savings bridge before 65, spending × 0.8 except housing.
* A cash shortfall sells portfolio; if the portfolio is empty the path records a cash crunch.
* Goal (`GOAL_DEFINITION`): net worth in today's CHF including pillar 2, pillar 3a and home equity ≥ target at goal
  age, with no crunch and the planned home bought.

### Behaviour model (`behavioralEngine.ts`)
* Payday spike: discretionary spend per day in the payday window vs the rest of the month → share of surplus that
  leaks, shown in CHF/month.
* Subscriptions: same merchant in ≥ 2 months.
* Panic selling: with a selling history, a > 15% drawdown triggers selling `drawdownSellPct` of the portfolio,
  bought back only when the market regains its previous peak (at least 6 months). Separate RNG stream, so both twins
  see the same markets.
* "Real you" runs with these habits, "Disciplined you" without. Each habit's cost is measured by switching that one
  habit off (500 paths, `habitCosts()` in `scenario.ts`).

### Swiss rules (`swissRules.ts`)
* `tragbarkeit()` is the single test used by the card and inside the simulator at the purchase month:
  equity ≥ 20% of price (≥ 10% hard, not pillar 2); imputed cost = 5% × loan + 1% × price + (loan − ⅔ price) / 15
  ≤ ⅓ gross income. A 3-month cash buffer is kept out of equity in both places.
* The card shows the median future at the purchase date, the share of futures in which the bank lends, and the max
  price at purchase (binary search).

### Goal solver (`goalSolver.ts`)
* Levers: monthly spending cut (binary search, CHF 0 to 2,500), invest idle cash above the buffer + max 3a, delay
  the home in 6-month steps, delay + spending cut.
* Search uses 300 paths; every recipe is then re-scored on seed 42 and 1,000 paths, so the number on the recipe is
  the headline after *Apply*. Recipes under 80% say "improves to X%".

### Scenarios and Plan A vs Plan B
* A `Scenario` holds events, recurring bills, spending change, monthly investing, risk profile, 3a and retirement age.
* What-if ops (`add`, `shift`, `remove`, `set`) are validated in `twin/actions.ts` and again in the API route.
* Before a what-if, snap or recipe, the previous scenario is pinned as Plan A and simulated on the same seed.

## 5. Model gateway (`/api/twin`)

* OpenRouter, default `google/gemini-2.5-flash-lite` for text and vision (`DOPPEL_TEXT_MODEL`,
  `DOPPEL_VISION_MODEL`). `temperature: 0`, JSON response format except for narration, `usage: { include: true }`.
* Output caps: extraction 160, command 150, narration 160, naive comparison 400.
* Request limits: 12 requests per minute per IP, 6 in flight, body ≤ 3.5 MB, Tier 2 images ≤ 512px and ≤ 1 MB.
* Tasks:
  * `extract_text`: OCR text (≤ 800 chars accepted) → JSON (Tier 1)
  * `extract_image`: 512px grayscale JPEG → JSON (Tier 2)
  * `command`: free-form what-if → JSON ops, validated
  * `narrate`: engine facts (client name, age and city, odds, habit cost, home test, retirement, best recipe) →
    ≤ 3 sentences, told to use only the given numbers
  * `naive_compare`: opt-in from the Inspector; sends the ≤ 2048px image to `openai/gpt-4o` with a prompt asking for
    every financial detail

## 6. Frugality accounting (`src/lib/frugal/`)

* **Our numbers:** OpenRouter `usage` (`prompt_tokens`, `completion_tokens`, `cost`) for model calls; 0 tokens and
  0 bytes for local routes (`qr`, `cache`, `local-regex`, `local-parser`). A response without usage shows
  "usage unknown".
* **Exclusion rule (`totals()`):** savings percentages use only successful entries with known usage. Offline
  fallbacks, failed extractions and responses without usage go to a separate "Excluded from savings" list.
* **Naive snap baseline (estimate until the live check runs):** GPT-4o high-detail at $2.50 / $10.00 per 1M tokens;
  the image's actual size in OpenAI's tile formula (`85 + 170 × tiles` after fitting in 2048² and scaling the short
  side to ≤ 768px) + 160 prompt tokens + 120 output tokens. The live check replaces the estimate with measured usage.
* **Naive command / narration baseline:** GPT-4o asked to do the projection itself, with state capped at 2,400 chars
  (~600 tokens, no raw transactions) + 180 prompt tokens + 350 (what-if) or 220 (narration) output tokens.
  This baseline is never measured live.
* **Energy:** rough estimate only: 0.0006 Wh/token frontier (Epoch AI 2025), 0.0002 Wh/token small model
  (Google 2025), 0.002 Wh per local browser pass. Sources and caveats in `tokens.ts`.

## 7. Next steps

* Fix the benchmark so it times the cascade without the GPT-4o call, and use the app's thresholds and OCR languages.
* Move the simulator to a Web Worker for 10k paths.
* Solver over two levers at once.
* Cantonal tax tables for the 3a saving.
* Keep the twin in IndexedDB and add a monthly check-in view.
