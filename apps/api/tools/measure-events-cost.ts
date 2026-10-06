// What a gym's Events cost at full size (ROADMAP 19c-i; CLAUDE.md §4 "Cost at full size").
// One gym of 200 live app members (--members= for another size) with the most coming
// events a gym may keep (100), each with a poster and details of 1,000 characters, and
// 5,000 ended ones. Read as a member and as staff read them, every member asking at the
// same instant, and an event added and changed with a poster at the biggest size the app
// takes. Two numbers each, over several runs:
//   - total: how long it takes (a read holds one of the pool's connections meanwhile);
//   - server thread busy: how long the server's one thread answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-events-cost.ts [--members=200]
//
// LOCAL DATABASES ONLY: it writes a gym, its accounts and events, and removes them.
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { GYM_EVENTS_COMING_MAX, GYM_EVENT_POSTER_MAX_BYTES, addGymEventRequestSchema, changeGymEventRequestSchema } from "@app/shared";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import { addEvent, changeEvent, getEvents, getPoster, getStaffEvents, setCancelled } from "../src/modules/orgs/events/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-events-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api holds (Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const membersArg = process.argv.find((a) => a.startsWith("--members="));
const MEMBERS = membersArg === undefined ? 200 : Number(membersArg.slice("--members=".length));
const PAST = 5000;
const RUNS = 5;
const PLAN = "zz_events_cost";
const PREFIX = "events-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM photo_files_to_remove WHERE storage_key LIKE ANY (SELECT 'gym-event/' || id || '/%' FROM gyms WHERE slug LIKE ${PREFIX + "%"})`;
  await sql`DELETE FROM gym_events WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

async function seed(): Promise<{ gymId: string; owner: string; members: string[] }> {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const users = Array.from({ length: MEMBERS + 1 }, (_, i) => ({ id: randomUUID(), email: `${PREFIX}${String(i)}-${randomUUID()}@example.com`, display_name: `Member${String(i)}` }));
  for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
  const owner = users[0]?.id ?? "";
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const rows = users.slice(1).map((u) => ({ gym_id: gymId, user_id: u.id, joined_at: new Date(Date.now() - 365 * 86_400_000) }));
  for (let i = 0; i < rows.length; i += 1000) await sql`INSERT INTO gym_members ${sql(rows.slice(i, i + 1000))}`;
  // One short of the most coming events, so the add below is the last a gym may make;
  // every one with a poster's row, the longest details, name and place.
  const event = (from: ReturnType<typeof sql>, n: ReturnType<typeof sql>) => sql`
    INSERT INTO gym_events (gym_id, event_key, name, details, place, starts_on, start_minute, ends_on, end_minute, starts_at, ends_at, places,
                            poster_id, poster_key, poster_type, poster_bytes, poster_width, poster_height)
    SELECT ${gymId}, gen_random_uuid(), repeat('N', 80), repeat('Words of an event. ', 52), repeat('P', 120),
           (t.at AT TIME ZONE 'Europe/London')::date, 600, (t.at AT TIME ZONE 'Europe/London')::date, 660, t.at, t.at + interval '1 hour', 40,
           p.id, 'gym-event/' || ${gymId} || '/' || p.id || '.jpg', 'image/jpeg', 1048576, 1600, 1200
    FROM generate_series(1, ${n}) AS n, LATERAL (SELECT ${from} AS at, gen_random_uuid() AS id) AS t(at, id), LATERAL (SELECT t.id) AS p(id)`;
  await event(sql`now() + n * interval '1 day'`, sql`${GYM_EVENTS_COMING_MAX - 1}`);
  await event(sql`now() - n * interval '6 hours'`, sql`${PAST}`);
  await sql`ANALYZE gym_events`;
  return { gymId, owner, members: users.slice(1).map((u) => u.id) };
}

/** A JPEG of exactly the biggest size a poster may be: a real one with filler before its end. */
async function biggestPoster(): Promise<string> {
  const small = await readFile(new URL("../test/fixtures/photos/iphone16.jpg", import.meta.url));
  const end = small.lastIndexOf(Buffer.from([0xff, 0xd9]));
  const filler = Buffer.alloc(GYM_EVENT_POSTER_MAX_BYTES - small.length, 0x55);
  return Buffer.concat([small.subarray(0, end), filler, small.subarray(end)]).toString("base64");
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;

async function time<T>(fn: () => Promise<T>): Promise<{ wall: number; js: number; value: T }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  const value = await fn();
  const wall = performance.now() - start;
  return { wall, js: performance.eventLoopUtilization(before).active, value };
}

function report(name: string, runs: { wall: number; js: number }[]): void {
  const walls = runs.map((r) => r.wall);
  const jss = runs.map((r) => r.js);
  console.log(`${name.padEnd(40)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}

