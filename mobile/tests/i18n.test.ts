import assert from "node:assert/strict";
import { test } from "node:test";
import { dictionaries, LOCALES, pickLocale, translator } from "../src/i18n/index.ts";

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");

test("pickLocale follows the device's preferred languages, default English", () => {
  assert.equal(pickLocale(["de-CH"]), "de");
  assert.equal(pickLocale(["fr_CH"]), "fr");
  assert.equal(pickLocale(["TR"]), "tr");
  assert.equal(pickLocale(["it-CH", "de-CH", "en-GB"]), "de");
  assert.equal(pickLocale(["it-CH"]), "en");
  assert.equal(pickLocale([null, undefined, ""]), "en");
  assert.equal(pickLocale([]), "en");
});

test("every dictionary has exactly the English keys and placeholders", () => {
  const keys = Object.keys(dictionaries.en).sort();
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(dictionaries[locale]).sort(), keys, `${locale}: keys`);
    for (const key of keys as (keyof typeof dictionaries.en)[]) {
      assert.ok(dictionaries[locale][key].trim(), `${locale}.${key} is empty`);
      assert.equal(placeholders(dictionaries[locale][key]), placeholders(dictionaries.en[key]), `${locale}.${key}`);
    }
  }
});

test("language rules of AGENTS.md §4", () => {
  for (const [key, text] of Object.entries(dictionaries.de)) {
    assert.ok(!text.includes("ß"), `de.${key}: ss, never ß`);
  }
  for (const [key, text] of Object.entries(dictionaries.fr)) {
    const prose = text.replace(/\{\w+\}/g, "x");
    assert.ok(!/[^ ][:;!?%]/.test(prose), `fr.${key}: U+202F before % : ; ! ?`);
  }
  for (const [key, text] of Object.entries(dictionaries.tr)) {
    assert.ok(!/\}['’]/.test(text), `tr.${key}: no case suffix on a placeholder`);
  }
});

test("only short labels may equal the English text", () => {
  for (const locale of ["de", "fr", "tr"] as const) {
    for (const [key, text] of Object.entries(dictionaries[locale])) {
      const english = dictionaries.en[key as keyof typeof dictionaries.en];
      assert.ok(text !== english || text.length <= 12 || key === "settings.appValue", `${locale}.${key} is untranslated`);
    }
  }
});

test("translator fills placeholders and leaves unknown ones visible", () => {
  const t = translator("en");
  assert.equal(t("error.invalid", { example: "http://192.168.1.20:3000" }), "This is not a valid address. Example: http://192.168.1.20:3000");
  assert.equal(t("error.invalid"), "This is not a valid address. Example: {example}");
  assert.equal(translator("de")("nav.play"), "Spiel");
});
