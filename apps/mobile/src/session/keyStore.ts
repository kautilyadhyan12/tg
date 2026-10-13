import * as SecureStore from "expo-secure-store";
import type { KeyStore } from "./session";

const KEY = "session";

/** Android's Keystore and the iPhone's Keychain, never plain storage (CLAUDE.md §4). */
export const phoneKeyStore: KeyStore = {
  read: () => SecureStore.getItemAsync(KEY),
  write: (value) =>
    SecureStore.setItemAsync(KEY, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
