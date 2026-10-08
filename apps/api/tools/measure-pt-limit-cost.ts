// What a limit on personal training sessions costs (ROADMAP 17e-v; CLAUDE.md §4 "Cost at
// full size"). The launch shape: 20 gyms of 200 members, every member in the app holding a
// membership with the largest limit the app allows (200 a month), and 150 sessions already
// counted against it in the coming days: 30,000 counted sessions a gym. One gym is measured:
// ten trainers, each 06:00 to 22:00 every day in sessions of an hour, half of the coming
// week's times already booked.
//
//   - one member opens the tab (the count is read for seven days)
//   - all 200 members of the gym open it at the same moment
//   - staff open the list of people to book (30 people, each with their count)
//   - 100 staff open that list at the same moment
//   - one member books a time and cancels it (the count is read under the gym's lock)
//   - 80 members each press a different free time at the same moment
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-pt-limit-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { MEMBERSHIP_PT_LIMIT_MAX, PT_PEOPLE_SHOWN } from "@app/shared";
import { createLine } from "../src/modules/orgs/classes/bookingsService.js";
import { getMemberPt, memberBook, memberCancel, type MemberPtDeps } from "../src/modules/orgs/pt/memberService.js";
import { getPeople } from "../src/modules/orgs/pt/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-pt-limit-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const MEMBERS = 200;
const TRAINERS = 10;
const COUNTED = 150;
const RUNS = 20;
const PREFIX = "pt-limit-cost-";
const PLAN = "zz_ptl_cost";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_trainer_hours WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_trainers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Member {
  userId: string;
  entryId: string;
  heldId: string;
}

async function makeGym(n: number): Promise<{ gymId: string; owner: string; members: Member[]; trainers: string[] }> {
  const owner = randomUUID();
  const gymId = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, ${`Limit Gym ${String(n)}`}, 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;

  const members: Member[] = Array.from({ length: MEMBERS }, () => ({ userId: randomUUID(), entryId: randomUUID(), heldId: randomUUID() }));
  await sql`INSERT INTO users ${sql(members.map((m, i) => ({ id: m.userId, email: `${PREFIX}m-${m.userId}@example.com`, display_name: `Member${String(i)} Cost` })))}`;
  await sql`
    INSERT INTO gym_member_list_entries ${sql(
      members.map((m, i) => ({
        id: m.entryId,
        gym_id: gymId,
        full_name: `Member${String(i)} Cost`,
        email: `${PREFIX}l-${m.entryId}@example.com`,
        identity_key: createHash("sha256").update(m.entryId).digest("hex"),
        source: "upload",
      })),
    )}`;
  await sql`INSERT INTO gym_members ${sql(members.map((m) => ({ gym_id: gymId, user_id: m.userId, entry_id: m.entryId, joined_at: new Date("2026-01-01T00:00:00Z") })))}`;

  const [type] = await sql<{ id: string }[]>`
    INSERT INTO gym_membership_types
      (gym_id, name, kind, price_minor, currency, term_count, term_unit, access, covers_all_classes, includes_pt, pt_limit, pt_period)
    VALUES (${gymId}, 'Gold', 'recurring', 9900, 'GBP', 1, 'month', 'all_classes', true, true, ${MEMBERSHIP_PT_LIMIT_MAX}, 'month')
    RETURNING id`;
  if (type === undefined) throw new Error("no membership type");
  const startsOn = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  await sql`
    INSERT INTO gym_held_memberships ${sql(
      members.map((m) => ({
        id: m.heldId,
        gym_id: gymId,
        entry_id: m.entryId,
        membership_type_id: type.id,
        request_key: randomUUID(),
        kind: "recurring",
        price_minor: 9900,
        currency: "GBP",
        term_count: 1,
        term_unit: "month",
        starts_on: startsOn,
        status: "active",
        renews: true,
      })),
    )}`;

  const trainers = Array.from({ length: TRAINERS }, () => randomUUID());
  await sql`INSERT INTO users ${sql(trainers.map((id, i) => ({ id, email: `${PREFIX}t-${id}@example.com`, display_name: `Trainer${String(i)} Cost` })))}`;
  await sql`INSERT INTO gym_staff ${sql(trainers.map((id) => ({ gym_id: gymId, user_id: id, role: "trainer" })))}`;
  await sql`INSERT INTO gym_trainers ${sql(trainers.map((id) => ({ gym_id: gymId, user_id: id, offers: true, session_minutes: 60 })))}`;
  await sql`
    INSERT INTO gym_trainer_hours ${sql(
      trainers.flatMap((id) => [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ gym_id: gymId, user_id: id, weekday, from_minute: 360, to_minute: 1320 }))),
    )}`;
  // Half of every trainer's times on the coming eight days are somebody's already: the
  // even hours, each a different member's, booked on their membership.
  await sql`
    INSERT INTO gym_pt_appointments
      (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, pack_charged, request_key, booked_by, created_at)
    SELECT ${gymId}, t.id, e.id, h.id, d.day, s.minute,
           (d.day + make_interval(mins => s.minute)) AT TIME ZONE 'Europe/London',
           (d.day + make_interval(mins => s.minute + 60)) AT TIME ZONE 'Europe/London',
           60, 'booked', false, gen_random_uuid(), ${owner}, now()
    FROM unnest(${trainers}::uuid[]) WITH ORDINALITY AS t(id, tn)
    CROSS JOIN (SELECT (now() AT TIME ZONE 'Europe/London')::date + n AS day, n FROM generate_series(1, 8) AS n) d
    CROSS JOIN (SELECT m AS minute, m / 120 AS hn FROM generate_series(360, 1260, 120) AS m) s
    JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM gym_member_list_entries WHERE gym_id = ${gymId}) e
      ON e.rn = 1 + ((t.tn * 97 + d.n * 31 + s.hn * 7) % ${MEMBERS})
    JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.entry_id = e.id`;
  // And every member has 150 sessions counted against their limit in those same days:
  // late cancels, which a limit counts and which hold nobody's time.
  await sql`
    INSERT INTO gym_pt_appointments
      (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, pack_charged, request_key, booked_by, created_at, cancelled_at)
    SELECT ${gymId}, ${trainers[0] ?? owner}, h.entry_id, h.id, d.day, 0,
           (d.day + make_interval(mins => 0)) AT TIME ZONE 'Europe/London',
           (d.day + make_interval(mins => 60)) AT TIME ZONE 'Europe/London',
           60, 'late_cancelled', false, gen_random_uuid(), ${owner}, now(), now()
    FROM gym_held_memberships h
    CROSS JOIN generate_series(1, ${COUNTED}) AS k
    CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'Europe/London')::date + (k % 8) AS day) d
    WHERE h.gym_id = ${gymId}`;
  return { gymId, owner, members, trainers };
}

