// What the list of sent messages costs the server (ROADMAP 20f-ii; CLAUDE.md §4 "Cost at
// full size"). One gym of 2,000 people (--people= for another size) that sent three
// messages on every day of a year, the most the app allows, with every person's copy of
// each, beside 19 gyms that sent as many: a page of the list, every page, who one message
// went to, and the hourly
// tidy-up that removes a day's messages with their copies.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. The tidy-up runs in the worker, not the api.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-sent-messages-cost.ts [--people=2000]
//
// LOCAL DATABASES ONLY: it writes gyms, their people and their messages, and removes them.
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { GYM_GROUP_MESSAGES_A_DAY, GYM_SENT_MESSAGES_KEPT_DAYS, GYM_SENT_MESSAGES_PAGE } from "@app/shared";
import type { MemberListDeps } from "../src/modules/orgs/memberList/service.js";
import { forgetOldGroupMessages, readSentMessagePeople, readSentMessages } from "../src/modules/orgs/messages/group.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"] ?? "";
const host = URL.canParse(url) ? new URL(url).hostname : "";
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error("measure-sent-messages-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2000 : Number(peopleArg.slice("--people=".length));
const OTHER_GYMS = 19;
const RUNS = 20;
const PREFIX = "sent-cost-";
const DAY = 86_400_000;
/** The instant the gyms are read at; their newest message is an hour before it. */
const NOW = new Date(Date.UTC(2027, 0, 1, 12));
if (!Number.isInteger(PEOPLE) || PEOPLE < 1) {
  console.error("measure-sent-messages-cost: --people= takes a whole number, 1 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_group_messages WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
}

interface Gym {
  gymId: string;
  owner: string;
  staff: string[];
}

const BODY = "We're closed on Monday for the holiday. Back on Tuesday at 6am. ".repeat(4).trim();

/** A gym with a year of messages, three a day; `people` of them hold a copy of each. */
async function makeGym(people: number): Promise<Gym> {
  const owner = randomUUID();
  const gymId = randomUUID();
  const staff = Array.from({ length: 4 }, () => randomUUID());
  const users = [
    { id: owner, email: `${PREFIX}${owner}@example.com`, display_name: "Cost Owner" },
    ...staff.map((id) => ({ id, email: `${PREFIX}${id}@example.com`, display_name: "Cost Manager" })),
    ...Array.from({ length: people }, (_, i) => {
      const id = randomUUID();
      return { id, email: `${PREFIX}${id}@example.com`, display_name: `Member${String(i)} Cost` };
    }),
  ];
  for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id, org_type) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner}, 'gym')`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  for (const id of staff) await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${id}, 'manager')`;
  const members = users.slice(1 + staff.length).map((u) => ({ gym_id: gymId, user_id: u.id, joined_at: new Date(NOW.getTime() - 500 * DAY) }));
  for (let i = 0; i < members.length; i += 1000) await sql`INSERT INTO gym_members ${sql(members.slice(i, i + 1000))}`;
  const sent = [];
  for (let d = 0; d < GYM_SENT_MESSAGES_KEPT_DAYS; d++) {
    for (let k = 1; k <= GYM_GROUP_MESSAGES_A_DAY; k++) {
      const at = new Date(NOW.getTime() - d * DAY - k * 3_600_000);
      sent.push({ gym_id: gymId, sent_by: owner, body: BODY, gym_day: at.toISOString().slice(0, 10), sent_at: at, people: Math.max(1, people), send_key: randomUUID() });
    }
  }
  for (let i = 0; i < sent.length; i += 500) await sql`INSERT INTO gym_group_messages ${sql(sent.slice(i, i + 500))}`;
  // Every person's copy of every message, a month of messages at a time.
  for (let d = 0; d < GYM_SENT_MESSAGES_KEPT_DAYS; d += 30) {
    await sql`
      INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
      SELECT g.gym_id, m.user_id, 'group', g.id::text, g.body, g.gym_day, g.sent_at, g.sent_at + interval '30 days'
      FROM gym_group_messages g JOIN gym_members m ON m.gym_id = g.gym_id
      WHERE g.gym_id = ${gymId}
        AND g.sent_at <= ${new Date(NOW.getTime() - d * DAY)} AND g.sent_at > ${new Date(NOW.getTime() - (d + 30) * DAY)}`;
  }
  return { gymId, owner, staff };
}

