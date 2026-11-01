// The tool's pictures show real people, and this project's GitHub is public. It writes
// only where git cannot pick the pictures up, and only in a folder it made itself.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MARKER = ".measure-video.json";
// Kd's own folder is read, never changed (Part 2 §11.7).
const KD_VIDEOS = "D:\\vidoe referene";

function git(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.error) throw new Error(`git could not run, so the folder is refused: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The folder as the disk really has it, so a junction cannot lead elsewhere. */
function realFolder(folder: string): { existing: string; target: string } {
  const typed = resolve(folder);
  let existing = typed;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const up = dirname(existing);
    if (up === existing) break;
    rest.unshift(basename(existing));
    existing = up;
  }
  const real = realpathSync(existing);
  return { existing: real, target: join(real, ...rest) };
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Throws unless `folder` is outside every git checkout, or inside the checkout's own
 *  ignored `measured/` folder. */
export function assertFolderStaysOutOfGit(folder: string): void {
  const { existing, target } = realFolder(folder);
  const top = git(existing, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    if (top.stderr.includes("not a git repository")) return;
    throw new Error(`git could not say whether ${target} is safe, so it is refused: ${top.stderr.trim()}`);
  }
  const root = realpathSync(top.stdout.trim());
  const refused = new Error(
    `${target} is inside the git checkout ${root}, where the pictures could be picked up, and they show ` +
      `real people. Use that checkout's measured/ folder or a folder outside it.`,
  );
  const measured = join(root, "measured");
  if (relative(measured, target) === "" || !isInside(measured, target)) throw refused;
  const probe = relative(root, join(target, "a-picture.jpg"));
  if (git(root, ["check-ignore", "-q", "--", probe]).status !== 0) throw refused;
}

/** Makes the folder ready for `source`, or throws without touching anything. A folder
 *  holding anything but this tool's own run of the same source is refused. */
export function prepareOutFolder(folder: string, source: string): void {
  assertFolderStaysOutOfGit(folder);
  const target = realFolder(folder).target;
  if (isInside(KD_VIDEOS, target)) throw new Error(`${KD_VIDEOS} is Kd's own folder and is never changed.`);
  const marker = join(target, MARKER);
  if (existsSync(target) && readdirSync(target).length > 0) {
    if (!existsSync(marker)) {
      throw new Error(`${target} holds files this tool did not make. Use an empty folder.`);
    }
    const before: unknown = JSON.parse(readFileSync(marker, "utf8"));
    // A run's own trace, read again, is the same video.
    const same =
      dirname(resolve(source)) === target ||
      (typeof before === "object" && before !== null && "source" in before && before.source === source);
    if (!same) {
      throw new Error(`${target} holds the pictures of another video. Give this one its own --label.`);
    }
    return;
  }
  mkdirSync(target, { recursive: true });
  writeFileSync(marker, JSON.stringify({ source, pictures: [] }));
}
