import { getLocales } from "expo-localization";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { useColorScheme, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrowserScreen } from "./src/components/BrowserScreen";
import { Mark } from "./src/components/Mark";
import { SetupScreen } from "./src/components/SetupScreen";
import { pickLocale, translator } from "./src/i18n";
import { defaultServerUrl, loadServerUrl, saveServerUrl } from "./src/lib/storage";
import { paletteFor } from "./src/theme";

type Phase = "boot" | "setup" | "main";

/**
 * Doppel for Expo Go: a native shell around the Doppel web app.
 * boot (read the stored address) -> setup (ask for it) -> main (the WebView); "change address" goes back to setup.
 */
export default function App() {
  const deviceDark = useColorScheme() === "dark";
  const palette = paletteFor(deviceDark);
  const t = useMemo(() => translator(pickLocale(getLocales().map((locale) => locale.languageTag))), []);
  const [phase, setPhase] = useState<Phase>("boot");
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadServerUrl().then((stored) => {
      if (!alive) return;
      // A configured default is used as it is; if it is wrong, the failure screen offers "change address".
      const url = stored ?? defaultServerUrl();
      setServerUrl(url);
      setPhase(url ? "main" : "setup");
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SafeAreaProvider style={{ backgroundColor: palette.bg }}>
      {phase === "boot" && (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.bg }}>
          <StatusBar style={deviceDark ? "light" : "dark"} />
          <Mark size={56} color={palette.accent} />
        </View>
      )}
      {phase === "setup" && (
        <SetupScreen
          initial={serverUrl ?? ""}
          t={t}
          palette={palette}
          onConnected={(url) => {
            void saveServerUrl(url);
            setServerUrl(url);
            setPhase("main");
          }}
          onCancel={serverUrl ? () => setPhase("main") : undefined}
        />
      )}
      {phase === "main" && serverUrl && (
        // Keyed by the address: another server is another origin, with its own history and storage.
        <BrowserScreen
          key={serverUrl}
          serverUrl={serverUrl}
          t={t}
          deviceDark={deviceDark}
          onChangeAddress={() => setPhase("setup")}
        />
      )}
    </SafeAreaProvider>
  );
}
