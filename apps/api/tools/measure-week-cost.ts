// What Overview's "Last 7 days" box costs to read (ROADMAP 20d-ii; CLAUDE.md §4 "Cost at
// full size"). The At risk tool's gyms (`measure-at-risk-cost.ts`): one of 2,000 people
// on its list (--people= for another size) with three former records for each and a year
// of check-ins three days a week, beside 19 gyms of 200. Here everybody also holds a
// monthly membership, one in five of them unpaid, and one that was cancelled.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. Then the big gym's five staff at one moment, and all 20 gyms at once.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-week-cost.ts [--people=2000]
//
// --keep leaves the gyms in place for a look at a statement's plan; --clean removes them
// and measures nothing.
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, members, memberships and visits, and
// removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { ORG_PRIVILEGES } from "@app/shared";
import { getWeek, type WeekDeps, type WeekReader } from "../src/modules/orgs/week/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-week-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2000 : Number(peopleArg.slice("--people=".length));
const KEEP = process.argv.includes("--keep");
const CLEAN_ONLY = process.argv.includes("--clean");
const FORMER_EACH = 3;
const VISIT_DAYS = 364;
const STOPPED_LATELY = 20;
const STOPPED_LONG_AGO = 150;
const OTHER_GYMS = 19;
const OTHER_PEOPLE = 200;
const RUNS = 20;
const PREFIX = "week-cost-";
if (!Number.isInteger(PEOPLE) || PEOPLE < 1) {
  console.error("measure-week-cost: --people= takes a whole number, 1 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_nudges WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
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
const dayBack = (back: number): string => new Date(now.getTime() - back * DAY_MS).toISOString().slice(0, 10);

interface Made {
  gymId: string;
  visits: number;
  atRisk: number;
}

/** The newest day back this person came in: one in seven stopped 20 days ago and one in
 *  seven 150 days ago; everybody else still comes. */
const stoppedAt = (i: number): number => (i % 7 === 0 ? STOPPED_LATELY : i % 7 === 1 ? STOPPED_LONG_AGO : 0);

/** A gym a year into check-in: `people` on its list, three former records for each, half
 *  of them in the app, every person checked in three days a week until they stopped. */
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
      created_at: new Date(now.getTime() - 400 * DAY_MS),
      former_at: i >= people ? new Date(now.getTime() - 200 * DAY_MS) : null,
    };
  });
  for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;

  // Everybody on the list holds a monthly membership, one in five of them unpaid, and
  // one that was cancelled last year.
  const gold = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${gold}, ${gymId}, 'Gold Monthly', 'recurring', 4500, 'GBP', 1, 'month', 'all_classes')`;
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${gymId}, e.id, ${gold}, gen_random_uuid(), 'recurring', 4500, 'GBP', 1, 'month', current_date - 10, 'active',
           CASE WHEN right(e.full_name, 6) = '0 Cost' OR right(e.full_name, 6) = '5 Cost' THEN 0 ELSE 1 END, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId} AND e.former_at IS NULL`;
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, cancelled_on, paid_periods, renews)
    SELECT ${gymId}, e.id, ${gold}, gen_random_uuid(), 'recurring', 4500, 'GBP', 1, 'month', current_date - 400, 'cancelled', current_date - 340, 1, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId} AND e.former_at IS NULL`;

  // Every second person on the list is in the app, holding their own record.
  const accounts: Record<string, unknown>[] = [];
  const members: Record<string, unknown>[] = [];
  const sentTo: string[] = [];
  for (let i = 0; i < people; i += 2) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const id = randomUUID();
    accounts.push({ id, email: `${PREFIX}${id}@example.com`, display_name: `Person${String(i)} Cost` });
    members.push({ gym_id: gymId, user_id: id, entry_id: entry.id, joined_at: new Date(now.getTime() - 390 * DAY_MS) });
    if (stoppedAt(i) === STOPPED_LATELY && sentTo.length % 2 === 0) sentTo.push(id);
    else if (stoppedAt(i) === STOPPED_LATELY) sentTo.push("");
  }
  for (let i = 0; i < accounts.length; i += 1000) await sql`INSERT INTO users ${sql(accounts.slice(i, i + 1000))}`;
  for (let i = 0; i < members.length; i += 1000) await sql`INSERT INTO gym_members ${sql(members.slice(i, i + 1000))}`;
  // Half of those who stopped lately and are in the app were sent a message three days ago.
  const nudges = sentTo.filter((id) => id !== "").map((id) => ({ gym_id: gymId, user_id: id, sent_by_user_id: owner, preset: "miss_you", created_at: new Date(now.getTime() - 3 * DAY_MS) }));
  for (let i = 0; i < nudges.length; i += 1000) await sql`INSERT INTO gym_nudges ${sql(nudges.slice(i, i + 1000))}`;

  // Three days in seven, until the day they stopped.
  const visits: Record<string, unknown>[] = [];
  let atRisk = 0;
  for (let i = 0; i < people; i += 1) if (stoppedAt(i) === STOPPED_LATELY) atRisk += 1;
  for (let back = 0; back < VISIT_DAYS; back += 1) {
    const day = dayBack(back);
    for (let i = 0; i < people; i += 1) {
      const stopped = stoppedAt(i);
      // The day they stopped is a day they came, so everybody's last visit is known.
      if (back < stopped || (back !== stopped && (i + back) % 7 > 2)) continue;
      const entry = entries[i];
      if (entry === undefined) continue;
      visits.push({
        gym_id: gymId,
        entry_id: entry.id,
        marked_by_user_id: owner,
        day,
        method: "staff",
        hours_status: "hours_unset",
        slot_key: "hours_unset",
        marked_at: new Date(Date.parse(`${day}T06:00:00Z`) + ((i * 7 + back * 13) % 900) * 60_000),
      });
    }
  }
  for (let i = 0; i < visits.length; i += 5000) await sql`INSERT INTO gym_attendance ${sql(visits.slice(i, i + 5000))}`;
  return { gymId, visits: visits.length, atRisk };
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
  for (const table of ["gym_member_list_entries", "gym_attendance", "gym_members", "gym_nudges", "gym_held_memberships", "gym_membership_types", "users"]) await sql`ANALYZE ${sql(table)}`;

  const deps: WeekDeps = { sql, now: () => now };
  // The owner: every part of the box.
  const reader: WeekReader = { timezone: "Europe/London", privileges: ORG_PRIVILEGES };
  const read = async (gym: Made): Promise<string> => {
    const { week } = await getWeek(deps, gym.gymId, reader);
    if (week.atRisk?.count !== gym.atRisk) throw new Error(`expected ${String(gym.atRisk)} at risk, read ${String(week.atRisk?.count ?? null)}`);
    if (week.members === null || week.visits === null || week.paymentDue === null) throw new Error("a part of the box is missing");
    return JSON.stringify(week);
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
  console.log(`measure-week-cost: ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);
  console.log(
    `one gym of ${String(PEOPLE)} on its list with ${String(big.visits)} visits in a year and ${String(big.atRisk)} people at risk, beside ${String(OTHER_GYMS)} gyms of ${String(OTHER_PEOPLE)} (${String(others[0]?.visits ?? 0)} visits and ${String(others[0]?.atRisk ?? 0)} at risk each)`,
  );
  console.log(`  the big gym's answer: ${await read(big)}`);
  await measure("the big gym's box, one read", () => read(big));
  await measure("its 5 staff at the same moment", () => Promise.all(Array.from({ length: 5 }, () => read(big))));
  await measure("one gym of 200, one read", () => read(others[0] ?? big));
  await measure("all 20 gyms at the same moment", () => Promise.all([read(big), ...others.map((gym) => read(gym))]));
  if (KEEP) console.log(`kept: the big gym is ${big.gymId}`);
} finally {
  if (!KEEP) await cleanup();
  await sql.end({ timeout: 5 });
}
