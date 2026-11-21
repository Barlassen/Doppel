export const chf = (n: number) => `CHF ${Math.round(n).toLocaleString("de-CH")}`;

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
