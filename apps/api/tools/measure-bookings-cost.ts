// What booking a class costs at full size (ROADMAP 17c-i; CLAUDE.md §4 "Cost at full
// size"; spec Part 3 §13.7). One gym of 2,100 members (--people= for another size), each
// on its list with a class pack, and a timetable of 200 classes holding 20 bookings each.
// Measured: one Book, one read, a Cancel that hands the place to a waitlist of 20, the
// staff list of a class of 500 with 100 waiting, and THE BURST: 200 people booking one
// class of 30 at the same instant through ten database connections, as the api has.
// For the burst the numbers that matter are how long the server's one thread answers
// nobody, and how long another gym's request waits for a connection while it runs.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-bookings-cost.ts [--people=200] [--no-flush] [--keep]
//
// LOCAL DATABASES ONLY: it writes a gym, its people and their bookings, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { book, cancel, createLine, getBooking, getSessionBookings } from "../src/modules/orgs/classes/bookingsService.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-bookings-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
// --no-flush: commits do not wait for the disk, which shows the code's own share. A
// commit's flush on this laptop's Docker disk is 20 to 60 ms and is paid by every write.
const noFlush = process.argv.includes("--no-flush");
const sql = postgres(url, { prepare: false, max: 10, ...(noFlush ? { connection: { synchronous_commit: "off" } } : {}) });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RUNS = 7;
const BURST = 200;
const PLAN = "zz_bookings_cost";
const PREFIX = "bookings-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Seeded {
  gymId: string;
  owner: string;
  people: string[];
  typeId: string;
}

async function seed(): Promise<Seeded> {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const packType = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, pack_classes, pack_days, access)
    VALUES (${packType}, ${gymId}, '500 classes', 'pack', 9000, 'GBP', 500, 365, 'all_classes')`;

  const people = Array.from({ length: PEOPLE }, () => randomUUID());
  const users = people.map((id, i) => ({ id, email: `${PREFIX}${String(i)}-${id}@example.com`, display_name: `Person${String(i)} Cost` }));
  const entries = people.map((id, i) => ({
    id: randomUUID(),
    gym_id: gymId,
    full_name: `Person${String(i)} Cost`,
    email: `${PREFIX}l-${String(i)}-${id}@example.com`,
    identity_key: createHash("sha256").update(id).digest("hex"),
    source: "typed",
  }));
  for (let i = 0; i < people.length; i += 1000) {
    await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
    await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
    await sql`INSERT INTO gym_members ${sql(people.slice(i, i + 1000).map((id, k) => ({ gym_id: gymId, user_id: id, joined_at: new Date("2026-01-01T00:00:00Z"), entry_id: entries[i + k]?.id ?? null })))}`;
  }
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days, classes_left, starts_on, status, renews)
    SELECT ${gymId}, e.id, ${packType}, gen_random_uuid(), 'pack', 9000, 'GBP', 500, 365, 400, current_date - 10, 'active', false
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId}`;

  // A timetable behind it: 200 classes over the coming weeks, 20 bookings each.
  const typeId = randomUUID();
  await sql`INSERT INTO gym_class_types (id, gym_id, name, minutes, places, colour) VALUES (${typeId}, ${gymId}, 'Spin', 45, 30, 'blue')`;
  await sql`
    INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places)
    SELECT ${gymId}, ${typeId}, (now() + (n || ' hours')::interval)::date, 600, now() + (n || ' hours')::interval, 45, 30
    FROM generate_series(30, 229) AS n`;
  await sql`
    INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
    SELECT ${gymId}, s.id, m.user_id, m.entry_id, h.id, 'booked', true, gen_random_uuid(), now()
    FROM (SELECT id, row_number() OVER (ORDER BY starts_at) AS k FROM gym_class_sessions WHERE gym_id = ${gymId}) s
    JOIN (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) AS r FROM gym_members WHERE gym_id = ${gymId}) m
      ON (m.r + s.k) % ${Math.max(1, Math.floor(PEOPLE / 20))} = 0
    JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.entry_id = m.entry_id`;
  // Every table filled above: a table filled seconds ago has no statistics until the
  // database's own analyse reaches it, and a plan made without them is not the one a gym
  // meets (seen here: the waitlist's read at 2 ms with them and up to 362 ms without).
  for (const table of ["users", "gym_members", "gym_member_list_entries", "gym_class_sessions", "gym_class_bookings", "gym_held_memberships"]) {
    await sql`VACUUM ANALYZE ${sql(table)}`;
  }
  return { gymId, owner, people, typeId };
}

/** A class `hours` from now with `places`, and the first `booked` people in it, the next `waiting` waiting. */
async function classOf(s: Seeded, hours: number, places: number, booked: number, waiting: number): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO gym_class_sessions (id, gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places)
    VALUES (${id}, ${s.gymId}, ${s.typeId}, (now() + ${String(hours)}::int * interval '1 hour')::date, 600, now() + ${String(hours)}::int * interval '1 hour', 45, ${places})`;
  const rows = s.people.slice(0, booked + waiting).map((userId, i) => ({
    gym_id: s.gymId,
    session_id: id,
    user_id: userId,
    status: i < booked ? "booked" : "waitlisted",
    request_key: randomUUID(),
    booked_at: i < booked ? new Date() : null,
  }));
  for (let i = 0; i < rows.length; i += 1000) await sql`INSERT INTO gym_class_bookings ${sql(rows.slice(i, i + 1000))}`;
  return id;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const yes = () => Promise.resolve(true);

async function time(fn: () => Promise<unknown>): Promise<{ wall: number; js: number }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  await fn();
  const wall = performance.now() - start;
  return { wall, js: performance.eventLoopUtilization(before).active };
}

await cleanup();
const s = await seed();
const [rows] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM gym_class_bookings WHERE gym_id = ${s.gymId}`;
const mhz = await import("node:os").then((os) => os.cpus()[0]?.speed ?? 0);
console.log(noFlush ? "commits do NOT wait for the disk (--no-flush)" : "commits wait for the disk, as in production");
console.log(`one gym: ${String(PEOPLE)} members, each with a pack; ${rows?.n ?? "?"} bookings on 200 classes; cpu ${String(mhz)} MHz; ${String(RUNS)} runs each`);

