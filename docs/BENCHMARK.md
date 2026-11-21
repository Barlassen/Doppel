# Doppel — Multimodal Frugality Benchmark

Generated directly by [`scripts/benchmark.ts`](../scripts/benchmark.ts) on **2026-11-21**.

> **Measurement basis:** All cloud tiers and GPT-4o naive comparisons were **measured live** via OpenRouter.

## 1. Evaluation set (16 documents)

* **5 clean originals** in `public/samples/`: Swiss QR-bill, DE property listing, DE supermarket receipt, DE payslip (`Lohnabrechnung`), handwritten sabbatical note.
* **2 clean French Swiss documents** in `public/samples/bench/`: Lausanne property listing (`3.5 pièces`) and Geneva payslip (`Bulletin de salaire`).
* **9 phone-photo degraded JPGs** in `public/samples/bench/` (315 KB total across all 11 committed JPEGs): generated deterministically with `sharp` using rotation (±2.4° to ±5.4°), affine skew, optical blur (0.35–0.95 px), warm indoor lighting gradients, pixel grain, lower resolutions (480–1080 px), and JPEG quality 40–55.
* **Heuristic unit suite:** 11/11 deterministic DE/FR/EN & OCR-noise assertions passed.

## 2. Per-document results

| Document | Type | Orig px | Tier · Route | OCR conf | Left device | Extracted / GT (CHF) | Amount OK? | Latency | Doppel tok | Doppel $ | Naive GPT-4o tok |
|---|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|
| `qr-bill-clean` | clean | 1240×620 | T0 · `qr` | — | 0 B | 412 / 412 | Yes | 1571 ms | 0 *(measured)* | $0 | 1274 |
| `listing-clean` | clean | 1080×1350 | T1 · `local-regex` | 89% | 0 B | 940,000 / 940,000 | Yes | 2683 ms | 0 *(measured)* | $0 | 929 |
| `receipt-clean` | clean | 640×1240 | T1 · `local-regex` | 93% | 0 B | 87.45 / 87.45 | Yes | 3484 ms | 0 *(measured)* | $0 | 1272 |
| `payslip-clean` | clean | 960×1280 | T1 · `local-regex` | 91% | 0 B | 8,650 / 8,650 | Yes | 2811 ms | 0 *(measured)* | $0 | 909 |
| `note-clean` | clean | 900×700 | T2 · `vision-llm` | 33% | 13 KB JPEG | 25,000 / 25,000 | Yes | 2449 ms | 402 *(measured)* | $0.000055 | 898 |
| `listing-fr-clean` | clean | 1020×1280 | T1 · `local-regex` | 88% | 0 B | 795,000 / 795,000 | Yes | 1927 ms | 0 *(measured)* | $0 | 920 |
| `payslip-fr-clean` | clean | 960×1220 | T1 · `local-regex` | 90% | 0 B | 11,800 / 11,800 | Yes | 3414 ms | 0 *(measured)* | $0 | 921 |
| `qr-bill-photo-tilt` | photo | 1095×600 | T0 · `qr` | — | 0 B | 412 / 412 | Yes | 2995 ms | 0 *(measured)* | $0 | 1274 |
| `qr-bill-photo-lowres` | photo | 895×509 | T2 · `vision-llm` | 38% | 11 KB JPEG | 412 / 412 | Yes | 3450 ms | 451 *(measured)* | $0.000075 | 588 |
| `listing-photo-glare` | photo | 931×1112 | T1 · `local-regex` | 89% | 0 B | 940,000 / 940,000 | Yes | 2424 ms | 0 *(measured)* | $0 | 929 |
| `receipt-photo-desk` | photo | 644×1114 | T1 · `local-regex` | 79% | 0 B | 87.45 / 87.45 | Yes | 3306 ms | 0 *(measured)* | $0 | 1272 |
| `receipt-photo-dim` | photo | 511×836 | T2 · `vision-llm` | 34% | 16 KB JPEG | 87.45 / 87.45 | Yes | 5277 ms | 447 *(measured)* | $0.000073 | 592 |
| `payslip-photo-fold` | photo | 923×1183 | T1 · `local-regex` | 86% | 0 B | 8,650 / 8,650 | Yes | 3166 ms | 0 *(measured)* | $0 | 909 |
| `note-photo-desk` | photo | 778×626 | T2 · `vision-llm` | 28% | 17 KB JPEG | 25,000 / 25,000 | Yes | 3720 ms | 420 *(measured)* | $0.000062 | 911 |
| `receipt-fr-photo` | photo | 641×899 | T1 · `local-regex` | 75% | 0 B | 42.80 / 42.80 | Yes | 2084 ms | 0 *(measured)* | $0 | 935 |
| `note-typed-photo` | photo | 790×564 | T1 · `text-llm` | 86% | 170 ch | 18,500 / 18,500 | Yes | 2330 ms | 244 *(measured)* | $0.000053 | 920 |

## 3. Summary by cascade tier

