// Reads the store's files after a build (ROADMAP Stage 5 21c-i) and refuses anything Google Play would refuse or a
// tester should never get:
//   · the app's id, its build number and version, made for Android 16 (Google Play's rule since 2026-08-31);
//   · the settings built into the app: the online server alone, over https, with no folder's copy named;
//   · no plain-http traffic allowed, nothing left in for debugging, none of the permissions the store's app blocks;
//   · both files signed with KWAZO's upload key, never the development one;
//   · every 64-bit native library ready for phones with 16 KB memory pages (Google Play refuses updates without
//     it from 2027-02-01), and the phone file aligned for them.
//   node scripts/storeCheck.mjs <folder holding the .aab and the .apk>
// The rules are the functions below; main() only gathers what the Android tools say.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STORE_ID = "com.kwazo.app";
export const ANDROID_16 = 36;
export const PAGE_16_KB = 16384;
/** The permissions app.config.ts blocks in the store's app (STORE_BLOCKED_PERMISSIONS), read again from the file. */
export const NEVER_IN_THE_STORE = [
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.WRITE_SETTINGS",
];

/** The memory alignment of each part of a native library that is loaded (its PT_LOAD headers), from the file's
 *  own header. Anything that is not a little-endian ELF file gives null. */
export function loadAlignments(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 52 || b.readUInt32BE(0) !== 0x7f454c46 || b[5] !== 1) return null;
  const wide = b[4] === 2;
  if (!wide && b[4] !== 1) return null;
  const tableAt = wide ? Number(b.readBigUInt64LE(0x20)) : b.readUInt32LE(0x1c);
  const entrySize = b.readUInt16LE(wide ? 0x36 : 0x2a);
  const entries = b.readUInt16LE(wide ? 0x38 : 0x2c);
  const alignments = [];
  for (let i = 0; i < entries; i++) {
    const at = tableAt + i * entrySize;
    if (at + entrySize > b.length) return null;
    if (b.readUInt32LE(at) !== 1) continue;
    alignments.push(wide ? Number(b.readBigUInt64LE(at + 0x30)) : b.readUInt32LE(at + 0x1c));
  }
  return alignments;
}

/** What `aapt2 dump badging` says of an app. Its permission lines are not read: badging also prints a permission
 *  Android only implies ("uses-permission: name='android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32'" beside
 *  "reason='requested WRITE_EXTERNAL_STORAGE'"), which the app never asks for (the first store build, 2026-11-15). */
export function readBadging(text) {
  const pkg = /^package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'/m.exec(text);
  const target = /^targetSdkVersion:'(\d+)'/m.exec(text);
  return {
    id: pkg?.[1] ?? null,
    versionCode: pkg?.[2] ?? null,
    versionName: pkg?.[3] ?? null,
    targetSdk: target === null ? null : Number(target[1]),
    debuggable: /^application-debuggable/m.test(text),
  };
}

/** The permissions the app's own manifest asks for, from `aapt2 dump xmltree --file AndroidManifest.xml`: each
 *  `uses-permission` element's name, never one Android implies. */
export function declaredPermissions(xmltree) {
  const names = [];
  let inPermission = false;
  for (const line of xmltree.split(/\r?\n/)) {
    if (/^\s*E: /.test(line)) inPermission = /^\s*E: uses-permission(?:-sdk-23)? /.test(line);
    const name = inPermission ? /:name\(0x01010003\)="([^"]+)"/.exec(line) : null;
    if (name !== null) {
      names.push(name[1]);
      inPermission = false;
    }
  }
  return names;
}

/** Whether the app lets plain http through, from `aapt2 dump xmltree` of its manifest and of every network security file
 *  in it (`configs`): the manifest's own `usesCleartextTraffic`, or a network security file the manifest names that permits
 *  it (a library or a later plugin can add one). Null: the manifest names such a file and none was found, so nothing can say. */
export function cleartextIn(manifest, configs = []) {
  if (/usesCleartextTraffic\(0x[0-9a-f]+\)=(?:true|\(type 0x12\)0xffffffff)/i.test(manifest)) return true;
  if (!/networkSecurityConfig\(0x[0-9a-f]+\)=/i.test(manifest)) return false;
  const files = configs.filter((c) => /E: network-security-config/.test(c));
  if (files.length === 0) return null;
  return files.some((c) => /cleartextTrafficPermitted(?:\(0x[0-9a-f]+\))?=(?:true|\(type 0x12\)0xffffffff)/i.test(c));
}

/** The certificates' SHA-256 fingerprints a signing tool printed (apksigner's "certificate SHA-256 digest: ab12…",
 *  keytool's "SHA256: AB:12:…"), each as lower-case hex with no colons. A public key's digest is not a certificate's. */
