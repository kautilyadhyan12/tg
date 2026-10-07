// What Overview's "Start here" list costs to read (ROADMAP 23b; CLAUDE.md §4 "Cost at
// full size"). One gym with 2,100 people on its list (--people= for another size), read
// through the service the route calls, in three states:
//
//   - nothing set up, and nobody on the list
//   - everything set up, everybody on the list
//   - everybody taken OFF the list: the slowest the Members step can be, since it has to
//     look past every former person to find that nobody is left
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. Then a hundred staff reading it at the same moment.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-start-here-cost.ts [--people=10000]
//
// LOCAL DATABASES ONLY: it writes a gym and its list, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { getStartHere, type StartHereDeps } from "../src/modules/orgs/startHere/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-start-here-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RUNS = 20;
const BURST = 100;
const PREFIX = "start-here-cost-";
if (!Number.isInteger(PEOPLE) || PEOPLE < 1) {
  console.error("measure-start-here-cost: --people= takes a whole number, 1 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
}

await cleanup();
// Whatever happens below, the gym and its list are removed.
try {
const owner = randomUUID();
const coach = randomUUID();
await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
await sql`INSERT INTO users (id, email, display_name) VALUES (${coach}, ${`${PREFIX}${coach}@example.com`}, 'Cost Coach')`;
const gymId = randomUUID();
await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;

const deps: StartHereDeps = { sql, now: () => new Date() };
const read = async (expectDone: number): Promise<void> => {
  const { startHere } = await getStartHere(deps, owner, gymId);
  const done = startHere.steps.filter((s) => s.done).length;
  if (startHere.steps.length !== 6 || done !== expectDone) throw new Error(`expected ${String(expectDone)} of 6 done, read ${String(done)} of ${String(startHere.steps.length)}`);
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
    `  ${name.padEnd(44)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
  );
}

const cpu = os.cpus()[0];
console.log(`measure-start-here-cost: ${String(PEOPLE)} people · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);

console.log("a gym made today: nothing set up, nobody on the list");
await measure("one read", () => read(0));
await measure(`${String(BURST)} staff at the same moment`, () => Promise.all(Array.from({ length: BURST }, () => read(0))));

// Everything set up, everybody on the list.
const entries = Array.from({ length: PEOPLE }, (_, i) => {
  const id = randomUUID();
  return {
    id,
    gym_id: gymId,
    full_name: `Person${String(i)} Cost`,
    email: `${PREFIX}l-${String(i)}-${id}@example.com`,
    identity_key: createHash("sha256").update(id).digest("hex"),
    source: "upload",
  };
});
for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
await sql`
  INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
  VALUES (${gymId}, 'Gold Monthly', 'recurring', 4500, 'GBP', 1, 'month', 'all_classes')`;
await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${coach}, 'trainer')`;
const classId = randomUUID();
await sql`INSERT INTO gym_class_types (id, gym_id, name, minutes, places, colour) VALUES (${classId}, ${gymId}, 'Yoga', 60, 20, 'blue')`;
await sql`
  INSERT INTO gym_class_schedules (gym_id, class_type_id, weekdays, local_start_minute, starts_on, minutes, places)
  VALUES (${gymId}, ${classId}, ARRAY[1,3], 1080, current_date, 60, 20)`;
await sql`UPDATE gyms SET hours_mode = 'open_24h' WHERE id = ${gymId}`;
await sql`
  INSERT INTO gym_checkin_devices (gym_id, name, key_hash)
  VALUES (${gymId}, 'Front desk', ${createHash("sha256").update(randomUUID()).digest("hex")})`;
await sql`ANALYZE gym_member_list_entries`;

console.log(`everything set up, ${String(PEOPLE)} people on the list`);
await measure("one read", () => read(6));
await measure(`${String(BURST)} staff at the same moment`, () => Promise.all(Array.from({ length: BURST }, () => read(6))));

// Everybody taken off the list: the Members step looks past every one of them.
await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gymId}`;
await sql`ANALYZE gym_member_list_entries`;
console.log(`everybody taken off the list (${String(PEOPLE)} former people)`);
await measure("one read", () => read(5));
await measure(`${String(BURST)} staff at the same moment`, () => Promise.all(Array.from({ length: BURST }, () => read(5))));
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
