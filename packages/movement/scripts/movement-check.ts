// The proof table of a movement (spec Part 2 §12.5; ROADMAP 52a), on the laptop or on GitHub:
//   corepack pnpm --filter @app/movement movement-check [squat] [--write] [--replays]
// It sets the movement's numbers from the videos that may set them (movementCheck.ts says the rules), prints every
// video's reps by eye against the engine's count, each person's count with their own videos left out of the numbers,
// and the most any set of numbers counted on another movement's video. --write puts the numbers, and where each came
// from, into movements/<name>.json; without it the file is only compared. --replays also plays every judged video again
// the ways the world changes it (replays.ts) and prints, for each replay, what was counted against what must be.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LIFT_CEILING, MOVEMENTS, holds, openRow, proofTable, readMovement, replayTable, withNumbers, type Fitted } from "./movementCheck.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { write: { type: "boolean", default: false }, replays: { type: "boolean", default: false } } });
const name = positionals[0] ?? "squat";
const movement = readMovement(name);
const { rows, fitted, folds, worstOther } = proofTable(movement);

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const num = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2));

console.log(`The ${name} movement: its numbers, set from ${String(folds.length)} people`);
for (const f of fitted) {
  const rule = movement.rules.find((r) => r.name === f.rule);
  const word = rule?.atLeast !== undefined ? "at least" : "at most";
  const written = rule?.atLeast ?? rule?.atMost;
  const range = folds.map((fold) => fold.fitted.find((x) => x.rule === f.rule)?.bound ?? Number.NaN);
  console.log(
    `  ${pad(f.rule, 24)} ${rule?.role ?? ""} ${word} ${pad(num(f.bound), 6)} (from ${num(Math.round(f.from * 100) / 100)}, standing ${num(Math.round(f.standing * 100) / 100)}, ${String(f.reps)} reps; with one person left out ${num(Math.min(...range))} to ${num(Math.max(...range))})${written === f.bound ? "" : `  [the file says ${String(written)}]`}`,
  );
}

console.log("\nEvery video: reps by eye, counted, counted with that person left out of the numbers");
for (const r of rows) {
  const eye = r.entry.reps === null ? "?" : String(r.entry.reps);
  const right =
    r.entry.reps === null
      ? "reported"
      : r.count === r.entry.reps && (r.leftOut === null || r.leftOut === r.entry.reps)
        ? "right"
        : r.entry.open !== undefined || (r.count === r.entry.reps && r.leftOut === r.entry.leftOutOpen?.count)
          ? "OPEN"
          : "WRONG";
  const why = r.reps.filter((x) => x.verdict !== "counted").map((x) => `${(x.start / 1000).toFixed(1)}s ${x.verdict}${x.rule === null ? "" : `: ${x.rule}`}`);
  console.log(
    `  ${pad(r.label, 40)} ${pad(r.entry.view, 7)} ${pad(r.entry.movement ?? "other", 6)} eye ${pad(eye, 2)} counted ${pad(String(r.count), 2)} left out ${pad(r.leftOut === null ? "-" : String(r.leftOut), 2)} ${pad(right, 8)} ${why.join("; ")}`,
  );
}
for (const r of rows.filter((x) => x.entry.open !== undefined)) console.log(`\nOpen: ${r.label}, counted ${String(r.count)}: ${r.entry.open ?? ""}`);
for (const r of rows.filter((x) => x.entry.leftOutOpen !== undefined)) {
  console.log(`\nOpen: ${r.label}, with that person left out counted ${String(r.leftOut)}: ${r.entry.leftOutOpen?.why ?? ""}`);
}
console.log(`\nThe most any set of numbers (all people, or one left out) counted on another movement's video, the open case aside: ${String(worstOther)}`);

