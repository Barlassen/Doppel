# Doppel: guide for humans and coding agents

Read this file before you change anything. Then read the documents it links for the area you work on. It covers what the project is, how it is built, the rules that keep it correct, and how the team works in parallel without breaking each other's work.

## 1. What Doppel is

Doppel is a **Swiss personal-finance digital twin**. It was built at LauzHack 2026 for two tracks:

- **UBS "AI Financial Twin"**: help a person explore financial decisions under explicit assumptions. Slogan: *"Don't predict the future. Make it explorable."*
- **AXA "Frugal use of multimodal AI"**: use the cheapest reader that works, account for every token, and avoid "AI slop".

What the user can do:

- open an account: one of three built-ins (Barlas, Meriç, Oktay), one of 1'200 UBS synthetic profiles (after the UBS data layer lands), or their own via a wizard;
- feed it data: receipt photos with line items, QR-bills, payslips, property listings with floor plans, portfolio charts, bank CSV, ISO 20022 camt.053, broker/3a statements, manual entries;
- ask what-ifs in four languages ("retire at 60", "buy a flat in 2028 for 1.2M");
- see the effect: Monte Carlo cone, goal odds, Swiss mortgage affordability (Tragbarkeit), pension (AHV/BVG/3a), a behavioural twin built from real spending and trades, and a goal solver that finds the smallest change that works.

The same twin is also a **life game at `/play`**, a chess-review framing of decisions (phase 1 is on `main`; spec and implementation notes in [docs/PLAY.md](docs/PLAY.md)).

### How the judges score (UBS draft rubric)

| Criterion | Weight |
|---|---:|
| Financial modelling and correctness | 25 |
| Scenario and counterfactual exploration | 20 |
| Technical execution and validation | 15 |
| User experience and communication | 15 |
| Innovation and conceptual depth | 15 |
| Responsible design and transparency | 10 |

Judges will ask:

1. Which assumptions most affect the result?
2. How does a decision change the financial state?
3. How did you verify the calculations?
4. What happens if a constraint is violated?
5. What would you improve next?

The UBS guidance also says: a Monte Carlo simulation alone is not a twin; distinguish inputs, assumptions and outputs; never present a higher simulated net worth as the universally "best" life decision.

## 2. Non-negotiable principles

1. **The LLM never does maths.** Every number on screen comes from deterministic TypeScript in `src/lib/finance/` (or `src/lib/game/` for `/play`). Models only read documents, parse free-form what-ifs the local parsers miss, map legends or categories, and narrate numbers the engine already computed. Model output is validated with strict schemas and re-checked by TypeScript (receipt item sums, floor-plan areas, chart allocations).
2. **Frugal cascade.** QR decode → cache → local OCR + regex (0 tokens) → small text model on ≤ 600–2'800 chars → small vision model on a cropped, downscaled image. Vision-native documents (floor plans, charts) go to vision **by document type**, and a local 0-token detector decides that. Every call goes into the token ledger and the Inspector.
3. **No hindsight, no stock picks.** Model asset classes, not individual securities. "Best move" or "best plan" means best under the stated assumptions across simulated futures, never "Seagate went up more".
4. **Honest evidence.** Never report fixture or offline results as live. Benchmarks list misses (`docs/VISION_BENCHMARK.md` has a "Live misses" section). If something was not measured, say so.
5. **Transparency.** Label every parameter's provenance: `ubs_synthetic`, `doppel_default`, `derived` or `user`. Keep calculated results, assumptions and uncertainty visibly apart.
6. **Keep the visual design.** The product owner likes the current calm layout (results first, details behind disclosures; `CardHeader` and `Section` in `src/components/ui.tsx`). Add elements in the same style; don't redesign.
7. **Fictional data only.** No real personal financial data. All people and companies in samples are fictional.

## 3. Architecture map

