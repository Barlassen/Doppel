/**
 * Twin persona check: prints the persona of the three built-in accounts and three UBS synthetic profiles and
 * asserts the invariants of `twinPersona()`. Run: `npx tsx scripts/persona-check.ts`.
 */
import { PROFILES } from "../src/lib/data/profiles";
import type { Profile } from "../src/lib/finance/types";
import { translateText } from "../src/lib/i18n";
import { HEALTH_IDS, twinPersona, type TwinPersona } from "../src/lib/twin/persona";
import { ALEXIA_ID, listUbsProfiles, loadUbsProfile } from "../src/lib/ubs";

let failed = 0;
function check(ok: boolean, label: string) {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}

function nonFinite(v: unknown, path = ""): string[] {
  if (typeof v === "number") return Number.isFinite(v) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => nonFinite(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => nonFinite(x, path ? `${path}.${k}` : k));
  return [];
}

const en = (m: Parameters<typeof translateText>[1]) => translateText("en", m);
const chf = (n: number) => `CHF ${Math.round(n).toLocaleString("en-US")}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function print(p: Profile, t: TwinPersona) {
  const i = t.identity;
  console.log(`\n${i.name}, ${i.age} · ${i.city} (${i.canton}) · ${en(i.stageLabel)} · ${en(i.householdLabel)} [${i.householdProvenance}]`);
  const m = t.money;
  console.log(
    `  month: take-home ${chf(m.takeHome.value)} [${m.takeHome.provenance}] · fixed ${chf(m.fixedCosts.value)} [${m.fixedCosts.provenance}] · free ${chf(m.freeCash.value)} · saved ${chf(m.saved.value)} (${pct(m.savingRate)}) [${m.saved.provenance}] · invested ${chf(m.invested.value)} [${m.invested.provenance}]`,
  );
  const b = t.balance;
  console.log(
    `  balance: cash ${chf(b.cash.value)} · investments ${chf(b.investments.value)} · pillar 2 ${chf(b.pillar2.value)} · pillar 3a ${chf(b.pillar3a.value)} · debt ${chf(b.debt.value)} · net worth ${chf(b.netWorth)}`,
  );
  console.log(`  health: ${t.health.score}/${t.health.max}`);
  for (const c of t.health.components) {
    console.log(
      `    ${String(c.points).padStart(2)}/${c.max} ${en(c.label).padEnd(21)} ${en(c.reading).padEnd(30)} [${c.provenance}; benchmark: ${c.sourced ? "sourced" : "rule of thumb"} = ${en(c.benchmarkSource)}]`,
    );
  }
  console.log(`  traits: ${t.traits.map((x) => `${en(x.label)} (${en(x.evidence)})`).join(" · ") || "none (no statements)"}`);
  const q = t.dataQuality;
  console.log(`  knows you: observed ${pct(q.observed)} · entered ${pct(q.entered)} · assumed ${pct(q.assumed)} of ${q.fields} inputs · missing: ${q.missing.map((x) => en(x.label)).join(", ") || "nothing"}`);

  check(t.health.components.reduce((s, c) => s + c.points, 0) === t.health.score, "components sum to the score");
  check(t.health.components.length === 5 && HEALTH_IDS.every((id, k) => t.health.components[k].id === id), "five components in order");
  check(t.health.components.every((c) => Number.isInteger(c.points) && c.points >= 0 && c.points <= 20), "each component is an integer 0–20");
  check(t.health.score >= 0 && t.health.score <= 100, "score within 0–100");
  const bad = nonFinite(t);
  check(bad.length === 0, `all values finite${bad.length ? `: ${bad.join(", ")}` : ""}`);
  check(Math.abs(q.observed + q.entered + q.assumed - 1) < 1e-9 && [q.observed, q.entered, q.assumed].every((x) => x >= 0), "shares sum to 1");
  check(Math.abs(b.netWorth - (b.cash.value + b.investments.value + b.pillar2.value + b.pillar3a.value - b.debt.value)) < 1e-6, "net worth = assets − debt");
  check(Math.abs(m.freeCash.value - (m.takeHome.value - m.fixedCosts.value)) < 1e-6, "free cash = take-home − fixed costs");
  check(t.traits.every((x) => en(x.label).split(/\s+/).length <= 3), "trait labels ≤ 3 words");
  if (p.transactions.length === 0) {
    check(t.health.components.every((c) => c.provenance !== "derived"), "no component is derived without transactions");
    check(t.traits.length === 0, "no traits without statements");
    check(q.observed === 0 && q.missing[0]?.id === "statement", "nothing observed; the statement is the top missing input");
  } else {
    check(t.traits.length > 0, "traits observed from the statements");
    check(q.observed > 0, "some inputs observed");
  }
}

async function main() {
  console.log("Twin persona check");
  const personas = new Map<string, TwinPersona>();
  for (const p of PROFILES) {
    const t = twinPersona(p);
    personas.set(p.id, t);
    print(p, t);
  }

  const all = listUbsProfiles();
  const ids = [ALEXIA_ID, all.find((s) => s.debtChf > 0 && s.id !== ALEXIA_ID)?.id, all.find((s) => s.employment === "retired")?.id].filter((x): x is string => !!x);
  check(ids.length === 3, "three UBS profiles picked (Alexia, one with debt, one retired)");
  for (const id of ids) {
    const p = await loadUbsProfile(id);
    print(p, twinPersona(p));
  }

  console.log("\nAcross accounts");
  const barlas = personas.get("barlas")!;
  const oktay = personas.get("oktay")!;
  check(barlas.health.score > oktay.health.score, `the on-track account (Barlas, ${barlas.health.score}) scores higher than the off-track one (Oktay, ${oktay.health.score})`);
  const again = twinPersona(PROFILES[0]);
  check(JSON.stringify(again) === JSON.stringify(barlas), "deterministic: same input, same persona");

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll persona checks passed");
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
