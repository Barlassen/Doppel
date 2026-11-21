"use client";

import { createContext, Fragment, isValidElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createFmt,
  DEFAULT_LOCALE,
  detectLocale,
  isLocale,
  LOCALE_TAGS,
  paramText,
  splitTemplate,
  STORAGE_KEY,
  template,
  translate,
  translateText,
  type Fmt,
} from "./index";
import type { Locale, MessageKey, ParamValue, Params, Text } from "./types";

export interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Type-checked key → string. `{name}` / `{name:format}` interpolation, plurals via `params.count`. */
  t: (key: MessageKey, params?: Params) => string;
  /** A message descriptor from `src/lib/**` (or plain data text) → string. */
  tm: (text: Text | null | undefined) => string;
  /** Like `t`, but params may be React nodes (e.g. `<b>` around a number). */
  rich: (key: MessageKey, params: Readonly<Record<string, ParamValue | ReactNode>>) => ReactNode;
  fmt: Fmt;
}

function makeI18n(locale: Locale, setLocale: (l: Locale) => void): I18n {
  return {
    locale,
    setLocale,
    t: (key, params) => translate(locale, key, params),
    tm: (text) => translateText(locale, text),
    rich: (key, params) => {
      const numeric = typeof params.count === "number" ? ({ count: params.count } as Params) : undefined;
      const parts = splitTemplate<ReactNode>(template(locale, key, numeric), (name, format) => {
        const v = params[name];
        if (isValidElement(v)) return v;
        if (v === null || v === undefined || typeof v === "boolean") return "";
        return paramText(locale, v as ParamValue, format);
      });
      return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
    },
    fmt: createFmt(locale),
  };
}

const noop = () => {};
const I18nContext = createContext<I18n>(makeI18n(DEFAULT_LOCALE, noop));

function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Hydration-safe: the server and the first client render are always English. After mount the provider
 * switches to the stored choice (`localStorage["doppel:locale"]`) or the best `navigator.languages` match.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const preferred = storedLocale() ?? detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
    if (preferred !== DEFAULT_LOCALE) setLocaleState(preferred);
  }, []);

  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[locale];
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / blocked storage: the choice still applies for this visit.
    }
  }, []);

  const value = useMemo(() => makeI18n(locale, setLocale), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
