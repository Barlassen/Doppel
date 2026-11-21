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
import { AMOUNT, amountValue, eventLabel, largestAmountAbove, monthOfYear, normalizeText, type IntentContext, type IntentParser } from "./shared";

const PER_MONTH = String.raw`(?:(?:par|chaque|\/|tous\s+les)\s*mois\b|mensuel\w*\b|p\.\s?m\.?)`;
const DATED_YEAR = /(?:^|\b(?:en|vers|pour|debut|fin)\s+|\bd'ici\s+)(20[2-6]\d)\b/;
const HOME = /\b(?:maison|appart(?:ement)?|logement|bien|propriete|villa|studio|duplex|chalet|immobilier)\b/;
const RISK_WORDS = "conservat\\w*|defensi\\w*|prudent\\w*|securitaire|plus sur|moins (?:de risques?|d'actions)|equilibr\\w*|moder\\w*|croissance|dynamique\\w*|agressi\\w*|offensi\\w*|audacieu\\w*|plus (?:de risques?|d'actions)";
const SPENDING = "depenses?|couts?|frais(?: fixes)?|charges?(?: fixes)?|budget|train de vie";
const re = (s: string) => new RegExp(s, "u");

/** Strip combining accents after NFD so accented and unaccented user input match the same patterns. */
function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function monthFrom(t: string, now: Date): number | undefined {
  const year = t.match(DATED_YEAR);
  if (year) return monthOfYear(Number(year[1]), now);
  const inYears = t.match(/\bdans\s+(\d+)\s+ans?\b/);
  if (inYears) return Number(inYears[1]) * 12;
  if (/\bdans\s+un\s+an\b/.test(t)) return 12;
  const inMonths = t.match(/\bdans\s+(\d+)\s+mois\b/);
  if (inMonths) return Number(inMonths[1]);
  if (/\b(?:an prochain|annee prochaine)\b/.test(t)) return 12;
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
    t.match(/\b(?:retraite|pension|(?:arret|cess)\w*\s+de\s+(?:travailler|bosser))\D{0,30}?\b(?:a|des|vers)\s+(\d{2})\b/) ??
    t.match(/\b(?:a|des|vers)\s+(\d{2})\s*ans\b\D{0,25}?\b(?:retraite|pension|(?:arret|cess)\w*\s+de\s+(?:travailler|bosser))/);
  if (retire) ops.push({ op: "set", key: "retirementAge", value: Number(retire[1]) });

  // investir 500 par mois / j'investis 1'200 par mois / placer 300 chaque mois / ordre permanent de 500 par mois
  if (/\b(?:invest\w*|plac(?:e\w*|ai\w*|ons)|ordre\s+permanent|plan\s+d'epargne|virement\s+permanent|dans\s+(?:un\s+|des\s+)?(?:etfs?|fonds))\b/.test(t)) {
    const m =
      t.match(re(String.raw`${AMOUNT}\s*(?:(?:de|supplementaires?|en plus)\s+)?${PER_MONTH}`)) ??
      t.match(re(String.raw`${PER_MONTH}[,\s]+(?:(?:(?:je|on|nous)\s+|j')?(?:invest|plac|vers|mett|met)\w*\s+|de\s+|d')?${AMOUNT}`));
    if (m) ops.push({ op: "set", key: "monthlyInvest", value: amountValue(m[1], m[2]) });
    else if (/(liquidites?|cash|argent\s+(?:qui\s+dort|inactif|dormant)|epargne\s+(?:inutilisee|dormante|qui\s+dort))/.test(t))
      ops.push({ op: "set", key: "optimize", value: true });
  } else if (/faire\s+travailler\s+(?:mon\s+|l'|mes\s+)?(?:argent|cash|epargne|liquidites?)/.test(t)) {
    ops.push({ op: "set", key: "optimize", value: true });
  }

  // passer au profil croissance / profil prudent / stratégie équilibrée / portefeuille dynamique
  if (/\b(?:profil|strategie|portefeuille|risques?|mode)\b|\b(?:pass|chang|adopt|invest|opt|bascul|deven|placer)\w*\b/.test(t)) {
    const w = t.match(re(String.raw`\b(?:au|a|sur|pour)\s+(?:(?:un|une|le|la)\s+)?(?:(?:profil|strategie|portefeuille)\s+)?(${RISK_WORDS})\b`))
      ?? t.match(re(String.raw`\b(${RISK_WORDS})\b`));
    if (w) {
      const value: RiskProfile = /equilibr|moder/.test(w[1])
        ? "balanced"
        : /croissance|dynamique|agressi|offensi|audacieu|^plus (?:de ris|d'actions)/.test(w[1])
          ? "growth"
          : "conservative";
      ops.push({ op: "set", key: "riskProfile", value });
    }
  }

  // réduire mes dépenses de 400 / dépenser 400 de moins par mois / j'économise 400 / baisser mon budget de 400
  const cut =
    t.match(re(String.raw`(?<!d')\b(?:redui|baiss|diminu|coup|economis|comprim)\w*\s+(?:(?:mes|les|nos|mon|le|notre)\s+)?(?:(?:${SPENDING})\s+)?(?:de\s+|d')?${AMOUNT}`)) ??
    t.match(re(String.raw`\bdepens\w*\s+${AMOUNT}\s*(?:${PER_MONTH}\s*)?(?:de\s+|en\s+)?moins\b`)) ??
    t.match(re(String.raw`\bdepens\w*\s+(?:de\s+|en\s+)?moins\s+(?:de\s+|d')?${AMOUNT}`)) ??
    t.match(re(String.raw`${AMOUNT}\s*(?:${PER_MONTH}\s*)?(?:de\s+|en\s+)?moins\s+(?:de\s+|en\s+)?(?:${SPENDING})\b`));
  const more = t.match(re(String.raw`\bdepens\w*\s+${AMOUNT}\s*(?:${PER_MONTH}\s*)?(?:de\s+|en\s+)?plus\b`));
  if (cut) ops.push({ op: "set", key: "expenseDelta", value: -amountValue(cut[1], cut[2]) });
  else if (more) ops.push({ op: "set", key: "expenseDelta", value: amountValue(more[1], more[2]) });

  // maximiser le 3a / commencer le pilier 3a / ouvrir un 3e pilier / arrêter le 3a
  if (/\b(?:3a|pilier\s*3a?|3e(?:me)?\s+pilier|troisieme\s+pilier)\b/.test(t)) {
    if (/\b(?:arret|stop|suspend|sist|desactiv|coup|abandonn)\w*\b|\b(?:ne|n')\s*[^.!?]{0,30}?\bplus\b|\b(?:plus (?:rien|de versements?|de 3a|cotiser)|sans (?:pilier )?3a)\b/.test(t))
      ops.push({ op: "set", key: "contributes3a", value: false });
    else if (/\b(?:max\w*|plafonn\w*|commenc\w*|debut\w*|ouvr\w*|vers\w*|cotis\w*|utilis\w*|rempli\w*|plein|activ\w*|aliment\w*|mets|mett\w*)\b/.test(t))
      ops.push({ op: "set", key: "contributes3a", value: true });
  }

  // repousser l'achat de 2 ans / reporter l'appartement de 6 mois / décaler l'achat du logement de 6 mois / acheter 6 mois plus tard
  const delay =
    t.match(/(?:repouss|report|retard|decal|differ|attend)\S*\D{0,45}?(\d+)\s*(ans?|annees?|mois)\b/) ??
    t.match(/(?:achet\w*|achat|appart\w*|maison|logement|immobilier)\D{0,30}?(\d+)\s*(ans?|annees?|mois)\s+plus\s+tard\b/);
  if (delay && house && (HOME.test(t) || /\bl'achat\b/.test(t))) {
    ops.push({ op: "shift", id: house.id, months: Number(delay[1]) * (delay[2].startsWith("mois") ? 1 : 12) });
  }

  // acheter un appartement à Lausanne pour 1,2 mio / acheter une maison pour 1,2 million en 2028
  if (!delay && /\b(?:achet\w*|achat|acquerir|acquisition)\b/.test(t) && HOME.test(t)) {
    const priced = [...t.matchAll(new RegExp(String.raw`\b(?:pour|au prix de|au prix d')\s*${AMOUNT}`, "gu"))]
      .find(([, value, unit]) => amountValue(value, unit) >= 50_000);
    const price = priced ? amountValue(priced[1], priced[2]) : largestAmountAbove(t.split(/\b(?:hypotheque|budget|fonds propres|apport)\b/, 1)[0], 49_999);
    if (price) {
      const place = text.match(/\b(?:maison|appart(?:ement)?|logement|bien|propri[eé]t[eé]|villa|studio|duplex|chalet)\s+(?:à|a|en)\s+((?:(?:La|Le|Les|Saint|St\.)\s+)?[\p{L}’'-]+)/iu)?.[1];
      const label = eventLabel(place && /^\p{Lu}/u.test(place) ? { key: "event.homeIn", params: { place } } : { key: "event.home" });
      ops.push({ op: "add", type: "house", ...label, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // perdre mon emploi / perte d'emploi / chômage / licencié / tomber au chômage
  if (/\b(?:perd|perte)\w*\s+(?:de\s+|d'|mon\s+|ma\s+|son\s+|sa\s+|notre\s+|l'|un\s+)?(?:emploi|travail|job|poste|place|boulot)\b|\b(?:chomage|licenci\w*|sans\s+(?:emploi|travail|boulot))\b/.test(t)) {
    const dur = t.match(/\b(?:pendant|pour|durant)\s+(\d+)\s*mois\b/) ?? t.match(/(?<!dans )\b(\d+)\s*mois\b/);
    ops.push({ op: "add", type: "jobloss", ...eventLabel({ key: "event.jobLoss" }), month: when ?? 12, amount: 0, duration: dur ? Number(dur[1]) : 6 });
  }

  // krach boursier / effondrement des marchés / chute de la bourse / récession
  if (/\b(?:krach|crash|recession|crise boursiere)\b|\b(?:effondrement|chute|baisse)\s+(?:des marches|de la bourse|boursiere)\b|\b(?:bourse|marches)\s+(?:s'effondr|chut|degringol|decroch)\w*\b/.test(t)) {
    ops.push({ op: "add", type: "crash", ...eventLabel({ key: "event.crash" }), month: when ?? 12, amount: 0 });
  }

  // un bébé / un enfant / naissance
  if (/^bebe\b|\benceinte\b|\bnaissance\s+d'\w+\s+(?:enfant|bebe)\b|\b(?:avoir|a|aur\w*|attend\w*)\s+(?:(?:un|une|notre)\s+)?(?:autre\s+)?(?:enfant|bebe)\b|\bbebe\s+arriv\w*\b|\bdev(?:en|ien)\w*\s+parents?\b/.test(t)) {
    ops.push({ op: "add", type: "child", ...eventLabel({ key: "event.baby" }), month: when ?? 18, amount: 1500, duration: 216 });
  }

  // The engine uses annual gross income. Convert explicit monthly amounts.
  const pay = t.replace(DATED_YEAR, " ");
  const raise =
    pay.match(re(String.raw`\b(?:augmentation|promotion|hausse\s+de\s+salaire|salaire\s+augment\w*)\s+(?:de salaire\s+)?(?:de\s+|d')${AMOUNT}`)) ??
    pay.match(re(String.raw`\bgagn\w*\s+${AMOUNT}\s*(?:bruts?\s+)?de plus\b`));
  if (raise) {
    const cadence = pay.slice(raise.index! + raise[0].length);
    if (!/^\s*(?:%|nets?\b)/.test(cadence) && !/\bsalaire net\b/.test(pay)) {
      const multiplier = re(String.raw`^\s*(?:bruts?\s+)?${PER_MONTH}`).test(cadence) ? 12 : 1;
      const amount = amountValue(raise[1], raise[2]) * multiplier;
      ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount });
    }
  }

  return ops;
}

export const frenchIntents: IntentParser = { locale: "fr", parse };
