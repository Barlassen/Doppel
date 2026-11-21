/**
 * Swiss thousands grouping with the typographic apostrophe (1’362’649).
 * Deterministic on purpose: Node and browsers disagree on de-CH (' vs ’), which breaks hydration.
 */
export function groupCh(n: number): string {
  const neg = n < 0;
  const [int, dec] = Math.abs(n).toString().split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "’");
  return `${neg ? "-" : ""}${grouped}${dec ? "." + dec : ""}`;
}

export const chf = (n: number) => `CHF ${groupCh(Math.round(n))}`;

export const chfShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 2)}M`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}k`;
  return `${Math.round(n)}`;
};

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export const usd = (x: number) => (x === 0 ? "$0" : x < 0.001 ? `$${x.toFixed(6)}` : `$${x.toFixed(4)}`);

export const monthToLabel = (month: number, age: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + month);
  return `${d.toLocaleString("en", { month: "short" })} ${d.getFullYear()} · age ${age + Math.floor(month / 12)}`;
};
