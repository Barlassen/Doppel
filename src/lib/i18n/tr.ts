import { en } from "./en";
import type { Messages } from "./types";

// Phase A fallback. Phase B replaces this with a complete dictionary.
export const tr = {
  ...en,
  cmd: {
    ...en.cmd,
    examples: {
      jobLoss: "2028'de 6 ay işsiz kalırsam ne olur?",
      delay: "Ev alımını 2 yıl ertele",
      crash: "Gelecek yıl borsa çöküşü",
      baby: "2028'de bebeğimiz olursa",
      retire: "60 yaşında emekli ol",
      invest: "Ayda 500 yatırım yap",
    },
  },
} satisfies Messages;
