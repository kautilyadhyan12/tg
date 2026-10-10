// What ending bookings costs at full size (ROADMAP 17c-ii-a; CLAUDE.md §4 "Cost at full
// size"; spec Part 3 §13.7). One gym of 2,100 members (--people= for another size), each
// on its list with a class pack. Measured, for each thing staff will do: cancelling a
// class of 500 with 100 waiting (the ask, then the cancel), a page of its "See all",
// making a class bigger so 100 waiting people move in, archiving a class with 200 coming
// classes of 20 bookings each, and 200 members removed at once who each hold a place.
// The numbers that matter are how long the server's one thread answers nobody, and how
// long the gym's own row is held (its other writes wait that long; no other gym's do).
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-booking-changes-cost.ts [--people=200] [--no-flush]
//
// LOCAL DATABASES ONLY: it writes a gym, its people and their bookings, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { endLeaversBookings } from "../src/modules/orgs/classes/bookingChanges.js";
import { getEndingBookings, setBookingSettings } from "../src/modules/orgs/classes/bookingsService.js";
import { archiveClassType, cancelClassSession, changeClassSession } from "../src/modules/orgs/classes/service.js";
import { lockOrgRow } from "../src/modules/orgs/repo.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-booking-changes-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
// --no-flush: commits do not wait for the disk, which shows the code's own share.
const noFlush = process.argv.includes("--no-flush");
const sql = postgres(url, { prepare: false, max: 10, ...(noFlush ? { connection: { synchronous_commit: "off" } } : {}) });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RUNS = 5;
const PLAN = "zz_booking_changes_cost";
const PREFIX = "booking-changes-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${gyms})`;
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

const TABLES = ["users", "gym_members", "gym_member_list_entries", "gym_class_sessions", "gym_class_bookings", "gym_held_memberships"];
/** A table filled seconds ago has no statistics, and a plan made without them is not the
 *  one a gym meets (`measure-bookings-cost.ts`). */
async function analyse(): Promise<void> {
  for (const table of TABLES) await sql`VACUUM ANALYZE ${sql(table)}`;
}

await cleanup();
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
const entries = people.map((id, i) => ({
  id: randomUUID(),
  gym_id: gymId,
  full_name: `Person${String(i)} Cost`,
  email: `${PREFIX}l-${String(i)}-${id}@example.com`,
  identity_key: createHash("sha256").update(id).digest("hex"),
  source: "typed",
}));
for (let i = 0; i < people.length; i += 1000) {
  await sql`INSERT INTO users ${sql(people.slice(i, i + 1000).map((id, k) => ({ id, email: `${PREFIX}${String(i + k)}-${id}@example.com`, display_name: `Person${String(i + k)} Cost` })))}`;
  await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
  await sql`INSERT INTO gym_members ${sql(people.slice(i, i + 1000).map((id, k) => ({ gym_id: gymId, user_id: id, joined_at: new Date("2026-01-01T00:00:00Z"), entry_id: entries[i + k]?.id ?? null })))}`;
}
await sql`
  INSERT INTO gym_held_memberships
    (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days, classes_left, starts_on, status, renews)
  SELECT ${gymId}, e.id, ${packType}, gen_random_uuid(), 'pack', 9000, 'GBP', 500, 365, 300, current_date - 10, 'active', false
  FROM gym_member_list_entries e WHERE e.gym_id = ${gymId}`;

/** A class type with `count` coming classes of `places`, the first of them 72 hours away
 *  and each `stepMinutes` after the one before (all inside the week booking is open for
 *  when the step is small). */
