// What the Reports page's attendance figures cost to read (ROADMAP 21a-ii; CLAUDE.md §4
// "Cost at full size"). One gym at the biggest size the app sells, 2,000 people on its list
// (--people= for another size) each checking in three days a week for a year, with three
// former records for each of them and 40 classes a week of 20 bookings, beside 19 gyms of
// 200 doing the same: read through the service the route calls.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. Then the big gym's five staff at one moment, and all 20 gyms at once.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-reports-attendance-cost.ts [--people=2000]
//
// --keep leaves the gyms in place for a look at a statement's plan; --clean removes them
// and measures nothing.
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, visits and classes, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { getAttendanceReport, requireReportsReader, type ReportsDeps } from "../src/modules/orgs/reports/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-reports-attendance-cost: DATABASE_URL must be a local database");
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
const CLASS_DAYS = 70;
const CLASSES_A_DAY = 6;
const BOOKINGS_A_CLASS = 20;
const OTHER_GYMS = 19;
const OTHER_PEOPLE = 200;
const RUNS = 20;
const PREFIX = "reports-att-cost-";
if (!Number.isInteger(PEOPLE) || PEOPLE < 1) {
  console.error("measure-reports-attendance-cost: --people= takes a whole number, 1 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
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
  owner: string;
  visits: number;
  classes: number;
}

/** A gym a year into check-in: `people` on its list, three former records for each, every
 *  person checked in three days a week, and classes every day for ten weeks. */
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

  // Everybody on the list three days in seven, at an hour between 06:00 and 21:00.
  const visits: Record<string, unknown>[] = [];
  for (let back = 0; back < VISIT_DAYS; back += 1) {
    const day = dayBack(back);
    for (let i = 0; i < people; i += 1) {
      if ((i + back) % 7 > 2) continue;
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

  // The people who book: app accounts of their own.
  const bookers = Array.from({ length: Math.min(people, 200) }, () => randomUUID());
  await sql`INSERT INTO users ${sql(bookers.map((id) => ({ id, email: `${PREFIX}${id}@example.com`, display_name: "Cost Booker" })))}`;
  const types = Array.from({ length: 8 }, (_, i) => ({ id: randomUUID(), gym_id: gymId, name: `Class ${String(i + 1)}`, minutes: 45, places: i === 7 ? null : 25, colour: "blue", open_gym: false }));
  await sql`INSERT INTO gym_class_types ${sql(types)}`;
  const sessions: Record<string, unknown>[] = [];
  const bookings: Record<string, unknown>[] = [];
  for (let back = 1; back <= CLASS_DAYS; back += 1) {
    const day = dayBack(back);
    for (let c = 0; c < CLASSES_A_DAY; c += 1) {
      const type = types[(back + c) % types.length];
      if (type === undefined) continue;
      const id = randomUUID();
      const minute = 7 * 60 + c * 120;
      sessions.push({
        id,
        gym_id: gymId,
        class_type_id: type.id,
        local_date: day,
        local_start_minute: minute,
        starts_at: new Date(Date.parse(`${day}T00:00:00Z`) + minute * 60_000),
        minutes: 45,
        places: type.places,
        status: "scheduled",
      });
      for (let b = 0; b < Math.min(BOOKINGS_A_CLASS, bookers.length); b += 1) {
        const status = b % 10 === 0 ? "no_show" : b % 10 === 1 ? "booked" : "attended";
        bookings.push({ gym_id: gymId, session_id: id, user_id: bookers[(b + c + back) % bookers.length], request_key: randomUUID(), status, pack_charged: false, booked_at: new Date(now.getTime() - 100 * DAY_MS) });
      }
    }
  }
  for (let i = 0; i < sessions.length; i += 1000) await sql`INSERT INTO gym_class_sessions ${sql(sessions.slice(i, i + 1000))}`;
  for (let i = 0; i < bookings.length; i += 5000) await sql`INSERT INTO gym_class_bookings ${sql(bookings.slice(i, i + 5000))}`;
  return { gymId, owner, visits: visits.length, classes: sessions.length };
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
  for (const table of ["gym_member_list_entries", "gym_attendance", "gym_class_sessions", "gym_class_bookings"]) await sql`ANALYZE ${sql(table)}`;

  const deps: ReportsDeps = { sql, now: () => now };
  const read = async (gym: Made, expectMembers: number): Promise<number> => {
    const { report } = await getAttendanceReport(deps, gym.gymId, await requireReportsReader(deps, gym.owner, gym.gymId));
    if (report.perMember.state !== "ok" || report.perMember.members !== expectMembers) throw new Error(`expected ${String(expectMembers)} members, read ${JSON.stringify(report.perMember)}`);
    if (report.hours.state !== "ok" || report.classes.state !== "ok") throw new Error("a figure is missing");
    return JSON.stringify(report).length;
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
  console.log(`measure-reports-attendance-cost: ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);
  console.log(
    `one gym of ${String(PEOPLE)} on its list with ${String(big.visits)} visits in a year and ${String(big.classes)} classes, beside ${String(OTHER_GYMS)} gyms of ${String(OTHER_PEOPLE)} (${String(others[0]?.visits ?? 0)} visits each)`,
  );
  console.log(`  the answer is ${String(await read(big, PEOPLE))} characters`);
  await measure("the big gym's report, one read", () => read(big, PEOPLE));
  await measure("its 5 staff at the same moment", () => Promise.all(Array.from({ length: 5 }, () => read(big, PEOPLE))));
  await measure("one gym of 200, one read", () => read(others[0] ?? big, others[0] === undefined ? PEOPLE : OTHER_PEOPLE));
  await measure("all 20 gyms at the same moment", () => Promise.all([read(big, PEOPLE), ...others.map((gym) => read(gym, OTHER_PEOPLE))]));
  if (KEEP) console.log(`kept: the big gym is ${big.gymId}`);
} finally {
  if (!KEEP) await cleanup();
  await sql.end({ timeout: 5 });
}
