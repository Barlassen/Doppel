/**
 * French (Swiss French) what-if patterns — first draft.
 * "Prendre ma retraite à 60 ans", "Investir 500 par mois", "Réduire mes dépenses de 400",
 * "Maximiser le 3a", "Et si je perds mon emploi pendant 6 mois en 2028 ?", "Krach boursier l'an prochain",
 * "Nous avons un bébé en 2028", "Repousser l'achat de l'appartement de 2 ans",
 * "Acheter un appartement à Lausanne pour 1,2 mio".
 */
import type { RiskProfile } from "@/lib/finance/types";
import type { Op } from "../actions";
import { AMOUNT, amountValue, eventLabel, largestAmountAbove, monthOfYear, normalizeText, yearIn, type IntentContext, type IntentParser } from "./shared";

const PER_MONTH = String.raw`(?:par|chaque|\/)\s*mois|mensuel\w*|tous\s+les\s+mois|p\.\s?m\.?`;
const re = (s: string) => new RegExp(s, "u");

function monthFrom(t: string, now: Date): number | undefined {
  const y = yearIn(t);
  if (y) return monthOfYear(y, now);
  const inYears = t.match(/\bdans\s+(\d+)\s+ans?\b/);
  if (inYears) return Number(inYears[1]) * 12;
  const inMonths = t.match(/\bdans\s+(\d+)\s+mois/);
  if (inMonths) return Number(inMonths[1]);
  if (/(l'an|l'année)\s+prochaine?|an\s+prochain|année\s+prochaine/.test(t)) return 12;
  return undefined;
}

function parse({ text, house, now }: IntentContext): Op[] {
  const t = normalizeText(text, "fr");
  const when = monthFrom(t, now);
  const ops: Op[] = [];

  // prendre ma retraite à 60 ans / retraite anticipée à 62 ans / à 63 ans à la retraite
  const retire =
    t.match(/(?:retraite|retraité|pension)\D{0,25}?(?<!\p{L})(?:à|a|dès)\s+(\d{2})\s*ans\b/u) ??
    t.match(/(?<!\p{L})(?:à|a|dès)\s+(\d{2})\s*ans\D{0,20}?(?:retraite|pension)/u);
  if (retire) ops.push({ op: "set", key: "retirementAge", value: Number(retire[1]) });

  // investir 500 par mois / placer 300 chaque mois
  if (/invest|placer|place\b|ordre\s+permanent|plan\s+d'épargne/.test(t)) {
    const m = t.match(re(`${AMOUNT}\\s*(?:(?:de\\s+)?(?:${PER_MONTH}))`)) ?? t.match(re(`(?:${PER_MONTH})\\s+${AMOUNT}`));
    if (m) ops.push({ op: "set", key: "monthlyInvest", value: amountValue(m[1], m[2]) });
    else if (/(liquidités|cash|argent\s+(?:qui\s+dort|inactif|dormant)|épargne\s+(?:inutilisée|dormante))/.test(t))
      ops.push({ op: "set", key: "optimize", value: true });
  }

  // passer en croissance / profil prudent / stratégie équilibrée
  if (/(profil|stratégie|portefeuille|passer|changer|invest|placer|risque|plus|devenir)/.test(t)) {
    const w = t.match(/(conservat|défensi|prudent|plus\s+sûr|sécuritaire|équilibr|croissance|dynamique|agressi|offensi)/);
    if (w) {
      const value: RiskProfile = /équilibr/.test(w[1]) ? "balanced" : /croissance|dynamique|agressi|offensi/.test(w[1]) ? "growth" : "conservative";
      ops.push({ op: "set", key: "riskProfile", value });
    }
  }

  // réduire mes dépenses de 400 / dépenser 300 de moins par mois / économiser 200 / dépenser 200 de plus
  const cut =
    t.match(re(`(?:réduire|réduis|baisser|baisse|diminuer|diminue|couper|coupe|économiser|économise)\\s+(?:mes\\s+|les\\s+|nos\\s+)?(?:dépenses\\s+|coûts\\s+|frais\\s+|budget\\s+)?(?:de\\s+)?${AMOUNT}`)) ??
    t.match(re(`dépenser\\s+${AMOUNT}\\s*(?:(?:${PER_MONTH})\\s*)?(?:de\\s+)?moins`));
  const more = t.match(re(`dépenser\\s+${AMOUNT}\\s*(?:(?:${PER_MONTH})\\s*)?(?:de\\s+)?plus`));
  if (cut) ops.push({ op: "set", key: "expenseDelta", value: -amountValue(cut[1], cut[2]) });
  else if (more) ops.push({ op: "set", key: "expenseDelta", value: amountValue(more[1], more[2]) });

  // maximiser le 3a / commencer le pilier 3a / arrêter le 3a
  if (/\b3a\b|pilier\s*3|3e\s+pilier|troisième\s+pilier/.test(t)) {
    if (/(arrêt|stop|suspend|plus\s+de\s+3a|ne\s+plus)/.test(t)) ops.push({ op: "set", key: "contributes3a", value: false });
    else if (/(maxim|commenc|ouvr|vers|cotis|utilis|rempli|plein)/.test(t)) ops.push({ op: "set", key: "contributes3a", value: true });
  }

  // repousser l'achat de 2 ans / reporter l'appartement de 6 mois
  const delay = t.match(/(repouss|report|retard|décal|attend)\S*\D{0,40}?(\d+)\s*(ans?|années?|mois)\b/);
  if (delay && house) ops.push({ op: "shift", id: house.id, months: Number(delay[2]) * (delay[3].startsWith("mois") ? 1 : 12) });

  // acheter un appartement à Lausanne pour 1,2 mio
  if (/(achet|achat|acquérir|acquisition)/.test(t) && /(maison|appartement|appart|logement|bien|propriété|villa)/.test(t)) {
    const price = largestAmountAbove(t, 50_000);
    if (price) {
      const where = text.match(/(?<!\p{L})(?:à|a|en)\s+([A-ZÄÖÜÉÈ][\p{L}-]+)/u);
      const label = eventLabel(where ? { key: "event.homeIn", params: { place: where[1] } } : { key: "event.home" });
      ops.push({ op: "add", type: "house", ...label, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // perdre mon emploi / perte d'emploi / chômage / licencié
  if (/(perd|perte)\S*\s+(?:de\s+|d'|mon\s+|ma\s+|l')?(?:emploi|travail|job|poste|place)|chômage|licenci|sans\s+emploi/.test(t)) {
    const dur = t.match(/(\d+)\s*mois/);
    ops.push({ op: "add", type: "jobloss", ...eventLabel({ key: "event.jobLoss" }), month: when ?? 12, amount: 0, duration: dur ? Number(dur[1]) : 6 });
  }

  // krach boursier / effondrement des marchés / récession
  if (/krach|crash|effondrement|chute\s+(?:des\s+marchés|de\s+la\s+bourse|boursière)|récession/.test(t)) {
    ops.push({ op: "add", type: "crash", ...eventLabel({ key: "event.crash" }), month: when ?? 12, amount: 0 });
  }

  // un bébé / un enfant / naissance
  if (/\b(bébé|enfant|naissance|enceinte)/.test(t)) {
    ops.push({ op: "add", type: "child", ...eventLabel({ key: "event.baby" }), month: when ?? 18, amount: 1500, duration: 216 });
  }

  // augmentation de 10k
  const raise = t.match(re(`(augmentation|promotion)\\D{0,25}${AMOUNT}`));
  if (raise) ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount: amountValue(raise[2], raise[3]) });

  return ops;
}

export const frenchIntents: IntentParser = { locale: "fr", parse };
