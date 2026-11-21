/**
 * Tiny typed i18n layer (no dependency). Pure functions only — usable from React, from `src/lib/**`
 * and from Node scripts. React bindings live in `I18nProvider.tsx`.
 *
 * Templates:
 *   {name}          → the param; numbers print as-is (integers) or with the locale's decimal mark
 *   {name:format}   → formatted with `createFmt(locale)` — formats: chf, chfShort, chfSigned, mio,
 *                     pct, pct1, int, num1, signed
 *   key_one / key_other → plural family, chosen with Intl.PluralRules on `params.count`
 * Param values may be nested messages ({ key, params }) or lists (joined with " · ").
 */
import { groupCh } from "@/lib/format";
import { de } from "./de";
import { en } from "./en";
import { fr } from "./fr";
import { tr } from "./tr";
import { LOCALES, type Locale, type MessageKey, type Messages, type Msg, type ParamValue, type Params, type Text } from "./types";

export { LOCALES, msg } from "./types";
export type { Locale, MessageKey, Messages, Msg, ParamValue, Params, Text } from "./types";

export const DEFAULT_LOCALE: Locale = "en";
export const STORAGE_KEY = "doppel:locale";

export const DICTIONARIES: Record<Locale, Messages> = { en, de, fr, tr };

/** Native language names for the switcher (never translated). */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch", fr: "Français", tr: "Türkçe" };
/** BCP 47 tags: `<html lang>`, Intl month names. Swiss variants for German and French. */
export const LOCALE_TAGS: Record<Locale, string> = { en: "en", de: "de-CH", fr: "fr-CH", tr: "tr-TR" };
/** Web Speech API recognition language per UI locale. */
export const SPEECH_LANGS: Record<Locale, string> = { en: "en-US", de: "de-CH", fr: "fr-CH", tr: "tr-TR" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Best supported match for a list of BCP 47 tags (e.g. `navigator.languages`), else English. */
export function detectLocale(languages: readonly string[] | undefined | null): Locale {
  for (const tag of languages ?? []) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export const isMsg = (v: unknown): v is Msg =>
  typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { key?: unknown }).key === "string" && !("$$typeof" in v);

// ---------------------------------------------------------------------------
// Number formatting. Deterministic on purpose (no Intl for numbers): Node and browsers ship different ICU
// data, and the English server render must equal the first client render.
// ---------------------------------------------------------------------------

const DECIMAL: Record<Locale, string> = { en: ".", de: ".", fr: ",", tr: "," };

/** Percent patterns: Swiss German/English "40%", French "40 %" (narrow no-break space), Turkish "%40". */
const PERCENT: Record<Locale, (v: string) => string> = {
  en: (v) => `${v}%`,
  de: (v) => `${v}%`,
  fr: (v) => `${v} %`,
  tr: (v) => (v.startsWith("-") ? `-%${v.slice(1)}` : `%${v}`),
};

export interface Fmt {
  locale: Locale;
  /** CHF with Swiss grouping in every locale: "CHF 1’234". */
  chf: (n: number) => string;
  /** "+CHF 400" / "−CHF 400". */
  chfSigned: (n: number) => string;
  /** Compact axis label: "780k", "1.40M" (decimal mark per locale). */
  chfShort: (n: number) => string;
  /** Millions with up to 2 decimals: 1_400_000 → "1.4" (fr/tr "1,4"). */
  mio: (n: number) => string;
  /** Fraction → percent string per locale rules. */
  pct: (x: number, digits?: number) => string;
  /** Plain number with the locale's decimal mark (no grouping). `digits` fixes the decimals. */
  num: (n: number, digits?: number) => string;
  /** Rounded integer with Swiss grouping: 1’000. */
  int: (n: number) => string;
  /** "+24" / "−6". */
  signed: (n: number) => string;
  /** Short month + year, `months` from now: "Nov 2026", "nov. 2026", "Kas 2026". */
  monthYear: (months: number, now?: Date) => string;
}

const fmtCache = new Map<Locale, Fmt>();

export function createFmt(locale: Locale): Fmt {
  const cached = fmtCache.get(locale);
  if (cached) return cached;
  const dec = (s: string) => (DECIMAL[locale] === "." ? s : s.replace(".", DECIMAL[locale]));
  const num = (n: number, digits?: number) => dec(digits === undefined ? String(Math.round(n * 100) / 100) : n.toFixed(digits));
  const chf = (n: number) => `CHF ${groupCh(Math.round(n))}`;
  let month: Intl.DateTimeFormat | undefined;
  const f: Fmt = {
    locale,
    chf,
    chfSigned: (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${chf(Math.abs(n))}`,
    chfShort: (n) => {
      const a = Math.abs(n);
      if (a >= 1e6) return `${dec((n / 1e6).toFixed(a >= 1e7 ? 0 : 2))}M`;
      if (a >= 1e3) return `${Math.round(n / 1e3)}k`;
      return `${Math.round(n)}`;
    },
    mio: (n) => num(Math.round((n / 1e6) * 100) / 100),
    pct: (x, digits = 0) => PERCENT[locale](dec((x * 100).toFixed(digits))),
    num,
    int: (n) => groupCh(Math.round(n)),
    signed: (n) => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(Math.abs(n))}` : num(0)),
    monthYear: (months, now = new Date()) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() + months);
      month ??= new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: "short" });
      return `${month.format(d)} ${d.getFullYear()}`;
    },
  };
  fmtCache.set(locale, f);
  return f;
}

