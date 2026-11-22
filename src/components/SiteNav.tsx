"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/I18nProvider";

/** Small page nav shared by the dashboard and Doppel Play. */
export function SiteNav({ current }: { current: "dashboard" | "play" }) {
  const { t } = useI18n();
  const item = (href: string, id: "dashboard" | "play", label: string) => (
    <Link
      href={href}
      aria-current={current === id ? "page" : undefined}
      className={`rounded-full px-2 py-1 text-[11px] font-medium ${current === id ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label={t("play.nav.aria")} className="flex items-center gap-0.5">
      {item("/", "dashboard", t("play.nav.dashboard"))}
      {item("/play", "play", t("play.nav.play"))}
    </nav>
  );
}

/** The dashboard's main areas, in page order. Each id is an anchor on the dashboard. */
const SECTIONS = ["money", "outlook", "decisions", "assistant", "statements"] as const;

/**
 * Second header row: jump links to the dashboard's main areas (money, outlook, decisions, the AI twin assistant,
 * statements). On Doppel Play the same links lead back to the dashboard. Scrolls sideways on narrow screens.
 */
export function SectionNav({ current }: { current: "dashboard" | "play" }) {
  const { t } = useI18n();
  const base = current === "dashboard" ? "" : "/";
  return (
    <nav aria-label={t("sections.aria")} data-testid="section-nav" className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2">
      <ul className="flex w-max items-center gap-1">
        {SECTIONS.map((id) => (
          <li key={id}>
            <a
              href={`${base}#${id}`}
              className="block min-h-6 whitespace-nowrap rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
            >
              {t(`sections.${id}`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
