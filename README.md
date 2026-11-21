<img src="assets/icon.svg" width="64" height="64" alt="">

# Doppel — your financial twin, fed by snapshots

**LauzHack 2026 · UBS “AI Financial Twin” + AXA “Frugal use of Multimodal AI”**

Nobody wants to type 40 numbers into a finance app. Your financial life already lives in *images*:
a Swiss QR-bill, a supermarket receipt, a payslip, a screenshot of a flat you like, a handwritten goal on a post-it.
Doppel turns those snapshots into a living financial twin — and answers *“Can I afford this? What if…?”* with
1,000 simulated futures to age 90, in your browser, in about 100 ms.

**The golden rule:** the LLM never does maths. A deterministic engine (Monte Carlo, Swiss affordability rules,
Pillar 3a, a behavioural model, an inverse goal solver) produces every number. Small models are only invoked when
local decoding and OCR genuinely cannot read the document, when a what-if falls outside our local intent parser,
or when you ask for a 3-sentence banker narration of the final numbers.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

Without an API key Doppel runs **fully offline**: QR-bills, local OCR, and DE/FR/EN regex extraction still work;
cloud-escalated calls fall back to local heuristics and are explicitly separated out as `offline` in the Inspector
(excluded from headline savings).

## What's inside

| | |
|---|---|
| **Frugal multimodal cascade** | Tier 0 multi-scale Swiss QR-bill (`jsQR`, 0 tokens) → perceptual-hash cache → Tier 1 self-hosted local OCR (`eng+deu+fra`, works offline) → local DE/FR/EN regex fast path (0 tokens on clean structured docs) or ≤ 600 chars to a small text LLM → Tier 2 512px grayscale JPEG (~15 KB) to a small VLM only when OCR confidence < 65% |
| **5 bundled Swiss samples** | Swiss QR-bill (CHF 412), Zürich flat listing (CHF 940k), supermarket receipt (CHF 87.45), Swiss `Lohnabrechnung` payslip (Nettolohn CHF 8'650), and a handwritten sabbatical note (CHF 25k, 2028) |
| **Review before it counts** | Every extraction is shown with its route, OCR confidence and editable fields; nothing touches the twin until you press *Add to twin* |
| **Local intent parser** | Common what-ifs (“lose my job for 6 months in 2028”, “retire at 60”, “invest 500 a month”) are parsed locally at 0 tokens; only unrecognised phrasing hits the LLM, which may only return validated ops |
| **Monte Carlo** | 1,000 paths × monthly steps to age 90: life events, crash shocks, wage and home-price noise, BVG age credits, Pillar 3a, monthly mortgage cash-flow; seeded and reproducible |
| **Swiss rules** | *Tragbarkeit* (20% equity / 10% hard, 5% stress rate + 1% upkeep + amortisation ≤ ⅓ gross income) runs inside every simulated future at the purchase date — the card and the cone always agree |
| **Retirement** | “Am I saving enough?”: AHV incl. 13th pension, pension-fund annuity, bridge for early retirement, “money lasts to 90” odds and replacement ratio |
| **Behavioural twin** | Payday spending spike, subscriptions, panic-selling that only buys back at the old peak → “Real you” vs “Disciplined you”, with the cost of each habit in percentage points |
| **Plan A vs Plan B** | Every what-if or snap auto-pins the previous plan; the chart shows both, the chip shows the difference in odds and CHF |
| **Find my path** | Inverse solver: smallest spending cut / investment move / purchase delay (or a combination) — re-scored on the same 1,000 futures as the headline |
| **Investing** | Risk profile, Pillar 3a toggle and a “cost of waiting” strip (invest now vs in 2 or 5 years) |
| **Honest Frugal Inspector** | Accessible modal (`Esc` / focus trap) showing route chip, bytes sent, exact payload, real OpenRouter `usage`, separate excluded list for offline/failed calls, unit economics ($ per 1k snaps + rough Wh estimate), and a live **“Run the naive way (GPT-4o)”** comparison button |

## Benchmark highlights

Measured on a 16-document evaluation suite (5 clean originals, 2 clean French Swiss docs, and 9 photo-like degraded JPEGs with rotation, skew, blur, warm lighting, and grain — see [docs/BENCHMARK.md](docs/BENCHMARK.md) for the full per-document table and measurement basis):

* **16/16** amounts correct, measured live via OpenRouter — the same accuracy as sending every image to GPT-4o.
* **69% of documents (11/16)** resolve locally at **0 tokens** (Tier 0 QR + Tier 1 local regex) and 0 bytes leave the browser.
* **123 tokens/doc** average vs **966 tokens/doc** naive GPT-4o high-detail (**−87.3% tokens**, measured).
* **$0.02 per 1,000 snaps** vs **$2.61 per 1,000 snaps** naive (**−99.2% cost**) — **$40/month** vs **$5,219/month** at 100k users × 20 snaps/month.
* Honest trade-off: GPT-4o is faster per document (≈1.7 s vs ≈2.9 s in Node), because local OCR is CPU-bound.

Read the technical design in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the full benchmark in [docs/BENCHMARK.md](docs/BENCHMARK.md), and the 3-minute stage script + jury Q&A in [docs/PITCH.md](docs/PITCH.md).

## Scripts

- `npx tsx scripts/benchmark.ts` — runs 11 heuristic unit checks, regenerates the degraded photo suite in `public/samples/bench/`, executes the 16-document cascade benchmark (live OpenRouter if `OPENROUTER_API_KEY` is set), and writes `docs/BENCHMARK.md`
- `npx tsx scripts/make-samples.ts` — regenerates the 5 demo SVGs in `public/samples/` (all fictional companies & people)
- `npx tsx scripts/engine-check.ts` — sanity run of the finance engine for both demo profiles (Lukas & Elena)
- `npx tsx scripts/pipeline-check.ts` — quick Node check of the QR/OCR cascade on the bundled samples
- `npm run smoke:browser` — headless Chromium run of the real browser pipeline without an API key (needs `npm run build`)
- `npm run e2e:live` — live end-to-end walk through the stage demo with real OpenRouter calls (~$0.01; needs `npm run build` and a key)

All people, companies and documents in the demo are fictional.
