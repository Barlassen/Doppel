import DoppelApp from "@/components/DoppelApp";

import { I18nProvider } from "@/lib/i18n/I18nProvider";

export default function Home() {
  return <I18nProvider><DoppelApp /></I18nProvider>;
}
