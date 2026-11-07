// What Your runs costs at full size (ROADMAP Stage 5 37c-i; CLAUDE.md §4 "Cost at full size"). One person
// with RUNS runs (1,500 unless set: six a week for five years), each an hour's line, and one of twelve
// hours. Measured for what the person does: the list's first page, a page far down, a day picked on
// the calendar, the calendar's month, a run's page (an hour; twelve hours), a change, a delete (the
// streak, badges and XP worked out again over all of them), and a first list read of 20 runs saved
// before 37c-i, each made its small route. Two numbers each: total, and how long the api's one thread
// is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-your-runs-cost.ts
//
// LOCAL DATABASES ONLY: it writes a person and their runs, and removes them.
import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { encodePolyline, routeShape, runSums, type RunPoint } from "@app/shared";
import * as geo from "../src/modules/geo/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-your-runs-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const RUNS = Number(process.env["RUNS"] ?? "1500");
const TIMES = 7;
const EMAIL = "your-runs-cost@example.com";

/** A run of `seconds`, a point a second, winding as a person's does. */
function made(seconds: number, seed: number): ReturnType<typeof runSums> {
  const points: RunPoint[] = [];
  let lat = 26.1445 + seed * 1e-5;
  let lng = 91.7362;
  let h = seed;
  for (let i = 0; i <= seconds; i++) {
    h += Math.sin(i / 97 + seed) * 0.05;
    lat += (3 * Math.cos(h)) / 111_132;
    lng += (3 * Math.sin(h)) / 100_000;
    points.push([i * 1000, lat, lng, 5]);
  }
  return runSums(points, [], seconds * 1000, 70);
}

/** The splits as the runs table keeps them, in plain JSON. */
const splitsJson = (sums: ReturnType<typeof runSums>) => ({
  km: sums.splitsKm.map((x) => ({ m: x.m, s: x.s })),
  mi: sums.splitsMi.map((x) => ({ m: x.m, s: x.s })),
  starts: [...sums.trackStarts],
});

async function cleanup(): Promise<void> {
  const me = sql`SELECT id FROM users WHERE email = ${EMAIL}`;
  await sql`DELETE FROM runs WHERE user_id IN (${me})`;
  await sql`DELETE FROM run_removed_ids WHERE user_id IN (${me})`;
  await sql`DELETE FROM user_xp WHERE user_id IN (${me})`;
  await sql`DELETE FROM streaks WHERE user_id IN (${me})`;
  await sql`DELETE FROM user_achievements WHERE user_id IN (${me})`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
}

async function time(fn: () => Promise<unknown>): Promise<{ wall: number; js: number }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  await fn();
  const wall = performance.now() - start;
  return { wall, js: performance.eventLoopUtilization(before).active };
}
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;

async function measure(name: string, fn: () => Promise<unknown>, times = TIMES): Promise<void> {
  const runs: { wall: number; js: number }[] = [];
  for (let i = 0; i < times; i++) runs.push(await time(fn));
  console.log(`  ${name.padEnd(44)} total ${fmt(median(runs.map((r) => r.wall)))} · thread busy ${fmt(median(runs.map((r) => r.js)))}`);
}

async function main(): Promise<void> {
  await cleanup();
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, display_name, timezone) VALUES (${EMAIL}, 'Cost Runner', 'Asia/Kolkata') RETURNING id`;
  if (user === undefined) throw new Error("no user");
  const deps = { sql };
  const hour = made(3600, 1);
  const line = encodePolyline(hour.track);
  const shape = routeShape(hour.track, hour.trackStarts);
  const splits = sql.json(splitsJson(hour));
  const now = Date.now();
  const ids: string[] = [];
  for (let start = 0; start < RUNS; start += 250) {
    const rows = Array.from({ length: Math.min(250, RUNS - start) }, (_, k) => {
      const id = randomUUID();
      ids.push(id);
      const i = start + k;
      return {
        id, user_id: user.id, started_at: new Date(now - (i + 1) * 29 * 3_600_000), duration_s: hour.movingS, distance_m: hour.distanceM,
        polyline: line, splits, kcal_point: hour.kcal, kcal_calc_version: 1, source: "mobile", name: "Morning Run", elapsed_s: hour.elapsedS,
        left_out_m: 0, left_out_s: 0, run_calc_version: 1, climb_m: 12, climb_state: "done", shape,
      };
    });
    await sql`INSERT INTO runs ${sql(rows)}`;
  }
  const long = made(43_199, 2);
  const longId = randomUUID();
  await sql`
    INSERT INTO runs (id, user_id, started_at, duration_s, distance_m, polyline, splits, kcal_point, source, name, elapsed_s, left_out_m, left_out_s, run_calc_version, shape)
    VALUES (${longId}, ${user.id}, ${new Date(now - 3_600_000)}, ${long.movingS}, ${long.distanceM}, ${encodePolyline(long.track)},
            ${sql.json(splitsJson(long))}, ${long.kcal}, 'mobile', 'Long day', ${long.elapsedS}, 0, 0, 1,
            ${routeShape(long.track, long.trackStarts)})`;
  await sql`ANALYZE runs`;
  console.log(`measure-your-runs-cost: ${String(RUNS + 1)} runs for one person · ${cpus()[0]?.model ?? "?"} · ${new Date().toISOString()}`);

  const first = await geo.listRuns(deps, user.id, 20, null);
  const deep = (await sql<{ started_at: Date; id: string }[]>`SELECT started_at, id FROM runs WHERE user_id = ${user.id} ORDER BY started_at DESC, id DESC OFFSET 1400 LIMIT 1`)[0];
  const picked = (await sql<{ day: string }[]>`SELECT to_char(started_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day FROM runs WHERE id = ${ids[700] ?? ""}`)[0]?.day ?? null;
  const month = first.items[5]?.day.slice(0, 7) ?? "2026-11";
  await measure("the list's first page (20)", () => geo.listRuns(deps, user.id, 20, null));
  await measure("a page far down (run 1,400 on)", () => geo.listRuns(deps, user.id, 20, deep === undefined ? null : { at: deep.started_at, id: deep.id }));
  await measure("a day picked on the calendar", () => geo.listRuns(deps, user.id, 20, null, picked));
  await measure("the calendar's month", () => geo.runCalendar(deps, user.id, month));
  await measure("a run's page (an hour)", () => geo.getRun(deps, user.id, ids[3] ?? ""));
  await measure("a run's page (twelve hours)", () => geo.getRun(deps, user.id, longId));
  await measure("a change (how it felt)", () => geo.changeRun(deps, user.id, ids[4] ?? "", { effort: 7 }));
  let n = 10;
  await measure("a delete, streak and XP worked out again", () => geo.deleteRun(deps, user.id, ids[n++] ?? ""));
  // Twenty runs saved before 37c-i: the first list read makes each its shape and keeps it.
  const old = async () => {
    await sql`UPDATE runs SET shape = NULL WHERE id IN (SELECT id FROM runs WHERE user_id = ${user.id} ORDER BY started_at DESC, id DESC LIMIT 20)`;
    return { wall: 0, js: 0 };
  };
  const firsts: { wall: number; js: number }[] = [];
  for (let i = 0; i < TIMES; i++) {
    await old();
    firsts.push(await time(() => geo.listRuns(deps, user.id, 20, null)));
  }
  console.log(`  ${"20 older runs read first, each made its shape".padEnd(44)} total ${fmt(median(firsts.map((r) => r.wall)))} · thread busy ${fmt(median(firsts.map((r) => r.js)))}`);
  await cleanup();
  await sql.end();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await cleanup().catch(() => undefined);
  await sql.end();
  process.exit(1);
});
