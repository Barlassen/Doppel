import { Text, View } from "react-native";

/** Doppel's mark as the web header draws it: a red rounded square with a white "D". */
export function Mark({ size, color }: { size: number; color: string }) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text allowFontScaling={false} style={{ color: "#ffffff", fontSize: size * 0.5, fontWeight: "700", lineHeight: size * 0.62 }}>
        D
      </Text>
    </View>
  );
}
