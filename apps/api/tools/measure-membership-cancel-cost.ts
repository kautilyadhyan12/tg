// What a cancelled membership's bookings, and a class's list of people, cost at full size
// (ROADMAP 17c-iii; CLAUDE.md §4 "Cost at full size"). One gym of 2,100 members
// (--people= for another size), each on its list with a class pack. One of them is booked
// on 60 full classes, each with somebody waiting, so every place freed is handed over.
// Measured: the ask, the cancel, and the staff list of a class of 500 with 100 waiting.
// The numbers that matter are how long the server's one thread answers nobody, and how
// long the gym's own row is held (its other writes wait that long; no other gym's do).
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-membership-cancel-cost.ts [--people=200]
//
// LOCAL DATABASES ONLY: it writes a gym, its people and their bookings, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { getSessionBookings } from "../src/modules/orgs/classes/bookingsService.js";
import { moveHeldMembership } from "../src/modules/orgs/memberships/heldService.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-membership-cancel-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RUNS = 5;
const PLAN = "zz_membership_cancel_cost";
const PREFIX = "membership-cancel-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

const TABLES = ["users", "gym_members", "gym_member_list_entries", "gym_class_sessions", "gym_class_bookings", "gym_held_memberships"];
/** A table filled seconds ago has no statistics, and a plan made without them is not the
 *  one a gym meets (`measure-bookings-cost.ts`). */
async function analyse(): Promise<void> {
  for (const table of TABLES) await sql`VACUUM ANALYZE ${sql(table)}`;
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
const packType = randomUUID();
await sql`
  INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, pack_classes, pack_days, access)
  VALUES (${packType}, ${gymId}, '500 classes', 'pack', 9000, 'GBP', 500, 365, 'all_classes')`;
const people = Array.from({ length: PEOPLE }, () => randomUUID());
const entries = people.map((id, i) => ({
  id: randomUUID(),
  gym_id: gymId,
  full_name: `Person${String(i)} Cost`,
  email: `${PREFIX}l-${String(i)}-${id}@example.com`,
  identity_key: createHash("sha256").update(id).digest("hex"),
  source: "typed",
}));
for (let i = 0; i < people.length; i += 1000) {
  await sql`INSERT INTO users ${sql(people.slice(i, i + 1000).map((id, k) => ({ id, email: `${PREFIX}${String(i + k)}-${id}@example.com`, display_name: `Person${String(i + k)} Cost` })))}`;
  await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
  await sql`INSERT INTO gym_members ${sql(people.slice(i, i + 1000).map((id, k) => ({ gym_id: gymId, user_id: id, joined_at: new Date("2026-01-01T00:00:00Z"), entry_id: entries[i + k]?.id ?? null })))}`;
}
await sql`
  INSERT INTO gym_held_memberships
    (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days, classes_left, starts_on, status, renews)
  SELECT ${gymId}, e.id, ${packType}, gen_random_uuid(), 'pack', 9000, 'GBP', 500, 365, 300, current_date - 10, 'active', false
  FROM gym_member_list_entries e WHERE e.gym_id = ${gymId}`;

const first = people[0];
const firstEntry = entries[0]?.id;
if (first === undefined || firstEntry === undefined) throw new Error("no people");
const [firstHeld] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${firstEntry}`;
if (firstHeld === undefined) throw new Error("no membership");

/** `count` coming classes of `places`, the first 72 hours away, ten minutes apart. */
async function classes(count: number, places: number): Promise<string[]> {
  const typeId = randomUUID();
  await sql`INSERT INTO gym_class_types (id, gym_id, name, minutes, places, colour) VALUES (${typeId}, ${gymId}, ${`Spin ${typeId.slice(0, 8)}`}, 45, ${places}, 'blue')`;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places)
    SELECT ${gymId}, ${typeId}, (now() + ((4320 + n * 10) || ' minutes')::interval)::date, n % 1440,
           now() + ((4320 + n * 10) || ' minutes')::interval, 45, ${places}
    FROM generate_series(0, ${count - 1}) AS n
    RETURNING id`;
  return rows.map((r) => r.id);
}
const book = (sessionIds: string[], who: string[]) => sql`
  INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
  SELECT ${gymId}, s.id, m.user_id, m.entry_id, h.id, 'booked', true, gen_random_uuid(), now()
  FROM unnest(${sessionIds}::uuid[]) AS s(id)
  CROSS JOIN gym_members m JOIN gym_held_memberships h ON h.gym_id = m.gym_id AND h.entry_id = m.entry_id
  WHERE m.gym_id = ${gymId} AND m.user_id = ANY(${who}::uuid[])`;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const deps = { sql, now: () => new Date() };
