// What Delete permanently costs about Square at full size (ROADMAP 18d-iii-b-ii-b-ii-b-ii; CLAUDE.md §4 "Cost at full size"). The
// launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them (1,000 of them past members), each on its own Square
// account, every member in Square with a customer the app made. Square is the test fake, which answers at once, so what is measured
// is ours; Square's own pace is its own. Measured, each the way the app meets it:
//   - the Delete permanently box for the most one press may delete (200 past members) at the gym of 2,000;
//   - the press for those 200, with their customers in Square and, as a control, the same press at a gym with none;
//   - the worker's minute that sends them (40 a minute), every minute until the last is sent;
//   - the same minute with the 20 small gyms' 4,000 customers owed at once;
//   - a minute with 4,000 owed and none of them due.
// Two numbers each: total, and how long the one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-square-deletes-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists and connections, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { MEMBER_LIST_DELETE_MAX } from "@app/shared";
import { deleteSelected, previewDeleteSelected } from "../src/modules/orgs/memberList/deleteSelected.js";
import type { MemberListDeps } from "../src/modules/orgs/memberList/service.js";
import { accessContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { SQUARE_SCOPES } from "../src/modules/orgs/payments/square.js";
import { sendOwedCustomerDeletes } from "../src/modules/orgs/payments/squareDeletes.js";
import { account, fakeSquare, type Account } from "../test/fakeSquareTerminal.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-square-deletes-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const PAST_AT_BIG = 1000;
const PLAN = "zz_square_deletes_cost";
const PREFIX = "sqd-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_square_customer_deletes WHERE gym_id IN (${gyms})`;
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
    SQUARE_APPLICATION_ID: "sq0idp-SQDCOSTAPP1",
    SQUARE_APPLICATION_SECRET: "sq0csp-COSTSECRET", // dummy, gitleaks:allow
    PAYMENT_TOKENS_KEY: Buffer.alloc(32, 15).toString("base64"), // dummy, gitleaks:allow
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
  entryIds: string[];
}

/** A gym with `people` records, the first `past` of them past members, every one with a customer in Square the app made (`inSquare`). */
async function seedGym(people: number, past: number, n: number, inSquare: boolean): Promise<Gym> {
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
  const acct = account(`MSQD${String(n)}${randomUUID().slice(0, 6)}`);
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
      former_at: i < past ? new Date() : null,
    };
  });
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  await sql`INSERT INTO gym_member_lists (gym_id, version) VALUES (${id}, 1)`;
  if (inSquare) {
    const links = records.map((r, i) => {
      const customerId = `CX${String(n)}x${String(i)}`;
      fake.customer(acct, { id: customerId, given_name: `Person${String(i)}`, family_name: "Cost", email_address: r.email, phone_number: r.phone_e164, reference_id: r.id, creation_source: "THIRD_PARTY" });
      return { gym_id: id, entry_id: r.id, environment: "production", account_id: acct.merchantId, customer_id: customerId, made_as: r.id };
    });
    for (let i = 0; i < links.length; i += 1000) await sql`INSERT INTO gym_square_customers ${sql(links.slice(i, i + 1000))}`;
  }
  return { id, owner, acct, entryIds: records.filter((r) => r.former_at !== null).map((r) => r.id) };
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
async function time<T>(fn: () => Promise<T>): Promise<{ wall: number; js: number; value: T }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  const value = await fn();
  const wall = performance.now() - start;
  return { wall, js: performance.eventLoopUtilization(before).active, value };
}
const once = (name: string, t: { wall: number; js: number }) => {
  console.log(`${name.padEnd(92)} total ${fmt(t.wall)} · thread busy ${fmt(t.js)}`);
};
const many = (name: string, ts: { wall: number; js: number }[]) => {
  console.log(`${name.padEnd(92)} total median ${fmt(median(ts.map((t) => t.wall)))} (worst ${fmt(Math.max(...ts.map((t) => t.wall)))}) · thread busy median ${fmt(median(ts.map((t) => t.js)))}`);
};

const redis = {
  incrWithTtl: () => Promise.resolve(1),
  decrIfPositive: () => Promise.resolve(false),
  get: () => Promise.resolve(null),
  setex: () => Promise.resolve(true),
  take: () => Promise.resolve(undefined),
  del: () => Promise.resolve(),
  setNx: () => Promise.resolve(true),
  close: () => Promise.resolve(),
};
const clock = new Date();
const listDeps: MemberListDeps = { sql, redis, log: { warn: () => undefined }, now: () => clock };
const deps = { sql, square, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, now: () => clock };
const ok = () => Promise.resolve(true);

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const small: Gym[] = [];
for (let i = 0; i < GYMS; i++) small.push(await seedGym(PEOPLE, PEOPLE, i, true));
const big = await seedGym(BIG, PAST_AT_BIG, GYMS, true);
const control = await seedGym(BIG, PAST_AT_BIG, GYMS + 1, false);
for (const table of ["gym_member_list_entries", "gym_square_customers", "gym_square_customer_deletes"]) await sql.unsafe(`VACUUM ANALYZE ${table}`);
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} (all past) and one of ${String(BIG)} (${String(PAST_AT_BIG)} past), every member's customer made by the app; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();

