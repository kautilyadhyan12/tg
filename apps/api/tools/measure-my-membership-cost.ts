// What My membership costs (ROADMAP 18j; CLAUDE.md §4 "Cost at full size"). The launch shape:
// 20 gyms of 200 members, every one on the gym's list and in its app with a monthly
// membership. In the measured gym every member has paid it for 36 months, a payment and a
// receipt each, and bought 30 things at the desk: three years of history, past what a
// member's page shows. Measured:
//
//   - one member opening My membership
//   - the whole gym of 200 opening it at the same moment (a class lets out)
//   - one member opening one of their receipts
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-my-membership-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { getMyMembership, getMyReceipt } from "../src/modules/orgs/myMembership/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-my-membership-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const MEMBERS = 200;
const MONTHS = 36;
const SALES = 30;
const PRICE = 150_000;
const PREFIX = "mymem-cost-";
const DAY = 24 * 60 * 60_000;

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_sales WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_products WHERE gym_id IN (${gyms})`;
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
}

interface Gym {
  gymId: string;
  members: string[];
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A gym of 200; `history` gives every member 36 paid months and 30 purchases, else one open bill. */
async function makeGym(n: number, t0: number, history: boolean): Promise<Gym> {
  const owner = randomUUID();
  const gymId = randomUUID();
  const members = Array.from({ length: MEMBERS }, () => randomUUID());
  const entries = members.map(() => randomUUID());
  await sql`INSERT INTO users ${sql([
    { id: owner, email: `${PREFIX}${owner}@example.com`, display_name: "Cost Owner" },
    ...members.map((id, i) => ({ id, email: `${PREFIX}m-${id}@example.com`, display_name: `Member${String(i)} Cost` })),
  ])}`;
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, ${`My Gym ${String(n)}`}, 'UTC', 'IN', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
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
  await sql`INSERT INTO gym_members ${sql(members.map((id, i) => ({ gym_id: gymId, user_id: id, joined_at: new Date("2023-01-01T00:00:00Z"), entry_id: entries[i] ?? null })))}`;
  const [type] = await sql<{ id: string }[]>`
    INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, term_count, term_unit, access, covers_all_classes)
    VALUES (${gymId}, 'Gold Monthly', 'recurring', ${PRICE}, 'INR', 1, 'month', 'all_classes', true)
    RETURNING id`;
  if (type === undefined) throw new Error("no membership type");
  const months = history ? MONTHS : 1;
  const starts = dayOf(t0 - (months * 30 + 8) * DAY);
  const held = await sql<{ id: string }[]>`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, renews, paid_periods)
    SELECT ${gymId}, e, ${type.id}, gen_random_uuid(), 'recurring', ${PRICE}, 'INR', 1, 'month', ${starts}::date, 'active', true, ${history ? MONTHS : 0}
    FROM unnest(${entries}::uuid[]) AS e
    RETURNING id`;
  const heldIds = held.map((h) => h.id);
  if (!history) {
    await sql`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to)
      SELECT ${gymId}, h, 0, ${PRICE}, 'INR', ${starts}::date, ${starts}::date, (${starts}::date + interval '1 month' - interval '1 day')::date
      FROM unnest(${heldIds}::uuid[]) AS h`;
    return { gymId, members };
  }
  // Every member's 36 months, each bill paid in full by one payment with its own receipt.
  const bills = await sql<{ id: string; covers_from: string; n: number }[]>`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to, status)
    SELECT ${gymId}, h, p, ${PRICE}, 'INR', (${starts}::date + make_interval(months => p))::date, (${starts}::date + make_interval(months => p))::date,
           (${starts}::date + make_interval(months => p + 1) - interval '1 day')::date, 'paid'
    FROM unnest(${heldIds}::uuid[]) AS h, generate_series(0, ${MONTHS - 1}) AS p
    RETURNING id, covers_from::text AS covers_from, 0 AS n`;
  await sql`
    INSERT INTO gym_member_payments (gym_id, bill_id, amount_minor, currency, method, request_key, paid_on, recorded_by, receipt_number)
    SELECT ${gymId}, b.id, ${PRICE}, 'INR', 'cash', gen_random_uuid(), b.covers_from::date, ${owner}, row_number() OVER ()
    FROM jsonb_to_recordset(${sql.json(bills.map((b) => ({ id: b.id, covers_from: b.covers_from })))}) AS b(id uuid, covers_from text)`;
  const [product] = await sql<{ id: string }[]>`INSERT INTO gym_products (gym_id, name, price_minor, currency) VALUES (${gymId}, 'Water', 2500, 'INR') RETURNING id`;
  if (product === undefined) throw new Error("no product");
  const first = bills.length + 1;
  await sql`
    INSERT INTO gym_sales (gym_id, request_key, product_id, entry_id, for_member, item_name, quantity, unit_price_minor, net_minor, tax_minor, total_minor,
                           tax_bp, tax_included, currency, method, sold_on, recorded_by, receipt_number)
    SELECT ${gymId}, gen_random_uuid(), ${product.id}, e.e, true, 'Water', 1, 2500, 2500, 0, 2500, 0, false, 'INR', 'cash',
           (${dayOf(t0)}::date - s), ${owner}, ${first} + (e.i - 1) * ${SALES} + s
    FROM unnest(${entries}::uuid[]) WITH ORDINALITY AS e(e, i), generate_series(0, ${SALES - 1}) AS s`;
  await sql`UPDATE gyms SET receipts_issued = ${first + MEMBERS * SALES} WHERE id = ${gymId}`;
  return { gymId, members };
}

await cleanup();
try {
  const t0 = Date.now();
  const gyms: Gym[] = [];
  for (let n = 0; n < GYMS; n++) gyms.push(await makeGym(n, t0, n === 0));
  const measured = gyms[0];
  if (measured === undefined) throw new Error("no gym was made");
  for (const table of ["gym_held_memberships", "gym_member_bills", "gym_member_payments", "gym_sales", "gym_members", "gym_member_list_entries"]) await sql.unsafe(`ANALYZE ${table}`);

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
      const used = performance.eventLoopUtilization(before).active;
      const stall = delay.max / 1e6;
      // The first run warms the connections and is not counted.
      if (i === 0) continue;
      walls.push(wall);
      busy.push(used);
      stalls.push(stall);
    }
    console.log(`  ${name.padEnd(56)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`);
  };
  const deps = { sql, now: () => new Date(t0) };
  const open = () => Promise.resolve(true);

  const cpu = os.cpus()[0];
  const counts = await sql<{ payments: number; sales: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_member_payments WHERE gym_id = ANY(${gyms.map((g) => g.gymId)}::uuid[])) AS payments,
           (SELECT count(*)::int FROM gym_sales WHERE gym_id = ANY(${gyms.map((g) => g.gymId)}::uuid[])) AS sales`;
  console.log(`measure-my-membership-cost: ${String(GYMS)} gyms of ${String(MEMBERS)} members · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz`);
  console.log(`  in the tables: ${String(counts[0]?.payments ?? 0)} payments, ${String(counts[0]?.sales ?? 0)} sales`);
  const one = measured.members[0] ?? "";
  const answer = await getMyMembership(deps, one, measured.gymId, open);
  const shown = answer?.memberships[0];
  console.log(`  one member's answer: ${String(shown?.payments.length ?? 0)} payments (${String(shown?.olderPeriodsNotShown ?? 0)} older not sent), ${String(answer?.purchases.length ?? 0)} purchases (${String(answer?.purchasesNotShown ?? 0)} older not sent), ${String(JSON.stringify(answer).length)} characters`);

  await measure("one member opening My membership", 10, (i) => getMyMembership(deps, measured.members[i] ?? "", measured.gymId, open));
  await measure("all 200 of the gym opening it at once", 3, () => Promise.all(measured.members.map((m) => getMyMembership(deps, m, measured.gymId, open))));
  const receipt = shown?.payments[0]?.receiptNumber ?? 1;
  await measure("one member opening one of their receipts", 10, () => getMyReceipt(deps, one, measured.gymId, receipt, open));
} finally {
  await cleanup();
  await sql.end();
}