```
src/app/
  page.tsx, layout.tsx          dashboard entry (renders DoppelApp)
  api/twin/route.ts             the ONLY server route that calls a model (OpenRouter). Every task has strict
                                input validation, a byte cap and a per-task output-token cap.
  play/                         the /play life game
src/components/
  DoppelApp.tsx                 dashboard state machine: accounts, scenario, mutate() + impact, simulations,
                                outlook, Plan A pin, snaps, ledger, solver, assistant status and ask
  Hero, Cards, ConeChart, RetirementCard, PlanCompare, InvestControls, CommandBar
  Decisions                     "Add a decision": picker, one short form per decision kind (sourced defaults,
                                required inputs from the life model), the list of the plan's events
  OutlookCard                   "What happens next": outlook() as before -> after figures and itemised costs
  EconomyControl                economic scenario picker and the dated, sourced assumptions table
  AskCard                       assistant connected / not connected, ask box, situation summary
  ImportPanel, Learned, statementMemory   bank statement upload and review (the first data action), "What the
                                twin learned" (summarizeStatement + confirm / reject of inferred facts), and
                                what the browser remembers about statements (income rows, fact answers)
  SnapPanel, ReceiptDetails, VisionReview   document photos, collapsed under "Other documents"
  Inspector                     token ledger, "why vision was needed", naive GPT-4o cost comparison
  AccountSwitcher, AccountWizard, TransactionsPanel   accounts, new-account wizard (statement first), bookings
  ui.tsx, cantons.ts            CardHeader, Section, Disclosure and shared constants
src/lib/
  finance/                      the engine: types, monteCarlo, scenario, swissRules, pension, goalSolver,
                                behavioralEngine, investBehavior (behaviour derived from trades)
  accounts/                     local accounts store (built-ins + local additions in localStorage),
                                documented in docs/ACCOUNTS.md
  data/                         built-in personas (profiles.ts, history.ts) and the merchant dictionary
  snap/                         cascade: pipeline, qrBill, ocr, heuristics, receipt (line items), vision/*
                                (floor plans, charts, detector, limits)
  import/                       bank CSV profiles, camt.053, broker/3a CSV, categorisation, review, samples
  twin/                         what-if ops (actions.ts) + local intent parsers per language (intents/*)
  frugal/                       token ledger, prices, naive baseline
  i18n/                         typed dictionaries en/de/fr/tr, translate/format helpers, I18nProvider
  ubs/                          UBS synthetic data layer (API in docs/UBS.md)
  game/                         /play engine (MCTS), cards, evaluation
data/ubs/                       UBS LauzHack 2026 starter data (fictional): profiles, assets, liabilities,
                                goals, scenario catalog, Alexia's paths
public/samples/                 sample documents, import files (imports/), vision samples (vision/), bench photos
scripts/                        checks, benchmarks, sample generators (see §5)
tkt/                            Hand control (Python, MediaPipe): a camera as a pointing device for playing Doppel by
                                hand. Its own rules are in tkt/AGENTS.md. See docs/TKT.md.
pocket/                         Doppel Pocket: Kotlin Multiplatform app (Android + Desktop) with an engine
                                parity test against the TS engine. Owned by a separate workstream.
desktop/                        Doppel as a desktop app: an Electron shell that runs the production server inside the
                                app and opens one window on it. Changes nothing under src/. See docs/DESKTOP.md.
```

Further reading:

- [README.md](README.md): run it, evidence.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): cascade and engine in depth.
- [docs/DECISIONS.md](docs/DECISIONS.md): design decisions and prepared jury answers.
- [docs/ACCOUNTS.md](docs/ACCOUNTS.md): accounts store API.
- [docs/I18N.md](docs/I18N.md): translation rules.
- [docs/BENCHMARK.md](docs/BENCHMARK.md) and [docs/VISION_BENCHMARK.md](docs/VISION_BENCHMARK.md): measured results.
- [docs/PLAY.md](docs/PLAY.md): the life game.
- [docs/REAL_WORLD_FACTORS.md](docs/REAL_WORLD_FACTORS.md): sourced Swiss factors to add next.
- [docs/WORKPLAN.md](docs/WORKPLAN.md): what is in flight and the merge order.
- `docs/tasks/`: self-contained task briefs.

## 4. Internationalisation (EN / DE / FR / TR)

