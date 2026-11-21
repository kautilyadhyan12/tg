// corepack pnpm --filter @app/movement floor-view
// Prints how a man's own floor phone leaned, whether the floor replay reads his raised squats as his real floor squats
// (for each lean measured), the same with the pose model's own foot wander measured on his floor sets added, and what a
// floor phone saw of each of his other positions (floorView.ts says how).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readKept } from "./bodyCheck.js";
import { faithful, phoneLean, positionsTable } from "./floorView.js";
import { MOVEMENT_VIDEOS } from "./movementVideos.js";
import { FLOOR_LEAN, FLOOR_LEANS, FLOOR_LEANS_MEASURED, LENS_MM, floorSquatSets, wanderSpread } from "./replays.js";

const TEST = join(import.meta.dirname, "../test");
const round = (v: number, d: number): string => (Number.isFinite(v) ? v.toFixed(d) : "-");

console.log("How his phone stood, upright on the floor, its lens about 15 cm up (pictures he stands tall in):");
const upright = [...new Set(MOVEMENT_VIDEOS.filter((e) => e.floor === true && !e.seen.includes("long side")).map((e) => e.file))];
for (const file of upright) {
  const kept = readKept(new Uint8Array(readFileSync(join(TEST, `${file}.bodypoints`))));
  const lean = phoneLean(kept.frames);
  console.log(`  ${file}: ${lean === null ? "he stands tall in fewer than 10 pictures" : `leans back ${round(lean.degrees, 1)} degrees, ${round(lean.distance, 2)} m from him, ${String(lean.frames)} pictures`}`);
}

for (const lean of [...FLOOR_LEANS, ...FLOOR_LEANS_MEASURED.filter((l) => !FLOOR_LEANS.includes(l))]) {
  const f = faithful(lean);
  console.log(`\nRedrawn leaning back ${String(lean)} degrees: ${f.passes ? "KEPT, it reads as his real floor squats do" : "NOT USED, it does not read as his real floor squats do"}`);
  console.log(`  his raised sets redrawn count ${f.redrawn.map((s) => `${String(s.count)}/${String(s.reps)}`).join(", ")}; called short ${String(f.redrawn.reduce((n, s) => n + s.short, 0))}`);
  console.log("  reading | his real floor sets: lowest, middle, highest | his raised sets as filmed | redrawn | judged: taken at least half way to the floor's, never past it");
  for (const r of f.rows) {
    const verdict = r.judged ? (r.within ? "yes" : "NO") : "shown only, not checked";
    const past = r.beyond.length === 0 ? "" : ` (past every floor set: ${r.beyond.join(", ")})`;
    console.log(`  ${r.reading} | ${round(r.low, 3)}, ${round(r.floor, 3)}, ${round(r.high, 3)} | ${round(r.filmed, 3)} | ${round(r.redrawn, 3)} | ${verdict}${past}`);
  }
}

// 52a-ii-b-ii-b-i: the pose model's own foot wander measured on his floor sets, added in step with his knees.
const floorSets = floorSquatSets().floor;
const tries: readonly (readonly [string, readonly string[] | null])[] = [
  ["all four floor sets", null],
  ...floorSets.map((s): readonly [string, readonly string[]] => [`all but ${s}`, floorSets.filter((x) => x !== s)]),
  ...floorSets.map((s): readonly [string, readonly string[]] => [`${s} alone`, [s]]),
];
const cm = (v: number): string => (100 * v).toFixed(1);
const floorSpread = wanderSpread(floorSets);
const raisedSpread = wanderSpread(floorSquatSets().raised);
console.log(`\nHis foot points' wander over his squats (root mean square, across and down): floor sets ${cm(floorSpread[0])} and ${cm(floorSpread[1])} cm, raised sets ${cm(raisedSpread[0])} and ${cm(raisedSpread[1])} cm`);
console.log("With that wander added (leaning back the replay's 14 degrees, and every lean from all four); each reading short of his floor: redrawn | his raised sets | his floor sets, lowest to highest:");
const say = (name: string, f: ReturnType<typeof faithful>): void => {
  const short = f.rows.filter((r) => r.judged && !r.within).map((r) => `${r.reading} ${round(r.redrawn, 3)} | ${round(r.filmed, 3)} | ${round(r.low, 3)} to ${round(r.high, 3)}`);
  const place = f.rows.find((r) => r.reading === "feet stay in place");
  console.log(`  ${name}: ${f.passes ? "KEPT" : "NOT USED"}; ${String(f.redrawn.reduce((n, s) => n + s.count, 0))} of 10 counted; feet stay in place ${round(place?.redrawn ?? Number.NaN, 3)}; ${short.join("; ") || "none short"}`);
};
for (const [name, from] of tries) say(name, faithful(FLOOR_LEAN, LENS_MM, undefined, from));
for (const lean of FLOOR_LEANS_MEASURED) say(`all four, leaning back ${String(lean)}`, faithful(lean, LENS_MM, undefined, null));

console.log("\nWhat a floor phone sees (his eleven other videos as filmed; of every 100 pictures found, one side / both sides):");
for (const row of positionsTable()) {
  const parts = row.parts.map((p) => `${p.part} ${String(p.one)}/${String(p.both)}`).join(", ");
  const measures = row.measures.map((m) => `${m.measure} ${String(m.given)}`).join(", ");
  console.log(`  ${row.label} (${row.floor ? "floor" : "raised"}): found ${String(row.found)} of 100 | ${parts} | on the picture: ${measures}\n      ${row.seen}`);
}
