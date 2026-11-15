import { describe, expect, it } from "vitest";
import {
  NEVER_IN_THE_STORE,
  PAGE_16_KB,
  STORE_ID,
  cleartextIn,
  declaredPermissions,
  fingerprintsIn,
  loadAlignments,
  readBadging,
  storeFaults,
  xmlResources,
  type StoreFacts,
} from "../scripts/storeCheck.mjs";
import { STORE, STORE_BLOCKED_PERMISSIONS } from "../app.config";

/** A native library's header as the linker writes it: 64-bit (arm64-v8a, x86_64) or 32-bit, with its program
 *  headers (type 1 is a part that is loaded, 4 a note). */
function elf(wide: boolean, headers: { type: number; align: number }[]): Uint8Array {
  const headerSize = wide ? 64 : 52;
  const entrySize = wide ? 56 : 32;
  const b = Buffer.alloc(headerSize + entrySize * headers.length);
  b.writeUInt32BE(0x7f454c46, 0);
  b[4] = wide ? 2 : 1;
  b[5] = 1;
  if (wide) {
    b.writeBigUInt64LE(BigInt(headerSize), 0x20);
    b.writeUInt16LE(entrySize, 0x36);
    b.writeUInt16LE(headers.length, 0x38);
  } else {
    b.writeUInt32LE(headerSize, 0x1c);
    b.writeUInt16LE(entrySize, 0x2a);
    b.writeUInt16LE(headers.length, 0x2c);
  }
  headers.forEach((h, i) => {
    const at = headerSize + i * entrySize;
    b.writeUInt32LE(h.type, at);
    if (wide) b.writeBigUInt64LE(BigInt(h.align), at + 0x30);
    else b.writeUInt32LE(h.align, at + 0x1c);
  });
  return b;
}

describe("a native library's memory alignment, from its own header", () => {
  it("reads every loaded part of a 64-bit library and skips the rest", () => {
    expect(loadAlignments(elf(true, [{ type: 1, align: 0x4000 }, { type: 4, align: 4 }, { type: 1, align: 0x10000 }]))).toEqual([16384, 65536]);
  });
  it("reads a 32-bit one", () => {
    expect(loadAlignments(elf(false, [{ type: 1, align: 0x1000 }]))).toEqual([4096]);
  });
  it("gives nothing for a file that is not one, or is cut short", () => {
    expect(loadAlignments(Buffer.from("not a library at all, just words".repeat(3)))).toBeNull();
    expect(loadAlignments(elf(true, [{ type: 1, align: 0x4000 }]).subarray(0, 80))).toBeNull();
    const bigEndian = Buffer.from(elf(true, [{ type: 1, align: 0x4000 }]));
    bigEndian[5] = 2;
    expect(loadAlignments(bigEndian)).toBeNull();
  });
});

// Printed by the Android SDK's build tools 36.0.0 and JDK 17's keytool, shortened to the lines read.
const BADGING = `package: name='com.kwazo.app' versionCode='459876' versionName='1.0.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
sdkVersion:'24'
targetSdkVersion:'36'
uses-permission: name='android.permission.ACCESS_COARSE_LOCATION'
uses-permission: name='android.permission.CAMERA'
uses-permission: name='android.permission.FOREGROUND_SERVICE_LOCATION'
uses-permission: name='android.permission.POST_NOTIFICATIONS'
uses-permission: name='android.permission.WRITE_EXTERNAL_STORAGE' maxSdkVersion='32'
uses-permission: name='android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32'
uses-implied-permission: name='android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32' reason='requested WRITE_EXTERNAL_STORAGE'
application-label:'KWAZO'
`;
// The first store build's own manifest as `aapt2 dump xmltree --file AndroidManifest.xml` printed it (2026-11-15),
// shortened. Badging above prints READ_EXTERNAL_STORAGE, which this manifest never asks for.
const MANIFEST = `N: android=http://schemas.android.com/apk/res/android (line=2)
  E: manifest (line=2)
    A: package="com.kwazo.app" (Raw: "com.kwazo.app")
      E: uses-sdk (line=7)
        A: http://schemas.android.com/apk/res/android:targetSdkVersion(0x01010270)=36
      E: uses-permission (line=11)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.ACCESS_COARSE_LOCATION" (Raw: "android.permission.ACCESS_COARSE_LOCATION")
      E: uses-permission (line=13)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.CAMERA" (Raw: "android.permission.CAMERA")
      E: uses-permission (line=18)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.WRITE_EXTERNAL_STORAGE" (Raw: "android.permission.WRITE_EXTERNAL_STORAGE")
        A: http://schemas.android.com/apk/res/android:maxSdkVersion(0x01010271)=32
      E: queries (line=22)
          E: intent (line=23)
              E: action (line=24)
                A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.VIEW" (Raw: "android.intent.action.VIEW")
      E: uses-feature (line=60)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.hardware.bluetooth_le" (Raw: "android.hardware.bluetooth_le")
`;
const APKSIGNER = `Signer #1 certificate DN: CN=KWAZO
Signer #1 certificate SHA-256 digest: 5f2c0e9a4b1d7c3e8f6a2b9d0c4e1f7a3b5d8c2e6f0a9b4d1c7e3f8a2b6d0c5e
Signer #1 certificate SHA-1 digest: 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567
Signer #1 certificate MD5 digest: 00112233445566778899aabbccddeeff
Signer #1 public key SHA-256 digest: 9999999999999999999999999999999999999999999999999999999999999999
`;
const KEYTOOL = `Alias name: kwazo-upload
Certificate fingerprints:
	 SHA1: 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:01:23:45:67
	 SHA256: 5F:2C:0E:9A:4B:1D:7C:3E:8F:6A:2B:9D:0C:4E:1F:7A:3B:5D:8C:2E:6F:0A:9B:4D:1C:7E:3F:8A:2B:6D:0C:5E
Signature algorithm name: SHA256withRSA
`;
const KEY = "5f2c0e9a4b1d7c3e8f6a2b9d0c4e1f7a3b5d8c2e6f0a9b4d1c7e3f8a2b6d0c5e"; // a made-up fingerprint, gitleaks:allow

