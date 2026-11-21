/** Update Compose string resources from the Doppel web dictionaries. Run from the repository root. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DICTIONARIES, LOCALES } from "../src/lib/i18n";

const reusedKeys = `
lang.switcher
header.profiles
profile.lukas.tagline
profile.elena.tagline
profile.goal
event.flatIn
event.universityFor
event.home
event.homeIn
event.jobLoss
event.crash
event.baby
event.raise
category.dining
category.shopping
category.travel
category.subscriptions
risk.conservative
risk.balanced
risk.growth
cmd.inputAria
cmd.simulate
cmd.simulating
cmd.examplesAria
cmd.examples.jobLoss
cmd.examples.delay
cmd.examples.crash
cmd.examples.baby
cmd.examples.retire
cmd.examples.invest
ops.add
ops.shift
ops.remove
ops.retirementAge
ops.riskProfile
ops.contributes3aOn
ops.contributes3aOff
ops.monthlyInvest
ops.expenseDelta
ops.optimizeOn
ops.optimizeOff
chart.title
insight.tipPayday
insight.tipCategory
insight.tipFixed
recipe.spendTitle
recipe.spendDetail
recipe.spendDetailNoTip
recipe.investTitle
recipe.investTitle3a
recipe.investDetail
recipe.investDetail3a
recipe.timingTitle
recipe.timingDetail
recipe.comboTitle
recipe.comboDetail
recipes.title
recipes.solving
recipes.apply
recipes.improvesTo
afford.title
afford.passes
afford.fails
afford.ratio
afford.equity
afford.maxPrice
afford.mortgage
afford.missingEquity
afford.incomeShort
common.close
`.trim().split(/\s+/);

// Pocket-only labels ordered EN, DE, FR, TR.
const pocketLabels: Record<string, readonly string[]> = {
  overview: ["Overview","Übersicht","Vue d’ensemble","Genel bakış"],
  whatIf: ["What-if","Was wäre, wenn?","Et si…","Ya şöyle olsaydı?"],
  settings: ["Settings","Einstellungen","Réglages","Ayarlar"],
  appearance: ["Appearance","Darstellung","Apparence","Görünüm"],
  system: ["System","System","Système","Sistem"],
  light: ["Light","Hell","Clair","Açık"],
  dark: ["Dark","Dunkel","Sombre","Koyu"],
  real: ["Real twin","Realer Zwilling","Jumeau réel","Gerçek ikiz"],
  ideal: ["Ideal twin","Idealer Zwilling","Jumeau idéal","İdeal ikiz"],
  goalOdds: ["Chance of reaching the goal","Chance, das Ziel zu erreichen","Probabilité d’atteindre l’objectif","Hedefe ulaşma olasılığı"],
  realLegend: ["Real twin · median and 10–90% range","Realer Zwilling · Median und 10–90-%-Spanne","Jumeau réel · médiane et intervalle 10–90 %","Gerçek ikiz · medyan ve %10–90 aralığı"],
  idealLegend: ["Ideal twin · median","Idealer Zwilling · Median","Jumeau idéal · médiane","İdeal ikiz · medyan"],
  goalLegend: ["Goal · {target:chf}","Ziel · {target:chf}","Objectif · {target:chf}","Hedef · {target:chf}"],
  coneDescription: ["At age {age}, the real twin's median is {median:chf}. The 10th to 90th percentile spans {low:chf} to {high:chf}.","Mit {age} Jahren liegt der Median des realen Zwillings bei {median:chf}. Das 10. bis 90. Perzentil reicht von {low:chf} bis {high:chf}.","À {age} ans, la médiane du jumeau réel est de {median:chf}. Du 10e au 90e percentile, les valeurs vont de {low:chf} à {high:chf}.","{age} yaşında gerçek ikizin medyanı {median:chf}. 10. ile 90. yüzdelik aralığı {low:chf} ile {high:chf} arasındadır."],
  age: ["Age {age}","{age} Jahre","{age} ans","{age} yaş"],
  noHome: ["No home purchase planned.","Kein Immobilienkauf geplant.","Aucun achat immobilier prévu.","Planlanan bir ev alımı yok."],
  passShare: ["Passes across futures","Besteht in den Szenarien","Test réussi dans les scénarios","Testi geçen senaryolar"],
  cannotParse: ["No change recognized. Try one of the examples.","Keine Änderung erkannt. Probiere eines der Beispiele.","Aucun changement reconnu. Essaie un des exemples.","Bir değişiklik algılanmadı. Örneklerden birini dene."],
  reset: ["Reset plan","Plan zurücksetzen","Réinitialiser le plan","Planı sıfırla"],
  applied: ["{before:pct1} → {after:pct1}","{before:pct1} → {after:pct1}","{before:pct1} → {after:pct1}","{before:pct1} → {after:pct1}"],
  onTrack: ["This plan reaches the 80% target.","Dieser Plan erreicht die Zielmarke von 80 %.","Ce plan atteint la cible de 80 %.","Bu plan %80 hedefine ulaşıyor."],
  noRecipe: ["No recipe found for this plan.","Für diesen Plan wurde kein Vorschlag gefunden.","Aucune piste trouvée pour ce plan.","Bu plan için öneri bulunamadı."],
  scan: ["Import QR bill","QR-Rechnung importieren","Importer une QR-facture","QR faturası içe aktar"],
  scanReview: ["Review QR bill","QR-Rechnung prüfen","Vérifier la QR-facture","QR faturasını incele"],
  scanReading: ["Reading image…","Bild wird gelesen…","Lecture de l’image…","Görsel okunuyor…"],
  scanError: ["No Swiss QR bill found in the image.","Keine Schweizer QR-Rechnung im Bild gefunden.","Aucune QR-facture suisse trouvée dans l’image.","Görselde İsviçre QR faturası bulunamadı."],
  scanAmount: ["A positive CHF amount is required.","Ein positiver CHF-Betrag ist nötig.","Un montant positif en CHF est nécessaire.","Pozitif bir CHF tutarı gerekli."],
  scanOneOff: ["One-off expense · {amount:chf}","Einmalige Ausgabe · {amount:chf}","Dépense ponctuelle · {amount:chf}","Tek seferlik gider · {amount:chf}"],
  scanRecurring: ["Monthly expense · {amount:chf}","Monatliche Ausgabe · {amount:chf}","Dépense mensuelle · {amount:chf}","Aylık gider · {amount:chf}"],
  scanDuplicate: ["This recurring expense already appears in the budget.","Diese wiederkehrende Ausgabe ist bereits im Budget.","Cette dépense récurrente figure déjà au budget.","Bu düzenli gider bütçede zaten var."],
  scanAdd: ["Add to plan","Zum Plan hinzufügen","Ajouter au plan","Plana ekle"],
};

// Turkish copy from the Doppel Turkish translation work. Used while the web dictionary
// inherits these keys from English. A translated web value takes precedence automatically.
const turkishFallback: Record<string, string> = {
  "lang.switcher": "Dil",
  "header.profiles": "Demo profil",
  "profile.lukas.tagline": "Yazılım mühendisi · ilk evini almak istiyor",
  "profile.elena.tagline": "Dört kişilik aile · 58 yaşında emekli olmayı hayal ediyor",
  "profile.goal": "{age} yaşına kadar CHF {target:mio} mn net varlık",
  "event.flatIn": "Daire ({place})",
  "event.universityFor": "{name} için üniversite",
  "event.home": "Ev",
  "event.homeIn": "Ev ({place})",
  "event.jobLoss": "İş kaybı",
  "event.crash": "Borsa çöküşü −%30",
  "event.baby": "Bebek",
  "event.raise": "Zam",
  "category.dining": "yeme-içme",
  "category.shopping": "alışveriş",
  "category.travel": "seyahat",
  "category.subscriptions": "abonelikler",
  "risk.conservative": "Temkinli",
  "risk.balanced": "Dengeli",
  "risk.growth": "Büyüme",
  "cmd.inputAria": "İkizin için senaryo sorusu",
  "cmd.simulate": "Hesapla",
  "cmd.simulating": "Hesaplanıyor…",
  "cmd.examplesAria": "Örnek senaryolar",
  "ops.add": "+ {label}",
  "ops.shift": "{months:signed} ay kaydır",
  "ops.remove": "olayı kaldır",
  "ops.retirementAge": "emeklilik yaşı → {value}",
  "ops.riskProfile": "risk profili → {value}",
  "ops.contributes3aOn": "3a → açık",
  "ops.contributes3aOff": "3a → kapalı",
  "ops.monthlyInvest": "aylık yatırım → {value:chf}",
  "ops.expenseDelta": "harcama → {value:chfSigned}/ay",
  "ops.optimizeOn": "boştaki nakit yatırımı → açık",
  "ops.optimizeOff": "boştaki nakit yatırımı → kapalı",
  "chart.title": "Net varlık (emeklilik + ev payı dahil), bugünkü CHF",
  "insight.tipPayday": "En kolay kazanç, maaş haftasındaki yeme-içme ve alışverişte.",
  "insight.tipCategory": "En büyük esnek kalemin: {category} (≈ {amount:chf}/ay). Sonraki kaldıraç, kira ve sigorta gibi sabit giderler.",
  "insight.tipFixed": "Önce sabit giderlere bak: kira, sigorta ve ulaşım.",
  "recipe.spendTitle": "Ayda {amount:chf} daha az harca",
  "recipe.spendDetail": "Günde ≈ {daily:chf}. {tip}",
  "recipe.spendDetailNoTip": "Günde ≈ {daily:chf}.",
  "recipe.investTitle": "Boştaki CHF {k} bini yatır",
  "recipe.investTitle3a": "Boştaki CHF {k} bini yatır + 3a'yı doldur",
  "recipe.investDetail": "{months} aylık acil durum fonu ayır; kalanı ve her ay artanı yatır.",
  "recipe.investDetail3a": "{months} aylık acil durum fonu ayır; kalanı ve her ay artanı yatır. 3a yılda ~{tax:chf} vergi avantajı sağlar.",
  "recipe.timingTitle": "Ev alımını {months} ay ertele",
  "recipe.timingDetail": "O tarihte birikimin ve maaşınla {home} için bankanın ödeme gücü testini geçme ihtimalin {pass:pct}.",
  "recipe.comboTitle": "Ev alımını {months} ay ertele + ayda {amount:chf} daha az harca",
  "recipe.comboDetail": "Erteleme banka testini geçirir (ihtimal {pass:pct}); harcama kesintisi hedefe kalan açığı kapatır.",
  "recipes.title": "Yolumu bul",
  "recipes.solving": "aranıyor…",
  "recipes.apply": "Uygula",
  "recipes.improvesTo": "yeni oran",
  "afford.title": "Banka ödeme gücü testi",
  "afford.passes": "✓ Geçiyor",
  "afford.fails": "✕ Geçmiyor",
  "afford.ratio": "Maliyet / brüt gelir",
  "afford.equity": "Öz kaynak (peşinat)",
  "afford.maxPrice": "Alınabilir en yüksek fiyat",
  "afford.mortgage": "Konut kredisi (ipotek)",
  "afford.missingEquity": "Eksik öz kaynak: {amount}.",
  "afford.incomeShort": "Brüt gelir yılda {amount} eksik.",
  "common.close": "Kapat",
};

function getString(source: unknown, path: string): string {
  let current = source;
  for (const part of path.split(".")) {
    current = (current as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof current !== "string") throw new Error(`Missing dictionary key ${path}`);
  return current;
}

function clean(value: string): string {
  return value.replace(/^[✓✕]\s*/, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const check = process.argv.includes("--check");
let stale = false;
for (const [index, locale] of LOCALES.entries()) {
  const entries = {
    ...Object.fromEntries(reusedKeys.map((key) => {
      const value = getString(DICTIONARIES[locale], key);
      const english = getString(DICTIONARIES.en, key);
      return [key, locale === "tr" && value === english ? turkishFallback[key] ?? value : value];
    })),
    ...Object.fromEntries(Object.entries(pocketLabels).map(([key, values]) => [`pocket.${key}`, values[index]])),
  };
  const qualifier = locale === "en" ? "values" : `values-${locale}`;
  const directory = resolve("pocket/composeApp/src/commonMain/composeResources", qualifier);
  const path = resolve(directory, "strings.xml");
  const lines = Object.entries(entries).map(([key, value]) =>
    `    <string name="${key.replaceAll(".", "_").toLowerCase()}">${clean(value)}</string>`,
  );
  const content = ['<?xml version="1.0" encoding="utf-8"?>', "<!-- Generated by pocket/generate-strings.ts -->",
    "<resources>", ...lines, "</resources>", ""].join("\n");
  if (check) {
    if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) {
      console.error(`Stale resource file ${path}`);
      stale = true;
    }
  } else {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, content);
  }
}
if (stale) process.exitCode = 1;
