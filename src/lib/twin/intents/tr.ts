/**
 * Turkish what-if patterns (0 tokens).
 *
 * The text is lower-cased with Turkish rules, number formats are normalised by `normalizeText`
 * ("1'200", "1’200", "1 200", "1.200", "500.–", "CHF 500", "500 frank"), and then folded to ASCII
 * (ı/i, ş/s, ğ/g, ç/c, ö/o, ü/u), so "yaşında" and "yasinda", "İşimi" and "ISIMI" read the same.
 * Suffixes after numbers are dropped with or without an apostrophe ("2028'de", "2028’de",
 * "2028de", "60'ta", "500'ü", "1,2 milyona"), and small number words become digits
 * ("altı ay", "iki yıl", "altmış beş", "bir buçuk milyon", "yarım yıl").
 *
 * Examples: "60 yaşında emekli olsam" · "erken emeklilik 62" · "Ayda 500 CHF yatırsam" ·
 * "Agresif portföye geç" · "Harcamaları 400 azalt" · "Ayda 400 daha az harca" · "3a'yı doldur" ·
 * "2028'de 6 ay işsiz kalırsam?" · "Seneye borsa çökerse" · "2028'de bebeğimiz olursa" ·
 * "Ev alımını 2 yıl ertelesem" · "2028'de 1,2 milyona daire al" · "Bern'de 900 bine ev satın al".
 */
import type { RiskProfile } from "@/lib/finance/types";
import type { Op } from "../actions";
import { lifeOps, type LifeVocab } from "./life";
import { AMOUNT, amountValue, eventLabel, largestAmountAbove, monthOfYear, normalizeText, yearIn, type IntentContext, type IntentParser } from "./shared";

const re = (s: string) => new RegExp(s, "u");
/** Whole-word guards for the folded text (`\b` is ASCII-only, the folded text may keep é, ä …). */
const W = String.raw`(?<![\p{L}\d])`;
const E = String.raw`(?![\p{L}\d])`;

/** An amount that is not a percentage ("%10") or the tail of another number. */
const AMT = String.raw`(?<![%\d.,])${AMOUNT}`;
const PER_MONTH = String.raw`(?:ayda|aylik(?:\s+olarak)?|her\s+ay|ay\s+basi|\/\s*ay${E})`;
/** Placeholder for pillar 3a after normalisation ("3a'yı", "3. sütun", "bireysel emeklilik"). */
const PILLAR = "sutunuc";

const FOLD: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ç: "c", ö: "o", ü: "u", â: "a", î: "i", û: "u", ä: "a", é: "e", è: "e", ê: "e" };
const fold = (t: string) => t.replace(/[ışğçöüâîûäéèê]/g, (c) => FOLD[c]);

const UNITS: Record<string, number> = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9 };
const TENS: Record<string, number> = { on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90 };
/** Words after which "bir" and "on" are numbers, not "a" or "ön/on". */
const COUNTED = /^(yil\p{L}*|sene\p{L}*|ay|aylik|bin|milyon\p{L}*|bucuk|yas\p{L}*)$/u;

/** "altı ay" → "6 ay", "altmış beş yaşında" → "65 yaşında", "bir buçuk milyon" → "1.5 milyon", "yarım yıl" → "0.5 yıl". */
function numberWords(t: string): string {
  const words = t.split(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1] ?? "";
    if (w === "yarim" && COUNTED.test(next)) {
      out.push("0.5");
      continue;
    }
    const isNumber = (word: string, after: string) =>
      word in TENS ? word !== "on" || after in UNITS || COUNTED.test(after) : word in UNITS && (word !== "bir" || COUNTED.test(after));
    if (!isNumber(w, next)) {
      out.push(w);
      continue;
    }
    let value = 0;
    let j = i;
    if (words[j] in TENS) value += TENS[words[j++]];
    if (words[j] in UNITS) value += UNITS[words[j++]];
    if (words[j] === "bucuk") {
      out.push(`${value}.5`);
      j++;
    } else out.push(String(value));
    i = j - 1;
  }
  return out.join(" ");
}

