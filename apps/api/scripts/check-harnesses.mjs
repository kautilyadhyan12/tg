/**
 * Every mutation harness in this repo must at least PARSE — **including the
 * shell ones, which round 4 walked straight past (T3 round 5, Low-4).**
 *
 * **WHY THIS EXISTS, and it is the cheapest guard on the list (:5348 rule 5).**
 * T3 round 3 found that a raw newline inside a mutant string had made
 * `apps/api/tools/mutate-orgs.mjs` a SyntaxError — so **none of its 57 mutants
 * could run**, including the two that exist solely to guard a Critical, and
 * **nothing in the gate could see it**: `eslint.config.js` ignores
 * `tools/**` in this package and `tsc` never reads a `.mjs`. The card looked
 * green with its safety net dead.
 *
 * **ROUND 4 WIDENED IT FROM ONE FILE TO EVERY HARNESS**, because naming a
 * single path is a case fix, not a class fix. This walks the directories
 * instead of listing files, so a harness added tomorrow is covered without
 * anybody remembering to add it here.
 *
 * **ROUND 5 FOUND THE WALK STILL SHORT IN THREE WAYS, and the counting was
 * wrong in a way four documents repeated:**
 *   1. It looked only at `.mjs`, so `mutate-exercise-library.sh`,
 *      `mutate-postworkout-summary.sh` and `mutate-workout-calendar.sh` — three
 *      real harnesses — were checked by nothing, in a guard whose first line
 *      says EVERY harness. They are checked with `bash -n` now.
 *   2. It did not recurse, and it skipped `apps/api/scripts` — the directory
 *      this file itself lives in.
 *   3. **"18 mutation harnesses" was never true.** 18 is the number of `.mjs`
 *      files in those directories; **four of them are not harnesses at all**
 *      (`browser-smoke-two-exercises`, `fetch-pose-assets`, `mock-ml-backend`,
 *      `seed-backdated-workout`). Counted by command: **14 `.mjs` + 3 `.sh` =
 *      17 mutation harnesses.** The guard deliberately keeps checking the
 *      non-harnesses too — a tool that cannot parse is broken whatever it is —
 *      so it now reports what it actually did rather than a label for it.
 *
 * A parse check is deliberately ALL this does. It cannot tell a stale anchor
 * from a live one — the harness's own whole-table pre-check does that, and it
 * can only do it once the file loads. This makes sure the file loads.
 *
 * **It is invoked from the ROOT `lint` script, not from `api`'s — round 5,
 * Low-6.** As a step inside `api#lint` it inherited that task's cache inputs,
 * which are 172 files with **not one** outside `apps/api` (measured with
 * turbo's own `--dry=json`), so breaking any of the 16 harnesses that live
 * elsewhere left a warm cache free to replay a pass without ever running this.
 * A guard that a cache can skip is the shape round 4 set out to close.
 */
import { readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where harnesses live. Directories, not files, so a new one is covered the
 *  day it lands rather than the day somebody updates this list. */
const DIRS = [
  "apps/api/scripts",
  "apps/api/tools",
  "apps/web/tools",
  "packages/engine/tools",
  "packages/engine/scripts",
  "tools",
];

/** The kinds of script a harness is written in. **Declared SEPARATELY from the
 *  checkers below, and that separation is the whole point.**
 *
 *  The first draft of this guard asked "for each entry in CHECKERS, did the walk
 *  find one?" — which cannot fail, because deleting a checker deletes the
 *  expectation with it. Measured: removing the `.sh` checker left the run
 *  reporting "19 scripts parse", exit 0, with three harnesses silently
 *  unguarded — the exact defect of round 4 reappearing inside the fix for it
 *  (:5104 F5, a protection that cannot fail). Held in two places, dropping a
 *  kind takes two deliberate edits and one of them fails the build. */
const REQUIRED_KINDS = [".mjs", ".sh"];

/** How each kind of file is asked whether it parses. `node --check` and
 *  `bash -n` both PARSE without executing, which is the whole point: a hostile
 *  or half-finished harness must not run inside its own guard. */
const CHECKERS = {
  ".mjs": { cmd: process.execPath, args: (f) => ["--check", f], label: "node --check" },
  ".sh": { cmd: "bash", args: (f) => ["-n", f], label: "bash -n" },
};

/** Recursive, because a harness in a subdirectory is still a harness — and the
 *  flat walk is exactly how three `.sh` files went unchecked for a round. */
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // a directory that does not exist is not a failure
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!stat.isFile()) continue;
    const ext = name.slice(name.lastIndexOf("."));
    if (ext in CHECKERS) out.push({ file: full, ext });
  }
}

const found = [];
for (const rel of DIRS) walk(join(ROOT, rel), found);

if (found.length === 0) {
  // An empty run passing would be this repo's most-recorded failure shape
  // (:4855's "ALL MUTANTS CAUGHT" on a run where none executed). If the walk
  // finds nothing, the walk is broken.
  console.error("check-harnesses: found no checkable scripts at all — the walk is wrong.");
  process.exit(1);
}

// The same reasoning one level down: if a whole KIND of script stops being
// found — or stops being checkable — the guard has quietly narrowed and every
// harness of that kind is unguarded again. That is round 5's Low-4 turned into
// a check instead of a memory.
for (const ext of REQUIRED_KINDS) {
  if (!(ext in CHECKERS)) {
    console.error(`check-harnesses: ${ext} is a required kind with no checker — it would go unchecked.`);
    process.exit(1);
  }
  if (!found.some((f) => f.ext === ext)) {
    console.error(`check-harnesses: the walk found no ${ext} files — it has narrowed. Fix the walk.`);
    process.exit(1);
  }
}

let bad = 0;
const byExt = {};
for (const { file, ext } of found) {
  const checker = CHECKERS[ext];
  byExt[ext] = (byExt[ext] ?? 0) + 1;
  try {
    execFileSync(checker.cmd, checker.args(file), { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? err.code : undefined;
    if (code === "ENOENT") {
      // The checker itself is missing. Skipping would leave a whole kind of
      // file silently unguarded, which is the defect this guard exists for —
      // so it is a loud failure, not a quiet pass.
      console.error(
        `\ncheck-harnesses: cannot run \`${checker.label}\` — ${checker.cmd} is not on PATH, ` +
          `so ${ext} harnesses cannot be checked. Install it rather than skipping them.`,
      );
      process.exit(1);
    }
    bad += 1;
    const detail = err instanceof Error && "stderr" in err ? String(err.stderr) : String(err);
    console.error(`\ncheck-harnesses: ${file.slice(ROOT.length + 1)} does not parse\n${detail}`);
  }
}

const tally = Object.entries(byExt)
  .map(([ext, n]) => `${String(n)} ${ext}`)
  .join(" + ");
if (bad > 0) {
  console.error(`check-harnesses: ${String(bad)} of ${String(found.length)} script(s) broken.`);
  process.exit(1);
}
// Says what it CHECKED, not what it thinks those files are: 4 of the .mjs are
// tools rather than mutation harnesses, and calling all of them harnesses is
// what put a wrong count into four documents.
console.log(`check-harnesses: ${String(found.length)} scripts parse (${tally}).`);
