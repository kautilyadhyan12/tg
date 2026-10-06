// What asking before a class goes over a trainer's sessions costs at full size (ROADMAP
// 17e-iii-a; CLAUDE.md §4 "Cost at full size"). One gym of 2,100 people on its list
// (--people= for another size), each with a pack that includes personal training, and 30
// staff. One trainer works 06:00 to 22:00 every day in half-hour sessions and every one of
// them is booked for the next 54 days: 1,728 sessions, the most one trainer can hold. The
// gym's calendar already holds 20 classes a day for those days, coached by its staff in turn.
// Measured: a new time slot every day of the week saved with no coach (what a save cost
// before this job), with a coach who has no sessions, and with that trainer as coach, asked
// and then confirmed; and a bulk edit that gives twelve time slots to that trainer.
// The numbers that matter are how long the server's one thread answers nobody, and how
// long the gym's own row is held (its other writes wait that long; no other gym's do).
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-class-ask-cost.ts [--people=200]
//
// LOCAL DATABASES ONLY: it writes a gym, its people, classes and sessions, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { addDays } from "@app/shared";
import { bulkEditSchedules, createClassType, createSchedule } from "../src/modules/orgs/classes/service.js";
import { saveTrainer } from "../src/modules/orgs/pt/service.js";
import { dayInTz } from "../src/modules/gamification/streak.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-class-ask-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const STAFF = 30;
const RUNS = 5;
const DAYS = 54;
const PLAN = "zz_class_ask_cost";
const PREFIX = "class-ask-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_trainers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

const TABLES = ["users", "gym_staff", "gym_member_list_entries", "gym_held_memberships", "gym_pt_appointments", "gym_class_sessions", "gym_class_schedules"];
/** A table filled seconds ago has no statistics, and a plan made without them is not the
 *  one a gym meets (`measure-bookings-cost.ts`). */
async function analyse(): Promise<void> {
  for (const table of TABLES) await sql`VACUUM ANALYZE ${sql(table)}`;
}

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const staff = Array.from({ length: STAFF }, () => randomUUID());
const [first, second, third] = staff;
if (first === undefined || second === undefined || third === undefined) throw new Error("no staff");
const owner: string = first;
const trainer: string = second;
/** On the staff, with no session booked. */
const idle: string = third;
await sql`INSERT INTO users ${sql(staff.map((id, i) => ({ id, email: `${PREFIX}s-${String(i)}-${id}@example.com`, display_name: `Staff${String(i)} Cost` })))}`;
const gymId = randomUUID();
await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
await sql`INSERT INTO gym_staff ${sql(staff.map((id) => ({ gym_id: gymId, user_id: id, role: "owner" })))}`;
await sql`
  INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
  VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
const packType = randomUUID();
await sql`
  INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, pack_classes, pack_days, access, includes_pt)
  VALUES (${packType}, ${gymId}, 'PT 500', 'pack', 9000, 'GBP', 500, 365, 'all_classes', true)`;
const entries = Array.from({ length: PEOPLE }, (_, i) => {
  const id = randomUUID();
  return { id, gym_id: gymId, full_name: `Person${String(i)} Cost`, email: `${PREFIX}l-${String(i)}-${id}@example.com`, identity_key: createHash("sha256").update(id).digest("hex"), source: "typed" };
});
for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
await sql`
  INSERT INTO gym_held_memberships
    (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days, classes_left, starts_on, status, renews)
  SELECT ${gymId}, e.id, ${packType}, gen_random_uuid(), 'pack', 9000, 'GBP', 500, 365, 300, current_date - 10, 'active', false
  FROM gym_member_list_entries e WHERE e.gym_id = ${gymId}`;

const deps = { sql, now: () => new Date() };
const yes = () => Promise.resolve(true);
const ALL_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 360, toMinute: 1320 }));
await saveTrainer(deps, owner, gymId, trainer, { offers: true, sessionMinutes: 30, hours: ALL_DAY }, yes);

const today = dayInTz(new Date(), "Europe/London");
const FROM = addDays(today, 1);
const TO = addDays(today, DAYS);
// Every time of the trainer's next 54 days booked, the people taken in turn.
const [booked] = await sql<{ n: number }[]>`
  WITH slots AS (
    SELECT d::date AS day, m AS minute, row_number() OVER (ORDER BY d, m) AS k
    FROM generate_series(${FROM}::date, ${TO}::date, interval '1 day') AS d, generate_series(360, 1290, 30) AS m
  ), people AS (
    SELECT e.id, h.id AS held, row_number() OVER (ORDER BY e.id) AS k, count(*) OVER () AS total
    FROM gym_member_list_entries e JOIN gym_held_memberships h ON h.gym_id = e.gym_id AND h.entry_id = e.id
    WHERE e.gym_id = ${gymId}
  ), made AS (
    INSERT INTO gym_pt_appointments
      (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, pack_charged, request_key, booked_by)
    SELECT ${gymId}, ${trainer}, p.id, p.held, s.day, s.minute,
           (s.day + make_interval(mins => s.minute)) AT TIME ZONE 'Europe/London',
           (s.day + make_interval(mins => s.minute + 30)) AT TIME ZONE 'Europe/London', 30, 'booked', true, gen_random_uuid(), ${owner}
    FROM slots s JOIN people p ON p.k = 1 + ((s.k - 1) % p.total)
    RETURNING 1
  )
  SELECT count(*)::int AS n FROM made`;
const SESSIONS = booked?.n ?? 0;

// The calendar the gym already has: 20 classes a day at 22:30, coached by its staff in turn.
const lateType = randomUUID();
await sql`INSERT INTO gym_class_types (id, gym_id, name, minutes, places, colour) VALUES (${lateType}, ${gymId}, 'Late Spin', 45, 20, 'blue')`;
await sql`
  INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, coach_user_id)
  SELECT ${gymId}, ${lateType}, d::date, 1350, (d::date + make_interval(mins => 1350)) AT TIME ZONE 'Europe/London', 45, 20,
         (${staff}::uuid[])[1 + (n % ${STAFF})]
  FROM generate_series(${FROM}::date, ${TO}::date, interval '1 day') AS d, generate_series(1, 20) AS n`;

/** A class of its own for each run, the last run's taken away first: each run is the one
 *  change made to the gym as it stood. */
async function newClass(): Promise<string> {
  await sql`DELETE FROM gym_class_types WHERE gym_id = ${gymId} AND name LIKE 'Cost class %'`;
  const name = `Cost class ${randomUUID().slice(0, 8)}`;
  const made = await createClassType(deps, owner, gymId, { name, minutes: 60, places: 20, colour: "blue" });
  const id = made.entries.find((e) => e.type.name === name)?.type.id;
  if (id === undefined) throw new Error("no class");
  return id;
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
/** A time slot every day from 08:00 to 18:00: over twenty of the trainer's sessions a day. */
const slotOf = (coachUserId: string | null, startMinute = 480, minutes = 600, confirm?: number) => ({
  weekdays: EVERY_DAY,
  startMinute,
  startsOn: today,
  minutes,
  places: 20,
  coachUserId,
  ...(confirm === undefined ? {} : { confirmTrainerSessions: confirm }),
});

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const delay = monitorEventLoopDelay({ resolution: 1 });

async function measure<T>(name: string, prepare: () => Promise<T>, run: (made: T) => Promise<unknown>): Promise<void> {
  const walls: number[] = [];
  const busy: number[] = [];
  const stalls: number[] = [];
  for (let i = 0; i < RUNS + 1; i++) {
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
    `${name.padEnd(66)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
  );
}