const deps = { sql, now: () => new Date(), inLine: createLine() };
const who = (n: number): string => s.people[s.people.length - 1 - n] ?? "";

const roomy = await classOf(s, 72, 500, 0, 0);
const big = await classOf(s, 72, 500, 500, 100);
// A class with places free and 100 people waiting whom nobody can move in (their packs
// are used up): every Book on it reads them all first, under the gym's lock.
const stuckPeople = s.people.slice(1500, 1600);
const stuck = await classOf(s, 72, 500, 0, 0);
if (stuckPeople.length > 0) {
  await sql`
    UPDATE gym_held_memberships h SET classes_left = 0
    FROM gym_members m
    WHERE m.gym_id = ${s.gymId} AND m.user_id = ANY(${stuckPeople}::uuid[]) AND h.gym_id = m.gym_id AND h.entry_id = m.entry_id`;
  await sql`INSERT INTO gym_class_bookings ${sql(stuckPeople.map((userId) => ({ gym_id: s.gymId, session_id: stuck, user_id: userId, status: "waitlisted", request_key: randomUUID() })))}`;
}
let n = 0;
const single: [string, () => Promise<unknown>][] = [
  ["book a place (a pack charged)", () => book(deps, who(n++), s.gymId, roomy, { requestKey: randomUUID(), joinWaitlist: false }, yes)],
  [`book past ${String(stuckPeople.length)} waiting nobody can move in`, () => book(deps, who(n++), s.gymId, stuck, { requestKey: randomUUID(), joinWaitlist: false }, yes)],
  ["read one class as a member", () => getBooking(deps, who(0), s.gymId, roomy, yes)],
  [
    "cancel, the place handed to a waitlist of 20",
    async () => {
      const full = await classOf(s, 72, 1, 1, 20);
      const start = performance.now();
      await cancel(deps, s.people[0] ?? "", s.gymId, full, false, yes);
      return performance.now() - start;
    },
  ],
  ["staff list of a class of 500 with 100 waiting", () => getSessionBookings(deps, s.owner, s.gymId, big, yes)],
];
const delay = monitorEventLoopDelay({ resolution: 1 });
for (const [name, call] of single) {
  await call();
  const walls: number[] = [];
  const jss: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    const own = await call();
    walls.push(typeof own === "number" ? own : performance.now() - start);
    jss.push(performance.eventLoopUtilization(before).active);
  }
  console.log(`${name.padEnd(46)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}

// THE BURST. 200 people, one class of 30, the same instant; every tap asks for the waitlist.
const burstWalls: number[] = [];
const burstJs: number[] = [];
const waits: number[] = [];
const stalls: number[] = [];
let outcome = "";
for (let run = 0; run < RUNS; run++) {
  const popular = await classOf(s, 72, 30, 0, 0);
  const crowd = s.people.slice(run * BURST, run * BURST + BURST);
  const state = { probing: true };
  let worstWait = 0;
  // Another gym's request during the burst: how long it waits for one of the ten connections.
  const probe = (async () => {
    while (state.probing) {
      const start = performance.now();
      await sql`SELECT 1`;
      worstWait = Math.max(worstWait, performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
  delay.reset();
  delay.enable();
  const t = await time(async () => {
    const answers = await Promise.allSettled(crowd.map((userId) => book(deps, userId, s.gymId, popular, { requestKey: randomUUID(), joinWaitlist: true }, yes)));
    const ok = answers.filter((a) => a.status === "fulfilled").length;
    const [tally] = await sql<{ booked: number; waiting: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'booked')::int AS booked, count(*) FILTER (WHERE status = 'waitlisted')::int AS waiting
      FROM gym_class_bookings WHERE session_id = ${popular}`;
    outcome = `${String(tally?.booked ?? -1)} booked, ${String(tally?.waiting ?? -1)} waiting, ${String(crowd.length - ok)} told it is full`;
  });
  delay.disable();
  state.probing = false;
  await probe;
  burstWalls.push(t.wall);
  burstJs.push(t.js);
  waits.push(worstWait);
  stalls.push(delay.max / 1e6);
}
console.log(`the burst, ${String(BURST)} people on one class of 30: ${outcome}`);
console.log(`  until the last person is answered: median ${fmt(median(burstWalls))} (worst ${fmt(Math.max(...burstWalls))})`);
console.log(`  server thread busy in all: median ${fmt(median(burstJs))} (worst ${fmt(Math.max(...burstJs))})`);
console.log(`  longest single stall of the thread: median ${fmt(median(stalls))} (worst ${fmt(Math.max(...stalls))})`);
console.log(`  longest another request waited for a database connection: median ${fmt(median(waits))} (worst ${fmt(Math.max(...waits))})`);

if (process.argv.includes("--keep")) console.log(`kept: gym ${s.gymId}, the class with the stuck waitlist ${stuck}`);
else await cleanup();
await sql.end({ timeout: 5 });
