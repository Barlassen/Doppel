# Work plan and integration order

State on 2026-11-22 04:30 (Europe/Zurich): `main` = `43446e8`. Contents:
- web app in four languages
- Barlas / Meriç / Oktay accounts
- receipt line items
- floor-plan and chart vision routes
- bank CSV, camt.053 and broker/3a imports, plus the new-account wizard
- the UBS starter data in `data/ubs/`
- design docs `docs/PLAY.md` and `docs/REAL_WORLD_FACTORS.md`

## 1. Work in flight (not on `main` yet)

| Branch | What | Touches | Merge order |
|---|---|---|---|
| `t3/integrate-ubs-synthetic-data` | UBS data layer `src/lib/ubs/`, liabilities in the engine, multiple goals, "Open a UBS profile" picker, Alexia's three paths on the dashboard | `src/lib/finance/*`, `src/lib/accounts/*`, `DoppelApp`, `AccountSwitcher`, `Hero`, `Cards`, `ConeChart`, dictionaries (`ubs` group) | **1st** |
| `t3/playable-financial-simulator` | `/play` life game, phase 1 of `docs/PLAY.md` (MCTS review, move labels, impact donuts, branching) | `src/lib/game/*`, `src/app/play/*`, `src/components/play/*`, `monteCarlo.ts`, `types.ts`, dictionaries (`play` group), a stub `src/lib/ubs/` | **2nd**. Its UBS stub is replaced by the real layer from step 1; conflicts are expected in `types.ts` and `monteCarlo.ts`. |

## 2. Work from the other thread ("AI Slop ve JetBrains Entegrasyonu")

| Item | Where | State | Plan |
|---|---|---|---|
| Anti-slop leftovers | `t3/anti-slop-docs-review`, 2 commits: `e5f4b62` docs and decisions, `77206ba` removes decorative emoji from Cards, Inspector and PlanCompare | Most of the anti-slop work is already on `main` (`5d3276c`, `790fd66`, `1fc0e99`) | **3rd**. Cherry-pick `77206ba`. Review `e5f4b62` against the current docs (README, ARCHITECTURE, DECISIONS, PITCH changed since), then port only what is still missing. |
| Doppel Pocket (Kotlin Multiplatform) | `t3/b586bd62`, 8 commits, which includes `t3/pocket-feature-parity`. Contains: ports + versioned contract, engine-parity cards, gateway, snap pipeline, ledger + Inspector, and the UI pass `c28c301` (marked WIP, unverified) | Outside `pocket/` it only adds `scripts/pocket-*-golden.ts`, so the conflict risk is low | **4th**. Run the Gradle tests and verify the UI pass, then merge. Still open: step 7, `docs/INTEGRATION.md` (TKT bridge proposal and accounts/sync seam). |
| Pocket parity with the new web features | — | Pocket still uses the legacy Lukas/Elena golden fixtures (`scripts/fixtures/legacy-profiles.ts`) | After steps 1–2: port the accounts, liabilities, multiple goals and receipt items, then regenerate the golden files on purpose |
| Real-world factors | `docs/REAL_WORLD_FACTORS.md` (on `main`) | Research done. Two claims are unverified: BVG minimum rate 2.0% in 2027, and the 29 Nov 2026 VAT vote. | **After steps 1–2**, because it changes the engine. Phase 1: health premiums, child phases + university, car vs GA. Owner decisions are pending (see §5). |

## 3. Tasks for Oktay (each starts from `main`)

Each task has a self-contained brief that an agent can run directly: [A](tasks/A-open-source-models.md) · [B](tasks/B-donut-pixels.md) · [C](tasks/C-judging-and-demo.md) · [D](tasks/D-smoke-wizard-import.md) · [E](tasks/E-tkt-bridge.md). Every agent reads [AGENTS.md](../AGENTS.md) first.

| # | Task | Conflict risk | When |
|---|---|---|---|
| A | **Open-source models.** Switch `DOPPEL_TEXT_MODEL` / `DOPPEL_VISION_MODEL` defaults to open-weight models on OpenRouter (Qwen / Llama / Mistral; Qwen-VL for vision). Re-run `scripts/benchmark.ts` and `npx tsx --env-file=.env.local scripts/vision-benchmark.ts --live`, then update `docs/BENCHMARK.md`, `docs/VISION_BENCHMARK.md` and the DECISIONS entry. The UBS brief asks for this explicitly. | Low: `.env.example`, `route.ts` defaults, docs | Now |
| B | **Donut charts measured from pixels.** The model only maps legend colours to asset classes; TypeScript measures the slice angles. Also find out why `plan-cad-areas` maps only 7/10 rooms. A partial `src/lib/snap/vision/donut.ts` exists in worktree `t3-4b1c439c` (uncommitted). | Low: `src/lib/snap/vision/*`, `scripts/vision-benchmark.ts` | Now |
| C | **Judge evidence and demo script.** Write `docs/JUDGING.md`, mapping the six rubric criteria and the five judge questions to evidence in the app. Add a 3-minute Alexia demo flow and an assumptions-and-limitations list. Inputs: the starter-kit files `judge-scorecard.md`, `demo-and-submission.md`, `responsible-ai-and-data.md`. | None (docs) | Draft now, update after steps 1–2 |
| D | **Smoke steps for the wizard and the imports.** Create an account, import a sample CSV and a camt.053 file, edit a category, undo, delete. | Medium: `scripts/browser-smoke.mjs` is edited by both in-flight branches | After steps 1–2 |
| E | **TKT bridge.** Level 1: Doppel keyboard shortcuts already planned for `/play`; TKT gestures map to them. Level 2: a local event and document-capture bridge in TKT's `app` layer, standard library only, via PR per TKT's `AGENTS.md`. | TKT repo only | After `/play` lands |

### Rules
- Branch from `main` and open a PR. Don't push to `main` directly.
- Until steps 1–2 are merged, don't edit `src/lib/finance/*`, `src/lib/accounts/*`, `src/components/DoppelApp.tsx`, `AccountSwitcher.tsx`, `src/lib/ubs/*`, `src/lib/game/*` or `src/app/play/*`.
- In the dictionaries, add new keys in your own top-level group. Append smoke steps rather than rewriting existing ones.
- **Gates:** `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx tsx scripts/i18n-check.ts` (strict), `npx tsx scripts/engine-check.ts`, `npm run smoke:browser`. Run `npm run build` before the smoke test.
- Never commit `.env.local`. When starting a dev server, use your own port and stop only your own process; never kill all node processes.

## 4. Merge checklist (after each step)

1. Resolve conflicts, then run all gates.
2. Confirm that `engine-check` numbers for Barlas / Meriç / Oktay are unchanged unless the step changes the engine on purpose.
3. Run `vision-benchmark` offline; for vision changes, also run it `--live` with the key.
4. Look at screenshots at 320 and 1280 px in EN and TR.
5. Push to `main`.

## 5. Open owner decisions

From the real-world factors research:
- default for "does the child go to university" (yes / no / draw)
- child cost basis
- wizard depth
- default economic regime
- BVG conversion rate assumption
- climate stress opt-in
- Pocket sync cadence

From `/play`, after phase 1 is shown:
- evaluation weights preset
- game length
- the phase 2 side-boards scope
