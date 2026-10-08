// What tags on the Members list cost (ROADMAP 5d-ii; CLAUDE.md §4 "Cost at full size").
// The launch shape: 20 gyms of 200 people, each gym with 99 of its 100 tags and every
// person holding 3 of them; each thing staff do is measured in one gym, on all 200. Then
// one more gym at the biggest size a list can be, 10,000 people, and the same things on
// all 10,000.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. Then a hundred staff reading at the same moment.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-member-tags-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { MEMBER_LIST_MAX_DATA_ROWS, MEMBER_TAGS_MAX_PER_GYM } from "@app/shared";
import { selectAll } from "../src/modules/orgs/memberList/selection.js";
import { readEntries, type MemberListDeps } from "../src/modules/orgs/memberList/service.js";
import { deleteTag, previewTagSelected, readGymTags, renameTag, tagSelected } from "../src/modules/orgs/memberList/tags.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-member-tags-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const PEOPLE = 200;
const RUNS = 20;
const BIG_RUNS = 5;
const BURST = 100;
const PREFIX = "tags-cost-";
const PLAN = "zz_tags_cost";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_tags WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

await cleanup();
// Whatever happens below, the gyms and their lists are removed.
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;

  /** A gym of `people`, with 99 tags and every person holding the first 3. */
  const makeGym = async (people: number): Promise<{ gymId: string; ids: string[] }> => {
    const gymId = randomUUID();
    await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
    const entries = Array.from({ length: people }, (_, i) => {
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
    for (let at = 0; at < entries.length; at += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(at, at + 1000))}`;
    await sql`
      INSERT INTO gym_member_tags (gym_id, name)
      SELECT ${gymId}, 'Tag ' || lpad(n::text, 3, '0') FROM generate_series(1, ${MEMBER_TAGS_MAX_PER_GYM - 1}) AS n`;
    await sql`
      INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id)
      SELECT e.gym_id, e.id, t.id
      FROM gym_member_list_entries e
      CROSS JOIN LATERAL (SELECT id FROM gym_member_tags WHERE gym_id = e.gym_id ORDER BY name LIMIT 3) t
      WHERE e.gym_id = ${gymId}`;
    return { gymId, ids: entries.map((entry) => entry.id) };
  };
  const recount = async (): Promise<void> => {
    for (const table of ["gym_member_tags", "gym_member_entry_tags", "gym_member_list_entries"]) await sql`ANALYZE ${sql(table)}`;
  };

  const deps: MemberListDeps = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => new Date(), invites: null };
  const yes = (): Promise<boolean> => Promise.resolve(true);
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  const measure = async (name: string, runs: number, run: () => Promise<unknown>): Promise<void> => {
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
      // The first run warms the connections and is not counted.
      if (i === 0) continue;
      walls.push(wall);
      busy.push(performance.eventLoopUtilization(before).active);
      stalls.push(delay.max / 1e6);
    }
    console.log(
      `  ${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  };

  /** Everything staff do with tags, in one gym, on all of its people. */
  const measureGym = async (gymId: string, ids: string[], runs: number): Promise<void> => {
    const people = ids.length;
    const tagNamed = async (name: string): Promise<string> => {
      const rows = await sql<{ id: string }[]>`SELECT id FROM gym_member_tags WHERE gym_id = ${gymId} AND name = ${name}`;
      const id = rows[0]?.id;
      if (id === undefined) throw new Error(`no tag ${name}`);
      return id;
    };
    /** A tag everybody holds, and one nobody holds. */
    const held = await tagNamed("Tag 001");
    const free = await tagNamed("Tag 099");
    /** Everybody, as "Select all" sends them: more than 500 cannot be ticked one by one. */
    const everybody = async () => {
      const all = await selectAll(deps, owner, gymId, { filter: {} }, yes);
      if (all === null || all.count !== people) throw new Error("Select all did not choose everybody");
      return { kind: "all" as const, filter: {}, ...all };
    };

    const tags = async (): Promise<void> => {
      const list = await readGymTags(deps, owner, gymId, yes);
      if (list === null || list.length !== MEMBER_TAGS_MAX_PER_GYM - 1 || list[0]?.people !== people) throw new Error("the gym's tags did not come back whole");
    };
    const plainPage = async (): Promise<void> => {
      const got = await readEntries(deps, owner, gymId, {}, yes);
      if (got === null || got.total !== people) throw new Error(`the list held ${String(got?.total)}`);
    };
    const page = async (): Promise<void> => {
      const got = await readEntries(deps, owner, gymId, { tag: held }, yes);
      if (got === null || got.total !== people) throw new Error(`the tag's list held ${String(got?.total)}`);
    };
    const box = async (): Promise<void> => {
      const preview = await previewTagSelected(deps, owner, gymId, { action: "add", selection: await everybody(), tag: { id: free } }, yes);
      if (preview === null || preview.changeCount !== people) throw new Error(`the box counted ${String(preview?.changeCount)}`);
    };
    /** A tag on everybody, then off everybody: two writes, each holding the gym's row. */
    const onAndOff = async (): Promise<void> => {
      const on = await tagSelected(deps, owner, gymId, { action: "add", selection: await everybody(), tag: { id: free } }, yes);
      const off = await tagSelected(deps, owner, gymId, { action: "remove", selection: await everybody(), tagId: free }, yes);
      if (on?.done.changed !== people || off?.done.changed !== people) throw new Error("not everybody changed");
    };
    const renameAndBack = async (): Promise<void> => {
      await renameTag(deps, owner, gymId, held, "Renamed for cost", yes);
      await renameTag(deps, owner, gymId, held, "Tag 001", yes);
    };
    /** A new tag made on everybody, then deleted off them: two writes. */
    const makeAndDelete = async (): Promise<void> => {
      const made = await tagSelected(deps, owner, gymId, { action: "add", selection: await everybody(), tag: { name: "Made for cost" } }, yes);
      if (made?.done.changed !== people) throw new Error("not everybody got the new tag");
      await deleteTag(deps, owner, gymId, made.done.tag.id, people, yes);
    };

    const n = people.toLocaleString("en");
    await measure("the gym's 99 tags with their counts", runs, tags);
    await measure(`${String(BURST)} staff reading that at the same moment`, runs, () => Promise.all(Array.from({ length: BURST }, tags)));
    await measure("one page of the list with no tag asked, to compare", runs, plainPage);
    await measure(`one page of the list shown by a tag all ${n} hold`, runs, page);
    await measure(`${String(BURST)} staff reading that at the same moment`, runs, () => Promise.all(Array.from({ length: BURST }, page)));
    await measure(`Select all ${n}, then the box`, runs, box);
    await measure(`a tag on all ${n}, then off all ${n}`, runs, onAndOff);
    await measure("a tag renamed, then renamed back", runs, renameAndBack);
    await measure(`a new tag made on all ${n}, then deleted`, runs, makeAndDelete);
  };

  let launch = { gymId: "", ids: [] as string[] };
  for (let g = 0; g < GYMS; g++) launch = await makeGym(PEOPLE);
  await recount();
  const cpu = os.cpus()[0];
  console.log(
    `measure-member-tags-cost: ${String(GYMS)} gyms of ${String(PEOPLE)} · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`,
  );
  await measureGym(launch.gymId, launch.ids, RUNS);

  const big = await makeGym(MEMBER_LIST_MAX_DATA_ROWS);
  await recount();
  console.log(`and one gym of ${MEMBER_LIST_MAX_DATA_ROWS.toLocaleString("en")}, the most a list can hold · ${String(BIG_RUNS)} runs each`);
  await measureGym(big.gymId, big.ids, BIG_RUNS);
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