- Every user-visible string lives in `src/lib/i18n/{en,de,fr,tr}.ts`. `en.ts` is the source of truth; the others must match its keys exactly. Libraries return `Msg` descriptors (`msg("key", { params })`), never English sentences, and keep numbers raw in params.
- **German:** Swiss Standard German, "du", **always "ss", never "ß"**.
- **French:** Swiss French, "vous", narrow no-break space U+202F before `% : ; ! ?`.
- **Turkish:** "sen". **Never attach a case suffix to a placeholder** (`{year}'da` is wrong; write `{year} yılında`). Swiss institutions get a gloss on first use, e.g. "AHV (devlet emekliliği)".
- Put new keys in **your own top-level group**, so parallel work merges cleanly.
- Dictionary keys must be strings: numeric keys like `1:` break the typed key union. Use `s1`.
- `npx tsx scripts/i18n-check.ts` (strict) must exit 0. It fails on values identical to English longer than 12 characters; there is a small allow-list for brand or unit strings.
- **Hydration:** the server renders English and the first client render matches it; locale, account and clock-dependent text switch after mount. Don't render locale-dependent text during SSR.

## 5. Run, check, verify

```bash
npm ci                         # postinstall copies the tesseract assets
cp .env.example .env.local     # optional: OPENROUTER_API_KEY. Never commit .env.local
npm run dev                    # http://localhost:3000
```

| Gate | Command |
|---|---|
| Types | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| i18n (strict) | `npx tsx scripts/i18n-check.ts` |
| Engine numbers | `npx tsx scripts/engine-check.ts`. Barlas / Meriç / Oktay numbers must stay unchanged unless you change the engine on purpose. |
| Imports round trip | `npx tsx scripts/import-check.ts` |
| Engine regressions | `npm run engine:regression`. One check per fixed engine or parser bug. |
| Model gateway | `npm run api:check`. Guards, caps, provider layer and snap heuristics against a stubbed model. |
| Life game | `npm run play:check`. Includes parity between the game simulator and the dashboard engine. |
| Vision (offline) | `npx tsx scripts/vision-benchmark.ts` |
| Vision (live) | `npx tsx --env-file=.env.local scripts/vision-benchmark.ts --live`. Uses the key; costs well under a cent. |
| Browser smoke | `DOPPEL_SMOKE_PORT=<your port> npm run smoke:browser`. **Run `npm run build` first**; a stale `.next` build fails unrelated steps. |

Pitfalls the team already hit:

- **Top-level `await`** in `scripts/*.ts`: tsx compiles these as CommonJS, so wrap the body in `main().catch(...)`.
- **Stale builds:** the smoke test runs `next start` on the existing `.next`. Rebuild after every change.
- **Output-token caps:** model output can be cut off. Check `finish_reason`; a 320-token cap once truncated every floor-plan JSON.
- **Live mode must not fall back to fixtures.** Record the miss.
- **No key, no report commit.** Offline runs of `scripts/benchmark.ts` and `scripts/vision-benchmark.ts` overwrite `docs/BENCHMARK.md` and `docs/VISION_BENCHMARK.md`, which hold live measurements. Don't commit those files from an offline run.

## 6. How we work in parallel

- **Branches:** branch from `main` (`git checkout -b <you>/<topic>`), keep commits small and logical, and open a PR. Don't push to `main` directly. The coordinator merges in the order given in [docs/WORKPLAN.md](docs/WORKPLAN.md).
- **Ownership:** don't edit files owned by in-flight work until it is merged. The list is in WORKPLAN §3 "Rules". If you need a change there, describe it in your PR instead.
- **Dev servers:** use **your own port** (e.g. 3350+). Stop only the process you started, by PID. **Never run `taskkill /IM node.exe` or kill all node processes**; that once killed the owner's dev server and other agents' servers.
- **Secrets:** never commit `.env.local` or keys. Don't paste keys into issues or PRs.
- **Commits:** end every message with a co-author line naming the agent that wrote it, e.g. `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Screenshots:** check UI changes with Playwright at 320×800 and 1280×900, in EN and TR at least, and look at the screenshots.
- **Reports:** a finished task ends with branch, SHAs, what changed, gate results, and anything not verified.

## 7. Hand control (`tkt/`)

`tkt/` turns a desk-facing or front camera into a pointing device (Python/MediaPipe). Its rules are in `tkt/AGENTS.md`: no new dependencies or config keys without approval, and `src/tkt/core/` is off limits. Next steps are gestures as `/play` shortcuts, an event bridge, and desk-document capture into the snap cascade. See `docs/TKT.md` and `docs/tasks/E-tkt-bridge.md`.
