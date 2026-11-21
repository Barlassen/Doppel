/**
 * Turkish what-if patterns — first draft. Handles suffixes on numbers ("2028'de", "500'ü") and
 * common ASCII spellings ("yasinda", "issiz").
 * "60 yaşında emekli ol", "Ayda 500 yatırım yap", "Harcamaları ayda 400 azalt", "3a'yı doldur",
 * "2028'de 6 ay işsiz kalırsam ne olur?", "Gelecek yıl borsa çöküşü", "2028'de bebeğimiz olacak",
 * "Ev alımını 2 yıl ertele", "Bern'de 1,2 milyona ev satın al".
 */
import type { RiskProfile } from "@/lib/finance/types";
import type { Op } from "../actions";
import { AMOUNT, amountValue, eventLabel, largestAmountAbove, monthOfYear, normalizeText, yearIn, type IntentContext, type IntentParser } from "./shared";

const PER_MONTH = String.raw`ayda|aylık|aylik|her\s+ay|ay\s+başı|\/\s*ay(?!\p{L})`;
const re = (s: string) => new RegExp(s, "u");

/** Drops Turkish case suffixes after numbers: "2028'de" → "2028", "500'ü" → "500", "2028de" → "2028". */
function stripNumberSuffixes(t: string): string {
  return t
    .replace(/(\d)'\p{L}+/gu, "$1")
    .replace(/(\d{4})(?:'?(?:de|da|te|ta|den|dan|ten|tan|e|a|ye|ya))(?!\p{L})/gu, "$1");
}

function monthFrom(t: string, now: Date): number | undefined {
  const y = yearIn(t);
  if (y) return monthOfYear(y, now);
  const inYears = t.match(/(\d+)\s*(?:yıl|yil|sene)\s+(?:sonra|içinde|icinde)/u);
  if (inYears) return Number(inYears[1]) * 12;
  const inMonths = t.match(/(\d+)\s*ay\s+(?:sonra|içinde|icinde)/u);
  if (inMonths) return Number(inMonths[1]);
  if (/(gelecek|önümüzdeki|onumuzdeki)\s+(yıl|yil|sene)|seneye/u.test(t)) return 12;
  return undefined;
}

function parse({ text, house, now }: IntentContext): Op[] {
  const t = stripNumberSuffixes(normalizeText(text, "tr"));
  const when = monthFrom(t, now);
  const ops: Op[] = [];

  // 60 yaşında emekli ol / emekliliği 62 yaşına çek / 63'te emekli olmak
  const retire =
    t.match(/(?<!\d)(\d{2})\s*(?:ya[sş]\p{L}*\s*)?(?:da|de|ta|te)?\s+emekli/u) ??
    t.match(/emekli\p{L}*\s+(?:\p{L}+\s+){0,2}?(\d{2})\s*ya[sş]/u);
  if (retire) ops.push({ op: "set", key: "retirementAge", value: Number(retire[1]) });

  // ayda 500 yatırım yap / her ay 300 yatır / aylık 500 düzenli yatırım
  if (/yat[ıi]r|biriktir|düzenli\s+talimat/u.test(t)) {
    const m = t.match(re(`(?:${PER_MONTH})\\s+${AMOUNT}`)) ?? t.match(re(`${AMOUNT}\\s*(?:\\p{L}+\\s+)?(?:${PER_MONTH})`));
    if (m) ops.push({ op: "set", key: "monthlyInvest", value: amountValue(m[1], m[2]) });
    else if (/(atıl|boşta|bosta|kenarda|nakit)/u.test(t)) ops.push({ op: "set", key: "optimize", value: true });
  }

  // büyüme profiline geç / muhafazakar ol / dengeli portföy
  if (/(profil|strateji|portföy|portfoy|geç|gec|değiştir|degistir|yat[ıi]r|risk|daha|ol(?!\p{L}))/u.test(t)) {
    const w = t.match(/(muhafazak[aâ]r|temkinli|ihtiyatl[ıi]|güvenli|defansif|dengeli|büyüme|buyume|agresif|atak|riskli)/u);
    if (w) {
      const value: RiskProfile = /dengeli/u.test(w[1]) ? "balanced" : /büyüme|buyume|agresif|atak|riskli/u.test(w[1]) ? "growth" : "conservative";
      ops.push({ op: "set", key: "riskProfile", value });
    }
  }

  // harcamaları ayda 400 azalt / ayda 400 daha az harca / 200 daha fazla harca
  const cut =
    t.match(re(`(?:harcama|gider|masraf|bütçe)\\p{L}*\\s+(?:\\p{L}+\\s+){0,2}?${AMOUNT}\\s*(?:\\p{L}+\\s+)?(?:azalt|kıs|düşür|indir)`)) ??
    t.match(re(`${AMOUNT}\\s*(?:\\p{L}+\\s+)?(?:daha\\s+)?az\\s+harca`));
  const more = t.match(re(`${AMOUNT}\\s*(?:\\p{L}+\\s+)?(?:daha\\s+)?fazla\\s+harca`));
  if (cut) ops.push({ op: "set", key: "expenseDelta", value: -amountValue(cut[1], cut[2]) });
  else if (more) ops.push({ op: "set", key: "expenseDelta", value: amountValue(more[1], more[2]) });

  // 3a'yı doldur / 3a'ya başla / 3a'yı durdur / bireysel emeklilik
  if (/(?<![\p{L}\d])3a(?![\d])|3\.\s*sütun|üçüncü\s+sütun|bireysel\s+emeklilik/u.test(t)) {
    if (/(durdur|bırak|birak|kes|iptal|vazgeç|artık\s+ödeme)/u.test(t)) ops.push({ op: "set", key: "contributes3a", value: false });
    else if (/(maks|doldur|başla|basla|aç|öde|yat[ıi]r|kullan|tam)/u.test(t)) ops.push({ op: "set", key: "contributes3a", value: true });
  }

  // ev alımını 2 yıl ertele / 6 ay sonraya ertele
  const delay =
    t.match(/(\d+)\s*(yıl|yil|sene|ay)\p{L}*\s+(?:\p{L}+\s+){0,2}?(?:ertele|geciktir|ötele|otele|bekle|ileri\s+al)/u) ??
    t.match(/(?:ertele|geciktir|ötele|otele)\p{L}*\D{0,30}?(\d+)\s*(yıl|yil|sene|ay)/u);
  if (delay && house) ops.push({ op: "shift", id: house.id, months: Number(delay[1]) * (delay[2] === "ay" ? 1 : 12) });

  // Bern'de 1,2 milyona ev satın al / 900 bine daire almak
  if (/(satın\s+al|satin\s+al|alım|alim|almak|alsam|alırsam|alacağ|ev\s+al|daire\s+al)/u.test(t) && /(ev(?!\p{L})|evi|daire|konut|mülk|villa)/u.test(t)) {
    const price = largestAmountAbove(t, 50_000);
    if (price) {
      const where = text.match(/([A-ZÄÖÜÇŞİ][\p{L}-]+)['’](?:de|da|te|ta)(?!\p{L})/u);
      const label = eventLabel(where ? { key: "event.homeIn", params: { place: where[1] } } : { key: "event.home" });
      ops.push({ op: "add", type: "house", ...label, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // işimi kaybedersem / işsiz kalırsam / işten çıkarılırsam
  if (/(iş|is)\p{L}*\s+(?:\p{L}+\s+){0,3}?kayb|işsiz|issiz|işten\s+çıkar|isten\s+cikar|kovul/u.test(t)) {
    const dur = t.match(/(\d+)\s*ay(?!da)/u);
    ops.push({ op: "add", type: "jobloss", ...eventLabel({ key: "event.jobLoss" }), month: when ?? 12, amount: 0, duration: dur ? Number(dur[1]) : 6 });
  }

  // borsa çöküşü / piyasa krizi / resesyon
  if (/(borsa|piyasa)\p{L}*\s+(çök|cok|kriz|düş|dus)|çöküş|resesyon|kriz|crash/u.test(t)) {
    ops.push({ op: "add", type: "crash", ...eventLabel({ key: "event.crash" }), month: when ?? 12, amount: 0 });
  }

  // bebeğimiz olacak / çocuk / doğum
  if (/(bebe|bebek|çocu|cocu|doğum|hamile)/u.test(t)) {
    ops.push({ op: "add", type: "child", ...eventLabel({ key: "event.baby" }), month: when ?? 18, amount: 1500, duration: 216 });
  }

  // 10 bin zam
  const raise = t.match(re(`(?:zam|terfi|maaş\\s+artışı)\\D{0,20}${AMOUNT}`)) ?? t.match(re(`${AMOUNT}\\s*(?:\\p{L}+\\s+)?zam`));
  if (raise) ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount: amountValue(raise[1], raise[2]) });

  return ops;
}

export const turkishIntents: IntentParser = { locale: "tr", parse };
