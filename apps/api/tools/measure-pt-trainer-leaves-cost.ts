// What a trainer leaving the staff, and marking who came, cost (ROADMAP 17e-iv-b; CLAUDE.md
// §4 "Cost at full size"). The launch shape: 20 gyms of 200 members, every member with
// eight coming sessions. One gym is measured, with one trainer who holds:
//
//   - 1,600 coming sessions: every session of a gym of 200 booked with the one trainer
//   - 8,064 coming sessions: the most one trainer can hold (ten-minute sessions, all day,
//     every day of the eight weeks sessions are booked ahead)
//
// For each: the first press on Remove from staff (the box that names the sessions), the
// press that removes them (every session ends, packs have theirs back), and, on the full
// trainer, one session marked came and a week of theirs read (1,008 sessions on screen).
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-pt-trainer-leaves-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { removeStaff } from "../src/modules/orgs/repo.js";
import { PtSessionsEndAsk } from "../src/modules/orgs/pt/changes.js";
import { getWeek, mark, type PtDeps } from "../src/modules/orgs/pt/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-pt-trainer-leaves-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const MEMBERS = 200;
const EACH = 8;
/** Ten-minute sessions all day, for the eight weeks sessions are booked ahead. */
const A_DAY = 144;
const DAYS = 56;
const PREFIX = "pt-trainer-cost-";
/** What the service asks a gym's last owner to keep; no owner is removed here. */
const LAST_OWNER_REQUIRED_PRIVILEGES = ["staff.manage", "billing.manage"];
const PLAN = "zz_ptt_cost";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_trainer_hours WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_trainers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
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
  /** The trainer every session of the launch shape is booked with. */
  trainer: string;
  /** A second trainer, who holds the most one trainer can. */
  full: string;
}

