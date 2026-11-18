// What the phone tests (ROADMAP Stage 5 items 51a and 51b) share on the laptop: adb, the folder's copy of the app, and
// Google's pinned models. Each throws, never exits, so a test's own clean-up of the phone always runs.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { modelUrl, type PoseModel } from "./phoneRun.js";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** One adb command. */
export function adb(args: string[]): { ok: boolean; out: Buffer; text: string } {
  const r = spawnSync("adb", args, { maxBuffer: 1 << 30 });
  if (r.error) throw new Error(`adb did not run: ${r.error.message}`);
  const out = r.stdout;
  return { ok: r.status === 0, out, text: `${out.toString("utf8")}${r.stderr.toString("utf8")}`.trim() };
}

/** This folder's copy of the app, as app.config.ts names it (`apps/mobile/.copy`). */
export function appIdOf(mobile: string): string {
  const r = spawnSync("corepack pnpm exec expo config --json --type public", { cwd: mobile, shell: true, encoding: "utf8", maxBuffer: 1 << 26 });
  const id = /"package"\s*:\s*"(com\.aihomegym\.dev\.[a-z0-9]+)"/.exec(r.stdout)?.[1];
  if (r.status !== 0 || id === undefined) throw new Error(`The app's settings did not name a folder's copy:\n${r.stderr.trim()}`);
  return id;
}

/** Google's model in `folder`, fetched when missing, and always checked against its pinned size and file check. */
export async function fetchModel(m: PoseModel, folder: string): Promise<string> {
  const path = join(folder, `${m.name}.task`);
  if (!existsSync(path)) {
    console.log(`Fetching Google's ${m.size} pose model.`);
    const reply = await fetch(modelUrl(m));
    if (!reply.ok) throw new Error(`Google's ${m.size} pose model did not come: ${String(reply.status)}.`);
    writeFileSync(path, new Uint8Array(await reply.arrayBuffer()));
  }
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.length !== m.bytes || sha256(bytes) !== m.sha256) throw new Error(`${path} is not Google's ${m.size} pose model as pinned. Delete it to fetch it again.`);
  return path;
}
