// Three real runs recorded on phones (fixtures/real-runs.json; its source and licence inside), for the
// run's voice (ROADMAP Stage 5 item 37a-ii): [ms since the first point, latitude, longitude].
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type RealPoint = [number, number, number];

const isPoint = (p: unknown): p is RealPoint => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number");

/** Each run's points, by its name in the file; a file that does not read as runs fails the test. */
export function realRuns(): Map<string, RealPoint[]> {
  const raw: unknown = JSON.parse(readFileSync(join(__dirname, "fixtures", "real-runs.json"), "utf8"));
  const runs: unknown = typeof raw === "object" && raw !== null ? Reflect.get(raw, "runs") : null;
  if (typeof runs !== "object" || runs === null) throw new Error("real-runs.json holds no runs");
  const out = new Map<string, RealPoint[]>();
  for (const key of Object.keys(runs)) {
    const run: unknown = Reflect.get(runs, key);
    const points: unknown = typeof run === "object" && run !== null ? Reflect.get(run, "points") : null;
    if (!Array.isArray(points) || !points.every(isPoint)) throw new Error(`real-runs.json: ${key} holds no points`);
    out.set(key, points);
  }
  return out;
}
