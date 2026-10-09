// What a member's inbox and the sending job cost (ROADMAP 20a; CLAUDE.md §4 "Cost at full
// size"). The launch shape: 20 gyms of 200 members. One member holds the most an inbox
// read carries: 100 messages of 500 characters.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. Then a whole gym reading at the same moment, and the job at its worst:
// every member of every gym joined today, so each is due a Welcome in one run.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-inbox-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their members, and removes them.
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { GYM_INBOX_MAX, GYM_MESSAGE_BODY_MAX } from "@app/shared";
import { sendDueMessages } from "../src/modules/orgs/messages/send.js";
import { getInbox, markRead, type MessagesDeps } from "../src/modules/orgs/messages/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-inbox-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const PEOPLE = 200;
const RUNS = 10;
const PREFIX = "inbox-cost-";
const PLAN = "zz_inbox_cost";
/** Noon in London, where every gym here is: daytime, so the job sends. */
const NOW = new Date("2031-06-10T11:00:00Z");

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

await cleanup();
// Whatever happens below, the gyms and their members are removed.
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;

  const gymIds: string[] = [];
  let members: string[] = [];
  for (let g = 0; g < GYMS; g++) {
    const gymId = randomUUID();
    gymIds.push(gymId);
    await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
    const people = Array.from({ length: PEOPLE }, (_, i) => {
      const id = randomUUID();
      return { id, email: `${PREFIX}m-${String(i)}-${id}@example.com`, display_name: `Person${String(i)} Cost` };
    });
    await sql`INSERT INTO users ${sql(people)}`;
    // Everybody joined an hour ago: each is due a Welcome.
    await sql`INSERT INTO gym_members ${sql(people.map((p) => ({ gym_id: gymId, user_id: p.id, joined_at: new Date(NOW.getTime() - 3_600_000) })))}`;
    members = people.map((p) => p.id);
  }
  const gymId = gymIds[GYMS - 1] ?? "";
  const full = members[0] ?? "";
  const plain = members[1] ?? "";
  for (const table of ["gym_members", "users", "gyms"]) await sql`ANALYZE ${sql(table)}`;

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  /** One timed run: how long, how long the thread was busy, and its longest stall. */
  const once = async (run: () => Promise<unknown>): Promise<{ wall: number; busy: number; stall: number }> => {
    delay.reset();
    delay.enable();
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    await run();
    const wall = performance.now() - start;
    delay.disable();
    return { wall, busy: performance.eventLoopUtilization(before).active, stall: delay.max / 1e6 };
  };
  const line = (name: string, runs: { wall: number; busy: number; stall: number }[]): void => {
    console.log(
      `  ${name.padEnd(62)} total median ${fmt(median(runs.map((r) => r.wall)))} (worst ${fmt(Math.max(...runs.map((r) => r.wall)))}) · thread busy median ${fmt(median(runs.map((r) => r.busy)))} (worst ${fmt(Math.max(...runs.map((r) => r.busy)))}) · longest stall ${fmt(Math.max(...runs.map((r) => r.stall)))}`,
    );
  };
  const measure = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    const runs = [];
    // The first run warms the connections and is not counted.
    for (let i = 0; i < RUNS + 1; i++) {
      const r = await once(run);
      if (i > 0) runs.push(r);
    }
    line(name, runs);
  };

  const cpu = os.cpus()[0];
  console.log(`measure-inbox-cost: ${String(GYMS)} gyms of ${String(PEOPLE)} · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);

  const log = { info: () => undefined, error: () => undefined };
  // The job, once, at its worst: it cannot be run twice with the same work, so one run.
  const worst = await once(async () => {
    const sent = await sendDueMessages({ sql, log }, { now: NOW, gymIds });
    if (sent.sent !== GYMS * PEOPLE) throw new Error(`expected ${String(GYMS * PEOPLE)} sent, got ${String(sent.sent)}`);
  });
  line(`the job: ${String(GYMS * PEOPLE)} Welcomes in one run (every member new)`, [worst]);
  await measure("the job again: every new member already has theirs", async () => {
    const sent = await sendDueMessages({ sql, log }, { now: new Date(NOW.getTime() + 900_000), gymIds });
    if (sent.sent !== 0) throw new Error("a second run sent something");
  });
  await measure("the job four days on: nobody is new", async () => {
    const sent = await sendDueMessages({ sql, log }, { now: new Date(NOW.getTime() + 4 * 86_400_000), gymIds });
    if (sent.sent !== 0 || sent.gyms !== 0) throw new Error("a later run looked at a gym");
  });

  // One member's inbox filled to what a read carries.
  await sql`
    INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
    SELECT ${gymId}, ${full}, 'milestone', 'fill:' || n, repeat('x', ${GYM_MESSAGE_BODY_MAX}), '2031-06-10', ${NOW}::timestamptz + n * interval '1 second', ${NOW}::timestamptz + interval '30 days'
    FROM generate_series(1, ${GYM_INBOX_MAX + 20}) AS n`;
  await sql`ANALYZE gym_member_messages`;

  const later = new Date(NOW.getTime() + 3_600_000);
  const deps: MessagesDeps = { sql, now: () => later };
  const yes = (): Promise<boolean> => Promise.resolve(true);
  const read = async (who: string, expected: number): Promise<string> => {
    const inbox = await getInbox(deps, who, gymId, yes);
    if (inbox === null || inbox.messages.length !== expected) throw new Error(`expected ${String(expected)} messages, read ${String(inbox?.messages.length)}`);
    return JSON.stringify(inbox);
  };
  console.log(`  the fullest inbox as sent is ${String(Math.round((await read(full, GYM_INBOX_MAX)).length / 1000))} kB`);
  await measure("a usual inbox: one message", () => read(plain, 1));
  await measure(`${String(PEOPLE)} members of one gym reading theirs at the same moment`, () => Promise.all(members.slice(1).map((who) => read(who, 1))));
  await measure(`the fullest inbox: ${String(GYM_INBOX_MAX)} messages of ${String(GYM_MESSAGE_BODY_MAX)}`, () => read(full, GYM_INBOX_MAX));
  await measure("20 members reading the fullest inbox's size at the same moment", () => Promise.all(Array.from({ length: 20 }, () => read(full, GYM_INBOX_MAX))));
  await measure("opening the fullest inbox: marked as read", async () => {
    await sql`UPDATE gym_member_messages SET read_at = NULL WHERE gym_id = ${gymId} AND user_id = ${full}`;
    const left = await markRead(deps, full, gymId, { upTo: later.toISOString() }, yes);
    if (left === null || left.unread !== 0) throw new Error("something was left unread");
  });
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
