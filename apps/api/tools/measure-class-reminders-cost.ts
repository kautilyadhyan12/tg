// What the class reminder costs at full size (ROADMAP 20b-iii; CLAUDE.md §4 "Cost at full
// size"). One gym of 2,000 beside 19 gyms of 200. Each gym has a year of classes behind it
// and two weeks ahead, every class full, and personal training every day; everybody has 50
// reminders already sent. The big gym runs 20 classes of 20 a day, a small one 5 of 12.
//
// The sender runs four times an hour and reads, each time, every gym's bookings that start
// soon enough to be due (16 hours ahead with 2 hours' notice, 38 with 24). Three numbers matter: that read with nothing due; the same for the
// big gym alone; and the worst run, an hour when every class of the big gym's day falls due
// at once. Each as how long it takes and how long its one thread is busy.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-class-reminders-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their members, and removes them.
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { remindersForGym } from "../src/modules/orgs/messages/reminders.js";
import { sendDueMessages } from "../src/modules/orgs/messages/send.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-class-reminders-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const SMALL_GYMS = 19;
const SMALL = { people: 200, classes: 5, places: 12, trainers: 2 };
const BIG = { people: 2000, classes: 20, places: 20, trainers: 10 };
const RUNS = 20;
const PREFIX = "remind-cost-";
const PLAN = "zz_remind_cost";
const TODAY = "2031-06-10";
/** London, summer: 10:00, when nothing of the day's 17:00 to 20:00 classes is due with 2
 *  hours' notice; and 18:04, when the gym's number is 24 hours and all of tomorrow's are. */