describe("what the Android tools print", () => {
  it("reads the app's id, build number, version and Android level", () => {
    expect(readBadging(BADGING)).toEqual({ id: "com.kwazo.app", versionCode: "459876", versionName: "1.0.0", targetSdk: 36, debuggable: false });
    expect(readBadging(`${BADGING}application-debuggable\n`).debuggable).toBe(true);
  });
  it("reads the permissions the manifest asks for, never one Android only implies, nor another element's name", () => {
    expect(declaredPermissions(MANIFEST)).toEqual([
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.CAMERA",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ]);
    expect(declaredPermissions(MANIFEST.replaceAll("\n", "\r\n"))).toHaveLength(3);
    expect(declaredPermissions("")).toEqual([]);
  });
  it("reads plain http from the manifest's own line and from a network security file it names, as aapt2 prints them", () => {
    const allow = (value: string) =>
      MANIFEST.replace("      E: queries", `        A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=${value}\n      E: queries`);
    expect(cleartextIn(MANIFEST)).toBe(false);
    expect(cleartextIn(allow("true"))).toBe(true);
    expect(cleartextIn(allow("(type 0x12)0xffffffff"))).toBe(true);
    expect(cleartextIn(allow("false"))).toBe(false);
    const named = MANIFEST.replace(
      "      E: queries",
      "        A: http://schemas.android.com/apk/res/android:networkSecurityConfig(0x0101054c)=@0x7f150002\n      E: queries",
    );
    const config = (permitted: string) =>
      `N: android=http://schemas.android.com/apk/res/android (line=2)\n  E: network-security-config (line=2)\n    E: base-config (line=3)\n      A: cleartextTrafficPermitted=${permitted}\n`;
    expect(cleartextIn(named, [config("true")])).toBe(true);
    expect(cleartextIn(named, [config("false")])).toBe(false);
    // Named, but no such file among the app's XML files: nothing can say, and the check says so.
    expect(cleartextIn(named, [])).toBeNull();
    expect(cleartextIn(named, ["  E: paths (line=2)\n"])).toBeNull();
  });
  it("reads a network security file wherever a release build put it, under its shortened name too", () => {
    // Names from build 458835 (`tar -tf`), and an unshortened one as a debug build keeps it.
    const paths = ["AndroidManifest.xml", "res/-1.xml", "res/8G.xml", "res/xml/network_security_config.xml", "res/drawable/a.png", "assets/app.config"];
    expect(xmlResources(paths)).toEqual(["res/-1.xml", "res/8G.xml", "res/xml/network_security_config.xml"]);
  });
  it("reads a certificate's fingerprint the same from apksigner and keytool, and never a public key's", () => {
    expect(fingerprintsIn(APKSIGNER)).toEqual([KEY]);
    expect(fingerprintsIn(KEYTOOL)).toEqual([KEY]);
  });
});

const good: StoreFacts = {
  versionCode: "459876",
  versionName: "1.0.0",
  badging: readBadging(BADGING),
  permissions: declaredPermissions(MANIFEST),
  cleartext: false,
  builtIn: { apiUrl: "https://api.getkwazo.com", webUrl: "https://getkwazo.com", package: "com.kwazo.app" },
  uploadKey: KEY,
  apkSigners: [KEY],
  aabSigners: [KEY],
  apkAligned: true,
  libraries: [
    { name: "base/lib/arm64-v8a/libhermesvm.so", alignments: [16384, 16384] },
    { name: "base/lib/arm64-v8a/libreactnative.so", alignments: [65536] },
  ],
};

describe("the files Google Play gets", () => {
  it("passes a build with nothing wrong", () => {
    expect(storeFaults(good)).toEqual([]);
  });

  const debugKey = "a".repeat(64);
  it.each<[string, Partial<StoreFacts>, RegExp]>([
    ["a folder's copy's id", { badging: { ...good.badging, id: "com.aihomegym.dev.feature1" } }, /id/],
    ["another build number", { badging: { ...good.badging, versionCode: "459875" } }, /build number/],
    ["another version", { badging: { ...good.badging, versionName: "0.0.1" } }, /version/],
    ["made for Android 15", { badging: { ...good.badging, targetSdk: 35 } }, /Android 16/],
    ["no Android level read", { badging: { ...good.badging, targetSdk: null } }, /Android 16/],
    ["built for debugging", { badging: { ...good.badging, debuggable: true } }, /debugging/],
    ["plain http allowed", { cleartext: true }, /plain-http/],
    ["a network security file that could not be read", { cleartext: null }, /network security file/],
    ["the bundler's overlay asked for", { permissions: [...declaredPermissions(MANIFEST), "android.permission.SYSTEM_ALERT_WINDOW"] }, /SYSTEM_ALERT_WINDOW/],
    ["the photos permission asked for", { permissions: [...declaredPermissions(MANIFEST), "android.permission.READ_MEDIA_IMAGES"] }, /READ_MEDIA_IMAGES/],
    ["no permissions read at all", { permissions: [] }, /permissions could not be read/],
    ["a laptop's api built in", { builtIn: { ...good.builtIn, apiUrl: "http://localhost:3000" } }, /talks to/],
    ["plain http to the right name", { builtIn: { ...good.builtIn, apiUrl: "http://api.getkwazo.com" } }, /talks to/],
    ["a laptop's website built in", { builtIn: { ...good.builtIn, webUrl: "http://localhost:5173" } }, /links open/],
    ["a folder's copy named", { builtIn: { ...good.builtIn, copyName: "Feature 1" } }, /copy/],
    ["settings for another id", { builtIn: { ...good.builtIn, package: "com.aihomegym.dev.feature1" } }, /built-in settings/],
    ["settings that cannot be read", { builtIn: null }, /could not be read/],
    ["the phone file on the development key", { apkSigners: [debugKey] }, /phone file is not signed/],
    ["the store file on the development key", { aabSigners: [debugKey] }, /store file is not signed/],
    ["the store file on two keys", { aabSigners: [KEY, debugKey] }, /store file is not signed/],
    ["the phone file unsigned", { apkSigners: [] }, /phone file is not signed/],
    ["the phone file not aligned", { apkAligned: false }, /zipalign/],
    ["no 64-bit libraries at all", { libraries: [] }, /no 64-bit/],
    ["a library on 4 KB pages", { libraries: [...good.libraries, { name: "base/lib/arm64-v8a/libold.so", alignments: [16384, 4096] }] }, /libold\.so is not ready/],
    ["a library with no loaded part", { libraries: [{ name: "base/lib/x86_64/libempty.so", alignments: [] }] }, /libempty\.so is not ready/],
    ["a library that cannot be read", { libraries: [{ name: "base/lib/arm64-v8a/libbroken.so", alignments: null }] }, /libbroken\.so could not be read/],
  ])("refuses %s", (_case, change, said) => {
    const faults = storeFaults({ ...good, ...change });
    expect(faults.length).toBe(1);
    expect(faults[0]).toMatch(said);
  });

  it("takes 16 KB exactly and more, and nothing less", () => {
    for (const align of [PAGE_16_KB, 2 * PAGE_16_KB, 4 * PAGE_16_KB]) {
      expect(storeFaults({ ...good, libraries: [{ name: "lib.so", alignments: [align] }] }), String(align)).toEqual([]);
    }
    for (const align of [PAGE_16_KB - 1, PAGE_16_KB / 2, 4096, 1]) {
      expect(storeFaults({ ...good, libraries: [{ name: "lib.so", alignments: [align] }] }).length, String(align)).toBe(1);
    }
  });
});

describe("the check and the app's settings agree", () => {
  it("on the store's id and on what it blocks", () => {
    expect(STORE.applicationId).toBe(STORE_ID);
    expect([...STORE_BLOCKED_PERMISSIONS].sort()).toEqual([...NEVER_IN_THE_STORE].sort());
  });
});
