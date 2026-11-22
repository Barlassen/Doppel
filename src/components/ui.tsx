"use client";

import { useId, type ReactNode } from "react";
import type { LifeEvent } from "@/lib/finance/types";

/** Goal odds from which a plan counts as on track (the solver's target, see goalSolver.ts), and as possible. */
export const ON_TRACK = 0.8;
export const POSSIBLE = 0.5;
/** One colour rule for every odds figure on the dashboard. */
export const oddsTone = (p: number) => (p >= ON_TRACK ? "text-good" : p >= POSSIBLE ? "text-warn" : "text-bad");

/** One icon per life-event type: the timeline list and the chart markers use the same ones. */
export const EVENT_ICON: Record<LifeEvent["type"], string> = {
  house: "🏠",
  child: "👶",
  jobloss: "💼",
  crash: "📉",
  raise: "📈",
  expense: "🎯",
  income: "💰",
};

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
 * Pass `open` + `onToggle` to control it (e.g. to open it when its content needs attention).
 */
export function Disclosure({
  summary,
  children,
  className = "",
  open,
  onToggle,
  testId,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  testId?: string;
}) {
  return (
    <details
      className={`disclosure ${className}`}
      data-testid={testId}
      {...(open !== undefined ? { open } : {})}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
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
