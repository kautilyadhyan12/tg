// The proof table of a hold (spec Part 2 §12.5; ROADMAP 52c-ii), on the laptop or on GitHub:
//   corepack pnpm --filter @app/movement hold-check [l-sit] [--write] [--replays]
// It sets the hold's numbers from the videos that may set them (holdCheck.ts says the rule), prints every hold video's
// time held by eye against the clock's, each person's with their own videos left out of the numbers, every other video
// the clock gave any time to, and the most time any set of numbers gave another movement. --write puts the numbers, and
// where each came from, into movements/<name>.json; without it the file is only compared. --replays also plays every video
// again the ways the world changes it (replays.ts) and prints, for each replay, what was timed against what must be.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { heldByEye, holdHolds, holdReplayTable, holdTable, readHold, withHoldNumbers } from "./holdCheck.js";
import { MOVEMENTS, proofVideos } from "./movementCheck.js";
import { isOther } from "./movementVideos.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { write: { type: "boolean", default: false }, replays: { type: "boolean", default: false } } });
const name = positionals[0] ?? "l-sit";
const hold = readHold(name);
const { rows, fitted, folds, worstOther } = holdTable(hold, proofVideos());
const s = (ms: number | null): string => (ms === null ? "-" : `${(ms / 1000).toFixed(2)} s`);

console.log(`The ${name} hold: its numbers, set from ${String(folds.length)} people`);
fitted.forEach((f, k) => {
  const c = hold.position[k];
  const names = c === undefined || !("measures" in c.read) ? "" : c.read.measures.join(", ");
  const range = folds.map((fold) => fold.fitted[k]?.bound ?? Number.NaN);
  const written = c?.atLeast ?? c?.atMost;
  console.log(
    `  ${names.padEnd(32)} ${c?.atLeast !== undefined ? "at least" : "at most"} ${String(f.bound).padEnd(5)} (from ${f.from.toFixed(2)}, ${String(f.pictures)} pictures; with one person left out ${String(Math.min(...range))} to ${String(Math.max(...range))})${written === f.bound ? "" : `  [the file says ${String(written)}]`}`,
  );
});
console.log("\nEach hold video: held by eye, timed, timed with that person left out of the numbers");
for (const r of rows.filter((x) => x.entry.movement === name)) {
  console.log(`  ${r.label.padEnd(30)} eye ${s(heldByEye(r.entry))} timed ${s(r.heldMs)} left out ${s(r.leftOutMs)}  holds ${r.holds.map((h) => `${(h.start / 1000).toFixed(2)}-${(h.end / 1000).toFixed(2)}`).join(", ")}`);
}
const timed = rows.filter((r) => isOther(r.entry, name) && r.heldMs > 0);
console.log(`\nEvery other movement's video: ${String(rows.filter((r) => isOther(r.entry, name)).length)} tried, ${String(timed.length)} timed${timed.map((r) => `; ${r.label} ${s(r.heldMs)}`).join("")}`);
console.log(`The most time any set of numbers (all people, or one left out) gave another movement's video: ${s(worstOther)}`);

if (values.write) {
  const out = withHoldNumbers(hold, fitted);
  const people = folds.length;
  const json = {
    ...out,
    position: out.position.map((c, k) => {
      const f = fitted[k];
      return f === undefined
        ? c
        : {
            ...c,
            from: `Set by hold-check from ${String(people)} people's videos (scripts/movementVideos.ts), every picture held by eye, as filmed and as each replay that sets numbers (scripts/replays.ts), ${String(f.pictures)} pictures: beyond the furthest picture by half its distance from the middle one (${f.from.toFixed(2)}).`,
          };
    }),
  };
  writeFileSync(join(MOVEMENTS, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Written: packages/movement/movements/${name}.json`);
}

if (values.replays) {
  const replayRows = holdReplayTable(values.write ? withHoldNumbers(hold, fitted) : hold, proofVideos());
  console.log("\nEach video played again the ways the world changes it (scripts/replays.ts)");
  for (const replay of [...new Set(replayRows.map((r) => r.replay))]) {
    const rows = replayRows.filter((r) => r.replay === replay && r.tried);
    const own = rows.filter((r) => r.entry.movement === name);
    const wrong = rows.filter((r) => !holdHolds(r));
    console.log(`  ${replay.name.padEnd(24)} ${replay.hold ? "held " : "shown"} ${own.map((r) => `${r.label} ${s(r.heldMs)}`).join(", ")}; other movements timed ${String(rows.filter((r) => r.entry.movement !== name && r.heldMs > 0).length)}  ${wrong.length === 0 ? "right" : replay.hold ? "WRONG" : "differs"}`);
    for (const r of wrong) console.log(`      ${r.label.padEnd(36)} must ${s(r.least)} to ${s(r.most)}, timed ${s(r.heldMs)}`);
  }
}