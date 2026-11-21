import type { Transaction } from "@/lib/finance/types";
import type { MessageKey, Msg, Text } from "@/lib/i18n/types";

/**
 * The built-in accounts' history uses a few generic English merchant descriptions as data (the behavioural
 * engine groups by them). These map them to translatable labels for the UI; brand names stay as they are.
 */
const DEMO_MERCHANTS: Record<string, MessageKey> = {
  Rent: "merchant.rent",
  "Health insurance": "merchant.healthInsurance",
  "Mobile & internet": "merchant.mobile",
  "Streaming video": "merchant.streamingVideo",
  "Music streaming": "merchant.musicStreaming",
  "Gym membership": "merchant.gym",
  "Cloud storage": "merchant.cloud",
  "Half-fare + GA": "merchant.transport",
  Supermarket: "merchant.supermarket",
  Restaurant: "merchant.restaurant",
  Lunch: "merchant.lunch",
  "Online shop": "merchant.onlineShop",
};

/**
 * Swiss merchants used by the built-in accounts' history (brand names stay as data, never translated).
 * Grouped so the behavioural engine can spot overlapping services and food delivery.
 */
export const MERCHANT_GROUPS = {
  videoStreaming: ["Netflix", "Disney+", "Prime Video", "Apple TV+", "Sky Show", "blue+"],
  musicStreaming: ["Spotify", "Apple Music", "YouTube Premium"],
  delivery: ["Smood", "Uber Eats", "Just Eat"],
} as const;

export type MerchantGroup = keyof typeof MERCHANT_GROUPS;

/** The group a merchant belongs to, if any (exact name match). */
export function merchantGroup(name: string): MerchantGroup | undefined {
  for (const [group, names] of Object.entries(MERCHANT_GROUPS) as [MerchantGroup, readonly string[]][]) {
    if (names.includes(name)) return group;
  }
  return undefined;
}

/** A demo merchant as a message; any other merchant (e.g. read from a receipt) stays as data. */
export function merchantText(name: string): Text {
  return Object.prototype.hasOwnProperty.call(DEMO_MERCHANTS, name)
    ? { key: DEMO_MERCHANTS[name] }
    : name;
}

export const categoryMsg = (c: Transaction["category"]): Msg => ({ key: `category.${c}` });
