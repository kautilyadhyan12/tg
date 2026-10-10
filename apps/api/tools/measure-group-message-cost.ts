// What a message to a chosen group costs the server (ROADMAP 20f-i; CLAUDE.md §4 "Cost at
// full size"). One gym at the biggest size the app sells, 2,000 people on its list and in
// the app (--people= for another size), beside 19 gyms of 200: the box and the send, read
// through the service the routes call, with Select all.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-group-message-cost.ts [--people=2000]
//
// LOCAL DATABASES ONLY: it writes gyms, their people and their messages, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import type { MemberListSelection } from "@app/shared";
import { idsMatching, selectionDigest } from "../src/modules/orgs/memberList/selection.js";
import type { MemberListDeps } from "../src/modules/orgs/memberList/service.js";
import { previewGroupMessage, sendGroupMessage } from "../src/modules/orgs/messages/group.js";
import { getInbox } from "../src/modules/orgs/messages/service.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"] ?? "";
const host = URL.canParse(url) ? new URL(url).hostname : "";
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error("measure-group-message-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2000 : Number(peopleArg.slice("--people=".length));
const OTHER_GYMS = 19;
const OTHER_PEOPLE = 200;
const RUNS = 20;
const PREFIX = "group-cost-";
const PLAN = "zz_group_cost_live";
if (!Number.isInteger(PEOPLE) || PEOPLE < 1) {
  console.error("measure-group-message-cost: --people= takes a whole number, 1 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_group_messages WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Gym {
  gymId: string;
  owner: string;
  people: number;
  aMember: string;
}

async function makeGym(people: number): Promise<Gym> {
  const owner = randomUUID();
  const gymId = randomUUID();
  const users = [
    { id: owner, email: `${PREFIX}${owner}@example.com`, display_name: "Cost Owner" },
    ...Array.from({ length: people }, (_, i) => {
      const id = randomUUID();
      return { id, email: `${PREFIX}${id}@example.com`, display_name: `Member${String(i)} Cost` };
    }),
  ];
  for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id, org_type) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner}, 'gym')`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
  const members = users.slice(1);
  const entries = members.map((u, i) => ({
    id: randomUUID(),
    gym_id: gymId,
    full_name: `Member${String(i)} Cost`,
    email: u.email,
    identity_key: createHash("sha256").update(u.id).digest("hex"),
    source: "upload",
  }));
  for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
  const start = Date.now() - 400 * 86_400_000;
  const rows = members.map((u, i) => ({ gym_id: gymId, user_id: u.id, entry_id: entries[i]?.id ?? null, joined_at: new Date(start + i * 60_000) }));
  for (let i = 0; i < rows.length; i += 1000) await sql`INSERT INTO gym_members ${sql(rows.slice(i, i + 1000))}`;
  return { gymId, owner, people, aMember: members[0]?.id ?? owner };
}

try {
  await cleanup();
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'GBP', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const big = await makeGym(PEOPLE);
  const others: Gym[] = [];
  for (let i = 0; i < OTHER_GYMS; i++) others.push(await makeGym(OTHER_PEOPLE));
  await sql`ANALYZE gym_members`;
  await sql`ANALYZE gym_member_list_entries`;
  await sql`ANALYZE users`;

  // Each send is on a day of its own, so the day's three never stop a run.
  let day = 0;
  const deps: MemberListDeps = {
    sql,
    redis: createMemoryRedis(),
    log: { warn: () => undefined },
    now: () => new Date(Date.UTC(2027, 0, 1 + day, 12)),
    invites: null,
  };
  const pass = (): Promise<boolean> => Promise.resolve(true);

  const everybody = async (gym: Gym): Promise<MemberListSelection> => {
    const ids = await idsMatching(deps, gym.gymId, {});
    return { kind: "all", filter: {}, count: ids.length, digest: selectionDigest(gym.gymId, ids) };
  };
  const selections = new Map<string, MemberListSelection>();
  for (const gym of [big, ...others]) selections.set(gym.gymId, await everybody(gym));
  const selectionOf = (gym: Gym): MemberListSelection => {
    const selection = selections.get(gym.gymId);
    if (selection === undefined) throw new Error("no selection");
    return selection;
  };

  const box = async (gym: Gym): Promise<number> => {
    const preview = await previewGroupMessage(deps, gym.owner, gym.gymId, { selection: selectionOf(gym) }, pass);
    if (preview?.sendCount !== gym.people) throw new Error(`the box named ${String(preview?.sendCount)} of ${String(gym.people)}`);
    return JSON.stringify(preview).length;
  };
  const BODY = "We're closed on Monday for the holiday. Back on Tuesday at 6am. ".repeat(4).trim();
  const send = async (gym: Gym): Promise<void> => {
    const done = await sendGroupMessage(deps, gym.owner, gym.gymId, { selection: selectionOf(gym), body: BODY, sendCount: gym.people, key: randomUUID() }, pass);
    if (done?.sent !== gym.people) throw new Error(`sent ${String(done?.sent)} of ${String(gym.people)}`);
  };
  const inbox = async (gym: Gym): Promise<void> => {
    const read = await getInbox({ sql, now: deps.now }, gym.aMember, gym.gymId, pass);
    if (read === null || read.messages.length === 0) throw new Error("an empty inbox");
  };

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });

  async function measure(name: string, run: () => Promise<unknown>, before: () => void = () => undefined): Promise<void> {
    const walls: number[] = [];
    const busy: number[] = [];
    const stalls: number[] = [];
    for (let i = 0; i < RUNS + 1; i++) {
      before();
      delay.reset();
      delay.enable();
      const elu = performance.eventLoopUtilization();
      const start = performance.now();
      await run();
      const wall = performance.now() - start;
      delay.disable();
      // The first run warms the connections and is not counted.
      if (i === 0) continue;
      walls.push(wall);
      busy.push(performance.eventLoopUtilization(elu).active);
      stalls.push(delay.max / 1e6);
    }
    console.log(
      `  ${name.padEnd(48)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  }
  const nextDay = (): void => {
    day += 1;
  };

  const first = others[0] ?? big;
  const cpu = os.cpus()[0];
  console.log(`measure-group-message-cost: ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);
  console.log(`one gym of ${String(PEOPLE)} on its list and in the app beside ${String(OTHER_GYMS)} gyms of ${String(OTHER_PEOPLE)}; a message of ${String(BODY.length)} characters`);
  console.log(`  the big gym's box is ${String(await box(big))} characters`);
  await measure("the big gym's box, everybody selected", () => box(big));
  await measure("the big gym's send to everybody", () => send(big), nextDay);
  await measure("a member's inbox after those sends", () => inbox(big));
  await measure("a gym of 200, the box", () => box(first));
  await measure("a gym of 200, the send", () => send(first), nextDay);
  await measure("all 20 gyms send at the same moment", () => Promise.all([send(big), ...others.map((gym) => send(gym))]), nextDay);
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_messages WHERE gym_id = ${big.gymId}`;
  console.log(`  the big gym's people now hold ${String(rows[0]?.n ?? 0)} message rows`);
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