const delay = monitorEventLoopDelay({ resolution: 1 });

async function measure<T>(name: string, prepare: () => Promise<T>, run: (made: T) => Promise<unknown>): Promise<void> {
  const walls: number[] = [];
  const busy: number[] = [];
  const stalls: number[] = [];
  for (let i = 0; i < RUNS + 1; i++) {
    await sql`DELETE FROM gym_class_bookings WHERE gym_id = ${gymId}`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id = ${gymId}`;
    await sql`UPDATE gym_held_memberships SET status = 'active', cancelled_on = NULL, classes_left = 300 WHERE gym_id = ${gymId}`;
    const made = await prepare();
    await analyse();
    delay.reset();
    delay.enable();
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    await run(made);
    const wall = performance.now() - start;
    delay.disable();
    // The first run warms the connections and is not counted.
    if (i === 0) continue;
    walls.push(wall);
    busy.push(performance.eventLoopUtilization(before).active);
    stalls.push(delay.max / 1e6);
  }
  console.log(
    `${name.padEnd(64)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
  );
}

const BOOKED = Math.min(60, PEOPLE - 1);
/** One person holds the one place of each of `BOOKED` classes; the next person along waits for each. */
const onePersonsClasses = async (): Promise<void> => {
  const ids = await classes(BOOKED, 1);
  await book(ids, [first]);
  await sql`
    INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, status, request_key)
    SELECT ${gymId}, s.id, w.user_id, w.entry_id, 'waitlisted', gen_random_uuid()
    FROM (SELECT id, row_number() OVER (ORDER BY id) AS k FROM unnest(${ids}::uuid[]) AS u(id)) s
    JOIN (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) AS r FROM gym_members
          WHERE gym_id = ${gymId} AND user_id <> ${first}) w ON w.r = s.k`;
};

console.log(`one gym: ${String(PEOPLE)} members, each with a pack; cpu ${String(os.cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`);

await measure(`the ask: cancel a membership with ${String(BOOKED)} classes booked on it`, onePersonsClasses, async () => {
  const answer = await moveHeldMembership(deps, owner, gymId, firstEntry, firstHeld.id, { type: "cancel", when: "today" });
  if (answer.kind !== "bookings" || answer.ending.booked !== BOOKED) throw new Error("it did not ask");
});
await measure(`the cancel: ${String(BOOKED)} bookings ended, each place handed to 1 waiting person`, onePersonsClasses, async () => {
  const answer = await moveHeldMembership(deps, owner, gymId, firstEntry, firstHeld.id, { type: "cancel", when: "today" }, BOOKED);
  if (answer.kind !== "ok") throw new Error("it was not cancelled");
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE gym_id = ${gymId} AND status = 'booked'`;
  if (row?.n !== BOOKED) throw new Error(`${String(row?.n)} places handed over`);
});
await measure("a membership with nothing booked on it, cancelled", () => Promise.resolve(), async () => {
  const answer = await moveHeldMembership(deps, owner, gymId, firstEntry, firstHeld.id, { type: "cancel", when: "today" });
  if (answer.kind !== "ok") throw new Error("it was not cancelled");
});

const IN_CLASS = Math.min(500, Math.floor(PEOPLE / 4));
const IN_LINE = Math.min(100, Math.floor(PEOPLE / 20));
await measure(
  `the Calendar's list: a class of ${String(IN_CLASS)} with ${String(IN_LINE)} waiting`,
  async () => {
    const [id] = await classes(1, IN_CLASS);
    if (id === undefined) throw new Error("no class");
    await book([id], people.slice(0, IN_CLASS));
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, status, request_key)
      SELECT ${gymId}, ${id}, m.user_id, m.entry_id, 'waitlisted', gen_random_uuid()
      FROM gym_members m WHERE m.gym_id = ${gymId} AND m.user_id = ANY(${people.slice(IN_CLASS, IN_CLASS + IN_LINE)}::uuid[])`;
    return id;
  },
  async (id) => {
    const list = await getSessionBookings(deps, owner, gymId, id, () => Promise.resolve(true));
    if (list?.booked.length !== IN_CLASS || list.waitlisted.length !== IN_LINE) throw new Error("not the whole list");
  },
);

await cleanup();
await sql.end({ timeout: 5 });
