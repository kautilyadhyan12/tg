// What tidying up members whose membership is over costs (ROADMAP 21c-iii; CLAUDE.md §4
// "Cost at full size"). One gym at the biggest size the app sells, 2,000 people on its list
// (--people= for another size) with three former records for each, beside 19 gyms of 200.
// Everybody holds a membership given in the app; for one in three it is over, so the sign
// counts a third of each list. Read and pressed through the services the routes call.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-member-tidy-cost.ts [--people=2000]
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import type { MemberListSelection } from "@app/shared";
import { previewRemoveSelected, removeSelected } from "../src/modules/orgs/memberList/removeSelected.js";
import { selectAll } from "../src/modules/orgs/memberList/selection.js";
import { readEntries, readList, type MemberListDeps } from "../src/modules/orgs/memberList/service.js";
import { heldAndTidyOf, keepListed } from "../src/modules/orgs/memberList/tidy.js";
import { heldOnListOf } from "../src/modules/orgs/memberships/onList.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-member-tidy-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2000 : Number(peopleArg.slice("--people=".length));
const FORMER_EACH = 3;
const OTHER_GYMS = 19;
const OTHER_PEOPLE = 200;
const RUNS = 20;
const PREFIX = "tidy-cost-";
const PLAN = "zz_tidy_cost";
if (!Number.isInteger(PEOPLE) || PEOPLE < 3) {
  console.error("measure-member-tidy-cost: --people= takes a whole number, 3 or more");
  process.exit(2);
}
const overOf = (people: number): number => Math.floor(people / 3);

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

const DAY_MS = 86_400_000;
const now = new Date();

/** A gym whose list is three years old: `people` on it and `FORMER_EACH` former records
 *  for each. Two in three hold a monthly membership that is paid and running; the third
 *  held one month that ended between 10 and 160 days ago, and the gym's own file names
 *  that membership for them with no later date. */
