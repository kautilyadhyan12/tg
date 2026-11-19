// The proof table of a movement (spec Part 2 §12.5; ROADMAP 52a), on the laptop or on GitHub:
//   corepack pnpm --filter @app/movement movement-check [squat] [--write]
// It sets the movement's numbers from the videos that may set them (movementCheck.ts says the rules), prints every
// video's reps by eye against the engine's count, each person's count with their own videos left out of the numbers,
// and the most any set of numbers counted on another movement's video. --write puts the numbers, and where each came
// from, into movements/<name>.json; without it the file is only compared.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { MOVEMENTS, proofTable, readMovement, withNumbers, type Fitted } from "./movementCheck.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { write: { type: "boolean", default: false } } });
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
  const right = r.entry.reps === null ? "reported" : r.count === r.entry.reps && (r.leftOut === null || r.leftOut === r.entry.reps) ? "right" : "WRONG";
  const why = r.reps.filter((x) => x.verdict !== "counted").map((x) => `${(x.start / 1000).toFixed(1)}s ${x.verdict}${x.rule === null ? "" : `: ${x.rule}`}`);
  console.log(
    `  ${pad(r.label, 40)} ${pad(r.entry.view, 7)} ${pad(r.entry.movement ?? "other", 6)} eye ${pad(eye, 2)} counted ${pad(String(r.count), 2)} left out ${pad(r.leftOut === null ? "-" : String(r.leftOut), 2)} ${pad(right, 8)} ${why.join("; ")}`,
  );
}
console.log(`\nThe most any set of numbers (all people, or one left out) counted on another movement's video: ${String(worstOther)}`);

if (values.write) {
  const people = folds.map((f) => f.person);
  const words = (f: Fitted): string => {
    const rule = movement.rules.find((r) => r.name === f.rule);
    const how = rule?.role === "count" ? "a quarter of the way back towards standing from the shallowest rep" : "beyond the furthest rep by half its distance from the middle rep";
    return `Set by movement-check from ${String(people.length)} people's videos (scripts/movementVideos.ts), ${String(f.reps)} reps: ${how} (${num(Math.round(f.from * 100) / 100)}; standing ${num(Math.round(f.standing * 100) / 100)}).`;
  };
  const out = withNumbers(movement, fitted);
  const json = { ...out, rules: out.rules.map((r) => ({ ...r, from: words(fitted.find((f) => f.rule === r.name) ?? { rule: r.name, bound: 0, from: 0, standing: 0, reps: 0 }) })) };
  writeFileSync(join(MOVEMENTS, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Written: packages/movement/movements/${name}.json`);
}
