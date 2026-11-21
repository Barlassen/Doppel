/**
 * Shared contract for the local (0-token) what-if parsers. One module per language
 * (`en.ts`, `de.ts`, `fr.ts`, `tr.ts`) implements `IntentParser`; `index.ts` tries the active
 * locale first, then the others. Parsers return raw ops — the bounds in `../actions` are the
 * single gate that drops anything out of bounds.
 */
import type { LifeEvent } from "@/lib/finance/types";
import { translate } from "@/lib/i18n";
import type { Locale, Msg } from "@/lib/i18n/types";
import type { Op } from "../actions";

export interface IntentContext {
  /** The what-if exactly as typed (case preserved — place names are read from it). */
  text: string;
  events: LifeEvent[];
  /** The planned home, if any (the target of "delay the home"). */
  house?: LifeEvent;
  now: Date;
  /** The active plan's retirement age — the base for "retire 2 years earlier/later". */
  retirementAge: number;
}

export interface IntentParser {
  locale: Locale;
  /** Raw ops recognised in `ctx.text`; an empty array when nothing matched. */
  parse(ctx: IntentContext): Op[];
}

/** Built-in event label: English `label` (data for the LLM prompt) + translatable `labelMsg` for the UI. */
export function eventLabel(labelMsg: Msg): { label: string; labelMsg: Msg } {
  return { label: translate("en", labelMsg.key, labelMsg.params), labelMsg };
}

/** Months from now to mid-`year`, the same convention as the English parser and note snaps. */
export function monthOfYear(year: number, now: Date): number {
  return Math.max(0, (year - now.getFullYear()) * 12 + (6 - now.getMonth()));
}

/** A 4-digit year 2020–2069 anywhere in the text (also "2028'de", "2028de"). */
export function yearIn(t: string): number | undefined {
  const y = t.match(/(?<!\d)(20[2-6]\d)(?!\d)/);
  return y ? Number(y[1]) : undefined;
}

// ---------------------------------------------------------------------------
// Swiss / continental number formats for the DE, FR and TR parsers.
// (The English parser keeps its original number handling unchanged.)
// ---------------------------------------------------------------------------

/**
 * Lower-cases with the locale's rules and normalises Swiss number writing so a plain
 * `\d+(?:[.,]\d+)?` sees one number:
 *   "CHF 1'200" / "1’200" / "1 200" / "1 200" (narrow no-break space) / "1.200" → "1200"
 *   "500.–" / "500.-" → "500"
 * Currency words are dropped. "1.5 Mio." and "1,5" keep their decimal mark.
 */
export function normalizeText(text: string, locale: Locale): string {
  let t = text.toLocaleLowerCase(locale === "tr" ? "tr-TR" : locale).normalize("NFC").replace(/̇/g, "");
  t = t.replace(/[’`´]/g, "'");
  t = t.replace(/(\d)\.[–—-]{1,2}/g, "$1");
  t = t.replace(/(?<![\d.,])(\d{1,3})((?:['    .](\d{3}))+)(?![\d]|[.,]\d)/g, (_m, head: string, rest: string) => head + rest.replace(/\D/g, ""));
  t = t.replace(/(?<![\p{L}])(?:chf|sfr\.?|fr\.|franken|francs?|frank|isviçre\s+frangı)(?![\p{L}])/gu, " ");
  return t.replace(/\s+/g, " ").trim();
}

/** Number with an optional magnitude word: 500 · 1,5 mio · 900k · 80 bin · 100 mille · 1.2 millionen. */
export const AMOUNT = String.raw`(\d+(?:[.,]\d+)?)\s*(k|tsd\.?|tausend|bin|mille|mio\.?|millionen|million|millions|milyon|mn|m)?(?![\p{L}\d])`;

export function amountValue(n: string, unit?: string): number {
  const v = Number(n.replace(",", "."));
  const u = (unit ?? "").toLowerCase().replace(/\.$/, "");
  if (["k", "tsd", "tausend", "bin", "mille"].includes(u)) return v * 1000;
  if (["m", "mio", "mn", "million", "millionen", "millions", "milyon"].includes(u)) return v * 1_000_000;
  return v;
}

/** Largest amount in `t` above `min` (bare years 2020–2069 are skipped). */
export function largestAmountAbove(t: string, min: number): number | undefined {
  let best: number | undefined;
  for (const m of t.matchAll(new RegExp(AMOUNT, "gu"))) {
    const v = amountValue(m[1], m[2]);
    if (v > min && !(v >= 2020 && v <= 2069 && !m[2])) best = Math.max(best ?? 0, v);
  }
  return best;
}