async function classType(count: number, places: number | null, stepMinutes = 60, firstMinutes = 4320): Promise<{ typeId: string; sessions: string[] }> {
  const typeId = randomUUID();
  await sql`INSERT INTO gym_class_types (id, gym_id, name, minutes, places, colour) VALUES (${typeId}, ${gymId}, ${`Spin ${typeId.slice(0, 8)}`}, 45, ${places}, 'blue')`;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places)
    SELECT ${gymId}, ${typeId}, (now() + ((${firstMinutes}::int + n * ${stepMinutes}::int) || ' minutes')::interval)::date, n % 1440,
           now() + ((${firstMinutes}::int + n * ${stepMinutes}::int) || ' minutes')::interval, 45, ${places}
    FROM generate_series(0, ${count - 1}) AS n
    RETURNING id`;
  return { typeId, sessions: rows.map((r) => r.id) };
}
/** People `from` to `from + booked` hold a place in the class, each charged to their
 *  pack; the next `waiting` wait. */
async function fill(sessionId: string, from: number, booked: number, waiting: number): Promise<void> {
  const inClass = people.slice(from, from + booked);
  const inLine = people.slice(from + booked, from + booked + waiting);
  if (inClass.length > 0) {
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
      SELECT ${gymId}, ${sessionId}, m.user_id, m.entry_id, h.id, 'booked', true, gen_random_uuid(), now()
      FROM gym_members m JOIN gym_held_memberships h ON h.gym_id = m.gym_id AND h.entry_id = m.entry_id
      WHERE m.gym_id = ${gymId} AND m.user_id = ANY(${inClass}::uuid[])`;
  }
  if (inLine.length > 0) {
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, status, request_key)
      SELECT ${gymId}, ${sessionId}, m.user_id, m.entry_id, 'waitlisted', gen_random_uuid()
      FROM gym_members m WHERE m.gym_id = ${gymId} AND m.user_id = ANY(${inLine}::uuid[])
      ORDER BY m.user_id`;
  }
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const deps = { sql, now: () => new Date() };
const delay = monitorEventLoopDelay({ resolution: 1 });

/** `prepare` builds what one run needs and is not timed; `run` is. */
async function measure<T>(name: string, prepare: () => Promise<T>, run: (made: T) => Promise<unknown>): Promise<void> {
  const walls: number[] = [];
  const busy: number[] = [];
  const stalls: number[] = [];
  for (let i = 0; i < RUNS + 1; i++) {
    // Each run starts from a gym with no class and no booking, so it measures only its own.
    await sql`DELETE FROM gym_class_bookings WHERE gym_id = ${gymId}`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id = ${gymId}`;
    await sql`UPDATE gym_members SET removed_at = NULL WHERE gym_id = ${gymId}`;
    const made = await prepare();
    await analyse();
    delay.reset();
    delay.enable();
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    await run(made);
    const wall = performance.now() - start;
    delay.disable();
    // The first run warms the connections and is not counted.
    if (i === 0) continue;
    walls.push(wall);
    busy.push(performance.eventLoopUtilization(before).active);
    stalls.push(delay.max / 1e6);
  }
  console.log(
    `${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
  );
}

const BOOKED = Math.min(500, Math.floor(PEOPLE / 4));
const WAITING = Math.min(100, Math.floor(PEOPLE / 20));
const bigClass = async (): Promise<string> => {
  const { sessions } = await classType(1, BOOKED);
  const id = sessions[0];
  if (id === undefined) throw new Error("no class");
  await fill(id, 0, BOOKED, WAITING);
  return id;
};

console.log(noFlush ? "commits do NOT wait for the disk (--no-flush)" : "commits wait for the disk, as in production");
console.log(`one gym: ${String(PEOPLE)} members, each with a pack; cpu ${String(os.cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`);

await measure(`the ask: cancel a class of ${String(BOOKED)} with ${String(WAITING)} waiting`, bigClass, async (id) => {
  const answer = await cancelClassSession(deps, owner, gymId, id, null);
  if (answer.kind !== "bookings") throw new Error("it did not ask");
});
await measure(`the cancel itself: ${String(BOOKED + WAITING)} bookings ended, ${String(BOOKED)} packs given back`, bigClass, async (id) => {
  const ask = await cancelClassSession(deps, owner, gymId, id, null);
  if (ask.kind !== "bookings") throw new Error("it did not ask");
  const answer = await cancelClassSession(deps, owner, gymId, id, ask.ending.mark);
  if (answer.kind !== "ok") throw new Error("it was not cancelled");
});
await measure("See all: one page of 100 names", bigClass, async (id) => {
  const list = await getEndingBookings(deps, owner, gymId, { by: "session", id }, () => Promise.resolve(true));
  if (list?.people.length !== Math.min(100, BOOKED + WAITING)) throw new Error("not a page");
});
await measure(
  `a class of 1 made bigger: ${String(WAITING)} waiting people moved in, each pack charged`,
  async () => {
    const { sessions } = await classType(1, 1);
    const id = sessions[0];
    if (id === undefined) throw new Error("no class");
    await fill(id, 0, 1, WAITING);
    const [row] = await sql<{ minute: number }[]>`SELECT local_start_minute AS minute FROM gym_class_sessions WHERE id = ${id}`;
    return { id, minute: row?.minute ?? 600 };
  },
  async ({ id, minute }) => {
    await changeClassSession(deps, owner, gymId, id, { scope: "this", startMinute: minute, minutes: 45, places: null, coachUserId: null });
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE session_id = ${id} AND status = 'booked'`;
    if (row?.n !== WAITING + 1) throw new Error(`moved ${String(row?.n)} in`);
  },
);
const PER_CLASS = Math.max(1, Math.min(20, Math.floor(PEOPLE / 105)));
await measure(
  `archive a class: 200 coming classes, ${String(200 * PER_CLASS)} bookings ended and removed`,
  async () => {
    const { typeId, sessions } = await classType(200, 30);
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
      SELECT ${gymId}, s.id, m.user_id, m.entry_id, h.id, 'booked', true, gen_random_uuid(), now()
      FROM (SELECT id, row_number() OVER (ORDER BY starts_at) AS k FROM gym_class_sessions WHERE id = ANY(${sessions}::uuid[])) s
      JOIN (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) AS r FROM gym_members WHERE gym_id = ${gymId}) m
        ON (m.r + s.k) % ${Math.max(1, Math.floor(PEOPLE / PER_CLASS))} = 0
      JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.entry_id = m.entry_id`;
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE session_id = ANY(${sessions}::uuid[])`;
    return { typeId, bookings: row?.n ?? 0 };
  },
  async ({ typeId, bookings }) => {
    const ask = await archiveClassType(deps, owner, gymId, typeId, null);
    if (bookings === 0 || ask.kind !== "bookings") throw new Error("it did not ask");
    const answer = await archiveClassType(deps, owner, gymId, typeId, ask.ending.mark);
    if (answer.kind !== "ok") throw new Error("it was not archived");
  },
);
const LEAVERS = Math.min(200, Math.floor(PEOPLE / 10));
await measure(
  `${String(LEAVERS)} members removed at once, each holding the one place of a class with 1 waiting`,
  async () => {
    const { sessions } = await classType(LEAVERS, 1, 10);
    for (const [i, id] of sessions.entries()) await fill(id, i, 1, 0);
    // One person waits for each of those classes: the next person along.
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, status, request_key)
      SELECT ${gymId}, b.session_id, w.user_id, w.entry_id, 'waitlisted', gen_random_uuid()
      FROM (SELECT session_id, row_number() OVER (ORDER BY session_id) AS k FROM gym_class_bookings WHERE session_id = ANY(${sessions}::uuid[])) b
      JOIN (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) AS r FROM gym_members
            WHERE gym_id = ${gymId} AND NOT (user_id = ANY(${people.slice(0, LEAVERS)}::uuid[]))) w ON w.r = b.k`;
    return sessions;
  },
  async (sessions) => {
    await sql.begin(async (tx) => {
      await lockOrgRow(tx, gymId);
      await endLeaversBookings(tx, gymId, people.slice(0, LEAVERS), new Date());
    });
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE session_id = ANY(${sessions}::uuid[]) AND status = 'booked'`;
    if (row?.n !== LEAVERS) throw new Error(`${String(row?.n)} places handed over`);
  },
);