async function makeGym(people: number): Promise<{ gymId: string; owner: string }> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
  const entries = Array.from({ length: people * (1 + FORMER_EACH) }, (_, i) => {
    const id = randomUUID();
    const listed = new Date(now.getTime() - (200 + ((i * 37) % 900)) * DAY_MS);
    return {
      id,
      gym_id: gymId,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}l-${String(i)}-${id}@example.com`,
      identity_key: createHash("sha256").update(id).digest("hex"),
      source: "upload",
      created_at: listed,
      former_at: i >= people ? new Date(listed.getTime() + ((i * 13) % 30) * DAY_MS) : null,
    };
  });
  for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
  const gold = randomUUID();
  const month = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${gold}, ${gymId}, 'Gold Monthly', 'recurring', 4500, 'GBP', 1, 'month', 'all_classes'),
           (${month}, ${gymId}, '1 Month', 'one_time', 4999, 'GBP', 1, 'month', 'all_classes')`;
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${gymId}, p.id,
           CASE WHEN p.n % 3 = 0 THEN ${month}::uuid ELSE ${gold}::uuid END, gen_random_uuid(),
           CASE WHEN p.n % 3 = 0 THEN 'one_time' ELSE 'recurring' END,
           CASE WHEN p.n % 3 = 0 THEN 4999 ELSE 4500 END, 'GBP', 1, 'month',
           CASE WHEN p.n % 3 = 0 THEN current_date - 42 - (p.n % 150)::int ELSE current_date - 10 END,
           'active', 1, p.n % 3 <> 0
    FROM (SELECT e.id, row_number() OVER (ORDER BY e.id) AS n
          FROM gym_member_list_entries e WHERE e.gym_id = ${gymId} AND e.former_at IS NULL) p`;
  await sql`
    UPDATE gym_member_list_entries e SET membership_type = '1 Month'
    WHERE e.gym_id = ${gymId} AND EXISTS (
      SELECT 1 FROM gym_held_memberships h WHERE h.gym_id = e.gym_id AND h.entry_id = e.id AND h.kind = 'one_time')`;
  return { gymId, owner };
}

await cleanup();
// Whatever happens below, the gyms and their lists are removed.
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (code) DO UPDATE SET active = true`;
  const big = await makeGym(PEOPLE);
  const others: { gymId: string; owner: string }[] = [];
  for (let i = 0; i < OTHER_GYMS; i++) others.push(await makeGym(OTHER_PEOPLE));
  const small = others[0] ?? big;
  await sql`ANALYZE gym_member_list_entries`;
  await sql`ANALYZE gym_held_memberships`;

  const deps: MemberListDeps = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => now, invites: null };
  const yes = () => Promise.resolve(true);
  const today = now.toISOString().slice(0, 10);

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });

  /** `between` puts things back after each run, outside what is measured. */
  async function measure(name: string, run: () => Promise<unknown>, runs = RUNS, between: () => Promise<void> = () => Promise.resolve()): Promise<void> {
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
      await between();
      // The first run warms the connections and is not counted.
      if (i === 0) continue;
      walls.push(wall);
      busy.push(performance.eventLoopUtilization(before).active);
      stalls.push(delay.max / 1e6);
    }
    console.log(
      `  ${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  }

  const sign = async (gym: { gymId: string; owner: string }, people: number): Promise<void> => {
    const list = await readList(deps, gym.owner, gym.gymId, yes);
    if (list?.over.count !== overOf(people)) throw new Error(`expected ${String(overOf(people))} on the sign, read ${String(list?.over.count)}`);
  };
  const page = async (gym: { gymId: string; owner: string }, people: number): Promise<void> => {
    const got = await readEntries(deps, gym.owner, gym.gymId, { membership: "over" }, yes);
    if (got?.total !== overOf(people)) throw new Error(`expected ${String(overOf(people))} on the list, read ${String(got?.total)}`);
  };
  const everybody = async (gym: { gymId: string; owner: string }): Promise<MemberListSelection> => {
    const chosen = await selectAll(deps, gym.owner, gym.gymId, { filter: { membership: "over" } }, yes);
    if (chosen === null) throw new Error("Select all answered nothing");
    return { kind: "all", filter: { membership: "over" }, count: chosen.count, digest: chosen.digest };
  };

  const cpu = os.cpus()[0];
  console.log(`measure-member-tidy-cost: ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each unless said`);
  console.log(
    `one gym of ${String(PEOPLE)} on its list (${String(overOf(PEOPLE))} with a membership that is over) and ${String(PEOPLE * FORMER_EACH)} former records, beside ${String(OTHER_GYMS)} gyms of ${String(OTHER_PEOPLE)}`,
  );

  console.log("Opening Members (the list's numbers, its chips and the sign):");
  await measure("as before this job: the memberships read alone, big gym", () => heldOnListOf(sql, big.gymId, today, null));
  await measure("with this job: the same read, and who is over", () => heldAndTidyOf(sql, big.gymId, today));
  await measure("the big gym, one read", () => sign(big, PEOPLE));
  await measure("its 5 staff at the same moment", () => Promise.all(Array.from({ length: 5 }, () => sign(big, PEOPLE))));
  await measure("one gym of 200, one read", () => sign(small, small === big ? PEOPLE : OTHER_PEOPLE));
  await measure("all 20 gyms at the same moment", () => Promise.all([sign(big, PEOPLE), ...others.map((gym) => sign(gym, OTHER_PEOPLE))]));

  console.log("Review them (one page of the people whose membership is over):");
  await measure("the big gym, one page of names", () => page(big, PEOPLE));
  await measure("one gym of 200, one page of names", () => page(small, small === big ? PEOPLE : OTHER_PEOPLE));
  await measure("all 20 gyms at the same moment", () => Promise.all([page(big, PEOPLE), ...others.map((gym) => page(gym, OTHER_PEOPLE))]));

  console.log(`All in one go, the big gym's ${String(overOf(PEOPLE))}:`);
  await measure("Select all", () => everybody(big));
  const all = await everybody(big);
  await measure("the Remove box", () => previewRemoveSelected(deps, big.owner, big.gymId, { selection: all, onlyOver: true }, yes));
  const box = await previewRemoveSelected(deps, big.owner, big.gymId, { selection: all, onlyOver: true }, yes);
  if (box === null || box.move.length !== overOf(PEOPLE)) throw new Error(`the box would move ${String(box?.move.length)}`);
  await measure(
    "Keep on list, pressed",
    async () => {
      const done = await keepListed(deps, big.owner, big.gymId, { selection: all }, yes);
      if (done?.kept !== overOf(PEOPLE)) throw new Error(`kept ${String(done?.kept)}`);
    },
    5,
    async () => {
      await sql`UPDATE gym_member_list_entries SET kept_listed_held_id = NULL WHERE gym_id = ${big.gymId}`;
    },
  );
  await measure(
    "Remove, pressed",
    async () => {
      const answer = await removeSelected(deps, big.owner, big.gymId, { selection: all, digest: box.digest, acknowledgeLargeChange: true, onlyOver: true }, yes);
      if (answer.kind !== "removed" || answer.removed.moved !== overOf(PEOPLE)) throw new Error(`the press answered ${JSON.stringify(answer).slice(0, 200)}`);
    },
    5,
    async () => {
      await sql`UPDATE gym_member_list_entries SET former_at = NULL, membership_ended_on = NULL WHERE gym_id = ${big.gymId} AND membership_ended_on IS NOT NULL`;
      await sql`DELETE FROM audit_log WHERE gym_id = ${big.gymId}`;
    },
  );

  console.log("One by one, in the big gym:");
  const [one] = await sql<{ id: string }[]>`
    SELECT e.id FROM gym_member_list_entries e
    JOIN gym_held_memberships h ON h.gym_id = e.gym_id AND h.entry_id = e.id AND h.kind = 'one_time'
    WHERE e.gym_id = ${big.gymId} AND e.former_at IS NULL LIMIT 1`;
  if (one === undefined) throw new Error("nobody to remove");
  const single: MemberListSelection = { kind: "ticked", entryIds: [one.id] };
  await measure("the Remove box for one person", () => previewRemoveSelected(deps, big.owner, big.gymId, { selection: single, onlyOver: true }, yes));
  await measure(
    "Keep on list for one person",
    () => keepListed(deps, big.owner, big.gymId, { selection: single }, yes),
    RUNS,
    async () => {
      await sql`UPDATE gym_member_list_entries SET kept_listed_held_id = NULL WHERE gym_id = ${big.gymId} AND id = ${one.id}`;
    },
  );
  await measure(
    "Remove for one person, pressed",
    async () => {
      const mine = await previewRemoveSelected(deps, big.owner, big.gymId, { selection: single, onlyOver: true }, yes);
      if (mine === null) throw new Error("no box");
      const answer = await removeSelected(deps, big.owner, big.gymId, { selection: single, digest: mine.digest, onlyOver: true }, yes);
      if (answer.kind !== "removed" || answer.removed.moved !== 1) throw new Error(`the press answered ${JSON.stringify(answer).slice(0, 200)}`);
    },
    RUNS,
    async () => {
      await sql`UPDATE gym_member_list_entries SET former_at = NULL, membership_ended_on = NULL WHERE gym_id = ${big.gymId} AND id = ${one.id}`;
      await sql`DELETE FROM audit_log WHERE gym_id = ${big.gymId}`;
    },
  );
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
