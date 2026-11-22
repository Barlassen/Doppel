# Task C: judge evidence map and demo script

**Owner:** Oktay (or an agent he runs). **Start:** draft now; update after the UBS data layer and `/play` land. **Conflict risk:** none (docs only).
Read `AGENTS.md` first, then `docs/DECISIONS.md` (it already has prepared jury answers), `docs/PITCH.md`, `docs/PLAY.md` and `docs/WORKPLAN.md`.

## Why
The judges score six criteria (`AGENTS.md` §1) and ask five fixed questions. For each one we need a short answer that points to evidence you can **show on screen or reproduce with one command**. The UBS starter kit's `demo-and-submission.md` also lists the evidence it expects:
- a fictional profile and initial state
- at least one meaningful intervention
- a reproducible before/after comparison
- explicit assumptions and calculation logic
- a way for users to inspect outcomes and limitations

## Deliverables
1. **`docs/JUDGING.md`.**
   - **Rubric table:** one row per criterion. Columns: what Doppel demonstrates, where it is on screen, the command that reproduces it, and honest gaps.
   - **The five judge questions:** each gets a 3–5 sentence answer with concrete evidence:
     - assumption sensitivity;
     - state change per decision;
     - verification: `engine-check`, `i18n-check`, `import-check`, `vision-benchmark`, smoke and unit checks;
     - constraint violation: cash crunch, mate in `/play`, the Tragbarkeit fail;
     - what's next.
   - **Responsible design:** synthetic data only; provenance labels; no stock picks; luck shown apart from decision quality; what leaves the device per route; the LLM narrates only.
2. **A three-minute demo script with Alexia** (UBS profile P00001: age 20, Lausanne, CHF 8'000). Cover:
   - initial state;
   - the three paths (work / master's / move abroad) as Plan A/B on the dashboard;
   - one snap (receipt or payslip) that updates the twin;
   - `/play`: two moves with engine review and a branch;
   - the Inspector's frugal evidence;
   - one validation command.

   Note what to click and what to say. Add a 60-second fallback if the network fails: everything except the narration works offline.
3. **Assumptions and limitations.** List the key engine assumptions and their sources (returns, inflation, salary growth, BVG/AHV, mortgage stress rate, regional prices marked illustrative). List the known limits: synthetic data; typical-layout bank profiles that were not verified against real exports; vision limits on skewed photos; the parameters still open in `docs/REAL_WORLD_FACTORS.md`.

## Rules
- Every claim must be reproducible. Quote numbers only from committed reports or command output, and give the command.
- Write plainly; no hype. The AXA track penalises "AI slop".

## Done when
`docs/JUDGING.md` exists and links from `README.md`. Each rubric row has evidence or an honest gap. After the UBS layer and `/play` merge, re-check the numbers and the click paths.
