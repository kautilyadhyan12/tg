// What raising the price for members already on a line costs at full size (ROADMAP 18w; CLAUDE.md §4 "Cost at full
// size"). The launch shape, 20 gyms of 200 people, with one gym of 2,000 and one of 10,000 beside them; every person
// holds Gold Weekly, a week paid ahead, so a raise with 7 days' notice is emailed today: the most one look can have.
// Measured:
//   - the box before Save, for a gym of 200, 2,000 and 10,000;
//   - Save raising everybody on the line, for the gyms of 2,000 and 10,000;
//   - the hourly look over all 23 gyms writing every email; then a look with all of them written;
//   - a minute of the sender, 120 emails, with an email service that answers at once;
//   - one person's page.
// Two numbers each: total, and how long the one thread is busy and answers nobody. The box, Save and the page are the
// api's thread; the look and the sender the worker's.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-price-raises-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists and memberships, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { applyRaise, previewRaise, queueDuePriceRaises, raisesOfRecord } from "../src/modules/orgs/memberships/priceRaises.js";
import { sendDueRenewalReminders } from "../src/modules/orgs/memberships/renewalReminders.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-price-raises-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
// The largest plan holds 2,000; HUGE=0 measures the launch shape with it alone.
const HUGE = Number(process.env["HUGE"] ?? 10_000);
const RUNS = 9;
const PLAN = "zz_raise_cost";
const PREFIX = "raise-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_renewal_reminders WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_price_raises WHERE gym_id IN (${gyms})`;
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
  owner: string;
  typeId: string;
  first: string;
}

async function seedGym(people: number): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${id}, ${PREFIX + id}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const typeId = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${typeId}, ${id}, 'Gold Weekly', 'recurring', 2500, 'GBP', 1, 'week', 'all_classes')`;
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
  // Begun a week ago, two weeks paid: the payment a week from today is the first at the new price with 7 days' notice,
  // so its email goes today.
  await sql`
    INSERT INTO gym_held_memberships (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 2500, 'GBP', 1, 'week', (now() AT TIME ZONE 'Europe/London')::date - 7, 'active', 2, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  return { id, owner, typeId, first: records[0]?.id ?? "" };
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
const huge = HUGE > 0 ? await seedGym(HUGE) : big;
await sql`VACUUM ANALYZE gym_held_memberships`;
await sql`VACUUM ANALYZE gym_member_list_entries`;
const all = HUGE > 0 ? [...gyms, big, huge] : [...gyms, big];
const ids = all.map((g) => g.id);
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)}, one of ${String(BIG)}${HUGE > 0 ? ` and one of ${String(HUGE)}` : ""}, every person on Gold Weekly; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
const line = (name: string, t: { wall: number; js: number }, more = "") => {
  console.log(`${name.padEnd(52)} total ${fmt(t.wall)} · thread busy ${fmt(t.js)}${more}`);
};
const today = (await sql<{ d: string }[]>`SELECT ((now() AT TIME ZONE 'Europe/London')::date)::text AS d`)[0]?.d ?? "";
// Noon on the gyms' own clock: their morning has begun, whatever hour this is run.
const noon = new Date(`${today}T12:00:00Z`);
const now = () => noon;

for (const [name, gym] of [
  [`the box before Save, a gym of ${String(PEOPLE)}`, gyms[0]],
  [`the box before Save, the gym of ${String(BIG)}`, big],
  ...(HUGE > 0 ? [[`the box before Save, the gym of ${String(HUGE)}`, huge]] : []),
] as [string, Gym][]) {
  const walls: number[] = [];
  const jss: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = await time(() => previewRaise(sql, null, gym.id, gym.typeId, 3000, 7, today, "GBP"));
    walls.push(t.wall);
    jss.push(t.js);
  }
  console.log(`${name.padEnd(52)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}

const heldOf = async (gymId: string): Promise<string[]> => (await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId}`).map((r) => r.id);
let raised = 0;
for (const gym of all) {
  const membershipIds = await heldOf(gym.id);
  const t = await time(async () => {
    raised = await sql.begin((tx) => applyRaise(tx, { gymId: gym.id, typeId: gym.typeId, lineMinor: 3000, noticeDays: 7, membershipIds, emailKey: null, userId: gym.owner, now: noon }));
  });
  if (gym === big || gym === huge) line(`Save raising all ${String(membershipIds.length)} on the line`, t, ` · ${String(raised)} raised`);
}

let queued = 0;
line(
  `the hourly look, all ${String(all.length)} gyms, every one due`,
  await time(async () => {
    queued = await queueDuePriceRaises({ sql, now, gymIds: ids });
  }),
  ` · ${String(queued)} written`,
);
await sql`UPDATE gyms SET price_raises_checked_at = NULL WHERE id = ANY(${ids}::uuid[])`;
line(
  "the next look, every one written already",
  await time(async () => {
    queued = await queueDuePriceRaises({ sql, now, gymIds: ids });
  }),
  ` · ${String(queued)} written`,
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

const walls: number[] = [];
const jss: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const t = await time(() => raisesOfRecord(sql, null, huge.id, huge.first, today));
  walls.push(t.wall);
  jss.push(t.js);
}
console.log(`${"one person's page, its raise".padEnd(52)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);
// KEEP=1 leaves the gyms for a closer look.
if (process.env["KEEP"] !== "1") await cleanup();
await sql.end();
