// What online classes and staff's Remove from class cost (ROADMAP 17g; CLAUDE.md §4 "Cost
// at full size"). The launch shape: 20 gyms of 200 members, each gym with 60 classes a
// week for eight weeks ahead, EVERY one online with a link, twenty people booked on each.
// Measured on one gym:
//
//   - a member's week of classes, with a class of 200 under way and one 20 minutes off
//   - 200 members reading their week at one instant (a class's link has just shown)
//   - staff take one person off a class of 200 with 20 waiting (the first in line moves in)
//   - a whole class of 200 taken off at one instant
//   - a time slot's link changed: every coming class of it stamped
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-class-online-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { createLine, getMemberClasses, removeBooking } from "../src/modules/orgs/classes/bookingsService.js";
import { fillClassSessions } from "../src/modules/orgs/classes/fill.js";
import { setSlotOnline } from "../src/modules/orgs/classes/onlineRepo.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-class-online-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const MEMBERS = 200;
const CLASSES_A_WEEK = 60;
const WEEKS_AHEAD = 8;
const BOOKED = 20;
const WAITING = 20;
const PREFIX = "class-onl-cost-";
const PLAN = "zz_classonl_cost";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const LINK = "https://us02web.zoom.us/j/81234567890?pwd=costcostcostcostcost";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Gym {
  gymId: string;
  owner: string;
  typeId: string;
  members: string[];
}

async function makeGym(n: number, t0: number): Promise<Gym> {
  const owner = randomUUID();
  const gymId = randomUUID();
  const members = Array.from({ length: MEMBERS }, () => randomUUID());
  const entries = members.map(() => randomUUID());
  await sql`INSERT INTO users ${sql([
    { id: owner, email: `${PREFIX}${owner}@example.com`, display_name: "Cost Owner" },
    ...members.map((id, i) => ({ id, email: `${PREFIX}m-${id}@example.com`, display_name: `Member${String(i)} Cost` })),
  ])}`;
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, ${`Cost Gym ${String(n)}`}, 'UTC', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff ${sql([{ gym_id: gymId, user_id: owner, role: "owner" }])}`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
  await sql`
    INSERT INTO gym_member_list_entries ${sql(
      entries.map((id, i) => ({
        id,
        gym_id: gymId,
        full_name: `Member${String(i)} Cost`,
        email: `${PREFIX}l-${id}@example.com`,
        identity_key: createHash("sha256").update(id).digest("hex"),
        source: "upload",
      })),
    )}`;
  await sql`INSERT INTO gym_members ${sql(members.map((id, i) => ({ gym_id: gymId, user_id: id, joined_at: new Date("2026-01-01T00:00:00Z"), entry_id: entries[i] ?? null })))}`;
  const [type] = await sql<{ id: string }[]>`
    INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gymId}, 'Online yoga', 45, NULL, 'blue', false) RETURNING id`;
  if (type === undefined) throw new Error("no class type");

  // Sixty online classes a week for eight weeks, from two hours on; twenty people on each.
  const each = Math.floor((7 * 24 * 60) / CLASSES_A_WEEK);
  await sql`
    INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status, online, online_link)
    SELECT ${gymId}, ${type.id}, (s.at AT TIME ZONE 'UTC')::date,
           (EXTRACT(HOUR FROM s.at AT TIME ZONE 'UTC') * 60 + EXTRACT(MINUTE FROM s.at AT TIME ZONE 'UTC'))::int, s.at, 45, NULL, 'scheduled', true, ${LINK}
    FROM (SELECT ${new Date(t0)}::timestamptz + make_interval(mins => k * ${each}::int + 127) AS at
          FROM generate_series(0, ${CLASSES_A_WEEK * WEEKS_AHEAD - 1}::int) AS k) s`;
  await sql`
    INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, pack_charged, created_at, booked_at)
    SELECT ${gymId}, s.id, m.user_id, m.entry_id, gen_random_uuid(), 'booked', false, now(), now()
    FROM (SELECT id, (row_number() OVER (ORDER BY starts_at))::int AS sn FROM gym_class_sessions WHERE gym_id = ${gymId}) s
    JOIN (SELECT user_id, entry_id, (row_number() OVER (ORDER BY user_id) - 1)::int AS rn FROM gym_members WHERE gym_id = ${gymId}) m
      ON (m.rn + s.sn * ${BOOKED}::int) % ${MEMBERS}::int < ${BOOKED}::int`;
  return { gymId, owner, typeId: type.id, members };
}

/** An online class of this gym that starts at `startsAt`, everybody booked, `places` its size. */
async function big(gym: Gym, startsAt: number, places: number | null): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status, online, online_link)
    SELECT ${gym.gymId}, ${gym.typeId}, (x.at AT TIME ZONE 'UTC')::date,
           (EXTRACT(HOUR FROM x.at AT TIME ZONE 'UTC') * 60 + EXTRACT(MINUTE FROM x.at AT TIME ZONE 'UTC'))::int, x.at, 45, ${places}, 'scheduled', true, ${LINK}
    FROM (SELECT ${new Date(startsAt)}::timestamptz AS at) x
    RETURNING id`;
  if (row === undefined) throw new Error("no class");
  await sql`
    INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, pack_charged, created_at, booked_at)
    SELECT ${gym.gymId}, ${row.id}, user_id, entry_id, gen_random_uuid(), 'booked', false, now(), now() FROM gym_members WHERE gym_id = ${gym.gymId}`;
  return row.id;
}

