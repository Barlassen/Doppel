"use client";

import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, subscribe } from "./store";
import type { AccountsState } from "./types";

/** Live accounts state. Server render and hydration use the built-in data; call `hydrateAccounts()` after mount. */
export function useAccounts(): AccountsState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
