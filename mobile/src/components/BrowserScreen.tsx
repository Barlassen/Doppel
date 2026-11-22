import Feather from "@expo/vector-icons/Feather";
import { useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, BackHandler, Keyboard, KeyboardAvoidingView, Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import type { Translate } from "../i18n";
import { bridgeScript, navigateScript, parseBridgeMessage, RELOAD_SCRIPT, setCameraScript } from "../lib/bridge";
import type { CameraState } from "../lib/bridge";
import { checkServer } from "../lib/check";
import type { Failure } from "../lib/check";
import type { ServerStatus } from "../lib/probe";
import { ROUTE_PATHS, routeForPath } from "../lib/routes";
import type { Route } from "../lib/routes";
import { classifyNavigation, originOf, pathOf } from "../lib/serverUrl";
import { paletteFor } from "../theme";
import { BottomBar } from "./BottomBar";
import { FailureView } from "./FailureView";
import { SettingsSheet } from "./SettingsSheet";

type Props = {
  serverUrl: string;
  t: Translate;
  /** The device's colour scheme, used until the page reports its own. */
  deviceDark: boolean;
  onChangeAddress: () => void;
};

const fill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

/** The Doppel web app in a WebView, with the native pieces around it: bars, loading line, failure states. */
export function BrowserScreen({ serverUrl, t, deviceDark, onChangeAddress }: Props) {
  const insets = useSafeAreaInsets();
  // `WebView<object>`: the library's default type argument (`undefined`) turns its props into `never`.
  const web = useRef<WebView<object>>(null);
  const path = useRef("/");

  const [route, setRoute] = useState<Route>("dashboard");
  const [canGoBack, setCanGoBack] = useState(false);
  const [pageDark, setPageDark] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // A new key mounts a fresh WebView at the last known path: after a failed load or a dead render process.
  const [webKey, setWebKey] = useState(0);
  const progress = useRef(new Animated.Value(0.1)).current;
  const pull = useRef(new Animated.Value(0)).current;
  const palette = paletteFor(pageDark ?? deviceDark);

  const setPath = useCallback((next: string) => {
    path.current = next;
    setRoute(routeForPath(next));
  }, []);

  // --- is the server there, and is it Doppel? ---
  const latestCheck = useRef(0);
  const verify = useCallback(
    async (pageError?: string): Promise<boolean> => {
      const id = ++latestCheck.current;
      const result = await checkServer(serverUrl);
      if (id !== latestCheck.current) return false;
      setStatus(result.ok ? result.status : null);
      if (!result.ok) setFailure(result.failure);
      else if (pageError) setFailure({ kind: "page", detail: pageError });
      return result.ok;
    },
    [serverUrl],
  );
  useEffect(() => {
    void verify();
  }, [verify]);

  const retry = useCallback(async () => {
    setRetrying(true);
    const ok = await verify();
    setRetrying(false);
    if (!ok) return;
    setFailure(null);
    setLoading(true);
    progress.setValue(0.1);
    setWebKey((key) => key + 1);
  }, [progress, verify]);

  // --- camera permission for file inputs (see lib/bridge.ts) ---
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraRefused, setCameraRefused] = useState(false);
  const camera: CameraState = permission?.granted
    ? "granted"
    : cameraRefused || (permission?.status === "denied" && !permission.canAskAgain)
      ? "denied"
      : "ask";
  useEffect(() => {
    web.current?.injectJavaScript(setCameraScript(camera));
  }, [camera]);
  const askCamera = useCallback(async () => {
    try {
      if (!(await requestPermission()).granted) setCameraRefused(true);
    } catch {
      setCameraRefused(true);
    }
  }, [requestPermission]);

  const settlePull = useCallback(() => {
    setRefreshing(false);
    // JS-driven on purpose: the same value is also set directly from the page's touch reports.
    Animated.timing(pull, { toValue: 0, duration: 160, useNativeDriver: false }).start();
  }, [pull]);

  const reload = useCallback(() => {
    if (failure) void retry();
    else web.current?.injectJavaScript(RELOAD_SCRIPT);
  }, [failure, retry]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (originOf(event.nativeEvent.url) !== serverUrl) return;
      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message) return;
      switch (message.t) {
        case "loc":
          setPath(message.path);
          break;
        case "scheme":
          setPageDark(message.dark);
          break;
        case "pull":
          pull.setValue(Math.min(message.p, 1.15));
          break;
        case "pullEnd":
          if (message.refresh) {
            setRefreshing(true);
            pull.setValue(1);
            web.current?.injectJavaScript(RELOAD_SCRIPT);
          } else settlePull();
          break;
        case "camera":
          void askCamera();
          break;
      }
    },
    [askCamera, pull, serverUrl, setPath, settlePull],
  );

  const goTo = useCallback(
    (next: Route) => {
      if (failure) {
        setPath(ROUTE_PATHS[next]);
        void retry();
      } else if (next !== route) {
        web.current?.injectJavaScript(navigateScript(ROUTE_PATHS[next]));
      }
    },
    [failure, retry, route, setPath],
  );

  // Android back: close the sheet, else go back in the page's history, else leave the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (!failure && canGoBack) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [canGoBack, failure, settingsOpen]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // The source must not change with every navigation, or the WebView would load it again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const source = useMemo(() => ({ uri: `${serverUrl}${path.current}` }), [serverUrl, webKey]);
  const script = useMemo(() => bridgeScript(camera), [camera]);
  const blank = useCallback(() => <View style={[fill, { backgroundColor: palette.bg }]} />, [palette.bg]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <StatusBar style={palette.dark ? "light" : "dark"} />
      <View style={{ height: insets.top, backgroundColor: palette.bg }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right, overflow: "hidden" }}>
          <WebView
            key={webKey}
            ref={web}
            source={source}
            style={{ flex: 1, backgroundColor: palette.bg }}
            containerStyle={{ backgroundColor: palette.bg }}
            // localStorage holds the twin; keep the WebView's own storage and cache on.
            domStorageEnabled
            javaScriptEnabled
            cacheEnabled
            incognito={false}
            overScrollMode="never"
            injectedJavaScriptBeforeContentLoaded={script}
            injectedJavaScript={script}
            onMessage={onMessage}
            onNavigationStateChange={(state) => {
              setCanGoBack(state.canGoBack);
              if (originOf(state.url) === serverUrl) setPath(pathOf(state.url));
            }}
            onShouldStartLoadWithRequest={(request) => {
              if (request.isTopFrame === false || classifyNavigation(request.url, serverUrl) === "internal") return true;
              Linking.openURL(request.url).catch(() => {});
              return false;
            }}
            onLoadProgress={({ nativeEvent }) => {
              progress.setValue(Math.max(0.1, nativeEvent.progress));
              setLoading(nativeEvent.progress < 1);
            }}
            onLoadEnd={() => {
              setLoading(false);
              if (refreshing) settlePull();
            }}
            onError={({ nativeEvent }) => void verify(nativeEvent.description || String(nativeEvent.code))}
            onHttpError={({ nativeEvent }) =>
              void verify(nativeEvent.statusCode >= 500 ? `HTTP ${nativeEvent.statusCode}` : undefined)
            }
            onRenderProcessGone={() => setWebKey((key) => key + 1)}
            renderError={blank}
            renderLoading={blank}
          />

          {/* Pull-to-refresh indicator, driven by the page's touch reports. */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              alignSelf: "center",
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.line,
              opacity: pull.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
              transform: [
                { translateY: pull.interpolate({ inputRange: [0, 1.15], outputRange: [-40, 34] }) },
                { rotate: pull.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "180deg"] }) },
              ],
            }}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <Feather name="arrow-down" size={18} color={palette.ink2} />
            )}
          </Animated.View>

          {loading && !failure && (
            <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2 }}>
              <Animated.View
                accessibilityRole="progressbar"
                style={{
                  height: 2,
                  backgroundColor: palette.accent,
                  width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                }}
              />
            </View>
          )}

          {failure && (
            <View style={fill}>
              <FailureView
                failure={failure}
                address={serverUrl}
                t={t}
                palette={palette}
                busy={retrying}
                onRetry={() => void retry()}
                onChangeAddress={onChangeAddress}
              />
            </View>
          )}
        </View>

        {!keyboardOpen && (
          <BottomBar
            current={route}
            t={t}
            palette={palette}
            bottomInset={insets.bottom}
            onRoute={goTo}
            onSettings={() => {
              setSettingsOpen(true);
              void checkServer(serverUrl).then((result) => setStatus(result.ok ? result.status : null));
            }}
          />
        )}
      </KeyboardAvoidingView>

      {settingsOpen && (
        <SettingsSheet
          address={serverUrl}
          status={status}
          t={t}
          palette={palette}
          bottomInset={insets.bottom}
          onClose={() => setSettingsOpen(false)}
          onReload={() => {
            setSettingsOpen(false);
            reload();
          }}
          onChangeAddress={() => {
            setSettingsOpen(false);
            onChangeAddress();
          }}
        />
      )}
    </View>
  );
}
