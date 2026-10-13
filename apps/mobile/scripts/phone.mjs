// Puts this folder's copy of the app on the phone on the USB cable and opens it.
//   corepack pnpm --filter mobile phone    build it, install it, then start it
//   corepack pnpm --filter mobile start    start it (the copy is already installed)
// A build is needed the first time, and after a job adds a package with Android
// code of its own. Stop it with Ctrl+C.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cableFor } from "./cable.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// One string, because Windows needs a shell to find adb, corepack and gradlew.bat.
// Nothing in it is typed by a person: cable.mjs checks the ports and the scheme.
const line = (command, args) => [command, ...args].join(" ");

function run(command, args, cwd = root) {
  const done = spawnSync(line(command, args), { cwd, stdio: "inherit", shell: true });
  if (done.status !== 0) process.exit(done.status ?? 1);
}

function read(command, args) {
  const done = spawnSync(line(command, args), { cwd: root, encoding: "utf8", shell: true });
  return { ok: done.status === 0, text: `${done.stdout ?? ""}${done.stderr ?? ""}` };
}

// The copy's name, id and scheme come from app.config.ts, through Expo itself;
// its ports from copies.json. A missing or wrong .copy is refused there.
const asked = read("corepack", ["pnpm", "exec", "expo", "config", "--json", "--type", "public"]);
if (!asked.ok) stop(asked.text.trim());
const config = JSON.parse(asked.text.slice(asked.text.indexOf("{")));
const copies = JSON.parse(readFileSync(join(root, "copies.json"), "utf8"));
const key = readFileSync(join(root, ".copy"), "utf8").trim();
const ports = copies[key];
const applicationId = config.android.package;
const cable = cableFor({ scheme: config.scheme, apiPort: ports.apiPort, metroPort: ports.metroPort });

const phone = read("adb", ["get-state"]);
if (!phone.ok || phone.text.trim() !== "device") {
  stop("No phone on the USB cable. Plug it in with USB debugging on, and allow this computer on the phone.");
}

if (!process.argv.includes("--start")) {
  // The Android project is made afresh from app.config.ts, then built for this
  // phone alone and one part at a time: a plain build wants more memory than a
  // 16 GB laptop has spare beside its other work (measured 2026-10-12).
  const abi = read("adb", ["shell", "getprop", "ro.product.cpu.abi"]).text.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(abi)) stop(`The phone did not say which chip it has (it answered "${abi}").`);
  run("corepack", ["pnpm", "exec", "expo", "prebuild", "--platform", "android", "--no-install"]);
  run(
    windows ? String.raw`.\gradlew.bat` : "./gradlew",
    [
      "assembleDebug",
      `-PreactNativeDevServerPort=${String(ports.metroPort)}`,
      `-PreactNativeArchitectures=${abi}`,
      '"-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m"',
      "-Pkotlin.compiler.execution.strategy=in-process",
      "--max-workers=1",
      "--console=plain",
    ],
    join(root, "android"),
  );
  run("adb", ["install", "-r", "android/app/build/outputs/apk/debug/app-debug.apk"]);
}

if (!read("adb", ["shell", "pm", "list", "packages", applicationId]).text.includes(applicationId)) {
  stop(`The ${config.name} copy is not on the phone yet. Run: corepack pnpm --filter mobile phone`);
}

for (const link of cable.reverse) run("adb", link);

const bundler = spawn(line("corepack", ["pnpm", "exec", ...cable.bundlerArgs]), {
  cwd: root,
  stdio: "inherit",
  shell: true,
  // Without this Node gives "localhost" its IPv6 address, which the cable does not reach.
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first` },
});
bundler.on("exit", (code) => process.exit(code ?? 1));

function stopBundler(message) {
  if (windows) spawnSync("taskkill", ["/PID", String(bundler.pid), "/T", "/F"], { stdio: "ignore" });
  else bundler.kill();
  stop(message);
}

// The app is opened only once the bundler answers: opened sooner, it shows an
// error page, and opened from its icon it asks which server to use.
async function bundlerIsUp() {
  try {
    const reply = await fetch(`${cable.bundlerUrl.replace("localhost", "127.0.0.1")}/status`);
    return (await reply.text()).includes("running");
  } catch {
    return false;
  }
}
let up = false;
for (let tries = 0; tries < 150 && !up; tries++) {
  up = await bundlerIsUp();
  if (!up) await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!up) stopBundler("The bundler did not start in five minutes, so the app was not opened.");

const opened = read("adb", [
  "shell",
  "am",
  "start",
  "-W",
  "-a",
  "android.intent.action.VIEW",
  "-d",
  `"${cable.link}"`,
  applicationId,
]);
if (!opened.ok || /Error/i.test(opened.text)) {
  stopBundler(`The ${config.name} copy did not open on the phone:\n${opened.text.trim()}`);
}
console.log(`\nOpened ${config.name} on the phone. Leave this running; Ctrl+C stops it.\n`);
