"use client";

import { useSyncExternalStore } from "react";
import type { FactId } from "@/lib/import";

/**
 * What the dashboard remembers about a statement beyond the accounts store, per account, in this browser:
 *  - the income bookings of each import (the accounts store keeps spending and trades only), so the statement
 *    summary still knows the salary after the review is closed;
 *  - the user's answer to each inferred life fact, so a rejected fact is not asked again.
 */
export interface IncomeRow {
  importId: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  merchant: string;
  /** CHF received (positive). */
  amount: number;
}
export type FactAnswer = "confirmed" | "rejected";
export interface StatementMemory {
  income: IncomeRow[];
  facts: Partial<Record<FactId, FactAnswer>>;
}

const KEY = "doppel:statement:v1";
const EMPTY: StatementMemory = { income: [], facts: {} };
const MAX_INCOME_ROWS = 600;

let state: Record<string, StatementMemory> = {};
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Partial<StatementMemory>>;
    const next: Record<string, StatementMemory> = {};
    for (const [id, m] of Object.entries(raw ?? {})) {
      next[id] = {
        income: Array.isArray(m?.income) ? m.income.filter((r) => r && typeof r.date === "string" && typeof r.merchant === "string" && Number.isFinite(r.amount)) : [],
        facts: m?.facts && typeof m.facts === "object" ? m.facts : {},
      };
    }
    state = next;
  } catch {
    state = {};
  }
}

function write(accountId: string, next: StatementMemory) {
  state = { ...state, [accountId]: next };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full store: the memory still holds for this visit.
  }
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // Read the stored memory once a component is mounted (never during the server render or hydration).
  if (!loaded) {
    load();
    queueMicrotask(() => listeners.forEach((l) => l()));
  }
  return () => {
    listeners.delete(listener);
  };
};

/** The memory of one account. Empty on the server and in the first client render. */
export function useStatementMemory(accountId: string): StatementMemory {
  return useSyncExternalStore(subscribe, () => state[accountId] ?? EMPTY, () => EMPTY);
}

/** Income bookings of a confirmed import. */
export function rememberIncome(accountId: string, rows: IncomeRow[]) {
  if (!rows.length) return;
  const current = state[accountId] ?? EMPTY;
  write(accountId, { ...current, income: [...current.income, ...rows].slice(-MAX_INCOME_ROWS) });
}

/** An import was undone: its income bookings go with it. */
export function forgetImport(accountId: string, importId: string) {
  const current = state[accountId];
  if (!current) return;
  write(accountId, { ...current, income: current.income.filter((r) => r.importId !== importId) });
}

/** Confirm or reject an inferred fact; `undefined` asks again. */
export function answerFact(accountId: string, fact: FactId, answer: FactAnswer | undefined) {
  const current = state[accountId] ?? EMPTY;
  const facts = { ...current.facts };
  if (answer) facts[fact] = answer;
  else delete facts[fact];
  write(accountId, { ...current, facts });
}

/** Forget every answer of an account (the facts are then proposed again). */
export function resetFacts(accountId: string) {
  const current = state[accountId];
  if (current) write(accountId, { ...current, facts: {} });
}
