// What personal training costs at full size (ROADMAP 17e-i; CLAUDE.md §4 "Cost at full
// size"). One gym of 2,100 people on its list (--people= for another size), each with a
// pack that includes personal training, and 30 staff. One trainer works 06:00 to 22:00
// every day in half-hour sessions: 32 a day, 224 a week, the most a week can hold. The gym
// also runs 20 classes a day that week, coached in turn by its staff, after those hours.
// Measured: that trainer's week with every time free and with every time booked, one
// booking, one cancel, the staff list, and 20 staff booking at the same instant. And a
// trainer's time off (17e-iii-b): every trainer holding 50, the most one may; the week and
// a booking read with them there; one added over a week of 224 booked sessions, asked and
// then confirmed.
// The numbers that matter are how long the server's one thread answers nobody, and how
// long the gym's own row is held (its other writes wait that long; no other gym's do).
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-pt-cost.ts [--people=200]
//
// LOCAL DATABASES ONLY: it writes a gym, its people and their sessions, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { addDays } from "@app/shared";
import { PtTimeOffAsk, addTimeOff, book, cancel, getPeople, getTrainers, getWeek, saveTrainer } from "../src/modules/orgs/pt/service.js";
import { dayInTz } from "../src/modules/gamification/streak.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-pt-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const STAFF = 30;
const RUNS = 5;
const PLAN = "zz_pt_cost";
const PREFIX = "pt-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_trainers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

const TABLES = ["users", "gym_staff", "gym_member_list_entries", "gym_held_memberships", "gym_trainers", "gym_trainer_hours", "gym_trainer_time_off", "gym_pt_appointments", "gym_class_sessions"];
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
const [first, second] = staff;
if (first === undefined || second === undefined) throw new Error("no staff");
const owner: string = first;
const trainer: string = second;
await sql`INSERT INTO users ${sql(staff.map((id, i) => ({ id, email: `${PREFIX}s-${String(i)}-${id}@example.com`, display_name: `Staff${String(i)} Cost` })))}`;
const gymId = randomUUID();
await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
// Everybody an owner, so each may book for any trainer: the row lock is what is measured.
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
for (const id of staff.slice(1)) await saveTrainer(deps, owner, gymId, id, { offers: true, sessionMinutes: 30, hours: ALL_DAY }, yes);

const today = dayInTz(new Date(), "Europe/London");
/** A week that starts a week from now: every one of its 224 times is still to come. */
const WEEK_FROM = addDays(today, 7);
// 140 classes in that week, 20 a day at 22:30, each coached by one of the staff in turn:
// the week's read looks through them for the trainer's own.
const classType = randomUUID();
await sql`INSERT INTO gym_class_types (id, gym_id, name, minutes, places, colour) VALUES (${classType}, ${gymId}, 'Late Spin', 45, 20, 'blue')`;
await sql`
  INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, coach_user_id)
  SELECT ${gymId}, ${classType}, d::date, 1350, (d::date + make_interval(mins => 1350)) AT TIME ZONE 'Europe/London', 45, 20,
         (${staff}::uuid[])[1 + (n % ${STAFF})]
  FROM generate_series(${WEEK_FROM}::date, ${addDays(WEEK_FROM, 6)}::date, interval '1 day') AS d, generate_series(1, 20) AS n`;
const entryAt = (n: number): string => {
  const e = entries[n % entries.length];
  if (e === undefined) throw new Error("no person");
  return e.id;
};

