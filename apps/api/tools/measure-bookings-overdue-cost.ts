// What "no new bookings while a payment is overdue" costs (ROADMAP 17i; CLAUDE.md §4 "Cost at
// full size"). One gym of 2,000 people on its list (--people= for another size) beside 19 gyms
// of 200, the launch shape. In each gym nine in ten hold a paid Gold Monthly and one in ten one
// with a bill ten days overdue; everybody is in the app on their own record, and the gym has
// thirty classes in the coming week.
//
// For each thing staff and members do, with the gym's choice where it starts (nothing extra is
// read) and switched on: a member's week of classes, Book, and the box in Settings naming who
// owes today, and a person's page. Two numbers each: how long it takes, and how long the
// server's one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web2'
//   corepack pnpm --filter api exec tsx tools/measure-bookings-overdue-cost.ts [--people=200]
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, memberships, bills and classes, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { book, createLine, getBookingSettings, getMemberClasses } from "../src/modules/orgs/classes/bookingsService.js";
import { getHeldMemberships } from "../src/modules/orgs/memberships/heldService.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-bookings-overdue-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2000 : Number(peopleArg.slice("--people=".length));
const OTHER_GYMS = 19;
const OTHER_PEOPLE = 200;
const RUNS = 20;
const CLASSES = 30;
const PLAN = "zz_bookings_overdue_cost";
const PREFIX = "bookings-overdue-cost-";
const ZONE = "Europe/London";
if (!Number.isInteger(PEOPLE) || PEOPLE < 200) {
  console.error("measure-bookings-overdue-cost: --people= takes a whole number, 200 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

async function analyse(): Promise<void> {
  for (const table of ["users", "gyms", "gym_staff", "gym_members", "gym_member_list_entries", "gym_held_memberships", "gym_member_bills", "gym_class_sessions", "gym_class_bookings"]) {
    await sql`VACUUM ANALYZE ${sql(table)}`;
  }
}

interface Person {
  userId: string;
  entryId: string;
}
interface Gym {
  id: string;
  owner: string;
  /** Person i owes (i % 10 === 9) or is paid up. */
  people: Person[];
  classes: string[];
}

async function makeGym(size: number): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${id}, ${PREFIX + id}, 'Cost Gym', ${ZONE}, 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const gold = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access, covers_all_classes)
    VALUES (${gold}, ${id}, 'Gold Monthly', 'recurring', 4500, 'GBP', 1, 'month', 'all_classes', true)`;
  const people = Array.from({ length: size }, () => ({ userId: randomUUID(), entryId: randomUUID() }));
  for (let i = 0; i < size; i += 1000) {
    const part = people.slice(i, i + 1000);
    await sql`INSERT INTO gym_member_list_entries ${sql(
      part.map((p, n) => ({
        id: p.entryId,
        gym_id: id,
        full_name: `Person${String(i + n)} Cost`,
        email: `${PREFIX}l-${p.entryId}@example.com`,
        identity_key: createHash("sha256").update(p.entryId).digest("hex"),
        source: "upload",
        status: (i + n) % 10 === 9 ? "owes" : "paid",
      })),
    )}`;
    await sql`INSERT INTO users ${sql(part.map((p) => ({ id: p.userId, email: `${PREFIX}${p.userId}@example.com`, display_name: "Member Cost" })))}`;
    await sql`INSERT INTO gym_members ${sql(part.map((p) => ({ gym_id: id, user_id: p.userId, entry_id: p.entryId })))}`;
  }
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${gold}, gen_random_uuid(), 'recurring', 4500, 'GBP', 1, 'month', current_date - 10, 'active',
           CASE WHEN e.status = 'owes' THEN 0 ELSE 1 END, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  await sql`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to)
    SELECT ${id}, h.id, 0, 4500, 'GBP', h.starts_on, h.starts_on, (h.starts_on + interval '1 month' - interval '1 day')::date
    FROM gym_held_memberships h WHERE h.gym_id = ${id} AND h.paid_periods = 0`;
  const [type] = await sql<{ id: string }[]>`
    INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${id}, 'Spin', 45, NULL, 'blue', false) RETURNING id`;
  if (type === undefined) throw new Error("no class type");
  const classes = await sql<{ id: string }[]>`
    INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
    SELECT ${id}, ${type.id}, (l AT TIME ZONE ${ZONE})::date, (EXTRACT(HOUR FROM l AT TIME ZONE ${ZONE}) * 60 + EXTRACT(MINUTE FROM l AT TIME ZONE ${ZONE}))::int, l, 45, NULL, 'scheduled'
    FROM (SELECT date_trunc('hour', now()) + make_interval(hours => 6 + n * 5) AS l FROM generate_series(0, ${CLASSES - 1}) n) x
    RETURNING id`;
  return { id, owner, people, classes: classes.map((c) => c.id) };
}

const deps = { sql, now: () => new Date(), inLine: createLine() };
const yes = () => Promise.resolve(true);
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const delay = monitorEventLoopDelay({ resolution: 1 });

async function measure(name: string, run: (i: number) => Promise<unknown>, runs = RUNS): Promise<void> {
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
    // The first run warms the connections and is not counted.
    if (i === 0) continue;
    walls.push(wall);
    busy.push(performance.eventLoopUtilization(before).active);
    stalls.push(delay.max / 1e6);
  }
  console.log(
    `  ${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} · longest stall ${fmt(Math.max(...stalls))}`,
  );
}

const refused = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "booked";
  } catch (err) {
    return err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : "error";
  }
};

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const big = await makeGym(PEOPLE);
for (let n = 0; n < OTHER_GYMS; n++) await makeGym(OTHER_PEOPLE);
await analyse();
const paid = (n: number): Person => big.people[n * 10] ?? big.people[0] ?? { userId: "", entryId: "" };
const owes = (n: number): Person => big.people[n * 10 + 9] ?? big.people[9] ?? { userId: "", entryId: "" };
const classOf = (n: number): string => big.classes[n % big.classes.length] ?? "";
const setChoice = (rule: "let_book" | "stop") => sql`UPDATE gyms SET bookings_overdue = ${rule} WHERE id = ${big.id}`;

console.log(
  `one gym of ${String(PEOPLE)} (${String(PEOPLE / 10)} owe) beside ${String(OTHER_GYMS)} of ${String(OTHER_PEOPLE)}; ${String(CLASSES)} classes a week; cpu ${String(os.cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each, medians`,
);
for (const rule of ["let_book", "stop"] as const) {
  await setChoice(rule);
  console.log(rule === "let_book" ? "the choice where every gym starts:" : "Stop new bookings:");
  await measure("a member's week of classes, paid up", (i) => getMemberClasses(deps, paid(i).userId, big.id, { week: 0 }, yes));
  await measure("a member's week of classes, a payment overdue", (i) => getMemberClasses(deps, owes(i).userId, big.id, { week: 0 }, yes));
  await measure("Book, paid up", async (i) => {
    const said = await refused(book(deps, paid(100 + i + (rule === "stop" ? 50 : 0)).userId, big.id, classOf(i), { requestKey: randomUUID(), joinWaitlist: false }, yes));
    if (said !== "booked") throw new Error(`a paid-up Book answered ${said}`);
  });
  await measure("Book, a payment overdue", async (i) => {
    const said = await refused(book(deps, owes(100 + i + (rule === "stop" ? 50 : 0)).userId, big.id, classOf(i), { requestKey: randomUUID(), joinWaitlist: false }, yes));
    if (said !== (rule === "stop" ? "payment_overdue" : "booked")) throw new Error(`an overdue Book answered ${said}`);
  });
  await measure("the person's page, a payment overdue", (i) => getHeldMemberships(deps, big.owner, big.id, owes(i).entryId));
  await measure("Booking rules in Settings, naming who owes", () => getBookingSettings(deps, big.owner, big.id, yes));
}
await cleanup();
await sql.end({ timeout: 5 });
