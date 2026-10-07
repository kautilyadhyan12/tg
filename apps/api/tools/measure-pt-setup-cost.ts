// What Personal training's list of steps costs to read (ROADMAP 23d; CLAUDE.md §4 "Cost at
// full size"). One gym with 2,100 people on its list (--people= for another size). The
// steps ride on the page's own read of its trainers, so two things are timed in each state:
// the statement this job adds, and the whole read the route makes.
//
//   - a gym made today: nobody on the list, nothing to sell
//   - everybody on the list holding a membership that does NOT include personal training:
//     the slowest "does somebody hold it" can be, since it looks at every person's
//     memberships and finds none
//   - everybody holding one that does
//   - everybody taken off the list
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. Then a hundred staff reading it at the same moment.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-pt-setup-cost.ts [--people=10000]
//
// LOCAL DATABASES ONLY: it writes a gym and its list, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import type { PtSetup } from "@app/shared";
import * as repo from "../src/modules/orgs/pt/repo.js";
import { getTrainers, type PtDeps } from "../src/modules/orgs/pt/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-pt-setup-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RUNS = 20;
const BURST = 100;
const PREFIX = "pt-setup-cost-";
if (!Number.isInteger(PEOPLE) || PEOPLE < 1) {
  console.error("measure-pt-setup-cost: --people= takes a whole number, 1 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_trainers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
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
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;

  const deps: PtDeps = { sql, now: () => new Date() };
  const yes = (): Promise<boolean> => Promise.resolve(true);
  const same = (a: PtSetup | null, b: PtSetup): boolean => a !== null && JSON.stringify(a) === JSON.stringify(b);
  /** The statement this job adds, alone. */
  const added = async (expected: PtSetup): Promise<void> => {
    const setup = await repo.setupOf(sql, gymId, new Date());
    if (!same(setup, expected)) throw new Error(`expected ${JSON.stringify(expected)}, read ${JSON.stringify(setup)}`);
  };
  /** The page's whole read, as the route makes it for whoever runs the timetable. */
  const whole = async (expected: PtSetup): Promise<void> => {
    const list = await getTrainers(deps, owner, gymId, yes);
    if (list === null || !same(list.setup, expected)) throw new Error(`expected ${JSON.stringify(expected)}, read ${JSON.stringify(list?.setup)}`);
  };

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });

  const measure = async (name: string, run: () => Promise<unknown>): Promise<void> => {
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
  };
  const state = async (title: string, expected: PtSetup): Promise<void> => {
    console.log(title);
    await measure("the statement this job adds", () => added(expected));
    await measure("the page's whole read", () => whole(expected));
    await measure(`${String(BURST)} staff at the same moment`, () => Promise.all(Array.from({ length: BURST }, () => whole(expected))));
  };

  const cpu = os.cpus()[0];
  console.log(`measure-pt-setup-cost: ${String(PEOPLE)} people · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);

  const NOTHING: PtSetup = { typeIncludesPt: false, somebodyHoldsIt: false, listHasPeople: false, sessionBooked: false };
  await state("a gym made today: nobody on the list, nothing to sell", NOTHING);

  // Everybody on the list, each holding a membership that does not include personal training.
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
  const typeOf = async (name: string, includesPt: boolean): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, term_count, term_unit, access, covers_all_classes, includes_pt)
      VALUES (${gymId}, ${name}, 'recurring', 4500, 'GBP', 1, 'month', 'all_classes', true, ${includesPt})
      RETURNING id`;
    if (row === undefined) throw new Error("no membership type");
    return row.id;
  };
  const plain = await typeOf("Gold Monthly", false);
  const withPt = await typeOf("Gold with PT", true);
  const hold = async (typeId: string): Promise<void> => {
    await sql`DELETE FROM gym_held_memberships WHERE gym_id = ${gymId}`;
    const rows = entries.map((e) => ({
      gym_id: gymId,
      entry_id: e.id,
      membership_type_id: typeId,
      request_key: randomUUID(),
      kind: "recurring",
      price_minor: 4500,
      currency: "GBP",
      term_count: 1,
      term_unit: "month",
      starts_on: new Date().toISOString().slice(0, 10),
      status: "active",
      renews: true,
    }));
    for (let i = 0; i < rows.length; i += 1000) await sql`INSERT INTO gym_held_memberships ${sql(rows.slice(i, i + 1000))}`;
    await sql`ANALYZE gym_held_memberships`;
  };
  await hold(plain);
  await sql`ANALYZE gym_member_list_entries`;
  await state(`${String(PEOPLE)} people, each holding a membership that does not include it`, {
    typeIncludesPt: true,
    somebodyHoldsIt: false,
    listHasPeople: true,
    sessionBooked: false,
  });

  await hold(withPt);
  await state(`${String(PEOPLE)} people, each holding one that does`, { typeIncludesPt: true, somebodyHoldsIt: true, listHasPeople: true, sessionBooked: false });

  // Everybody taken off the list: both reads of the list look past every former person.
  await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gymId}`;
  await sql`ANALYZE gym_member_list_entries`;
  await state(`everybody taken off the list (${String(PEOPLE)} former people)`, { typeIncludesPt: true, somebodyHoldsIt: false, listHasPeople: false, sessionBooked: false });
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