export function fingerprintsIn(text) {
  return [...text.matchAll(/(?:certificate SHA-256 digest|\bSHA256):\s*([0-9A-Fa-f:]{64,95})/g)].map((m) => m[1].replaceAll(":", "").toLowerCase());
}

/** Every fault in what was gathered; none means the files may go to Google Play. */
export function storeFaults(f) {
  const faults = [];
  const { badging } = f;
  if (badging.id !== STORE_ID) faults.push(`The app's id is ${String(badging.id)}, not ${STORE_ID}.`);
  if (badging.versionCode !== f.versionCode) faults.push(`The build number is ${String(badging.versionCode)}, not ${f.versionCode}.`);
  if (badging.versionName !== f.versionName) faults.push(`The version is ${String(badging.versionName)}, not ${f.versionName}.`);
  if (badging.targetSdk === null || badging.targetSdk < ANDROID_16) faults.push(`It is made for Android API ${String(badging.targetSdk)}; Google Play takes ${String(ANDROID_16)} (Android 16) or later.`);
  if (badging.debuggable) faults.push("It is built for debugging.");
  if (f.cleartext === true) faults.push("It allows plain-http traffic.");
  if (f.cleartext === null) faults.push("It names a network security file that could not be read.");
  if (f.permissions.length === 0) faults.push("The app's own permissions could not be read.");
  for (const blocked of NEVER_IN_THE_STORE) if (f.permissions.includes(blocked)) faults.push(`It asks for ${blocked}, which the store's app blocks.`);
  const built = f.builtIn;
  if (built === null) {
    faults.push("The settings built into the app could not be read.");
  } else {
    if (built.apiUrl !== "https://api.getkwazo.com") faults.push(`It talks to ${String(built.apiUrl)}, not https://api.getkwazo.com.`);
    if (built.webUrl !== "https://getkwazo.com") faults.push(`Its links open ${String(built.webUrl)}, not https://getkwazo.com.`);
    if (built.copyName !== undefined) faults.push(`It names a folder's copy: "${String(built.copyName)}".`);
    if (built.package !== STORE_ID) faults.push(`Its built-in settings name ${String(built.package)}, not ${STORE_ID}.`);
  }
  for (const [file, prints] of [["phone file", f.apkSigners], ["store file", f.aabSigners]]) {
    if (prints.length !== 1 || prints[0] !== f.uploadKey) faults.push(`The ${file} is not signed with KWAZO's upload key alone.`);
  }
  if (!f.apkAligned) faults.push("The phone file is not aligned for 16 KB memory pages (zipalign -P 16).");
  if (f.libraries.length === 0) faults.push("The store file has no 64-bit native libraries to check.");
  for (const lib of f.libraries) {
    if (lib.alignments === null) faults.push(`${lib.name} could not be read as a native library.`);
    else if (lib.alignments.length === 0 || lib.alignments.some((a) => a < PAGE_16_KB)) faults.push(`${lib.name} is not ready for 16 KB memory pages.`);
  }
  return faults;
}

// ── gathering, with the Android SDK's own tools ─────────────────────────────

const windows = process.platform === "win32";

function tool(command, args) {
  const done = spawnSync(command, args, { encoding: "utf8", shell: windows && /\.bat$/i.test(command), maxBuffer: 64 * 1024 * 1024 });
  return { ok: done.status === 0, text: `${done.stdout ?? ""}${done.stderr ?? ""}` };
}

function buildTools() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk === undefined) throw new Error("ANDROID_HOME is not set, so the Android tools cannot be found.");
  const versions = readdirSync(join(sdk, "build-tools")).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  versions.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const newest = versions.at(-1);
  if (newest === undefined) throw new Error(`No build tools in ${sdk}.`);
  const dir = join(sdk, "build-tools", newest);
  return {
    aapt2: join(dir, windows ? "aapt2.exe" : "aapt2"),
    apksigner: join(dir, windows ? "apksigner.bat" : "apksigner"),
    zipalign: join(dir, windows ? "zipalign.exe" : "zipalign"),
  };
}

function javaTool(name) {
  const home = process.env.JAVA_HOME;
  return home === undefined ? name : join(home, "bin", windows ? `${name}.exe` : name);
}

/** Unpacks a zip (an .apk or .aab is one) with the system's own tar, which reads zip files on Windows. */
function unpack(file) {
  const into = mkdtempSync(join(tmpdir(), "kwazo-store-"));
  const tar = windows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "unzip";
  const done = windows ? tool(tar, ["-xf", file, "-C", into]) : tool(tar, ["-q", file, "-d", into]);
  if (!done.ok) throw new Error(`Could not unpack ${file}:\n${done.text}`);
  return into;
}

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Every compiled XML file under `res/` of a phone file, from its paths. A release build shortens its resources' names
 *  (build 458835: `res/-1.xml`, 786 of them), so a network security file can be any of them, never only `res/xml/…`. */
