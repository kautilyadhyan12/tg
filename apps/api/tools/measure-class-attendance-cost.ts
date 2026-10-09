// What check-in meeting bookings costs (ROADMAP 17f; CLAUDE.md §4 "Cost at full size").
// The launch shape: 20 gyms of 200 members, each gym with 60 classes a week for eight
// weeks back and eight ahead, twenty people booked on each. Measured, on one gym or all:
//
//   - a check-in by somebody with nothing booked near now (nearly every check-in)
//   - a check-in by somebody booked on a class that starts in half an hour
//   - 200 of those at one instant: a full class arriving together
//   - the run that marks ended classes when nothing is due (what it does every 5 minutes)
//   - that run when a class of 200 has just ended in every gym: 4,000 places decided
//   - that run after two days with no worker: every class of the last 48 hours
//   - staff marking one place, and the list of a class of 200
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-class-attendance-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { markCameAtCheckin, markEndedClasses } from "../src/modules/orgs/classes/attendance.js";
import { getSessionBookings, markBooking } from "../src/modules/orgs/classes/bookingsService.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-class-attendance-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const MEMBERS = 200;
const CLASSES_A_WEEK = 60;
const WEEKS_EACH_WAY = 8;
const BOOKED = 20;
const PREFIX = "class-att-cost-";
const PLAN = "zz_classatt_cost";
const MIN = 60_000;

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
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
  members: string[];
  /** A class of all 200 that starts in half an hour. */
  soon: string;
  /** A class of all 200 that ended twenty minutes ago; half of them checked in. */
  ended: string;
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
    INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gymId}, 'Spin', 45, NULL, 'blue', false) RETURNING id`;
  if (type === undefined) throw new Error("no class type");

  // Sixty classes a week, eight weeks back and eight ahead, at minutes that keep clear of
  // the two big classes; twenty people on each. Older than two days: already marked.
  const each = Math.floor((7 * 24 * 60) / CLASSES_A_WEEK);
  await sql`
    INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
    SELECT ${gymId}, ${type.id}, (s.at AT TIME ZONE 'UTC')::date,
           (EXTRACT(HOUR FROM s.at AT TIME ZONE 'UTC') * 60 + EXTRACT(MINUTE FROM s.at AT TIME ZONE 'UTC'))::int, s.at, 45, NULL, 'scheduled'
    FROM (SELECT ${new Date(t0)}::timestamptz + make_interval(mins => k * ${each}::int + 7) AS at
          FROM generate_series(${-CLASSES_A_WEEK * WEEKS_EACH_WAY}::int, ${CLASSES_A_WEEK * WEEKS_EACH_WAY - 1}::int) AS k
          WHERE k NOT BETWEEN -1 AND 1) s`;
  await sql`
    INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, pack_charged, created_at, booked_at)
    SELECT ${gymId}, s.id, m.user_id, m.entry_id, gen_random_uuid(),
           CASE WHEN s.starts_at < ${new Date(t0)}::timestamptz - interval '49 hours' THEN 'attended' ELSE 'booked' END, false, now(), now()
    FROM (SELECT id, starts_at, (row_number() OVER (ORDER BY starts_at))::int AS sn FROM gym_class_sessions WHERE gym_id = ${gymId}) s
    JOIN (SELECT user_id, entry_id, (row_number() OVER (ORDER BY user_id) - 1)::int AS rn FROM gym_members WHERE gym_id = ${gymId}) m
      ON (m.rn + s.sn * ${BOOKED}::int) % ${MEMBERS}::int < ${BOOKED}::int`;

  const big = async (startsAt: number): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gymId}, ${type.id}, (x.at AT TIME ZONE 'UTC')::date,
             (EXTRACT(HOUR FROM x.at AT TIME ZONE 'UTC') * 60 + EXTRACT(MINUTE FROM x.at AT TIME ZONE 'UTC'))::int, x.at, 45, NULL, 'scheduled'
      FROM (SELECT ${new Date(startsAt)}::timestamptz AS at) x
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, pack_charged, created_at, booked_at)
      SELECT ${gymId}, ${row.id}, user_id, entry_id, gen_random_uuid(), 'booked', false, now(), now() FROM gym_members WHERE gym_id = ${gymId}`;
    return row.id;
  };
  const soon = await big(t0 + 30 * MIN);
  const endedStart = t0 - 65 * MIN;
  const ended = await big(endedStart);
  // Half of the ended class checked in as it started; the other half did not.
  await sql`
    INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
    SELECT ${gymId}, m.user_id, m.entry_id, ${owner}, (${new Date(endedStart)}::timestamptz AT TIME ZONE 'UTC')::date, 'staff', 'hours_unset', 'hours_unset',
           ${new Date(endedStart)}
    FROM (SELECT user_id, entry_id, (row_number() OVER (ORDER BY user_id))::int AS rn FROM gym_members WHERE gym_id = ${gymId}) m
    WHERE m.rn % 2 = 0`;
  return { gymId, owner, members, soon, ended };
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
  const ids = gyms.map((g) => g.gymId);
  for (const table of ["gym_class_sessions", "gym_class_bookings", "gym_attendance", "gym_members", "gym_member_list_entries", "users"]) {
    await sql.unsafe(`ANALYZE ${table}`);
  }
  const count = async (what: ReturnType<typeof sql>): Promise<number> => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${what}`)[0]?.n ?? 0;
  const sessions = await count(sql`gym_class_sessions WHERE gym_id = ANY(${ids}::uuid[])`);
  const bookings = await count(sql`gym_class_bookings WHERE gym_id = ANY(${ids}::uuid[])`);
  /** Places still booked in classes that ended in the last two days: what a run after two days with no worker meets. */
  const backlog = await count(
    sql`gym_class_bookings b JOIN gym_class_sessions s ON s.id = b.session_id
        WHERE b.gym_id = ANY(${ids}::uuid[]) AND b.status = 'booked' AND s.starts_at + interval '60 minutes' <= ${new Date(t0)}::timestamptz`,
  );

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
      `  ${name.padEnd(64)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  };

  const cpu = os.cpus()[0];
  console.log(
    `measure-class-attendance-cost: ${String(GYMS)} gyms of ${String(MEMBERS)} members · ${String(sessions)} classes and ${String(bookings)} bookings in all · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz`,
  );

  const log = {
    warn: (obj: object): void => {
      console.error("  WARNED", JSON.stringify(obj));
    },
  };
  const { gymId, owner, members, soon, ended } = measured;
  const now = new Date(t0);
  const unmark = async (sessionIds: readonly string[]): Promise<void> => {
    await sql`UPDATE gym_class_bookings SET status = 'booked' WHERE session_id = ANY(${[...sessionIds]}::uuid[]) AND status IN ('attended','no_show')`;
  };
  /** Every place of the last two days booked again, in every gym. */
  const unmarkRecent = async (): Promise<void> => {
    await sql`
      UPDATE gym_class_bookings b SET status = 'booked'
      FROM gym_class_sessions s
      WHERE s.id = b.session_id AND b.gym_id = ANY(${ids}::uuid[]) AND b.status IN ('attended','no_show')
        AND s.starts_at > ${now}::timestamptz - interval '49 hours' AND s.starts_at <= ${now}::timestamptz`;
  };
  const someone = members[0];
  if (someone === undefined) throw new Error("no member");

  // ── A CHECK-IN ──
  // Nothing booked near now: a moment when no class of theirs is within a day.
  const quietNow = new Date(t0 + 70 * 24 * 60 * MIN);
  await measure("a check-in, nothing booked near now", 50, async () => {
    if ((await markCameAtCheckin(sql, gymId, someone, quietNow)) !== 0) throw new Error("a quiet check-in marked something");
  });
  await measure(
    "a check-in, booked on a class in half an hour",
    30,
    async () => {
      if ((await markCameAtCheckin(sql, gymId, someone, now)) < 1) throw new Error("the check-in marked nothing");
    },
    () => unmark([soon]),
  );
  await measure(
    `${String(MEMBERS)} check-ins at one instant, all booked on one class`,
    5,
    async () => {
      const marked = await Promise.all(members.map((id) => markCameAtCheckin(sql, gymId, id, now)));
      if (marked.some((n) => n < 1)) throw new Error("a check-in marked nothing");
    },
    async () => {
      await sql`UPDATE gym_class_bookings SET status = 'booked' WHERE gym_id = ${gymId} AND status = 'attended' AND session_id IN
                (SELECT id FROM gym_class_sessions WHERE gym_id = ${gymId} AND starts_at > ${now}::timestamptz - interval '49 hours')`;
    },
  );

  // ── THE RUN THAT MARKS ENDED CLASSES ──
  // Nothing due: every class that has ended is marked already.
  await markEndedClasses({ sql, log }, now, ids);
  await measure("the run, nothing due (every 5 minutes)", 20, async () => {
    const done = await markEndedClasses({ sql, log }, now, ids);
    if (done.attended + done.noShows !== 0) throw new Error("a quiet run marked something");
  });
  await unmark(gyms.map((g) => g.ended));
  await measure(
    `the run, a class of ${String(MEMBERS)} just ended in each of ${String(GYMS)} gyms`,
    5,
    async () => {
      const done = await markEndedClasses({ sql, log }, now, ids);
      if (done.attended !== (GYMS * MEMBERS) / 2 || done.noShows !== (GYMS * MEMBERS) / 2) {
        throw new Error(`the run marked ${String(done.attended)} came and ${String(done.noShows)} no-shows`);
      }
    },
    () => unmark(gyms.map((g) => g.ended)),
  );
  await unmarkRecent();
  await measure(
    `the run after two days with no worker (${String(backlog)} places)`,
    3,
    async () => {
      const done = await markEndedClasses({ sql, log }, now, ids);
      if (done.attended + done.noShows + done.left !== backlog) throw new Error(`the run met ${String(done.attended + done.noShows + done.left)} places`);
    },
    unmarkRecent,
  );
  await markEndedClasses({ sql, log }, now, ids);

  // ── STAFF ──
  const deps = { sql, now: () => now };
  const yes = (): Promise<boolean> => Promise.resolve(true);
  const list = await getSessionBookings(deps, owner, gymId, ended, yes);
  console.log(`  the list of a class of ${String(list?.booked.length ?? 0)}: ${String(JSON.stringify(list).length)} bytes`);
  await measure(`the list of a class of ${String(MEMBERS)} read`, 20, () => getSessionBookings(deps, owner, gymId, ended, yes));
  await measure("twenty of those lists read at once", 5, () => Promise.all(Array.from({ length: 20 }, () => getSessionBookings(deps, owner, gymId, ended, yes))));
  const one = list?.booked[0]?.bookingId;
  if (one === undefined) throw new Error("no booking");
  let to: "attended" | "no_show" = "attended";
  await measure("one place marked (came, then no-show, in turn), list answered", 20, async () => {
    to = to === "attended" ? "no_show" : "attended";
    const after = await markBooking(deps, owner, gymId, ended, one, { status: to }, yes);
    if (after?.booked.find((b) => b.bookingId === one)?.status !== to) throw new Error("the mark was not kept");
  });
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
