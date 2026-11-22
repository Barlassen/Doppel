import { HEALTH_EXCESS_GROWTH, cantonTaxIndex, hasCantonTax } from "@/lib/finance/canton";
import type { I18n } from "@/lib/i18n/I18nProvider";

/** One sentence on what the canton changes (tax burden, health premiums and their growth). Numbers from canton.ts. */
export function cantonLine(t: I18n["t"], canton: string, premiumMonth: number): string {
  const params = { canton, tax: cantonTaxIndex(canton), premium: premiumMonth, growth: HEALTH_EXCESS_GROWTH };
  return hasCantonTax(canton) ? t("canton.line", params) : t("canton.lineNoTax", params);
}
