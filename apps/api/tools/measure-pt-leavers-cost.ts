// What ending personal training sessions with a removal costs (ROADMAP 17e-iv-a; CLAUDE.md §4
// "Cost at full size"). The launch shape: 20 gyms of 200 members. One gym is measured: every
// one of its 200 members in the app, each with a pack and eight coming sessions booked
// (1,600 sessions), ten trainers.
//
//   - staff tick all 200 and open the Remove box (the read that names the sessions)
//   - staff press Remove on all 200: 200 records move, 200 leave the app, 1,600 sessions end
//   - staff open the Remove box for one person
//   - staff remove one person, sessions confirmed
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-pt-leavers-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { takeOff } from "../src/modules/orgs/memberList/byHandService.js";
import { previewRemoveSelected, removeSelected } from "../src/modules/orgs/memberList/removeSelected.js";
import type { MemberListDeps } from "../src/modules/orgs/memberList/service.js";
import { PtSessionsEndAsk } from "../src/modules/orgs/pt/changes.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-pt-leavers-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const MEMBERS = 200;
const TRAINERS = 10;
const EACH = 8;
const PREFIX = "pt-leavers-cost-";
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
  await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Member {
  userId: string;
  entryId: string;
}

async function makeGym(n: number): Promise<{ gymId: string; owner: string; members: Member[] }> {
  const owner = randomUUID();
  const gymId = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, ${`Cost Gym ${String(n)}`}, 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;

  const members: Member[] = Array.from({ length: MEMBERS }, () => ({ userId: randomUUID(), entryId: randomUUID() }));
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
    INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, pack_classes, pack_days, access, covers_all_classes, includes_pt)
    VALUES (${gymId}, 'PT 10', 'pack', 30000, 'GBP', 10, 60, 'all_classes', true, true)
    RETURNING id`;
  if (type === undefined) throw new Error("no membership type");
  await sql`
    INSERT INTO gym_held_memberships ${sql(
      members.map((m) => ({
        gym_id: gymId,
        entry_id: m.entryId,
        membership_type_id: type.id,
        request_key: randomUUID(),
        kind: "pack",
        price_minor: 30000,
        currency: "GBP",
        pack_classes: 10,
        pack_days: 60,
        classes_left: 10 - EACH,
        starts_on: new Date().toISOString().slice(0, 10),
        status: "active",
        renews: false,
      })),
    )}`;

  const trainers = Array.from({ length: TRAINERS }, () => randomUUID());
  await sql`INSERT INTO users ${sql(trainers.map((id, i) => ({ id, email: `${PREFIX}t-${id}@example.com`, display_name: `Trainer${String(i)} Cost` })))}`;
  await sql`INSERT INTO gym_staff ${sql(trainers.map((id) => ({ gym_id: gymId, user_id: id, role: "trainer" })))}`;
  await sql`INSERT INTO gym_trainers ${sql(trainers.map((id) => ({ gym_id: gymId, user_id: id, offers: true, session_minutes: 60 })))}`;
  // Every member has EACH coming sessions, each charged to their pack: member k's j-th is
  // with trainer k mod 10, on day 1 + j, at an hour of its own among that trainer's twenty.
  await sql`
    INSERT INTO gym_pt_appointments
      (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, pack_charged, request_key, booked_by, created_at)
    SELECT ${gymId}, t.id, e.id, h.id, d.day, 60 * (e.rn / ${TRAINERS}),
           (d.day + make_interval(mins => 60 * (e.rn / ${TRAINERS})::int)) AT TIME ZONE 'Europe/London',
           (d.day + make_interval(mins => 60 * (e.rn / ${TRAINERS})::int + 60)) AT TIME ZONE 'Europe/London',
           60, 'booked', true, gen_random_uuid(), ${owner}, now()
    FROM (SELECT id, (row_number() OVER (ORDER BY id) - 1)::int AS rn FROM gym_member_list_entries WHERE gym_id = ${gymId}) e
    JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.entry_id = e.id
    JOIN unnest(${trainers}::uuid[]) WITH ORDINALITY AS t(id, tn) ON t.tn = 1 + (e.rn % ${TRAINERS})
    CROSS JOIN (SELECT (now() AT TIME ZONE 'Europe/London')::date + n AS day FROM generate_series(1, ${EACH}) AS n) d`;
  return { gymId, owner, members };
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
  const { gymId, owner, members } = measured;
  for (const table of ["gym_pt_appointments", "gym_member_list_entries", "gym_members", "gym_held_memberships", "users"]) {
    await sql.unsafe(`ANALYZE ${table}`);
  }
  const [booked] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_pt_appointments WHERE gym_id = ${gymId} AND status = 'booked'`;
  if (booked?.n !== MEMBERS * EACH) throw new Error(`the gym has ${String(booked?.n)} sessions, not ${String(MEMBERS * EACH)}`);

  const deps: MemberListDeps = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => new Date(), invites: null };
  const yes = (): Promise<boolean> => Promise.resolve(true);
  const everybody = { kind: "ticked" as const, entryIds: members.map((m) => m.entryId) };
  const first = members[0];
  if (first === undefined) throw new Error("no member");

  /** Everybody back as they were: on the list, in the app, their sessions booked and charged. */
  const putBack = async (): Promise<void> => {
    await sql`UPDATE gym_member_list_entries SET former_at = NULL WHERE gym_id = ${gymId}`;
    await sql`UPDATE gym_members SET removed_at = NULL, removed_entry_id = NULL WHERE gym_id = ${gymId}`;
    await sql`UPDATE gym_pt_appointments SET status = 'booked', cancelled_at = NULL, pack_charged = true WHERE gym_id = ${gymId}`;
    await sql`UPDATE gym_held_memberships SET classes_left = ${10 - EACH}, status = 'active' WHERE gym_id = ${gymId}`;
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
      `  ${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  };

  const cpu = os.cpus()[0];
  console.log(
    `measure-pt-leavers-cost: ${String(GYMS)} gyms of ${String(MEMBERS)} members, each with ${String(EACH)} coming sessions (${String(MEMBERS * EACH)} a gym) · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz`,
  );

  const boxOf = async (selection: { kind: "ticked"; entryIds: string[] }) => {
    const box = await previewRemoveSelected(deps, owner, gymId, { selection }, yes);
    if (box === null) throw new Error("no box");
    return box;
  };
  const whole = await boxOf(everybody);
  if (whole.ptSessions?.count !== MEMBERS * EACH) throw new Error(`the box names ${String(whole.ptSessions?.count)} sessions`);
  console.log(`  the box for all ${String(MEMBERS)}: ${String(whole.ptSessions.count)} sessions counted, ${String(whole.ptSessions.sessions.length)} named, ${String(JSON.stringify(whole).length)} bytes`);

  await measure(`the Remove box for all ${String(MEMBERS)} ticked`, 10, () => boxOf(everybody));
  await measure(
    `Remove pressed on all ${String(MEMBERS)}: ${String(MEMBERS * EACH)} sessions end`,
    5,
    async () => {
      const box = await boxOf(everybody);
      const answer = await removeSelected(deps, owner, gymId, { selection: everybody, digest: box.digest, acknowledgeLargeChange: true }, yes);
      if (answer.kind !== "removed" || answer.removed.moved !== MEMBERS) throw new Error(`the press answered ${answer.kind}`);
      const [left] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_pt_appointments WHERE gym_id = ${gymId} AND status = 'booked'`;
      if (left?.n !== 0) throw new Error(`${String(left?.n)} sessions were left booked`);
    },
    putBack,
  );
  await measure("the Remove box for one person", 20, () => boxOf({ kind: "ticked", entryIds: [first.entryId] }));
  await measure(
    "one person removed, their sessions confirmed",
    10,
    async () => {
      let mark: string | null = null;
      try {
        await takeOff(deps, owner, gymId, first.entryId, yes);
      } catch (err) {
        if (!(err instanceof PtSessionsEndAsk)) throw err;
        mark = err.sessions.mark;
      }
      if (mark === null) throw new Error("the removal did not ask first");
      await takeOff(deps, owner, gymId, first.entryId, yes, mark);
    },
    putBack,
  );
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
