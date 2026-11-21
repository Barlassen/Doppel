# Doppel — Technical Design

## 1. Principle

> **Numbers come from code. Language comes from small models.**

| Job | Who does it | Cost |
|---|---|---|
| Read a Swiss QR-bill | `jsQR` + SIX payload parser | 0 tokens, ~5–40 ms |
| Read printed docs (receipts, listings, payslips) | Canvas cleanup + Tesseract.js (eng+deu, in a web worker) → small text LLM | ~100–200 tokens |
| Read handwriting / messy photos | 512px grayscale JPEG → small VLM (only when OCR confidence < 65%) | a few hundred tokens |
| Understand a what-if | Local regex intent parser → LLM only on miss | 0 or ~150 tokens |
| Simulate the future | Monte Carlo in TypeScript | 0 tokens, ~50 ms |
| Swiss mortgage / 3a rules | Deterministic rules | 0 tokens |
| Fix the plan | Inverse solver over the simulator | 0 tokens, ~100–250 ms |
| Explain the result | Small LLM given only final numbers, `max_tokens: 160` | ~250 tokens, on demand |

## 2. Code map

```
src/
  app/
    page.tsx                 → <DoppelApp/>
    api/twin/route.ts        → the only LLM gateway (OpenRouter): extract_text | extract_image | command | narrate
  components/
    DoppelApp.tsx            → state, wiring, ledger
    ConeChart.tsx            → p10–p90 cone (real) + medians (real vs disciplined), Recharts
    SnapPanel.tsx            → drop/camera/samples → runSnap()
    CommandBar.tsx           → text + Web Speech API (on-device where supported)
    Cards.tsx                → timeline, affordability, behaviour, recipes
    Inspector.tsx            → Frugal Pipeline Inspector + ⚡ badge
  lib/
    finance/
      types.ts               → Profile, LifeEvent, SimInput/SimResult
      rng.ts                 → mulberry32 + Box–Muller (seeded, reproducible)
      monteCarlo.ts          → simulate()
      swissRules.ts          → checkAffordability(), maxAffordablePrice(), 3a
      behavioralEngine.ts    → analyzeBehavior() from transactions + history
      goalSolver.ts          → solveGoal() → 3 recipes
    snap/
      pipeline.ts            → the tier cascade (runSnap)
      qrBill.ts              → Swiss QR-bill payload parser
      image.ts               → load, resize, grayscale/contrast, 512px JPEG
      ocr.ts                 → Tesseract worker, line filtering & compression
      heuristics.ts          → offline regex extraction
    twin/actions.ts          → ops (add/shift/remove), local intent parser, extraction → twin update
    frugal/tokens.ts         → naive baseline estimates (labelled "estimated")
    frugal/ledger.ts         → per-call ledger + totals
    data/profiles.ts         → Lukas (ZH) & Elena (GE), fictional, with 3 months of transactions
```

## 3. Snap-to-Twin cascade

```
image ──► decode + resize (≤1600px)
      ├─► Tier 0: jsQR on ≤1000px ── "SPC/0200…" ? ──► parse QR-bill ──► bill (0 tokens) ✔
      ├─► grayscale + 2–98 percentile contrast stretch
      ├─► Tesseract (eng+deu): keep lines with conf ≥ 45, dedupe, ≤24 lines, ≤600 chars
      │     conf ≥ 65 and ≥ 20 chars ? ──► Tier 1: compact text ──► small LLM (JSON) ✔
      └─► Tier 2: 512px gray JPEG q0.6 (~20 KB) ──► small VLM (JSON) ✔
```

* The extraction schema is tiny: `kind, amount, merchant, date, location, rooms, category, label, year`.
* `extractionToUpdate()` maps it deterministically: listing → house event, receipt/bill → transaction (feeds the
  behavioural twin), payslip → net income, note → planned expense.
* Offline (no key): Tier 1/2 fall back to `heuristics.ts`, logged as `offline`.

