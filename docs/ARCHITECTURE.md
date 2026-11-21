# Doppel — Technical Design

## 1. Principle

> **Numbers come from code. Language comes from small models — and only when local code cannot do the job.**

| Job | Who does it | Cost |
|---|---|---|
| Read a Swiss QR-bill | Multi-scale `jsQR` + SIX payload parser | 0 tokens, ~5–90 ms |
| Repeat snap of the same image | Local content-hash cache (`route: "cache"`) | 0 tokens, < 5 ms |
| Read clean printed docs (receipts, listings, payslips) | Canvas cleanup + Tesseract.js (`eng+deu` worker) → DE/FR/EN regex fast path (`local-regex`) | 0 tokens, ~0.7–1.9 s |
| Read ambiguous printed text / typed notes | Compact filtered OCR lines (≤ 600 chars) → small text LLM (`text-llm`) | ~150–250 tokens |
| Read handwriting / dim or blurry photos | 512px grayscale JPEG (~11–25 KB) → small VLM (`vision-llm`, only when OCR conf < 65%) | ~380–450 tokens |
| Understand a what-if | Local regex intent parser → small LLM only on miss | 0 or ~150 tokens |
| Simulate the future | Monte Carlo in TypeScript (1,000 paths) | 0 tokens, ~65 ms |
| Swiss mortgage / 3a rules | Deterministic rules | 0 tokens |
| Fix the plan | Inverse solver over the simulator | 0 tokens, ~120–270 ms |
| Explain the result | Small LLM given only final numbers, `max_tokens: 160` | ~220 tokens, on demand |

## 2. Code map

```
src/
  app/
    page.tsx                 → <DoppelApp/>
    api/twin/route.ts        → the only LLM gateway (OpenRouter):
                               extract_text | extract_image | command | narrate | naive_compare
  components/
    DoppelApp.tsx            → state, wiring, ledger
    ConeChart.tsx            → p10–p90 cone (real) + medians (real vs disciplined), Recharts
    SnapPanel.tsx            → drop/camera/samples → runSnap()
    CommandBar.tsx           → text + Web Speech API (on-device where supported)
    Cards.tsx                → timeline, affordability, behaviour, recipes
    Inspector.tsx            → accessible Frugal Pipeline Inspector + live GPT-4o check + ⚡ badge
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
      image.ts               → load, resize, grayscale/contrast, 512px JPEG, naive JPEG (≤2048px)
      ocr.ts                 → Tesseract worker, line filtering & compression
      heuristics.ts          → DE/FR/EN keyword classifier (classifyDoc) + deterministic regex extractor
    twin/actions.ts          → ops (add / shift / remove / set), local intent parser, extraction → twin update
    frugal/tokens.ts         → honest naive baselines (actual dims, GPT-4o tile formula) & energy assumptions
    frugal/ledger.ts         → entry builders (entryFromSnap / entryFromCommand / entryFromNarrate) + totals()
    data/profiles.ts         → Lukas (ZH) & Elena (GE), fictional, with 3 months of transactions
scripts/
  make-samples.ts            → generates 5 bundled SVGs in public/samples/ (incl. Swiss payslip)
  benchmark.ts               → 11 heuristic unit checks + 16-doc clean/degraded benchmark → docs/BENCHMARK.md
  engine-check.ts            → sanity run of finance engine
  pipeline-check.ts          → Node check of QR/OCR cascade on bundled samples
```

## 3. Snap-to-Twin cascade

```
image ──► decode + resize (≤1600px) + optional naive JPEG (≤2048px, kept client-side for on-demand GPT-4o check)
      ├─► Cache hit (same image) ────────────────────────────────────────────────► route: "cache" (0 tokens) ✔
      ├─► Tier 0: multi-scale jsQR ── "SPC/0200…" ? ──► parse QR-bill ──────────► route: "qr" (0 tokens) ✔
      ├─► grayscale + 2–98 percentile contrast stretch
      ├─► Tesseract (eng+deu): keep lines with conf ≥ 45, dedupe, ≤24 lines, ≤600 chars
      │     ├─► conf ≥ 75% & complete structured parse ──► local regex (DE/FR/EN) ► route: "local-regex" (0 tokens) ✔
      │     ├─► conf ≥ 65% and ≥ 20 chars ──► Tier 1: compact text ──► small LLM  ► route: "text-llm" (~200 tok) ✔
      │     └─► conf < 65% ──► Tier 2: 512px gray JPEG q0.6 (~15 KB) ──► small VLM► route: "vision-llm" (~420 tok) ✔
      └─► Offline (no API key): falls back to heuristics.ts ──────────────────────► route: "offline-heuristic" (excluded from savings)
```

