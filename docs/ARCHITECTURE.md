# Doppel: technical design

## 1. Who does which job

Numbers come from code. Models read documents and language, and only when local code cannot.

| Job | Done by | Model cost |
|---|---|---|
| Read a Swiss QR-bill | `jsQR` at up to four crops/scales + SIX payload parser | 0 tokens |
| Repeat snap of the same image | Local fingerprint cache (`route: "cache"`) | 0 tokens |
| Read clean printed docs | Canvas cleanup + Tesseract.js (`eng+deu+fra`, self-hosted worker) → local regex, with an item sum check for receipts | 0 tokens |
| Read printed text the regex cannot finish | ≤ 600 chars of filtered OCR lines → small text model (`text-llm`) | output ≤ 160 tokens |
| Recover receipt fields from readable OCR | Up to 2,800 chars of OCR text with the receipt schema → small text model (`text-llm`, Tier 2) | output ≤ 2,200 tokens |
| Read handwriting, dim or blurred photos | Grayscale JPEG capped at 512px → small vision model (`vision-llm`) when OCR is unusable | output ≤ 2,200 tokens |
| Understand a what-if | Local regex intent parsers (EN/DE/FR/TR) → small model only on a miss | 0, or output ≤ 150 tokens |
| Simulate the future | Monte Carlo in TypeScript, 1,000 paths | 0 tokens |
| Swiss mortgage, pension, 3a rules | Deterministic functions | 0 tokens |
| Fix the plan | Inverse solver over the simulator | 0 tokens |
| Explain the result | Small model given only the engine's final numbers | output ≤ 160 tokens, on demand |

Output caps are the `max_tokens` values in `src/app/api/twin/route.ts`. Measured token totals per call are in the Inspector and in [BENCHMARK.md](BENCHMARK.md). In Node, `scripts/engine-check.ts` prints the simulation and solver time on the machine running it (about 0.2 s per 1,000-path run and 0.4 to 0.8 s per solver call in our last run on a laptop).

## 2. Code map

```
src/
  app/
    page.tsx                 → <DoppelApp/>
    api/twin/route.ts        → the only route that calls a model (any OpenAI-compatible endpoint, OpenRouter by default):
                               extract_text | extract_image | extract_floorplan | extract_chart | command | narrate |
                               ask | categorize | naive_compare; GET = connection status
    api/twin/guard.ts        → rate limit, daily budget, same-origin check
    api/twin/provider.ts     → endpoint config from env, usage normalisation, JSON-mode fallback
    api/twin/grounding.ts    → `ask` post-check: no number that the facts do not contain
  components/
    DoppelApp.tsx            → state, wiring, ledger, one session per account
    AccountSwitcher.tsx      → header account menu (initials, name, net worth, reset)
    ConeChart.tsx            → p10–p90 cone + medians (real, disciplined, Plan A), Recharts
    SnapPanel.tsx            → drop / camera / samples → runSnap() → review form
    CommandBar.tsx           → text + browser speech recognition
    Cards.tsx                → timeline, affordability, behaviour, recipes
    InvestControls.tsx       → risk profile, pillar 3a toggle, standing order, cost-of-waiting strip
    PlanCompare.tsx          → Plan A pin / auto-pin comparison chip
    RetirementCard.tsx       → retirement age stepper, AHV + BVG breakdown, depletion odds to age 90
    Inspector.tsx            → Frugal Pipeline Inspector + live GPT-4o check + header badge
  lib/
    finance/
      types.ts               → Profile, LifeEvent, SimInput / SimResult
      rng.ts                 → mulberry32 + Box–Muller (seeded)
      monteCarlo.ts          → simulate()
      pension.ts             → AHV, BVG credits and conversion
      swissRules.ts          → tragbarkeit(), checkAffordability(), maxAffordablePrice(), 3a
      behavioralEngine.ts    → analyzeBehavior() from transactions + history
      investBehavior.ts      → investShare, 3a and drawdown selling derived from trades (illustrative index)
      goalSolver.ts          → solveGoal() → recipes
      scenario.ts            → Scenario overrides, habit costs, cost of waiting
    snap/
      pipeline.ts            → the tier cascade (runSnap)
      qrBill.ts              → Swiss QR-bill payload parser
      image.ts               → load, resize, crop to ink, grayscale/contrast, 512px JPEG, fingerprint
      ocr.ts                 → Tesseract worker, line filtering and compression
    heuristics.ts          → keyword classifier + regex extraction for each document kind
    receipt.ts             → DE/FR/EN/IT receipt lines, strict model validation, and cent-based reconciliation
    twin/actions.ts          → ops (add / shift / remove / set), validation, extraction → twin update
    twin/intents/            → local what-if parsers per language (en, de, fr, tr)
    i18n/                    → EN/DE/FR/TR dictionaries, number/date formatters, React provider
    frugal/tokens.ts         → naive baselines (actual image size, GPT-4o tile formula), energy assumptions
    frugal/ledger.ts         → ledger entries + totals() with the exclusion rule
    data/profiles.ts         → Barlas (ZH), Meriç (VD), Oktay (BS), fictional; data/history.ts seeds 5 months of transactions
    accounts/                → accounts store: active account, local additions, API for imports (docs/ACCOUNTS.md)
scripts/
  make-samples.ts            → the 7 sample documents in public/samples/
  copy-tesseract-assets.mjs  → postinstall copy of Tesseract worker + WASM loaders into public/tesseract/runtime/
  benchmark.ts               → heuristic checks + 19-document benchmark with receipt accuracy → docs/BENCHMARK.md
  engine-check.ts            → finance engine on the three accounts and the demo snaps
  i18n-check.ts              → dictionary completeness, placeholder parity, and 0-token intent checks
  browser-smoke.mjs          → headless Chromium run of the real pipeline without a key (pipeline-check.ts calls it)
  e2e-live.mjs               → stage demo with real OpenRouter calls
```

