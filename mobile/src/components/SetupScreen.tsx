import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { BackHandler, KeyboardAvoidingView, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Translate } from "../i18n";
import { checkServer } from "../lib/check";
import type { Failure } from "../lib/check";
import { normalizeServerUrl } from "../lib/serverUrl";
import type { Palette } from "../theme";
import { mono, serif, TOUCH } from "../theme";
import { Button } from "./Button";
import { Mark } from "./Mark";
import { QrScanner } from "./QrScanner";

const EXAMPLE = "http://192.168.1.20:3000";

type Props = {
  /** Address to start from: the current one when changing it, or the configured default. */
  initial: string;
  t: Translate;
  palette: Palette;
  /** The address answered as a Doppel server. */
  onConnected: (url: string) => void;
  /** Present when there is an address to go back to. */
  onCancel?: () => void;
};

type Problem = { kind: "invalid" } | { kind: "failure"; failure: Failure; address: string };

/** First run and "change address": type or scan the server address; it is kept only once the server answered. */
export function SetupScreen({ initial, t, palette, onConnected, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [scanning, setScanning] = useState(false);

  const connect = useCallback(
    async (input: string) => {
      const result = normalizeServerUrl(input);
      if (!result.ok) {
        setProblem({ kind: "invalid" });
        return;
      }
      setText(result.url);
      setProblem(null);
      setBusy(true);
      const check = await checkServer(result.url);
      setBusy(false);
      if (check.ok) onConnected(result.url);
      else setProblem({ kind: "failure", failure: check.failure, address: result.url });
    },
    [onConnected],
  );

  useEffect(() => {
    if (!onCancel || scanning) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [onCancel, scanning]);

  if (scanning) {
    return (
      <QrScanner
        t={t}
        onClose={() => setScanning(false)}
        onAddress={(url) => {
          setScanning(false);
          void connect(url);
        }}
      />
    );
  }

  const message = !problem
    ? null
    : problem.kind === "invalid"
      ? t("error.invalid", { example: EXAMPLE })
      : `${t(`error.${problem.failure.kind}.title`)}. ${t(`error.${problem.failure.kind}.body`, {
          address: problem.address,
          detail: problem.failure.detail ?? "",
        })}`;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: palette.bg }}>
      <StatusBar style={palette.dark ? "light" : "dark"} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 24,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Mark size={32} color={palette.accent} />
          <Text style={{ color: palette.ink, fontSize: 28, fontFamily: serif }}>Doppel</Text>
        </View>
        <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 20, fontWeight: "600", marginTop: 8 }}>
          {t("setup.title")}
        </Text>
        <Text style={{ color: palette.ink2, fontSize: 15, lineHeight: 22 }}>{t("setup.body")}</Text>

        <View style={{ gap: 6, marginTop: 6 }}>
          <Text style={{ color: palette.ink3, fontSize: 12, fontWeight: "600" }}>{t("setup.label")}</Text>
          <TextInput
            accessibilityLabel={t("setup.label")}
            value={text}
            onChangeText={(next) => {
              setText(next);
              setProblem(null);
            }}
            onSubmitEditing={() => void connect(text)}
            editable={!busy}
            placeholder={EXAMPLE}
            placeholderTextColor={palette.ink3}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            keyboardType="url"
            inputMode="url"
            returnKeyType="go"
            style={{
              minHeight: TOUCH,
              borderWidth: 1,
              borderColor: problem ? palette.bad : palette.line,
              borderRadius: 10,
              backgroundColor: palette.surface,
              color: palette.ink,
              fontFamily: mono,
              fontSize: 15,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          />
          {message && (
            <Text accessibilityLiveRegion="polite" style={{ color: palette.bad, fontSize: 14, lineHeight: 20 }}>
              {message}
            </Text>
          )}
        </View>

        <View style={{ gap: 10, marginTop: 6 }}>
          <Button
            primary
            label={busy ? t("setup.connecting") : t("setup.connect")}
            busy={busy}
            onPress={() => void connect(text)}
            palette={palette}
          />
          <Button label={t("setup.scan")} disabled={busy} onPress={() => setScanning(true)} palette={palette} />
          {onCancel && <Button label={t("setup.cancel")} disabled={busy} onPress={onCancel} palette={palette} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
