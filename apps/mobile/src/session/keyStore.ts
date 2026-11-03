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

/** A Sign out the server has not heard yet, under its own key (18b-i): a sign-in never writes over it. */
export const phoneOwedStore: KeyStore = {
  read: () => SecureStore.getItemAsync("sign-out-owed"),
  write: (value) =>
    SecureStore.setItemAsync("sign-out-owed", value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  clear: () => SecureStore.deleteItemAsync("sign-out-owed"),
};