// The most an import can close in one go: everybody but a hundred, each holding a place in
// one of 200 classes, half of those classes with one person waiting.
const MANY = Math.max(1, PEOPLE - 100);
await measure(
  `${String(MANY)} members removed at once (an import), a place each in 200 classes, 100 of them with 1 waiting`,
  async () => {
    const { sessions } = await classType(200, null, 10);
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
      SELECT ${gymId}, s.id, m.user_id, m.entry_id, h.id, 'booked', true, gen_random_uuid(), now()
      FROM (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) AS r FROM gym_members
            WHERE gym_id = ${gymId} AND user_id = ANY(${people.slice(0, MANY)}::uuid[])) m
      JOIN (SELECT id, row_number() OVER (ORDER BY starts_at) AS k FROM gym_class_sessions WHERE id = ANY(${sessions}::uuid[])) s ON s.k = (m.r % 200) + 1
      JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.entry_id = m.entry_id`;
    // Half the classes are full at what they hold now, with one of the hundred who stay waiting.
    await sql`
      UPDATE gym_class_sessions s SET places = (SELECT count(*) FROM gym_class_bookings b WHERE b.session_id = s.id)
      WHERE s.id = ANY(${sessions.slice(0, 100)}::uuid[])`;
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, status, request_key)
      SELECT ${gymId}, s.id, w.user_id, w.entry_id, 'waitlisted', gen_random_uuid()
      FROM (SELECT id, row_number() OVER (ORDER BY id) AS k FROM gym_class_sessions WHERE id = ANY(${sessions.slice(0, 100)}::uuid[])) s
      JOIN (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) AS r FROM gym_members
            WHERE gym_id = ${gymId} AND user_id = ANY(${people.slice(MANY)}::uuid[])) w ON w.r = s.k`;
    return sessions;
  },
  async (sessions) => {
    await sql.begin(async (tx) => {
      await lockOrgRow(tx, gymId);
      await endLeaversBookings(tx, gymId, people.slice(0, MANY), new Date());
    });
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE session_id = ANY(${sessions}::uuid[]) AND status = 'booked'`;
    if (row?.n !== Math.min(100, PEOPLE - MANY)) throw new Error(`${String(row?.n)} places handed over`);
  },
);
// Settings saved with a shorter waitlist time: every coming class with a waitlist is read,
// and here each of 200 has a free place its one waiting person is given.
await measure(
  "settings saved, a shorter waitlist time: 200 classes each hand 1 free place to 1 waiting person",
  async () => {
    await sql`UPDATE gyms SET waitlist_handover_minutes = 1440 WHERE id = ${gymId}`;
    // All inside the next day, so the places wait for a claim until the time is cut.
    const { sessions } = await classType(200, 1, 5, 180);
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, status, request_key)
      SELECT ${gymId}, s.id, w.user_id, w.entry_id, 'waitlisted', gen_random_uuid()
      FROM (SELECT id, row_number() OVER (ORDER BY id) AS k FROM gym_class_sessions WHERE id = ANY(${sessions}::uuid[])) s
      JOIN (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) AS r FROM gym_members WHERE gym_id = ${gymId}) w ON w.r = s.k`;
    return sessions;
  },
  async () => {
    const saved = await setBookingSettings(deps, owner, gymId, { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 60, waitlistMax: 20, pt: { opensDays: 7, freeCancelMinutes: 120 } }, () => Promise.resolve(true));
    if (saved?.movedIn !== Math.min(200, PEOPLE)) throw new Error(`${String(saved?.movedIn)} moved in`);
  },
);

await cleanup();
await sql.end({ timeout: 5 });