* **Extraction schema:** `kind, amount, merchant, date, location, rooms, category, label, year, iban, message`.
* **Result contract (`SnapResult`):** reports `tier`, `route` (`qr | cache | local-regex | text-llm | vision-llm | offline-heuristic`), `outcome` (`ok | partial | failed`), `usageKnown`, optional `fieldsMissing`, and optional client-side `naiveImage` (JPEG ≤ 2048px) so the Inspector can run a live GPT-4o comparison on demand.
* **Deterministic mapping (`extractionToUpdate`):** listing → house event, receipt/bill → transaction (feeds the behavioural twin), payslip → net monthly income (`Nettolohn` / `Salaire net`, never `Bruttolohn`), note → planned expense.
* **Twin ops (`actions.ts`):** supports `add`, `shift`, `remove`, and `set` (e.g. updating income/expenses/parameters deterministically from commands or snaps).

See [docs/BENCHMARK.md](docs/BENCHMARK.md) for measured accuracy, latency, token counts, and unit economics across 16 clean and photo-degraded Swiss documents.

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

* OpenRouter, default small model `google/gemini-2.5-flash-lite` (override with `DOPPEL_TEXT_MODEL`,
  `DOPPEL_VISION_MODEL`). `temperature: 0`, `response_format: json_object`, `max_tokens` 120–160,
  `usage: { include: true }` so the inspector records **real** token counts and cost.
* Tasks:
  * `extract_text` — compressed OCR text → JSON (Tier 1)
  * `extract_image` — 512px grayscale JPEG → JSON (Tier 2)
  * `command` — free-form what-if → JSON ops (`add | shift | remove | set`)
  * `narrate` — ~10 final engine numbers → ≤ 3-sentence banker explanation (no new numbers)
  * `naive_compare` — opt-in live baseline check from the Inspector: sends the original image (≤ 2048px JPEG) with a standard extraction prompt to `openai/gpt-4o` so users and judges can verify token, cost, latency, and extracted-amount parity live.

## 6. Frugality accounting (`src/lib/frugal/`)

Credible accounting is a core requirement — no inflated baselines and no silent 100%-saved claims on failed or offline runs:

* **Ours (measured):** exact OpenRouter `usage` (`prompt_tokens`, `completion_tokens`, `cost`) for cloud calls, and exact `0` tokens / `0 B` sent for local routes (`qr`, `cache`, `local-regex`, `local-parser`). If an LLM response omits token usage (`usageKnown === false`), the UI displays **"usage unknown"** rather than `0 tok` and excludes the entry from savings.
* **Strict inclusion rule (`totals()`):** headline token-% and cost-% savings are computed **only** over successful, measured entries (`mode: "llm"` or `"local"`, `outcome !== "failed"`, `usageKnown === true`). Offline fallbacks (`mode: "offline"`), failed extractions (`outcome: "failed"`), and missing-usage responses are rendered in a separate **"Excluded from savings"** list.
* **Naive snap baseline (estimated until live-compared):**
  * Reference model named explicitly: **GPT-4o high-detail** (`openai/gpt-4o`, $2.50 / $10.00 per 1M tokens).
  * Uses the document's **actual** `width × height` (no synthetic upscaling) in OpenAI's documented 512² tile formula (`85 + 170 × tiles` after fitting within 2048² and scaling shortest side ≤ 768px) + realistic **160** prompt text tokens + **120** JSON completion tokens.
  * Clicking **"Run the naive way (GPT-4o)"** in the Inspector replaces that entry's estimate with a **live measured** `naive_compare` call and checks whether both extracted the same CHF amount.
* **Naive command / narration baseline ("LLM-does-the-maths"):**
  * Models prompting GPT-4o to calculate the projection itself, capping state at **2,400 chars (~600 tokens)** representing a structured profile + events summary (explicitly excluding raw 3-month transaction dumps so the baseline isn't artificially padded) + 180 rule/prompt tokens + 350 output tokens (what-if) or 220 output tokens (narration).
* **Unit economics & rough energy estimate:**
  * Inspector footer computes session **$ per 1,000 snaps** (Doppel vs naive) and a clearly marked **rough Wh estimate** (~0.0006 Wh/tok frontier per Epoch AI 2025; ~0.0002 Wh/tok small model per Google 2025; ~0.002 Wh per local browser pass; flagged as varying 3–5× with hardware and batching).

## 7. Next steps / ideas

* Move the simulator to a Web Worker for 10k paths.
* Combine recipes (solver over two levers at once).
* Real Swiss cantonal tax tables for the 3a saving.
* Persist the twin locally (IndexedDB) and add a "monthly check-in" view.
