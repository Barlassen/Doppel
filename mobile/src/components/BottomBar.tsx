import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import type { Translate } from "../i18n";
import type { Route } from "../lib/routes";
import type { Palette } from "../theme";
import { TOUCH } from "../theme";

type Props = {
  current: Route;
  t: Translate;
  palette: Palette;
  bottomInset: number;
  onRoute: (route: Route) => void;
  onSettings: () => void;
};

const TABS: { route: Route; icon: ComponentProps<typeof Feather>["name"]; label: "nav.dashboard" | "nav.play" }[] = [
  { route: "dashboard", icon: "bar-chart-2", label: "nav.dashboard" },
  { route: "play", icon: "play", label: "nav.play" },
];

/** Two destinations and a settings button. Quiet on purpose: the page above it is the product. */
export function BottomBar({ current, t, palette, bottomInset, onRoute, onSettings }: Props) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "stretch",
        backgroundColor: palette.surface,
        borderTopWidth: 1,
        borderTopColor: palette.line,
        paddingBottom: bottomInset,
        paddingHorizontal: 8,
      }}
    >
      <View accessibilityRole="tablist" accessibilityLabel={t("nav.aria")} style={{ flex: 1, flexDirection: "row" }}>
        {TABS.map((tab) => {
          const active = tab.route === current;
          const color = active ? palette.ink : palette.ink3;
          return (
            <Pressable
              key={tab.route}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onRoute(tab.route)}
              android_ripple={{ color: palette.line, borderless: true }}
              style={{ flex: 1, minHeight: TOUCH + 4, alignItems: "center", justifyContent: "center", gap: 2 }}
            >
              <View style={{ height: 2, width: 20, borderRadius: 1, backgroundColor: active ? palette.accent : "transparent" }} />
              <Feather name={tab.icon} size={18} color={color} />
              <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: active ? "600" : "500" }}>
                {t(tab.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("nav.settings")}
        onPress={onSettings}
        android_ripple={{ color: palette.line, borderless: true }}
        style={{ width: TOUCH + 8, minHeight: TOUCH + 4, alignItems: "center", justifyContent: "center" }}
      >
        <Feather name="settings" size={18} color={palette.ink3} />
      </Pressable>
    </View>
  );
}
