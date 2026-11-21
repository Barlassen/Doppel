import type { en } from "./en";

/** Supported UI locales. English is the source of truth and the server-rendered default. */
export const LOCALES = ["en", "de", "fr", "tr"] as const;
export type Locale = (typeof LOCALES)[number];

/** Same nested shape as `en`, with every leaf widened to `string` — what each translation must satisfy. */
type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type Messages = Shape<typeof en>;

/** Every leaf path of `en`, e.g. "hero.disciplined" or "common.tokens_one". */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type LeafKey = Leaves<typeof en>;

/** CLDR plural categories used as key suffixes: `foo_one`, `foo_other` → `t("foo", { count })`. */
export const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;
type PluralSuffix = `_${(typeof PLURAL_SUFFIXES)[number]}`;
type StripPlural<K> = K extends `${infer Base}${PluralSuffix}` ? Base : K;

/** A type-checked message key. Plural families are addressed by their base key. */
export type MessageKey = StripPlural<LeafKey>;

/**
 * A translatable message: what `src/lib/**` returns instead of an English sentence.
 * Numbers stay raw in `params`; the template decides how to format them (`{amount:chf}`, `{p:pct}`, …).
 */
export interface Msg {
  key: MessageKey;
  params?: Params;
}

/** A param may itself be a message (translated recursively) or a list (joined with " · "). */
export type ParamValue = string | number | Msg | readonly ParamValue[];
export type Params = Readonly<Record<string, ParamValue>>;

/** Final text (data such as a file name or user input) or a message descriptor. */
export type Text = string | Msg;

export const isLocale = (value: unknown): value is Locale => LOCALES.some((locale) => locale === value);

export const msg = (key: MessageKey, params?: Params): Msg => (params ? { key, params } : { key });
