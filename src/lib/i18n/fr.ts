import { en } from "./en";
import type { Messages } from "./types";

// Phase A fallback. Phase B replaces this with a complete dictionary.
export const fr = {
  ...en,
  cmd: {
    ...en.cmd,
    examples: {
      jobLoss: "Et si je perds mon emploi pendant 6 mois en 2028 ?",
      delay: "Reporter l’achat de l’appartement de 2 ans",
      crash: "Krach boursier l’année prochaine",
      baby: "Nous aurons un bébé en 2028",
      retire: "Prendre ma retraite à 60 ans",
      invest: "Investir 500 par mois",
    },
  },
} satisfies Messages;
