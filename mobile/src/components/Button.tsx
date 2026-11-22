import { ActivityIndicator, Pressable, Text } from "react-native";
import type { Palette } from "../theme";
import { TOUCH } from "../theme";

type Props = {
  label: string;
  onPress: () => void;
  palette: Palette;
  /** `primary` is the one filled button of a screen; the rest are outlined. */
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
};

export function Button({ label, onPress, palette, primary = false, busy = false, disabled = false }: Props) {
  const off = disabled || busy;
  const foreground = primary ? palette.bg : palette.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      android_ripple={{ color: palette.line }}
      style={{
        minHeight: TOUCH,
        borderRadius: 10,
        paddingHorizontal: 18,
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: primary ? palette.ink : "transparent",
        borderWidth: primary ? 0 : 1,
        borderColor: palette.line,
        opacity: off ? 0.6 : 1,
      }}
    >
      {busy && <ActivityIndicator size="small" color={foreground} />}
      <Text style={{ color: foreground, fontSize: 15, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
