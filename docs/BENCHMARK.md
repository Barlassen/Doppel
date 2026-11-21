# Doppel — Multimodal Frugality Benchmark

Generated directly by [`scripts/benchmark.ts`](../scripts/benchmark.ts) on **2026-11-21**.

> **Measurement basis:** No `OPENROUTER_API_KEY` was set. All results and timings are from local OCR or offline fallbacks. The run sent 0 bytes to a provider and used 0 provider tokens. Cloud token and cost columns estimate what a live run would use. Tier 2 text, Tier 2 vision and GPT-4o accuracy require a live run.

## 1. Evaluation set (19 documents)

* **7 clean originals** in `public/samples/` include three itemised receipts covering a supermarket, a café and a longer basket.
* **2 clean French Swiss documents** in `public/samples/bench/`: Lausanne property listing (`3.5 pièces`) and Geneva payslip (`Bulletin de salaire`).
* **10 phone-photo degraded JPGs** in `public/samples/bench/` (330 KB total across all 12 committed JPEGs): generated deterministically with `sharp` using rotation (±2.4° to ±5.4°), affine skew, optical blur (0.35–0.95 px), warm indoor lighting gradients, pixel grain, lower resolutions (480–1080 px), and JPEG quality 40–55.
* **Heuristic unit suite** passed 15/15 deterministic checks, including German, French, English and Italian receipt layouts.

## 2. Per-document results

| Document | Type | Orig px | Tier · Route | OCR conf | Sent to model | Extracted / GT (CHF) | Amount OK? | Latency | Doppel tok | Doppel $ | Naive GPT-4o tok |
|---|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|
| `qr-bill-clean` | clean | 1240×620 | T0 · `qr` | — | 0 B | 412 / 412 | Yes | 85 ms | 0 *(measured)* | $0 | ~1385 |
| `listing-clean` | clean | 1080×1350 | T1 · `local-regex` | 92% | 0 B | 940,000 / 940,000 | Yes | 1267 ms | 0 *(measured)* | $0 | ~1045 |
| `receipt-clean` | clean | 640×1240 | T1 · `local-regex` | 94% | 0 B | 87.45 / 87.45 | Yes | 1198 ms | 0 *(measured)* | $0 | ~1385 |
| `receipt-market-clean` | clean | 640×660 | T1 · `local-regex` | 93% | 0 B | 47.30 / 47.30 | Yes | 783 ms | 0 *(measured)* | $0 | ~1045 |
| `receipt-cafe-clean` | clean | 640×660 | T1 · `local-regex` | 93% | 0 B | 32.40 / 32.40 | Yes | 678 ms | 0 *(measured)* | $0 | ~1045 |
| `payslip-clean` | clean | 960×1280 | T1 · `local-regex` | 89% | 0 B | 8,650 / 8,650 | Yes | 2026 ms | 0 *(measured)* | $0 | ~1045 |
| `note-clean` | clean | 900×700 | T2 · `vision-llm` *(offline: offline-heuristic)* | 31% | 0 B | — / 25,000 | No *(offline fallback — escalates to VLM/LLM)* | 963 ms | ~496 *(est.)* | ~$0.000071 | ~1045 |
| `listing-fr-clean` | clean | 1020×1280 | T1 · `local-regex` | 92% | 0 B | 795,000 / 795,000 | Yes | 1100 ms | 0 *(measured)* | $0 | ~1045 |
| `payslip-fr-clean` | clean | 960×1220 | T1 · `local-regex` | 93% | 0 B | 11,800 / 11,800 | Yes | 1616 ms | 0 *(measured)* | $0 | ~1045 |
| `qr-bill-photo-tilt` | photo | 1095×600 | T0 · `qr` | — | 0 B | 412 / 412 | Yes | 63 ms | 0 *(measured)* | $0 | ~1385 |
| `qr-bill-photo-lowres` | photo | 895×509 | T2 · `vision-llm` *(offline: offline-heuristic)* | 38% | 0 B | 1 / 412 | No *(offline fallback — escalates to VLM/LLM)* | 1621 ms | ~496 *(est.)* | ~$0.000071 | ~705 |
| `listing-photo-glare` | photo | 931×1112 | T1 · `local-regex` | 92% | 0 B | 940,000 / 940,000 | Yes | 970 ms | 0 *(measured)* | $0 | ~1045 |
| `receipt-photo-desk` | photo | 644×1114 | T1 · `local-regex` | 78% | 0 B | 87.45 / 87.45 | Yes | 1888 ms | 0 *(measured)* | $0 | ~1385 |
| `receipt-photo-dim` | photo | 511×836 | T2 · `vision-llm` *(offline: offline-heuristic)* | 37% | 0 B | — / 87.45 | No *(offline fallback — escalates to VLM/LLM)* | 4850 ms | ~792 *(est.)* | ~$0.00019 | ~705 |
| `payslip-photo-fold` | photo | 923×1183 | T1 · `local-regex` | 85% | 0 B | 8,650 / 8,650 | Yes | 2008 ms | 0 *(measured)* | $0 | ~1045 |
| `note-photo-desk` | photo | 778×626 | T2 · `vision-llm` *(offline: offline-heuristic)* | 31% | 0 B | 1,012,252 / 25,000 | No *(offline fallback — escalates to VLM/LLM)* | 4595 ms | ~496 *(est.)* | ~$0.000071 | ~1045 |
| `receipt-fr-photo` | photo | 641×899 | T1 · `local-regex` | 74% | 0 B | 42.80 / 42.80 | Yes | 6753 ms | 0 *(measured)* | $0 | ~1045 |
| `receipt-cafe-photo` | photo | 565×574 | T2 · `text-llm` *(offline: offline-heuristic)* | 74% | 0 B | 32.40 / 32.40 | Yes *(offline fallback)* | 10994 ms | ~378 *(est.)* | ~$0.000088 | ~1045 |
| `note-typed-photo` | photo | 790×564 | T1 · `text-llm` *(offline: offline-heuristic)* | 89% | 0 B | 18,500 / 18,500 | Yes *(offline fallback)* | 3610 ms | ~201 *(est.)* | ~$0.000040 | ~1045 |