/** Every time of the trainer's week booked, each for a different person. */
async function fillWeek(): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    WITH slots AS (
      SELECT d::date AS day, m AS minute, row_number() OVER (ORDER BY d, m) AS k
      FROM generate_series(${WEEK_FROM}::date, ${addDays(WEEK_FROM, 6)}::date, interval '1 day') AS d,
           generate_series(360, 1290, 30) AS m
    ), people AS (
      SELECT e.id, h.id AS held, row_number() OVER (ORDER BY e.id) AS k
      FROM gym_member_list_entries e JOIN gym_held_memberships h ON h.gym_id = e.gym_id AND h.entry_id = e.id
      WHERE e.gym_id = ${gymId}
    ), made AS (
      INSERT INTO gym_pt_appointments
        (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, pack_charged, request_key, booked_by)
      SELECT ${gymId}, ${trainer}, p.id, p.held, s.day, s.minute,
             (s.day + make_interval(mins => s.minute)) AT TIME ZONE 'Europe/London',
             (s.day + make_interval(mins => s.minute + 30)) AT TIME ZONE 'Europe/London', 30, 'booked', true, gen_random_uuid(), ${owner}
      FROM slots s JOIN people p ON p.k = s.k
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM made`;
  return rows[0]?.n ?? 0;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const delay = monitorEventLoopDelay({ resolution: 1 });

async function measure<T>(name: string, prepare: () => Promise<T>, run: (made: T) => Promise<unknown>): Promise<void> {
  const walls: number[] = [];
  const busy: number[] = [];
  const stalls: number[] = [];
  for (let i = 0; i < RUNS + 1; i++) {
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id = ${gymId}`;
    await sql`DELETE FROM gym_trainer_time_off WHERE gym_id = ${gymId}`;
    await sql`UPDATE gym_held_memberships SET status = 'active', classes_left = 300 WHERE gym_id = ${gymId}`;
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
    `${name.padEnd(62)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
  );
}

console.log(`one gym: ${String(PEOPLE)} people each with a pack, ${String(STAFF)} staff; cpu ${String(os.cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`);

const week = { trainer, from: WEEK_FROM };
await measure("a trainer's week, all 224 times free", () => Promise.resolve(), async () => {
  const w = await getWeek(deps, owner, gymId, week, yes);
  if (w?.days.reduce((n, d) => n + d.free.length, 0) !== 224) throw new Error("not 224 free times");
});
await measure("a trainer's week, all 224 times booked", fillWeek, async () => {
  const w = await getWeek(deps, owner, gymId, week, yes);
  if (w?.days.reduce((n, d) => n + d.appointments.length, 0) !== 224) throw new Error("not 224 sessions");
});
await measure(`the staff list: ${String(STAFF)} staff with their hours`, () => Promise.resolve(), async () => {
  const list = await getTrainers(deps, owner, gymId, yes);
  if (list?.trainers.length !== STAFF) throw new Error("not the whole staff");
});
await measure(`the picker: the first 30 of ${String(PEOPLE)} people, those with a pack first`, () => Promise.resolve(), async () => {
  const list = await getPeople(deps, owner, gymId, {}, yes);
  if (list?.people.length !== Math.min(30, PEOPLE) || !list.more) throw new Error("not a full page");
});
await measure("the picker: a typed part of a name", () => Promise.resolve(), async () => {
  const list = await getPeople(deps, owner, gymId, { query: "son1999 co" }, yes);
  if (list?.people.length !== 1) throw new Error("not the one person");
});
const request = (n: number, minute: number, trainerId = trainer) => ({ requestKey: randomUUID(), trainerId, entryId: entryAt(n), localDate: WEEK_FROM, startMinute: minute, minutes: 30 });
await measure("one booking, the pack charged", () => Promise.resolve(), async () => {
  const made = await book(deps, owner, gymId, request(0, 600), yes);
  if (made?.packCharged !== true) throw new Error("not booked");
});
await measure(
  "one cancel, the pack given its session back",
  async () => {
    const made = await book(deps, owner, gymId, request(0, 600), yes);
    if (made === null) throw new Error("not booked");
    return made.id;
  },
  async (id) => {
    const done = await cancel(deps, owner, gymId, id, { lateOk: false, giveBack: false }, yes);
    if (done?.status !== "cancelled") throw new Error("not cancelled");
  },
);
await measure("20 staff book 20 trainers at the same instant", () => Promise.resolve(), async () => {
  const made = await Promise.all(staff.slice(1, 21).map((id, n) => book(deps, owner, gymId, request(n, 600, id), yes)));
  if (made.some((m) => m === null)) throw new Error("not all booked");
});
await measure("20 staff ask for one trainer's one time at the same instant", () => Promise.resolve(), async () => {
  const answers = await Promise.allSettled(Array.from({ length: 20 }, (_, n) => book(deps, owner, gymId, request(n, 600), yes)));
  if (answers.filter((a) => a.status === "fulfilled").length !== 1) throw new Error("not exactly one booked");
});

// ── A TRAINER'S TIME OFF ──

/** Every trainer holds 50 times off, a day each, from 100 days on: none touches the week. */
async function fiftyEach(): Promise<void> {
  await sql`
    INSERT INTO gym_trainer_time_off (gym_id, user_id, from_date, to_date, starts_at, ends_at, request_key, created_by)
    SELECT ${gymId}, t.user_id, d::date, d::date, d::date::timestamp AT TIME ZONE 'Europe/London', (d::date + 1)::timestamp AT TIME ZONE 'Europe/London',
           gen_random_uuid(), ${owner}
    FROM gym_trainers t, generate_series(${addDays(today, 100)}::date, ${addDays(today, 149)}::date, interval '1 day') AS d
    WHERE t.gym_id = ${gymId}`;
}
const weekOff = (confirm?: string) => ({
  requestKey: randomUUID(),
  fromDate: WEEK_FROM,
  toDate: addDays(WEEK_FROM, 6),
  fromMinute: null,
  toMinute: null,
  ...(confirm === undefined ? {} : { confirm }),
});
/** The mark the server asks for, read from its own answer. */
async function askedMark(): Promise<string> {
  try {
    await addTimeOff(deps, owner, gymId, trainer, weekOff(), yes);
  } catch (err) {
    if (err instanceof PtTimeOffAsk) {
      if (err.over.sessions.count !== 224 || err.over.classes.count !== 7) throw new Error("not 224 sessions and 7 classes");
      return err.over.mark;
    }
    throw err;
  }
  throw new Error("a time off over a booked week did not ask");
}

await measure(`the staff list: ${String(STAFF)} staff, each trainer with 50 times off`, fiftyEach, async () => {
  const list = await getTrainers(deps, owner, gymId, yes);
  if (list?.trainers.filter((t) => t.timeOff.length === 50).length !== STAFF - 1) throw new Error("not 50 each");
});
await measure("a trainer's week, all 224 booked, 50 times off held", async () => { await fiftyEach(); await fillWeek(); }, async () => {
  const w = await getWeek(deps, owner, gymId, week, yes);
  if (w?.days.reduce((n, d) => n + d.appointments.length, 0) !== 224) throw new Error("not 224 sessions");
});
await measure("one booking, 50 times off held", fiftyEach, async () => {
  const made = await book(deps, owner, gymId, request(0, 600), yes);
  if (made?.packCharged !== true) throw new Error("not booked");
});
await measure("time off over a week of 224 sessions and 7 classes: asked, nothing written", fillWeek, async () => {
  await askedMark();
});
await measure("the same, confirmed and added", async () => { await fillWeek(); return await askedMark(); }, async (mark) => {
  const list = await addTimeOff(deps, owner, gymId, trainer, weekOff(mark), yes);
  if (list?.trainers.find((t) => t.userId === trainer)?.timeOff.length !== 1) throw new Error("not added");
});
await measure("one time off with nothing in it", () => Promise.resolve(), async () => {
  const list = await addTimeOff(deps, owner, gymId, trainer, { ...weekOff(), fromDate: addDays(today, 200), toDate: addDays(today, 213) }, yes);
  if (list?.trainers.find((t) => t.userId === trainer)?.timeOff.length !== 1) throw new Error("not added");
});
// A morning off on the week's first day: no class of theirs is in it, so it is added unasked.
const morningOff = () => ({ requestKey: randomUUID(), fromDate: WEEK_FROM, toDate: WEEK_FROM, fromMinute: 540, toMinute: 720 });
await measure("a booking refused by time off", async () => { await addTimeOff(deps, owner, gymId, trainer, morningOff(), yes); }, async () => {
  const answer = await book(deps, owner, gymId, request(0, 600), yes).then(() => "booked", (err: unknown) => (err instanceof Error ? err.message : "?"));
  if (answer !== "This trainer has time off at that time.") throw new Error(`not refused: ${answer}`);
});

await cleanup();
await sql.end();
