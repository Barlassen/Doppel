# Task D: browser smoke steps for the wizard and the imports

**Owner:** Oktay (or an agent he runs). **Start:** after the UBS data layer and `/play` are merged (see `docs/WORKPLAN.md`). **Conflict risk:** medium, because `scripts/browser-smoke.mjs` is shared.
Read `AGENTS.md` first, then `docs/ACCOUNTS.md`, `src/components/{AccountWizard,ImportPanel,TransactionsPanel,AccountSwitcher}.tsx`, `src/lib/import/*` and `scripts/browser-smoke.mjs`.

## Why
The data-in features have unit and round-trip tests (`npx tsx scripts/import-check.ts`). The UI flows were only checked by hand.

## Add these smoke steps, appended in their own block
1. Open the account switcher → "New account" → fill the wizard (name, age, canton/city, income, rent, balances, risk, goal) → "Create account". Check that the account appears in the switcher and the headline renders.
2. In "Your data" → "Try a sample file", load `oktay-neon.csv`. Check the review counts (new / duplicates / income / transfers), change one category, confirm, and check that the transactions list grows and the headline recomputes.
3. Load `meric-postfinance.camt053.xml` and confirm.
4. Re-import the same file and check that every row is reported as a duplicate.
5. Open "Import history" and undo the last import. Check that the rows are gone.
6. Delete the created account. Check that the switcher returns to a built-in account.
7. Repeat steps 1–2 at 320 px in Turkish and run `assertNoOverflow`.

## Rules
- **Selectors:** read labels from the dictionaries via `translate()`, as the existing locale steps do; don't hard-code English.
- **File inputs:** scope them precisely (the snap input is `input[type="file"][accept="image/*"]`).
- **Before running:** `npm run build`, then `DOPPEL_SMOKE_PORT=<your port> npm run smoke:browser`.

## Done when
The full smoke test passes twice in a row and the new block prints a "passed" line like the others.
