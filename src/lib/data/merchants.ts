import type { Transaction } from "@/lib/finance/types";
import type { MessageKey, Msg, Text } from "@/lib/i18n/types";

/**
 * The demo profiles' transaction history uses generic English merchant descriptions as data (the
 * behavioural engine groups by them). These map them to translatable labels for the UI.
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

/** A demo merchant as a message; any other merchant (e.g. read from a receipt) stays as data. */
export function merchantText(name: string): Text {
  return Object.prototype.hasOwnProperty.call(DEMO_MERCHANTS, name)
    ? { key: DEMO_MERCHANTS[name] }
    : name;
}

export const categoryMsg = (c: Transaction["category"]): Msg => ({ key: `category.${c}` });
