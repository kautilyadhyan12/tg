// Builds the store's app, KWAZO, for Google Play (ROADMAP Stage 5 21c-i).
//   corepack pnpm --filter mobile store-version     the store file (.aab) for Google Play, and a phone file (.apk)
//                                                   of the same build to try on a phone first
//   corepack pnpm --filter mobile store-version --new-key   makes KWAZO's upload key, once
// The upload key is the key Google Play knows every update by. It lives outside every folder, in
// ~/.kwazo (KWAZO_UPLOAD_PROPERTIES names another place), and Kd keeps a copy: lost, Google Play's support has to
// be asked for a new one, which takes days.
// The build is of one commit (nothing changed and not committed), numbered by the minutes since 2026-01-01 so
// each upload's number is higher than the last, for the phone's two kinds of chip that every Android phone of
// the last ten years has (arm64-v8a, armeabi-v7a). Each file is checked by storeCheck.mjs before it is called
// ready. The Android project made for it is removed afterwards, so this folder's copy is made afresh by `phone`.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gather, storeFaults } from "./storeCheck.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const keySettings = process.env.KWAZO_UPLOAD_PROPERTIES ?? join(homedir(), ".kwazo", "upload.properties");
const ALIAS = "kwazo-upload";

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const line = (command, args) => [command, ...args].join(" ");

function run(command, args, cwd, env) {
  const done = spawnSync(line(command, args), { cwd, stdio: "inherit", shell: true, env });
  if (done.status !== 0) process.exit(done.status ?? 1);
}

function read(command, args, env = process.env) {
  const done = spawnSync(line(command, args), { cwd: root, encoding: "utf8", shell: true, env });
  return { ok: done.status === 0, text: `${done.stdout ?? ""}${done.stderr ?? ""}` };
}

const keytool = process.env.JAVA_HOME === undefined ? "keytool" : `"${join(process.env.JAVA_HOME, "bin", windows ? "keytool.exe" : "keytool")}"`;

if (process.argv.includes("--new-key")) {
  const storeFile = join(dirname(keySettings), "kwazo-upload.jks");
  if (existsSync(keySettings) || existsSync(storeFile)) {
    stop(`KWAZO's upload key already exists (${keySettings}). It is made once: a second one would not be the key Google Play knows.`);
  }
  mkdirSync(dirname(keySettings), { recursive: true });
  // A PKCS12 key store has one password for the store and the key. Letters, digits, - and _ only.
  const password = randomBytes(24).toString("base64url");
  const env = { ...process.env, KWAZO_NEW_PASSWORD: password };
  const made = read(
    keytool,
    ["-genkeypair", "-storetype", "PKCS12", "-keystore", `"${storeFile}"`, "-alias", ALIAS, "-keyalg", "RSA", "-keysize", "4096",
      "-validity", "10000", "-dname", '"CN=KWAZO"', "-storepass:env", "KWAZO_NEW_PASSWORD", "-keypass:env", "KWAZO_NEW_PASSWORD"],
    env,
  );
  if (!made.ok) stop(`keytool could not make the key:\n${made.text}`);
  writeFileSync(keySettings, `storeFile=${storeFile.replaceAll("\\", "/")}\nstorePassword=${password}\nkeyAlias=${ALIAS}\nkeyPassword=${password}\n`, { mode: 0o600 });
  const listed = read(keytool, ["-list", "-v", "-keystore", `"${storeFile}"`, "-alias", ALIAS, "-storepass:env", "KWAZO_NEW_PASSWORD"], env);
  const prints = listed.text.split(/\r?\n/).filter((l) => /^\s*SHA(1|256):/.test(l)).map((l) => l.trim());
  console.log(`\nKWAZO's upload key is made:\n  ${storeFile}\n  ${keySettings} (its password)\n${prints.map((p) => `  ${p}`).join("\n")}\n`);
  process.exit(0);
}