// 1. The box for the most one press deletes, at the gym of 2,000.
const ticked = big.entryIds.slice(0, MEMBER_LIST_DELETE_MAX);
const selection = { kind: "ticked" as const, entryIds: ticked };
const boxes: { wall: number; js: number }[] = [];
for (let i = 0; i < 9; i++) boxes.push(await time(() => previewDeleteSelected(listDeps, big.owner, big.id, { selection }, ok)));
many(`the Delete permanently box, ${String(MEMBER_LIST_DELETE_MAX)} past members, each with a customer in Square`, boxes);
const shown = await previewDeleteSelected(listDeps, big.owner, big.id, { selection }, ok);
console.log(`  box says: ${JSON.stringify(shown?.square)}`);

// 2. The press, with a control at a gym with nobody in Square.
const controlSelection = { kind: "ticked" as const, entryIds: control.entryIds.slice(0, MEMBER_LIST_DELETE_MAX) };
const controlBox = await previewDeleteSelected(listDeps, control.owner, control.id, { selection: controlSelection }, ok);
if (controlBox === null) throw new Error("rate limited");
once(`the press, ${String(MEMBER_LIST_DELETE_MAX)} past members, nobody in Square (control)`, await time(() => deleteSelected(listDeps, control.owner, control.id, { selection: controlSelection, digest: controlBox.digest }, ok)));
if (shown === null) throw new Error("rate limited");
const pressed = await time(() => deleteSelected(listDeps, big.owner, big.id, { selection, digest: shown.digest }, ok));
once(`the press, ${String(MEMBER_LIST_DELETE_MAX)} past members, each with a customer in Square`, pressed);
const done = pressed.value;
console.log(`  press says: ${done.kind === "deleted" ? JSON.stringify(done.done) : done.kind}`);
const [owed] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM gym_square_customer_deletes WHERE gym_id = ${big.id}`;
console.log(`  owed in the table: ${owed?.n ?? "?"}`);

// 3. The worker's minute that sends them, until the last is sent.
const minutes: { wall: number; js: number }[] = [];
let sent = 0;
for (let i = 0; i < 20; i++) {
  const t = await time(() => sendOwedCustomerDeletes(deps, square, [big.id]));
  minutes.push(t);
  sent += t.value.deleted;
  if (t.value.deleted === 0 && t.value.deferred === 0) break;
}
many(`the worker's minute sending the 200 (${String(minutes.length)} minutes, ${String(sent)} deleted)`, minutes);
console.log(`  first minute ${fmt(minutes[0]?.wall ?? 0)} (thread busy ${fmt(minutes[0]?.js ?? 0)}); Square asked ${String(fake.customersDeleteAsked.filter((c) => c.accountId === big.acct.merchantId).length)} times`);

// 4. 4,000 owed at once by the 20 small gyms, the way a launch day of deletions would be: first a minute with none due (the
// backlog waiting out a Square outage), then the minutes that send them.
for (const g of small) {
  const sel = { kind: "ticked" as const, entryIds: g.entryIds };
  const box = await previewDeleteSelected(listDeps, g.owner, g.id, { selection: sel }, ok);
  if (box === null) throw new Error("rate limited");
  await deleteSelected(listDeps, g.owner, g.id, { selection: sel, digest: box.digest }, ok);
}
const everyone = small.map((g) => g.id);
await sql`UPDATE gym_square_customer_deletes SET not_before = now() + interval '1 hour' WHERE gym_id = ANY(${everyone}::uuid[])`;
await sql.unsafe("VACUUM ANALYZE gym_square_customer_deletes");
const [waiting] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM gym_square_customer_deletes WHERE not_before > now()`;
const idle: { wall: number; js: number }[] = [];
for (let i = 0; i < 9; i++) idle.push(await time(() => sendOwedCustomerDeletes(deps, square, null)));
many(`a worker's minute with ${waiting?.n ?? "?"} owed and none due`, idle);
await sql`UPDATE gym_square_customer_deletes SET not_before = ${clock} WHERE gym_id = ANY(${everyone}::uuid[])`;
const spread: { wall: number; js: number }[] = [];
let spreadSent = 0;
for (let i = 0; i < 150; i++) {
  const t = await time(() => sendOwedCustomerDeletes(deps, square, everyone));
  spread.push(t);
  spreadSent += t.value.deleted;
  if (t.value.deleted === 0 && t.value.deferred === 0) break;
}
many(`the worker's minute with the 20 small gyms' ${waiting?.n ?? "?"} owed (${String(spread.length)} minutes, ${String(spreadSent)} deleted)`, spread);

delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
