// What a late cancel and no-show fee costs (ROADMAP 18h-i; CLAUDE.md §4 "Cost at full size").
// The launch shape: 20 gyms of 200 members, each holding the gym's monthly membership, and
// in every gym a class of all 200 that ended twenty minutes ago, half of them checked in.
// Measured:
//
//   - the run that marks ended classes, fees on: 2,000 no-shows and 2,000 fees opened
//   - the same run with fees off, to see what the fees add
//   - the list of that class of 200 for staff, each place with its fee
//   - a person's page reading a membership with 63 fees on it
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-class-fees-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { markEndedClasses } from "../src/modules/orgs/classes/attendance.js";
import { staffList } from "../src/modules/orgs/classes/bookingsRepo.js";
import { feesFor } from "../src/modules/orgs/memberships/feesRepo.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-class-fees-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const MEMBERS = 200;
const PREFIX = "class-fee-cost-";
const PLAN = "zz_classfee_cost";
const MIN = 60_000;

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
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
  ended: string;
  heldIds: string[];
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
  await sql`
    INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id, class_late_cancel_fee_minor, class_no_show_fee_minor)
    VALUES (${gymId}, ${PREFIX + gymId}, ${`Fee Gym ${String(n)}`}, 'UTC', 'GB', ${owner}, 500, 800)`;
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
    INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, term_count, term_unit, access, covers_all_classes)
    VALUES (${gymId}, 'Gold Monthly', 'recurring', 4999, 'GBP', 1, 'month', 'all_classes', true)
    RETURNING id`;
  if (type === undefined) throw new Error("no membership type");
  const held = await sql<{ id: string; entry_id: string }[]>`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, renews, paid_periods)
    SELECT ${gymId}, e, ${type.id}, gen_random_uuid(), 'recurring', 4999, 'GBP', 1, 'month', (${new Date(t0)}::timestamptz AT TIME ZONE 'UTC')::date - 3, 'active', true, 1
    FROM unnest(${entries}::uuid[]) AS e
    RETURNING id, entry_id`;
  const heldOf = new Map(held.map((h) => [h.entry_id, h.id]));
  const [classType] = await sql<{ id: string }[]>`
    INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gymId}, 'Spin', 45, NULL, 'blue', false) RETURNING id`;
  if (classType === undefined) throw new Error("no class type");
  const endedStart = t0 - 65 * MIN;
  const [session] = await sql<{ id: string }[]>`
    INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
    SELECT ${gymId}, ${classType.id}, (x.at AT TIME ZONE 'UTC')::date,
           (EXTRACT(HOUR FROM x.at AT TIME ZONE 'UTC') * 60 + EXTRACT(MINUTE FROM x.at AT TIME ZONE 'UTC'))::int, x.at, 45, NULL, 'scheduled'
    FROM (SELECT ${new Date(endedStart)}::timestamptz AS at) x
    RETURNING id`;
  if (session === undefined) throw new Error("no class");
  await sql`
    INSERT INTO gym_class_bookings ${sql(
      members.map((userId, i) => ({
        gym_id: gymId,
        session_id: session.id,
        user_id: userId,
        entry_id: entries[i] ?? null,
        held_membership_id: heldOf.get(entries[i] ?? "") ?? null,
        request_key: randomUUID(),
        status: "booked",
        pack_charged: false,
        booked_at: new Date(t0 - 2 * 24 * 60 * MIN),
      })),
    )}`;
  // Half of the class checked in as it started; the other half did not.
  await sql`
    INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
    SELECT ${gymId}, m.user_id, m.entry_id, ${owner}, (${new Date(endedStart)}::timestamptz AT TIME ZONE 'UTC')::date, 'staff', 'hours_unset', 'hours_unset',
           ${new Date(endedStart)}
    FROM (SELECT user_id, entry_id, (row_number() OVER (ORDER BY user_id))::int AS rn FROM gym_members WHERE gym_id = ${gymId}) m
    WHERE m.rn % 2 = 0`;
  return { gymId, ended: session.id, heldIds: held.map((h) => h.id) };
}

await cleanup();
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (code) DO UPDATE SET active = true`;
  const t0 = Date.now();
  const gyms: Gym[] = [];
  for (let n = 0; n < GYMS; n++) gyms.push(await makeGym(n, t0));
  const ids = gyms.map((g) => g.gymId);
  const measured = gyms[0];
  if (measured === undefined) throw new Error("no gym was made");
  for (const table of ["gym_class_bookings", "gym_attendance", "gym_held_memberships", "gym_member_bills", "gym_members", "gym_member_list_entries"]) {
    await sql.unsafe(`ANALYZE ${table}`);
  }

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
      `  ${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  };
  /** The ended classes as they were before the run: everybody booked, no fee. */
  const putBack = async (): Promise<void> => {
    await sql`DELETE FROM gym_member_bills WHERE gym_id = ANY(${ids}::uuid[]) AND fee IS NOT NULL`;
    await sql`UPDATE gym_class_bookings SET status = 'booked' WHERE gym_id = ANY(${ids}::uuid[]) AND status IN ('attended','no_show')`;
  };
  const log = { warn: (obj: object) => console.error(obj) };
  const at = new Date(t0 + 0 * MIN);

  const cpu = os.cpus()[0];
  console.log(`measure-class-fees-cost: ${String(GYMS)} gyms of ${String(MEMBERS)} members · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz`);
  const first = await markEndedClasses({ sql, log }, at, ids);
  const opened = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_bills WHERE gym_id = ANY(${ids}::uuid[]) AND fee IS NOT NULL`)[0]?.n ?? 0;
  console.log(`  one run: ${String(first.noShows)} no-shows, ${String(first.attended)} came, ${String(opened)} fees opened`);
  await putBack();
  await measure("the run, a class of 200 in all 20 gyms, fees on", 5, () => markEndedClasses({ sql, log }, at, ids), putBack);
  await sql`UPDATE gyms SET class_late_cancel_fee_minor = 0, class_no_show_fee_minor = 0 WHERE id = ANY(${ids}::uuid[])`;
  await measure("the same run, fees off", 5, () => markEndedClasses({ sql, log }, at, ids), putBack);
  await sql`UPDATE gyms SET class_late_cancel_fee_minor = 500, class_no_show_fee_minor = 800 WHERE id = ANY(${ids}::uuid[])`;
  await markEndedClasses({ sql, log }, at, ids);
  await measure("staff's list of the class of 200, each with its fee", 10, () => staffList(sql, measured.gymId, measured.ended, ["booked", "attended", "no_show"], 1000));
  // One membership with 63 fees on it: 3 unpaid, 60 waived.
  const heavy = measured.heldIds[1] ?? "";
  await sql`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, fee, fee_for, amount_minor, currency, due_on, covers_from, covers_to, status, void_reason, voided_on, created_at)
    SELECT ${measured.gymId}, ${heavy}, 'no_show', 'Spin', 800, 'GBP', d, d, d,
           CASE WHEN i <= 3 THEN 'open' ELSE 'void' END, CASE WHEN i <= 3 THEN NULL ELSE 'waived' END, CASE WHEN i <= 3 THEN NULL ELSE d END,
           now() - make_interval(days => 400 - i)
    FROM generate_series(1, 63) i, LATERAL (SELECT (now() - make_interval(days => 400 - i))::date AS d) x`;
  await measure("a person's page: the fees of a membership with 63", 10, () => feesFor(sql, measured.gymId, [heavy]));
} finally {
  await cleanup();
  await sql.end();
}
