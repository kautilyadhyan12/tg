// What family plans cost (ROADMAP 18i; CLAUDE.md §4 "Cost at full size"). The launch shape:
// 20 gyms of 200 members, every one on the gym's list and in its app with a monthly
// membership that began eight days ago, its first bill open and late. In every gym 20
// parents each pay for 9 of the others: 180 paid for, near the most a gym of 200 can have
// with ten at most a payer. Measured:
//
//   - the morning's read of one gym for its messages (`membershipFactsByPerson`), every
//     paid-for bill moved to its payer
//   - a payer's Who pays box: who they pay for
//   - the payer's page reading what each of the 9 owes (9 reads, at once, as the page does)
//   - one payment recorded for somebody paid for, which reads their payer as it is written
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-payers-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { getHeldMemberships, recordMemberPayment } from "../src/modules/orgs/memberships/heldService.js";
import { membershipFactsByPerson } from "../src/modules/orgs/messages/membershipsRepo.js";
import { getPayers } from "../src/modules/orgs/payers/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-payers-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const MEMBERS = 200;
const PAYERS = 20;
const EACH = 9;
const PRICE = 150_000;
const PREFIX = "payer-cost-";
const PLAN = "zz_payer_cost";
const DAY = 24 * 60 * 60_000;

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${gyms})`;
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

interface Gym {
  gymId: string;
  owner: string;
  payer: string;
  paidFor: { entryId: string; heldId: string }[];
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

async function makeGym(n: number, t0: number): Promise<Gym> {
  const owner = randomUUID();
  const gymId = randomUUID();
  const members = Array.from({ length: MEMBERS }, () => randomUUID());
  const entries = members.map(() => randomUUID());
  await sql`INSERT INTO users ${sql([
    { id: owner, email: `${PREFIX}${owner}@example.com`, display_name: "Cost Owner" },
    ...members.map((id, i) => ({ id, email: `${PREFIX}m-${id}@example.com`, display_name: `Member${String(i)} Cost` })),
  ])}`;
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, ${`Payer Gym ${String(n)}`}, 'UTC', 'IN', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
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
    VALUES (${gymId}, 'Gold Monthly', 'recurring', ${PRICE}, 'INR', 1, 'month', 'all_classes', true)
    RETURNING id`;
  if (type === undefined) throw new Error("no membership type");
  const starts = dayOf(t0 - 8 * DAY);
  const held = await sql<{ id: string; entry_id: string }[]>`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, renews, paid_periods)
    SELECT ${gymId}, e, ${type.id}, gen_random_uuid(), 'recurring', ${PRICE}, 'INR', 1, 'month', ${starts}::date, 'active', true, 0
    FROM unnest(${entries}::uuid[]) AS e
    RETURNING id, entry_id`;
  await sql`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to)
    SELECT ${gymId}, h, 0, ${PRICE}, 'INR', ${starts}::date, ${starts}::date, (${starts}::date + interval '1 month' - interval '1 day')::date
    FROM unnest(${held.map((h) => h.id)}::uuid[]) AS h`;
  const heldOf = new Map(held.map((h) => [h.entry_id, h.id]));
  // The first 20 records pay, each for the 9 after them in the second part of the list.
  const links = Array.from({ length: PAYERS }, (_, p) =>
    Array.from({ length: EACH }, (_, k) => ({ gym_id: gymId, entry_id: entries[PAYERS + p * EACH + k] ?? "", payer_entry_id: entries[p] ?? "", set_by: owner })),
  ).flat();
  await sql`INSERT INTO gym_member_payers ${sql(links)}`;
  const payer = entries[0] ?? "";
  const paidFor = links.filter((l) => l.payer_entry_id === payer).map((l) => ({ entryId: l.entry_id, heldId: heldOf.get(l.entry_id) ?? "" }));
  return { gymId, owner, payer, paidFor };
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
  for (const table of ["gym_member_payers", "gym_held_memberships", "gym_member_bills", "gym_members", "gym_member_list_entries"]) await sql.unsafe(`ANALYZE ${table}`);

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  const measure = async (name: string, runs: number, run: (i: number) => Promise<unknown>): Promise<void> => {
    const walls: number[] = [];
    const busy: number[] = [];
    for (let i = 0; i < runs + 1; i++) {
      delay.reset();
      delay.enable();
      const before = performance.eventLoopUtilization();
      const start = performance.now();
      await run(i);
      const wall = performance.now() - start;
      delay.disable();
      const used = performance.eventLoopUtilization(before).active;
      // The first run warms the connections and is not counted.
      if (i === 0) continue;
      walls.push(wall);
      busy.push(used);
    }
    console.log(`  ${name.padEnd(62)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))})`);
  };
  const deps = { sql, now: () => new Date(t0) };
  const today = dayOf(t0);

  const cpu = os.cpus()[0];
  const counts = await sql<{ links: number; bills: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_member_payers WHERE gym_id = ANY(${gyms.map((g) => g.gymId)}::uuid[])) AS links,
           (SELECT count(*)::int FROM gym_member_bills WHERE gym_id = ANY(${gyms.map((g) => g.gymId)}::uuid[]) AND status = 'open') AS bills`;
  console.log(`measure-payers-cost: ${String(GYMS)} gyms of ${String(MEMBERS)} members · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz`);
  console.log(`  in the tables: ${String(counts[0]?.links ?? 0)} payer links, ${String(counts[0]?.bills ?? 0)} open bills`);
  const facts = await membershipFactsByPerson(sql, measured.gymId, today, 30);
  const payerUser = (await sql<{ user_id: string }[]>`SELECT user_id FROM gym_members WHERE gym_id = ${measured.gymId} AND entry_id = ${measured.payer}`)[0]?.user_id ?? "";
  console.log(`  the morning read: ${String(facts.size)} people, the first payer holding ${String(facts.get(payerUser)?.bills.length ?? 0)} bills`);

  await measure("the morning's read of one gym, 180 bills moved to 20 payers", 10, () => membershipFactsByPerson(sql, measured.gymId, today, 30));
  await measure("a payer's Who pays box: the 9 they pay for", 10, () => getPayers(deps, measured.owner, measured.gymId, measured.payer));
  await measure("the payer's page reading what each of the 9 owes, at once", 10, () =>
    Promise.all(measured.paidFor.map((p) => getHeldMemberships(deps, measured.owner, measured.gymId, p.entryId))),
  );
  // Each run pays a different person's bill, so every run is a real first payment.
  const payees = gyms.slice(1, 12).map((g) => ({ gym: g, ...(g.paidFor[0] ?? { entryId: "", heldId: "" }) }));
  await measure("one payment for somebody paid for, naming their payer", 10, (i) => {
    const p = payees[i];
    if (p === undefined) throw new Error("no payee");
    return recordMemberPayment(deps, p.gym.owner, p.gym.gymId, p.entryId, p.heldId, { requestKey: randomUUID(), periodIndex: 0, amountMinor: PRICE, method: "cash" });
  });
  const named = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_member_payments WHERE gym_id = ANY(${gyms.map((g) => g.gymId)}::uuid[]) AND paid_by_name = 'Member0 Cost'`;
  console.log(`  payments recorded naming their payer: ${String(named[0]?.n ?? 0)}`);
} finally {
  await cleanup();
  await sql.end();
}
