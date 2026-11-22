# Task B: measure donut-chart slices from pixels; fix the CAD-plan room misses

**Owner:** Oktay (or an agent he runs). **Start:** now. **Conflict risk:** low.
Read `AGENTS.md` first, then `docs/VISION_BENCHMARK.md`, `scripts/vision-benchmark.ts`, `src/lib/snap/vision/{detect,chart,floorplan,index,limits}.ts` and `src/components/VisionReview.tsx`.

## Why
The live vision benchmark (`gemini-2.5-flash-lite`) found two weak spots:
- **Donut charts:** the small vision model estimates slice shares badly from arc angles. It reads equities as 50% and 60% where the truth is 65% and 70% (`chart-donut-legend`, `chart-app-both`). The derived risk profile then comes out "balanced" instead of "growth". This is a known weakness of small VLMs.
- **`plan-cad-areas`:** only 7/10 rooms are matched. The other three plans are fully correct.

The fix follows Doppel's core rule: **the model reads, TypeScript measures.**

## Part 1: pixel geometry for donut and pie charts (0 tokens)
1. From the cropped chart image (canvas RGBA in the browser; the Node canvas in the benchmark):
   - find the centroid of the saturated, non-background pixels;
   - estimate the inner and outer radius from a radial profile of saturated-pixel density;
   - sample a ring at mid-radius over 720 or more angles;
   - cluster the sampled colours deterministically (for example, quantise in Lab, then merge near clusters);
   - measure each cluster's angular share.

   The shares then sum to 100 by construction. Handle anti-aliased borders, white gaps between slices, and label text inside the hole. Report a quality score (ring coverage, cluster count, gap fraction).
2. Narrow the model's task for allocation charts to the **legend mapping only**: `[{ "assetClass": "equities|bonds|cash|realEstate|other", "label": string, "colorHex": "#rrggbb" }]`. Its own share estimate becomes an optional cross-check. Match clusters to legend entries by nearest colour in TypeScript.
3. Verification:
   - Use the pixel shares when quality passes and the cluster count equals the number of legend entries. Otherwise fall back to the model's estimate and show a visible warning.
   - If the pixel and model estimates differ by more than about 10 pp, show an informational note. The pixel value wins.
4. In the review card and the Inspector, show "shares measured from pixels; the model only read the legend" in a short line.
5. Photographed or perspective-skewed donuts may fail the quality check and fall back. Document this limitation.

A partial `donut.ts` was started in an old local worktree but never committed. Start fresh.

## Part 2: why `plan-cad-areas` maps 7/10 rooms
- The benchmark matcher requires an exact room name plus an area within 0.25 m². Find out whether the misses are real misreads or a matcher that is too strict on names ("Bad/WC" vs "Bad / WC", "Réduit" vs "Reduit").
- If the matcher is unfair, normalise names (whitespace, punctuation, diacritics) or match on room type plus area, and say so in the doc.
- If the model really misreads, improve the prompt, crop or resolution within the frugal budget. Don't overfit to the sample.
- **Never change ground truth to make numbers look better.**

## Tests and measurement
- Add a unit test of the pixel measurement on the generated donut samples against their known true shares: within ±1 pp.
- Add an offline fixture for the new legend-mapping response so offline mode passes.
- Run live with your own key: `npx tsx --env-file=.env.local scripts/vision-benchmark.ts --live`. Keep the "Live misses" section and the rule that live mode never falls back to a fixture.
- Put new strings in the existing `vision` dictionary group, in all four languages (see `AGENTS.md` §4).

## Stay inside
`src/lib/snap/vision/*`, `src/components/VisionReview.tsx`, the vision tasks in `src/app/api/twin/route.ts`, `scripts/vision-benchmark.ts`, `scripts/make-vision-samples.ts`, `docs/VISION_BENCHMARK.md`, the Inspector's vision bits, and the `vision` dictionary group.

## Done when
- All gates pass.
- The live run is committed to `docs/VISION_BENCHMARK.md`.
- The PR description includes a table of pixel vs truth vs the old model-only estimate, plus your Part 2 diagnosis.
