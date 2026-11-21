import { MERCHANT_CATEGORIES } from "@/lib/data/merchants";
import type { TransactionCategory } from "@/lib/finance/types";
import { merchantKey, normalizeMerchant } from "./text";
import type { CategorySource, RowKind, StatementRow } from "./types";

/**
 * Frugal categorisation, step 1: local rules at 0 tokens.
 *   1. the account's own corrections (merchant → category overrides)
 *   2. the merchant dictionary (`MERCHANT_CATEGORIES` in src/lib/data/merchants.ts)
 *   3. keyword rules in DE / FR / IT / EN, in order (specific before generic: "Migros Take Away" → dining before
 *      "Migros" → groceries, "Uber Eats" before "Uber")
 * Salary credits are income and transfers between own accounts (incl. top-ups of the user's broker / 3a / card
 * accounts, whose trades come from the broker statement) are excluded from spending.
 * Only what is still unresolved goes to the small model, as unique names in one batch (see `categorizeModel.ts`).
 */

const DICTIONARY = new Map(Object.entries(MERCHANT_CATEGORIES).map(([name, c]) => [merchantKey(name), c]));

const KEYWORDS: readonly [RegExp, TransactionCategory][] = [
  [/\b(?:uber ?eats|just ?eat|eat\.ch|smood|deliveroo|take ?away|takeaway|lieferando|dominos?|mcdonald'?s?|burger ?king|starbucks|kfc|subway)\b/, "dining"],
  [/\b(?:restaurant|ristorante|resto|pizzeria|trattoria|osteria|cafe|caffe|kaffee|coffee|bistro|brasserie|bar|pub|kebab|doner|sushi|ramen|mensa|kantine|cantine|mensa|imbiss|baeckerei|backerei|bakery|boulangerie|confiserie|tea room|burger|grill|gelateria|glace)\b/, "dining"],
  [/\b(?:migros|coop|denner|aldi|lidl|volg|spar|landi|globus delicatessa|manor food|primo|topcc|prodega|alnatura|bio ?markt|farmy|migrolino|avec|k kiosk|kiosk|supermarket|supermarche|supermercato|lebensmittel|alimentation)\b/, "groceries"],
  [/\b(?:sbb|cff|ffs|zvv|vbz|tl|tpg|bls|bvb|bernmobil|tnw|mobilis|unireso|libero|passepartout|postauto|car postal|autopostale|taxi|uber|bolt|parking|parkhaus|parkuhr|tankstelle|station service|avia|migrol|socar|tamoil|eni|shell|bp|mobility|publibike|lime|halbtax|half fare|demi tarif|generalabonnement|ga|vignette|velo|bike)\b/, "transport"],
  [/\b(?:krankenkasse|krankenversicherung|caisse maladie|cassa malati|assurance|assurances|versicherung|assicurazione|insurance|praemie|pramie|prime lamal|css|helsana|swica|sanitas|concordia|visana|kpt|groupe mutuel|assura|sympany|atupri|okk|egk|axa|mobiliar|baloise|allianz|generali|helvetia|vaudoise|smile direct)\b/, "insurance"],
  [/\b(?:miete|mietzins|wohnungsmiete|loyer|affitto|rent|nebenkosten|charges locatives|verwaltung|regie|immobilien|liegenschaft|hausverwaltung)\b/, "housing"],
  [/\b(?:netflix|spotify|disney|apple music|apple com bill|icloud|google storage|google one|youtube|prime video|amazon prime|sky|dazn|audible|xbox|playstation|nintendo|steam|fitness|gym|fitnesscenter|abo|abonnement|patreon|openai|chatgpt|adobe|microsoft 365|dropbox|zattoo|teleboy|wilmaa)\b/, "subscriptions"],
  [/\b(?:swisscom|salt|sunrise|upc|wingo|yallo|m budget mobile|quickline|init7|teleboy|ewz|ekz|bkw|ckw|axpo|iwb|sig|groupe e|romande energie|energie|strom|electricite|elektrizitat|wasserwerk|gasversorgung|serafe|billag|steuern|steueramt|impots|tasse|gebuhr|gebuhren)\b/, "bills"],
  [/\b(?:booking com|booking|airbnb|expedia|hotels? com|hotel|hostel|easyjet|swiss international|swiss com|lufthansa|edelweiss|ryanair|wizz|klm|air france|flixbus|trainline|sbb international|railjet)\b/, "travel"],
  [/\b(?:galaxus|digitec|zalando|manor|h ?& ?m|zara|uniqlo|ikea|decathlon|interdiscount|media ?markt|fust|ochsner|jumbo|hornbach|bauhaus|amazon|aliexpress|temu|shein|sephora|douglas|apotheke|pharmacie|farmacia|amavita|sun ?store|coop city|loeb|globus|pfister|brack|ricardo|tutti|sportxx|do it|micasa|apple store|fnac|orell fussli|thalia|kletterzentrum|bouldern)\b/, "shopping"],
];

/** Credits that are pay: Lohn, Salär, Gehalt, salaire, stipendio, salary, payroll. */
const SALARY = /(?:lohn|salar|salaer|gehalt|salaire|traitement|stipendio|salario|salary|payroll|wages|maas)/;
/** Money between the user's own accounts (savings, card account top-ups, own broker / 3a / Revolut / neon). */
const OWN_TRANSFER =
  /(?:ubertrag|uebertrag|kontoubertrag|umbuchung|eigenes konto|eigene konten|own account|between (?:your|own) accounts|compte propre|propre compte|virement interne|giroconto|sparkonto|savings|epargne|top ?up|aufladung|recharge|ricarica|\bviac\b|frankly|finpension|swissquote|interactive brokers|\bibkr\b|true wealth|selma|saxo|yuh invest|neon invest|inyova|descartes|revolut|\bneon\b|\byuh\b)/;
/** TWINT person-to-person payments ("TWINT an Max Muster", "TWINT von …", "TWINT à …"). */
const TWINT_P2P = /twint\s*(?:p2p|an|von|to|from|a|de|send|sent|received|empfangen|gesendet|geld senden|money)\b/;
const TRANSFER_TYPES = /^(?:topup|top-up|transfer|exchange|invest|invest_order|bank_auto_order|savings|vault|pocket)/i;

export interface Classified {
  merchant: string;
  kind: RowKind;
  category?: TransactionCategory;
  source?: CategorySource;
}

/** The merchant shown and stored: the counterparty column when the file has one, else the cleaned booking text. */
export function merchantOf(row: Pick<StatementRow, "description" | "counterparty">): string {
  const first = row.counterparty || row.description.split(" · ")[0] || row.description;
  return normalizeMerchant(first).slice(0, 80);
}

/** Dictionary and keyword rules only. */
export function ruleCategory(merchant: string): { category: TransactionCategory; source: CategorySource } | undefined {
  const key = merchantKey(merchant);
  const hit = DICTIONARY.get(key);
  if (hit) return { category: hit, source: "dictionary" };
  for (const [re, category] of KEYWORDS) if (re.test(key)) return { category, source: "keyword" };
}

/**
 * One row → merchant, kind and (when local rules know) category. `overrides` are the account's corrections, keyed by
 * `merchantKey(merchant)`.
 */
export function classifyRow(row: StatementRow, overrides: Readonly<Record<string, TransactionCategory>> = {}): Classified {
  const merchant = merchantOf(row);
  const raw = merchantKey(`${row.description} ${row.counterparty ?? ""}`);
  if ((row.type && TRANSFER_TYPES.test(row.type)) || TWINT_P2P.test(raw) || OWN_TRANSFER.test(raw)) return { merchant, kind: "transfer" };
  const override = overrides[merchantKey(merchant)];
  const rule = override ? { category: override, source: "override" as const } : ruleCategory(merchant);
  if (row.signed > 0) {
    if (SALARY.test(raw)) return { merchant, kind: "income" };
    return rule ? { merchant, kind: "refund", ...rule } : { merchant, kind: "income" };
  }
  return { merchant, kind: "spend", ...rule };
}
