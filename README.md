<img src="assets/icon.svg" width="64" height="64" alt="">

# Doppel

A Swiss personal-finance twin you feed with photos. Built at LauzHack 2026 for the UBS "AI Financial Twin" track and the AXA "Frugal use of Multimodal AI" track.

You snap a QR-bill, a receipt, a payslip, a property listing or a handwritten note. Doppel reads it, shows you what it read, and after you confirm, adds it to a simulation of your finances: 1,000 Monte Carlo paths with monthly steps to age 90, run in the browser.

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

Code: `src/lib/snap/pipeline.ts` (cascade), `src/lib/finance/` (engine), `src/lib/twin/actions.ts` (what-if ops and their validation), `src/app/api/twin/route.ts` (the only route that calls a model, via OpenRouter, default `google/gemini-2.5-flash-lite`). Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Evidence

From the live benchmark run in [docs/BENCHMARK.md](docs/BENCHMARK.md) (16 synthetic Swiss documents, 9 of them degraded to look like phone photos):

| | Doppel cascade | Whole image to GPT-4o |
|---|---:|---:|
| Amounts correct (within CHF 0.05 or 0.5%) | 16/16 | 16/16 |
| Documents read with 0 tokens | 11/16 | 0/16 |
| Tokens per document | 123 | 966 |
| Cost per 1,000 documents | $0.02 | $2.61 |

Limits of that run, also listed in BENCHMARK.md:

- The benchmark runs a Node copy of the cascade, not the browser code. The copy uses Tesseract `eng+deu`, page-average OCR confidence, and a 75% local-regex threshold; the app adds `fra`, takes the minimum of page confidence and amount-line confidence, and requires 80% plus a second field. The two local receipts recorded at 75% and 79% OCR confidence do not meet the app's gate on those scores. Because the OCR setup also differs, the app's local share needs its own measurement.
- The Doppel latency column includes the GPT-4o baseline call, because the timer starts before it. We have no clean latency comparison yet.
- The documents are synthetic and were made by us.
- The report stores token counts and costs, not the raw provider responses.

The app has three fictional accounts with a switcher in the header: Barlas (Zürich, on track), Meriç (Lausanne, borderline) and Oktay (Basel, off track). Their behaviour comes from five months of transactions and investment trades; see [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

The finance numbers used in the pitch (Meriç 64.6% vs 73.6%, −9.4 pp from payday spending, and the CHF 940k listing failing the bank test at 66.0%) are printed by `npx tsx scripts/engine-check.ts`. The CHF 24.7k habit cost is `ideal.medianAtGoal − real.medianAtGoal` (`CHF 458,214 − CHF 433,481 = CHF 24,733`, computed as `behaviorCost` in `src/components/DoppelApp.tsx`).

## Scripts

| Command | What it does | Needs |
|---|---|---|
| `npx tsx scripts/engine-check.ts` | Runs the finance engine on the three accounts and the demo snaps | nothing |
| `npm run i18n:check` | Checks the four dictionaries and the local what-if parsers | nothing |
| `npm run smoke:browser` | Headless Chromium run of the real browser pipeline, no API key | `npm run build` |
| `npx tsx scripts/pipeline-check.ts` | Same as `smoke:browser` | `npm run build` |
| `npx tsx scripts/benchmark.ts` | Heuristic unit checks, regenerates the degraded photos, runs the 16-document benchmark, rewrites docs/BENCHMARK.md | key for live numbers |
| `npm run e2e:live` | Walks the stage demo with real OpenRouter calls (about $0.01) | build + key |
| `npx tsx scripts/make-samples.ts` | Regenerates the 5 sample documents in `public/samples/` | nothing |

All people, companies and documents in the demo are fictional.

More: [docs/PITCH.md](docs/PITCH.md) (demo script), [docs/DECISIONS.md](docs/DECISIONS.md) (design decisions and jury questions), [docs/ACCOUNTS.md](docs/ACCOUNTS.md) (accounts and their store).
