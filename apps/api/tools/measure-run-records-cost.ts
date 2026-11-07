// What running records cost at full size (ROADMAP Stage 5 37c-ii; CLAUDE.md §4 "Cost at full size"). One person
// with RUNS runs (1,500 unless set: six a week for five years), each with its best efforts. Measured for what the
// person does: the records read (the Running page, Achievements, a run's summary), a run's page (which now names
// the records it holds), and the best efforts worked out when a run is saved (the shared maths over an hour's
// points, and over twelve hours', the most a run may hold). Two numbers each: total, and how long the api's one
// thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-run-records-cost.ts
//
// LOCAL DATABASES ONLY: it writes a person and their runs, and removes them.
import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { RECORD_DISTANCES_M, fastestStretch, runSums, type RunMark, type RunPoint } from "@app/shared";
import * as geo from "../src/modules/geo/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-run-records-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const RUNS = Number(process.env["RUNS"] ?? "1500");
const TIMES = 7;
const EMAIL = "run-records-cost@example.com";

/** A run of `seconds`, a point a second, winding as a person's does. */
function points(seconds: number, seed: number): RunPoint[] {
  const out: RunPoint[] = [];
  let lat = 26.1445 + seed * 1e-5;
  let lng = 91.7362;
  let h = seed;
  for (let i = 0; i <= seconds; i++) {
    h += Math.sin(i / 97 + seed) * 0.05;
    lat += (3 * Math.cos(h)) / 111_132;
    lng += (3 * Math.sin(h)) / 100_000;
    out.push([i * 1000, lat, lng, 5]);
  }
  return out;
}

async function cleanup(): Promise<void> {
  const me = sql`SELECT id FROM users WHERE email = ${EMAIL}`;
  await sql`DELETE FROM runs WHERE user_id IN (${me})`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
async function measure(name: string, fn: () => unknown, times = TIMES): Promise<void> {
  const walls: number[] = [];
  const busy: number[] = [];
  for (let i = 0; i < times; i++) {
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    await fn();
    walls.push(performance.now() - start);
    busy.push(performance.eventLoopUtilization(before).active);
  }
  console.log(`  ${name.padEnd(48)} total ${fmt(median(walls))} · thread busy ${fmt(median(busy))}`);
}

async function main(): Promise<void> {
  await cleanup();
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, display_name, timezone) VALUES (${EMAIL}, 'Cost Runner', 'Asia/Kolkata') RETURNING id`;
  if (user === undefined) throw new Error("no user");
  const now = Date.now();
  const ids: string[] = [];
  for (let start = 0; start < RUNS; start += 250) {
    const rows = Array.from({ length: Math.min(250, RUNS - start) }, (_, k) => {
      const i = start + k;
      const id = randomUUID();
      ids.push(id);
      const k1 = 270 + ((i * 37) % 120);
      const distance = 3000 + ((i * 53) % 9000);
      return {
        id, user_id: user.id, started_at: new Date(now - (i + 1) * 29 * 3_600_000), duration_s: Math.round(distance / 3), distance_m: distance,
        source: "mobile", name: "Morning Run", elapsed_s: Math.round(distance / 3), left_out_m: 0, left_out_s: 0, run_calc_version: 1,
        best_1k_s: k1, best_mile_s: Math.round(k1 * 1.62), best_5k_s: distance >= 5000 ? k1 * 5 + 30 : null, best_10k_s: distance >= 10_000 ? k1 * 10 + 90 : null,
      };
    });
    await sql`INSERT INTO runs ${sql(rows)}`;
  }
  await sql`ANALYZE runs`;
  console.log(`measure-run-records-cost: ${String(RUNS)} runs for one person · ${cpus()[0]?.model ?? "?"} · ${new Date().toISOString()}`);
  const deps = { sql };
  await measure("the records read", () => geo.runRecords(deps, user.id));
  await measure("a run's page, with the records it holds", () => geo.getRun(deps, user.id, ids[3] ?? ""));
  const hour = points(3600, 1);
  const twelve = points(43_199, 2);
  await measure("save's maths, an hour's run (with best efforts)", () => runSums(hour, [], 3_600_000, 70));
  await measure("save's maths, twelve hours (with best efforts)", () => runSums(twelve, [], 43_199_000, 70));
  // The best efforts alone, over twelve hours' marks, all four distances.
  const marks: RunMark[] = twelve.map(([t], i) => ({ d: i * 3, t }));
  await measure("best efforts alone, twelve hours, four distances", () =>
    Object.values(RECORD_DISTANCES_M).map((m) => fastestStretch([marks], m)),
  );
  await cleanup();
  await sql.end();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await cleanup().catch(() => undefined);
  await sql.end();
  process.exit(1);
});