## 3. Summary by cascade tier

| Tier / Route | Share of docs | Accuracy | Avg latency | Avg tokens | Avg cost / doc |
|---|---:|---:|---:|---:|---:|
| Tier 0 · QR-bill (local) | 2/19 (11%) | 2/2 (100%) | 74 ms | 0 | $0 |
| Tier 1 · Local regex (local) | 11/19 (58%) | 11/11 (100%) | 1844 ms | 0 | $0 |
| Tier 2 · Text model (receipt OCR) | 1/19 (5%) | 1/1 *(offline fallback)* | 10994 ms | ~378 (est.) | ~$0.000088 |
| Tier 1 · Text model (other OCR) | 1/19 (5%) | 1/1 *(offline fallback)* | 3610 ms | ~201 (est.) | ~$0.000040 |
| Tier 2 · Vision LLM (512px gray JPEG) | 4/19 (21%) | 0/4 *(offline fallback)* | 3007 ms | ~570 (est.) | ~$0.00010 |

## 4. Headline comparison & unit economics

Assumptions for scale projection: **20 snaps / user / month** across **100,000 active users** (2,000,000 snaps/month) with this benchmark's document mix (bills, receipts, listings, payslips, handwritten notes; clean + phone photos).

| Metric | Doppel cascade (measured local + est. cloud) | Naive GPT-4o high-detail (estimated) | Delta |
|---|---:|---:|---:|
| Docs resolved locally at **0 tokens** | **13/19 (68%)** | 0/19 (0%) | +68 pp local |
| Local-tier amount accuracy (Tier 0 + local-regex) | **13/13 (100%)** | — | 0 bytes left device |
| Overall amount accuracy (offline-only run) | 15/19 (79%) *(6 docs escalate to cloud VLM/LLM)* | not run (no key) | — |
| Avg latency per doc (Node) | 2477 ms | ~1,800–3,500 ms (typical VLM RTT) | — |
| Avg tokens / doc | **150 tok** | 1081 tok | **−86.1%** |
| Avg cost / doc | **$0.000028** | $0.00360 | **−99.2%** |
| Cost / 1,000 snaps | **$0.03** | $3.60 | **−99.2%** |
| Cost / 100k users / month (20 snaps/mo) | **$56/mo** | $7,204/mo | **Saves $7,148/mo** |
| Rough energy / 1,000 snaps *(estimate)* | ~31.5 Wh | ~648.5 Wh | ~95% lower |

> **Energy note:** Rough estimate: ~0.0006 Wh/tok frontier (Epoch AI, 2025), ~0.0002 Wh/tok small model (Google, 2025), ~0.002 Wh local CPU pass (15 W × 0.5 s). Varies 3–5× by hardware and batching.

## 5. Receipt line items

| Receipt | Cascade route | Rows extracted / expected | Names matched | Names and cents matched | Item sum |
|---|---|---:|---:|---:|---|
| receipt-clean | T1 · local-regex | 13 / 13 | 13 | 13 | Pass |
| receipt-market-clean | T1 · local-regex | 6 / 6 | 6 | 6 | Pass |
| receipt-cafe-clean | T1 · local-regex | 5 / 5 | 5 | 5 | Pass |
| receipt-photo-desk | T1 · local-regex | 13 / 13 | 11 | 11 | Pass |
| receipt-photo-dim | T2 · vision-llm | 0 / 13 | 0 | 0 | Fail |
| receipt-fr-photo | T1 · local-regex | 4 / 4 | 4 | 4 | Pass |
| receipt-cafe-photo | T2 · text-llm | 4 / 5 | 4 | 4 | Fail |

Across 7 receipts, 43/59 item names and 43/59 name-and-amount pairs matched. 5/7 extracted baskets reconciled. Routing chose Tier 1 for 5, Tier 2 text for 1 and Tier 2 vision for 1. Escalated rows show the offline result available to review.

Names match one to one after normalizing punctuation, spaces and accents. The amount must agree to the cent. Reconciliation compares the signed item sum with the extracted printed total within CHF 0.05. Overall document amount accuracy uses the larger of CHF 0.05 or 0.5% of the ground truth.

## 6. Previous run and limits

* The previous 16-document live run read all 16 totals within tolerance and resolved 11/16 locally. Its four receipt scans returned totals and had no line-item output. It measured 123 average Doppel tokens and 966 GPT-4o tokens per document, with $0.02 and $2.61 per 1,000 documents respectively. This run adds three images and uses a different OCR setup. Its cloud figures are estimates when no key is set.
* The Node benchmark shares the receipt parser, receipt confidence and reconciliation gates with the app and uses the bundled Tesseract languages. Node and browser image cleanup and font rasterization can differ. The Node mirror retains its 75% local gate for other document types. The timing column measures the Doppel cascade separately from GPT-4o.
* The images are synthetic fixtures with simulated phone-photo degradation. The browser smoke suite checks the production review for clean line-item scans and exercises text escalation offline.