function readKey() {
  if (!existsSync(keySettings)) stop(`KWAZO's upload key is not on this laptop (${keySettings}). Make it once with: corepack pnpm --filter mobile store-version --new-key`);
  const settings = Object.fromEntries(
    readFileSync(keySettings, "utf8")
      .split(/\r?\n/)
      .map((l) => /^([A-Za-z]+)=(.*)$/.exec(l.trim()))
      .filter((m) => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  for (const name of ["storeFile", "storePassword", "keyAlias", "keyPassword"]) {
    if ((settings[name] ?? "") === "") stop(`${keySettings} has no ${name}.`);
  }
  if (!existsSync(settings.storeFile)) stop(`The upload key's file is missing: ${settings.storeFile}`);
  return settings;
}

const changed = read("git", ["status", "--porcelain", "--untracked-files=no"]);
if (!changed.ok) stop(changed.text.trim());
if (changed.text.trim() !== "") stop(`The store's file is built from one commit, and these files have changes not committed:\n${changed.text.trimEnd()}`);
const commit = read("git", ["rev-parse", "HEAD"]).text.trim();

const key = readKey();
const versionCode = String(Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60_000));
const env = {
  ...process.env,
  CI: "1",
  KWAZO_BUILD: "store",
  KWAZO_VERSION_CODE: versionCode,
  KWAZO_UPLOAD_STORE_FILE: key.storeFile,
  KWAZO_UPLOAD_STORE_PASSWORD: key.storePassword,
  KWAZO_UPLOAD_KEY_ALIAS: key.keyAlias,
  KWAZO_UPLOAD_KEY_PASSWORD: key.keyPassword,
};

// The store's settings, read through Expo as the build will read them: a missing Firebase app or a folder's
// server address stops here, before the hour of building.
const asked = read("corepack", ["pnpm", "exec", "expo", "config", "--json", "--type", "public"], env);
if (!asked.ok) stop(asked.text.trim());
const config = JSON.parse(asked.text.slice(asked.text.indexOf("{")));
const versionName = config.version;
console.log(`\nBuilding ${config.name} ${versionName} (${versionCode}), ${config.android.package}, from ${commit}.\n`);

run("corepack", ["pnpm", "exec", "expo", "prebuild", "--platform", "android", "--no-install", "--clean"], root, env);
run(
  windows ? String.raw`.\gradlew.bat` : "./gradlew",
  [
    "bundleRelease",
    "assembleRelease",
    "-PreactNativeArchitectures=armeabi-v7a,arm64-v8a",
    '"-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m"',
    "-Pkotlin.compiler.execution.strategy=in-process",
    "--max-workers=1",
    "--console=plain",
  ],
  join(root, "android"),
  env,
);

const out = join(root, "store-builds", versionCode);
mkdirSync(out, { recursive: true });
const name = `kwazo-${versionName}-${versionCode}`;
copyFileSync(join(root, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab"), join(out, `${name}.aab`));
copyFileSync(join(root, "android", "app", "build", "outputs", "apk", "release", "app-release.apk"), join(out, `${name}.apk`));
writeFileSync(join(out, "BUILT.txt"), `${config.name} ${versionName} (${versionCode})\n${config.android.package}\ncommit ${commit}\nbuilt ${new Date().toISOString()}\n`);

// The Android project is the store's now: removed, so this folder's copy is made afresh by `phone`.
rmSync(join(root, "android"), { recursive: true, force: true });

process.env.KWAZO_UPLOAD_STORE_PASSWORD = key.storePassword;
const facts = gather({ folder: out, versionCode, versionName, keyStore: key.storeFile, keyAlias: key.keyAlias });
const faults = storeFaults(facts);
console.log(`\nChecked ${String(facts.libraries.length)} 64-bit native libraries; made for API ${String(facts.badging.targetSdk)}.`);
if (faults.length > 0) stop(`Not ready for Google Play (${out}):\n${faults.map((f) => `  - ${f}`).join("\n")}`);
console.log(`\nReady for Google Play: every check passed.\n  ${join(out, `${name}.aab`)}  (for Google Play)\n  ${join(out, `${name}.apk`)}  (to try on a phone first)\n`);
