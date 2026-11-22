import Feather from "@expo/vector-icons/Feather";
import Constants from "expo-constants";
import { Pressable, Text, View } from "react-native";
import type { Translate } from "../i18n";
import type { ServerStatus } from "../lib/probe";
import type { Palette } from "../theme";
import { mono, TOUCH } from "../theme";
import { Button } from "./Button";

type Props = {
  address: string;
  /** Last answer of `/api/twin`; null when the server did not answer. */
  status: ServerStatus | null;
  t: Translate;
  palette: Palette;
  bottomInset: number;
  onReload: () => void;
  onChangeAddress: () => void;
  onClose: () => void;
};

export function SettingsSheet({ address, status, t, palette, bottomInset, onReload, onChangeAddress, onClose }: Props) {
  const label = { color: palette.ink3, fontSize: 12, fontWeight: "600" as const };
  const value = { color: palette.ink, fontSize: 14, flexShrink: 1 };
  const app = t("settings.appValue", {
    version: Constants.expoConfig?.version ?? "?",
    sdk: (Constants.expoConfig?.sdkVersion ?? "?").split(".")[0],
  });
  const assistant = !status
    ? t("settings.unknown")
    : status.configured
      ? t("settings.assistantOn", { provider: status.provider ?? "?" })
      : t("settings.assistantOff");
  const rows: [string, string][] = [
    [t("settings.app"), app],
    [t("settings.serverVersion"), status?.version ?? (status ? t("settings.notReported") : t("settings.unknown"))],
    [t("settings.assistant"), assistant],
  ];

  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end" }}>
      <Pressable
        accessibilityLabel={t("settings.close")}
        accessibilityRole="button"
        onPress={onClose}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.4)" }}
      />
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: palette.surface,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          borderTopWidth: 1,
          borderColor: palette.line,
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: bottomInset + 20,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 18, fontWeight: "600" }}>
            {t("settings.title")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.close")}
            onPress={onClose}
            style={{ width: TOUCH, height: TOUCH, alignItems: "flex-end", justifyContent: "center" }}
          >
            <Feather name="x" size={20} color={palette.ink2} />
          </Pressable>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={label}>{t("settings.server")}</Text>
          <Text selectable style={[value, { fontFamily: mono }]}>{address}</Text>
        </View>
        <View style={{ gap: 10 }}>
          <Button label={t("action.changeAddress")} onPress={onChangeAddress} palette={palette} />
          <Button label={t("settings.reload")} onPress={onReload} palette={palette} />
        </View>

        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 14 }}>
          <Text style={label}>{t("settings.versions")}</Text>
          {rows.map(([name, text]) => (
            <View key={name} style={{ flexDirection: "row", gap: 12 }}>
              <Text style={{ color: palette.ink2, fontSize: 14, width: 96 }}>{name}</Text>
              <Text style={value}>{text}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
