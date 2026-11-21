/**
 * French (Swiss French / Romandie) 0-token what-if parser.
 *
 * Covers natural French phrasings (with or without diacritics, with elisions l’/d’/j’ and Swiss number formats):
 * - retire at N ("Prendre ma retraite à 60 ans", "Retraite anticipée à 62 ans", "Partir à la retraite à 60")
 * - invest N per month ("Investir 500 par mois", "J’investis CHF 1’200 par mois", "Placer 500.– chaque mois")
 * - switch risk profile ("Passer au profil croissance", "Stratégie équilibrée", "Portefeuille prudent")
 * - cut/increase spending ("Réduire mes dépenses de 400", "Dépenser 400 de moins par mois", "J’économise 400")
 * - max/start/stop pilier 3a ("Maximiser le pilier 3a", "Ouvrir un 3e pilier", "Arrêter le 3a")
 * - lose job for N months in YEAR ("Et si je perds mon emploi pendant 6 mois en 2028 ?", "6 mois de chômage en 2028")
 * - market crash ("Krach boursier l’année prochaine", "Effondrement des marchés l’an prochain")
 * - baby in YEAR ("Nous aurons un bébé en 2028", "Naissance d’un enfant en 2028")
 * - delay the home ("Reporter l’achat de l’appartement de 2 ans", "Décaler l’achat du logement de 6 mois")
 * - buy a home ("Acheter un appartement à Lausanne pour 1,2 million en 2028", "Acheter une maison pour 1,2 mio en 2028")
 */
import type { RiskProfile } from "@/lib/finance/types";
import type { Op } from "../actions";
import { AMOUNT, amountValue, eventLabel, largestAmountAbove, monthOfYear, normalizeText, yearIn, type IntentContext, type IntentParser } from "./shared";

const PER_MONTH = String.raw`(?:par|chaque|\/)\s*mois|mensuel\w*|tous\s+les\s+mois|p\.\s?m\.?`;
const re = (s: string) => new RegExp(s, "u");

/** Strip combining accents after NFD so accented and unaccented user input match the same patterns. */
function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function monthFrom(t: string, now: Date): number | undefined {
  const y = yearIn(t);
  if (y) return monthOfYear(y, now);
  const inYears = t.match(/\bdans\s+(\d+)\s+ans?\b/);
  if (inYears) return Number(inYears[1]) * 12;
  if (/\bdans\s+un\s+an\b/.test(t)) return 12;
  const inMonths = t.match(/\bdans\s+(\d+)\s+mois\b/);
  if (inMonths) return Number(inMonths[1]);
  if (/(?:l'an|l'annee)\s+prochaine?|\ban\s+prochain\b|\bannee\s+prochaine\b/.test(t)) return 12;
  return undefined;
}

