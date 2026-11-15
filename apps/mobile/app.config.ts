// Which app a build is: a folder's copy, or the store's. Kd's one phone holds a copy for
// each folder on his laptop, side by side: each has its own name under the icon,
// its own application id, and talks only to its own folder's api (CLAUDE.md §8).
// The store's app, KWAZO, is the one Google Play gets (`KWAZO_BUILD=store`, scripts/store.mjs).
// Expo loads this file alone, so the rule lives here and imports no other .ts.
import { existsSync, readFileSync } from "node:fs";
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
  /** The folder's website as its own FOLDER.md runs it (its api's WEB_ORIGIN), the start of the links a member
   *  shares. The cable reaches it from the phone only on 127.0.0.1 (localhost): exercise folders' 127.0.0.2 and
   *  127.0.0.3 open on the laptop alone. */
  webUrl: string;
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
  const { name, apiPort, metroPort, webHost, webPort } = copies[key];
  return {
    key,
    name,
    applicationId: `com.aihomegym.dev.${key}`,
    scheme: `aihomegym-${key}`,
    apiUrl: `http://localhost:${String(apiPort)}`,
    webUrl: `http://${webHost}:${String(webPort)}`,
    metroPort,
  };
}

/** The online test server in place of the folder's own (ROADMAP Stage 5 item 21a-i): `PHONE_SERVER` is the
 *  api's https address and `PHONE_WEBSITE` the website's, set together when the bundler starts. The app reads
 *  them as it reads the folder's own, so the copy already installed needs no new build. Neither set: the cable. */
export function withServer(copy: Copy, env: Readonly<Record<string, string | undefined>>): Copy {
  const api = env.PHONE_SERVER?.trim() ?? "";
  const web = env.PHONE_WEBSITE?.trim() ?? "";
  if (api === "" && web === "") return copy;
  return { ...copy, apiUrl: httpsOrigin("PHONE_SERVER", api), webUrl: httpsOrigin("PHONE_WEBSITE", web) };
}

function httpsOrigin(name: string, written: string): string {
  const refused = new Error(`${name} must be an https address such as https://api.getkwazo.com. It holds "${written}".`);
  let url: URL;
  try {
    url = new URL(written);
  } catch {
    throw refused;
  }
  const bare = written.endsWith("/") ? written.slice(0, -1) : written;
  if (url.protocol !== "https:" || url.origin !== bare) throw refused;
  return url.origin;
}

/** Firebase's file for the Android app (ROADMAP Stage 5 item 18b-i), downloaded from the kwazo
 *  project's console and kept out of git: `apps/mobile/google-services.json`. A copy built without
 *  it runs, and gets no notifications. */
export const GOOGLE_SERVICES_FILE = "./google-services.json";

/** The photos permissions expo-screen-capture's Android code adds, kept out of the app. Its third,
 *  DETECT_SCREEN_CAPTURE, stays: from Android 14 the package watches for screenshots as it loads, and
 *  without it the app stops on opening (seen on Kd's phone, 2026-11-11). It asks the person nothing. */
export const SCREENSHOT_PERMISSIONS = ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.READ_MEDIA_IMAGES"];

/** The KWAZO wizard (ROADMAP Stage 5 item 21g): every file the phone needs, and the night colour behind
 *  Android's icon shapes, so no edge can show whatever shape a phone maker cuts. */
export const BRAND = {
  icon: "./assets/brand/icon.png",
  adaptiveForeground: "./assets/brand/adaptive-foreground.png",
  adaptiveMonochrome: "./assets/brand/adaptive-monochrome.png",
  iosTinted: "./assets/brand/icon-tinted.png",
  notificationIcon: "./assets/notification-icon.png",
  splash: "./assets/brand/splash.png",
  night: "#00001B",
  violet: "#5B35D0",
} as const;

/** The store's app (ROADMAP Stage 5 21c-i): the one Google Play gets and testers install. Google Play never lets
 *  its id change once a file is uploaded. It talks to the online server alone, over https, and names no copy. */
