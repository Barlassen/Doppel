<img src="assets/icon.svg" width="64" height="64" alt="">

# Doppel — your financial twin, fed by snapshots

**LauzHack 2026 · UBS “AI Financial Twin” + AXA “Frugal use of Multimodal AI”**

Nobody wants to type 40 numbers into a finance app. Your financial life already lives in *images*:
a Swiss QR-bill, a supermarket receipt, a payslip, a screenshot of a flat you like, a handwritten goal on a post-it.
Doppel turns those snapshots into a living financial twin — and answers *“Can I afford this? What if…?”* with
1,000 simulated futures, in your browser, in ~50 ms.

**The golden rule:** the LLM never does maths. A deterministic engine (Monte Carlo, Swiss affordability rules,
Pillar 3a, a behavioural model, an inverse goal solver) produces every number. Small LLMs are only used to *read*
documents, *translate* free-form what-ifs into simulator parameters, and *explain* the final numbers.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

Without an API key Doppel runs **fully offline**: QR-bills and local OCR still work, extraction falls back to
local heuristics, and the inspector marks those calls as `offline`.

## What's inside

| | |
|---|---|
| **Frugal cascade** | Tier 0 Swiss QR-bill (jsQR, 0 tokens) → Tier 1 local OCR → ~300 chars to a small text model → Tier 2 512px gray JPEG to a small VLM, only if OCR confidence < 65% |
| **Local intent parser** | Common what-ifs (“lose my job for 6 months in 2028”, “delay the flat by 2 years”) are parsed with 0 tokens; only unknown phrasing goes to the LLM |
| **Monte Carlo** | 1,000 paths × monthly steps to age 50–65, life events, crash shocks, pillar 2/3a, mortgage cash-flow; seeded, reproducible |
| **Swiss rules** | *Tragbarkeit*: 20% equity (10% hard), 5% stress rate + 1% upkeep + amortisation ≤ ⅓ gross income; max affordable price via binary search |
| **Behavioural twin** | Payday spending spike, subscriptions, panic-selling in drawdowns → “Real you” vs “Disciplined you” cones |
| **Find my path** | Inverse solver: smallest spending cut / investment move / delay that brings the goal above 80% |
| **Frugal Inspector** | Every call with real OpenRouter `usage`, the exact payload that left the browser, and a clearly-labelled naive baseline |

Read the full design in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Demo script (3 minutes)

1. **Lukas, 31, Zürich.** Hero: *“CHF 1.6M net worth by 50: 28%”* — disciplined Lukas would be at 69%. The behavioural card shows why (payday spike, panic selling).
2. **Snap the listing** (sample *Listing*): local OCR reads *4.5 Zimmer, CHF 940'000, 8050 Zürich* → the home lands on the timeline, the bank test **fails** (38% of income), odds drop.
3. **Find my path** → *“Buy the home 24 months later”* / *“Spend CHF … less”* → *Apply* → cone and odds update instantly.
4. **What-if bar / mic:** *“What if I lose my job for 6 months in 2028?”* → parsed locally, 0 tokens.
5. **AXA moment:** click the ⚡ badge → drop the QR-bill (Tier 0, 0 tokens), the receipt (Tier 1), the handwritten note (Tier 2, 512px image) and compare *Doppel vs naive frontier VLM*.

## Scripts

- `npx tsx scripts/engine-check.ts` — sanity run of the finance engine for both demo profiles
- `npx tsx scripts/pipeline-check.ts` — runs the QR/OCR cascade on the sample images in Node
- `npx tsx scripts/make-samples.ts` — regenerates the demo images in `public/samples` (fictional companies)

All people, companies and documents in the demo are fictional.
