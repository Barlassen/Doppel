<img src="assets/icon.svg" width="64" height="64" alt="">

# Doppel

A Swiss personal-finance twin you feed with photos. Built at LauzHack 2026 for the UBS "AI Financial Twin" track and the AXA "Frugal use of Multimodal AI" track.

You can upload a photo of a shop receipt, review the total and items, and add the purchase as one transaction. Doppel also scans QR-bills, payslips, property listings and handwritten notes. Confirmed scans feed a simulation of your finances with 1,000 Monte Carlo paths run in the browser.

Two rules shaped the code:

1. **The LLM never does maths.** Every financial number on screen comes from deterministic TypeScript in `src/lib/finance`. Models only read documents, parse free-form what-ifs that the local parser misses, and phrase a three-sentence summary of numbers the engine already computed.
2. **Use the cheapest reader that works.** A QR-bill is decoded locally. Printed text goes through local OCR and regex first. Only low-confidence or failed OCR sends a grayscale JPEG capped at 512px to a small vision model.

## Play it by hand

Doppel can be played by hand at a desk: the hand-control component in [`tkt/`](tkt) turns a camera into a pointing device (pointer, click, scroll, dictation), and the chessboard game and the dashboard respond to it.

```bash
git clone --recurse-submodules https://github.com/Barlassen/Doppel.git
```

Start everything for the demo with `scripts/demo-with-tkt.ps1` (Windows) or `scripts/demo-with-tkt.sh` (macOS). The gestures and a 30-second demo are in [docs/TKT.md](docs/TKT.md); setup for the hand-control part (Python 3.11, `uv`, camera permissions) is in [tkt/README.md](tkt/README.md).

## Run it

```bash
npm ci
cp .env.example .env.local   # optional: OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

Without a key, QR-bills, local OCR, regex extraction, the local what-if parser and the whole finance engine still work. Document extraction that would need a model falls back to local heuristics, and the banker summary uses a template. Free-form commands the local parser does not recognise need a model. The Inspector lists offline calls as `offline` and leaves them out of the savings figures.

The OpenRouter defaults are Qwen3 30B A3B Instruct 2507 for text and Qwen3-VL 30B A3B Instruct for vision. To use the previous Gemini setup, set `DOPPEL_TEXT_MODEL` and `DOPPEL_VISION_MODEL` to `google/gemini-2.5-flash-lite` in `.env.local` and restart the app. The opt-in naive comparison defaults to `openai/gpt-4o`. See the [model selection and dated rates](docs/DECISIONS.md#16-open-weight-defaults-for-text-and-vision).

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

The cascade runs in `src/lib/snap/pipeline.ts`, the engine in `src/lib/finance/`, and what-if validation in `src/lib/twin/actions.ts`. All app model calls go through `src/app/api/twin/route.ts`. [Technical design](docs/ARCHITECTURE.md)

## Evidence

The historical live run used 16 synthetic Swiss documents, including nine phone-photo variants. Live measurement of the Qwen defaults is pending with Barlas. [Historical live report, 2026-11-21](https://github.com/Barlassen/Doppel/blob/279287d8d82f3f09036240ec343606c6e40113ba/docs/BENCHMARK.md)

| Metric | Gemini cascade (historical live) | Qwen cascade | Whole image to GPT-4o (historical live) |
|---|---:|---:|---:|
| Amounts correct (within the larger of CHF 0.05 or 0.5%) | 16/16 | Pending | 16/16 |
| Documents read with 0 tokens | 11/16 | Pending | 0/16 |
| Average tokens per document | 123 | Pending | 966 |
| Cost per 1,000 documents | $0.02 | Pending | $2.61 |
| Average latency per document (Node) | 2,943 ms¹ | Pending | 1,708 ms |

¹ The historical cascade timing includes the GPT-4o request. The current 19-document Node benchmark times Doppel separately, shares the receipt gate and OCR languages with the browser, and retains a 75% local-regex threshold for other documents. The committed report is offline and includes receipt item accuracy and routing. [Current document report](docs/BENCHMARK.md)

The separate live vision report used Gemini 2.5 Flash-Lite on seven floor plans and charts. It records a 7/10 room-mapping result and two chart risk mismatches. [Live Gemini vision report](docs/VISION_BENCHMARK.md)

The app has three fictional accounts with a switcher in the header: Barlas (Zürich, on track), Meriç (Lausanne, behind on her flat) and Oktay (Basel, off track). Their behaviour comes from five months of transactions and investment trades; see [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

The finance numbers used in the pitch (Meriç 8.7% vs 24.8%, −14.2 pp from payday spending, and the CHF 940k listing failing the bank test at 72.7%) are printed by `npx tsx scripts/engine-check.ts`. The CHF 25.1k habit cost is `ideal.medianAtGoal − real.medianAtGoal` (`CHF 362,038 − CHF 336,948 = CHF 25,089`, computed as `behaviorCost` in `src/components/DoppelApp.tsx`).

## Scripts

| Command | What it does | Needs |
|---|---|---|
| `npx tsx scripts/engine-check.ts` | Runs the finance engine on the three accounts and the demo snaps | nothing |
| `npm run ubs:check` | UBS data layer: the engine reproduces the starter kit's cash ledger for Alexia's paths; built-in accounts match their pinned fingerprint | nothing |
| `npm run play:check` | Doppel Play checks: seeded replay, labels, sacrifice, mate, MCTS vs brute force, ledger identity | nothing |
| `npm run i18n:check` | Checks the four dictionaries and the local what-if parsers | nothing |
| `npm run smoke:browser` | Headless Chromium run of the real browser pipeline, no API key | `npm run build` |
| `npx tsx scripts/pipeline-check.ts` | Same as `smoke:browser` | `npm run build` |
| `npx tsx scripts/benchmark.ts` | Heuristic checks, 19-document benchmark with receipt item accuracy, and report generation | key for live model numbers |
| `npm run e2e:live` | Walks the stage demo with real OpenRouter calls (about $0.01) | build + key |
| `npx tsx scripts/make-samples.ts` | Regenerates the 7 sample documents in `public/samples/` | nothing |

All people, companies and documents in the demo are fictional.

Contributors and coding agents: start with [AGENTS.md](AGENTS.md) and [docs/WORKPLAN.md](docs/WORKPLAN.md).
Doppel Play (`/play`) turns the same twin into a chess-review life game: Life plays White, you play Black, and a Monte Carlo tree search over possible futures reviews every move. See [docs/PLAY.md](docs/PLAY.md).

More: [docs/ENGINE_API.md](docs/ENGINE_API.md) (life decisions, economic scenarios, outlook), [docs/PITCH.md](docs/PITCH.md) (demo script), [docs/DECISIONS.md](docs/DECISIONS.md) (design decisions and jury questions), [docs/ACCOUNTS.md](docs/ACCOUNTS.md) (accounts and their store).

Contributor demo guides: [Judging and evidence](docs/JUDGING.md), [Hand control](docs/TKT.md).

## License

MIT, see [LICENSE](LICENSE). The files in `public/tesseract/` and `data/ubs/` keep their own terms; `tkt/` is a separate repository with its own license.
