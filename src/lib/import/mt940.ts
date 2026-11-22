import { parseAmount, round2 } from "./text";
import type { ParsedStatement, SkippedRow, StatementRow } from "./types";

/**
 * SWIFT MT940 (customer statement) reader: the older text format Swiss and German e-banking still export
 * (`.sta`, `.mt940`, `.940`). Reads the statement lines (`:61:`) with their information to the account owner
 * (`:86:`), plain or with the German structured subfields (`?20`–`?29` purpose, `?32` / `?33` name).
 *
 *   :61:2606020602D45,50NTRFNONREF//B6F2A1     value date, booking date, D/C (RD/RC = reversal), amount, type, refs
 *   :86:Coop Zürich Karte 1234
 *
 * The account currency comes from the opening balance (`:60F:` / `:60M:`). Not handled: MT942 interim reports and
 * the balances themselves (the twin learns from the bookings).
 */

export const isMt940 = (text: string) => /^:20:/m.test(text) && /^:61:\d{6}/m.test(text) && /^:6[02][FM]:[CD]\d{6}[A-Z]{3}/m.test(text);

const LINE = /^(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])[A-Z]?(\d{1,15},\d{0,2})(?:[NSF][A-Z0-9]{3})?([^/\r\n]*)(?:\/\/([^\r\n]*))?/;

function validDate(yy: string, mm: string, dd: string): string | undefined {
  // MT940 years have two digits: 00–79 → 20xx, 80–99 → 19xx (the SWIFT convention).
  const year = Number(yy) + (Number(yy) < 80 ? 2000 : 1900);
  const date = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
  if (date.getUTCMonth() !== Number(mm) - 1 || date.getUTCDate() !== Number(dd)) return undefined;
  return `${year}-${mm}-${dd}`;
}

/** `:86:` → counterparty and text. Structured: "166?00Lastschrift?20Miete Juni?32Verwaltung AG". */
function information(raw: string): { text: string; counterparty?: string } {
  const flat = raw.replace(/\r?\n/g, "").trim();
  if (!/^\d{3}\?\d{2}/.test(flat)) return { text: raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" ") };
  const fields = new Map<number, string>();
  for (const m of flat.slice(3).matchAll(/\?(\d{2})([^?]*)/g)) fields.set(Number(m[1]), m[2].trim());
  const pick = (from: number, to: number) => [...fields].filter(([n]) => n >= from && n <= to).sort((a, b) => a[0] - b[0]).map(([, v]) => v).filter(Boolean);
  const counterparty = pick(32, 33).join(" ") || undefined;
  return { text: [...pick(20, 29), ...pick(60, 63)].join(" ") || fields.get(0) || "", counterparty };
}

export function parseMt940(text: string): ParsedStatement | undefined {
  if (!isMt940(text)) return undefined;
  const rows: StatementRow[] = [];
  const skipped: SkippedRow[] = [];
  let currency = "CHF";
  let entry = 0;
  // A field runs from its tag to the next tag at the start of a line (or the "-" that ends a message).
  const fields = text.replace(/\r\n?/g, "\n").split(/\n(?=:\d{2}[A-Z]?:|-\s*(?:\n|$))/).map((f) => f.trim());
  for (let i = 0; i < fields.length; i++) {
    const tag = /^:(\d{2}[A-Z]?):/.exec(fields[i]);
    if (!tag) continue;
    const body = fields[i].slice(tag[0].length);
    if (tag[1] === "60F" || tag[1] === "60M") currency = /^[CD]\d{6}([A-Z]{3})/.exec(body)?.[1] ?? currency;
    if (tag[1] !== "61") continue;
    entry += 1;
    const m = LINE.exec(body);
    if (!m) {
      skipped.push({ line: entry, reason: "badAmount" });
      continue;
    }
    const value = validDate(m[1], m[2], m[3]);
    // The booking date has no year: it is the value date's year, or the neighbouring one across a year end.
    let booked: string | undefined;
    if (m[4] && value) {
      const gap = Number(m[4].slice(0, 2)) - Number(m[2]);
      const year = (Number(m[1]) + (gap > 6 ? 99 : gap < -6 ? 1 : 0)) % 100;
      booked = validDate(String(year).padStart(2, "0"), m[4].slice(0, 2), m[4].slice(2));
    }
    const date = booked ?? value;
    if (!date) {
      skipped.push({ line: entry, reason: "badDate" });
      continue;
    }
    const amount = parseAmount(m[6].replace(/,$/, ""));
    if (amount === undefined) {
      skipped.push({ line: entry, reason: "badAmount" });
      continue;
    }
    if (amount === 0) {
      skipped.push({ line: entry, reason: "zero" });
      continue;
    }
    if (currency !== "CHF") {
      skipped.push({ line: entry, reason: "foreignCurrency", currency });
      continue;
    }
    // C = credit, D = debit; RC reverses a credit (money out), RD reverses a debit (money back).
    const credit = m[5] === "C" || m[5] === "RD";
    const next = fields[i + 1] ?? "";
    const info = next.startsWith(":86:") ? information(next.slice(4)) : { text: "" };
    const supplementary = body.split("\n").slice(1).map((l) => l.trim()).filter(Boolean).join(" ");
    const customerRef = m[7].trim();
    const bankRef = (m[8] ?? "").trim();
    const parts = [info.counterparty, info.text, supplementary].filter((p): p is string => !!p);
    rows.push({
      line: entry,
      date,
      description: [...new Set(parts)].join(" · "),
      counterparty: info.counterparty,
      signed: round2(credit ? amount : -amount),
      currency,
      ref: bankRef || (customerRef && customerRef !== "NONREF" ? `${date}/${customerRef}` : undefined),
      ...(m[5].startsWith("R") ? { reversal: true } : {}),
    });
  }
  return { format: "mt940", profile: "mt940", rows, trades: [], skipped, notes: [] };
}
