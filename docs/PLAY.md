# Doppel Play: the life game

Status: phase 1 implemented (`/play`, `src/lib/game`, `npm run play:check`); phases 2 and 3 open. Owner decisions: 2026-11-22. Implementation notes: §13. Where §13–§19 and §20–§21 disagree, §20 (the audit of 2026-11-22) and §21 (the engine merge) are current.

Doppel gets a second face. The existing dashboard stays as it is. A separate page, `/play`, turns the same twin into a game. The game is chess-themed in the way a chess engine is: positions are financial states, moves are decisions, and the engine **searches the space of possible futures** to judge each move. Situations are not mapped onto pieces. What gets labelled is the **move** (`!!`, `!`, `?!`, `?`, `??`, sacrifice, drain), as in chess game review.

Both pages share the same engine, accounts and assumptions. A decision taken in the game can be applied to the real twin with one click.

## 1. Roles

| Role | Who | What it does |
|---|---|---|
| Black | The player | Makes one decision per turn, or holds. |
| White | Life | Plays an event each turn: shocks, inflation, family, career. Its strength comes from the economic regime. |
| Engine | The analyst | Never plays. After each player move it shows the best move in that position, the evaluation, and how the decisions differ in impact. |

White does not always play perfectly, and it is not "the best decisions". The best decision comes from the engine review. This split keeps the game winnable and the comparison honest.

## 2. Turn loop (one turn = one year)

1. **Life moves.** An event card is drawn. The regime sets how often events happen and how hard they hit (§6).
2. **The player moves.** They pick one of 3–4 decision cards that fit the current state, or hold.
3. **The engine reviews.**
   - It scores every candidate, including the player's choice and holding, on the same N simulated futures (common random numbers, so the comparison is fair).
   - It labels the player's move (§4), names the best move, and shows the impact donut (§5).
4. **The year plays out.** One seeded future path is realised and the state advances.
   - The gap between the realised year and the expected year is shown as **luck**, kept separate from decision quality: "good decision, bad luck".
5. **Check test.** If the king is in check (§7), the next turn offers only responses to it.

Game length: from the start age up to the goal age, or 10–15 turns in demo mode.

## 3. Evaluation (the evaluation bar)

One number per position, computed by the deterministic engine. The formula is shown on screen.

```
E = w_goal · P(goal reached)
  + w_safe · (1 − P(cash crunch))
  + w_wealth · normalised median net worth at goal age
  − w_down · normalised p10 shortfall
```

- The weights come in presets (Balanced, Safety first, Growth) and can be edited. Net worth alone is never the objective; that rule comes from the challenge.
- Every input is labelled as synthetic data, a user assumption, or a model output.
- The bar shows E for the player's line next to the engine's line.

## 4. Move quality: judged on potential, not on next year

A move is judged by its effect at the **analysis horizon** (default: goal age), not by its effect after one year. That makes buying a home a sacrifice rather than a blunder.

