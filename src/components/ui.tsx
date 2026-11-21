"use client";

import { useId, type ReactNode } from "react";

/** One header style for every card: small caps title on the left, an optional control or badge on the right. */
export function CardHeader({ title, aside, className = "" }: { title: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={`mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 ${className}`}>
      <h3 className="label">{title}</h3>
      {aside}
    </div>
  );
}

/**
 * Progressive disclosure for supporting rows and footnotes. A native <details> element, so it is keyboard and
 * screen-reader accessible without extra state; the chevron is drawn in CSS (see `.disclosure` in globals.css).
 */
export function Disclosure({ summary, children, className = "" }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={`disclosure ${className}`}>
      <summary className="text-xs font-medium text-ink-2 hover:text-ink">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/** A titled group of related cards. */
export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-4 font-serif text-2xl leading-tight sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}
