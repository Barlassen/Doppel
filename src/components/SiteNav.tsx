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
