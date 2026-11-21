import { en } from "./en";
import type { Messages } from "./types";

// Phase A fallback. Phase B replaces this with a complete dictionary.
export const de = {
  ...en,
  cmd: {
    ...en.cmd,
    examples: {
      jobLoss: "Was, wenn ich 2028 für 6 Monate meinen Job verliere?",
      delay: "Den Wohnungskauf um 2 Jahre verschieben",
      crash: "Börsencrash nächstes Jahr",
      baby: "Wir bekommen 2028 ein Baby",
      retire: "Mit 60 in Rente gehen",
      invest: "500 pro Monat investieren",
    },
  },
} satisfies Messages;
