"use client";

import { useState } from "react";
import type { LedgerEntry } from "@/lib/frugal/ledger";
import { totals } from "@/lib/frugal/ledger";
import { usd } from "@/lib/format";

const TIER_STYLE: Record<string, { label: string; cls: string }> = {
  "0": { label: "Tier 0 · local QR", cls: "bg-good/15 text-good" },
  "1": { label: "Tier 1 · OCR → text", cls: "bg-warn/15 text-warn" },
  "2": { label: "Tier 2 · tiny image", cls: "bg-s1/15 text-s1" },
  "local-parser": { label: "Local parser", cls: "bg-good/15 text-good" },
  llm: { label: "Small LLM", cls: "bg-warn/15 text-warn" },
};

export function TierChip({ tier }: { tier: LedgerEntry["tier"] }) {
  const s = TIER_STYLE[String(tier)];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

export function FrugalBadge({ entries, onClick }: { entries: LedgerEntry[]; onClick: () => void }) {
  const t = totals(entries);
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-frugal"
      title="Open the Frugal Pipeline Inspector"
    >
      <span className="text-frugal">⚡</span>
      <span className="num">{t.ours.toLocaleString("de-CH")} tokens</span>
      {entries.length > 0 && <span className="num font-semibold text-frugal">−{(t.saved * 100).toFixed(1)}%</span>}
    </button>
  );
}

export function Inspector({ entries, open, onClose }: { entries: LedgerEntry[]; open: boolean; onClose: () => void }) {
  const t = totals(entries);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!open) return null;
  const maxTokens = Math.max(t.naive, 1);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/30" onClick={onClose}>
      <div
        className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="label">Frugal pipeline inspector</div>
              <h2 className="font-serif text-3xl">Every token, accounted for.</h2>
            </div>
            <button onClick={onClose} className="rounded-full border border-line px-3 py-1 text-sm text-ink-2 hover:text-ink">
              Close
            </button>
          </div>

          {/* Totals */}
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-surface-2 p-4">
              <div className="label">Doppel (measured)</div>
              <div className="num mt-1 text-2xl font-semibold">{t.ours.toLocaleString("de-CH")} tokens</div>
              <div className="num text-sm text-ink-2">{usd(t.oursCost)}</div>
            </div>
            <div className="rounded-xl bg-surface-2 p-4">
              <div className="label">Naive frontier VLM (estimated)</div>
              <div className="num mt-1 text-2xl font-semibold">{t.naive.toLocaleString("de-CH")} tokens</div>
              <div className="num text-sm text-ink-2">{usd(t.naiveCost)}</div>
            </div>
            <div className="rounded-xl bg-surface-2 p-4">
              <div className="label">Saved</div>
              <div className="num mt-1 text-2xl font-semibold text-frugal">{entries.length ? `${(t.saved * 100).toFixed(1)}%` : "—"}</div>
              <div className="text-sm text-ink-2">The maths never touches an LLM.</div>
            </div>
          </div>

          {entries.length > 0 && (
            <div className="mb-6 space-y-2">
              <Bar label="Naive" value={t.naive} max={maxTokens} color="var(--ink-3)" />
              <Bar label="Doppel" value={t.ours} max={maxTokens} color="var(--frugal)" />
            </div>
          )}

          {/* Cascade explainer */}
          <div className="mb-6 grid gap-2 text-sm sm:grid-cols-3">
            <Explain chip="0" title="Swiss QR-bill" text="jsQR decodes the payment QR in the browser. Amount, creditor and reference — 0 tokens." />
            <Explain chip="1" title="Local OCR → text" text="Canvas cleanup + Tesseract in a web worker. Only ~300 chars of confident lines go to a small text model." />
            <Explain chip="2" title="Tiny image fallback" text="Only if OCR confidence < 65%: a 512px grayscale JPEG (~20 KB) goes to a small vision model." />
          </div>

          {/* Entries */}
          <div className="label mb-2">Calls this session</div>
          {entries.length === 0 && <p className="text-sm text-ink-3">Snap a document or ask a what-if — each call shows up here with its real payload.</p>}
          <ul className="space-y-2">
            {[...entries].reverse().map((e) => {
              const ours = e.usage.promptTokens + e.usage.completionTokens;
              const naive = e.naive.promptTokens + e.naive.completionTokens;
              const isOpen = expanded === e.id;
              return (
                <li key={e.id} className="rounded-xl border border-line">
                  <button onClick={() => setExpanded(isOpen ? null : e.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left">
                    <TierChip tier={e.tier} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.title}</span>
                    <span className="num text-xs text-ink-2">{Math.round(e.ms)} ms</span>
                    <span className="num text-xs font-semibold">{ours} tok</span>
                    <span className="num text-xs text-ink-3 line-through">{naive.toLocaleString("de-CH")}</span>
                    {e.usage.mode === "offline" && <span className="text-[11px] text-warn">offline</span>}
                  </button>
                  {isOpen && (
                    <div className="border-t border-line px-3 py-3 text-xs">
                      {e.steps && (
                        <ol className="mb-3 space-y-1">
                          {e.steps.map((s, i) => (
                            <li key={i} className="flex gap-3">
                              <span className="num w-16 shrink-0 text-right text-ink-3">{s.ms.toFixed(0)} ms</span>
                              <span className="font-medium">{s.name}</span>
                              {s.detail && <span className="text-ink-2">{s.detail}</span>}
                            </li>
                          ))}
                        </ol>
                      )}
                      <div className="mb-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <span className="text-ink-3">Model: </span>
                          {e.usage.model} · in {e.usage.promptTokens} / out {e.usage.completionTokens} · {usd(e.usage.costUsd)}
                        </div>
                        <div>
                          <span className="text-ink-3">Naive baseline: </span>
                          {e.naive.description} · {usd(e.naive.costUsd)}
                        </div>
                      </div>
                      {e.preview && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.preview} alt="Image actually sent" className="mb-2 h-32 rounded border border-line" />
                      )}
                      <div className="text-ink-3">Payload that left the browser:</div>
                      <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-14 text-ink-2">{label}</span>
      <div className="h-3 flex-1 rounded-full bg-surface-2">
        <div className="h-3 rounded-full" style={{ width: `${Math.max(0.6, (value / max) * 100)}%`, background: color }} />
      </div>
      <span className="num w-20 text-right font-medium">{value.toLocaleString("de-CH")}</span>
    </div>
  );
}

function Explain({ chip, title, text }: { chip: "0" | "1" | "2"; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <TierChip tier={Number(chip) as 0 | 1 | 2} />
      <div className="mt-2 font-medium">{title}</div>
      <div className="text-ink-2">{text}</div>
    </div>
  );
}