| Tier / Route | Share of docs | Accuracy | Avg latency | Avg tokens | Avg cost / doc |
|---|---:|---:|---:|---:|---:|
| Tier 0 · QR-bill (local) | 2/16 (13%) | 2/2 (100%) | 2283 ms | 0 | $0 |
| Tier 1 · Local regex (local) | 9/16 (56%) | 9/9 (100%) | 2811 ms | 0 | $0 |
| Tier 1 · Text LLM (compact OCR) | 1/16 (6%) | 1/1 (100%) | 2330 ms | 244 | $0.000053 |
| Tier 2 · Vision LLM (512px gray JPEG) | 4/16 (25%) | 4/4 (100%) | 3724 ms | 430 | $0.000066 |

## 4. Headline comparison & unit economics

Assumptions for scale projection: **20 snaps / user / month** across **100,000 active users** (2,000,000 snaps/month) with this benchmark's document mix (bills, receipts, listings, payslips, handwritten notes; clean + phone photos).

| Metric | Doppel cascade (measured) | Naive GPT-4o high-detail (measured) | Delta |
|---|---:|---:|---:|
| Docs resolved locally at **0 tokens** | **11/16 (69%)** | 0/16 (0%) | +69 pp local |
| Local-tier amount accuracy (Tier 0 + local-regex) | **11/11 (100%)** | — | 0 bytes left device |
| Overall amount accuracy (live) | 16/16 (100%) | 16/16 | — |
| Avg latency per doc (Node) | 2943 ms | 1708 ms | — |
| Avg tokens / doc | **123 tok** | 966 tok | **−87.3%** |
| Avg cost / doc | **$0.000020** | $0.00261 | **−99.2%** |
| Cost / 1,000 snaps | **$0.02** | $2.61 | **−99.2%** |
| Cost / 100k users / month (20 snaps/mo) | **$40/mo** | $5,219/mo | **Saves $5,179/mo** |
| Rough energy / 1,000 snaps *(estimate)* | ~25.9 Wh | ~579.5 Wh | ~96% lower |

> **Energy note:** Rough estimate: ~0.0006 Wh/tok frontier (Epoch AI, 2025), ~0.0002 Wh/tok small model (Google, 2025), ~0.002 Wh local CPU pass (15 W × 0.5 s). Varies 3–5× by hardware and batching.

## 5. Observations and limits

1. **QR decoding and low-res fallback:** `qr-bill-clean` and `qr-bill-photo-tilt` decode at Tier 0 (`jsQR`, 0 tokens, 0 bytes sent). `qr-bill-photo-lowres` (895×509, blur 0.45, JPEG quality 45) fails QR decoding and scores 38% OCR confidence, so it falls through to Tier 2 (`vision-llm`, 11 KB JPEG, 451 tokens) and still extracts CHF 412.
2. **Printed documents at Tier 1:** 9 of 16 documents clear the 75% OCR confidence threshold and resolve locally via `heuristics.ts` at 0 tokens, including French documents and `Nettolohn` vs `Bruttolohn` disambiguation. `note-typed-photo` clears OCR (86%) without matching a local regex rule, sending 170 characters to the small text model (244 tokens).
3. **Handwriting and dim photos at Tier 2:** cursive handwriting (`note-clean`, `note-photo-desk`) and the dim, blurred receipt (`receipt-photo-dim`) score 28–34% OCR confidence and escalate a 512px grayscale JPEG (13–17 KB, 402–447 tokens) to the small vision model.
4. **Limits of this benchmark:**
   * **Node mirror vs browser pipeline:** `scripts/benchmark.ts` runs a Node copy of the cascade (`eng+deu` Tesseract, page-average `data.confidence`, 75% `local-regex` threshold). The browser app (`src/lib/snap/pipeline.ts`, `src/lib/snap/ocr.ts`) loads `eng+deu+fra`, computes confidence as `min(pageConfidence, amountLineConfidence)`, and requires 80% confidence plus a supporting field for `local-regex`. Under the app's 80% threshold, at least `receipt-photo-desk` (79%) and `receipt-fr-photo` (75%) would escalate to `text-llm`.
   * **Latency column includes the GPT-4o baseline call:** In `runDoc()`, the per-document timer (`tStart`) starts before the live `callOpenRouter(..., NAIVE_MODEL, ...)` call. Every `Latency` cell in Section 2 and the `2943 ms` average in Section 4 include both the GPT-4o request and the Doppel cascade, so this run does not provide a standalone cascade latency measurement.
   * **Synthetic dataset:** All 16 documents are synthetic SVGs and `sharp`-degraded JPEGs generated in this repository, not real user photos.
   * **Baseline prompt vs in-app live check:** Naive GPT-4o tokens and accuracy here were measured live at each document's actual resolution with `NAIVE_SYS` (250 max output tokens). Inside the app's Inspector, the **"Run the naive way (GPT-4o)"** button uses a longer extraction prompt (`max_tokens: 400`), so its live token count is higher than the 966-token average above.
