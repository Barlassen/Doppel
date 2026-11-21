# Doppel — Vision Document Analysis Benchmark (Floor Plans & Charts)

Generated directly by [`scripts/vision-benchmark.ts`](../scripts/vision-benchmark.ts).

> **Measurement basis:** **Offline mode (recorded vision fixtures)** — no `OPENROUTER_API_KEY` was present in this checkout. Local pixel structure detection (`detectVisionFromSignals`), Tesseract OCR (`eng+deu+fra`), cropped JPEG dimensions & byte sizes, the OCR+regex-only baseline, and deterministic TypeScript verification were all **executed and measured locally**. Model extraction responses used the recorded offline fixtures (`offlineFloorPlanFromOcr` / `offlineChartFromOcr`). Run `OPENROUTER_API_KEY=... npx tsx scripts/vision-benchmark.ts --live` to measure live OpenRouter tokens, latency, cost, and live model extraction accuracy.

## 1. Frugal document-type routing & crop sizes (8 samples)

Instead of waiting for OCR confidence to fail, `detectVisionFromSignals()` (`src/lib/snap/vision/detect.ts`, **0 tokens**) combines browser-computable pixel signals with OCR keyword/number counts on a `<=360px` RGBA probe:

* **Floor plans (`vision-plan`)**: routed when `orthogonalWallScore >= 0.36` (thin dark horizontal **and** vertical interior wall runs bordered by light room interiors) plus room/dimension/scale cues, **or** `>= 3` room labels with multiple areas/dimensions. Cropped to the ink bounding box and downscaled to **max edge `768px` grayscale JPEG (`q = 0.68`)** so small printed room dimensions like `4.20 × 3.80` stay sharp.
* **Charts (`vision-chart`)**: routed when financial chart keywords pair with a donut colour signature (`colorSegmentScore >= 0.42` across `>= 3` distinct 30° saturated hue bins) or a continuous thin curve stroke (`curveScore >= 0.42` across `>= 48%` of columns). Cropped and downscaled to **max edge `512px` colour JPEG (`q = 0.65`)** because donut legends map categories by colour hue.
* **Control & standard documents (`local-regex`, `0` tokens)**: plain-text listings (`listing-text-only`), QR-bills, receipts, and payslips do not trigger vision tokens.

| Sample | Orig px | Wall score | Colour score | Curve score | Hue bins | OCR nums | Chosen route | Left device (crop) | Model tokens |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| `plan-cad-areas` | 1100×900 | 0.59 | 0.00 | 0.00 | 0 | 43 | `vision-plan` | 768×624 (31.9 KB) | offline fixture |
| `plan-dimensions-only` | 1100×900 | 0.46 | 0.00 | 0.00 | 0 | 42 | `vision-plan` | 768×624 (26.4 KB) | offline fixture |
| `plan-35-halfroom` | 1100×860 | 0.55 | 0.00 | 0.00 | 0 | 41 | `vision-plan` | 768×534 (27.5 KB) | offline fixture |
| `plan-photo-skewed` | 1001×836 | 0.85 | 0.00 | 0.00 | 0 | 35 | `vision-plan` | 768×658 (30.6 KB) | offline fixture |
| `chart-donut-legend` | 960×640 | 0.00 | 1.00 | 0.00 | 4 | 0 | `vision-chart` | 512×319 (11.5 KB) | offline fixture |
| `chart-line-drawdown` | 960×640 | 0.00 | 0.02 | 1.00 | 1 | 14 | `vision-chart` | 512×305 (8.5 KB) | offline fixture |
| `chart-app-both` | 960×880 | 0.00 | 1.00 | 0.99 | 4 | 8 | `vision-chart` | 512×473 (14.7 KB) | offline fixture |
| `listing-text-only` | 1000×820 | 0.00 | 0.01 | 0.00 | 1 | 11 | `local-regex` | 0 B (local) | 0 *(local)* |

## 2. Swiss floor plans: OCR+regex-only baseline vs `vision-plan` + TypeScript verification

* **Living-area tolerance:** interior rooms sum checked against stated net living area within **±10%** (`LIVING_AREA_TOLERANCE = 0.1`), plus an explicit check catching listings whose stated `Wohnfläche` erroneously includes the exterior balcony/terrace.
* **Swiss room-count convention:** living room, bedrooms, and offices (`>= 6 m²`) = `1.0`; open dining / half-room = `0.5`; kitchen, bathroom/WC, corridor/hall, storage, and balcony/terrace = `0`.
* **Regional price/m²:** compared against the embedded table of **illustrative approximate regional condo medians** (`ILLUSTRATIVE_REGIONAL_MEDIANS` in `src/lib/snap/vision/floorplan.ts`).

