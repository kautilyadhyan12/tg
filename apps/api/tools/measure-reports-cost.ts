// What the Reports page's members figures cost to read (ROADMAP 21a-i; CLAUDE.md §4 "Cost
// at full size"). One gym at the biggest size the app sells, 2,000 people on its list
// (--people= for another size), with three former records for each of them and 1,000
// leads, beside 19 gyms of 200: read through the service the route calls.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. Then the big gym's five staff at one moment, and all 20 gyms at once.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-reports-cost.ts [--people=2000]
//
// LOCAL DATABASES ONLY: it writes gyms, their lists and leads, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { getMembersReport, requireReportsReader, type ReportsDeps } from "../src/modules/orgs/reports/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-reports-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2000 : Number(peopleArg.slice("--people=".length));
const FORMER_EACH = 3;
const LEADS = 1000;
const OTHER_GYMS = 19;
const OTHER_PEOPLE = 200;
const RUNS = 20;
const PREFIX = "reports-cost-";
if (!Number.isInteger(PEOPLE) || PEOPLE < 1) {
  console.error("measure-reports-cost: --people= takes a whole number, 1 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_leads WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
}

const SOURCES = ["walk_in", "website", "social", "friend", "other"];
const DAY_MS = 86_400_000;
const now = new Date();

/** A gym whose list is three years old: `people` on it, `formerEach` former records for
 *  each, spread evenly over the months, and `leads` leads. */
async function makeGym(people: number, formerEach: number, leads: number): Promise<{ gymId: string; owner: string }> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  const total = people * (1 + formerEach);
  const entries = Array.from({ length: total }, (_, i) => {
    const id = randomUUID();
    const listed = new Date(now.getTime() - (30 + ((i * 37) % 1065)) * DAY_MS);
    const former = i >= people;
    return {
      id,
      gym_id: gymId,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}l-${String(i)}-${id}@example.com`,
      identity_key: createHash("sha256").update(id).digest("hex"),
      source: "upload",
      created_at: listed,
      joined_on: i % 2 === 0 ? new Date(listed.getTime() - 400 * DAY_MS).toISOString().slice(0, 10) : null,
      former_at: former ? new Date(listed.getTime() + ((i * 13) % 30) * DAY_MS) : null,
    };
  });
  for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
  const leadRows = Array.from({ length: leads }, (_, i) => ({
    gym_id: gymId,
    full_name: `Lead${String(i)} Cost`,
    email: `${PREFIX}lead-${String(i)}-${gymId}@example.com`,
    source: SOURCES[i % SOURCES.length] ?? "other",
    status: i % 4 === 0 ? "joined" : "new",
  }));
  for (let i = 0; i < leadRows.length; i += 1000) await sql`INSERT INTO gym_leads ${sql(leadRows.slice(i, i + 1000))}`;
  return { gymId, owner };
}

await cleanup();
// Whatever happens below, the gyms and their lists are removed.
try {
  const big = await makeGym(PEOPLE, FORMER_EACH, LEADS);
  const others: { gymId: string; owner: string }[] = [];
  for (let i = 0; i < OTHER_GYMS; i++) others.push(await makeGym(OTHER_PEOPLE, FORMER_EACH, 100));
  await sql`ANALYZE gym_member_list_entries`;
  await sql`ANALYZE gym_leads`;

  const deps: ReportsDeps = { sql, now: () => now };
  const read = async (gym: { gymId: string; owner: string }, expectActive: number): Promise<number> => {
    const { report } = await getMembersReport(deps, gym.gymId, await requireReportsReader(deps, gym.owner, gym.gymId));
    if (report.activeNow !== expectActive) throw new Error(`expected ${String(expectActive)} on the list, read ${String(report.activeNow)}`);
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
  console.log(`measure-reports-cost: ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);
  console.log(
    `one gym of ${String(PEOPLE)} on its list, ${String(PEOPLE * FORMER_EACH)} former records and ${String(LEADS)} leads, beside ${String(OTHER_GYMS)} gyms of ${String(OTHER_PEOPLE)}`,
  );
  console.log(`  the answer is ${String(await read(big, PEOPLE))} characters`);
  await measure("the big gym's report, one read", () => read(big, PEOPLE));
  await measure("its 5 staff at the same moment", () => Promise.all(Array.from({ length: 5 }, () => read(big, PEOPLE))));
  await measure("one gym of 200, one read", () => read(others[0] ?? big, others[0] === undefined ? PEOPLE : OTHER_PEOPLE));
  await measure("all 20 gyms at the same moment", () =>
    Promise.all([read(big, PEOPLE), ...others.map((gym) => read(gym, OTHER_PEOPLE))]),
  );
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