function parse({ text, house, now }: IntentContext): Op[] {
  const normalized = normalizeText(text, "fr")
    .replace(/(\d),[-–—]{1,2}/g, "$1")
    .replace(/(?<![\p{L}])fr\.?(?![\p{L}])/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const t = foldAccents(normalized);
  const when = monthFrom(t, now);
  const ops: Op[] = [];

  // prendre ma retraite à 60 ans / retraite anticipée à 62 ans / partir à la retraite à 60 / à 63 ans à la retraite
  const retire =
    t.match(/(?:retraite|retraite\s+anticipee|pension|(?:arret|cess)\w*\s+de\s+travailler)\D{0,30}?(?<!\p{L})(?:a|des|vers)\s+(?<!\d)(\d{2})(?!\d)(?:\s*ans)?\b/u) ??
    t.match(/(?<!\p{L})(?:a|des|vers)\s+(?<!\d)(\d{2})(?!\d)\s*ans\D{0,25}?(?:retraite|pension|(?:arret|cess)\w*\s+de\s+travailler)/u);
  if (retire) ops.push({ op: "set", key: "retirementAge", value: Number(retire[1]) });

  // investir 500 par mois / j'investis 1'200 par mois / placer 300 chaque mois / ordre permanent de 500 par mois
  if (/(?:^|[\s'])(?:invest|plac|ordre\s+permanent|plan\s+d'epargne|virement\s+permanent)/.test(t)) {
    const m =
      t.match(re(`${AMOUNT}\\s*(?:(?:de\\s+|supplementaire\\w*\\s+|en\\s+plus\\s+)?(?:${PER_MONTH}))`)) ??
      t.match(re(`(?:${PER_MONTH})\\s+(?:(?:j')?invest\\w*\\s+|plac\\w*\\s+|de\\s+|d')?${AMOUNT}`));
    if (m) ops.push({ op: "set", key: "monthlyInvest", value: amountValue(m[1], m[2]) });
    else if (/(liquidites?|cash|argent\s+(?:qui\s+dort|inactif|dormant)|epargne\s+(?:inutilisee|dormante|qui\s+dort))/.test(t))
      ops.push({ op: "set", key: "optimize", value: true });
  } else if (/faire\s+travailler\s+(?:mon\s+|l'|mes\s+)?(?:argent|cash|epargne|liquidites?)/.test(t)) {
    ops.push({ op: "set", key: "optimize", value: true });
  }

  // passer au profil croissance / profil prudent / stratégie équilibrée / portefeuille dynamique
  if (/(profil|strategie|portefeuille|passer|passe\b|changer|change\b|adopter|invest|plac|risque|plus|moins|devenir|opter|basculer|mode)/.test(t)) {
    const w = t.match(/(conservat|defensi|prudent|plus\s+sur|securitaire|moins\s+de\s+risque|equilibr|balanc|moder|croissance|dynamique|agressi|offensi|audacieux)/);
    if (w) {
      const value: RiskProfile = /equilibr|balanc|moder/.test(w[1])
        ? "balanced"
        : /croissance|dynamique|agressi|offensi|audacieux/.test(w[1])
          ? "growth"
          : "conservative";
      ops.push({ op: "set", key: "riskProfile", value });
    }
  }

  // réduire mes dépenses de 400 / dépenser 400 de moins par mois / j'économise 400 / baisser mon budget de 400
  const cut =
    t.match(re(`(?<!d')(?:redui\\w*|baiss\\w*|diminu\\w*|coup\\w*|economis\\w*|comprim\\w*)\\s+(?:mes\\s+|les\\s+|nos\\s+|mon\\s+|le\\s+|notre\\s+)?(?:depenses?\\s+|couts?\\s+|frais\\s+|charges?\\s+|budget\\s+|train\\s+de\\s+vie\\s+)?(?:de\\s+|d')?${AMOUNT}`)) ??
    t.match(re(`depenser\\s+${AMOUNT}\\s*(?:(?:${PER_MONTH})\\s*)?(?:de\\s+|en\\s+)?moins`)) ??
    t.match(re(`depenser\\s+(?:de\\s+|en\\s+)?moins\\s+(?:de\\s+|d')?${AMOUNT}`)) ??
    t.match(re(`${AMOUNT}\\s*(?:(?:${PER_MONTH})\\s*)?(?:de\\s+|en\\s+)?moins\\s+(?:de\\s+|en\\s+)?(?:depenses?|frais|charges?)`));
  const more = t.match(re(`depenser\\s+${AMOUNT}\\s*(?:(?:${PER_MONTH})\\s*)?(?:de\\s+|en\\s+)?plus`));
  if (cut) ops.push({ op: "set", key: "expenseDelta", value: -amountValue(cut[1], cut[2]) });
  else if (more) ops.push({ op: "set", key: "expenseDelta", value: amountValue(more[1], more[2]) });

  // maximiser le 3a / commencer le pilier 3a / ouvrir un 3e pilier / arrêter le 3a
  if (/\b3a\b|pilier\s*3|3e\s+pilier|3eme\s+pilier|troisieme\s+pilier/.test(t)) {
    if (/(arret|stop|suspend|plus\s+(?:de\s+|cotiser\s+au\s+)?(?:pilier\s*)?3|ne\s+plus|desactiv|coup|abandonn|sans\s+(?:pilier\s*)?3)/.test(t))
      ops.push({ op: "set", key: "contributes3a", value: false });
    else if (/(maxim|max\b|plafonn|commenc|debut|ouvr|vers|cotis|utilis|rempli|plein|activ|aliment|mett)/.test(t))
      ops.push({ op: "set", key: "contributes3a", value: true });
  }

  // repousser l'achat de 2 ans / reporter l'appartement de 6 mois / décaler l'achat du logement de 6 mois / acheter 6 mois plus tard
  const delay =
    t.match(/(?:repouss|report|retard|decal|differ|attend)\S*\D{0,45}?(\d+)\s*(ans?|annees?|mois)\b/) ??
    t.match(/(?:achet\w*|achat|appart\w*|maison|logement|immobilier)\D{0,30}?(\d+)\s*(ans?|annees?|mois)\s+plus\s+tard\b/);
  if (delay && house) ops.push({ op: "shift", id: house.id, months: Number(delay[1]) * (delay[2].startsWith("mois") ? 1 : 12) });

  // acheter un appartement à Lausanne pour 1,2 mio / acheter une maison pour 1,2 million en 2028
  if (/(?:^|[\s'])(?:achet|achat|acquerir|acquisition)/.test(t) && /(maison|appartement|appart\b|logement|bien|propriete|villa|studio|duplex|chalet)/.test(t)) {
    const price = largestAmountAbove(t, 50_000);
    if (price) {
      const where = text.match(/(?<!\p{L})(?:à|a|en)\s+(?!(?:CHF|SFr|Fr|Mio|Millions?)\b)([A-ZÄÖÜÉÈÀÂÎÏÔÙÛÇ][\p{L}-]+)/u);
      const label = eventLabel(where ? { key: "event.homeIn", params: { place: where[1] } } : { key: "event.home" });
      ops.push({ op: "add", type: "house", ...label, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // perdre mon emploi / perte d'emploi / chômage / licencié / tomber au chômage
  if (/(perd|perte)\S*\s+(?:de\s+|d'|mon\s+|ma\s+|son\s+|sa\s+|notre\s+|l'|un\s+)?(?:emploi|travail|job|poste|place|boulot)|chomage|licenci|sans\s+emploi|sans\s+travail/.test(t)) {
    const dur = t.match(/(\d+)\s*mois/);
    ops.push({ op: "add", type: "jobloss", ...eventLabel({ key: "event.jobLoss" }), month: when ?? 12, amount: 0, duration: dur ? Number(dur[1]) : 6 });
  }

  // krach boursier / effondrement des marchés / chute de la bourse / récession
  if (/krach|crash|effondrement|chute\s+(?:des\s+marches|de\s+la\s+bourse|boursiere)|baisse\s+(?:des\s+marches|de\s+la\s+bourse)|crise\s+boursiere|recession/.test(t)) {
    ops.push({ op: "add", type: "crash", ...eventLabel({ key: "event.crash" }), month: when ?? 12, amount: 0 });
  }

  // un bébé / un enfant / naissance
  if (/\b(bebe|enfant|naissance|enceinte)\b/.test(t)) {
    ops.push({ op: "add", type: "child", ...eventLabel({ key: "event.baby" }), month: when ?? 18, amount: 1500, duration: 216 });
  }

  // augmentation de 10k
  const raise = t.match(re(`(augmentation|promotion|hausse\\s+de\\s+salaire)\\D{0,25}${AMOUNT}`));
  if (raise) ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount: amountValue(raise[2], raise[3]) });

  return ops;
}

export const frenchIntents: IntentParser = { locale: "fr", parse };
