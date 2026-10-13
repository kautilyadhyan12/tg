// Puts this folder's copy of the app on the phone on the USB cable and opens it.
//   corepack pnpm --filter mobile phone    build it, install it, then start it
//   corepack pnpm --filter mobile start    start it (the copy is already installed)
// A build is needed the first time, and after a job adds a package with Android
// code of its own. Stop it with Ctrl+C.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const copies = JSON.parse(readFileSync(join(root, "copies.json"), "utf8"));
const shell = process.platform === "win32";

let key;
try {
  key = readFileSync(join(root, ".copy"), "utf8").trim();
} catch {
  key = "";
}
const copy = Object.hasOwn(copies, key) ? copies[key] : null;
if (copy === null) {
  console.error(`apps/mobile/.copy must hold one of: ${Object.keys(copies).join(", ")}.`);
  process.exit(1);
}

function run(command, args) {
  const done = spawnSync(command, args, { cwd: root, stdio: "inherit", shell });
  if (done.status !== 0) process.exit(done.status ?? 1);
}

// The phone's localhost reaches this laptop's api and bundler through the cable.
run("adb", ["reverse", `tcp:${copy.apiPort}`, `tcp:${copy.apiPort}`]);
run("adb", ["reverse", `tcp:${copy.metroPort}`, `tcp:${copy.metroPort}`]);

if (!process.argv.includes("--start")) {
  run("corepack", ["pnpm", "exec", "expo", "run:android", "--no-bundler"]);
}

const bundler = spawn(
  "corepack",
  ["pnpm", "exec", "expo", "start", "--dev-client", "--port", String(copy.metroPort)],
  { cwd: root, stdio: "inherit", shell },
);
bundler.on("exit", (code) => process.exit(code ?? 1));

// The app is opened only once the bundler answers: opened sooner, it shows an
// error page, and opened from its icon it asks which server to use.
const bundlerUrl = `http://localhost:${copy.metroPort}`;
async function bundlerIsUp() {
  try {
    const reply = await fetch(`${bundlerUrl}/status`);
    return (await reply.text()).includes("running");
  } catch {
    return false;
  }
}
for (let tries = 0; tries < 150 && !(await bundlerIsUp()); tries++) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
// The scheme is app.config.ts's `scheme` for this copy.
const link = `aihomegym-${key}://expo-development-client/?url=${encodeURIComponent(bundlerUrl)}`;
spawnSync("adb", ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `"${link}"`], {
  cwd: root,
  stdio: "ignore",
  shell,
});
console.log(`\nOpened ${copy.name} on the phone. Leave this running; Ctrl+C stops it.\n`);
