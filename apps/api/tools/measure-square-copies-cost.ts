// What copying a member's changes to Square costs at full size (ROADMAP 18d-iii-b-ii-b-ii-b-i; CLAUDE.md §4 "Cost at
// full size"). The launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them, each on its own Square
// account in Chicago, every member in Square and every gym adding new members by itself. Square is the test fake,
// which answers at once, so what is measured is ours; Square's own pace is 150 calls a minute for every gym together
// (`SQUARE_MEMBERS_WORK.callsByWorker`). Measured, each the way the worker meets it:
//   - the worker's minute when every gym's list moved on and nobody's details changed (the look at 2,200 + 4,000 rows);
//   - one member's phone changed at the gym of 2,000;
//   - a file imported that changes every phone at the gym of 2,000: every minute until the last is copied;
//   - the same at the 20 small gyms at once (4,000 changes), minute by minute;
//   - the box with 50 members Square would not take, at the gym of 2,000.
// Two numbers each: total, and how long the one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-square-copies-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists and connections, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { accessContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { SQUARE_SCOPES } from "../src/modules/orgs/payments/square.js";
import { adoptUnknown, dueCopies } from "../src/modules/orgs/payments/squareCopiesRepo.js";
import { processSquareMembers, readSquareMembers } from "../src/modules/orgs/payments/squareMembers.js";
import { account, fakeSquare, type Account } from "../test/fakeSquareTerminal.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-square-copies-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const PLAN = "zz_square_copies_cost";
const PREFIX = "sqx-cost-";

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
    SQUARE_APPLICATION_ID: "sq0idp-SQXCOSTAPP1",
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

/** A gym whose every member is in Square and agrees with it, adding new members by itself. */
async function seedGym(people: number, n: number): Promise<Gym> {
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
  const acct = account(`MSQX${String(n)}${randomUUID().slice(0, 6)}`);
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
  await sql`INSERT INTO gym_member_lists (gym_id, version) VALUES (${id}, 1)`;
  // Every member's customer in Square, as the app made it, and the three parts Square agrees with.
  const links = records.map((r, i) => {
    const customerId = `CX${String(n)}x${String(i)}`;
    fake.customer(acct, { id: customerId, given_name: `Person${String(i)}`, family_name: "Cost", email_address: r.email, phone_number: r.phone_e164 });
    return { gym_id: id, entry_id: r.id, environment: "production", account_id: acct.merchantId, customer_id: customerId };
  });
  for (let i = 0; i < links.length; i += 1000) await sql`INSERT INTO gym_square_customers ${sql(links.slice(i, i + 1000))}`;
  await sql`
    UPDATE gym_square_customers c SET copied_name = md5(e.full_name), copied_email = md5(NULLIF(lower(btrim(e.email::text)), '')),
                                      copied_phone = md5(NULLIF(e.phone_e164, '')), copied_at = now()
    FROM gym_member_list_entries e WHERE c.gym_id = ${id} AND e.gym_id = c.gym_id AND e.id = c.entry_id`;
  await sql`
    INSERT INTO gym_square_member_runs (gym_id, environment, account_id, run_id, state, started_by, started_at, checked_at, automatic, added_at, list_version, look_due_at)
    VALUES (${id}, 'production', ${acct.merchantId}, ${randomUUID()}, 'added', ${owner}, now(), now(), true, now(), 1, now() + interval '1 day')`;
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
const once = (name: string, t: { wall: number; js: number }) => {
  console.log(`${name.padEnd(86)} total ${fmt(t.wall)} · thread busy ${fmt(t.js)}`);
};
const many = (name: string, ts: { wall: number; js: number }[]) => {
  console.log(`${name.padEnd(86)} total median ${fmt(median(ts.map((t) => t.wall)))} (worst ${fmt(Math.max(...ts.map((t) => t.wall)))}) · thread busy median ${fmt(median(ts.map((t) => t.js)))}`);
};

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const small: Gym[] = [];
for (let i = 0; i < GYMS; i++) small.push(await seedGym(PEOPLE, i));
const big = await seedGym(BIG, GYMS);
const all = [...small.map((g) => g.id), big.id];
for (const table of ["gym_member_list_entries", "gym_square_customers", "gym_square_member_runs"]) await sql.unsafe(`VACUUM ANALYZE ${table}`);
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}, every member in Square and agreeing with it; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const clock = new Date();
const deps = { sql, square, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, now: () => clock };
const minute = (only: readonly string[] = all) => processSquareMembers(deps, square, only);
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
const moved = async (ids: readonly string[]) => {
  await sql`UPDATE gym_member_lists SET version = version + 1 WHERE gym_id = ANY(${[...ids]}::uuid[])`;
};

