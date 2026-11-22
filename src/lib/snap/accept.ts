import { billTotal, isSwissIban } from "./heuristics";
import { receiptAddsUp } from "./receipt";
import { isAmount, type Extraction, type SnapResult } from "./types";

/**
 * When a local (0-token) reading is final, and when a result may be cached. Pure, so the rules are checked in
 * scripts/api-check.ts without a browser.
 */

export const LOCAL_ACCEPT_CONFIDENCE = 80;

/**
 * A regex reading of the OCR text is accepted without a model call when the document checks itself:
 *  - receipt: the line items add up to the printed total. OCR confidence alone is not enough: a clean read of
 *    "20% Rabatt 4.00" can still carry the wrong sign.
 *  - bill: confident OCR, the amount stands on a total line, and the IBAN passes its check digits.
 *  - payslip / listing: confident OCR, an amount and a second field (employer, date, rooms or place).
 * Notes never qualify: they are handwriting, and an OCR slip in a handwritten amount has nothing to check against.
 */
export function canAcceptLocalExtraction(local: Extraction, ocrConfidence: number, text: string, payslipText = false): boolean {
  if (local.kind === "receipt") return !payslipText && receiptAddsUp(local);
  if (ocrConfidence < LOCAL_ACCEPT_CONFIDENCE || !isAmount(local.amount)) return false;
  if (local.kind === "bill") return Boolean(local.iban && isSwissIban(local.iban)) && billTotal(text).strong;
  if (local.kind === "note" || local.kind === "other") return false;
  return Boolean(local.merchant || local.rooms || local.location || local.date);
}

/**
 * Only results of a path that ran as designed are cached. The offline heuristic is the fallback for a missing or
 * failing model: caching it would replay the weaker reading after a key is configured or the provider recovers.
 */
export function shouldCache(route: SnapResult["route"], outcome: SnapResult["outcome"]): boolean {
  return outcome === "ok" && route !== "cache" && route !== "offline-heuristic";
}