/** Formats one number for a `{name:format}` placeholder. Unknown formats fall back to `num`. */
export function formatNumber(f: Fmt, n: number, format?: string): string {
  switch (format) {
    case "chf":
      return f.chf(n);
    case "chfSigned":
      return f.chfSigned(n);
    case "chfShort":
      return f.chfShort(n);
    case "mio":
      return f.mio(n);
    case "pct":
      return f.pct(n);
    case "pct1":
      return f.pct(n, 1);
    case "int":
      return f.int(n);
    case "num1":
      return f.num(n, 1);
    case "signed":
      return f.signed(n);
    default:
      return Number.isInteger(n) ? String(n) : f.num(n);
  }
}

/** Placeholder syntax shared by `translate`, `richParts` and `scripts/i18n-check.ts`. */
export const PLACEHOLDER = /\{(\w+)(?::(\w+))?\}/g;
export const FORMATS = ["chf", "chfSigned", "chfShort", "mio", "pct", "pct1", "int", "num1", "signed"] as const;

function lookup(dict: Messages, path: string): string | undefined {
  let node: unknown = dict;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** The raw template for a key (plural form chosen from `params.count`), falling back to English, then the key. */
export function template(locale: Locale, key: MessageKey, params?: Params): string {
  const dict = DICTIONARIES[locale];
  const count = params?.count;
  if (typeof count === "number") {
    let rules = pluralRules.get(locale);
    if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(LOCALE_TAGS[locale])));
    const form = lookup(dict, `${key}_${rules.select(count)}`) ?? lookup(dict, `${key}_other`);
    if (form !== undefined) return form;
  }
  return lookup(dict, key) ?? lookup(dict, `${key}_other`) ?? lookup(en, key) ?? lookup(en, `${key}_other`) ?? key;
}

/** Renders a single param value to text. */
export function paramText(locale: Locale, value: ParamValue | undefined, format?: string): string {
  if (value === undefined) return "";
  if (typeof value === "number") return formatNumber(createFmt(locale), value, format);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return (value as readonly ParamValue[]).map((v) => paramText(locale, v, format)).join(" · ");
  return translate(locale, (value as Msg).key, (value as Msg).params);
}

/**
 * Splits a template into literal strings and resolved placeholders. `resolve` decides how a
 * placeholder renders (string for `translate`, React nodes for `rich`).
 */
export function splitTemplate<T>(tpl: string, resolve: (name: string, format?: string) => T): (string | T)[] {
  const out: (string | T)[] = [];
  let last = 0;
  for (const m of tpl.matchAll(PLACEHOLDER)) {
    if (m.index! > last) out.push(tpl.slice(last, m.index));
    out.push(resolve(m[1], m[2]));
    last = m.index! + m[0].length;
  }
  if (last < tpl.length) out.push(tpl.slice(last));
  return out;
}

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const tpl = template(locale, key, params);
  if (!params) return tpl;
  return splitTemplate(tpl, (name, format) => paramText(locale, params[name], format)).join("");
}

/** Translates a message descriptor; plain strings (data, user input) pass through unchanged. */
export function translateText(locale: Locale, text: Text | null | undefined): string {
  if (text === null || text === undefined) return "";
  return typeof text === "string" ? text : translate(locale, text.key, text.params);
}
