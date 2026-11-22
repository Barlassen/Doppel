# Task A: switch to open-source models and re-measure

**Owner:** Oktay (or an agent he runs). **Start:** now. **Conflict risk:** low.
Read `AGENTS.md` first.

## Why
UBS told teams to "use open-source LLMs (Llama, Qwen, Mistral)". Doppel currently defaults to `google/gemini-2.5-flash-lite` for text and vision, and to `openai/gpt-4o` for the naive comparison baseline. Open-weight models also strengthen the AXA "frugal" story: self-hostable, no lock-in.

## What to do
1. **Choose the models on OpenRouter.**
   - Text: Qwen or Llama; vision: a Qwen-VL class model. Mistral is an alternative for either.
   - Check that each one supports `response_format: json_object` (or reliable JSON) and image input where needed.
   - Check the prices on OpenRouter and record them with the date.
   - Keep `DOPPEL_NAIVE_MODEL=openai/gpt-4o`. It is the "what a naive app would do" baseline and must stay a frontier model.
2. **Change the defaults** in `.env.example`, `src/app/api/twin/route.ts` (default model constants) and `src/lib/frugal/tokens.ts` (prices used by the ledger and the Inspector). Prompts, schemas and token caps stay the same unless the new model needs a change. Keep those changes small and explain them.
3. **Re-measure live.** You need your own `OPENROUTER_API_KEY` in `.env.local`, and you must not commit it.
   - `npx tsx scripts/benchmark.ts`: regenerates `docs/BENCHMARK.md`.
   - `npx tsx --env-file=.env.local scripts/vision-benchmark.ts --live`: regenerates `docs/VISION_BENCHMARK.md`, including "Live misses".
   - Compare with the current Gemini numbers: accuracy, tokens, cost, latency. If an open model is clearly worse on a route, keep the better model for that route and say why.
4. **Update the docs.** In `docs/DECISIONS.md`, add a decision entry for the model choice, with the alternatives you rejected and the measured evidence. In `README.md`, update the model names and the evidence table.

## No API key? (current situation)
Live runs need `OPENROUTER_API_KEY`. Without one:
- Do the code part and pass all offline gates.
- **Do not commit `docs/BENCHMARK.md` or `docs/VISION_BENCHMARK.md` regenerated offline.** The benchmark scripts overwrite these reports, and the committed versions hold real live measurements. Run `git checkout -- docs/BENCHMARK.md docs/VISION_BENCHMARK.md` before committing.
- Write "live measurement pending: coordinator" in the PR. The coordinator merges the PR, runs the live benchmark with the key on `main`, and commits the report. A model that measures worse does not become the default.

## Done when
- All gates in `AGENTS.md` §5 pass.
- Both benchmark reports come from **live** runs with the new models. Misses are listed, nothing is hidden, and no fixture is presented as live.
- The PR description includes a before/after table (accuracy, tokens/doc, cost/1'000 docs, latency) and anything you couldn't verify.
