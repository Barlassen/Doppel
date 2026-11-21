import type { Profile, Transaction } from "@/lib/finance/types";
import { translate } from "@/lib/i18n";
import type { Msg } from "@/lib/i18n/types";

/** Built-in event: English `label` (data for the LLM prompt) + translatable `labelMsg` for the UI. */
const labelled = (labelMsg: Msg) => ({ label: translate("en", labelMsg.key, labelMsg.params), labelMsg });

/** Seeded 3-month transaction history (Aug–Oct 2026) for the two fictional profiles. */
function buildTransactions(scale: number, heavyPayday: boolean): Transaction[] {
  const tx: Transaction[] = [];
  const months = ["2026-08", "2026-09", "2026-10"];
  let seed = 11;
  const r = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const d = (m: string, day: number) => `${m}-${String(day).padStart(2, "0")}`;
  const round = (x: number) => Math.round(x * 20) / 20;

  for (const m of months) {
    tx.push({ date: d(m, 1), merchant: "Rent", category: "housing", amount: round(2150 * scale) });
    tx.push({ date: d(m, 3), merchant: "Health insurance", category: "insurance", amount: round(412 * scale) });
    tx.push({ date: d(m, 5), merchant: "Mobile & internet", category: "bills", amount: 79.9 });
    tx.push({ date: d(m, 6), merchant: "Streaming video", category: "subscriptions", amount: 20.9 });
    tx.push({ date: d(m, 6), merchant: "Music streaming", category: "subscriptions", amount: 15.95 });
    tx.push({ date: d(m, 9), merchant: "Gym membership", category: "subscriptions", amount: 89 });
    tx.push({ date: d(m, 12), merchant: "Cloud storage", category: "subscriptions", amount: 9.9 });
    tx.push({ date: d(m, 2), merchant: "Half-fare + GA", category: "transport", amount: round(340 * scale) });

    for (let day = 1; day <= 30; day += 1) {
      if (day % 3 === 0) tx.push({ date: d(m, day), merchant: "Supermarket", category: "groceries", amount: round((38 + r() * 55) * scale) });
      const payday = day >= 25 || day <= 2;
      const p = payday && heavyPayday ? 0.6 : 0.3;
      if (r() < p) tx.push({ date: d(m, day), merchant: payday ? "Restaurant" : "Lunch", category: "dining", amount: round((payday ? 58 + r() * 90 : 19 + r() * 12) * scale) });
      if (payday && heavyPayday && r() < 0.2) tx.push({ date: d(m, day), merchant: "Online shop", category: "shopping", amount: round((60 + r() * 180) * scale) });
      if (!payday && r() < 0.06) tx.push({ date: d(m, day), merchant: "Online shop", category: "shopping", amount: round((30 + r() * 70) * scale) });
    }
  }
  return tx;
}

export const PROFILES: Profile[] = [
  {
    id: "lukas",
    name: "Lukas",
    age: 31,
    city: "Zürich",
    canton: "ZH",
    tagline: { key: "profile.lukas.tagline" },
    grossIncomeYear: 142_000,
    netIncomeMonth: 8_650,
    expensesMonth: 5_600,
    rentMonth: 2_150,
    cash: 64_000,
    portfolio: 38_000,
    pillar2: 72_000,
    pillar3a: 21_000,
    contributes3a: false,
    investShare: 0.5,
    marginalTaxRate: 0.27,
    riskProfile: "balanced",
    retirementAge: 65,
    goal: { label: { key: "profile.goal", params: { target: 1_400_000, age: 50 } }, target: 1_400_000, age: 50 },
    events: [
      { id: "ev-house", type: "house", ...labelled({ key: "event.flatIn", params: { place: "Winterthur" } }), month: 24, amount: 780_000, source: "profile" },
    ],
    transactions: buildTransactions(1, true),
    history: { soldInDrawdown: true, drawdownSellPct: 0.6 },
  },
  {
    id: "elena",
    name: "Elena",
    age: 44,
    city: "Genève",
    canton: "GE",
    tagline: { key: "profile.elena.tagline" },
    grossIncomeYear: 186_000,
    netIncomeMonth: 11_800,
    expensesMonth: 9_400,
    rentMonth: 3_300,
    cash: 48_000,
    portfolio: 210_000,
    pillar2: 310_000,
    pillar3a: 85_000,
    contributes3a: true,
    investShare: 0.6,
    marginalTaxRate: 0.33,
    riskProfile: "growth",
    retirementAge: 58,
    goal: { label: { key: "profile.goal", params: { target: 1_700_000, age: 58 } }, target: 1_700_000, age: 58 },
    events: [
      { id: "ev-uni", type: "expense", ...labelled({ key: "event.universityFor", params: { name: "Léa" } }), month: 66, amount: 60_000, source: "profile" },
    ],
    transactions: buildTransactions(1.45, false),
    history: { soldInDrawdown: false, drawdownSellPct: 0 },
  },
];
