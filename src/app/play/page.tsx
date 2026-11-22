import type { Metadata } from "next";
import PlayApp from "@/components/play/PlayApp";
import { I18nProvider } from "@/lib/i18n/I18nProvider";

export const metadata: Metadata = {
  title: "Doppel Play — the life game",
  description: "Play your next ten years against Life; a search engine over possible futures reviews every move.",
  icons: { icon: "/icon.svg" },
};

export default function PlayPage() {
  return <I18nProvider><PlayApp /></I18nProvider>;
}