const SUFFIX = String.raw`(?:deki|daki|teki|taki|den|dan|ten|tan|de|da|te|ta|ye|ya|yi|yu|nin|nun|imda|imde|umda|umde|inda|inde|unda|unde|ina|ine|una|une|ima|ime|uma|ume|in|un|lik|luk|e|a|i|u)`;

/** Normalised, folded text with suffixes removed from numbers and number words. */
function prepare(text: string): string {
  // "1.200,50" (Turkish thousands + decimals) → "1200.50" before the shared normaliser sees it.
  let t = text.replace(/(?<![\d.,])(\d{1,3})((?:\.\d{3})+),(\d{1,2})(?!\d)/g, (_m, a: string, b: string, c: string) => `${a}${b.replace(/\./g, "")}.${c}`);
  t = fold(normalizeText(t, "tr"));
  t = t.replace(/(?<![\p{L}])(?:isvicre\s+)?(?:frank|frang|chf|sfr)\p{L}*/gu, " ");
  // Pillar 3a in all its spellings, before any suffix stripping can eat the "a".
  t = t.replace(/(?:(?:saule|pillar|pilier)\s*)?(?<![\d.,])(?:3a(?:'\p{L}*|yi|ya|yu|ye|da|dan|nin|m|mi|mu|ma|mdan|n|ni|niz|nizi)?|3\s+a)(?![\p{L}\d])/gu, ` ${PILLAR} `);
  t = t.replace(/(?:(?:3|uc)\.?\s*|ucuncu\s+)(?:sutun|ayak)\p{L}*|bireysel\s+emeklili?\p{L}*|(?:saule|pillar|pilier)\s*3(?:'\p{L}*|[aeiuüoö]\p{L}*)?/gu, ` ${PILLAR} `);
  // Every other apostrophe marks a suffix: "2028'de", "60'ta", "mio'ya", "bern'de".
  t = t.replace(/'\p{L}*/gu, "");
  t = t.replace(new RegExp(String.raw`(\d)${SUFFIX}(?![\p{L}])`, "gu"), "$1");
  t = t.replace(/(?<![\p{L}])(bin|milyon|mio)(?:a|e|u|i|dan|den|la|le|luk|lik|lık)(?![\p{L}])/gu, "$1");
  return numberWords(t.replace(/\s+/g, " ").trim());
}

function monthFrom(t: string, now: Date): number | undefined {
  const y = yearIn(t);
  if (y) return monthOfYear(y, now);
  const inYears = t.match(/(\d+(?:[.,]5)?)\s*(?:yil|sene)\p{L}*\s+(?:sonra|icinde|icerisinde)/u);
  if (inYears) return Math.round(Number(inYears[1].replace(",", ".")) * 12);
  const inMonths = t.match(/(\d+)\s*ay\s+(?:sonra|icinde|icerisinde)/u);
  if (inMonths) return Number(inMonths[1]);
  if (re(`${W}(?:(?:gelecek|onumuzdeki|ertesi)\\s+(?:yil|sene)\\p{L}*|seneye)${E}`).test(t)) return 12;
  if (re(`${W}bu\\s+(?:yil|sene)${E}`).test(t)) return monthOfYear(now.getFullYear(), now);
  if (re(`${W}(?:hemen|simdi|bugun)${E}`).test(t)) return 0;
  return undefined;
}

const RETIRE_WORD = String.raw`(?:emekli\p{L}*|pensionskasse\p{L}*|pension\p{L}*|calismayi\s+birak\p{L}*)`;
/** A two-digit age, not an amount or duration ("50 bin", "60 ay"). */
const NOT_MONEY = String.raw`(?![\d.,])(?!\s*(?:bin|milyon|mio|k|m|ay|yil|sene)${E})`;

function retirementAge(t: string, base: number): number | undefined {
  const age =
    // 60 yaşında emekli ol · 60'ta emekli olsam · 62 yaşında erken emekli olmak istiyorum · 62 yaşında Pensionskasse'den emekli olsam
    t.match(re(String.raw`(?<![\d.,])(\d{2})${NOT_MONEY}\s*(?:yas\p{L}*\s+)?(?:\p{L}+\s+){0,3}?${RETIRE_WORD}`)) ??
    // erken emeklilik 62 · emeklilik yaşı 63 · emekliliği 62 yaşına çek · emekli olmak istiyorum 60 yaşında
    t.match(re(String.raw`${RETIRE_WORD}\s+(?:\p{L}+\s+){0,4}?(\d{2})${NOT_MONEY}`)) ??
    // 60 yaşına kadar çalış
    t.match(re(String.raw`(?<![\d.,])(\d{2})\s*yas\p{L}*\s+kadar\s+calis`));
  if (age) return Number(age[1]);
  if (!re(RETIRE_WORD).test(t)) return undefined;
  // Relative to the plan's current retirement age: "emekliliği 3 yıl öne çeksem", "2 yıl erken emekli olsam"
  const sooner = t.match(/(\d{1,2})\s*(?:yil|sene)\p{L}*\s+(?:daha\s+)?(?:one\s+(?:cek|al)\p{L}*|erken)/u);
  if (sooner) return base - Number(sooner[1]);
  const later = t.match(/(\d{1,2})\s*(?:yil|sene)\p{L}*\s+(?:daha\s+)?(?:ertele\p{L}*|otele\p{L}*|gec\p{L}*|ileri\p{L}*|sonra\p{L}*)/u);
  if (later) return base + Number(later[1]);
  return undefined;
}

function risk(t: string): RiskProfile | undefined {
  if (re(`daha\\s+az\\s+risk|risk\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:azalt|dusur)|daha\\s+az\\s+hisse|hisse\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:azalt|dusur)|dusuk\\s+risk`).test(t)) return "conservative";
  if (re(`daha\\s+fazla\\s+risk|risk\\p{L}*\\s+(?:\\p{L}+\\s+)?artir|daha\\s+fazla\\s+hisse|hisse\\p{L}*\\s+(?:\\p{L}+\\s+)?artir|yuksek\\s+risk`).test(t)) return "growth";
  if (re(`orta\\s+risk`).test(t)) return "balanced";
  if (!re(`profil|strateji|portfoy|gec|degis|yatir|risk|daha|${W}ol|yap|sec|git|don`).test(t)) return undefined;
  const w = t.match(re(`${W}(muhafazakar|temkinli|ihtiyatli|guvenli|defansif|korumaci|dengeli|buyume|agresif|atak|riskli)`));
  if (!w) return undefined;
  return w[1] === "dengeli" ? "balanced" : /buyume|agresif|atak|riskli/.test(w[1]) ? "growth" : "conservative";
}

function spending(t: string): number | undefined {
  const cutVerb = String.raw`(?:azalt|kis(?!i(?!n))|dusur|indir|kes|tasarruf|kisinti)`;
  const cut =
    // harcamaları ayda 400 azalt · giderlerimi 400 frank kısalım · aylık harcamamı 400 düşürsem
    t.match(re(String.raw`(?:harcama|gider|masraf|butce)\p{L}*\s+(?:\S+\s+){0,3}?${AMT}\s*(?:\p{L}+\s+)?${cutVerb}`)) ??
    // 400 azalt (harcamaları) · ayda 400 daha az harca · ayda 400 tasarruf etsem
    t.match(re(String.raw`${AMT}\s*(?:\p{L}+\s+)?(?:daha\s+)?az\s+harca`)) ??
    t.match(re(String.raw`${PER_MONTH}\s+${AMT}\s*(?:\p{L}+\s+)?(?:tasarruf|kisinti)`)) ??
    t.match(re(String.raw`${AMT}\s*(?:\p{L}+\s+)?${cutVerb}\p{L}*\s+(?:\p{L}+\s+)?(?:harcama|gider|masraf)`));
  if (cut) return -amountValue(cut[1], cut[2]);
  const more =
    t.match(re(String.raw`${AMT}\s*(?:\p{L}+\s+)?(?:daha\s+)?fazla\s+harca`)) ??
    t.match(re(String.raw`(?:harcama|gider|masraf)\p{L}*\s+(?:\S+\s+){0,3}?${AMT}\s*(?:\p{L}+\s+)?(?:artir|yukselt)`));
  return more ? amountValue(more[1], more[2]) : undefined;
}

function monthlyInvest(t: string): Op | undefined {
  if (t.includes(PILLAR)) return undefined;
  if (re(`(?:atil|bosta|kenarda|yatan|duran)\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:nakit|nakd|para)|(?:nakit|nakd|para)\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:yatirima|degerlendir|calistir)`).test(t))
    return { op: "set", key: "optimize", value: true };
  const verb = re(`yatir|biriktir|kenara\\s+(?:koy|ayir)|${W}(?:etf|fon|borsa|hisse)\\p{L}*|dauerauftrag|duzenli\\s+alim`);
  const bare = re(`^${PER_MONTH}\\s+${AMT}[.!?]?$`);
  if (!verb.test(t) && !bare.test(t)) return undefined;
  const m =
    t.match(re(`${PER_MONTH}\\s+(?:\\p{L}+\\s+){0,3}?${AMT}`)) ??
    t.match(re(`${AMT}\\s*(?:\\p{L}+\\s+){0,3}?${PER_MONTH}`));
  if (m) return { op: "set", key: "monthlyInvest", value: amountValue(m[1], m[2]) };
  return undefined;
}

function pillar3a(t: string): boolean | undefined {
  if (!t.includes(PILLAR)) return undefined;
  if (re(`durdur|birak|${W}kes(?:${E}|elim|sem|ersem|mek|iyorum)|iptal|vazgec|dondur|kapat|ara\\s+ver|(?:yatir|ode|yap)ma(?:${E}|sam|sak|zsam|zsak|yalim|yelim|mak|yi)|artik\\s+(?:odeme|yatirma)`).test(t)) return false;
  if (re(`maks|doldur|full\\p{L}*|basla|${W}ac(?:${E}|ar|sam|alim|mak|in)|ode|yatir|kullan|${W}tam${E}|tavan|limit|katki|aktif|ekle`).test(t)) return true;
  return undefined;
}

const HOUSE = String.raw`${W}(?:ev(?:i|e|im|imi|imiz|imizi|in|ini)?|daire\p{L}*|konut\p{L}*|mulk\p{L}*|villa\p{L}*|mesken\p{L}*)${E}`;

function homeShift(t: string): number | undefined {
  if (re(RETIRE_WORD).test(t) || t.includes(PILLAR)) return undefined;
  const span = String.raw`(\d+(?:[.,]5)?)\s*(yil|sene|ay)\p{L}*`;
  const later = String.raw`(?:ertele|geciktir|otele|ileri\s+(?:al|at)|ileriye|sonraya|gec\s+al|bekle)`;
  const sooner = String.raw`(?:one\s+(?:al|cek)|oneye|erken\s+al|erkene)`;
  const months = (n: string, unit: string) => Math.round(Number(n.replace(",", ".")) * (unit === "ay" ? 1 : 12));
  const d =
    t.match(re(`${span}\\s+(?:\\p{L}+\\s+){0,2}?${later}`)) ??
    t.match(re(`${later}\\p{L}*\\D{0,30}?${span}`));
  if (d) return months(d[1], d[2]);
  const s = t.match(re(`${span}\\s+(?:\\p{L}+\\s+){0,2}?${sooner}`));
  return s ? -months(s[1], s[2]) : undefined;
}

/** Life decisions and economic scenarios (see `life.ts`); patterns run on the prepared (folded, suffix-free) text. */
const LIFE: LifeVocab = {
  perMonth: PER_MONTH,
  // Turkish marks the price with a case suffix, not a preposition: the largest amount of the sentence is used.
  forAmount: String.raw`(?!)`,
  car: /(?<![\p{L}])(?:araba\p{L}*|otomobil\p{L}*|tesla|motosiklet\p{L}*|arac(?:i|imi|im)?(?![\p{L}]))/u,
  lease: /leasing|kirala\p{L}*/u,
  buy: /(?<![\p{L}])(?:satin\s+)?al(?:sam|sak|irsam|irsak|mak|ayim|alim|acag\p{L}*|in|ir|im|iyorum|iyoruz)?(?![\p{L}])|edin\p{L}*/u,
  ga: /(?<![\p{L}])ga(?![\p{L}])|generalabo\p{L}*|genel\s+abonman\p{L}*/u,
  home: re(HOUSE),
  child: re(`bebe|cocug|cocuk|dogum|hamile|ebeveyn|${W}(?:anne|baba)\\s+ol`),
  university: /universite\p{L}*|(?<![\p{L}])(?:eth|epfl)(?![\p{L}])|oku(?:rsa|sa|yacak|sun)\p{L}*/u,
  apprenticeship: /cirak\p{L}*|meslek\s+egitim\p{L}*/u,
  kitaDays: /(\d)\s*gun\p{L}*\s+(?:\p{L}+\s+)?(?:kres|yuva|kita|anaokul)\p{L}*/u,
  workload: /(?:%|yuzde)\s*(\d{1,3})\s+(?:\p{L}+\s+)?(?:calis|is|mesai|part|yari)\p{L}*|(\d{1,3})\s*%\s*calis\p{L}*/u,
  halfTime: /yari\s+zamanli/,
  sabbatical: /sabbatical|ucretsiz\s+izin\p{L}*|kariyer\s+molasi|is\p{L}*\s+ara\s+ver\p{L}*/u,
  forMonths: /(?<![\d.,])(\d{1,2})\s*ay(?:lik|ligina)?(?![\p{L}])(?!\s+(?:sonra|icinde|icerisinde))/u,
  forYears: /(?<![\d.,])(\d(?:[.,]5)?)\s*(?:yil|sene)(?:lik|ligina)?(?![\p{L}])(?!\s+(?:sonra|icinde|icerisinde))/u,
  moveTo: /(?<![\p{L}])((?:St\.\s+)?\p{Lu}[\p{L}.-]+?)['’]?(?:y?[aeAE])\s+ta[sşSŞ][ıiIİ]n/u,
  move: /tasin\p{L}*/u,
  rent: String.raw`(?<![\p{L}])kira(?:si|yi|m)?\s+(?:\p{L}+\s+)?`,
  marry: /evlen\p{L}*|dugun\p{L}*|nikah\p{L}*/u,
  partner: /birlikte\s+yasa\p{L}*|beraber\s+yasa\p{L}*|ayni\s+eve\s+(?:cik|tasin)\p{L}*/u,
  partnerEarns: String.raw`(?<![\p{L}])(?:es(?:im|i|imin)|partner\p{L}*|karim|kocam|sevgili\p{L}*)\s+(?:\p{L}+\s+)?`,
  master: /master\p{L}*|yuksek\s+lisans\p{L}*|(?<![\p{L}])mba(?![\p{L}])/u,
  bachelor: /(?<!yuksek\s)(?<![\p{L}])lisans\p{L}*|bachelor/u,
  education: /doktora\p{L}*|egitime\s+don\p{L}*|okula\s+don\p{L}*/u,
  fullTime: /tam\s+zamanli/,
  selfEmployed: /serbest\s+calis\p{L}*|kendi\s+is(?:imi|ini|imizi)|sirket\s+kur\p{L}*|freelanc\p{L}*|serbest\s+meslek/u,
  earning: String.raw`(?!)`,
  inherit: /miras\p{L}*|ikramiye\p{L}*|piyango\p{L}*/u,
  heatPump: /isi\s+pompa\p{L}*/u,
  economy: {
    high_inflation: /yuksek\s+enflasyon|enflasyon\p{L}*\s+yuksek\s+kal\p{L}*|enflasyon\p{L}*\s+(?:artar|artarsa|yukselir|yukselirse|patlar|patlarsa|firlarsa)|faiz\p{L}*\s+(?:artar|artarsa|yukselir|yukselirse|cikarsa)/u,
    recession: /resesyon\s+senaryo\p{L}*|ekonomik\s+kriz\s+senaryo\p{L}*/u,
    low_rates: /dusuk\s+faiz\p{L}*|negatif\s+faiz\p{L}*|sifir\s+faiz\p{L}*/u,
    climate_transition: /iklim\s+(?:senaryo|gecis|stres|sok)\p{L}*/u,
    baseline: /temel\s+senaryo\p{L}*/u,
  },
};

function parse(ctx: IntentContext): Op[] {
  const { text, house, now, retirementAge: base } = ctx;
  const t = prepare(text);
  const when = monthFrom(t, now);
  const ops: Op[] = [];

  const age = retirementAge(t, base);
  if (age) ops.push({ op: "set", key: "retirementAge", value: age });

  const invest = monthlyInvest(t);
  if (invest) ops.push(invest);

  const profile = risk(t);
  if (profile) ops.push({ op: "set", key: "riskProfile", value: profile });

  const delta = spending(t);
  if (delta !== undefined) ops.push({ op: "set", key: "expenseDelta", value: delta });

  const p3a = pillar3a(t);
  if (p3a !== undefined) ops.push({ op: "set", key: "contributes3a", value: p3a });

  const houseWord = re(HOUSE).test(t);
  const shift = homeShift(t);
  if (shift && house) ops.push({ op: "shift", id: house.id, months: shift });
  else if (house && houseWord && re(`vazgec|iptal|almaktan|alma${E}|almayalim|almayacag|almasak|almasam`).test(t)) ops.push({ op: "remove", id: house.id });

  // 2028'de 1,2 milyona daire al · Bern'de 900 bine ev satın almak istiyoruz · ev alsam 1.2 mio
  if (houseWord && re(`${W}(?:satin\\s+)?al(?:sam|sak|irsam|irsak|mak|ayim|alim|acag\\p{L}*|in|ir|im|iyorum|iyoruz)?${E}|alim\\p{L}*|edin\\p{L}*`).test(t) && !shift) {
    const price = largestAmountAbove(t, 50_000);
    if (price) {
      const where = text.match(/(?<![\p{L}])((?:St\.\s+)?\p{Lu}[\p{L}-]+)['’](?:de|da|te|ta|deki|daki|teki|taki)(?!\p{L})/u);
      const label = eventLabel(where ? { key: "event.homeIn", params: { place: where[1] } } : { key: "event.home" });
      ops.push({ op: "add", type: "house", ...label, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // işimi kaybedersem · 6 ay işsiz kalırsak · işten çıkarılırsam · kovulursam · bir yıl çalışmazsam
  if (re(`issiz|(?:isimi|isimden|isini|isinden|isimizi|isimizden|isi|isten)\\s+(?:\\p{L}+\\s+){0,2}?(?:kayb|ol|cikar|atil|ayril|birak|kovul)|${W}kovul|calismazsam|calismasam|calismazsak`).test(t)) {
    const m = t.match(/(?<![\d.,])(\d{1,2})\s*ay(?:lik|ligina)?(?!\p{L})(?!\s+(?:sonra|icinde|icerisinde))/u);
    const y = t.match(/(?<![\d.,])(\d(?:[.,]5)?)\s*(?:yil|sene)(?:lik|ligina)?(?!\p{L})(?!\s+(?:sonra|icinde|icerisinde))/u);
    const duration = m ? Number(m[1]) : y ? Math.round(Number(y[1].replace(",", ".")) * 12) : 6;
    ops.push({ op: "add", type: "jobloss", ...eventLabel({ key: "event.jobLoss" }), month: when ?? 12, amount: 0, duration });
  }

  // seneye borsa çökerse · piyasalar %30 düşerse · ekonomik kriz · resesyon · ayı piyasası
  if (re(`(?:borsa|piyasa|hisse)\\p{L}*\\s+(?:\\S+\\s+){0,2}?(?:cok(?:er|se|me|tu|us|ecek)|dus(?:er|se|me|tu|us|ecek)|cak(?:il|ar))|cokus|resesyon|kriz|crash|krach|ayi\\s+piyasa`).test(t) && !/senaryo/.test(t)) {
    ops.push({ op: "add", type: "crash", ...eventLabel({ key: "event.crash" }), month: when ?? 12, amount: 0 });
  }

  // yılda 10 bin zam · maaşıma 10 bin zam gelirse · terfi
  const zam = `${W}zam(?:${E}|mi|la|li)`;
  const raise = t.match(re(`(?:${zam}|terfi|maas\\s+artisi)\\D{0,20}${AMT}`)) ?? t.match(re(`${AMT}\\s*(?:\\p{L}+\\s+)?${zam}`));
  if (raise) ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount: amountValue(raise[1], raise[2]) });

  // çocuk, araba, çalışma oranı, taşınma, evlilik, eğitim, serbest çalışma, miras, ekonomi senaryosu
  ops.push(...lifeOps(LIFE, t, ctx, when, ops));
  return ops;
}

export const turkishIntents: IntentParser = { locale: "tr", parse };