if (values.write) {
  const people = folds.map((f) => f.person);
  const words = (f: Fitted): string => {
    const rule = movement.rules.find((r) => r.name === f.rule);
    if (rule?.standard?.room === "none") {
      return `Set by movement-check from the form standard, ${num(rule.standard.at)} (its source beside it), the least the body allows, so with no room of its own; rounded the forgiving way. The people's shallowest rep reads ${num(Math.round(f.from * 100) / 100)}.`;
    }
    if (rule?.standard !== undefined && f.room !== undefined) {
      const way = rule.atLeast !== undefined ? "less" : "more";
      return `Set by movement-check from the form standard, ${num(rule.standard.at)} (its source beside it), ${way} the camera's own room on this reading: the same rep's change from as filmed to each replay that sets numbers, in 99 reps of 100 (${String(f.room.pairs)} reps, ${String(people.length)} people): ${num(Math.round(f.room.size * 1000) / 1000)}; rounded the forgiving way. Their shallowest rep reads ${num(Math.round(f.from * 100) / 100)}.`;
    }
    const how = rule?.role === "count" ? "a quarter of the way back towards standing from the shallowest rep" : "beyond the furthest rep by half its distance from the middle rep";
    const ceiling = rule?.read.kind === "lift" ? `, and no higher than an 8 cm jump seen at 8 pictures a second less 2 cm (LIFT_CEILING in scripts/movementCheck.ts, ${LIFT_CEILING.toFixed(3)})` : "";
    return `Set by movement-check from ${String(people.length)} people's videos (scripts/movementVideos.ts), as filmed and as each replay that sets numbers (scripts/replays.ts), ${String(f.reps)} reps: ${how} (${num(Math.round(f.from * 100) / 100)}; standing ${num(Math.round(f.standing * 100) / 100)})${ceiling}.`;
  };
  const out = withNumbers(movement, fitted);
  const json = { ...out, rules: out.rules.map((r) => ({ ...r, from: words(fitted.find((f) => f.rule === r.name) ?? { rule: r.name, bound: 0, from: 0, standing: 0, reps: 0 }) })) };
  writeFileSync(join(MOVEMENTS, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Written: packages/movement/movements/${name}.json`);
}

if (values.replays) {
  // With --write, the numbers just written: never the file as it was before.
  const rows = replayTable(values.write ? withNumbers(movement, fitted) : movement);
  const replays = [...new Set(rows.map((r) => r.replay))];
  console.log(`\nEach judged video played again the ways the world changes it (scripts/replays.ts)`);
  for (const replay of replays) {
    const own = rows.filter((r) => r.replay === replay && r.entry.movement === name);
    const others = rows.filter((r) => r.replay === replay && r.entry.movement === null);
    const counted = own.reduce((n, r) => n + r.count, 0);
    const eye = own.reduce((n, r) => n + r.most, 0);
    const untried = [...own, ...others].filter((r) => !r.tried);
    const wrong = [...own, ...others].filter((r) => r.tried && !holds(r));
    const open = wrong.filter(openRow);
    const falseOnes = others.filter((r) => r.count > 0);
    const verdict = wrong.length === 0 ? "right" : !replay.hold ? "differs" : wrong.length === open.length ? "OPEN" : "WRONG";
    console.log(
      `  ${pad(replay.name, 24)} ${replay.hold ? "held " : "shown"} ${name} reps ${pad(`${String(counted)} of ${String(eye)}`, 9)} other movements counted ${String(falseOnes.reduce((n, r) => n + r.count, 0))}  ${verdict}  ${replay.words}${untried.length === 0 ? "" : ` (it changed nothing in ${String(untried.length)} videos, not counted as tried)`}`,
    );
    for (const r of wrong) {
      const why = r.reps.filter((x) => x.verdict !== "counted" && (x.readings["depth"] ?? 0) > 0.1).map((x) => `${x.verdict}${x.rule === null ? "" : `: ${x.rule}`}`);
      console.log(`      ${pad(r.label, 36)} must ${r.least === r.most ? String(r.most) : `${String(r.least)} to ${String(r.most)}`}, counted ${String(r.count)}${r.leftOut === null ? "" : `, left out ${String(r.leftOut)}`}${openRow(r) ? " (open)" : ""}  ${why.join("; ")}`);
    }
  }
  for (const r of rows.filter((x) => x.entry.replayOpen !== undefined && x.replay === replays[0])) {
    console.log(`\nOpen under ${r.entry.replayOpen?.replays.join(", ") ?? ""}: ${r.label}: ${r.entry.replayOpen?.why ?? ""}`);
  }
}