## 3. Snap cascade (`src/lib/snap/pipeline.ts`)

```
image ─► decode; keep a ≤ 2048px JPEG in the browser for the optional GPT-4o check
      ├─► fingerprint cache hit (dHash + 512px checksum) ───────────────► route "cache"       0 tokens
      ├─► Tier 0: jsQR on full ≤1000px, bottom half, bottom-right, full ≤2000px
      │      "SPC/0200…" payload, valid IBAN / amount / reference ──► parse QR-bill ► route "qr"   0 tokens
      ├─► resize ≤ 1600px, crop to ink, grayscale + 2–98 percentile stretch
      ├─► Tesseract eng+deu+fra: keep lines with conf ≥ 45, dedupe, ≤ 24 lines, ≤ 600 chars
      │   confidence = min(page confidence, confidence of lines with an amount cue)
      │     ├─► the reading checks itself (see below) ─────────────────────────► "local-regex"  0 tokens
      │     ├─► conf ≥ 65 ──► compact text ──► small text model ───────────────► "text-llm"
      │     └─► conf < 65 ──► 512px grayscale JPEG q0.6 ──► small vision model ─► "vision-llm"
      └─► no model or model error: local heuristics ────────────────────────────► "offline-heuristic" (excluded from savings, never cached)
```

- **When a local reading is final (`accept.ts`, checked in `scripts/api-check.ts`):** a receipt whose line items add up to the printed total (OCR confidence alone is not enough); a bill with confident OCR (≥ 80), its amount on a total line and an IBAN with correct check digits; a payslip or listing with confident OCR, an amount and a second field. Notes always go to a model: handwriting has nothing to check against.
- **Cache:** only results of a path that ran as designed are stored (`shouldCache`). An offline-heuristic result is never stored, so it cannot be replayed after a model is connected. Entries written before the `route` field existed are ignored.
- **QR-bill (`qrBill.ts`):** decoded only when the payload is well formed: CH / LI IBAN with correct check digits, amount as digits with at most two decimals, CHF or EUR, reference type QRR / SCOR / NON with a matching reference (27 digits mod 10 with a QR-IBAN, ISO 11649, or none). Anything else is read by OCR like any other document.

- Receipts use full OCR text. Tier 1 accepts a printed total and item rows only if their signed sum is within CHF 0.05 of the total. A euro restatement below the CHF total ("Total EUR 5.35") is not the total; a discount may lead with its rate ("20% Rabatt 4.00"); a space inside a price is read as a thousands separator or as quantity and price, whichever adds up. Readable receipts that need help escalate to Tier 2 text. Vision handles unusable OCR. The app checks the model's items against the extracted total again and flags differences for review.
- **Extraction schema:** `kind, amount, merchant, date, location, rooms, category, label, year, iban, message`. Receipts also carry `currency` and `items`, with `name`, `amount`, optional `qty`, `unitPrice`, and `category` on each row.
- **Result (`SnapResult`):** `tier`, `route`, `outcome` (`ok | partial | failed`), `usageKnown`, optional `fieldsMissing`, and the client-side `naiveImage` for the live GPT-4o check.
- **Review:** every result opens a review form (route, OCR confidence, editable fields). Nothing changes the twin until the user presses *Add to twin*.
- **Mapping (`extractionToUpdate`, `twin/actions.ts`):** listing → house event; receipt → transaction (feeds the behaviour model); bill → recurring cost unless the same amount is already budgeted; payslip → net monthly income (`Nettolohn` / `Salaire net`, never `Bruttolohn`); note → planned expense.