export const STORE = {
  name: "KWAZO",
  applicationId: "com.kwazo.app",
  scheme: "kwazo",
  apiUrl: "https://api.getkwazo.com",
  webUrl: "https://getkwazo.com",
  version: "1.0.0",
} as const;

/** What the store's app leaves out besides the screenshot block's: the bundler's overlay, which only a folder's
 *  copy uses, and setting the phone's own brightness, which nothing does (the pass brightens its own window). */
export const STORE_BLOCKED_PERMISSIONS = [
  ...SCREENSHOT_PERMISSIONS,
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.WRITE_SETTINGS",
];

/** Google Play's highest build number. Each upload must carry a higher one than every upload before it. */
export const MOST_VERSION_CODE = 2_100_000_000;

interface Build {
  name: string;
  applicationId: string;
  scheme: string;
  extra: PhoneAppExtra;
  version: string;
  versionCode?: number;
  blockedPermissions: readonly string[];
  firebase: boolean;
  signedForTheStore: boolean;
}

export function configFor(copy: Copy, firebase = false): ExpoConfig {
  return appConfig({
    name: copy.name,
    applicationId: copy.applicationId,
    scheme: copy.scheme,
    extra: { copyName: copy.name, apiUrl: copy.apiUrl, webUrl: copy.webUrl },
    version: "0.0.1",
    blockedPermissions: SCREENSHOT_PERMISSIONS,
    firebase,
    signedForTheStore: false,
  });
}

