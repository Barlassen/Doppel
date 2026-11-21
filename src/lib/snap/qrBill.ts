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

export function parseQrBill(raw: string): QrBill | null {
  const l = raw.replace(/\r\n/g, "\n").split("\n");
  if (l[0] !== "SPC" || !/^02\d{2}$/.test(l[1] ?? "") || l[2] !== "1" || l[30] !== "EPD") return null;
  const structured = l[4] === "S";
  const amount = l[18] ? Number(l[18]) : undefined;
  return {
    iban: l[3] ?? "",
    creditor: {
      name: l[5] ?? "",
      postcode: structured ? l[8] ?? "" : "",
      town: structured ? l[9] ?? "" : l[7] ?? "",
      country: l[10] ?? "",
    },
    amount: isAmount(amount) ? amount : undefined,
    currency: l[19] ?? "CHF",
    debtorName: l[21] || undefined,
    referenceType: l[27] ?? "NON",
    reference: l[28] ?? "",
    message: l[29] ?? "",
    billingInfo: l[31] ?? "",
  };
}

export function qrBillToExtraction(b: QrBill): Extraction {
  const insurance = /kranken|versicherung|assurance|insurance/i.test(b.creditor.name + b.message);
  return {
    kind: "bill",
    amount: b.currency === "CHF" ? b.amount : undefined,
    merchant: b.creditor.name,
    location: b.creditor.town,
    category: insurance ? "insurance" : "bills",
    label: b.message || `Bill from ${b.creditor.name}`,
    iban: b.iban,
    message: b.message,
  };
}