await cleanup();
// Whatever happens below, the gyms and their lists are removed.
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (code) DO UPDATE SET active = true`;
  let measured: Awaited<ReturnType<typeof makeGym>> | undefined;
  for (let n = 0; n < GYMS; n++) {
    const gym = await makeGym(n);
    if (n === GYMS - 1) measured = gym;
  }
  if (measured === undefined) throw new Error("no gym was made");
  const { gymId, owner, members, trainers } = measured;
  for (const table of ["gym_pt_appointments", "gym_member_list_entries", "gym_members", "gym_held_memberships", "gym_trainer_hours", "users"]) {
    await sql.unsafe(`ANALYZE ${table}`);
  }
  const [rows] = await sql<{ n: number; mine: number }[]>`
    SELECT count(*)::int AS n, count(*) FILTER (WHERE gym_id = ${gymId})::int AS mine FROM gym_pt_appointments WHERE gym_id IN (SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"})`;

  const deps: MemberPtDeps = { sql, now: () => new Date(), inLine: createLine() };
  const yes = (): Promise<boolean> => Promise.resolve(true);
  const member = (n: number): Member => {
    const m = members[n % members.length];
    if (m === undefined) throw new Error("no member");
    return m;
  };
  const read = async (m: Member) => {
    const view = await getMemberPt(deps, m.userId, gymId, { week: 0 }, yes);
    if (view === null || view.trainers.length !== TRAINERS) throw new Error("the read did not answer the gym's trainers");
    return view;
  };
  const people = async () => {
    const list = await getPeople(deps, owner, gymId, {}, yes);
    if (list === null || list.people.length !== PT_PEOPLE_SHOWN) throw new Error("the list of people was not a full page");
    return list;
  };

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  const measure = async (name: string, runs: number, run: (i: number) => Promise<unknown>): Promise<void> => {
    const walls: number[] = [];
    const busy: number[] = [];
    const stalls: number[] = [];
    for (let i = 0; i < runs + 1; i++) {
      delay.reset();
      delay.enable();
      const before = performance.eventLoopUtilization();
      const start = performance.now();
      await run(i);
      const wall = performance.now() - start;
      delay.disable();
      // The first run warms the connections and is not counted.
      if (i === 0) continue;
      walls.push(wall);
      busy.push(performance.eventLoopUtilization(before).active);
      stalls.push(delay.max / 1e6);
    }
    console.log(
      `  ${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  };

  const cpu = os.cpus()[0];
  console.log(
    `measure-pt-limit-cost: ${String(GYMS)} gyms of ${String(MEMBERS)} members, ${String(TRAINERS)} trainers each · ${String(rows?.n ?? 0)} sessions in all, ${String(rows?.mine ?? 0)} in the gym measured · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz`,
  );
  const first = await read(member(0));
  const tomorrowDay = first.days[1];
  if (tomorrowDay === undefined) throw new Error("no tomorrow");
  console.log(`  what the member's page says of tomorrow: ${JSON.stringify(tomorrowDay.limit)}`);
  if (tomorrowDay.limit === null || tomorrowDay.limit.left > MEMBERSHIP_PT_LIMIT_MAX - COUNTED) throw new Error("the count was not read");
  const page = await people();
  console.log(`  the list of people: ${String(page.people.length)} people, the first with ${JSON.stringify(page.people[0]?.limit)}`);

  await measure("one member opens the tab", RUNS, (i) => read(member(i)));
  await measure(`${String(MEMBERS)} members open it at the same moment`, 5, () => Promise.all(members.map((m) => read(m))));
  await measure("staff open the list of people to book", RUNS, () => people());
  await measure("100 staff open that list at the same moment", 5, () => Promise.all(Array.from({ length: 100 }, () => people())));

  const tomorrow = tomorrowDay.localDate;
  const ask = (trainerId: string, startMinute: number) => ({ requestKey: randomUUID(), trainerId, localDate: tomorrow, startMinute, minutes: 60 });
  const trainer = (n: number): string => {
    const t = trainers[n % trainers.length];
    if (t === undefined) throw new Error("no trainer");
    return t;
  };
  // Members with nothing booked tomorrow, so no press is refused as their own clash.
  const taken = await sql<{ entry_id: string }[]>`
    SELECT DISTINCT entry_id FROM gym_pt_appointments WHERE gym_id = ${gymId} AND local_date = ${tomorrow}::date AND status = 'booked'`;
  const busyEntries = new Set(taken.map((r) => r.entry_id));
  const idle = members.filter((m) => !busyEntries.has(m.entryId));
  const one = idle[0];
  if (one === undefined) throw new Error("every member is busy tomorrow");

  await measure("one member books a time, then cancels it", RUNS, async () => {
    const session = await memberBook(deps, one.userId, gymId, ask(trainer(0), 420), yes);
    if (session === null) throw new Error("no session");
    await memberCancel(deps, one.userId, gymId, session.id, { lateOk: true }, yes);
  });

  // Each press a different free time: ten trainers by eight free hours is eighty times.
  const free = trainers.flatMap((t) => [420, 540, 660, 780, 900, 1020, 1140, 1260].map((minute) => ({ t, minute })));
  const pressers = idle.slice(1, 1 + free.length);
  await measure(`${String(pressers.length)} members each press a different time at once`, 3, async () => {
    const sessions = await Promise.all(
      pressers.map((m, i) => {
        const slot = free[i];
        if (slot === undefined) throw new Error("no slot");
        return memberBook(deps, m.userId, gymId, ask(slot.t, slot.minute), yes);
      }),
    );
    // Put back, inside the time measured: the next run needs them free. A late cancel made
    // tomorrow's free cancel here, so the count is as it was.
    await Promise.all(sessions.map((s, i) => (s === null ? Promise.resolve(null) : memberCancel(deps, (pressers[i] ?? one).userId, gymId, s.id, { lateOk: true }, yes))));
  });
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
