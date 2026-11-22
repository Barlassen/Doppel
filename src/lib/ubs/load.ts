/**
 * Loads one UBS profile on demand: one dynamic import of the chunk that holds it (100 profiles, ~10 KB), then the
 * pure mapping to a Doppel `Profile`. The accounts store imports only this module, so the 1'200-row search summary
 * stays out of the main bundle.
 */
import type { Profile } from "@/lib/finance/types";
import { CHUNKS, CHUNK_SIZE } from "./generated/chunks";
import { AS_OF, GOAL_NAMES, PRIORITIES } from "./generated/meta";
import { mapUbsProfile } from "./map";
import type { DetailRow, UbsGoalRow, UbsRawProfile } from "./types";

export const isUbsId = (id: string) => /^P\d{5}$/.test(id);

function chunkOf(id: string): number {
  if (!isUbsId(id)) throw new Error(`Not a UBS profile id: ${id}`);
  return Math.floor((Number(id.slice(1)) - 1) / CHUNK_SIZE);
}

export function rawFromRow(id: string, r: DetailRow): UbsRawProfile {
  const [name, age, city, canton, employment, household, cash, investments, other, net, rent, loans, goals] = r;
  return {
    id,
    name,
    age,
    city,
    canton,
    employment,
    household,
    asOf: AS_OF,
    cashChf: cash,
    investmentsChf: investments,
    otherAssetsChf: other,
    monthlyNetIncomeChf: net,
    monthlyRentChf: rent,
    liabilities: loans.map(([suffix, type, principal, rate, payment]) => ({
      id: `L-${id}-${suffix}`,
      type,
      principalChf: principal,
      annualRate: rate,
      monthlyPaymentChf: payment,
    })),
    goals: goals.map(([suffix, nameIdx, target, date, prio]) => ({
      id: `G-${id}-${suffix}`,
      name: GOAL_NAMES[nameIdx],
      targetChf: target,
      targetDate: date,
      priority: PRIORITIES[prio] as UbsGoalRow["priority"],
    })),
  };
}

/** The starter data's own record for `id`, before Doppel fills any gap. */
export async function loadUbsRaw(id: string): Promise<UbsRawProfile> {
  const chunk = CHUNKS[chunkOf(id)];
  if (!chunk) throw new Error(`Unknown UBS profile: ${id}`);
  const rows = (await chunk()).default;
  const row = rows[id];
  if (!row) throw new Error(`Unknown UBS profile: ${id}`);
  return rawFromRow(id, row);
}

const cache = new Map<string, Promise<Profile>>();

/** Full Doppel profile of a UBS synthetic person, every field labelled with its provenance. A fresh copy per call. */
export function loadUbsProfile(id: string): Promise<Profile> {
  let p = cache.get(id);
  if (!p) {
    p = loadUbsRaw(id).then(mapUbsProfile);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p.then((profile) => structuredClone(profile));
}
