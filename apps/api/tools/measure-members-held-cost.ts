// What the Members list costs at full size once it says what each person holds (ROADMAP
// 23a-i; CLAUDE.md §4 "Cost at full size"). One gym of 2,100 people on its list
// (--people= for another size; a list holds 10,000 at most), each with the list's own
// words. Measured twice: with nobody holding a membership, which is what the page cost
// before plus one empty read, and with everybody holding one in use (a quarter of them a
// pack as well) and three that are over.
//
// For each thing staff do on the page: the header and the Filter's counts, a page of 100
// names, a page under a word filter, a search, Select all under a word filter, Invite's
// count under a word filter, and the download of everybody. Two numbers each: how long it
// takes, and how long the server's one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-members-held-cost.ts [--people=10000]
//
// LOCAL DATABASES ONLY: it writes a gym, its list and their memberships, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { previewInvite } from "../src/modules/orgs/invites/service.js";
import { exportSelected } from "../src/modules/orgs/memberList/exportCsv.js";
import { selectAll } from "../src/modules/orgs/memberList/selection.js";
import { readEntries, readList, type MemberListDeps } from "../src/modules/orgs/memberList/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-members-held-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RUNS = 5;
const PLAN = "zz_members_held_cost";
const PREFIX = "members-held-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
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
  for (const table of ["users", "gym_staff", "gym_member_list_entries", "gym_held_memberships", "gym_membership_types"]) {
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
await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
await sql`
  INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
  VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
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
    identity_key: createHash("sha256").update(id).digest("hex"),
    source: "upload",
    status: i % 9 === 0 ? "Expired" : "Active",
    membership_type: i % 4 === 0 ? "Silver" : "Gold",
    payment_status: i % 5 === 0 ? "Unpaid" : "Paid",
  };
});
for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;

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

const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: url, WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "members-held-cost-secret-0123456789ab", LOG_LEVEL: "error" });
const deps: MemberListDeps = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => new Date(), invites: inviteSettings(config) };
const yes = () => Promise.resolve(true);

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

/** Everything staff do on the page, once each. `due` is the Payment word some rows carry. */
async function page(due: string, expectHeld: boolean): Promise<void> {
  await measure("the header and the Filter's counts", async () => {
    const list = await readList(deps, owner, gymId, yes);
    if (list?.counts.entries !== PEOPLE) throw new Error("not the whole list");
    if (list.paymentStatuses.some((chip) => chip.label === "Payment due") !== expectHeld) throw new Error("the counts are not what was set up");
  });
  await measure("a page of 100 names", async () => {
    const got = await readEntries(deps, owner, gymId, {}, yes);
    if (got?.entries.length !== Math.min(100, PEOPLE)) throw new Error("not a full page");
    if ((got.entries[0]?.held !== null) !== expectHeld) throw new Error("the rows are not what was set up");
  });
  await measure(`a page under a word filter ("${due}")`, async () => {
    const got = await readEntries(deps, owner, gymId, { paymentStatus: due }, yes);
    if (got?.total !== Math.ceil(PEOPLE / 5)) throw new Error(`not a fifth of the list: ${String(got?.total)}`);
  });
  await measure("a search for part of a name", async () => {
    const got = await readEntries(deps, owner, gymId, { query: "son19" }, yes);
    if (got === null || got.total === 0) throw new Error("the search found nobody");
  });
  await measure("Select all under that word filter", async () => {
    const got = await selectAll(deps, owner, gymId, { filter: { paymentStatus: due } }, yes);
    if (got?.count !== Math.ceil(PEOPLE / 5)) throw new Error("not a fifth of the list");
  });
  await measure("Invite's count under that word filter", async () => {
    const got = await previewInvite(deps, owner, gymId, { paymentStatus: due }, yes);
    if (got === null || got.reach + Object.values(got.skipped).reduce((sum, n) => sum + n, 0) !== Math.ceil(PEOPLE / 5)) throw new Error("not a fifth of the list");
  });
  await measure("Download CSV of everybody", async () => {
    const all = await selectAll(deps, owner, gymId, { filter: {} }, yes);
    if (all === null) throw new Error("nothing selected");
    const file = await exportSelected(deps, owner, gymId, { selection: { kind: "all", filter: {}, count: all.count, digest: all.digest } }, yes);
    if (file === null) throw new Error("no file");
    let lines = 0;
    for await (const chunk of file.chunks) lines += chunk.split("\r\n").length - 1;
    if (lines !== PEOPLE + 1) throw new Error(`not everybody: ${String(lines)} lines`);
  });
}

console.log(`one gym: ${String(PEOPLE)} people on its list; cpu ${String(os.cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`);
await analyse();
console.log("nobody holds a membership (the list's own words on every row):");
await page("Unpaid", false);
await everybodyHolds();
await analyse();
const held = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE gym_id = ${gymId}`;
console.log(`everybody holds one, a quarter a pack as well, and three that are over (${String(held[0]?.n ?? 0)} memberships):`);
await page("Payment due", true);

await cleanup();
await sql.end();
