/**
 * Converts the UBS LauzHack 2026 synthetic starter data (`data/ubs/*.csv|json`) into compact TypeScript modules in
 * `src/lib/ubs/generated/`, so the browser never parses CSV:
 *
 *   meta.ts         as-of date and the goal-name / priority tables shared by summary and details
 *   summary.ts      all 1'200 profiles as compact rows (search + picker), with lookup tables for repeated strings
 *   details-NN.ts   full detail of 100 profiles each (cash, portfolio, income, rent, liabilities, goals),
 *                   loaded on demand by `loadUbsProfile()` through `chunks.ts` (one dynamic import per chunk)
 *   catalog.ts      the 120-scenario catalog
 *   assumptions.ts  scenario-assumptions.csv (S001 only in the starter data)
 *   alexia.ts       alexia-profile.json + scenario_config.json
 *
 * Run: npm run ubs:build   (the output is committed; rerun only when data/ubs changes)
 * The script fails on inconsistent input (cash in profiles ≠ accounts ≠ assets, unknown profile ids, NaN).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DetailRow, SummaryRow } from "../src/lib/ubs/types";

const ROOT = resolve(__dirname, "..");
const DATA = resolve(ROOT, "data/ubs");
const OUT = resolve(ROOT, "src/lib/ubs/generated");
const CHUNK_SIZE = 100;

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r, n) => {
    if (r.length !== header.length) throw new Error(`Row ${n + 2} has ${r.length} fields, expected ${header.length}`);
    return Object.fromEntries(header.map((h, i) => [h, r[i]]));
  });
}

const read = (file: string) => parseCsv(readFileSync(resolve(DATA, file), "utf8"));
function num(v: string, what: string): number {
  const x = Number(v);
  if (v.trim() === "" || !Number.isFinite(x)) throw new Error(`Not a number: ${what} = "${v}"`);
  return x;
}
const idNumber = (id: string) => {
  const m = /^P(\d{5})$/.exec(id);
  if (!m) throw new Error(`Unexpected profile id ${id}`);
  return Number(m[1]);
};
/** Rounds to cents and drops float noise, so the generated numbers match the CSV text. */
const cents = (x: number) => Math.round(x * 100) / 100;

const profiles = read("synthetic-profiles.csv");
const accounts = read("synthetic-accounts.csv");
const assets = read("synthetic-assets.csv");
const liabilities = read("synthetic-liabilities.csv");
const goals = read("synthetic-goals.csv");
const catalog = read("scenario-catalog.csv");
const assumptions = read("scenario-assumptions.csv");

// ---------------- validation + joins ----------------

const byId = new Map(profiles.map((p) => [p.profile_id, p]));
if (byId.size !== profiles.length) throw new Error("Duplicate profile ids");
const asOfDates = new Set(profiles.map((p) => p.as_of_date));
if (asOfDates.size !== 1) throw new Error(`Expected one as-of date, got ${[...asOfDates].join(", ")}`);
const AS_OF = [...asOfDates][0];

const known = (pid: string, file: string) => {
  if (!byId.has(pid)) throw new Error(`${file}: unknown profile ${pid}`);
};

const cashAccount = new Map<string, number>();
for (const a of accounts) {
  known(a.profile_id, "accounts");
  if (a.account_type !== "cash") throw new Error(`accounts: unexpected type ${a.account_type}`);
  if (a.currency !== "CHF") throw new Error("accounts: non-CHF account");
  cashAccount.set(a.profile_id, (cashAccount.get(a.profile_id) ?? 0) + num(a.opening_balance_chf, a.account_id));
}

const assetSum = new Map<string, { cash: number; investments: number; other: number }>();
for (const a of assets) {
  known(a.profile_id, "assets");
  if (a.currency !== "CHF") throw new Error("assets: non-CHF asset");
  const s = assetSum.get(a.profile_id) ?? { cash: 0, investments: 0, other: 0 };
  const v = num(a.value_chf, a.asset_id);
  if (a.asset_type === "cash") s.cash += v;
  else if (a.asset_type === "investment_portfolio") s.investments += v;
  else s.other += v;
  assetSum.set(a.profile_id, s);
}

const liabByProfile = new Map<string, DetailRow[11]>();
for (const l of liabilities) {
  known(l.profile_id, "liabilities");
  if (l.currency !== "CHF") throw new Error("liabilities: non-CHF loan");
  const list = liabByProfile.get(l.profile_id) ?? [];
  const suffix = l.liability_id.replace(`L-${l.profile_id}-`, "");
  list.push([suffix, l.liability_type, num(l.opening_principal_chf, l.liability_id), num(l.annual_interest_rate, l.liability_id), num(l.monthly_payment_chf, l.liability_id)]);
  liabByProfile.set(l.profile_id, list);
}

