import type { Extraction } from "./types";

/**
 * Offline fallback when no API key is configured: regex-based extraction from OCR text.
 * Less flexible than the LLM, but keeps the demo working with zero network.
 */
const NUM = /(\d{1,3}(?:['’ .]\d{3})+|\d+)(?:[.,](\d{2}))?/;

function parseChf(s: string): number | undefined {
  const m = s.match(NUM);
  if (!m) return undefined;
  const n = Number(m[1].replace(/['’ .]/g, "") + (m[2] ? `.${m[2]}` : ""));
  return Number.isFinite(n) ? n : undefined;
}

export function heuristicExtract(text: string): Extraction {
  const t = text.replace(/\r/g, "");
  const lower = t.toLowerCase();

  if (/zimmer|rooms|kaufpreis|wohnung|eigentum|for sale|zu verkaufen|m²|m2/.test(lower)) {
    const priceLine = t.split("\n").find((l) => /chf|kaufpreis|preis|price/i.test(l) && /\d{3}/.test(l));
    const rooms = lower.match(/(\d(?:[.,]5)?)\s*(?:-?\s*zimmer|rooms|zi\.)/);
    const loc = t.match(/\b(\d{4})\s+([A-ZÄÖÜ][\wäöüé-]+(?:[- ][A-ZÄÖÜ][\wäöüé-]+)?)/);
    return {
      kind: "listing",
      amount: priceLine ? parseChf(priceLine.replace(/^[^\d]*/, "")) : undefined,
      rooms: rooms ? Number(rooms[1].replace(",", ".")) : undefined,
      location: loc ? loc[2] : undefined,
      label: "Home from listing",
    };
  }

  if (/\b(total|summe|bar|karte|mwst|vat)\b/.test(lower)) {
    const totalLine = t.split("\n").find((l) => /total|summe/i.test(l));
    const date = t.match(/(\d{2})[./](\d{2})[./](\d{2,4})/);
    const firstLine = t.split("\n").find((l) => /[A-Za-z]{3}/.test(l));
    return {
      kind: "receipt",
      amount: totalLine ? parseChf(totalLine.replace(/^[^\d]*/, "")) : undefined,
      merchant: firstLine?.trim(),
      date: date ? `${date[3].length === 2 ? "20" + date[3] : date[3]}-${date[2]}-${date[1]}` : undefined,
      category: /restaurant|café|cafe|bar /.test(lower) ? "dining" : "groceries",
      label: "Receipt",
    };
  }

  if (/lohn|salary|payslip|nettolohn|net pay/.test(lower)) {
    const net = t.split("\n").find((l) => /netto|net pay|auszahlung/i.test(l));
    return { kind: "payslip", amount: net ? parseChf(net.replace(/^[^\d]*/, "")) : undefined, label: "Payslip" };
  }

  const amt = t.match(/(\d+)\s*k\b/i);
  const year = t.match(/20\d\d/);
  return {
    kind: "note",
    amount: amt ? Number(amt[1]) * 1000 : parseChf(t),
    year: year ? Number(year[0]) : undefined,
    label: t.split("\n")[0]?.slice(0, 40) || "Note",
  };
}
