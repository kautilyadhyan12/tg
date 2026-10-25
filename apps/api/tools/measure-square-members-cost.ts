// What Members in Square costs at full size (ROADMAP 18d-iii-b-ii-b-i; CLAUDE.md §4 "Cost at full size"). The
// launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them, each on its own Square account in
// Chicago. Each gym's Square already has customers: at the gym of 2,000, 5,000 of them, 1,000 with a member's
// email and name (linked), 50 members each twice (left out), and 20 of the linked charged by Square's own
// subscriptions; at the small gyms 400, 100 of them a member's. Square is the test fake, which answers at
// once, so what is measured is ours; Square's own pace is `.cost/18d-iii-b-ii-b-i/probe-customers.mts`'s.
// Measured, each the way the owner or the worker meet it:
//   - the box, before anything, at the gym of 2,000;
//   - the press of Add members to Square, which reads its first pages itself;
//   - the worker's minute that reads the rest and decides for all 2,000;
//   - the box with the check's names, and a page of See all;
//   - the press of Add, which adds its first people itself, and a worker's minute of adding;
//   - the box once added;
//   - the worker's minute with every gym adding new members by itself and nobody new;
//   - the worker's minute looking up 15 new members at the gym of 2,000.
// Two numbers each: total, and how long the one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-square-members-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists and connections, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { accessContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { SQUARE_SCOPES } from "../src/modules/orgs/payments/square.js";
import { addSquareMembers, checkSquareMembers, processSquareMembers, readSquareMembers, readSquareMembersNames } from "../src/modules/orgs/payments/squareMembers.js";
import { account, fakeSquare, type Account } from "../test/fakeSquareTerminal.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-square-members-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 9;
const PLAN = "zz_square_members_cost";
const PREFIX = "sqm-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_square_member_runs WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_square_customers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_payment_connections WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

const fake = fakeSquare();
const square = squareSettings(
  {
    SQUARE_ENV: "production",
    SQUARE_APPLICATION_ID: "sq0idp-SQMCOSTAPP1",
    SQUARE_APPLICATION_SECRET: "sq0csp-COSTSECRET", // dummy, gitleaks:allow
    PAYMENT_TOKENS_KEY: Buffer.alloc(32, 12).toString("base64"), // dummy, gitleaks:allow
    SQUARE_WEBHOOK_SIGNATURE_KEY: undefined,
    SQUARE_WEBHOOK_URL: undefined,
  },
  fake.api,
);
if (square === null) throw new Error("no Square settings");

interface Gym {
  id: string;
  owner: string;
  acct: Account;
}

