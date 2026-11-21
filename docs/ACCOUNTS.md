# Accounts

Doppel ships three fictional built-in accounts and keeps everything a user adds on top of them in the browser.
Switching the account in the header replaces every screen: profile, what-if scenario, Plan A, snaps, frugality
ledger and solver results.

## The built-in accounts

| | Barlas | Meriç | Oktay |
|---|---|---|---|
| Age, city | 24, Zürich (ZH) | 27, Lausanne (VD) | 26, Basel (BS) |
| Job | Junior developer | Marketing specialist | Logistics coordinator |
| Gross / take-home | CHF 66,000 / 4,310 a month | CHF 92,000 / 5,700 a month | CHF 72,000 / 4,570 a month |
| Cash · portfolio · pillar 2 · 3a | 2,645 · 4,265 · 0 · 3,090 | 14,800 · 2,900 · 2,300 · 0 | 3,900 · 0 · 6,100 · 0 |
| Net worth | CHF 10,000 | CHF 20,000 | CHF 10,000 |
| Goal | CHF 450k by 40 | CHF 400k by 40, flat in Renens (CHF 540k) in 5 years | CHF 200k by 40, trip to Tokyo |
| Story | Standing order into a world ETF, bought extra in the dip, maxes 3a, spends little | Lump sums now and then, sold 37% in the Aug 2026 drawdown, bought a hyped stock at its top, idle cash, overlapping streaming, food delivery, payday shopping | Doesn't invest, delivery and dining, impulse shopping, 7 subscriptions, strong payday spike, thin cash buffer |

Source: `src/lib/data/profiles.ts`. Run `npx tsx scripts/engine-check.ts` for the current engine results of each.

Each account has five months (Jun–Oct 2026) of seeded transactions (`src/lib/data/history.ts`, merchants in
`src/lib/data/merchants.ts`) and its broker and pillar 3a trades. Only the identity, income, tax rate, balances,
goal and events are set by hand. Everything else comes from the data:

| Profile field | Derived from | Code |
|---|---|---|
| `expensesMonth`, `rentMonth` | average monthly spending / housing over the transactions | `monthlySpend()` |
| `netIncomeMonth` | gross income and marginal tax rate, same rule as a payslip snap | `takeHomeMonth()` |
| `investShare` | net broker purchases ÷ (surplus − pillar 3a) | `deriveInvestBehavior()` |
| `contributes3a` | pillar 3a purchases in at least half of the months | `deriveInvestBehavior()` |
| `history.soldInDrawdown`, `drawdownSellPct` | sells while the index is ≥ 10% below its high, as a share of the portfolio just before the first sell | `deriveInvestBehavior()` |

`deriveInvestBehavior()` (`src/lib/finance/investBehavior.ts`) is pure and deterministic and calls no model. It uses
`MARKET_INDEX`, a made-up monthly index with one drawdown in summer 2026. The index is illustrative, not market data.
The function also reports dip buying and peak chasing, which only feed the insights. The engine maths is unchanged:
`analyzeBehavior()`, `simulate()`, the solver and the pension and mortgage rules read the same profile fields as
before.

## Store

`src/lib/accounts/` (import from `@/lib/accounts`).

* **State:** `{ hydrated, activeId, accounts: Account[] }`. An `Account` has `id`, `builtIn`, `profile` (the
  materialized `Profile` the engine runs on), `receipts`, `localChanges` and `version`. `version` changes whenever
  the profile data changes and is part of the app's simulation cache keys. Snapped receipts don't change it.
* **Persistence:** the active id in `localStorage["doppel:account"]`, and local data and user-created accounts in
  `localStorage["doppel:accounts:v1"]` as `{ v: 1, local: { [accountId]: LocalData }, users: Profile[] }`. Every
  access is wrapped in try/catch; without storage the store works in memory.
* **Hydration:** the module starts with the built-in data and Barlas active, which is what the server renders.
  `useAccounts()` uses `useSyncExternalStore` with that state as the server snapshot. `DoppelApp` calls
  `hydrateAccounts()` after mount and then loads the stored account.
* **Local data** (`LocalData`): `receipts` (snapped receipts), `txAdded` / `txEdited` / `txDeleted`,
  `tradesAdded` / `tradesEdited` / `tradesDeleted`, `profile` (field overrides). The original data is never
  modified. `materialize(base, local)` applies the changes, re-derives spending, rent and take-home pay unless they
  were set explicitly, and then derives the behaviour inputs from the trades.

### API

Records have stable ids. Original transactions are `tx-0`, `tx-1`, … and original trades `tr-0`, …; added records
get generated ids.

| Function | What it does |
|---|---|
| `useAccounts()` | React hook: live `AccountsState` |
| `hydrateAccounts()` | Reads localStorage once; call after mount |
| `listAccounts()`, `getAccount(id)`, `getActiveAccount()` | Read the current state outside React |
| `setActiveAccount(id)` | Switches the account (persisted) |
| `listTransactions(accountId)` | `{ id, value: Transaction }[]` after local changes |
| `addTransaction(accountId, tx)` → id | One transaction (manual entry) |
| `addTransactions(accountId, txs)` → ids | Many transactions in one write (CSV / camt.053 import) |
| `updateTransaction(accountId, id, patch)`, `deleteTransaction(accountId, id)` | Edit or delete any transaction, original or added |
| `listTrades`, `addTrade`, `addTrades`, `updateTrade`, `deleteTrade` | Same for `InvestmentTrade`s (broker import) |
| `setProfileFields(accountId, fields)` | Overrides profile fields (`ProfileFields`); `undefined` removes an override |
| `createAccount(input: NewAccountInput)` → id | A user account from scratch (wizard); not activated automatically |
| `deleteAccount(id)` | Deletes a user account; built-in accounts can only be reset |
| `addReceipt(accountId, tx)` | Saves a snapped receipt; the app calls this after *Add to twin* |
| `resetAccount(id)` | "Reset to original data": drops all local data of the account |

`ProfileFields` covers name, age, city, canton, income, tax rate, balances, risk profile, retirement age, goal and
events. It also accepts `investShare` and `contributes3a` as manual overrides, for an account that has no trade
history yet. Otherwise both are derived from the trades.

Importers should produce the existing shapes: `Transaction` (`date`, `merchant`, `category`, `amount` in CHF, positive
= spend; transfers to a broker as category `investing`, which spending averages ignore) and `InvestmentTrade`
(`date`, `account: "broker" | "3a"`, `instrument`, optional `kind: "fund" | "stock"`, `side`, `amount` in CHF,
optional `units` and `price`).

### Notes for the next phase

* Spending and the payday spike are computed over all transactions of the account. An import should cover whole
  months, because a partial month lowers the averages.
* Drawdown detection only knows the months covered by `MARKET_INDEX`. Trades outside it count as "no drawdown".
  Real imports need a real index series.
* `Account.version` changes with every edit, so the app starts a fresh session for that account (its what-if
  scenario is reset) after a data change. Switching accounts without data changes keeps each account's session.

## Header switcher

`src/components/AccountSwitcher.tsx`: a menu button with initials, name and net worth. Enter, Space or ↓ opens the
menu on the current account; ↑ / ↓ / Home / End move; Enter selects; Escape closes and returns focus. The last menu
item is "Reset to original data", which removes the account's snapped receipts and what-ifs. At 320 px the switcher
and the token badge share the header's second row.