// 1. Every list moved on, nobody's details changed: the worker takes ten gyms a minute.
await moved(all);
const looks: { wall: number; js: number }[] = [];
for (let i = 0; i < 3; i++) looks.push(await time(() => minute()));
many(`the worker's minute, 10 gyms' lists moved on, nobody's details changed (3 minutes of 21 gyms)`, looks);

// 1b. The copy step's own two statements at the gym of 2,000, nothing changed.
{
  const at = { gymId: big.id, environment: "production" as const, accountId: big.acct.merchantId };
  const ts: { wall: number; js: number }[] = [];
  for (let i = 0; i < 9; i++) ts.push(await time(() => adoptUnknown(sql, { ...at, now: clock })));
  many(`  adoptUnknown (customers not yet known), at the gym of ${String(BIG)}, none to adopt`, ts);
  const us: { wall: number; js: number }[] = [];
  for (let i = 0; i < 9; i++) us.push(await time(() => dueCopies(sql, { ...at, refusedBefore: clock, after: null, limit: 2 })));
  many(`  dueCopies (who is due), at the gym of ${String(BIG)}, nobody due`, us);
}

// 2. One member's phone at the gym of 2,000.
await sql`UPDATE gym_member_list_entries SET phone_e164 = '+13125559999' WHERE id = (SELECT id FROM gym_member_list_entries WHERE gym_id = ${big.id} ORDER BY id LIMIT 1)`;
await moved([big.id]);
let tally = { copied: 0 };
once(`one member's phone changed, at the gym of ${String(BIG)}`, await time(async () => void (tally = await minute([big.id]))));
console.log(`  copied: ${String(tally.copied)}; Square holds ${String(fake.customersChanged.filter((c) => c.accountId === big.acct.merchantId).length)} change`);

// 3. A file changes every phone at the gym of 2,000.
await sql`
  UPDATE gym_member_list_entries e SET phone_e164 = '+1415' || lpad((7000000 + n.rn)::text, 7, '0')
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM gym_member_list_entries WHERE gym_id = ${big.id}) n
  WHERE e.id = n.id`;
await moved([big.id]);
await sql.unsafe("ANALYZE gym_member_list_entries");
const bulk: { wall: number; js: number }[] = [];
let copiedAll = 0;
for (let i = 0; i < 80; i++) {
  let t = { copied: 0 };
  bulk.push(await time(async () => void (t = await minute([big.id]))));
  copiedAll += t.copied;
  if (t.copied === 0) break;
}
many(`a file changed every phone at the gym of ${String(BIG)}: a worker's minute (${String(bulk.length)} minutes, ${String(copiedAll)} copied)`, bulk);
console.log(`  first minute ${fmt(bulk[0]?.wall ?? 0)} (thread busy ${fmt(bulk[0]?.js ?? 0)}); the last copied minute, number ${String(bulk.length - 1)}`);

// 4. The 20 small gyms at once, 200 phones each.
await sql`
  UPDATE gym_member_list_entries e SET phone_e164 = '+1646' || lpad((8000000 + n.rn)::text, 7, '0')
  FROM (SELECT id, row_number() OVER (PARTITION BY gym_id ORDER BY id) AS rn FROM gym_member_list_entries WHERE gym_id = ANY(${small.map((g) => g.id)}::uuid[])) n
  WHERE e.id = n.id`;
await moved(small.map((g) => g.id));
const spread: { wall: number; js: number }[] = [];
let spreadCopied = 0;
for (let i = 0; i < 80; i++) {
  let t = { copied: 0 };
  spread.push(await time(async () => void (t = await minute(small.map((g) => g.id)))));
  spreadCopied += t.copied;
  if (t.copied === 0) break;
}
many(`every phone changed at the ${String(GYMS)} gyms of ${String(PEOPLE)}: a worker's minute (${String(spread.length)} minutes, ${String(spreadCopied)} copied)`, spread);

// 5. The box with 50 members Square would not take.
await sql`
  UPDATE gym_square_customers SET copy_refused_digest = md5(e.full_name || chr(10) || coalesce(e.email::text, '') || chr(10) || coalesce(e.phone_e164, '')), copy_refused_at = now()
  FROM gym_member_list_entries e
  WHERE gym_square_customers.gym_id = ${big.id} AND e.gym_id = gym_square_customers.gym_id AND e.id = gym_square_customers.entry_id
    AND gym_square_customers.entry_id IN (SELECT id FROM gym_member_list_entries WHERE gym_id = ${big.id} ORDER BY id LIMIT 50)`;
await sql.unsafe("ANALYZE gym_square_customers");
const boxes: { wall: number; js: number }[] = [];
for (let i = 0; i < 9; i++) boxes.push(await time(() => readSquareMembers(deps, big.owner, big.id)));
many(`the box with 50 members Square would not take, at the gym of ${String(BIG)}`, boxes);
console.log(`  not_copied: ${String((await readSquareMembers(deps, big.owner, big.id)).members.groups.not_copied.count)}`);

delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
