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
| ~~`t3/integrate-ubs-synthetic-data`~~ **merged 2026-11-22** | UBS data layer `src/lib/ubs/` (API in `docs/UBS.md`), liabilities with annuity amortisation, multiple goals, "Open a UBS profile" picker, Alexia's three paths, provenance panel | — | done |
| ~~`t3/playable-financial-simulator`~~ **merged 2026-11-22** | `/play` phase 1 (MCTS review, move labels, impact donuts, branching, game review). Uses the real UBS layer; the game runs its own simulator copy `src/lib/game/sim.ts` (see follow-ups) | — | done |

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

## 6. Live measurement (Barlas, with the key in `.env.local`)

Run on an up-to-date `main` after Oktay's A/B PRs are merged:

```bash
npx tsx scripts/benchmark.ts                                         # reads .env.local itself → docs/BENCHMARK.md
npx tsx --env-file=.env.local scripts/vision-benchmark.ts --live     # → docs/VISION_BENCHMARK.md (see "Live misses")
```

Check that both reports say "live" in their measurement-basis line and that the misses are listed. Commit the two reports. If a new open model scores worse on a route, set that route's model back in `.env.example` / `route.ts` defaults before committing.

## 7. Team split (2026-11-22)

| Who | Works through | Tasks |
|---|---|---|
| **Coordinator thread** ("Swiss Financial Digital Twin", Claude) | its own agents | Finish and merge the in-flight UBS data layer and `/play` phase 1 (§1); the anti-slop leftovers (§2, plus the open copy fixes below); a "which assumptions matter most" sensitivity panel (judge question 1) after the merges; real-world factors phase 1 once the owner decides (§5); `/play` phase 2 side boards after the owner reviews phase 1 |
| **Oktay** | his own agents, no API key | Tasks A–E in `docs/tasks/` (A, B, C now; D, E after the in-flight merges) |
| **Barlas** | the "AI Slop ve JetBrains Entegrasyonu" thread and its agents | The JetBrains track (J1–J7 below); live measurements after A/B (§6); owner decisions (§5); confirming submission rules and deadlines with the organisers |

### JetBrains track (Barlas)

Requirement, as recorded in the other thread: a Kotlin Multiplatform app on at least two platforms. Doppel Pocket (`pocket/`, Android + Desktop JVM, Compose Multiplatform) is merged on `main` and meets it. Check the track's exact judging criteria with the organisers.

| # | Task | State / notes |
|---|---|---|
| J1 | Merge the Pocket continuation branch `t3/b586bd62` | 8 commits: ports + versioned contract, engine-parity cards, gateway, snap pipeline, ledger + Inspector, and the UI pass `c28c301` (WIP, **unverified**). Run `.\gradlew.bat :shared:jvmTest :composeApp:assembleDebug`, check desktop + Android emulator screenshots, then merge. Outside `pocket/` it only adds `scripts/pocket-*-golden.ts`. |
| J2 | Write `docs/INTEGRATION.md` | The TKT bridge and accounts/sync seam proposal (Pocket step 7). Use the **same** event contract as Oktay's task E. |
| J3 | Pocket ← new web features | Replace Lukas/Elena with Barlas/Meriç/Oktay and regenerate the golden files on purpose (`npx tsx scripts/pocket-engine-golden.ts`); add receipt line items. After the UBS layer merges: UBS profiles, liabilities, multiple goals. Pocket README still mentions Lukas/Elena. |
| J4 | Fresh-clone check in IntelliJ IDEA | Gradle sync with JDK 17 from a clean clone. Not done yet. Judges will open the project in the IDE. |
| J5 | JetBrains Air bonus | A human team member uses Air for a real, small change (idea: add a golden parity case with a CHF 500 standing order). Keep screenshots as evidence. |
| J6 | Demo assets | A short GIF or video of Android + Desktop; update the Pocket README. |
| J7 | Optional third target | Compose for Web (wasm). Only if time remains. |

Barlas's agents also read [AGENTS.md](../AGENTS.md) and keep to the ownership rules in §3. Pocket work stays inside `pocket/` and `scripts/pocket-*`.

### Open copy fixes found by the anti-slop review (coordinator)

Apply in all four dictionaries:
- remove the leftover emoji prefixes;
- `inspector.title` → "Token usage and cost";
- reword `invest.taxLeft` and `invest.growthWarning`;
- accuracy fixes: `banker.hint` (overstates "~150 tokens, numbers only"), `inspector.liveCheckText` (it sends a ≤2048 px JPEG, not the original image), `inspector.tier2Text` (omits the OCR-failure route).


## 8. Follow-ups after the /play merge (coordinator)

- **One simulator.** `src/lib/finance/monteCarlo.ts` (dashboard: liabilities, multiple goals, nominal cash-flow phases, accounting mode) and `src/lib/game/sim.ts` (play: regimes, indexed income phases, starting home, loans, shocks) were extended in parallel and are both validated (`ubs-check` / `engine-check` vs `play-check`). Merge them into one engine with both feature sets, keeping all three checks green.
- **The /play picker** now lists every non-retired UBS profile under 61 (~980) in a native select. Replace it with the dashboard's searchable picker.
- **Spec changes the /play agent proposed** (`docs/PLAY.md` §13): a stretch goal (UBS goals are often reached within 2–3 years, which flattens the goal term), defined dealing rules under check, the luck definition's small replanning bias, an ungraded "life choice" category, retirement out of scope for now, and Alexia's tuition source (S001 CHF 8'000/yr replaces the config's 2 × CHF 2'500).