try {
  await cleanup();
  const big = await makeGym(PEOPLE);
  const others: Gym[] = [];
  // The other gyms' people hold no copies: only the big gym's tidy-up is measured at full size.
  for (let i = 0; i < OTHER_GYMS; i++) others.push(await makeGym(0));
  await sql`ANALYZE gym_group_messages`;
  await sql`ANALYZE gym_member_messages`;
  await sql`ANALYZE users`;

  let now = NOW;
  const deps: MemberListDeps = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => now, invites: null };
  const pass = (): Promise<boolean> => Promise.resolve(true);
  const perGym = GYM_SENT_MESSAGES_KEPT_DAYS * GYM_GROUP_MESSAGES_A_DAY;

  const page = async (gym: Gym, who: string, after: string | null): Promise<{ next: string | null; n: number; chars: number }> => {
    const read = await readSentMessages(deps, who, gym.gymId, after === null ? {} : { after }, pass);
    if (read === null) throw new Error("the limit answered");
    return { next: read.next, n: read.messages.length, chars: JSON.stringify(read).length };
  };
  let newest = "";
  const names = async (gym: Gym, who: string): Promise<number> => {
    const got = await readSentMessagePeople(deps, who, gym.gymId, newest, pass);
    if (got === null || got.named !== PEOPLE) throw new Error(`named ${String(got?.named)} of ${String(PEOPLE)}`);
    return JSON.stringify(got).length;
  };
  const everyPage = async (gym: Gym): Promise<number> => {
    let after: string | null = null;
    let seen = 0;
    for (;;) {
      const got = await page(gym, gym.owner, after);
      seen += got.n;
      if (got.next === null) return seen;
      after = got.next;
    }
  };

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });

  async function measure(name: string, run: () => Promise<unknown>, runs: number = RUNS, before: () => void = () => undefined): Promise<void> {
    const walls: number[] = [];
    const busy: number[] = [];
    const stalls: number[] = [];
    for (let i = 0; i < runs + 1; i++) {
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
      `  ${name.padEnd(52)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  }

  const cpu = os.cpus()[0];
  const copies = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_messages WHERE gym_id = ${big.gymId}`;
  console.log(`measure-sent-messages-cost: ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);
  console.log(
    `one gym of ${String(PEOPLE)} with ${String(perGym)} sent messages (${String(GYM_GROUP_MESSAGES_A_DAY)} a day for ${String(GYM_SENT_MESSAGES_KEPT_DAYS)} days) and ${String(copies[0]?.n ?? 0)} copies, beside ${String(OTHER_GYMS)} gyms with ${String(perGym)} each; a message of ${String(BODY.length)} characters`,
  );
  const firstRead = await readSentMessages(deps, big.owner, big.gymId, {}, pass);
  newest = firstRead?.messages[0]?.id ?? "";
  const first = await page(big, big.owner, null);
  if (first.n !== GYM_SENT_MESSAGES_PAGE) throw new Error(`the first page held ${String(first.n)}`);
  console.log(`  a page of ${String(first.n)} is ${String(first.chars)} characters`);
  // A page far down the list: the mark of page 30.
  let deep: string | null = null;
  for (let i = 0; i < 30; i++) deep = (await page(big, big.owner, deep)).next;
  const all = await everyPage(big);
  if (all !== perGym) throw new Error(`every page held ${String(all)} of ${String(perGym)}`);

  await measure("the big gym's first page", () => page(big, big.owner, null));
  await measure("the big gym's page 31", () => page(big, big.owner, deep));
  await measure(`the big gym's whole year, ${String(Math.ceil(perGym / GYM_SENT_MESSAGES_PAGE))} pages one after another`, () => everyPage(big), 5);
  console.log(`  the names of one message, the first 100 of ${String(PEOPLE)}, are ${String(await names(big, big.owner))} characters`);
  await measure("who the big gym's newest message went to", () => names(big, big.owner));
  await measure("its 5 staff open those names at one moment", () => Promise.all([big.owner, ...big.staff].map((who) => names(big, who))));
  await measure("its 5 staff open the page at one moment", () => Promise.all([big.owner, ...big.staff].map((who) => page(big, who, null))));
  await measure("all 20 gyms open the page at one moment", () => Promise.all([big, ...others].map((gym) => page(gym, gym.owner, null))));
  await measure("the hourly tidy-up with nothing to remove", () => forgetOldGroupMessages(sql, NOW));
  // Each run is a day later: every gym's oldest day goes, the big gym's with its copies.
  let removed = { messages: 0, copies: 0 };
  await measure(
    "the tidy-up removing a day of every gym's messages",
    async () => {
      removed = await forgetOldGroupMessages(sql, now);
    },
    5,
    () => {
      now = new Date(now.getTime() + DAY);
    },
  );
  console.log(`  the last tidy-up removed ${String(removed.messages)} messages and ${String(removed.copies)} copies`);
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
