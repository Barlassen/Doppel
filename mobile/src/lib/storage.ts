import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { normalizeServerUrl } from "./serverUrl";

const KEY = "doppel.serverUrl";

/** The address the user confirmed earlier, or null. It is not a secret, so plain AsyncStorage is enough. */
export async function loadServerUrl(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    const result = stored ? normalizeServerUrl(stored) : null;
    return result?.ok ? result.url : null;
  } catch {
    return null;
  }
}

export async function saveServerUrl(url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, url);
  } catch {
    // The address still works for this session; the setup screen simply appears again next time.
  }
}

/** Optional default: env `EXPO_PUBLIC_DOPPEL_URL` (inlined by Metro) or `expo.extra.doppelUrl` in app.json. */
export function defaultServerUrl(): string | null {
  const extra: unknown = Constants.expoConfig?.extra?.doppelUrl;
  const configured = process.env.EXPO_PUBLIC_DOPPEL_URL || (typeof extra === "string" ? extra : "");
  const result = configured ? normalizeServerUrl(configured) : null;
  return result?.ok ? result.url : null;
}
