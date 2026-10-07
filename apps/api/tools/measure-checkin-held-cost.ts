// What a check-in costs once it says what the person holds (ROADMAP 23a-ii; CLAUDE.md §4
// "Cost at full size"). One gym of 2,100 people on its list (--people= for another size),
// each with a key tag and the list's own words. Measured twice: with nobody holding a
// membership, and with everybody holding one in use (a quarter of them a pack as well) and
// three that are over.
//
// For each thing the desk and staff do: a key tag read at the desk, twenty read at the same
// moment, staff's search (ten found), staff checking one person in, the live log's first
// read (50 visits) and its poll every 5 seconds with nothing new — and, alone, the read
// this job added to each (what one, ten and fifty people hold). Two numbers each: how long
// it takes, and how long the server's one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-checkin-held-cost.ts [--people=200]
//
// LOCAL DATABASES ONLY: it writes a gym, its list, their memberships and visits, and
// removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { createMemoryRedis } from "../src/redis.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import { findPeople, readLog, scan, staffCheckIn, type CheckinDeps } from "../src/modules/orgs/checkin/service.js";
import { heldOnListOf } from "../src/modules/orgs/memberships/onList.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-checkin-held-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RUNS = 5;
const BURST = 20;
const PLAN = "zz_checkin_held_cost";
const PREFIX = "checkin-held-cost-";
const ZONE = "Europe/London";
if (!Number.isInteger(PEOPLE) || PEOPLE < 200) {
  console.error("measure-checkin-held-cost: --people= takes a whole number, 200 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

/** A table filled seconds ago has no statistics, and a plan made without them is not the
 *  one a gym meets (`measure-bookings-cost.ts`). */
async function analyse(): Promise<void> {
  for (const table of ["users", "gym_staff", "gym_member_list_entries", "gym_held_memberships", "gym_membership_types", "gym_attendance"]) {
    await sql`VACUUM ANALYZE ${sql(table)}`;
  }
}

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const owner = randomUUID();
await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
const gymId = randomUUID();
await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', ${ZONE}, 'GB', ${owner})`;
await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
await sql`
  INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
  VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
const deviceId = randomUUID();
await sql`INSERT INTO gym_checkin_devices (id, gym_id, name, created_by_user_id) VALUES (${deviceId}, ${gymId}, 'Front desk', ${owner})`;
const device = { deviceId, gymId, gymName: "Cost Gym", timezone: ZONE, clockFormat: "24h" as const };
const gold = randomUUID();
const pack = randomUUID();
await sql`
  INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
  VALUES (${gold}, ${gymId}, 'Gold Monthly', 'recurring', 4500, 'GBP', 1, 'month', 'all_classes')`;
await sql`
  INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, pack_classes, pack_days, access, includes_pt)
  VALUES (${pack}, ${gymId}, 'PT 10', 'pack', 30000, 'GBP', 10, 90, 'all_classes', true)`;
// The list's own words on everybody, as a gym that came from a file has them.
const entries = Array.from({ length: PEOPLE }, (_, i) => {
  const id = randomUUID();
  return {
    id,
    gym_id: gymId,
    full_name: `Person${String(i)} Cost`,
    email: `${PREFIX}l-${String(i)}-${id}@example.com`,
    member_number: `T${String(i)}`,
    identity_key: createHash("sha256").update(id).digest("hex"),
    source: "upload",
    status: i % 9 === 0 ? "Expired" : "Active",
    membership_type: i % 4 === 0 ? "Silver" : "Gold",
    payment_status: i % 5 === 0 ? "Unpaid" : "Paid",
  };
});
for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
const idOf = (i: number): string => {
  const entry = entries[i];
  if (entry === undefined) throw new Error(`no person ${String(i)}`);
  return entry.id;
};

/** Everybody given Gold Monthly ten days ago, a fifth of them unpaid; a quarter a pack as
 *  well; and three earlier memberships each that are over. */
async function everybodyHolds(): Promise<void> {
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${gymId}, e.id, ${gold}, gen_random_uuid(), 'recurring', 4500, 'GBP', 1, 'month', current_date - 10, 'active',
           CASE WHEN e.payment_status = 'Unpaid' THEN 0 ELSE 1 END, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId}`;
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days, classes_left, starts_on, status, paid_periods, renews)
    SELECT ${gymId}, e.id, ${pack}, gen_random_uuid(), 'pack', 30000, 'GBP', 10, 90, 7, current_date - 5, 'active', 1, false
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId} AND e.membership_type = 'Silver'`;
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, cancelled_on, paid_periods, renews)
    SELECT ${gymId}, e.id, ${gold}, gen_random_uuid(), 'recurring', 4500, 'GBP', 1, 'month', current_date - 400 + n * 90, 'cancelled', current_date - 340 + n * 90, 1, true
    FROM gym_member_list_entries e, generate_series(0, 2) AS n WHERE e.gym_id = ${gymId}`;
}

