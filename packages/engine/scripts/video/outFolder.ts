// The tool's pictures show real people, and this project's GitHub is public. It writes
// only where git cannot pick the pictures up.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function git(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.error) throw new Error(`git could not run, so the folder is refused: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Throws unless `folder` is outside every git checkout or ignored by it. */
export function assertFolderStaysOutOfGit(folder: string): void {
  const target = resolve(folder);
  let existing = target;
  while (!existsSync(existing)) {
    const up = dirname(existing);
    if (up === existing) break;
    existing = up;
  }
  const top = git(existing, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    if (top.stderr.includes("not a git repository")) return;
    throw new Error(`git could not say whether ${target} is safe, so it is refused: ${top.stderr.trim()}`);
  }
  const root = resolve(top.stdout.trim());
  const probe = relative(root, join(target, "a-picture.jpg"));
  const ignored = git(root, ["check-ignore", "-q", "--no-index", "--", probe]);
  if (ignored.status !== 0) {
    throw new Error(
      `${target} could end up on GitHub, and the pictures show real people. ` +
        `Use the default folder (measured/) or a folder outside the project.`,
    );
  }
}