const QUIET = new Date("2031-06-10T09:00:00Z");

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE plan_id IN (SELECT id FROM plans WHERE code = ${PLAN})`;
  await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_message_settings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_message_days WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_trainers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

await cleanup();
// Whatever happens below, the gyms and their members are removed.
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;

  const makeGym = async (shape: typeof BIG): Promise<string> => {
    const gymId = randomUUID();
    await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
    const rows = Array.from({ length: shape.people }, (_, i) => ({ id: randomUUID(), entry: randomUUID(), i }));
    await sql`INSERT INTO users ${sql(rows.map((p) => ({ id: p.id, email: `${PREFIX}m-${p.id}@example.com`, display_name: `Person${String(p.i)} Cost` })))}`;
    await sql`
      INSERT INTO gym_member_list_entries ${sql(
        rows.map((p) => ({ id: p.entry, gym_id: gymId, full_name: `Person${String(p.i)} Cost`, email: `${PREFIX}r-${p.id}@example.com`, identity_key: p.id.replace(/-/g, "").padEnd(64, "0"), source: "typed" })),
      )}`;
    await sql`INSERT INTO gym_members ${sql(rows.map((p) => ({ gym_id: gymId, user_id: p.id, entry_id: p.entry, joined_at: new Date(QUIET.getTime() - 400 * 86_400_000) })))}`;

    // The day's classes, on the hour from 17:00 to 20:00 by turns, a year back and two weeks on.
    const typeId = randomUUID();
    await sql`INSERT INTO gym_class_types (id, gym_id, name, minutes, places, colour) VALUES (${typeId}, ${gymId}, 'Evening Spin', 45, ${shape.places}, 'blue')`;
    await sql`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gymId}, ${typeId}, ${TODAY}::date + d, (17 + c % 4) * 60,
             ((${TODAY}::date + d) + make_interval(hours => 17 + c % 4)) AT TIME ZONE 'Europe/London', 45, ${shape.places}, 'scheduled'
      FROM generate_series(-365, 14) AS d CROSS JOIN generate_series(0, ${shape.classes - 1}) AS c`;
    // Every class full: its people taken in turn, booked two days before it.
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, status, request_key, created_at, booked_at)
      SELECT ${gymId}, s.id, m.user_id, m.entry_id, CASE WHEN s.starts_at < ${QUIET} THEN 'attended' ELSE 'booked' END, gen_random_uuid(),
             s.starts_at - interval '2 days', s.starts_at - interval '2 days'
      FROM (SELECT id, starts_at, row_number() OVER (ORDER BY starts_at, id) AS n FROM gym_class_sessions WHERE gym_id = ${gymId}) s
      CROSS JOIN generate_series(0, ${shape.places - 1}) AS p
      JOIN (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) - 1 AS n FROM gym_members WHERE gym_id = ${gymId}) m
        ON m.n = (s.n * ${shape.places} + p) % ${shape.people}`;
    // Personal training: each trainer's six sessions a day, 09:00 to 14:00.
    const trainers = Array.from({ length: shape.trainers }, () => randomUUID());
    await sql`INSERT INTO users ${sql(trainers.map((id) => ({ id, email: `${PREFIX}t-${id}@example.com`, display_name: "Sam Cost" })))}`;
    await sql`INSERT INTO gym_staff ${sql(trainers.map((id) => ({ gym_id: gymId, user_id: id, role: "trainer" })))}`;
    await sql`INSERT INTO gym_trainers ${sql(trainers.map((id) => ({ gym_id: gymId, user_id: id, offers: true, session_minutes: 60 })))}`;
    await sql`
      INSERT INTO gym_pt_appointments (gym_id, trainer_user_id, entry_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, request_key, created_at)
      SELECT ${gymId}, t.user_id, m.entry_id, ${TODAY}::date + d, (9 + h) * 60,
             ((${TODAY}::date + d) + make_interval(hours => 9 + h)) AT TIME ZONE 'Europe/London',
             ((${TODAY}::date + d) + make_interval(hours => 10 + h)) AT TIME ZONE 'Europe/London', 60,
             CASE WHEN d < 0 THEN 'attended' ELSE 'booked' END, gen_random_uuid(), ((${TODAY}::date + d) - 3) + interval '12 hours'
      FROM (SELECT user_id, row_number() OVER (ORDER BY user_id) - 1 AS n FROM gym_trainers WHERE gym_id = ${gymId}) t
      CROSS JOIN generate_series(-365, 14) AS d CROSS JOIN generate_series(0, 5) AS h
      JOIN (SELECT entry_id, row_number() OVER (ORDER BY user_id) - 1 AS n FROM gym_members WHERE gym_id = ${gymId}) m
        ON m.n = ((d + 365) * 60 + t.n * 6 + h) % ${shape.people}`;
    // Fifty reminders each, already sent over the year.
    await sql`
      INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
      SELECT ${gymId}, m.user_id, 'class_reminder', 'class:old-' || k, 'See you there.', ${TODAY}::date - (k * 7 + 2),
             ${QUIET}::timestamptz - (k * 7 + 2) * interval '1 day', ${QUIET}::timestamptz - (k * 7 - 28) * interval '1 day'
      FROM gym_members m CROSS JOIN generate_series(1, 50) AS k
      WHERE m.gym_id = ${gymId}`;
    return gymId;
  };

  const small: string[] = [];
  for (let g = 0; g < SMALL_GYMS; g++) small.push(await makeGym(SMALL));
  const big = await makeGym(BIG);
  const gymIds = [...small, big];
  for (const table of ["gym_members", "users", "gyms", "gym_member_list_entries", "gym_member_messages", "gym_class_sessions", "gym_class_bookings", "gym_pt_appointments"]) {
    await sql`ANALYZE ${sql(table)}`;
  }
  const counted = await sql<{ classes: number; bookings: number; sessions: number; messages: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_class_sessions WHERE gym_id = ANY(${gymIds}::uuid[])) AS classes,
           (SELECT count(*)::int FROM gym_class_bookings WHERE gym_id = ANY(${gymIds}::uuid[])) AS bookings,
           (SELECT count(*)::int FROM gym_pt_appointments WHERE gym_id = ANY(${gymIds}::uuid[])) AS sessions,
           (SELECT count(*)::int FROM gym_member_messages WHERE gym_id = ANY(${gymIds}::uuid[])) AS messages`;

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  /** One timed run: how long, how long the thread was busy, and its longest stall. */
  const once = async (run: () => Promise<unknown>): Promise<{ wall: number; busy: number; stall: number }> => {
    delay.reset();
    delay.enable();
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    await run();
    const wall = performance.now() - start;
    delay.disable();
    return { wall, busy: performance.eventLoopUtilization(before).active, stall: delay.max / 1e6 };
  };
  const line = (name: string, runs: { wall: number; busy: number; stall: number }[]): void => {
    console.log(
      `  ${name.padEnd(70)} total median ${fmt(median(runs.map((r) => r.wall)))} (worst ${fmt(Math.max(...runs.map((r) => r.wall)))}) · thread busy median ${fmt(median(runs.map((r) => r.busy)))} (worst ${fmt(Math.max(...runs.map((r) => r.busy)))}) · longest stall ${fmt(Math.max(...runs.map((r) => r.stall)))}`,
    );
  };
  const measure = async (name: string, run: () => Promise<unknown>, times: number = RUNS): Promise<void> => {
    const runs = [];
    // The first run warms the connections and is not counted.
    for (let i = 0; i < times + 1; i++) {
      const r = await once(run);
      if (i > 0) runs.push(r);
    }
    line(name, runs);
  };

  const cpu = os.cpus()[0];
  console.log(
    `measure-class-reminders-cost: ${String(SMALL_GYMS)} gyms of ${String(SMALL.people)} and one of ${String(BIG.people)} · ${String(counted[0]?.classes ?? 0)} classes · ${String(counted[0]?.bookings ?? 0)} bookings · ${String(counted[0]?.sessions ?? 0)} personal training sessions · ${String(counted[0]?.messages ?? 0)} reminders already sent · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`,
  );

  const log = { info: () => undefined, error: () => undefined };
  // The day's own read is made once and marked, so the runs below are the usual ones.
  const first = await sendDueMessages({ sql, log }, { now: QUIET, gymIds });
  console.log(`  the first run, at 10:00, sent ${String(first.sent)} (the 11:00 and 12:00 personal training sessions)`);
  const reminders = async (ids: readonly string[], now: Date): Promise<number> => {
    let due = 0;
    for (const id of ids) due += (await remindersForGym(sql, id, now)).length;
    return due;
  };
  const nothing = (ids: readonly string[]) => async (): Promise<void> => {
    if ((await reminders(ids, QUIET)) !== 0) throw new Error("a read with nothing due found something");
  };
  await measure("the reminders' read, four times an hour: all 20 gyms, nothing due", nothing(gymIds));
  await measure(`the same, one gym of ${String(SMALL.people)}`, nothing(small.slice(0, 1)));
  await measure(`the same, the gym of ${String(BIG.people)}`, nothing([big]));
  await measure("the whole usual run with it (the day's read done): all 20 gyms", async () => {
    const sent = await sendDueMessages({ sql, log }, { now: QUIET, gymIds });
    if (sent.sent !== 0) throw new Error("a run with nothing to send sent something");
  });

  // The worst run: the big gym reminds 24 hours before, and at 18:04 every class of
  // tomorrow evening falls due at once (17:00 and 18:00 already were; 19:00 and 20:00 are
  // brought forward from the night to 18:00).
  await sql`INSERT INTO gym_message_settings (gym_id, kind, is_on, hours) VALUES (${big}, 'class_reminder', true, 24)`;
  const evening = new Date("2031-06-10T17:04:00Z");
  const dueThen = await reminders([big], evening);
  const worst = await once(async () => {
    const sent = await sendDueMessages({ sql, log }, { now: evening, gymIds: [big] });
    if (sent.sent !== dueThen) throw new Error(`the worst run sent ${String(sent.sent)} of ${String(dueThen)}`);
  });
  line(`the worst run, the gym of ${String(BIG.people)}: ${String(dueThen)} reminders written at once`, [worst]);
  await measure("the run after it: the same bookings, all already reminded", async () => {
    const sent = await sendDueMessages({ sql, log }, { now: evening, gymIds: [big] });
    if (sent.sent !== 0) throw new Error("a second run sent something");
  });
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
