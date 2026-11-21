import type { Transaction, TransactionCategory } from "@/lib/finance/types";
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

export const categoryMsg = (c: Transaction["category"]): Msg => (c === "other" ? { key: "data.categoryOther" } : { key: `category.${c}` });

/**
 * Merchant dictionary for the statement importers' local categorisation (0 tokens): the built-in accounts' merchants
 * and common Swiss chains. Exact names, compared case- and accent-insensitively (`merchantKey()` in
 * `src/lib/import/text.ts`). Keyword rules for everything else live in `src/lib/import/categorize.ts`.
 */
export const MERCHANT_CATEGORIES: Readonly<Record<string, TransactionCategory>> = {
  // Generic descriptions used by the built-in accounts
  Rent: "housing",
  "Health insurance": "insurance",
  "Mobile & internet": "bills",
  "Streaming video": "subscriptions",
  "Music streaming": "subscriptions",
  "Gym membership": "subscriptions",
  "Cloud storage": "subscriptions",
  "Half-fare + GA": "transport",
  Supermarket: "groceries",
  Restaurant: "dining",
  Lunch: "dining",
  "Online shop": "shopping",
  // Built-in accounts' merchants whose name has no keyword
  "Migros Take Away": "dining",
  "Coop Take it": "dining",
  "Manor Food": "groceries",
  "Holy Cow!": "dining",
  Rhybar: "dining",
  "Kletterzentrum Gaswerk": "shopping",
  "Mensa Technopark": "dining",
  Mobilis: "transport",
  "U-Abo TNW": "transport",
  "ZVV NetzPass": "transport",
  ewz: "bills",
  IWB: "bills",
  "Romande Energie": "bills",
  "Xbox Game Pass": "subscriptions",
  Audible: "subscriptions",
  "Sky Show": "subscriptions",
  "blue+": "subscriptions",
  Sephora: "shopping",
  AliExpress: "shopping",
  // Common Swiss chains and services
  Volg: "groceries",
  Spar: "groceries",
  "Coop Pronto": "groceries",
  "Migrolino": "groceries",
  "Alnatura": "groceries",
  Farmy: "groceries",
  "Brezelkönig": "dining",
  "Caffè Spettacolo": "dining",
  "Tibits": "dining",
  "Hiltl": "dining",
  "Vapiano": "dining",
  "Yooji's": "dining",
  "Swiss International Air Lines": "travel",
  "Edelweiss Air": "travel",
  Airbnb: "travel",
  "Interdiscount": "shopping",
  "Brack.ch": "shopping",
  "Jumbo": "shopping",
  "Ochsner Sport": "shopping",
  "SportX": "shopping",
  "Do it + Garden": "shopping",
  "Pfister": "shopping",
  "Micasa": "shopping",
  "Amavita": "shopping",
  "Sun Store": "shopping",
  "Serafe": "bills",
  "Wingo": "bills",
  "Yallo": "bills",
  "Init7": "bills",
  "Quickline": "bills",
  "Mobility": "transport",
  "PubliBike": "transport",
};