- **Loss** = E(best candidate) − E(player's move), in evaluation points (the analogue of chess centipawns).
- **Labels:**
  - `!!` Brilliant: best move, and it is a sacrifice.
  - `!` Best.
  - Good: loss below a small threshold.
  - `?!` Inaccuracy, `?` Mistake, `??` Blunder: loss above rising thresholds.
- **Sacrifice tag:** E falls at a 1-year horizon but rises at the analysis horizon (home purchase, education, a 3a lump sum).
- **Drain tag:** the cost recurs and the move never pays back within the horizon (car, lifestyle creep).
- **Accuracy %** at game end is the mean of a per-move score derived from the loss, as in chess review.
- **Engine depth is a setting:** 1 year (short-sighted), 5 years, or goal age. Showing how the verdict on a home purchase flips with depth is the core lesson.

## 5. Impact donut (one per move)

Each move gets a donut showing **where its effect lands**. Each slice is the move's change versus holding, split by channel:

- monthly cash flow
- liquidity buffer
- invested wealth
- property equity
- pension (AHV/BVG/3a)
- debt
- goal progress

Positive and negative parts are shown as two rings, or with signed colours. The engine's best move gets its own donut for side-by-side comparison. All values come from the engine; the LLM never computes them.

## 6. Difficulty: three separate controls

| Control | Chess analogue | Source |
|---|---|---|
| Opening position | Material advantage | Starting wealth, income and debt of the chosen profile |
| Life's strength | Opponent strength | Economic regime: Calm Switzerland, Normal, Stress (higher frequency and severity of shocks, return and inflation paths) |
| Analysis depth | Engine depth | 1 year / 5 years / goal age |

A wealthy profile starts with a good opening. A harsh regime makes it easy to get mated. A mild regime with good play lets the player win.

## 7. The search: modelling the possibilities instead of mapping pieces

Life is a game tree with two kinds of nodes:

- **Decision nodes (Black):** the 3–4 eligible decision cards, plus "hold".
- **Chance nodes (Life):** the regime's event distribution, returns, inflation, job loss, family events.

The tree explodes. About 5 moves × ~20 life outcomes per year over 15 years gives roughly 100^15 = 10^30 paths, so it can't be enumerated. That is the same problem a chess engine has, and the answer is the same: **search by sampling**.

- **Engine = Monte Carlo Tree Search (expectimax flavour).**
  - Selection at decision nodes balances exploring and exploiting (UCT).
  - Chance nodes are sampled from the regime.
  - Leaves are evaluated with the existing deterministic simulator (`simulate`, a rollout to the goal age) and the E function (§3).
  - Common random numbers keep sibling moves comparable.
- **Principal variation:** the engine's best line ("buy now → keep investing → hold through the crash") is shown like a chess engine line. The player's own line is shown next to it.
- **Alternative lines:** at any past move the player can open "what if I had played X here?" and the engine replays from that position. This is the explorable part the challenge asks for.
- **Budgets:** search depth and rollouts per move have fixed limits so a move is reviewed in about a second in the browser (a Web Worker). Results are seeded and reproducible.
- **Monte Carlo is a component, not the product.** It evaluates leaves. The twin's intelligence is the search over decisions, the review and the explanation.

Hard rules come out of the search naturally:

- **Check** = in the searched futures, P(cash crunch in the next 12 months) is above a threshold, or the buffer is under 3 months of expenses. The next turn must respond.
- **Mate** = a hard constraint breaks on the realised path (rent or debt payment impossible, cash below the credit line). Game over, then review.
- **Winning** = goal reached with a safety buffer.

The board on screen shows the **position and the lines**: the evaluation bar, the move list with annotations, the principal variation and branch points. It does not show pieces standing for situations.

## 8. Side boards: decisions that play out over time

Active investing, regular saving and debt payoff are not one-off moves, so they get a **persistent side board** instead of a separate game. That keeps continuity.

- When opened, the side board becomes a **standing structure** with a rule. Examples: invest CHF 500 a month in an equity-heavy portfolio and rebalance yearly; save 10% of pay; overpay the loan by CHF 300.
- It runs **every turn** in the background by its rule, and its state carries over year to year. A mini-board shows it.
- **Trigger moments** open a short side-board puzzle: a market drawdown of 10% or more, a bonus, a rate change, a job loss. Choices are hold, buy the dip, sell, or rebalance. The engine reviews the choice exactly as in §4.
- Each turn the side board's result enters the main board as **one composite move**: its effect on the evaluation and its slice of the donut. There is no separate win or loss; the side board feeds the main game.
- The behavioural twin (`investBehavior.ts`) links in here: a player who panic-sells on the side board sees that habit in the main review.

## 9. Data

What the UBS synthetic data actually contains (checked 2026-11-22):

| File | Content | Use in the game |
|---|---|---|
| `synthetic-profiles.csv` | 1'200 fictional people: age, city, canton, employment (682 employed, 216 retired, 120 part-time, 106 self-employed, 39 students, 37 unemployed), household, opening cash, monthly net income and rent | Starting positions |
| `synthetic-assets.csv`, `synthetic-accounts.csv` | Opening snapshot: cash, investment portfolio, etc. | Opening material |
| `synthetic-liabilities.csv` | 283 personal loans (principal, rate), snapshot only, not amortised | Debt in the starting position |
| `synthetic-goals.csv` | 1'500 goals (resilience, emergency savings, housing deposit, education, career change, retirement), amount and date | What "winning" means for that profile |
| `synthetic-cash-balances.csv` | 24 months of monthly cash ledger per profile (28'800 rows) | Observed behaviour before the game starts; calibrates spending volatility |
| `scenario-catalog.csv` | 120 scenarios in 12 categories, each as **text**: baseline vs intervention ("Start work now" vs "Enroll for two years") plus the metrics to look at | The deck of decision and life cards |
| `scenario-assumptions.csv` | Numbers for **one** scenario only (S001 master: 2 years, CHF 8'000 a year), for 120 profiles | Card parameters for S001 |

The data gives **starting states and decision names**, not the effects of decisions. No outcomes, no market prices, no transition rules. So the effect of each card has to be **modelled**: Doppel's Swiss engine supplies the transitions (salary, tax, AHV/BVG, rent, mortgage, tuition, unemployment insurance, returns), each parameter labelled as an assumption with its source. That is exactly what the judges score as "financial modelling and correctness", and it is why the game searches possibilities instead of reading answers from a table.

Rules:

- **Asset classes only, no hindsight.** "Seagate rose more" is not a valid best move. Best moves use the information available at the time, across simulated futures.
- **One card = one parameterised transition.** Each card has a name from the catalog, parameters from `scenario-assumptions` or from labelled engine defaults, and a deterministic effect on the state.

## 10. Transparency and responsibility

- **Assumptions on the card:** every card shows its assumptions. Every evaluation shows its formula and weights.
- **Reproducible games:** each game is seeded and can be replayed. The game record exports as JSON ("Doppel Game Notation": profile, regime, seed, moves, life events).
- **Ground truth from the engine:** every "best move" depends on the stated assumptions. It is not personal financial advice. The LLM may only narrate engine output, as a commentator.
- **Luck is shown separately from decision quality:** this game is closer to poker than to chess, and the game says so.

## 11. Architecture

- New, pure, deterministic modules in `src/lib/game/`:
  - `state`: game state on top of `Profile` + `Scenario`.
  - `cards`: catalog mapping and eligibility.
  - `regime`
  - `evaluate`: the E function and its labels.
  - `engine`: MCTS over decision and chance nodes with common random numbers; leaves are evaluated with `simulate`. It runs in a Web Worker under fixed budgets.
  - `sideboards`
  - `notation`
- UI in `src/app/play/` and `src/components/play/*`, in the existing visual style and i18n system (EN/DE/FR/TR).
- **Controls:** large targets and keyboard shortcuts (←/→ year, 1–4 pick a card, H hold, C compare lines; Tab is left to the browser, see §20). This prepares the TKT hand-control bridge (`docs/INTEGRATION.md`).
- **Tests:**
  - same seed → same game
  - E never computed by the LLM
  - mate fires when a constraint breaks
  - the best move's loss is 0
  - the sacrifice tag fires for a home purchase at goal depth but not at 1-year depth
  - with a large budget, MCTS agrees with brute-force enumeration on a small tree

## 12. Delivery phases

1. **Core game:** turn loop, cards from the catalog, Life events by regime, engine review (labels, best move, evaluation bar), impact donut, check and mate, end-of-game review with accuracy, seeded replay.
2. **Side boards:** investing, saving, debt, with trigger puzzles.
3. **Polish:** TKT gestures; commentator narration on an open-source model (Qwen, Llama, Mistral); the "apply to my twin" bridge to the dashboard.

## 13. Phase 1 as built

- **Code:** `src/lib/game/` (`state`, `cards`, `regime`, `evaluate`, `engine`, `game`, `notation`, `start`), UI in `src/app/play/` and `src/components/play/`, engine in a Web Worker. UBS data only through `src/lib/ubs` (a stub with the agreed API until the shared loader lands).
- **Simulator:** `simulate()` gained optional inputs (regime assumptions, income phases, a starting home, loans, regime shocks on a separate random stream). Without them it behaves exactly as before (`scripts/engine-check.ts` output unchanged).
- **Turn:** Life's card (seeded by game seed and turn) → check test (buffer < 3 months, or P(cash crunch in 12 months) > 20% on 200 paths) → one card from a dealt hand of four (responses only in check) or hold → one market bucket (quintile of the regime's returns) → `stepYear`, twelve monthly steps that mirror `simulate()` and write a ledger. Mate = cash below the CHF 2'000 credit line after selling investments. Win = goal at the goal age with a 3-month buffer.
- **E:** as in §3, with W = clamp(0.5 + 0.25·log2(median/target), 0, 1.5) and S = clamp((target − p10)/target, 0, 1); presets Balanced 0.4/0.3/0.2/0.1, Safety first 0.25/0.45/0.1/0.2, Growth 0.35/0.15/0.4/0.1. A mated line scores −w_down.
- **Search:** open-loop MCTS. Pre-drawn futures (market bucket + Life's card per year, common random numbers), every root candidate on every future, UCT (c = 0.04) below the root, at most 2 realised turns in the tree, then a simulator rollout to the horizon. Afterwards each candidate is re-scored with its own principal variation on all futures. Budget and sampling: §20.
- **Labels (loss in points):** best ≤ 0.05 (brilliant if also a sacrifice), good < 0.5, inaccuracy < 2, mistake < 6, blunder ≥ 6, applied to the loss the futures support (§20). Life decisions (child, partner, sabbatical, any declared preference) are scored and shown but never best or brilliant, never named as the best move and never part of the accuracy. Accuracy uses the Lichess formula on the loss.
- **Checks:** `npm run play:check` (determinism and replay, best-move loss 0, sacrifice at goal depth only, mate, MCTS = brute force on a tiny tree, no model or network code, ledger identity for every card and year, stepper vs simulator within 3%, budget).

## 14. The chessboard (phase 1b)

The game is also shown as a legal chess game: `src/lib/game/board.ts` (rendering rules, chess.js for legal moves and attack maps) and `src/components/play/ChessBoard.tsx`. The financial engine stays the only source of numbers and labels; the board only shows them.

- **Pieces = domains.** King: liquidity. Queen: human capital (education, career path). Knights: income moves. Bishops: investments (light square: equities, dark square: bonds, 3a, pension). Rooks: housing (castling = buying a home). Pawns: habits and life choices. Black is Life: pawns inflation and rent, knights sudden costs and job loss, bishops markets and rates, rooks housing costs, queen recessions.
- **Choosing a move.** Tap a ringed piece, then one of its decisions. A decision sits on every piece of its domain, even a blocked one; another piece then plays it (preferring the move that frees the domain piece) and the panel says so. Holding sits on the king.
- **Quality on the board.** Best/good moves are safe and active; an inaccuracy is passive; a mistake or blunder leaves material en prise, and Life's next hit takes it. Positive Life events (windfall, promotion) leave a piece for the player to take. Every capture is explained (lost / taken, with the domain).
- **Check and mate follow the money.** Life never gives check outside a financial check, and gives one whenever the board has a checking move. Early in a game the king is often shielded, so after the opening only about half of the financial checks can be shown as chess checks (`npm run play:board` measures it: ≥ 45%, and 0 misses while a check was available). Then the king carries an amber ring and the panel says that no Life piece can give check yet; the red check glow is reserved for a real chess check. The board never ends the game on its own; when the financial game ends, Life mates (or the player resigns) on a financial mate, and Life resigns (or is mated) on a win.
- **Review.** Selecting a past move shows the position after it, its label badge, and a green arrow for the move the engine's best decision would have been.
- **Checks:** `npm run play:board` (legal plies, no early game over, no false check, check rate, blunders hang material, determinism, render time).

## 15. Canton costs (shared with the dashboard)

`src/lib/finance/canton.ts` holds the sourced canton tables: EDI average KVG premiums 2026 (all 26 cantons, per adult, young adult and child) and the income-tax burden of the ten UBS cantons plus Zug (ESTV-based, 2026). The game uses the same rules as the dashboard: the marginal tax rate of an income change is scaled by the canton (`marginalTaxFor(net, canton)`), and the household's premium grows 2.5 pp a year faster than prices (once a year in `stepYear` and the game simulator). The position panel shows the canton line.

## 16. The long game: independence, retirement and the rating (phase 1c)

- **Length.** Working-age players play to 80: one-year turns for the first ten years, then five-year turns (`turnYears`). Inside a long turn Life draws its card every year; the earlier cards are listed under Life's move. Retirees play 15 years (at most to 95).
- **Goal and evaluation.** The game's goal is financial independence, not the profile's short-term goal: net worth at 65 = the liquid capital that covers spending minus net pensions until 95 (30 years at 1% real, from one full simulation at the start) plus the pension fund the player will hold anyway (`withFiGoal`, start.ts). E measures progress on the glide path to it; depth "goal" looks at most 12 years ahead (`MAX_HORIZON_YEARS`) so a review stays within its budget.
- **Mate.** Life is mated (the player wins) when, stopping work now, savings, pension fund and AHV pay the spending until 95 in at least 90% of 200 simulated futures (`isIndependent`, independence.ts). The player is mated as before (credit line broken). Retirees cannot "win early": their game is to last.
- **Retirement.** At the retirement age the stepper converts the pension fund to an annuity at the BVG conversion rate, fixes AHV from the last salary (paid from 65, indexed), pays out 3a after the withdrawal tax and lowers non-housing spending to the retirement share; UBS retirees start with their pensions in payment (`retireNow`, state.ts). The game's simulator receives the same pensions.
- **Rating.** `rateGame` (rating.ts) replays the game holding every turn on the same dice and compares outcomes: Elo = 1200 + 0.6 × (player − hold) + 0.4 × (hold − 1200). Outcome scores: mate 400–1000 (by how long you lasted), time up 1000–1400 (by the end's independence chance), independence 1500 ± 25 per year before/after 65, plus up to 400 for the legacy target (per child a CHF 1M home, a CHF 60k car and CHF 120k education; without children a CHF 1M home and a CHF 150k care reserve). Tiers: mated, survived, independent, independent early, independent with a legacy, grandmaster (≥ 2400).
- **Checks.** `npm run play:check` section 9: turn schedule, retirement conversion with a balanced ledger, independence wins, rating determinism and formula.

## 17. Feedback round (arrears, clearer review, consistent directions)

- **Check before mate.** A shortfall beyond the CHF 2'000 credit line with nothing left to sell becomes arrears: a 10% loan over 36 months, up to CHF 25'000 in total (`ARREARS_CAP`). Only beyond that is it mate. A full-time master's without a loan used to end Alexia's game in year 1; now it is a blunder (8% mate in the engine's futures) that leaves her in check with arrears.
- **Review text.** The review says what the score compares (each option with the engine's best follow-up moves), shows where the points difference comes from (goal odds, never short of cash, median wealth, worst 10% of futures, weighted as in E), and explains why the rings (the move on its own, nothing changed afterwards) can disagree with the score.
- **Directions on the board.** Building decisions (income, investing, study, a home) move forward; protecting decisions (buffer, cuts, flatmates, pausing) move back towards the king; spending pushes forward without developing (`motionForCard`).

## 18. Threats, retirement decisions and declared preferences

- **Threat vs check.** "Check" is used only when Life's move gives check on the board. A financial danger the board cannot show yet is a "threat" (amber ring, banner "Threat"); the forced response is the same.
- **Verdict under the board.** The last move, its label, its loss and the engine's best sit under the board; on phones a link jumps to the full review.
- **Retirement decisions.** Retire at 60 (S091), work until 67 (S092), pension fund as a lump sum (S099, decided up to 3 years before), part-time work in retirement (CHF 1'500/month for 36 months), move to a smaller flat (rent −30%, CHF 5'000 move), sell the home and rent (3% sale costs, rent = 3.5% of the value per year); Life's care-costs card from 80 (S100, CHF 1'500/month). Retiree goal: the spending gap until 95, and at least 80% of today's wealth kept in real terms.
- **Declared preferences** (`LIFE_PREFS`): children, partner, home, car, sabbatical, early retirement. Declared (user), the card is a life choice: shown with its cost, not graded, dealt whenever possible. A family household suggests "children" (derived). Undeclared life decisions are graded against the best other move, and the engine never names a life decision as the best move.
- **Profile search.** The setup panel filters the 1'200 profiles by name, city, canton, age or ID.

## 19. Business and promotion (UBS catalog S111–S120)

- **Cards.** Start a business (S111: CHF 40'000, half savings, half a 6% business loan over 5 years), put more into it, pay out or reinvest the profits (S118), hire an employee (S116), sell it (S120). When a venture has survived four years it can be promoted, as far as own funds allow (30%, the rest a 10-year loan at 5%): a shop for CHF 150'000 (rook) or a factory for CHF 400'000 (queen). Buying a home stays a normal move (castling).
- **Business year** (`businessYear`, state.ts). Survive or fail with a hazard per year; profit = capital × profit rate × a market factor (worst to best quintile: 0.2, 0.7, 1, 1.25, 1.55). Reinvested profits grow the capital and lower the hazard; paid-out profits go to cash after tax and raise it. On failure the capital is lost and its loans remain (often check, sometimes mate). Hazard: venture 12% (×1.3 in the first year), shop 5%, factory 6%, scaled by the market (1.6 in the worst year to 0.7 in the best). Calibration: BFS business demography, about half of new firms active after five years (cohorts 47.8–50.1%), 84% after one year; `play:check` measures 45% on 600 simulated ventures. All other numbers are Doppel defaults.
- **Rollouts.** The game's simulator has no business: its capital rides with the portfolio (equity-like risk and return). The tree's realised years use the business model itself.
- **Board.** Business moves push the business pawn (tracked from move to move; captures that open its way are preferred) and Life keeps its path clear. A shop or factory is bought financially at once; its pawn promotes (rook = shop, queen = factory) only when it really reaches the last rank, by a legal move. Until then the panel says that Life's pieces block the way. Every ply on the board is a legal chess move.

## 20. Audit of 2026-11-22: what changed and why

An audit of `/play` found ten defects and five suspicions; all were fixed, each with a check in `npm run play:check` (27 → 46 checks; most new ones are in `auditChecks`, run alone with `PLAY_CHECK=audit`).

- **One simulator, checked.** `src/lib/game/sim.ts` is the dashboard's `simulate()` plus the game's optional inputs: a regime, the game's phases (`incomePhases`), a home and loans that exist at the start, random shocks, and three bookkeeping conventions. With none of them it returns exactly what `src/lib/finance/monteCarlo.ts` returns; the check compares 20 runs (built-in accounts, Alexia, loans, no pension fund, retired, behaviour, optimiser, home purchase, phases, accounting mode). **If the dashboard engine changes, mirror the change in `sim.ts` or this check fails.** The assumptions are the dashboard's own object.
- **What the game does differently, on purpose** (the year stepper `stepYear` does the same, and the stepper-vs-simulator checks pin it):
  - the game's phases (study, leave, part-time, abroad) are indexed with wages and prices, never fall below the rent, and end for good; the dashboard's phases are nominal and the last one continues;
  - health premiums step up once a year, at the turn of the game year (`premiumYearly`);
  - a pension fund that became an annuity is income, not capital: it leaves net worth (`annuityNotCapital`). The dashboard keeps counting its remaining capital; in the game that made every retiree's goal odds 100% and every move look alike;
  - savings that run out in retirement are a cash crunch (`crunchWhenRetired`).
- **Retirees.** A profile that is already retired is not cut to 80% of its spending a second time. Stepper and simulator now agree for retirees within 1% of net worth. A player who started working and then retires is measured against the liquid capital still needed until 95 (`targetAt`), not against the old target that included the pension fund.
- **Openings.** A profile's own loans are used with their rate and payment (UBS data and accounts alike; before, UBS loans became 5% over 60 months and an account's loans were dropped). `bvgInsured: false` means no pillar 2 credits. Hand-made accounts with every optional `Profile` field missing play to the end. A working-age opening that is already financially independent is won before the first move, and the banner says so.
- **Sampling.** 160 futures × 16 rollout paths (before: 40 × 96), about the same cost. Each future has its own rollout seed (before, all leaves shared one set of 96 market paths, so the futures were not independent samples), and the futures are a Latin hypercube: every market quintile and Life card appears in its exact share. Measured on the same position with 8 different sets of futures, a move's loss now varies by about 0.2 points (before: 1.6).
- **Labels.** Every loss comes with its standard error (the futures are paired across candidates). A harsher label needs the loss to clear its threshold by two standard errors; the review shows the loss as "1.5 points (± 0.1 from the sampled futures)". Rare ruinous futures (a student loan followed by a job loss) keep a large error, and the label is then lenient rather than random.
- **Turns in the tree.** A ply of the search is a turn of the game: after year ten a turn is five years, with Life's card every year and no move for the player in between. Before, the engine re-decided every year inside a five-year turn.
- **Luck.** Luck of a turn = the position Life really left minus the positions it leaves on average after the same move, both valued the same way at the review's horizon (`turnLuck`). It averages zero by construction. The old measure (evaluation after minus evaluation before) was positive in almost every turn: resolved uncertainty raises E on its own.
- **Game record (DGN version 2).** The record holds the opening position, the declared preferences, every market year, Life's cards inside five-year turns, each move's review, and the depth and weights the reviews were made with. `replay(record)` needs nothing else and checks the result.
- **Keyboard.** Tab is no longer taken (it trapped keyboard users on the page): compare lines is **C**. A held key plays once. 1–4, H and C do nothing while a button, link or field has the focus. The rules are in `src/components/play/keys.ts`. `docs/TKT.md` still maps a swipe to Tab; it has to send C.
- **Engine worker.** A new game terminates the worker and starts a fresh one, so a review of the old game no longer delays the new one (six quick restarts: first review after 1.5 s, before 6 s). A cancelled request is not recorded as a failure.
- **Not changed:** the phase rules above stay different from the dashboard's by design. The rollouts still treat a business as part of the portfolio (§19).

## 21. After the engine merge: one simulator, one cost model, two vocabularies for the economy

The dashboard engine gained a sourced parameter table (`params.ts`), economic scenarios (`economy.ts`), life decisions (`life.ts`) and the outlook (`outlook.ts`); see `docs/ENGINE_API.md`. The game follows it as below. `npm run play:check` has a check for every statement (49 checks).

### 21.1 The simulator

`src/lib/game/sim.ts` is again the engine's `simulate()` plus the blocks marked "Doppel Play". Without a game extension the two return identical results; the parity check now runs 29 cases, including life decisions, the four economic scenarios, a custom economy and the budget detail.

- **Imported, not copied:** the assumptions object, the parameter tables, `economyYears` / `resolveEconomy`, `compileLife`, the pension, debt, canton and mortgage rules.
- **Mirrored (the monthly loop itself):** it cannot be imported, because the game's extensions sit inside it. The check is what keeps the copy honest.
- **The same rules in the stepper (`stepYear`):** the pillar 3a ceiling in the CHF of its date, the large ceiling without a pension fund (20% of earned income), income never below zero. The game's scheduled one-offs are marked `nominal`, as the engine now expects.
- **Game extensions, all named options:** `assumptions` (the regime), `incomePhases`, `home`, `debts`, `shocks`, and `conventions` (`premiumYearly`, `annuityNotCapital`, `crunchWhenRetired`, and new: `priceLevel`). A game position is in the CHF of its own year, while the pillar 3a ceilings and the AHV scale are in the CHF of the game's start; `priceLevel` scales them, as the stepper always did for AHV.
- **Job losses of a regime** now run through the engine's own job-loss mechanism (benefit = 70% of the insured salary with the insured maximum, no pension-fund credits), with the regime's yearly risk and spell length. Crashes of a regime keep their own random stream. A crash month no longer shifts the other random draws (the engine's fix).

### 21.2 Regimes and economic scenarios

They are two vocabularies and stay two.

| | Game: regime | Dashboard: economic scenario |
|---|---|---|
| What it is | How strong Life is, for the whole game: calm, normal, stress | A dated phase of the economy, then back to the baseline: high inflation, recession, low rates, climate transition |
| What it sets | Market means and volatilities, inflation, wage growth, how often and how hard Life's cards hit, random job losses and crashes | Inflation, wages, interest and mortgage rates, a job-loss risk, an equity shock, per phase |
| Source | Normal = the engine's `BASELINE` table. Calm and stress are Doppel defaults (game design, no source) | `REGIMES` in `params.ts` (estimates anchored on Swiss episodes) |

- **Normal is the baseline.** `REGIME.normal` reads its market constants from `BASELINE` (`regime.ts`); the check compares the numbers and a whole simulation run with the dashboard's baseline economy.
- **In the simulator** a regime is the *base* regime of every year of the engine's economy. A scenario could be laid on top of it (`economy` is passed through unchanged), but the game does not do that yet: Life's cards (inflation, recession, rate shock) play that role in the game.
- **Do not compare** a stress game with a recession scenario: stress lasts the whole game and has no source; a recession is two years and sourced.

### 21.3 Life decisions: the same cost model

A card that corresponds to an engine decision uses the engine's model (`src/lib/game/lifeCosts.ts` calls `compileLife`), so it costs in the game what it costs on the dashboard for the same person.

| Card | Engine decision | In the game |
|---|---|---|
| Have a child | `child` | **Same model.** Direct costs by age, daycare (3 days) from six months to four and a half, family allowances of the canton, tax relief, then apprenticeship or university. Checked against `outlook()`: Barlas CHF 710/month in the first year and CHF 726/month over ten years, in both. A second child costs less, as in the engine. |
| Buy a car / sell the car | `car` (owned) | **Same model.** The TCS reference car (CHF 45'000), CHF 586/month to run, a replacement every ten years net of the trade-in, until 80. Checked: CHF 4'336/month in the first year (the purchase included) and CHF 961/month over ten years, in both. |
| Part time / full time | `workload` | **Same rule:** salary and take-home pay scale with the percentage. |
| Sabbatical | `workload` 0% | Same rule for the pay; the CHF 7'000 of travel is the UBS catalog's (S044). |
| Master's (student paths) | `education` | UBS figures (S001, Alexia's paths) where the data has them; otherwise the engine's sourced tuition (CHF 1'460/year) and length (24 months). |
| Buy a home | `house` event | Same bank test (`tragbarkeit`, pillar 2 above the 20% minimum) and closing costs; the game buys at once at 95% of the highest affordable price. |
| Move in with a partner | `partner` | **Different on purpose.** The engine has no sourced default for a partner's income, costs or rent and asks the user. A card cannot ask, so it keeps its Doppel defaults (rent −45%, other costs −15%) and no partner income. |
| Flatmates, smaller flat, nicer flat | `move` | **Different on purpose.** Same reason: the new rent is a user input in the engine. No change of canton in the game. |
| Start a business | `selfEmployed` | **Different model.** The card is the UBS catalog's venture with capital, a failure hazard and promotion (§19), not a change of the person's salary. |

Deliberate differences inside the two shared models:

- **A schedule per year, fixed when the card is played.** The engine's monthly lines become one net amount per year (their mean), in CHF of the game's start, indexed with prices each year. The yearly sums are the engine's; within a year the timing is flattened (daycare starts in month six on the dashboard, the game spreads that year's cost over twelve months). Salary or canton changes after the card do not re-price the daycare tariff or the allowances.
- **Expected value instead of a draw.** From 16 the engine draws per future whether the child goes to university (43%); the game charges the expected cost, so a position stays one state.
- **No pay cut during parental leave.** The old card had one (three months at 80%); the engine has none, so the card has none.
- **The car loan is the game's.** If cash is short the card takes a 48-month loan at 6.9%; the dashboard has no car loan and shows a cash crunch instead. The comparison in the check pays cash.
- **Selling the car** ends its costs and the planned replacements; the engine has no such decision.
