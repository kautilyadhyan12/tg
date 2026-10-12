// Builds this folder's copy of the app onto the phone on the USB cable and
// starts its bundler. `--start` only starts the bundler (the copy is installed).
//   corepack pnpm --filter mobile phone
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const copies = JSON.parse(readFileSync(join(root, "copies.json"), "utf8"));

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
  const done = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (done.status !== 0) process.exit(done.status ?? 1);
}

// The phone's localhost reaches this laptop's api and bundler through the cable.
run("adb", ["reverse", `tcp:${copy.apiPort}`, `tcp:${copy.apiPort}`]);
run("adb", ["reverse", `tcp:${copy.metroPort}`, `tcp:${copy.metroPort}`]);

const expo = process.argv.includes("--start")
  ? ["expo", "start", "--dev-client", "--port", String(copy.metroPort)]
  : ["expo", "run:android", "--port", String(copy.metroPort)];
run("corepack", ["pnpm", "exec", ...expo]);