await cleanup();
const { gymId, owner, members } = await seed();
const folder = await mkdtemp(join(tmpdir(), "aihg-events-cost-"));
try {
  const deps = { sql, now: () => new Date(), photos: createDiskPhotoStore(folder), log: { warn: () => undefined } };
  const allowed = (): Promise<boolean> => Promise.resolve(true);
  const viewer = members[0] ?? "";
  const counted = await sql<{ coming: number; past: number }[]>`
    SELECT count(*) FILTER (WHERE ends_at > now())::int AS coming, count(*) FILTER (WHERE ends_at <= now())::int AS past FROM gym_events WHERE gym_id = ${gymId}`;
  console.log(`one gym: ${String(MEMBERS)} members, ${String(counted[0]?.coming ?? 0)} coming events, ${String(counted[0]?.past ?? 0)} ended; cpu ${String(cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`);

  const list = await getEvents(deps, viewer, gymId, allowed);
  console.log(`a member's list: ${String(list?.events.length ?? 0)} events, ${String(JSON.stringify(list).length)} bytes of JSON`);

  const reads: [string, () => Promise<unknown>][] = [
    ["member, the coming events", () => getEvents(deps, viewer, gymId, allowed)],
    ["staff, coming and past", () => getStaffEvents(deps, owner, gymId, allowed)],
    [`${String(MEMBERS)} members ask at the same instant`, () => Promise.all(members.map((id) => getEvents(deps, id, gymId, allowed)))],
  ];
  for (const [name, fn] of reads) {
    await fn();
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await time(fn));
    report(name, runs);
  }

  const poster = await biggestPoster();
  const day = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  const fields = { name: "N".repeat(80), details: "Words of an event. ".repeat(52).trim(), place: "P".repeat(120), startsOn: day, startMinute: 600, endsOn: day, endMinute: 660, places: 40 };
  const adds = [];
  const changes = [];
  const cancels = [];
  const pictures = [];
  for (let i = 0; i < RUNS; i++) {
    const body = addGymEventRequestSchema.parse({ eventKey: randomUUID(), ...fields, poster });
    const added = await time(() => addEvent(deps, owner, gymId, body));
    adds.push(added);
    const id = added.value.id;
    changes.push(await time(() => changeEvent(deps, owner, gymId, id, changeGymEventRequestSchema.parse({ ...fields, poster }))));
    const now = await sql<{ poster_id: string }[]>`SELECT poster_id FROM gym_events WHERE id = ${id}`;
    pictures.push(await time(() => getPoster(deps, viewer, gymId, id, now[0]?.poster_id ?? "", true, allowed)));
    cancels.push(await time(() => setCancelled(deps, owner, gymId, id, true, allowed)));
    // Off the list again, so the next run's add is once more the gym's last.
    await sql`DELETE FROM gym_events WHERE id = ${id}`;
  }
  report("staff add an event, 1 MB poster", adds);
  report("staff change it, a new 1 MB poster", changes);
  report("a member reads a 1 MB poster", pictures);
  report("staff cancel an event", cancels);
} finally {
  await cleanup();
  await rm(folder, { recursive: true, force: true });
  await sql.end({ timeout: 5 });
}