console.log(
  `one gym: ${String(PEOPLE)} people, ${String(STAFF)} staff, one trainer with ${String(SESSIONS)} sessions booked over ${String(DAYS)} days; cpu ${String(os.cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`,
);

let under = 0;
await measure("a new time slot every day, no coach (as before this job)", newClass, async (type) => {
  const done = await createSchedule(deps, owner, gymId, type, slotOf(null));
  if (done.kind !== "ok") throw new Error("not saved");
});
await measure("the same, a coach with no session booked", newClass, async (type) => {
  const done = await createSchedule(deps, owner, gymId, type, slotOf(idle));
  if (done.kind !== "ok") throw new Error("not saved");
});
await measure("the same, the trainer as coach: asked, nothing written", newClass, async (type) => {
  const done = await createSchedule(deps, owner, gymId, type, slotOf(trainer));
  if (done.kind !== "sessions") throw new Error("not asked");
  under = done.sessions.count;
});
await measure("the same, confirmed: saved over the sessions", newClass, async (type) => {
  const done = await createSchedule(deps, owner, gymId, type, slotOf(trainer, 480, 600, under));
  if (done.kind !== "ok") throw new Error("not saved");
});
console.log(`  (that time slot runs over ${String(under)} of the trainer's sessions; the box is sent the first 100)`);

/** A class with twelve hour-long time slots a day, 08:00 to 19:00, nobody coaching. */
async function twelveSlots(): Promise<{ type: string; ids: string[] }> {
  const type = await newClass();
  let ids: string[] = [];
  for (let n = 0; n < 12; n++) {
    const done = await createSchedule(deps, owner, gymId, type, slotOf(null, 480 + n * 60, 60));
    if (done.kind !== "ok") throw new Error("not saved");
    ids = done.body.entries.find((e) => e.type.id === type)?.schedules.map((s) => s.id) ?? [];
  }
  return { type, ids };
}
let bulkUnder = 0;
await measure("bulk edit: twelve time slots given to a coach with no session", twelveSlots, async ({ type, ids }) => {
  const done = await bulkEditSchedules(deps, owner, gymId, type, { scheduleIds: ids, updateFrom: today, set: { coachUserId: idle } });
  if (done.kind !== "ok") throw new Error("not saved");
});
await measure("bulk edit: twelve time slots given to the trainer, asked", twelveSlots, async ({ type, ids }) => {
  const done = await bulkEditSchedules(deps, owner, gymId, type, { scheduleIds: ids, updateFrom: today, set: { coachUserId: trainer } });
  if (done.kind !== "sessions") throw new Error("not asked");
  bulkUnder = done.sessions.count;
});
await measure("bulk edit: the same, confirmed", twelveSlots, async ({ type, ids }) => {
  const done = await bulkEditSchedules(deps, owner, gymId, type, {
    scheduleIds: ids,
    updateFrom: today,
    set: { coachUserId: trainer },
    confirmTrainerSessions: bulkUnder,
  });
  if (done.kind !== "ok") throw new Error("not saved");
});

await cleanup();
await sql.end();
