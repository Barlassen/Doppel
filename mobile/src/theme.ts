import { Platform } from "react-native";

/** The palette of the web app (`src/app/globals.css`), light and dark, so the shell and the page read as one. */
export type Palette = {
  dark: boolean;
  bg: string;
  surface: string;
  surface2: string;
  line: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  bad: string;
};

export const light: Palette = {
  dark: false,
  bg: "#f6f5f1",
  surface: "#fcfcfb",
  surface2: "#f0eee8",
  line: "#e2dfd6",
  ink: "#0f1115",
  ink2: "#52514e",
  ink3: "#6b6861",
  accent: "#b3122e",
  bad: "#c42b1c",
};

export const dark: Palette = {
  dark: true,
  bg: "#111110",
  surface: "#1a1a19",
  surface2: "#232321",
  line: "#2f2e2b",
  ink: "#f0efec",
  ink2: "#c3c2b7",
  ink3: "#8f8d84",
  accent: "#e5484d",
  bad: "#ef5b4c",
};

export const paletteFor = (isDark: boolean): Palette => (isDark ? dark : light);

/** The web app sets its wordmark in a serif face. */
export const serif = Platform.select({ ios: "Georgia", default: "serif" });
export const mono = Platform.select({ ios: "Menlo", default: "monospace" });

/** Smallest comfortable touch target (dp). */
export const TOUCH = 48;