Measured on the bundled samples (`scripts/pipeline-check.ts`): QR-bill → Tier 0; listing OCR conf 89 → Tier 1;
receipt 94 → Tier 1; handwritten note 55 → Tier 2.

## 4. Finance engine

### Monte Carlo (`monteCarlo.ts`)
* Monthly steps, 1,000 paths, horizon = max(goal age, retirement age), capped at 40 years.
* Equity 6.5% / 16% vol, bonds 2% / 5% vol, cash 0.3%, inflation 1.2%, wage growth 1.2%, home +1.5%/yr,
  BVG 1.25% + 14% of gross contributions. Portfolio mix by risk profile (30/50/80% equity); 3a at 45% equity.
* Events: house (20% equity drawn from cash → portfolio → 3a → pillar 2; then actual mortgage cost at 1.8% +
  1% upkeep + amortisation replaces rent), child (monthly cost), job loss (70% unemployment insurance),
  raise, crash (−30% equity shock), one-off expense/income.
* Cash shortfalls sell portfolio; if that is empty the path records a **cash crunch**.
* Success = net worth (today's CHF) ≥ goal at goal age **and** no crunch **and** the planned home could be bought.
* Output: yearly p10/p50/p90 bands, success probability, crunch probability, median at goal.

### Behavioural twin (`behavioralEngine.ts`)
* Payday spike: discretionary spend/day in the payday window vs the rest of the month → leakage of surplus.
* Recurring subscriptions: same merchant in ≥ 2 months.
* Panic selling: if history shows selling in the last drawdown → probability of going to cash for 9 months
  when the market is > 15% below its peak. Coin flips use a separate RNG stream so both twins see the same markets.
* "Real you" = simulation with these parameters; "Disciplined you" = without.

### Swiss rules (`swissRules.ts`)
* Equity ≥ 20% of price, ≥ 10% hard (not pillar 2). Extra equity lowers the loan.
* Imputed yearly cost = 5% × loan + 1% × price + (loan − ⅔ price) / 15 ≤ ⅓ gross income.
* `maxAffordablePrice()` binary-searches the highest passing price.
* Equity at purchase date is projected (`projectedHardEquity`): today's liquid assets minus a 3-month buffer plus
  90% of today's surplus.

### Goal solver (`goalSolver.ts`)
* Spend lever: binary search (8 steps, 300 paths each) for the monthly cut that reaches 80%.
* Invest lever: invest idle cash above a 3-month buffer + max 3a.
* Timing lever: earliest 6-month delay at which the home passes the bank test.

## 5. LLM gateway (`/api/twin`)

* OpenRouter, default model `google/gemini-2.5-flash-lite` (override with `DOPPEL_TEXT_MODEL`,
  `DOPPEL_VISION_MODEL`). `temperature: 0`, `response_format: json_object`, `max_tokens` 120–160,
  `usage: { include: true }` so the inspector shows **real** token counts and cost.
* System prompts are one or two lines each. The command prompt only receives `id:label@month` for existing events.
* The narrate prompt receives ~10 final numbers and is told not to introduce new ones.

## 6. Frugality accounting

* **Ours:** the `usage` returned by OpenRouter (0 for local tiers).
* **Naive baseline (estimated, labelled as such):**
  * Snap: full image to a frontier VLM in high-detail tiling (85 + 170 tokens per 512² tile) + ~450 prompt tokens
    + ~350 output tokens, priced at $2.5 / $10 per M tokens.
  * What-if / narration: the whole twin JSON (profile + transaction history) sent to a frontier model that does
    the projection itself, + 700 (or 450) output tokens.

## 7. Next steps / ideas

* Move the simulator to a Web Worker for 10k paths.
* Combine recipes (solver over two levers at once).
* Real Swiss cantonal tax tables for the 3a saving.
* Persist the twin locally (IndexedDB) and add a "monthly check-in" view.
