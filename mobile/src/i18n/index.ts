import { de } from "./de.ts";
import { en } from "./en.ts";
import type { Dictionary, MessageKey } from "./en.ts";
import { fr } from "./fr.ts";
import { tr } from "./tr.ts";

export type { MessageKey } from "./en.ts";
export type Locale = "en" | "de" | "fr" | "tr";

export const LOCALES: readonly Locale[] = ["en", "de", "fr", "tr"];
export const dictionaries: Record<Locale, Dictionary> = { en, de, fr, tr };

/**
 * The shell's language: the first of the device's preferred languages that Doppel has, else English.
 * Takes BCP 47 tags or bare language codes ("de-CH", "tr").
 */
export function pickLocale(preferred: readonly (string | null | undefined)[]): Locale {
  for (const tag of preferred) {
    const code = (tag ?? "").toLowerCase().split(/[-_]/)[0];
    const match = LOCALES.find((locale) => locale === code);
    if (match) return match;
  }
  return "en";
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const dictionary = dictionaries[locale];
  return (key, params) =>
    dictionary[key].replace(/\{(\w+)\}/g, (whole, name: string) =>
      params && name in params ? String(params[name]) : whole,
    );
}
