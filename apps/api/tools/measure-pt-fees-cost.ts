// What a late cancel and no-show fee for personal training costs (ROADMAP 18h-ii; CLAUDE.md
// §4 "Cost at full size"). The launch shape: 20 gyms of 200 members, each holding a
// membership that includes personal training, and in every gym one trainer who saw all 200
// in the last seven days, in sessions of 30 minutes, every one a no-show with its fee: 4,000
// sessions and 4,000 fees in the tables. Measured:
//
//   - that trainer's week as staff read it: 200 sessions, each with its fee
//   - one No-show pressed, which opens its fee
//   - a person's page reading a membership with 63 session fees on it
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-pt-fees-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { feesFor } from "../src/modules/orgs/memberships/feesRepo.js";
import { getWeek, mark } from "../src/modules/orgs/pt/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-pt-fees-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const MEMBERS = 200;
const PREFIX = "pt-fee-cost-";
const PLAN = "zz_ptfee_cost";
const DAY = 24 * 60 * 60_000;

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${gyms})`;
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

interface Gym {
  gymId: string;
  owner: string;
  trainer: string;
  from: string;
  heldIds: string[];
  /** One more session of the first member's, today, not marked yet: the press measured. */
  open: string;
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

async function makeGym(n: number, t0: number): Promise<Gym> {
  const owner = randomUUID();
  const trainer = randomUUID();
  const gymId = randomUUID();
  const members = Array.from({ length: MEMBERS }, () => randomUUID());
  const entries = members.map(() => randomUUID());
  await sql`INSERT INTO users ${sql([
    { id: owner, email: `${PREFIX}${owner}@example.com`, display_name: "Cost Owner" },
    { id: trainer, email: `${PREFIX}t-${trainer}@example.com`, display_name: "Sam Trainer" },
    ...members.map((id, i) => ({ id, email: `${PREFIX}m-${id}@example.com`, display_name: `Member${String(i)} Cost` })),
  ])}`;
  await sql`
    INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id, pt_late_cancel_fee_minor, pt_no_show_fee_minor)
    VALUES (${gymId}, ${PREFIX + gymId}, ${`PT Fee Gym ${String(n)}`}, 'UTC', 'GB', ${owner}, 500, 800)`;
  await sql`INSERT INTO gym_staff ${sql([
    { gym_id: gymId, user_id: owner, role: "owner" },
    { gym_id: gymId, user_id: trainer, role: "trainer" },
  ])}`;
  await sql`INSERT INTO gym_trainers (gym_id, user_id, offers, session_minutes) VALUES (${gymId}, ${trainer}, true, 30)`;
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
    INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, term_count, term_unit, access, covers_all_classes, includes_pt)
    VALUES (${gymId}, 'Gold PT', 'recurring', 4999, 'GBP', 1, 'month', 'all_classes', true, true)
    RETURNING id`;
  if (type === undefined) throw new Error("no membership type");
  const held = await sql<{ id: string; entry_id: string }[]>`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, renews, paid_periods)
    SELECT ${gymId}, e, ${type.id}, gen_random_uuid(), 'recurring', 4999, 'GBP', 1, 'month', ${dayOf(t0 - 20 * DAY)}::date, 'active', true, 1
    FROM unnest(${entries}::uuid[]) AS e
    RETURNING id, entry_id`;
  const heldOf = new Map(held.map((h) => [h.entry_id, h.id]));
  // 200 sessions of 30 minutes over the last seven days, from 06:00: none overlaps.
  const from = dayOf(t0 - 7 * DAY);
  const sessions = entries.map((entryId, i) => {
    const day = dayOf(t0 - (7 - (i % 7)) * DAY);
    const minute = 360 + Math.floor(i / 7) * 30;
    const startsAt = new Date(`${day}T00:00:00Z`).getTime() + minute * 60_000;
    return {
      gym_id: gymId,
      trainer_user_id: trainer,
      entry_id: entryId,
      held_membership_id: heldOf.get(entryId) ?? null,
      local_date: day,
      local_start_minute: minute,
      starts_at: new Date(startsAt),
      ends_at: new Date(startsAt + 30 * 60_000),
      minutes: 30,
      status: "no_show",
      pack_charged: false,
      request_key: randomUUID(),
      booked_by: owner,
    };
  });
  const made = await sql<{ id: string; held_membership_id: string; local_date: string }[]>`
    INSERT INTO gym_pt_appointments ${sql(sessions)} RETURNING id, held_membership_id, local_date::text AS local_date`;
  await sql`
    INSERT INTO gym_member_bills ${sql(
      made.map((s) => ({
        gym_id: gymId,
        held_membership_id: s.held_membership_id,
        fee: "no_show",
        fee_for: "Personal training with Sam Trainer",
        pt_appointment_id: s.id,
        amount_minor: 800,
        currency: "GBP",
        due_on: s.local_date,
        covers_from: s.local_date,
        covers_to: s.local_date,
      })),
    )}`;
  // Today, in the hour that has just begun: started, so it can be marked.
  const startsAt = Math.floor(t0 / (60 * 60_000)) * 60 * 60_000;
  const [open] = await sql<{ id: string }[]>`
    INSERT INTO gym_pt_appointments
      (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, pack_charged, request_key, booked_by)
    VALUES (${gymId}, ${trainer}, ${entries[0] ?? ""}, ${heldOf.get(entries[0] ?? "") ?? null}, ${dayOf(startsAt)}::date,
            ${new Date(startsAt).getUTCHours() * 60}, ${new Date(startsAt)}, ${new Date(startsAt + 30 * 60_000)}, 30, 'booked', false, gen_random_uuid(), ${owner})
    RETURNING id`;
  if (open === undefined) throw new Error("no open session");
  return { gymId, owner, trainer, from, heldIds: held.map((h) => h.id), open: open.id };
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
  const measured = gyms[0];
  if (measured === undefined) throw new Error("no gym was made");
  for (const table of ["gym_pt_appointments", "gym_held_memberships", "gym_member_bills", "gym_members", "gym_member_list_entries"]) {
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
  const deps = { sql, now: () => new Date(t0 + 5 * 60_000) };
  const yes = () => Promise.resolve(true);

  const cpu = os.cpus()[0];
  const counts = await sql<{ sessions: number; fees: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_pt_appointments WHERE gym_id = ANY(${gyms.map((g) => g.gymId)}::uuid[])) AS sessions,
           (SELECT count(*)::int FROM gym_member_bills WHERE gym_id = ANY(${gyms.map((g) => g.gymId)}::uuid[]) AND fee IS NOT NULL) AS fees`;
  console.log(`measure-pt-fees-cost: ${String(GYMS)} gyms of ${String(MEMBERS)} members · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz`);
  console.log(`  in the tables: ${String(counts[0]?.sessions ?? 0)} sessions, ${String(counts[0]?.fees ?? 0)} fees`);
  const week = await getWeek(deps, measured.owner, measured.gymId, { trainer: measured.trainer, from: measured.from }, yes);
  const shown = week?.days.flatMap((d) => d.appointments) ?? [];
  console.log(`  the week read: ${String(shown.length)} sessions, ${String(shown.filter((a) => a.fee !== null).length)} with a fee`);
  await measure("the trainer's week of 200 sessions, each with its fee", 10, () =>
    getWeek(deps, measured.owner, measured.gymId, { trainer: measured.trainer, from: measured.from }, yes),
  );
  /** The press measured, undone: the session not marked, and no fee for it. */
  const putBack = async (): Promise<void> => {
    await sql`DELETE FROM gym_member_bills WHERE gym_id = ${measured.gymId} AND pt_appointment_id = ${measured.open}`;
    await sql`UPDATE gym_pt_appointments SET status = 'booked' WHERE id = ${measured.open}`;
  };
  await measure("No-show pressed: the session marked and its fee opened", 10, () => mark(deps, measured.owner, measured.gymId, measured.open, { status: "no_show" }, yes), putBack);
  // One membership with 63 session fees on it: 3 unpaid, 60 waived.
  const heavy = measured.heldIds[1] ?? "";
  await sql`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, fee, fee_for, amount_minor, currency, due_on, covers_from, covers_to, status, void_reason, voided_on, created_at)
    SELECT ${measured.gymId}, ${heavy}, 'no_show', 'Personal training with Sam Trainer', 800, 'GBP', d, d, d,
           CASE WHEN i <= 3 THEN 'open' ELSE 'void' END, CASE WHEN i <= 3 THEN NULL ELSE 'waived' END, CASE WHEN i <= 3 THEN NULL ELSE d END,
           now() - make_interval(days => 400 - i)
    FROM generate_series(1, 63) i, LATERAL (SELECT (now() - make_interval(days => 400 - i))::date AS d) x`;
  await measure("a person's page: the fees of a membership with 64", 10, () => feesFor(sql, measured.gymId, [heavy]));
} finally {
  await cleanup();
  await sql.end();
}