async function makeGym(n: number, withFull: boolean): Promise<Gym> {
  const owner = randomUUID();
  const gymId = randomUUID();
  const trainer = randomUUID();
  const full = randomUUID();
  await sql`INSERT INTO users ${sql([
    { id: owner, email: `${PREFIX}${owner}@example.com`, display_name: "Cost Owner" },
    { id: trainer, email: `${PREFIX}t-${trainer}@example.com`, display_name: "Trainer Cost" },
    { id: full, email: `${PREFIX}f-${full}@example.com`, display_name: "Full Cost" },
  ])}`;
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, ${`Cost Gym ${String(n)}`}, 'UTC', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff ${sql([
    { gym_id: gymId, user_id: owner, role: "owner" },
    { gym_id: gymId, user_id: trainer, role: "trainer" },
    { gym_id: gymId, user_id: full, role: "trainer" },
  ])}`;
  await sql`INSERT INTO gym_trainers ${sql([
    { gym_id: gymId, user_id: trainer, offers: true, session_minutes: 60 },
    { gym_id: gymId, user_id: full, offers: true, session_minutes: 10 },
  ])}`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;

  const entries = Array.from({ length: MEMBERS }, () => randomUUID());
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
  const [type] = await sql<{ id: string }[]>`
    INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, pack_classes, pack_days, access, covers_all_classes, includes_pt)
    VALUES (${gymId}, 'PT pack', 'pack', 30000, 'GBP', 200, 60, 'all_classes', true, true)
    RETURNING id`;
  if (type === undefined) throw new Error("no membership type");
  await sql`
    INSERT INTO gym_held_memberships ${sql(
      entries.map((id) => ({
        gym_id: gymId,
        entry_id: id,
        membership_type_id: type.id,
        request_key: randomUUID(),
        kind: "pack",
        price_minor: 30000,
        currency: "GBP",
        pack_classes: 200,
        pack_days: 60,
        classes_left: 100,
        starts_on: new Date().toISOString().slice(0, 10),
        status: "active",
        renews: false,
      })),
    )}`;
  // The launch shape: member k's j-th session is on day 1 + j, at minute k of the day: all
  // 1,600 with the one trainer, each charged to its member's pack.
  await sql`
    INSERT INTO gym_pt_appointments
      (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, pack_charged, request_key, booked_by, created_at)
    SELECT ${gymId}, ${trainer}, e.id, h.id, d.day, e.rn * 5,
           d.day + make_interval(mins => e.rn * 5), d.day + make_interval(mins => e.rn * 5 + 5),
           10, 'booked', true, gen_random_uuid(), ${owner}, now()
    FROM (SELECT id, (row_number() OVER (ORDER BY id) - 1)::int AS rn FROM gym_member_list_entries WHERE gym_id = ${gymId}) e
    JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.entry_id = e.id
    CROSS JOIN (SELECT (now() AT TIME ZONE 'UTC')::date + n AS day FROM generate_series(1, ${EACH}) AS n) d`;
  if (!withFull) return { gymId, owner, trainer, full };
  // The most one trainer can hold: every ten minutes of every one of the 56 days.
  await sql`
    INSERT INTO gym_pt_appointments
      (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, pack_charged, request_key, booked_by, created_at)
    SELECT ${gymId}, ${full}, e.id, h.id, d.day, s.n * 10,
           d.day + make_interval(mins => s.n * 10), d.day + make_interval(mins => s.n * 10 + 10),
           10, 'booked', true, gen_random_uuid(), ${owner}, now()
    FROM (SELECT (now() AT TIME ZONE 'UTC')::date + n AS day, n AS dn FROM generate_series(1, ${DAYS}) AS n) d
    CROSS JOIN generate_series(0, ${A_DAY - 1}) AS s(n)
    JOIN (SELECT id, (row_number() OVER (ORDER BY id) - 1)::int AS rn FROM gym_member_list_entries WHERE gym_id = ${gymId}) e
      ON e.rn = (d.dn * ${A_DAY} + s.n) % ${MEMBERS}
    JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.entry_id = e.id`;
  return { gymId, owner, trainer, full };
}

await cleanup();
// Whatever happens below, the gyms and their lists are removed.
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (code) DO UPDATE SET active = true`;
  let measured: Gym | undefined;
  for (let n = 0; n < GYMS; n++) {
    const gym = await makeGym(n, n === GYMS - 1);
    if (n === GYMS - 1) measured = gym;
  }
  if (measured === undefined) throw new Error("no gym was made");
  const { gymId, owner, trainer, full } = measured;
  for (const table of ["gym_pt_appointments", "gym_member_list_entries", "gym_held_memberships", "gym_staff", "users"]) {
    await sql.unsafe(`ANALYZE ${table}`);
  }
  const bookedWith = async (who: string): Promise<number> =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_pt_appointments WHERE gym_id = ${gymId} AND trainer_user_id = ${who} AND status = 'booked'`)[0]?.n ?? 0;
  if ((await bookedWith(trainer)) !== MEMBERS * EACH) throw new Error("the launch trainer's sessions are not all there");
  if ((await bookedWith(full)) !== A_DAY * DAYS) throw new Error("the full trainer's sessions are not all there");

  /** The trainer back on the staff with every session booked and charged. */
  const putBack = async (who: string): Promise<void> => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${who}, 'trainer') ON CONFLICT DO NOTHING`;
    await sql`UPDATE gym_pt_appointments SET status = 'booked', cancelled_at = NULL, pack_charged = true WHERE gym_id = ${gymId} AND trainer_user_id = ${who}`;
    await sql`UPDATE gym_held_memberships SET classes_left = 100, status = 'active' WHERE gym_id = ${gymId}`;
    await sql`DELETE FROM audit_log WHERE gym_id = ${gymId}`;
  };

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
      `  ${name.padEnd(62)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  };

  const cpu = os.cpus()[0];
  console.log(
    `measure-pt-trainer-leaves-cost: ${String(GYMS)} gyms of ${String(MEMBERS)} members, ${String(MEMBERS * EACH)} coming sessions a gym · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz`,
  );

  const press = (who: string, confirmPtSessions: string | null) =>
    removeStaff(sql, { gymId, userId: who, lastOwnerRequires: LAST_OWNER_REQUIRED_PRIVILEGES, actorUserId: owner, at: new Date(), confirmPtSessions });
  /** The first press: the box. */
  const box = async (who: string) => {
    try {
      await press(who, null);
    } catch (err) {
      if (err instanceof PtSessionsEndAsk) return err.sessions;
      throw err;
    }
    throw new Error("the removal did not ask first");
  };

  for (const [who, n, label] of [
    [trainer, MEMBERS * EACH, "a trainer with every session of a gym of 200"],
    [full, A_DAY * DAYS, "a trainer with the most one can hold"],
  ] as const) {
    const first = await box(who);
    if (first.count !== n) throw new Error(`the box counts ${String(first.count)} sessions, not ${String(n)}`);
    console.log(`  ${label}: ${String(first.count)} sessions counted, ${String(first.sessions.length)} named, ${String(JSON.stringify(first).length)} bytes`);
    await measure(`the box, ${String(n)} sessions`, 10, () => box(who));
    await measure(
      `Remove pressed: ${String(n)} sessions end`,
      5,
      async () => {
        const asked = await box(who);
        const outcome = await press(who, asked.mark);
        if (outcome.kind !== "removed") throw new Error(`the press answered ${outcome.kind}`);
        if ((await bookedWith(who)) !== 0) throw new Error("sessions were left booked");
      },
      () => putBack(who),
    );
  }

  // One session marked came, and the week it is on read, on the trainer who holds the most.
  const deps: PtDeps = { sql, now: () => new Date(Date.now() + 2 * 24 * 60 * 60_000) };
  const yes = (): Promise<boolean> => Promise.resolve(true);
  const [one] = await sql<{ id: string }[]>`
    SELECT id FROM gym_pt_appointments WHERE gym_id = ${gymId} AND trainer_user_id = ${full} ORDER BY starts_at LIMIT 1`;
  if (one === undefined) throw new Error("no session");
  let to: "attended" | "no_show" = "attended";
  await measure("one session marked (came, then no-show, in turn)", 20, async () => {
    const view = await mark(deps, owner, gymId, one.id, { status: to }, yes);
    if (view?.status !== to) throw new Error("the mark was not kept");
    to = to === "attended" ? "no_show" : "attended";
  });
  const week = await getWeek(deps, owner, gymId, { trainer: full }, yes);
  const onScreen = week?.days.reduce((sum, day) => sum + day.appointments.length, 0) ?? 0;
  console.log(`  a week of that trainer: ${String(onScreen)} sessions, ${String(JSON.stringify(week).length)} bytes`);
  await measure(`a week of that trainer read (${String(onScreen)} sessions)`, 10, () => getWeek(deps, owner, gymId, { trainer: full }, yes));
  await measure("ten of those weeks read at once", 5, () => Promise.all(Array.from({ length: 10 }, () => getWeek(deps, owner, gymId, { trainer: full }, yes))));
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
