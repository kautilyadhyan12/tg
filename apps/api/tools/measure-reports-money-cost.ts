// What the Reports page's money figures cost to read (ROADMAP 21b-i; CLAUDE.md §4 "Cost at
// full size"). One gym of 2,000 people on its list (--people= for another size) with three
// former records for each, beside 19 gyms of 200. Everybody on a list holds a monthly
// membership a year old with a bill and a payment for each of its twelve months; one in
// five has not paid the newest, and one payment in twenty has a refund noted.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. Then the big gym's five staff at one moment, and all 20 gyms at once.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-reports-money-cost.ts [--people=2000]
//
// --keep leaves the gyms in place for a look at a statement's plan; --clean removes them
// and measures nothing.
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, memberships, bills and payments, and
// removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { reportPeriodKeySchema } from "@app/shared";
import { getMoneyReport, type ReportsDeps } from "../src/modules/orgs/reports/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-reports-money-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2000 : Number(peopleArg.slice("--people=".length));
const periodArg = process.argv.find((a) => a.startsWith("--period="));
/** The period read: twelve months, the widest, unless told. */
const PERIOD = reportPeriodKeySchema.parse(periodArg === undefined ? "12m" : periodArg.slice("--period=".length));
const KEEP = process.argv.includes("--keep");
const CLEAN_ONLY = process.argv.includes("--clean");
const FORMER_EACH = 3;
const MONTHS = 12;
const PRICE = 4500;
const OTHER_GYMS = 19;
const OTHER_PEOPLE = 200;
const RUNS = 20;
const PREFIX = "money-cost-";
if (!Number.isInteger(PEOPLE) || PEOPLE < 1) {
  console.error("measure-reports-money-cost: --people= takes a whole number, 1 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_member_refunds WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
}

const DAY_MS = 86_400_000;
const now = new Date();

interface Made {
  gymId: string;
  people: number;
}

/** A gym a year into its notebook: `people` on its list and three former records for each. */
async function makeGym(people: number): Promise<Made> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;

  const total = people * (1 + FORMER_EACH);
  const entries = Array.from({ length: total }, (_, i) => {
    const id = randomUUID();
    return {
      id,
      gym_id: gymId,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}l-${String(i)}-${id}@example.com`,
      identity_key: createHash("sha256").update(id).digest("hex"),
      source: "upload",
      created_at: new Date(now.getTime() - 500 * DAY_MS),
      // The former records left over the last year, so every month has leavers.
      former_at: i >= people ? new Date(now.getTime() - (20 + (i % 330)) * DAY_MS) : null,
    };
  });
  for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;

  const gold = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${gold}, ${gymId}, 'Gold Monthly', 'recurring', ${PRICE}::int, 'GBP', 1, 'month', 'all_classes')`;
  // Started eleven months and ten days ago: today is in its twelfth month. One in five
  // has not paid that month.
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${gymId}, e.id, ${gold}, gen_random_uuid(), 'recurring', ${PRICE}::int, 'GBP', 1, 'month',
           (current_date - interval '11 months' - interval '10 days')::date, 'active',
           CASE WHEN right(e.full_name, 6) = '0 Cost' OR right(e.full_name, 6) = '5 Cost' THEN ${MONTHS - 1}::int ELSE ${MONTHS}::int END, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId} AND e.former_at IS NULL`;
  await sql`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, status)
    SELECT ${gymId}, h.id, n, ${PRICE}::int, 'GBP', (h.starts_on + make_interval(months => n))::date,
           CASE WHEN n < h.paid_periods THEN 'paid' ELSE 'open' END
    FROM gym_held_memberships h, generate_series(0, ${MONTHS - 1}) AS n
    WHERE h.gym_id = ${gymId}`;
  await sql`
    INSERT INTO gym_member_payments (gym_id, bill_id, amount_minor, currency, method, request_key, paid_on, recorded_by)
    SELECT ${gymId}, b.id, ${PRICE}::int, 'GBP', 'cash', gen_random_uuid(), b.due_on, ${owner}
    FROM gym_member_bills b WHERE b.gym_id = ${gymId} AND b.status = 'paid'`;
  await sql`
    INSERT INTO gym_member_refunds (gym_id, payment_id, amount_minor, currency, method, reason, request_key, refunded_on, recorded_by)
    SELECT ${gymId}, p.id, 1000, 'GBP', 'cash', 'other', gen_random_uuid(), p.paid_on + 3, ${owner}
    FROM gym_member_payments p WHERE p.gym_id = ${gymId} AND p.seq % 20 = 0`;
  return { gymId, people };
}

await cleanup();
if (CLEAN_ONLY) {
  await sql.end({ timeout: 5 });
  process.exit(0);
}
// Whatever happens below, the gyms and what they hold are removed.
try {
  const big = await makeGym(PEOPLE);
  const others: Made[] = [];
  for (let i = 0; i < OTHER_GYMS; i++) others.push(await makeGym(OTHER_PEOPLE));
  for (const table of ["gym_member_list_entries", "gym_held_memberships", "gym_membership_types", "gym_member_bills", "gym_member_payments", "gym_member_refunds", "users"]) {
    await sql`ANALYZE ${sql(table)}`;
  }
  const counts = await sql<{ bills: number; payments: number; refunds: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_member_bills WHERE gym_id = ${big.gymId}) AS bills,
           (SELECT count(*)::int FROM gym_member_payments WHERE gym_id = ${big.gymId}) AS payments,
           (SELECT count(*)::int FROM gym_member_refunds WHERE gym_id = ${big.gymId}) AS refunds`;

  const deps: ReportsDeps = { sql, now: () => now };
  const read = async (gym: Made): Promise<string> => {
    const { report } = await getMoneyReport(deps, gym.gymId, { timezone: "Europe/London" }, PERIOD);
    if (report.state !== "ok") throw new Error(`no figures: ${report.state}`);
    if (report.recurring.memberships !== gym.people) throw new Error(`expected ${String(gym.people)} repeating memberships, read ${String(report.recurring.memberships)}`);
    if (report.owed.people !== gym.people / 5) throw new Error(`expected ${String(gym.people / 5)} people owing, read ${String(report.owed.people)}`);
    return JSON.stringify({ recurring: report.recurring, thisMonth: report.thisMonth, owed: report.owed, lifetimeValue: report.lifetimeValue, months: report.months.length });
  };

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });

  async function measure(name: string, run: () => Promise<unknown>): Promise<void> {
    const walls: number[] = [];
    const busy: number[] = [];
    const stalls: number[] = [];
    for (let i = 0; i < RUNS + 1; i++) {
      delay.reset();
      delay.enable();
      const before = performance.eventLoopUtilization();
      const start = performance.now();
      await run();
      const wall = performance.now() - start;
      delay.disable();
      // The first run warms the connections and is not counted.
      if (i === 0) continue;
      walls.push(wall);
      busy.push(performance.eventLoopUtilization(before).active);
      stalls.push(delay.max / 1e6);
    }
    console.log(
      `  ${name.padEnd(46)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  }

  const cpu = os.cpus()[0];
  console.log(`measure-reports-money-cost: ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);
  console.log(
    `one gym of ${String(PEOPLE)} on its list (${String(counts[0]?.bills ?? 0)} bills, ${String(counts[0]?.payments ?? 0)} payments, ${String(counts[0]?.refunds ?? 0)} refunds) with ${String(PEOPLE * FORMER_EACH)} former records, beside ${String(OTHER_GYMS)} gyms of ${String(OTHER_PEOPLE)}`,
  );
  console.log(`  the big gym's answer: ${await read(big)}`);
  await measure("the big gym's money, one read", () => read(big));
  await measure("its 5 staff at the same moment", () => Promise.all(Array.from({ length: 5 }, () => read(big))));
  await measure("one gym of 200, one read", () => read(others[0] ?? big));
  await measure("all 20 gyms at the same moment", () => Promise.all([read(big), ...others.map((gym) => read(gym))]));
  if (KEEP) console.log(`kept: the big gym is ${big.gymId}`);
} finally {
  if (!KEEP) await cleanup();
  await sql.end({ timeout: 5 });
}
