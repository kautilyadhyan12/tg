// What a studio's coach costs the server when they open Clients (ROADMAP 4e; CLAUDE.md §4
// "Cost at full size"). One studio at the biggest size the app sells, 2,000 people in the
// app (--people= for another size), beside 19 studios of 200: one page read through the
// service the route calls, as a coach with the trainer's own ticks.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-coach-list-cost.ts [--people=2000]
//
// LOCAL DATABASES ONLY: it writes studios and their people, and removes them.
import { randomBytes, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { listOrgMembers, type OrgsDeps } from "../src/modules/orgs/service.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-coach-list-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2000 : Number(peopleArg.slice("--people=".length));
const OTHER_STUDIOS = 19;
const OTHER_PEOPLE = 200;
const RUNS = 20;
const PREFIX = "coach-cost-";
if (!Number.isInteger(PEOPLE) || PEOPLE < 1) {
  console.error("measure-coach-list-cost: --people= takes a whole number, 1 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
}

async function makeStudio(people: number): Promise<{ gymId: string; coach: string }> {
  const owner = randomUUID();
  const coach = randomUUID();
  const gymId = randomUUID();
  const users = [
    { id: owner, email: `${PREFIX}${owner}@example.com`, display_name: "Cost Owner" },
    { id: coach, email: `${PREFIX}${coach}@example.com`, display_name: "Cost Coach" },
    ...Array.from({ length: people }, (_, i) => {
      const id = randomUUID();
      return { id, email: `${PREFIX}${id}@example.com`, display_name: `Client${String(i)} Cost` };
    }),
  ];
  for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id, org_type) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Studio', 'Europe/London', 'GB', ${owner}, 'studio')`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner'), (${gymId}, ${coach}, 'trainer')`;
  // A minute apart, as people join one at a time: the list's pages are cut on the join time.
  const start = Date.now() - people * 60_000;
  const members = users.slice(2).map((u, i) => ({ gym_id: gymId, user_id: u.id, joined_at: new Date(start + i * 60_000) }));
  for (let i = 0; i < members.length; i += 1000) await sql`INSERT INTO gym_members ${sql(members.slice(i, i + 1000))}`;
  return { gymId, coach };
}

try {
  await cleanup();
  const big = await makeStudio(PEOPLE);
  const others: { gymId: string; coach: string }[] = [];
  for (let i = 0; i < OTHER_STUDIOS; i++) others.push(await makeStudio(OTHER_PEOPLE));
  await sql`ANALYZE gym_members`;

  // The list read asks only the database; the rest is never reached.
  const deps: OrgsDeps = {
    sql,
    redis: createMemoryRedis(),
    randomBytes: (n) => randomBytes(n),
    joinCodes: false,
    invites: null,
    log: { warn: () => undefined },
    onlinePayments: { paddle: false, razorpay: false },
  };

  const page = async (studio: { gymId: string; coach: string }, limit: number, expect: number): Promise<number> => {
    const read = await listOrgMembers(deps, studio.coach, studio.gymId, { limit });
    if (read.items.length !== expect) throw new Error(`expected ${String(expect)} names, read ${String(read.items.length)}`);
    return JSON.stringify(read).length;
  };
  const wholeList = async (studio: { gymId: string; coach: string }): Promise<number> => {
    let cursor: string | undefined;
    let names = 0;
    for (;;) {
      const read = await listOrgMembers(deps, studio.coach, studio.gymId, cursor === undefined ? { limit: 100 } : { limit: 100, cursor });
      names += read.items.length;
      if (read.nextCursor === null) return names;
      cursor = read.nextCursor;
    }
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

  const first = others[0] ?? big;
  const cpu = os.cpus()[0];
  console.log(`measure-coach-list-cost: ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);
  console.log(`one studio of ${String(PEOPLE)} in the app beside ${String(OTHER_STUDIOS)} studios of ${String(OTHER_PEOPLE)}`);
  console.log(`  a page of 50 is ${String(await page(big, 50, Math.min(50, PEOPLE)))} characters`);
  await measure("the big studio's coach, a page of 50", () => page(big, 50, Math.min(50, PEOPLE)));
  await measure("the same, a page of 100", () => page(big, 100, Math.min(100, PEOPLE)));
  await measure("the big studio's whole list, page by page", async () => {
    const names = await wholeList(big);
    if (names !== PEOPLE) throw new Error(`expected ${String(PEOPLE)} names, read ${String(names)}`);
  });
  await measure("a studio of 200, a page of 50", () => page(first, 50, 50));
  await measure("all 20 studios' coaches at the same moment", () =>
    Promise.all([page(big, 50, Math.min(50, PEOPLE)), ...others.map((studio) => page(studio, 50, 50))]),
  );
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
