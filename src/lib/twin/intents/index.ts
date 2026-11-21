import { LOCALES, type Locale } from "@/lib/i18n/types";
import { germanIntents } from "./de";
import { englishIntents } from "./en";
import { frenchIntents } from "./fr";
import { turkishIntents } from "./tr";
import type { IntentParser } from "./shared";

const parsers: Record<Locale, IntentParser> = { en: englishIntents, de: germanIntents, fr: frenchIntents, tr: turkishIntents };

export function orderedParsers(locale: Locale): IntentParser[] {
  return [parsers[locale], ...LOCALES.filter((other) => other !== locale).map((other) => parsers[other])];
}