| Floor-plan sample | OCR+regex rooms mapped | OCR+regex living area | Vision+TS rooms mapped | Vision+TS net living area | Swiss room count | Price / m² (illustrative regional median) | Deterministic verification output |
|---|---:|---|---:|---|---|---|---|
| `plan-cad-areas` | 0/10 | 112 m² (OK) | **10/10** | **112 m²** (OK) | 4.5 (4.5 verified) | CHF 8,390/m² (Winterthur) | ✓ Room areas sum to 112.0 m² (within ±10% of stated 112.0 m² living area). |
| `plan-dimensions-only` | 0/9 | — (missed) | **9/9** | **96.4 m²** (OK) | 4.5 (4.5 verified) | CHF 8,770/m² (Bern) | ✓ Net living area computed deterministically from room dimensions: 96.4 m². |
| `plan-35-halfroom` | 0/7 | 88 m² (OK) | **7/7** | **88 m²** (OK) | 3.5 (3.5 verified) | CHF 10,110/m² (Lausanne) | ✓ Room areas sum to 83.0 m² (within ±10% of stated 88.0 m² living area). |
| `plan-photo-skewed` | 0/10 | 126 m² (WRONG: incl. balcony) | **10/10** | **112 m²** (OK) | 4.5 (4.5 verified) | CHF 8,390/m² (Winterthur) | ⚠ Stated 126.0 m² includes the 14.0 m² balcony/terrace. Interior net living area is 112.0 m² (±10% tolerance). |

## 3. Portfolio / 3a charts: OCR+regex-only baseline vs `vision-chart` + TypeScript verification

* **Allocation sum rule:** slices must sum to **`100 ± 2` percentage points** (`ALLOCATION_SUM_TOLERANCE_PP = 2`).
* **Risk profile mapping:** deterministic mapping from equity share (`>= 62%` → `growth`, `40–61%` → `balanced`, `< 40%` → `conservative`).
* **Time-series & drawdown rule:** monthly `YYYY-MM` points checked for strict chronological monotonicity, endpoint checked against printed total (**±5%** axis tolerance), and peak-to-trough drawdowns **`>= 10%`** computed in TypeScript.

| Chart sample | OCR+regex allocation | OCR+regex drawdown | Vision+TS allocation | Sum check (100±2%) | Derived risk | Latest value / endpoint check | Deterministic peak-to-trough drawdown |
|---|---|---|---|---|---|---|---|
| `chart-donut-legend` | — (0/4 slices) | — (missed) | **65% eq / 20% bo / 10% re / 5% ca** | 100.0% (✓ 100±2) | `growth` | — | — |
| `chart-line-drawdown` | — (0/4 slices) | — (missed) | n/a (line chart) | — | `—` | CHF 96,500 (✓ endpoint=total) | **−18.1%** (2026-03 → 2026-06) |
| `chart-app-both` | — (0/4 slices) | — (missed) | **70% eq / 18% bo / 7% re / 5% ca** | 100.0% (✓ 100±2) | `growth` | CHF 114,000 (✓ endpoint=total) | **−15.2%** (2026-03 → 2026-06) |

## 4. Control sample (`listing-text-only`) & what `--live` measures

1. **Zero vision tokens when OCR suffices:** On `listing-text-only.svg` (`4.5 Zimmer Eigentumswohnung · Römerstrasse 88, 8400 Winterthur · Kaufpreis CHF 860'000.– · Wohnfläche: 108 m²`), `detectVisionFromSignals` measures `orthogonalWallScore = 0.00` and `0` room-box labels, so it returns `kind: "none"`. The standard Tier 1 `local-regex` extractor reads `CHF 860,000`, `4.5 rooms`, and `Winterthur` at **0 tokens and 0 bytes sent**.
2. **What `--live` measures:** When run with `OPENROUTER_API_KEY=... npx tsx scripts/vision-benchmark.ts --live`, the script sends each cropped `<=768px` floor-plan JPEG and `<=512px` chart JPEG to OpenRouter (`google/gemini-2.5-flash-lite`), validates the live JSON response with `validateFloorPlanExtraction()` / `validateChartExtraction()`, runs `verifyFloorPlan()` / `verifyChart()`, and populates the **Model tokens** column and accuracy cells from the live provider responses.