await cleanup();
// Whatever happens below, the gyms and their lists are removed.
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (code) DO UPDATE SET active = true`;
  const t0 = Date.now();
  const gyms: Gym[] = [];
  for (let n = 0; n < GYMS; n++) gyms.push(await makeGym(n, t0));
  const measured = gyms[GYMS - 1];
  if (measured === undefined) throw new Error("no gym was made");
  const { gymId, owner, members } = measured;
  // In the measured gym: a class of 200 under way, one 20 minutes off, and two three days
  // off, each full, the first with twenty more people waiting.
  await big(measured, t0 - 10 * MIN, null);
  await big(measured, t0 + 20 * MIN, null);
  const full = await big(measured, t0 + 3 * DAY, MEMBERS);
  const whole = await big(measured, t0 + 3 * DAY + 60 * MIN, null);
  const waiters = Array.from({ length: WAITING }, () => randomUUID());
  await sql`INSERT INTO users ${sql(waiters.map((id, i) => ({ id, email: `${PREFIX}w-${id}@example.com`, display_name: `Waiting${String(i)} Cost` })))}`;
  await sql`INSERT INTO gym_members ${sql(waiters.map((id) => ({ gym_id: gymId, user_id: id, joined_at: new Date("2026-01-01T00:00:00Z"), entry_id: null })))}`;
  await sql`
    INSERT INTO gym_class_bookings (gym_id, session_id, user_id, request_key, status, pack_charged, created_at)
    SELECT ${gymId}, ${full}, u, gen_random_uuid(), 'waitlisted', false, now() FROM unnest(${waiters}::uuid[]) u`;
  // A time slot written by the real fill: every day at 10:00, online.
  const [slot] = await sql<{ id: string }[]>`
    INSERT INTO gym_class_schedules (gym_id, class_type_id, weekdays, local_start_minute, starts_on, minutes, online, online_link)
    VALUES (${gymId}, ${measured.typeId}, ARRAY[1,2,3,4,5,6,7], 600, (${new Date(t0)}::timestamptz AT TIME ZONE 'UTC')::date, 45, true, ${LINK})
    RETURNING id`;
  if (slot === undefined) throw new Error("no time slot");
  const filled = await fillClassSessions(sql, { gymIds: [gymId], scheduleIds: [slot.id], now: new Date(t0) });

  const ids = gyms.map((g) => g.gymId);
  for (const table of ["gym_class_sessions", "gym_class_bookings", "gym_members", "gym_member_list_entries", "users"]) {
    await sql.unsafe(`ANALYZE ${table}`);
  }
  const count = async (what: ReturnType<typeof sql>): Promise<number> => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${what}`)[0]?.n ?? 0;
  const sessions = await count(sql`gym_class_sessions WHERE gym_id = ANY(${ids}::uuid[])`);
  const bookings = await count(sql`gym_class_bookings WHERE gym_id = ANY(${ids}::uuid[])`);

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  const measure = async (name: string, runs: number, run: () => Promise<unknown>, after: () => Promise<void> = () => Promise.resolve()): Promise<void> => {
    const walls: number[] = [];
    const busy: number[] = [];
    const stalls: number[] = [];
    for (let i = 0; i < runs + 1; i++) {
      delay.reset();
      delay.enable();
      const before = performance.eventLoopUtilization();
      const start = performance.now();
      await run();
      const wall = performance.now() - start;
      delay.disable();
      const used = performance.eventLoopUtilization(before).active;
      const stall = delay.max / 1e6;
      await after();
      // The first run warms the connections and is not counted.
      if (i === 0) continue;
      walls.push(wall);
      busy.push(used);
      stalls.push(stall);
    }
    console.log(
      `  ${name.padEnd(66)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  };

  const cpu = os.cpus()[0];
  console.log(
    `measure-class-online-cost: ${String(GYMS)} gyms of ${String(MEMBERS)} members · ${String(sessions)} classes and ${String(bookings)} bookings in all, every class online · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz`,
  );

  const now = new Date(t0);
  const deps = { sql, now: () => now, inLine: createLine() };
  const yes = (): Promise<boolean> => Promise.resolve(true);
  const someone = members[0];
  if (someone === undefined) throw new Error("no member");

  // ── A MEMBER'S WEEK ──
  const week = await getMemberClasses(deps, someone, gymId, { week: 0 }, yes);
  const open = week?.classes.filter((c) => c.online?.state === "open").length ?? 0;
  console.log(`  a member's week: ${String(week?.classes.length ?? 0)} classes, ${String(open)} with their link showing, ${String(JSON.stringify(week).length)} bytes`);
  if (open !== 2) throw new Error("the member's two links were not both showing");
  await measure("a member's week of classes read", 20, () => getMemberClasses(deps, someone, gymId, { week: 0 }, yes));
  await measure(`${String(MEMBERS)} members read their week at one instant`, 5, () => Promise.all(members.map((id) => getMemberClasses(deps, id, gymId, { week: 0 }, yes))));

  // ── STAFF TAKE PEOPLE OFF A CLASS ──
  const placesOf = async (sessionId: string): Promise<string[]> =>
    (await sql<{ id: string }[]>`SELECT id FROM gym_class_bookings WHERE session_id = ${sessionId} AND status = 'booked' ORDER BY seq`).map((r) => r.id);
  const inFull = await placesOf(full);
  let next = 0;
  await measure(`one person taken off a full class of ${String(MEMBERS)}, the first of ${String(WAITING)} waiting moves in`, WAITING - 1, async () => {
    const id = inFull[next++];
    if (id === undefined) throw new Error("no place left to remove");
    const list = await removeBooking(deps, owner, gymId, full, id, yes);
    if (list?.booked.length !== MEMBERS) throw new Error(`the class holds ${String(list?.booked.length ?? 0)} after a removal`);
  });
  const waitingLeft = await count(sql`gym_class_bookings WHERE session_id = ${full} AND status = 'waitlisted'`);
  if (waitingLeft !== 0) throw new Error(`${String(waitingLeft)} still waiting after ${String(WAITING)} removals`);

  const inWhole = await placesOf(whole);
  await measure(
    `a whole class of ${String(MEMBERS)} taken off at one instant`,
    3,
    async () => {
      await Promise.all(inWhole.map((id) => removeBooking(deps, owner, gymId, whole, id, yes)));
      const left = await count(sql`gym_class_bookings WHERE session_id = ${whole} AND status = 'booked'`);
      if (left !== 0) throw new Error(`${String(left)} places left`);
    },
    async () => {
      await sql`UPDATE gym_class_bookings SET status = 'booked', cancelled_at = NULL WHERE session_id = ${whole}`;
    },
  );

  // ── A TIME SLOT'S LINK ──
  let turn = 0;
  await measure(`a time slot's link changed, its ${String(filled.sessions)} coming classes stamped`, 20, async () => {
    const done = await setSlotOnline(sql, { gymId, scheduleId: slot.id, online: true, onlineLink: `${LINK}${String(turn++)}`, actorUserId: owner, now });
    if (done.kind !== "ok") throw new Error("the time slot was not found");
  });
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