async function seedGym(people: number, n: number, squareOnly: number, linked: number, twice: number, billed: number): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  await sql`
    INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id)
    VALUES (${id}, ${PREFIX + id}, 'Cost Gym', 'America/Chicago', 'US', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const acct = account(`MSQC${String(n)}${randomUUID().slice(0, 6)}`);
  const exchanged = await fake.api.exchangeCode(fake.allow(acct));
  if (exchanged.kind !== "ok" || square === null) throw new Error("no token");
  const sealed = square.tokens.lock(exchanged.value.access_token, accessContext(id));
  await sql`
    INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency, location_id, location_name,
                                         access_token, refresh_token, access_expires_at, refresh_due_at, connected_by, connected_at, scopes)
    VALUES (${id}, 'square', 'production', 'connected', ${acct.merchantId}, 'Cost Gym', 'US', 'USD', ${acct.locations[0]?.id ?? ""}, 'Main',
            ${sealed}, ${sealed}, now() + interval '30 days', now() + interval '6 days', ${owner}, now(), ${[...SQUARE_SCOPES]}::text[])`;
  const records = Array.from({ length: people }, (_, i) => {
    const entry = randomUUID();
    return {
      id: entry,
      gym_id: id,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}${String(n)}-${String(i)}@example.com`,
      phone_e164: `+1312${String(5_000_000 + i).padStart(7, "0")}`,
      identity_key: createHash("sha256").update(entry).digest("hex"),
      source: "typed",
    };
  });
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  // The business's Square: strangers, members with their email and name, and members twice.
  for (let i = 0; i < squareOnly; i++) fake.customer(acct, { id: `CS${String(n)}x${String(i)}`, given_name: "Cafe", family_name: `Buyer ${String(i)}`, email_address: `${PREFIX}cafe-${String(n)}-${String(i)}@example.com` });
  for (let i = 0; i < linked; i++) {
    const r = records[i];
    if (r === undefined) break;
    fake.customer(acct, { id: `CL${String(n)}x${String(i)}`, given_name: `Person${String(i)}`, family_name: "Cost", email_address: r.email });
    if (i < billed) fake.subscription(acct, `CL${String(n)}x${String(i)}`);
  }
  for (let i = linked; i < linked + twice; i++) {
    const r = records[i];
    if (r === undefined) break;
    for (const k of [1, 2]) fake.customer(acct, { id: `CT${String(n)}x${String(i)}x${String(k)}`, given_name: `Person${String(i)}`, family_name: "Cost", email_address: r.email });
  }
  return { id, owner, acct };
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
const many = (name: string, ts: { wall: number; js: number }[]) => {
  console.log(`${name.padEnd(78)} total median ${fmt(median(ts.map((t) => t.wall)))} (worst ${fmt(Math.max(...ts.map((t) => t.wall)))}) · thread busy median ${fmt(median(ts.map((t) => t.js)))}`);
};
const once = (name: string, t: { wall: number; js: number }) => {
  console.log(`${name.padEnd(78)} total ${fmt(t.wall)} · thread busy ${fmt(t.js)}`);
};
const runs = async (fn: (i: number) => Promise<unknown>, n = RUNS) => {
  const out: { wall: number; js: number }[] = [];
  for (let i = 0; i < n; i++) out.push(await time(() => fn(i)));
  return out;
};

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const gyms: Gym[] = [];
for (let i = 0; i < GYMS; i++) gyms.push(await seedGym(PEOPLE, i, 300, 100, 0, 0));
const big = await seedGym(BIG, GYMS, 5000, 1000, 50, 20);
const all = [...gyms.map((g) => g.id), big.id];
for (const table of ["gym_member_list_entries", "gym_square_customers", "gym_member_cards"]) await sql.unsafe(`VACUUM ANALYZE ${table}`);
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} (Square: 400 customers, 100 of them members) and one of ${String(BIG)} (Square: 6,100 customers, 1,000 members, 50 members twice, 20 charged by Square's own subscriptions); cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const clock = new Date();
const deps = { sql, square, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, now: () => clock };
const minute = (only: readonly string[] = all) => processSquareMembers(deps, square, only);
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();

many(`the box, before anything, at the gym of ${String(BIG)}`, await runs(() => readSquareMembers(deps, big.owner, big.id)));
once(`the press of Add members to Square (its first 20 pages), at the gym of ${String(BIG)}`, await time(() => checkSquareMembers(deps, big.owner, big.id)));
let minutes = 0;
for (;;) {
  const t = await time(() => minute([big.id]));
  minutes += 1;
  const state = (await readSquareMembers(deps, big.owner, big.id)).members.state;
  once(`  a worker's minute of the check (minute ${String(minutes)}), state now ${state}`, t);
  if (state !== "checking" || minutes > 10) break;
}
const checked = (await readSquareMembers(deps, big.owner, big.id)).members;
console.log(
  `  the check: add ${String(checked.groups.add.count)}, link ${String(checked.groups.link.count)}, left out ${String(checked.groups.several_customers.count + checked.groups.several_people.count)}, charged by Square ${String(checked.groups.billed.count)}`,
);
many(`the box with the check's names, at the gym of ${String(BIG)}`, await runs(() => readSquareMembers(deps, big.owner, big.id)));
many(`a page of See all (50 names), the last, at the gym of ${String(BIG)}`, await runs(() => readSquareMembersNames(deps, big.owner, big.id, { group: "add", from: 900 })));
once(`the press of Add (its first 20 people), at the gym of ${String(BIG)}`, await time(() => addSquareMembers(deps, big.owner, big.id, checked.runId ?? "")));
const adding: { wall: number; js: number }[] = [];
for (let i = 0; i < 40; i++) {
  adding.push(await time(() => minute([big.id])));
  if ((await readSquareMembers(deps, big.owner, big.id)).members.state === "added") break;
}
many(`a worker's minute of adding (150 calls), at the gym of ${String(BIG)} (${String(adding.length)} minutes)`, adding);
for (const table of ["gym_member_list_entries", "gym_square_customers", "gym_square_member_plan"]) await sql.unsafe(`ANALYZE ${table}`);
many(`the box once added, at the gym of ${String(BIG)}`, await runs(() => readSquareMembers(deps, big.owner, big.id)));
if (process.env["EXPLAIN"] === "1") {
  const [conn] = await sql<{ account_id: string }[]>`SELECT account_id FROM gym_payment_connections WHERE gym_id = ${big.id}`;
  const plan = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) SELECT e.id FROM gym_member_list_entries e
    LEFT JOIN gym_square_member_plan p ON p.gym_id = e.gym_id AND p.environment = 'production' AND p.entry_id = e.id
    WHERE e.gym_id = '${big.id}' AND e.former_at IS NULL AND NOT EXISTS (SELECT 1 FROM gym_square_customers c
      WHERE c.gym_id = e.gym_id AND c.entry_id = e.id AND c.environment = 'production' AND c.account_id = '${conn?.account_id ?? ""}' AND c.customer_id IS NOT NULL)`);
  for (const row of plan) console.log(`  ${String(Object.values(row)[0])}`);
}
const done = (await readSquareMembers(deps, big.owner, big.id)).members;
console.log(`  in Square ${String(done.inSquare)} of ${String(done.members)}; made at Square ${String(fake.customersMade.filter((c) => c.accountId === big.acct.merchantId).length)}`);

// Every small gym checked and added too, so every gym adds new members by itself.
for (const g of gyms) {
  const c = await checkSquareMembers(deps, g.owner, g.id);
  if (c.members.state === "checked") await addSquareMembers(deps, g.owner, g.id, c.members.runId ?? "");
}
for (let i = 0; i < 60; i++) {
  await minute();
  const states = await sql<{ state: string; n: number }[]>`SELECT state, count(*)::int AS n FROM gym_square_member_runs WHERE gym_id = ANY(${all}::uuid[]) GROUP BY state`;
  if (states.every((s) => s.state === "added")) break;
}
await minute();
for (const table of ["gym_member_list_entries", "gym_square_customers", "gym_square_member_plan", "gym_square_member_runs"]) await sql.unsafe(`VACUUM ANALYZE ${table}`);
many(`the worker's minute, every gym adding new members by itself, nobody new`, await runs(() => minute()));

// 15 new members at the gym of 2,000, as staff add them on Members.
const fresh = Array.from({ length: 15 }, (_, i) => {
  const entry = randomUUID();
  return { id: entry, gym_id: big.id, full_name: `New${String(i)} Member`, email: `${PREFIX}new-${String(i)}@example.com`, identity_key: createHash("sha256").update(entry).digest("hex"), source: "typed" };
});
await sql`INSERT INTO gym_member_list_entries ${sql(fresh)}`;
await sql`INSERT INTO gym_member_lists (gym_id, version) VALUES (${big.id}, 1) ON CONFLICT (gym_id) DO UPDATE SET version = gym_member_lists.version + 1`;
once(`the worker's minute looking up 15 new members, at the gym of ${String(BIG)}`, await time(() => minute()));

delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
