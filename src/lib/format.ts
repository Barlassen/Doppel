/** Typographic minus (U+2212), the one sign for every negative number on screen. */
export const MINUS = "−";

/**
 * Swiss thousands grouping with the typographic apostrophe (1’362’649).
 * Deterministic on purpose: Node and browsers disagree on de-CH (' vs ’), which breaks hydration.
 */
export function groupCh(n: number): string {
  const neg = n < 0;
  const [int, dec] = Math.abs(n).toString().split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "’");
  return `${neg ? MINUS : ""}${grouped}${dec ? "." + dec : ""}`;
}

/** "CHF 1’234"; negatives put the sign first, like `chfSigned`: "−CHF 1’234". */
export const chf = (n: number) => {
  const r = Math.round(n);
  return `${r < 0 ? MINUS : ""}CHF ${groupCh(Math.abs(r))}`;
};

const ISO_DAY = /^(\d{4})-(\d\d)-(\d\d)/;
/** ISO yyyy-mm-dd → Swiss numeric date "31.10.2026" (the same in every UI language). Other text is returned as is. */
export function dateCh(iso: string): string {
  const m = ISO_DAY.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}
/** ISO yyyy-mm-dd → "31.10." for rows that already sit under a month heading. */
export function dayMonthCh(iso: string): string {
  const m = ISO_DAY.exec(iso);
  return m ? `${m[3]}.${m[2]}.` : iso;
}

export function receiptMoney(amount: number, currency = "CHF"): string {
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".");
  return currency + " " + (amount < 0 ? "−" : "") + groupCh(Number(whole)) + "." + cents;
}

export const chfShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 2)}M`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}k`;
  return `${Math.round(n)}`;
};

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export const usd = (x: number) => (x === 0 ? "$0" : x < 0.001 ? `$${x.toFixed(6)}` : `$${x.toFixed(4)}`);