/** A desk's key tags are limited to 20 a minute in Redis: each read here gets its own, so
 *  the limit is never what is measured. */
const deps = (): CheckinDeps => ({
  sql,
  redis: createMemoryRedis(),
  now: () => new Date(),
  passKey: null,
  webOrigin: "http://localhost:5173",
  log: { warn: () => undefined },
});
const yes = () => Promise.resolve(true);

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const delay = monitorEventLoopDelay({ resolution: 1 });

/** `run(i)` is given the run's number, so a run that writes a visit names fresh people. */
async function measure(name: string, run: (i: number) => Promise<unknown>): Promise<void> {
  const walls: number[] = [];
  const busy: number[] = [];
  const stalls: number[] = [];
  for (let i = 0; i < RUNS + 1; i++) {
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
    `  ${name.padEnd(48)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
  );
}

/** Everything the desk and staff do, once each. `owes`: what somebody unpaid reads. */
async function everything(owes: string): Promise<void> {
  await sql`DELETE FROM gym_attendance WHERE gym_id = ${gymId}`;
  const today = dayInTz(new Date(), ZONE);
  // Person 5 is unpaid in the list's own words, and holds an unpaid Gold Monthly once
  // everybody holds one.
  await measure("the read added: what 1 person holds", async () => {
    await heldOnListOf(sql, gymId, today, [idOf(5)]);
  });
  await measure("the read added: what 10 people hold", async () => {
    await heldOnListOf(sql, gymId, today, entries.slice(0, 10).map((e) => e.id));
  });
  await measure("the read added: what 50 people hold", async () => {
    await heldOnListOf(sql, gymId, today, entries.slice(0, 50).map((e) => e.id));
  });
  await measure("a key tag read at the desk", async (i) => {
    const answer = await scan(deps(), device, `T${String(i * 5)}`);
    if (answer.result !== "checked_in") throw new Error(`the scan answered ${answer.result}`);
    if (answer.notice.payment !== owes) throw new Error(`the desk said ${String(answer.notice.payment)}`);
  });
  await measure(`${String(BURST)} key tags read at the same moment`, async (i) => {
    const answers = await Promise.all(Array.from({ length: BURST }, (_, n) => scan(deps(), device, `T${String(40 + i * BURST + n)}`)));
    if (answers.some((answer) => answer.result !== "checked_in")) throw new Error("a scan in the burst did not check in");
  });
  await measure("staff search, ten people found", async () => {
    const got = await findPeople(deps(), owner, gymId, "Person1", yes);
    if (got?.people.length !== 10) throw new Error("the search did not find ten");
  });
  await measure("staff check one person in", async (i) => {
    const answer = await staffCheckIn(deps(), owner, gymId, { entryId: idOf(180 + i) }, yes);
    if (answer?.result !== "checked_in") throw new Error("staff's check-in did not check in");
  });
  let newest = "";
  await measure("the live log's first read (50 visits)", async () => {
    const got = await readLog(deps(), owner, gymId, undefined, yes);
    if (got?.log.visits.length !== 50) throw new Error(`the log held ${String(got?.log.visits.length)} visits`);
    if (!got.log.visits.some((visit) => visit.payment === owes)) throw new Error("nobody in the log owes");
    newest = got.log.visits[0]?.markedAt ?? "";
  });
  await measure("the log's poll every 5 seconds, nothing new", async () => {
    // The newest visit is older than the poll's few seconds of overlap by the time this runs.
    const got = await readLog(deps(), owner, gymId, new Date(Date.parse(newest) + 60_000).toISOString(), yes);
    if (got?.log.visits.length !== 0) throw new Error("the poll found visits");
  });
}

console.log(`one gym: ${String(PEOPLE)} people on its list; cpu ${String(os.cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`);
await analyse();
console.log("nobody holds a membership (the list's own words under every name):");
await everything("Unpaid");
await everybodyHolds();
await analyse();
const held = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE gym_id = ${gymId}`;
console.log(`everybody holds one, a quarter a pack as well, and three that are over (${String(held[0]?.n ?? 0)} memberships):`);
await everything("Payment due");

await cleanup();
await sql.end();
