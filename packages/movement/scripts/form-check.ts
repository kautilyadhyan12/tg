// The form check of an exercise (spec Part 2 §12.5; ROADMAP 52b-ii-a), on the laptop or on GitHub:
//   corepack pnpm --filter @app/movement form-check [squat] [--write] [--replays]
// It sets the line of each mistake the exercise has the camera check (formCheck.ts says the rule), prints each with
// where it came from, and the mistakes marked on every good-form video as filmed (there must be none). --replays also
// plays every good-form video the ways the world changes it. --write puts the lines into exercises/<id>.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { checkedOf } from "../src/index.js";
import { fitForm, formRows, withFormNumbers, type FormFitted } from "./formCheck.js";
import { EXERCISES, proofVideos, readExercise, readMovement } from "./movementCheck.js";
import { REPLAYS } from "./replays.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { write: { type: "boolean", default: false }, replays: { type: "boolean", default: false } } });
const id = positionals[0] ?? "squat";
const exercise = readExercise(id);
const movement = readMovement(exercise.movement);
const videos = proofVideos();
const setting = videos.filter((v) => v.entry.movement === movement.name && v.video.sets);
const people = [...new Set(setting.map((v) => v.entry.person))];
const fitted = fitForm(movement, exercise, setting);
const folds = people.map((person) => ({ person, fitted: fitForm(movement, exercise, setting.filter((v) => v.entry.person !== person)) }));

const r2 = (v: number): string => String(Math.round(v * 100) / 100);
console.log(`The ${id} exercise's mistakes the camera checks, set from ${String(people.length)} people`);
for (const f of fitted) {
  const m = checkedOf(exercise).find((x) => x.id === f.mistake);
  const word = m?.atLeast !== undefined ? "at least" : "at most";
  const written = m?.atLeast ?? m?.atMost;
  const range = folds.map((fold) => fold.fitted.find((x) => x.mistake === f.mistake)?.bound ?? Number.NaN);
  console.log(
    `  ${f.mistake.padEnd(18)} ${word} ${String(f.bound).padEnd(6)} (furthest rep ${r2(f.furthest)}, middle ${r2(f.middle)}, ${String(f.reps)} reps; room ${r2(f.room.size)} on ${String(f.room.pairs)}; standard moved ${f.fromStandard === null ? "-" : r2(f.fromStandard)}; one person left out ${String(Math.min(...range))} to ${String(Math.max(...range))})${written === f.bound ? "" : `  [the file says ${String(written)}]`}`,
  );
}

const checked = withFormNumbers(exercise, fitted);
const rows = formRows(movement, checked, values.replays ? REPLAYS.filter((r) => r.hold) : [], videos);
const marked = rows.filter((r) => r.made.length > 0);
console.log(`\nGood-form videos${values.replays ? ", as filmed and under every held replay" : ", as filmed"}, with their person left out too: ${String(rows.length)} runs, ${String(marked.length)} with a mistake marked`);
for (const r of marked) {
  console.log(`  ${r.label.padEnd(40)} ${(r.replay?.name ?? "as filmed").padEnd(24)} ${r.leftOut ? "left out" : "        "} ${r.made.map((x) => `${(x.at / 1000).toFixed(1)}s ${x.mistake} ${x.reading === null ? "" : r2(x.reading)}`).join("; ")}`);
}

if (values.write) {
  const words = (f: FormFitted): string => {
    const m = checkedOf(exercise).find((x) => x.id === f.mistake);
    const way = m?.atLeast !== undefined ? "minus" : "plus";
    const standard = f.fromStandard === null ? "" : `the further out of the form standard, ${String(m?.standard?.at)} (its source beside it), and `;
    return `Set by form-check: ${standard}the furthest of ${String(f.reps)} reps of ${String(people.length)} people's good-form videos, as filmed and as each replay that sets numbers (${r2(f.furthest)}), ${way} the camera's own room: the same rep's change from as filmed to each such replay, in 99 reps of 100 (${String(f.room.pairs)} reps): ${r2(f.room.size)}; rounded outward.`;
  };
  const json = {
    ...checked,
    mistakes: checked.mistakes.map((m) => {
      const f = fitted.find((x) => x.mistake === m.id);
      return f === undefined ? m : { ...m, from: words(f) };
    }),
  };
  writeFileSync(join(EXERCISES, `${id}.json`), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Written: packages/movement/exercises/${id}.json`);
}
