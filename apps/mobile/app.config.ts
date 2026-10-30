// Which folder's copy of the app a build is. Kd's one phone holds a copy for
// each folder on his laptop, side by side: each has its own name under the icon,
// its own application id, and talks only to its own folder's api (CLAUDE.md §8).
// Expo loads this file alone, so the rule lives here and imports no other .ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExpoConfig } from "expo/config";
import type { PhoneAppExtra } from "@app/shared";
import copies from "./copies.json";

export interface Copy {
  key: string;
  /** Under the icon and on the first screen. */
  name: string;
  applicationId: string;
  scheme: string;
  /** Reached through the USB cable (`adb reverse`), so the phone's own localhost. */
  apiUrl: string;
  metroPort: number;
}

export const COPY_KEYS: readonly string[] = Object.keys(copies);

function isCopyKey(key: string): key is keyof typeof copies {
  return Object.hasOwn(copies, key);
}

/** The copy a folder's `.copy` file names. Anything else is refused, never guessed. */
export function copyFor(written: string): Copy {
  const key = written.trim();
  if (!isCopyKey(key)) {
    throw new Error(
      `apps/mobile/.copy must hold one of: ${COPY_KEYS.join(", ")}. It holds "${key}".`,
    );
  }
  const { name, apiPort, metroPort } = copies[key];
  return {
    key,
    name,
    applicationId: `com.aihomegym.dev.${key}`,
    scheme: `aihomegym-${key}`,
    apiUrl: `http://localhost:${String(apiPort)}`,
    metroPort,
  };
}

export function configFor(copy: Copy): ExpoConfig {
  const extra: PhoneAppExtra = { copyName: copy.name, apiUrl: copy.apiUrl };
  return {
    name: copy.name,
    slug: "ai-home-gym",
    version: "0.0.1",
    orientation: "portrait",
    // Dark only, as the member web is (spec Part 6 §16.3a); the colour is the look's page.
    userInterfaceStyle: "dark",
    backgroundColor: "#0A0908",
    scheme: copy.scheme,
    android: { package: copy.applicationId },
    // Keeps the key store's sign-in out of Android's backups, so it never lands on another phone.
    // shortNativeBuild: C++ build folders kept under Windows' path limit (its own file says why).
    // The meal photo (ROADMAP Stage 5 33b-i): the camera and the photos the person picks, and never the
    // microphone, which no feature uses.
    plugins: [
      "expo-secure-store",
      ["expo-camera", { cameraPermission: "Allow $(PRODUCT_NAME) to take photos of your meals and for your gym's updates.", microphonePermission: false, recordAudioAndroid: false }],
      ["expo-image-picker", { photosPermission: "Allow $(PRODUCT_NAME) to open the photos you pick.", microphonePermission: false }],
      "./plugins/shortNativeBuild.js",
    ],
    extra,
  };
}

// The store's app gets its own name and id with the store job (ROADMAP Stage 5
// item 21). Until then every build is a folder's copy and must say which.
export default function config(): ExpoConfig {
  let written: string;
  try {
    written = readFileSync(join(__dirname, ".copy"), "utf8");
  } catch {
    throw new Error(
      `apps/mobile/.copy is missing. Write one word in it: ${COPY_KEYS.join(", ")}.`,
    );
  }
  return configFor(copyFor(written));
}
