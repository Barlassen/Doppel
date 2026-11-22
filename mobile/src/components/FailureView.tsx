import { ScrollView, Text, View } from "react-native";
import type { Translate } from "../i18n";
import type { Failure } from "../lib/check";
import type { Palette } from "../theme";
import { Button } from "./Button";
import { Mark } from "./Mark";

type Props = {
  failure: Failure;
  address: string;
  t: Translate;
  palette: Palette;
  busy: boolean;
  onRetry: () => void;
  onChangeAddress: () => void;
};

/** What the user sees instead of a blank page: what went wrong, at which address, and the two ways out. */
export function FailureView({ failure, address, t, palette, busy, onRetry, onChangeAddress }: Props) {
  const params = { address, detail: failure.detail ?? "" };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.bg }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 14 }}
    >
      <Mark size={36} color={palette.accent} />
      <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 22, fontWeight: "600" }}>
        {t(`error.${failure.kind}.title`)}
      </Text>
      <Text accessibilityLiveRegion="polite" style={{ color: palette.ink2, fontSize: 15, lineHeight: 22 }}>
        {t(`error.${failure.kind}.body`, params)}
      </Text>
      <View style={{ gap: 10, marginTop: 10 }}>
        <Button primary label={t("action.retry")} onPress={onRetry} busy={busy} palette={palette} />
        <Button label={t("action.changeAddress")} onPress={onChangeAddress} disabled={busy} palette={palette} />
      </View>
    </ScrollView>
  );
}