The Node benchmark shares the OCR languages with the app. Its receipt gate (`canAcceptLocalReceipt`) is the older one that also accepts a non-matching receipt at OCR confidence ≥ 80; the app no longer does, so re-run the benchmark before quoting its route counts for such receipts. It documents differences in preprocessing and non-receipt thresholds. [Benchmark results](BENCHMARK.md)

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
* Investing inputs: `investShare`, `contributes3a` and the drawdown selling below are derived from the account's
  trades (`investBehavior.ts`), not set by hand.
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

* **Endpoint:** any OpenAI-compatible `/chat/completions`. `DOPPEL_LLM_BASE_URL` defaults to OpenRouter; the key is
  `DOPPEL_LLM_API_KEY`, falling back to `OPENROUTER_API_KEY` for OpenRouter only (that key is never sent to another
  host). OpenRouter defaults to `qwen/qwen3-30b-a3b-instruct-2507` for text and `qwen/qwen3-vl-30b-a3b-instruct` for
  vision; another endpoint must name its models (`DOPPEL_TEXT_MODEL`, `DOPPEL_VISION_MODEL`, `DOPPEL_NAIVE_MODEL`), and
  a task family without a model answers `{ ok: false, offline: true }` so the caller takes its local path.
* **Status:** `GET /api/twin` → `{ ok, configured, provider, textModel, visionModel, naiveModel, reason? }`: host and
  model names, never a key. The UI shows this instead of failing on first use.
* **Requests** use `temperature: 0`. JSON tasks send `response_format: json_object`; an endpoint that refuses it
  (400 / 404 / 422) gets one retry without it and is remembered. The OpenRouter-only fields (`provider`,
  `usage.include`, `X-Title`) go to OpenRouter only.
* **Usage:** tokens and cost as the provider reports them. Tokens without a cost: cost = tokens × list price for the
  models named in `tokens.ts` (`costBasis: "estimated"`), else unknown (`costBasis: "unknown"`, left out of cost
  totals). No token counts at all: ~4 characters per token (`tokenBasis: "estimated"`, `usageKnown: false`, excluded
  from the measured savings).
* Output caps are 160 for general text extraction, 2,200 for receipt text or image extraction, 900 / 700 for floor
  plans / charts, 150 for commands, 160 for narration, 260 for `ask` and 400 for naive comparisons.
* **Guards (`guard.ts`):** same-origin POSTs only (a request with a foreign `Origin` or `Sec-Fetch-Site` is refused);
  12 requests per minute per client and 60 in total, 6 in flight; the client address comes only from a header the
  client cannot write (`x-vercel-forwarded-for` on Vercel, the N-th address from the right of `x-forwarded-for` with
  `DOPPEL_TRUSTED_PROXIES=N`), otherwise all clients share the total; a full bucket table evicts the least recently
  used client instead of refusing new ones; `naive_compare` costs four units. A daily budget
  (`DOPPEL_DAILY_BUDGET_USD`, default 1, and `DOPPEL_DAILY_TOKEN_BUDGET`, default 2,000,000, UTC day) reserves each
  call's worst case before it is sent. All counters are per server process.
* **Input caps:** body ≤ 3.5 MB; images are base64 JPEG / PNG whose container is walked (frame header, scan data and
  end marker; IHDR, IDAT, IEND), ≤ 512px and ≤ 1 MB (floor plans 768px; `naive_compare` JPEG only, ≤ 2048px, ≤ 2.6 MB);
  `narrate` and `ask` facts are key-whitelisted (`NARRATE_FACT_KEYS`, `ASK_FACT_KEYS` in `src/lib/llm.ts`), strings
  ≤ 200 chars, JSON ≤ 2,000 bytes.
* **Security headers (`next.config.ts`):** a Content-Security-Policy with everything same-origin (the browser never
  talks to a model endpoint; `'wasm-unsafe-eval'` for the Tesseract core, `blob:` / `data:` images),
  `frame-ancestors 'none'`, `nosniff`, a referrer and a permissions policy, HSTS, no `X-Powered-By`.