const GOAL_NAMES = [...new Set(goals.map((g) => g.goal_name))].sort();
const PRIORITIES = ["high", "medium", "low"];
const goalsByProfile = new Map<string, DetailRow[12]>();
for (const g of goals) {
  known(g.profile_id, "goals");
  if (g.currency !== "CHF") throw new Error("goals: non-CHF goal");
  const prio = PRIORITIES.indexOf(g.priority);
  if (prio < 0) throw new Error(`goals: unknown priority ${g.priority}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.target_date)) throw new Error(`goals: bad date ${g.target_date}`);
  const list = goalsByProfile.get(g.profile_id) ?? [];
  list.push([g.goal_id.replace(`G-${g.profile_id}-`, ""), GOAL_NAMES.indexOf(g.goal_name), num(g.target_amount_chf, g.goal_id), g.target_date, prio]);
  goalsByProfile.set(g.profile_id, list);
}

const table = (values: string[]) => [...new Set(values)].sort();
const CITIES = table(profiles.map((p) => p.city));
const CANTONS = table(profiles.map((p) => p.canton));
const EMPLOYMENTS = table(profiles.map((p) => p.employment_status));
const HOUSEHOLDS = table(profiles.map((p) => p.household_type));

const summary: SummaryRow[] = [];
const details = new Map<number, Record<string, DetailRow>>();
let warnings = 0;
for (const p of [...profiles].sort((a, b) => idNumber(a.profile_id) - idNumber(b.profile_id))) {
  const id = p.profile_id;
  if (p.currency !== "CHF" || p.country !== "CH") throw new Error(`${id}: not a Swiss CHF profile`);
  const cash = num(p.opening_cash_chf, `${id} cash`);
  const a = assetSum.get(id) ?? { cash: 0, investments: 0, other: 0 };
  if (Math.abs(a.cash - cash) > 0.005) throw new Error(`${id}: cash asset ${a.cash} ≠ profile cash ${cash}`);
  if (cashAccount.has(id) && Math.abs(cashAccount.get(id)! - cash) > 0.005) throw new Error(`${id}: cash account ≠ profile cash`);
  if (!cashAccount.has(id)) warnings++;
  const loans = liabByProfile.get(id) ?? [];
  const debt = loans.reduce((s, l) => s + l[2], 0);
  const gs = (goalsByProfile.get(id) ?? []).sort((x, y) => x[0].localeCompare(y[0]));
  const n = idNumber(id);
  summary.push([
    n,
    p.display_name,
    num(p.age_at_start, `${id} age`),
    CITIES.indexOf(p.city),
    CANTONS.indexOf(p.canton),
    EMPLOYMENTS.indexOf(p.employment_status),
    HOUSEHOLDS.indexOf(p.household_type),
    cents(cash + a.investments + a.other - debt),
    cents(debt),
    gs.length,
  ]);
  const chunk = Math.floor((n - 1) / CHUNK_SIZE);
  const rows = details.get(chunk) ?? {};
  rows[id] = [
    p.display_name,
    num(p.age_at_start, `${id} age`),
    p.city,
    p.canton,
    p.employment_status,
    p.household_type,
    cents(cash),
    cents(a.investments),
    cents(a.other),
    num(p.reference_monthly_net_income_chf, `${id} income`),
    num(p.reference_monthly_rent_chf, `${id} rent`),
    loans,
    gs,
  ];
  details.set(chunk, rows);
}

// ---------------- write ----------------

const HEADER = "// Generated by scripts/build-ubs-data.ts from data/ubs (UBS LauzHack 2026 synthetic data, fictional). Do not edit.\n";
const json = (v: unknown) => JSON.stringify(v);
mkdirSync(OUT, { recursive: true });
const write = (name: string, body: string) => {
  writeFileSync(resolve(OUT, name), HEADER + body);
  return Buffer.byteLength(HEADER + body);
};

const sizes: Record<string, number> = {};
sizes["meta.ts"] = write(
  "meta.ts",
  `/** As-of date of every UBS balance sheet (= month 0 in Doppel). */
export const AS_OF = ${json(AS_OF)};
export const GOAL_NAMES: readonly string[] = ${json(GOAL_NAMES)};
export const PRIORITIES: readonly string[] = ${json(PRIORITIES)};
`,
);
sizes["summary.ts"] = write(
  "summary.ts",
  `import type { SummaryRow } from "../types";

export { AS_OF } from "./meta";
export const CITIES: readonly string[] = ${json(CITIES)};
export const CANTONS: readonly string[] = ${json(CANTONS)};
export const EMPLOYMENTS: readonly string[] = ${json(EMPLOYMENTS)};
export const HOUSEHOLDS: readonly string[] = ${json(HOUSEHOLDS)};
/** [number, name, age, city, canton, employment, household, UBS net worth, debt, goal count] */
export const ROWS: readonly SummaryRow[] = ${json(summary)};
`,
);

const chunkIds = [...details.keys()].sort((a, b) => a - b);
for (const c of chunkIds) {
  const name = `details-${String(c).padStart(2, "0")}.ts`;
  sizes[name] = write(
    name,
    `import type { DetailRow } from "../types";

/** [name, age, city, canton, employment, household, cash, investments, other assets, net income/mo, rent/mo, liabilities, goals] */
const ROWS: Readonly<Record<string, DetailRow>> = ${json(details.get(c))};
export default ROWS;
`,
  );
}
sizes["chunks.ts"] = write(
  "chunks.ts",
  `import type { DetailRow } from "../types";

export const CHUNK_SIZE = ${CHUNK_SIZE};
/** One dynamic import per chunk of ${CHUNK_SIZE} profiles (P00001–P00100 → 0, …). */
export const CHUNKS: readonly (() => Promise<{ default: Readonly<Record<string, DetailRow>> }>)[] = [
${chunkIds.map((c) => `  () => import("./details-${String(c).padStart(2, "0")}"),`).join("\n")}
];
`,
);

const scen = catalog.map((r) => [r.id, r.category, r.scenario, r.baseline, r.intervention, r.example_metrics]);
sizes["catalog.ts"] = write(
  "catalog.ts",
  `/** [id, category, scenario, baseline, intervention, metrics] */
export const CATALOG: readonly [string, string, string, string, string, string][] = ${json(scen)};
`,
);

const strings = table(assumptions.flatMap((a) => [a.parameter, a.unit, a.frequency, a.source_type, a.notes]));
const asRows = assumptions.map((a) => {
  known(a.profile_id, "assumptions");
  return [
    a.assumption_id,
    a.scenario_id,
    a.profile_id,
    strings.indexOf(a.parameter),
    num(a.value, a.assumption_id),
    strings.indexOf(a.unit),
    strings.indexOf(a.frequency),
    strings.indexOf(a.source_type),
    strings.indexOf(a.notes),
  ];
});
sizes["assumptions.ts"] = write(
  "assumptions.ts",
  `export const STRINGS: readonly string[] = ${json(strings)};
/** [id, scenario, profile, parameter, value, unit, frequency, source type, notes] — string fields index STRINGS. */
export const ASSUMPTIONS: readonly [string, string, string, number, number, number, number, number, number][] = ${json(asRows)};
`,
);

const alexiaProfile = JSON.parse(readFileSync(resolve(DATA, "alexia-profile.json"), "utf8"));
const config = JSON.parse(readFileSync(resolve(DATA, "scenario_config.json"), "utf8")) as {
  note: string;
  scenarios: { name: string; phases: Record<string, number>[]; one_off_costs: Record<string, number>[] }[];
};
const paths = config.scenarios.map((s) => ({
  name: s.name,
  phases: s.phases.map((p) => ({
    startMonth: p.start_month,
    endMonth: p.end_month,
    monthlyIncomeChf: p.monthly_income_chf,
    monthlyExpensesChf: p.monthly_expenses_chf,
  })),
  oneOffCosts: s.one_off_costs.map((o) => ({ month: o.month, amountChf: o.amount_chf })),
}));
sizes["alexia.ts"] = write(
  "alexia.ts",
  `import type { AlexiaPath } from "../types";

export const ALEXIA_PROFILE = ${json(alexiaProfile)} as const;
export const ALEXIA_CONFIG_NOTE = ${json(config.note)};
export const ALEXIA_PATHS: readonly AlexiaPath[] = ${json(paths)};
`,
);

const total = Object.values(sizes).reduce((s, x) => s + x, 0);
console.log(`UBS data → ${OUT}`);
console.log(`  ${summary.length} profiles (as of ${AS_OF}), ${liabilities.length} liabilities, ${goals.length} goals, ${catalog.length} scenarios, ${assumptions.length} assumptions, ${paths.length} Alexia paths`);
console.log(`  ${chunkIds.length} detail chunks of ${CHUNK_SIZE}; profiles without a cash account row: ${warnings}`);
for (const [name, size] of Object.entries(sizes)) console.log(`  ${name.padEnd(16)} ${(size / 1024).toFixed(1)} KB`);
console.log(`  total ${(total / 1024).toFixed(1)} KB (raw, before minification and gzip)`);
