import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Linking, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Translate } from "../i18n";
import { normalizeServerUrl } from "../lib/serverUrl";
import { dark } from "../theme";
import { Button } from "./Button";

type Props = {
  t: Translate;
  /** Called once with a well-formed server address read from a QR code. */
  onAddress: (url: string) => void;
  onClose: () => void;
};

/** Full-screen QR reader for the server address that `npm run qr` prints on the computer. */
export function QrScanner({ t, onAddress, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [rejected, setRejected] = useState(false);
  const done = useRef(false);
  const asked = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !asked.current) {
      asked.current = true;
      void requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      if (done.current) return;
      const result = normalizeServerUrl(data);
      if (!result.ok) {
        setRejected(true);
        return;
      }
      done.current = true;
      onAddress(result.url);
    },
    [onAddress],
  );

  const text = { color: dark.ink, fontSize: 15, lineHeight: 22, textAlign: "center" as const };
  return (
    <View style={{ flex: 1, backgroundColor: "#000000" }}>
      <StatusBar style="light" />
      {permission?.granted && (
        <CameraView
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScanned}
        />
      )}
      <View style={{ flex: 1, justifyContent: "space-between", paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20, paddingHorizontal: 24 }}>
        <View style={{ gap: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, padding: 14 }}>
          <Text accessibilityRole="header" style={[text, { fontWeight: "600" }]}>
            {permission && !permission.granted ? t("scan.permission") : t("scan.title")}
          </Text>
          {permission?.granted && <Text style={[text, { fontSize: 13, color: dark.ink2 }]}>{t("scan.hint")}</Text>}
          {rejected && (
            <Text accessibilityLiveRegion="polite" style={[text, { fontSize: 13, color: dark.bad }]}>
              {t("scan.notAddress")}
            </Text>
          )}
        </View>
        <View style={{ gap: 10 }}>
          {permission && !permission.granted && (
            <Button
              primary
              palette={dark}
              label={permission.canAskAgain ? t("scan.allow") : t("scan.openSettings")}
              onPress={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
            />
          )}
          <View style={{ backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 10 }}>
            <Button palette={dark} label={t("scan.close")} onPress={onClose} />
          </View>
        </View>
      </View>
    </View>
  );
}