* Tasks:
  * `extract_text` reads compact OCR text (≤ 800 chars) or receipt OCR text (≤ 2,800 chars, Tier 2).
  * `extract_image`: 512px grayscale JPEG → JSON (Tier 2). An amount in another currency is not passed on as CHF.
  * `command`: free-form what-if → JSON ops, validated
  * `narrate`: engine facts (client name, age and city, odds, habit cost, home test, retirement, best recipe) →
    ≤ 3 sentences, told to use only the given numbers
  * `ask`: a free-form question (≤ 400 chars) plus flat engine facts → plain text, ≤ 120 words, in the user's
    language. The prompt forbids arithmetic and new numbers; `grounding.ts` then rejects any answer containing a
    number that is in neither the facts nor the question (`UNGROUNDED_ANSWER`, the UI shows "could not answer from
    the engine's figures"). Swiss terms such as "Säule 3a" and list markers are not figures; spelled-out numbers
    ("twelve thousand") are not detected.
  * `categorize`: unique unresolved merchant names → one category each
  * `naive_compare`: opt-in from the Inspector; sends the ≤ 2048px image to the frontier model with a prompt asking
    for every financial detail; the answer is bounded (depth, string length, 6 kB) before it is returned.
* Checks: `npx tsx scripts/api-check.ts` calls the handler with a stubbed `fetch` (no key, nothing leaves the machine).

## 5b. Statement import (`src/lib/import/`)

* **Formats:** bank CSV (7 layouts + manual mapping; UTF-8, UTF-16, Windows-1252), ISO 20022 camt.053 / .054, SWIFT
  MT940 (`mt940.ts`), broker and 3a CSV. All parsed in the browser at 0 tokens.
* **camt:** a batch becomes one row per transaction only when every transaction has its amount in the account
  currency and they add up to the booked entry; otherwise the entry is one row. `RvslInd` marks a reversal: a
  returned debit is a refund from the payee, not income.
* **UBS collective orders:** the booked total and its detail rows are the same money; the details replace the total
  when they add up to it, else the total stays.
* **Duplicates:** a bank reference is compared with references recorded by EARLIER imports only (transactions of
  one batch share a reference), plus date / amount / merchant against what the account already has.
* **What the statement tells the twin (`summarize.ts`, `summarizeStatement(review)`):** months covered, net income
  per source and its regularity, fixed costs with their recurring payees (rent, mortgage, insurance, leasing, loan,
  childcare, utilities, passes, subscriptions), variable spending by category, saving and investing rate, and
  inferred facts (`salary`, `tenant`, `owner`, `car`, `child`, `debt`, `investor`, `pillar3a`), each with a
  confidence and the evidence rows. Numbers are raw and texts are `Msg` descriptors; every fact is a proposal the
  user confirms or rejects before it enters the profile. `summaryAskFacts()` turns a summary into `ask` facts.
* Checks: `npx tsx scripts/import-check.ts` (sections 4 and 5).

## 6. Frugality accounting (`src/lib/frugal/`)

* **Our numbers:** the provider's `usage` (`prompt_tokens`, `completion_tokens`, and `cost` on OpenRouter) for model
  calls; 0 tokens and 0 bytes for local routes (`qr`, `cache`, `local-regex`, `local-parser`). A response without
  token counts carries an estimate marked `tokenBasis: "estimated"` and shows as "usage unknown"; a model without a
  known price is left out of both cost totals (`costUnknownCount`).
* **Statement categorisation:** the GPT-4o baseline is counted only for rows a step really resolved (local rules,
  cache, or the model call). An offline import that leaves merchants "review needed" claims no savings.
* **Exclusion rule (`totals()`):** offline fallbacks, failed extractions and responses without usage go to a separate
  "Excluded from savings" list. Partial extractions with known usage still count, and are tallied as `partialCount`.
* **Naive snap baseline (estimate until the live check runs):** GPT-4o high-detail at $2.50 / $10.00 per 1M tokens;
  the image's actual size in OpenAI's tile formula (`85 + 170 × tiles` after fitting in 2048² and scaling the short
  side to ≤ 768px) + 160 prompt tokens + 120 output tokens. The live check replaces the estimate with measured usage.
* **Naive command / narration baseline:** GPT-4o asked to do the projection itself, with state capped at 2,400 chars
  (~600 tokens, no raw transactions) + 180 prompt tokens + 350 (what-if) or 220 (narration) output tokens.
  This baseline is never measured live.
* **Energy:** fixed coefficients, not measurements: 0.0006 Wh/token frontier, 0.0002 Wh/token small model,
  0.002 Wh per local pass. The cited reports (Epoch AI 2025, Google 2025) give per-query figures, not per-token
  rates for this pipeline. See `tokens.ts`.

## 7. Next steps

* Fix the benchmark so it times the cascade without the GPT-4o call, and use the app's thresholds and OCR languages.
* Move the simulator to a Web Worker for 10k paths.
* Solver over two levers at once.
* Cantonal tax tables for the 3a saving.
* Keep the twin in IndexedDB and add a monthly check-in view.