/** The Android apps Firebase's file names (`client[].client_info.android_client_info.package_name`). */
export function firebaseAppsIn(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  const clients: unknown = isRecord(parsed) ? parsed["client"] : undefined;
  if (!Array.isArray(clients)) return [];
  const listed: unknown[] = clients;
  return listed.flatMap((client) => {
    const info = isRecord(client) ? client["client_info"] : undefined;
    const android = isRecord(info) ? info["android_client_info"] : undefined;
    const name = isRecord(android) ? android["package_name"] : undefined;
    return typeof name === "string" ? [name] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The store's app. Refused, never guessed: a build number Google Play can take, Firebase's file naming this app
 *  (or testers get no notifications), and no folder's server address beside it. */
export function storeConfig(env: Readonly<Record<string, string | undefined>>, firebaseApps: readonly string[]): ExpoConfig {
  const written = env.KWAZO_VERSION_CODE?.trim() ?? "";
  const versionCode = /^[1-9]\d{0,9}$/.test(written) ? Number(written) : Number.NaN;
  if (!(versionCode <= MOST_VERSION_CODE)) {
    throw new Error(`KWAZO_VERSION_CODE must be a whole number from 1 to ${String(MOST_VERSION_CODE)}. It holds "${written}".`);
  }
  if (!firebaseApps.includes(STORE.applicationId)) {
    throw new Error(
      `google-services.json has no Android app ${STORE.applicationId}: add it to the kwazo project in Firebase and download the file again.`,
    );
  }
  for (const name of ["PHONE_SERVER", "PHONE_WEBSITE"] as const) {
    if ((env[name]?.trim() ?? "") !== "") throw new Error(`${name} is for a folder's copy. The store's app talks to ${STORE.apiUrl} alone.`);
  }
  return appConfig({
    name: STORE.name,
    applicationId: STORE.applicationId,
    scheme: STORE.scheme,
    extra: { apiUrl: STORE.apiUrl, webUrl: STORE.webUrl },
    version: STORE.version,
    versionCode,
    blockedPermissions: STORE_BLOCKED_PERMISSIONS,
    firebase: true,
    signedForTheStore: true,
  });
}

function appConfig(build: Build): ExpoConfig {
  const { extra } = build;
  return {
    name: build.name,
    slug: "ai-home-gym",
    version: build.version,
    orientation: "portrait",
    // Dark only, as the member web is (spec Part 6 §16.3a); the colour is the look's page.
    userInterfaceStyle: "dark",
    backgroundColor: "#0A0908",
    scheme: build.scheme,
    icon: BRAND.icon,
    // The picture is already a night scene, so iOS's dark look uses it as it is; the tinted look gets it in grey.
    ios: { icon: { light: BRAND.icon, dark: BRAND.icon, tinted: BRAND.iosTinted } },
    android: {
      package: build.applicationId,
      ...(build.versionCode === undefined ? {} : { versionCode: build.versionCode }),
      adaptiveIcon: { foregroundImage: BRAND.adaptiveForeground, backgroundColor: BRAND.night, monochromeImage: BRAND.adaptiveMonochrome },
      allowBackup: false,
      // expo-screen-capture (Add card, 20d) asks for these to tell the app a screenshot was taken on older Androids, which
      // nothing here uses; blanking a page needs neither, and Google Play asks a declaration for the photos permission.
      blockedPermissions: [...build.blockedPermissions],
      ...(build.firebase ? { googleServicesFile: GOOGLE_SERVICES_FILE } : {}),
    },
    // Keeps the key store's sign-in out of Android's backups, so it never lands on another phone.
    // shortNativeBuild: C++ build folders kept under Windows' path limit (its own file says why).
    // The meal photo (ROADMAP Stage 5 33b-i): the camera and the photos the person picks, and never the
    // microphone, which no feature uses.
    plugins: [
      "expo-secure-store",
      ["expo-camera", { cameraPermission: "Allow $(PRODUCT_NAME) to take photos of your meals and your gym's updates.", microphonePermission: false, recordAudioAndroid: false }],
      ["expo-image-picker", { photosPermission: "Allow $(PRODUCT_NAME) to open the photos you pick.", microphonePermission: false }],
      // A gym's messages as notifications (18b-i): the small icon and its colour on Android's bar.
      ["expo-notifications", { icon: BRAND.notificationIcon, color: BRAND.violet }],
      // Record a run (37a): the location while the app is in use, kept through a locked screen by a
      // service with its notification. Never "all the time": Android's own rule is that a service the
      // person starts keeps the location they gave the app in use.
      [
        "expo-location",
        {
          locationWhenInUsePermission: "Allow $(PRODUCT_NAME) to measure your runs.",
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: true,
          isIosBackgroundLocationEnabled: false,
        },
      ],
      // The opening screen (21g): the wizard and his ring on the night colour, centred at every size. Android 12 and
      // later always show it inside a circle, so the picture keeps everything within one.
      ["expo-splash-screen", { image: BRAND.splash, backgroundColor: BRAND.night, imageWidth: 240, resizeMode: "contain" }],
      "./plugins/shortNativeBuild.js",
      // The store's file is signed with KWAZO's own upload key, never the development one (21c-i).
      ...(build.signedForTheStore ? ["./plugins/storeSigning.js"] : []),
    ],
    extra,
  };
}

function setting(env: Readonly<Record<string, string | undefined>>, name: string): string {
  return env[name]?.trim() ?? "";
}

// The store's build says so (`KWAZO_BUILD=store`, set by scripts/store.mjs); every other build is a folder's
// copy and must say which.
export default function config(): ExpoConfig {
  const build = setting(process.env, "KWAZO_BUILD");
  if (build === "store") {
    const file = join(__dirname, GOOGLE_SERVICES_FILE);
    return storeConfig(process.env, existsSync(file) ? firebaseAppsIn(readFileSync(file, "utf8")) : []);
  }
  if (build !== "") throw new Error(`KWAZO_BUILD is "store" for the store's app, or unset for a folder's copy. It holds "${build}".`);
  let written: string;
  try {
    written = readFileSync(join(__dirname, ".copy"), "utf8");
  } catch {
    throw new Error(
      `apps/mobile/.copy is missing. Write one word in it: ${COPY_KEYS.join(", ")}.`,
    );
  }
  return configFor(withServer(copyFor(written), process.env), existsSync(join(__dirname, GOOGLE_SERVICES_FILE)));
}
