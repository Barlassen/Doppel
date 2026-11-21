import { translate } from "./index";
import type { Locale } from "./types";

export const EXAMPLE_IDS = ["jobLoss", "delay", "crash", "baby", "retire", "invest"] as const;

export function commandExamples(locale: Locale) {
  return EXAMPLE_IDS.map((id) => ({ id, text: translate(locale, `cmd.examples.${id}`) }));
}
