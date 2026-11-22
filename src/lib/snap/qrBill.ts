import { translateText } from "@/lib/i18n";
import { msg } from "@/lib/i18n/types";
import { isSwissIban } from "./heuristics";
import { isAmount, type Extraction } from "./types";

/**
 * Parses a Swiss QR-bill payload (SIX Implementation Guidelines v2.x).
 * The QR code carries everything we need — amount, creditor, reference — so this tier
 * costs zero tokens and takes a few milliseconds.
 */
export interface QrBill {
  iban: string;
  creditor: { name: string; postcode: string; town: string; country: string };
  amount?: number;
  currency: string;
  debtorName?: string;
  referenceType: string;
  reference: string;
  message: string;
  billingInfo: string;
}

const REFERENCE_TYPES = ["QRR", "SCOR", "NON"] as const;
const MOD10_TABLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

/** QR reference: 27 digits, the last one a recursive modulo-10 check digit. */
export function isQrReference(reference: string): boolean {
  if (!/^\d{27}$/.test(reference)) return false;
  let carry = 0;
  for (const digit of reference.slice(0, 26)) carry = MOD10_TABLE[(carry + Number(digit)) % 10];
  return (10 - carry) % 10 === Number(reference[26]);
}

/** Creditor reference (ISO 11649): "RF", two check digits, up to 21 letters or digits, modulo 97. */
export function isCreditorReference(reference: string): boolean {
  const ref = reference.replace(/\s+/g, "").toUpperCase();
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(ref)) return false;
  let remainder = 0;
  for (const c of ref.slice(4) + ref.slice(0, 4)) {
    for (const digit of /\d/.test(c) ? c : String(c.charCodeAt(0) - 55)) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** A QR-IBAN carries an institution id (IID) between 30000 and 31999 and is only valid with a QR reference. */
const isQrIban = (iban: string) => {
  const iid = Number(iban.slice(4, 9));
  return iid >= 30000 && iid <= 31999;
};

/**
 * Reads the payload only when it is a well-formed QR-bill: header, a CH / LI IBAN with correct check digits,
 * an amount in the spec's format (digits, at most two decimals, at most 999'999'999.99), CHF or EUR, and a
 * reference that fits its type and the IBAN. Anything else returns null and the cascade reads the document by OCR
 * instead of trusting a 0-token decode of a malformed payment part.
 */
export function parseQrBill(raw: string): QrBill | null {
  const l = raw.replace(/\r\n?/g, "\n").split("\n");
  if (l[0] !== "SPC" || !/^02\d{2}$/.test(l[1] ?? "") || l[2] !== "1" || l[30] !== "EPD") return null;
  const iban = (l[3] ?? "").replace(/\s+/g, "").toUpperCase();
  const amountText = l[18] ?? "";
  const currency = l[19] ?? "";
  const referenceType = l[27] ?? "";
  const reference = (l[28] ?? "").replace(/\s+/g, "");
  if (!isSwissIban(iban) || !/^(?:CHF|EUR)$/.test(currency)) return null;
  if (amountText !== "" && !/^\d{1,9}(?:\.\d{1,2})?$/.test(amountText)) return null;
  if (!(REFERENCE_TYPES as readonly string[]).includes(referenceType)) return null;
  if (referenceType === "QRR" ? !isQrIban(iban) || !isQrReference(reference) : isQrIban(iban)) return null;
  if (referenceType === "SCOR" && !isCreditorReference(reference)) return null;
  if (referenceType === "NON" && reference !== "") return null;
  const structured = l[4] === "S";
  const amount = amountText ? Number(amountText) : undefined;
  return {
    iban,
    creditor: {
      name: l[5] ?? "",
      postcode: structured ? l[8] ?? "" : "",
      town: structured ? l[9] ?? "" : l[7] ?? "",
      country: l[10] ?? "",
    },
    amount: isAmount(amount) ? amount : undefined,
    currency,
    debtorName: l[21] || undefined,
    referenceType,
    reference,
    message: l[29] ?? "",
    billingInfo: l[31] ?? "",
  };
}

export function qrBillToExtraction(b: QrBill): Extraction {
  const insurance = /kranken|versicherung|assurance|insurance/i.test(b.creditor.name + b.message);
  const labelMsg = msg("summary.billFrom", { merchant: b.creditor.name });
  return {
    kind: "bill",
    amount: b.currency === "CHF" ? b.amount : undefined,
    merchant: b.creditor.name,
    location: b.creditor.town,
    category: insurance ? "insurance" : "bills",
    ...(b.message ? { label: b.message } : { label: translateText("en", labelMsg), labelMsg }),
    iban: b.iban,
    message: b.message,
  };
}
