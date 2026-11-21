import type { Goal, InvestmentTrade, LifeEvent, Profile, RiskProfile, Transaction } from "@/lib/finance/types";

/** A transaction or trade with a stable id, so it can be edited or deleted later. */
export interface AccountRecord<T> {
  id: string;
  value: T;
}

/**
 * Profile fields a user (or the next phase's wizard / manual entry) may set. Anything left out keeps the
 * account's original value, or is derived from the account's data:
 *  - `expensesMonth` / `rentMonth`: average monthly spending / housing over the transactions
 *  - `netIncomeMonth`: take-home from `grossIncomeYear` and `marginalTaxRate` (same rule as a payslip snap)
 *  - `investShare` / `contributes3a`: from the trades; setting them here overrides the derivation
 *    (for an account that has no trade history yet)
 */
export type ProfileFields = Partial<
  Pick<
    Profile,
    | "name"
    | "age"
    | "city"
    | "canton"
    | "grossIncomeYear"
    | "netIncomeMonth"
    | "expensesMonth"
    | "rentMonth"
    | "cash"
    | "portfolio"
    | "pillar2"
    | "pillar3a"
    | "marginalTaxRate"
    | "riskProfile"
    | "retirementAge"
    | "investShare"
    | "contributes3a"
  > & { goal: Goal; events: LifeEvent[] }
>;

/** Everything stored locally on top of an account's original data. Reset = drop this. */
export interface LocalData {
  /** Snapped receipts, oldest first. They feed the "this month" figure, not the multi-month baseline. */
  receipts: Transaction[];
  txAdded: AccountRecord<Transaction>[];
  txEdited: Record<string, Partial<Transaction>>;
  txDeleted: string[];
  tradesAdded: AccountRecord<InvestmentTrade>[];
  tradesEdited: Record<string, Partial<InvestmentTrade>>;
  tradesDeleted: string[];
  profile: ProfileFields;
}

/** What `createAccount()` needs; everything else has a sensible default or is derived. */
export interface NewAccountInput {
  name: string;
  age: number;
  city: string;
  /** Two-letter canton code, e.g. "ZH". */
  canton: string;
  grossIncomeYear: number;
  marginalTaxRate: number;
  /** Defaults to the take-home computed from gross income and marginal rate. */
  netIncomeMonth?: number;
  /** Defaults to the average spending of `transactions` (or 0 without transactions). */
  expensesMonth?: number;
  rentMonth?: number;
  cash?: number;
  portfolio?: number;
  pillar2?: number;
  pillar3a?: number;
  riskProfile?: RiskProfile;
  retirementAge?: number;
  /** Defaults to CHF 500k net worth by 50 (or 10 years from now if that is later). */
  goal?: Goal;
  events?: LifeEvent[];
  transactions?: Transaction[];
  trades?: InvestmentTrade[];
}

/** One account as the app sees it: original data + local additions, materialized into a `Profile`. */
export interface Account {
  id: string;
  builtIn: boolean;
  /** The profile the engine runs on (local additions applied, behaviour inputs derived). */
  profile: Profile;
  /** Snapped receipts saved for this account (the app's base scenario starts with them as `extraTx`). */
  receipts: Transaction[];
  /** Number of local additions and edits (0 = original data). */
  localChanges: number;
  /** Changes whenever the profile data changes (receipts excluded). Use it in cache keys. */
  version: string;
}

export interface AccountsState {
  /** False on the server and in the first client render; true once localStorage was read. */
  hydrated: boolean;
  activeId: string;
  accounts: Account[];
}
