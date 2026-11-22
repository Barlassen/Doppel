# Doppel Play: the life game

Status: design, not implemented. Owner decisions: 2026-11-22.

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
- **Controls:** large targets and keyboard shortcuts (←/→ year, 1–4 pick a card, H hold, Tab compare lines). This prepares the TKT hand-control bridge (`docs/INTEGRATION.md`).
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
