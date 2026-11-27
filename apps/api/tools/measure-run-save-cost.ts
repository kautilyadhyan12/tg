// What saving a run costs at full size (ROADMAP Stage 5 37o, the running faults' E3; CLAUDE.md §4 "Cost at full
// size"). One person with RUNS runs behind them (1,500 unless set: six a week for five years). Measured for what a
// phone sends: an hour's run, the longest a phone keeps (twelve hours of points, a heart reading each second and
// 2,000 pauses), and the same longest run sent again (answered from its row, its streak, badges and XP worked out
// again over all the runs, 37o's E2), and the longest run's body read and checked before the route sees it. Three numbers each: total, how long the api's one thread is busy, and its
// longest single stall, the time it answers nobody at all. The height map is a stand-in that answers at once.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-run-save-cost.ts
//
// LOCAL DATABASES ONLY: it writes a person and their runs, and removes them.
import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { RUN_MAX_PAUSES, RUN_MAX_POINTS, saveRunRequestSchema, type RunPoint, type SaveRunRequest } from "@app/shared";
import * as geo from "../src/modules/geo/service.js";
import type { HeightMap } from "../src/modules/geo/heights.adapter.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-run-save-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 10 });
const RUNS = Number(process.env["RUNS"] ?? "1500");
const TIMES = 5;
const EMAIL = "run-save-cost@example.com";

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
  await sql`DELETE FROM run_removed_ids WHERE user_id IN (${me})`;
  await sql`DELETE FROM user_xp WHERE user_id IN (${me})`;
  await sql`DELETE FROM streaks WHERE user_id IN (${me})`;
  await sql`DELETE FROM user_achievements WHERE user_id IN (${me})`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
}

type Took = { wall: number; js: number; stall: number };
async function time(fn: () => Promise<unknown>): Promise<Took> {
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  await fn();
  const wall = performance.now() - start;
  const js = performance.eventLoopUtilization(before).active;
  delay.disable();
  return { wall, js, stall: delay.max / 1e6 };
}
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;

async function measure(name: string, fn: () => Promise<unknown>): Promise<void> {
  const runs: Took[] = [];
  for (let i = 0; i < TIMES; i++) runs.push(await time(fn));
  console.log(`  ${name.padEnd(46)} total ${fmt(median(runs.map((r) => r.wall)))} · thread busy ${fmt(median(runs.map((r) => r.js)))} · longest stall ${fmt(median(runs.map((r) => r.stall)))}`);
}

async function main(): Promise<void> {
  await cleanup();
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, display_name, timezone) VALUES (${EMAIL}, 'Cost Runner', 'Asia/Kolkata') RETURNING id`;
  if (user === undefined) throw new Error("no user");
  const heights: HeightMap = { heightsAt: (places) => Promise.resolve(places.map(() => 55)) };
  const deps = { sql, now: () => new Date(), heights, log: { error: () => undefined } };
  const now = Date.now();
  // The runs behind the person: an hour each, saved the way the phone saves them.
  const hour = points(3600, 1);
  const send = (over: Partial<SaveRunRequest>): SaveRunRequest => ({
    runId: randomUUID(),
    startedAt: new Date(now - 3 * 3_600_000).toISOString(),
    elapsedMs: 3_600_000,
    points: hour,
    pauses: [],
    name: "Morning Run",
    effort: null,
    note: null,
    ...over,
  });
  const first = await geo.saveRun(deps, user.id, send({ startedAt: new Date(now - 29 * 3_600_000).toISOString() }));
  const template = await sql<Record<string, unknown>[]>`SELECT * FROM runs WHERE id = ${first.run.id}`;
  const row = template[0];
  if (row === undefined) throw new Error("no template run");
  for (let start = 1; start < RUNS; start += 250) {
    const rows = Array.from({ length: Math.min(250, RUNS - start) }, (_, k) => ({ ...row, id: randomUUID(), started_at: new Date(now - (start + k + 1) * 29 * 3_600_000) }));
    await sql`INSERT INTO runs ${sql(rows)}`;
  }
  await sql`ANALYZE runs`;
  console.log(`measure-run-save-cost: ${String(RUNS)} runs behind one person · ${cpus()[0]?.model ?? "?"} · ${new Date().toISOString()}`);

  await measure("an hour's run (3,601 points)", () => geo.saveRun(deps, user.id, send({})));
  const longPoints = points(RUN_MAX_POINTS - 1, 2);
  const pauses: [number, number][] = Array.from({ length: RUN_MAX_PAUSES }, (_, i) => [i * 21_000 + 10_000, i * 21_000 + 10_500]);
  const heart = longPoints.map(([at]): [number, number] => [at, 140 + (at % 7)]);
  const longest = (): SaveRunRequest => send({ startedAt: new Date(now - 13 * 3_600_000).toISOString(), elapsedMs: RUN_MAX_POINTS * 1000, points: longPoints, pauses, heart });
  const text = JSON.stringify(longest());
  await measure(`its body read and checked (${(text.length / 1e6).toFixed(1)} MB, JSON and Zod)`, () => Promise.resolve(saveRunRequestSchema.parse(JSON.parse(text))));
  await measure("the longest run (43,200 points, heart, pauses)", () => geo.saveRun(deps, user.id, longest()));
  const again = longest();
  await geo.saveRun(deps, user.id, again);
  await measure("the longest run sent again (answered from its row)", () => geo.savedRunIfAny(deps, user.id, again.runId));
  await cleanup();
  await sql.end();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await cleanup().catch(() => undefined);
  await sql.end();
  process.exit(1);
});