export function xmlResources(paths) {
  return paths.filter((p) => /^res\/.+\.xml$/.test(p));
}

/** The xmltree of every compiled XML resource of the phone file, read only when the manifest names a network security
 *  file (the resource's own name is not in the manifest, only its number); `cleartextIn` keeps the network ones. */
function networkConfigs(t, apkPath, unpacked, manifest) {
  if (!/networkSecurityConfig\(0x[0-9a-f]+\)=/i.test(manifest)) return [];
  return xmlResources(filesUnder(unpacked).map((p) => p.slice(unpacked.length + 1).replaceAll("\\", "/"))).map(
    (p) => tool(t.aapt2, ["dump", "xmltree", "--file", p, apkPath]).text,
  );
}

/** Gathers the facts of one build folder. The upload key's fingerprint is read from its key store with the
 *  password in KWAZO_UPLOAD_STORE_PASSWORD, as Gradle had it. */
export function gather({ folder, versionCode, versionName, keyStore, keyAlias }) {
  const files = readdirSync(folder);
  const apk = files.find((f) => f.endsWith(".apk"));
  const aab = files.find((f) => f.endsWith(".aab"));
  if (apk === undefined || aab === undefined) throw new Error(`${folder} must hold the .apk and the .aab.`);
  const t = buildTools();
  const badging = tool(t.aapt2, ["dump", "badging", join(folder, apk)]);
  if (!badging.ok) throw new Error(`aapt2 could not read the phone file:\n${badging.text}`);
  const manifest = tool(t.aapt2, ["dump", "xmltree", "--file", "AndroidManifest.xml", join(folder, apk)]);
  const key = tool(javaTool("keytool"), ["-list", "-v", "-keystore", keyStore, "-alias", keyAlias, "-storepass:env", "KWAZO_UPLOAD_STORE_PASSWORD"]);
  if (!key.ok) throw new Error(`keytool could not read the upload key:\n${key.text}`);
  const unpackedApk = unpack(join(folder, apk));
  const unpackedAab = unpack(join(folder, aab));
  try {
    let builtIn = null;
    try {
      const config = JSON.parse(readFileSync(join(unpackedApk, "assets", "app.config"), "utf8"));
      builtIn = { ...config.extra, package: config.android?.package };
    } catch {
      builtIn = null;
    }
    const libraries = filesUnder(unpackedAab)
      .filter((p) => /[\\/]lib[\\/](arm64-v8a|x86_64)[\\/][^\\/]+\.so$/.test(p))
      .map((p) => ({ name: p.slice(unpackedAab.length + 1).replaceAll("\\", "/"), alignments: loadAlignments(readFileSync(p)) }));
    return {
      versionCode,
      versionName,
      badging: readBadging(badging.text),
      permissions: declaredPermissions(manifest.text),
      cleartext: cleartextIn(manifest.text, networkConfigs(t, join(folder, apk), unpackedApk, manifest.text)),
      builtIn,
      uploadKey: fingerprintsIn(key.text)[0] ?? "no upload key",
      apkSigners: fingerprintsIn(tool(t.apksigner, ["verify", "--print-certs", join(folder, apk)]).text),
      aabSigners: [...new Set(fingerprintsIn(tool(javaTool("keytool"), ["-printcert", "-jarfile", join(folder, aab)]).text))],
      apkAligned: tool(t.zipalign, ["-c", "-P", "16", "4", join(folder, apk)]).ok,
      libraries,
    };
  } finally {
    rmSync(unpackedApk, { recursive: true, force: true });
    rmSync(unpackedAab, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [folder, versionCode, versionName, keyStore, keyAlias] = process.argv.slice(2);
  if (folder === undefined || versionCode === undefined || versionName === undefined || keyStore === undefined || keyAlias === undefined) {
    console.error("node scripts/storeCheck.mjs <folder> <build number> <version> <key store> <key alias>");
    process.exit(2);
  }
  const facts = gather({ folder, versionCode, versionName, keyStore, keyAlias });
  const faults = storeFaults(facts);
  console.log(`Checked ${String(facts.libraries.length)} 64-bit native libraries, ${facts.badging.id ?? "?"} ${facts.badging.versionName ?? "?"} (${facts.badging.versionCode ?? "?"}), made for API ${String(facts.badging.targetSdk)}.`);
  if (faults.length > 0) {
    console.error(`\nNot ready for Google Play:\n${faults.map((f) => `  - ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  console.log("Ready for Google Play: every check passed.");
}
