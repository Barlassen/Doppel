<img src="assets/icon.svg" width="64" height="64" alt="">

# Doppel

A Swiss personal-finance twin you feed with photos. Built at LauzHack 2026 for the UBS "AI Financial Twin" track and the AXA "Frugal use of Multimodal AI" track.

You can upload a photo of a shop receipt, review the total and items, and add the purchase as one transaction. Doppel also scans QR-bills, payslips, property listings and handwritten notes. Confirmed scans feed a simulation of your finances with 1,000 Monte Carlo paths run in the browser.

Two rules shaped the code:

1. **The LLM never does maths.** Every financial number on screen comes from deterministic TypeScript in `src/lib/finance`. Models only read documents, parse free-form what-ifs that the local parser misses, and phrase a three-sentence summary of numbers the engine already computed.
2. **Use the cheapest reader that works.** A QR-bill is decoded locally. Printed text goes through local OCR and regex first. Only low-confidence or failed OCR sends a grayscale JPEG capped at 512px to a small vision model.

## Run it

```bash
npm ci
cp .env.example .env.local   # optional: OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

Without a key, QR-bills, local OCR, regex extraction, the local what-if parser and the whole finance engine still work. Document extraction that would need a model falls back to local heuristics, and the banker summary uses a template. Free-form commands the local parser does not recognise need a model. The Inspector lists offline calls as `offline` and leaves them out of the savings figures.

## How it works

```
photo ─► Tier 0  jsQR on the Swiss QR-bill            0 tokens, nothing sent
      ─► cache   repeat image (dHash)                 0 tokens, nothing sent
      ─► Tier 1  Tesseract (eng+deu+fra) in a worker
               ├─ conf ≥ 80% + amount + 2nd field ─► local regex      0 tokens
               └─ conf ≥ 65% ─► ≤ 600 chars of OCR text ─► small text model
      ─► Tier 2  conf < 65% ─► 512px grayscale JPEG ─► small vision model
      ─► review  user checks and edits the fields, then "Add to twin"
      ─► engine  Monte Carlo, Swiss affordability test, pension, behaviour model, goal solver
```

For receipts, Tier 1 reads the complete OCR text and checks the signed item sum against the printed total. A basket within CHF 0.05 or read at high OCR confidence can go straight to review. Otherwise Tier 2 uses the small text model when OCR is readable and the 512px image when OCR fails. Review shows discrepancies for either route.

Code: `src/lib/snap/pipeline.ts` (cascade), `src/lib/finance/` (engine), `src/lib/twin/actions.ts` (what-if ops and their validation), `src/app/api/twin/route.ts` (the only route that calls a model, via OpenRouter, default `google/gemini-2.5-flash-lite`). Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Evidence

The original live benchmark used 16 synthetic Swiss documents, including nine phone-photo variants. The current offline report also measures receipt item accuracy and routing. [Benchmark results](docs/BENCHMARK.md)

| | Doppel cascade | Whole image to GPT-4o |
|---|---:|---:|
| Amounts correct (within CHF 0.05 or 0.5%) | 16/16 | 16/16 |
| Documents read with 0 tokens | 11/16 | 0/16 |
| Tokens per document | 123 | 966 |
| Cost per 1,000 documents | $0.02 | $2.61 |

The original run used a Node mirror with a 75% local-regex threshold and tied its latency to the GPT-4o request. The current benchmark shares the receipt gate and OCR languages with the browser and times Doppel separately. Both runs use synthetic fixtures.

The app has three fictional accounts with a switcher in the header: Barlas (Zürich, on track), Meriç (Lausanne, borderline) and Oktay (Basel, off track). Their behaviour comes from five months of transactions and investment trades; see [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

The finance numbers used in the pitch (Meriç 64.6% vs 73.6%, −9.4 pp from payday spending, and the CHF 940k listing failing the bank test at 66.0%) are printed by `npx tsx scripts/engine-check.ts`. The CHF 24.7k habit cost is `ideal.medianAtGoal − real.medianAtGoal` (`CHF 458,214 − CHF 433,481 = CHF 24,733`, computed as `behaviorCost` in `src/components/DoppelApp.tsx`).

## Scripts

| Command | What it does | Needs |
|---|---|---|
| `npx tsx scripts/engine-check.ts` | Runs the finance engine on the three accounts and the demo snaps | nothing |
| `npm run i18n:check` | Checks the four dictionaries and the local what-if parsers | nothing |
| `npm run smoke:browser` | Headless Chromium run of the real browser pipeline, no API key | `npm run build` |
| `npx tsx scripts/pipeline-check.ts` | Same as `smoke:browser` | `npm run build` |
| `npx tsx scripts/benchmark.ts` | Heuristic checks, 19-document benchmark with receipt item accuracy, and report generation | key for live model numbers |
| `npm run e2e:live` | Walks the stage demo with real OpenRouter calls (about $0.01) | build + key |
| `npx tsx scripts/make-samples.ts` | Regenerates the 7 sample documents in `public/samples/` | nothing |

All people, companies and documents in the demo are fictional.

Contributors and coding agents: start with [AGENTS.md](AGENTS.md) and [docs/WORKPLAN.md](docs/WORKPLAN.md).

More: [docs/PITCH.md](docs/PITCH.md) (demo script), [docs/DECISIONS.md](docs/DECISIONS.md) (design decisions and jury questions), [docs/ACCOUNTS.md](docs/ACCOUNTS.md) (accounts and their store).
