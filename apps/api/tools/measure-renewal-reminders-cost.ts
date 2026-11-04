// What the renewal reminders cost at full size (ROADMAP 18v-iv; CLAUDE.md §4 "Cost at full size"). The launch
// shape, 20 gyms of 200 people, and one gym of 2,000 beside them; every person holds Gold Weekly, whose line asks
// for a reminder 3 days before every renewal, and every one of them renews in two days: the most a morning can
// ever have to write. Measured:
//   - the morning's queue for all 21 gyms, writing every reminder; then a morning with all of them written;
//   - a minute of the sender, 120 emails, with an email service that answers at once;
//   - the line's box for the gym of 2,000, and one person's page.
// Two numbers each: total, and how long the one thread is busy and answers nobody. The queue and the sender are
// the worker's thread; the box and the page are the api's.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-renewal-reminders-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists and memberships, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { previewLine, queueDueRenewalReminders, remindersOfRecord, sendDueRenewalReminders } from "../src/modules/orgs/memberships/renewalReminders.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-renewal-reminders-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 9;
const PLAN = "zz_renewal_cost";
const PREFIX = "renewal-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_renewal_reminders WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Gym {
  id: string;
  typeId: string;
  first: string;
}

async function seedGym(people: number): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  // Noon on the clock below is afternoon in London: the gym's morning has begun.
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${id}, ${PREFIX + id}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const typeId = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access, renewal_reminder, renewal_reminder_days)
    VALUES (${typeId}, ${id}, 'Gold Weekly', 'recurring', 2500, 'GBP', 1, 'week', 'all_classes', 'every_renewal', 3)`;
  const records = Array.from({ length: people }, (_, i) => {
    const entry = randomUUID();
    return {
      id: entry,
      gym_id: id,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}${String(i)}-${entry}@example.com`,
      identity_key: createHash("sha256").update(entry).digest("hex"),
      source: "typed",
    };
  });
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  // Begun five days ago, its first week paid: it renews in two days, inside the three.
  await sql`
    INSERT INTO gym_held_memberships (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 2500, 'GBP', 1, 'week', (now() AT TIME ZONE 'Europe/London')::date - 5, 'active', 1, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  return { id, typeId, first: records[0]?.id ?? "" };
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;

async function time(fn: () => Promise<unknown>): Promise<{ wall: number; js: number }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  await fn();
  const wall = performance.now() - start;
  return { wall, js: performance.eventLoopUtilization(before).active };
}

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'GBP', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const gyms: Gym[] = [];
for (let i = 0; i < GYMS; i++) gyms.push(await seedGym(PEOPLE));
const big = await seedGym(BIG);
await sql`VACUUM ANALYZE gym_held_memberships`;
const ids = [...gyms.map((g) => g.id), big.id];
if (process.env["SEED_ONLY"] === "1") {
  await sql.end();
  process.exit(0);
}
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}, every person's reminder due today; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
const line = (name: string, t: { wall: number; js: number }, more = "") => {
  console.log(`${name.padEnd(52)} total ${fmt(t.wall)} · thread busy ${fmt(t.js)}${more}`);
};
const now = () => new Date();

let queued = 0;
line(
  "the morning's queue, all 21 gyms, every one due",
  await time(async () => {
    queued = await queueDueRenewalReminders({ sql, now, gymIds: ids });
  }),
  ` · ${String(queued)} written`,
);
await sql`UPDATE gyms SET renewal_reminders_checked_on = NULL WHERE id = ANY(${ids}::uuid[])`;
line(
  "a morning with every one written already",
  await time(async () => {
    queued = await queueDueRenewalReminders({ sql, now, gymIds: ids });
  }),
  ` · ${String(queued)} written`,
);
line(
  "a minute when every gym was looked at today",
  await time(async () => {
    queued = await queueDueRenewalReminders({ sql, now, gymIds: ids });
  }),
);

const quiet = { info: () => undefined, warn: () => undefined };
let sent = 0;
line(
  "a minute of the sender, 120 emails",
  await time(async () => {
    const run = await sendDueRenewalReminders({
      sql,
      log: quiet,
      settings: { hmacKey: Buffer.alloc(32, 1), webOrigin: "http://localhost:5173", perDay: 0, paused: false, sender: { from: "Cost <cost@example.test>", apiOrigin: "http://localhost:3000" } },
      sender: { from: "Cost <cost@example.test>", apiOrigin: "http://localhost:3000" },
      transport: { send: () => Promise.resolve({ kind: "sent", id: `re_${randomUUID()}` }) },
      now,
      sleep: () => Promise.resolve(),
      gymIds: ids,
    });
    sent = run.sent;
  }),
  ` · ${String(sent)} sent`,
);

const today = (await sql<{ d: string }[]>`SELECT ((now() AT TIME ZONE 'Europe/London')::date)::text AS d`)[0]?.d ?? "";
for (const [name, fn] of [
  [`the line's box, the gym of ${String(BIG)}`, () => previewLine(sql, null, big.id, big.typeId, { when: "every_renewal", days: 3 }, today)],
  [`the line's box, a gym of ${String(PEOPLE)}`, () => previewLine(sql, null, gyms[0]?.id ?? "", gyms[0]?.typeId ?? "", { when: "every_renewal", days: 3 }, today)],
  ["one person's page, its reminder", () => remindersOfRecord(sql, null, big.id, big.first, today)],
] as [string, () => Promise<unknown>][]) {
  const walls: number[] = [];
  const jss: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = await time(fn);
    walls.push(t.wall);
    jss.push(t.js);
  }
  console.log(`${name.padEnd(52)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}
delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);
// KEEP=1 leaves the gyms for a closer look.
if (process.env["KEEP"] !== "1") await cleanup();
await sql.end();
