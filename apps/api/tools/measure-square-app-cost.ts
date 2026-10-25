// What a payment taken in Square's own app costs at full size (ROADMAP 18d-iii-b-i; CLAUDE.md §4 "Cost at
// full size"). The launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them, each gym on its
// own Square account in Chicago; every person holds a weekly membership whose bill falls due today and
// is the customer the app keeps in that account. Square is the test fake, which answers at once, so
// what is measured is ours. Measured:
//   - one payment taken in: its message, read, decided and recorded on the bill, at the gym of 200 and
//     at the gym of 2,000;
//   - a busy desk's 100 payments, one after another, at the gym of 2,000;
//   - the hourly look at the gym of 2,000 over an hour of 100 payments: all taken in already by their
//     messages (every hour), and none (our server was down);
//   - one minute of every gym's hourly look, with nothing to take in;
//   - Not this bill.
// Two numbers each: total, and how long the one thread is busy and answers nobody. Everything but Not
// this bill is the worker's thread; Not this bill is the api's.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-square-app-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, memberships and Square customers, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { voidPayment } from "../src/modules/orgs/memberships/billsRepo.js";
import * as repo from "../src/modules/orgs/payments/repo.js";
import { accessContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { sweepSquarePayments, takeIn } from "../src/modules/orgs/payments/squareAppPayments.js";
import { account, fakeSquare, type Account } from "../test/fakeSquareTerminal.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-square-app-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 9;
const BUSY = 100;
const PLAN = "zz_square_app_cost";
const PREFIX = "sqapp-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_square_customers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_payment_connections WHERE gym_id IN (${gyms})`;
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

const fake = fakeSquare();
const square = squareSettings(
  {
    SQUARE_ENV: "production",
    SQUARE_APPLICATION_ID: "sq0idp-SQAPPCOSTAPP1",
    SQUARE_APPLICATION_SECRET: "sq0csp-COSTSECRET", // dummy, gitleaks:allow
    PAYMENT_TOKENS_KEY: Buffer.alloc(32, 9).toString("base64"), // dummy, gitleaks:allow
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
  people: { entryId: string; customerId: string }[];
}

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
  const acct = account(`MSQC${String(n)}${randomUUID().slice(0, 6)}`);
  const exchanged = await fake.api.exchangeCode(fake.allow(acct));
  if (exchanged.kind !== "ok" || square === null) throw new Error("no token");
  const sealed = square.tokens.lock(exchanged.value.access_token, accessContext(id));
  await sql`
    INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency, location_id, location_name,
                                         access_token, refresh_token, access_expires_at, refresh_due_at, connected_by, connected_at, scopes)
    VALUES (${id}, 'square', 'production', 'connected', ${acct.merchantId}, 'Cost Gym', 'US', 'USD', ${acct.locations[0]?.id ?? ""}, 'Main',
            ${sealed}, ${sealed}, now() + interval '30 days', now() + interval '6 days', ${owner}, now(),
            ARRAY['MERCHANT_PROFILE_READ','CUSTOMERS_READ','CUSTOMERS_WRITE','PAYMENTS_READ','PAYMENTS_WRITE','PAYMENTS_WRITE_IN_PERSON','DEVICE_CREDENTIAL_MANAGEMENT','ORDERS_READ']::text[])`;
  const typeId = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${typeId}, ${id}, 'Gold Weekly', 'recurring', 2500, 'USD', 1, 'week', 'all_classes')`;
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
  // Started a week ago, its first week paid: the second week's bill falls due today.
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 2500, 'USD', 1, 'week', (now() AT TIME ZONE 'America/Chicago')::date - 7, 'active', 1, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  const customers = records.map((r) => ({ gym_id: id, entry_id: r.id, environment: "production", account_id: acct.merchantId, customer_id: `CQC${randomUUID().replace(/-/g, "").slice(0, 20)}` }));
  for (let i = 0; i < customers.length; i += 1000) await sql`INSERT INTO gym_square_customers ${sql(customers.slice(i, i + 1000))}`;
  return { id, owner, acct, people: customers.map((c) => ({ entryId: c.entry_id, customerId: c.customer_id })) };
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
  console.log(`${name.padEnd(64)} total median ${fmt(median(ts.map((t) => t.wall)))} (worst ${fmt(Math.max(...ts.map((t) => t.wall)))}) · thread busy median ${fmt(median(ts.map((t) => t.js)))}`);
};

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const [noon] = await sql<{ at: Date }[]>`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + time '12:00') AT TIME ZONE 'America/Chicago' AS at`;
if (noon === undefined) throw new Error("no clock");
let clock = noon.at;
fake.state.now = () => clock;
const gyms: Gym[] = [];
for (let i = 0; i < GYMS; i++) gyms.push(await seedGym(PEOPLE, i));
const big = await seedGym(BIG, GYMS);
for (const table of ["gym_square_customers", "gym_held_memberships", "gym_member_list_entries", "gym_member_bills", "gym_member_payments"]) await sql.unsafe(`VACUUM ANALYZE ${table}`);
const all = [...gyms.map((g) => g.id), big.id];
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}, each on its own Square account; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const deps = { sql, square, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, now: () => clock };
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
// Every gym watched from an hour ago, so its looks are due.
await sql`
  INSERT INTO gym_square_payment_sweeps (gym_id, environment, account_id, location_id, watching_since, swept_until, due_at)
  SELECT gym_id, environment, account_id, location_id, ${new Date(clock.getTime() - 60 * 60_000)}, ${new Date(clock.getTime() - 60 * 60_000)}, ${new Date(clock.getTime() + 60 * 60_000)}
  FROM gym_payment_connections WHERE gym_id = ANY(${all}::uuid[])`;

const one = async (gym: Gym, who: { customerId: string }): Promise<void> => {
  const rows = await repo.connectionsOfAccount(sql, "production", gym.acct.merchantId);
  const payment = fake.appPayment(gym.acct, { amount: 2500, customerId: who.customerId });
  if ((await takeIn(deps, square, gym.acct.merchantId, rows, payment)) !== "done") throw new Error("not taken in");
};
const small = gyms[0];
if (small === undefined) throw new Error("no gym");
const smallRuns: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) smallRuns.push(await time(() => one(small, small.people[i] ?? { customerId: "" })));
many(`one payment taken in and recorded, at a gym of ${String(PEOPLE)}`, smallRuns);
const bigRuns: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) bigRuns.push(await time(() => one(big, big.people[i] ?? { customerId: "" })));
many(`one payment taken in and recorded, at the gym of ${String(BIG)}`, bigRuns);
const [recorded] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_square_app_payments WHERE gym_id = ANY(${all}::uuid[]) AND state = 'recorded'`;
console.log(`${"recorded so far".padEnd(64)} ${String(recorded?.n ?? 0)}`);

// A busy desk: 100 payments in a row at the gym of 2,000.
const busy = await time(async () => {
  for (let i = RUNS; i < RUNS + BUSY; i++) await one(big, big.people[i] ?? { customerId: "" });
});
many(`${String(BUSY)} payments one after another, at the gym of ${String(BIG)}`, [busy]);

// The hourly look over that hour: every payment already taken in by its message.
clock = new Date(clock.getTime() + 61 * 60_000);
await sql`UPDATE gym_square_payment_sweeps SET due_at = ${clock} WHERE gym_id = ${big.id}`;
let looked = 0;
const lookKnown = await time(async () => {
  looked = (await sweepSquarePayments(deps, square, [big.id])).payments;
});
many(`the hourly look, ${String(looked)} payments all taken in already`, [lookKnown]);

// Our server was down: 100 more payments made, no message came; the look takes them in.
for (let i = RUNS + BUSY; i < RUNS + 2 * BUSY; i++) fake.appPayment(big.acct, { amount: 2500, customerId: big.people[i]?.customerId ?? null });
clock = new Date(clock.getTime() + 61 * 60_000);
await sql`UPDATE gym_square_payment_sweeps SET due_at = ${clock} WHERE gym_id = ${big.id}`;
const lookNew = await time(async () => {
  looked = (await sweepSquarePayments(deps, square, [big.id])).payments;
});
many(`the hourly look, ${String(looked)} payments, the new ones taken in`, [lookNew]);

// One minute of every gym's look, nothing to take in.
clock = new Date(clock.getTime() + 61 * 60_000);
await sql`UPDATE gym_square_payment_sweeps SET due_at = ${clock} WHERE gym_id = ANY(${all}::uuid[])`;
const everyGym = await time(() => sweepSquarePayments(deps, square, all));
many(`every gym's look in one minute (${String(all.length)} gyms), none new`, [everyGym]);

// Not this bill, at the gym of 2,000.
const offs: { wall: number; js: number }[] = [];
const taken = await sql<{ entry_id: string; member_payment_id: string; held_membership_id: string }[]>`
  SELECT a.entry_id, a.member_payment_id, b.held_membership_id
  FROM gym_square_app_payments a
  JOIN gym_member_payments p ON p.gym_id = a.gym_id AND p.id = a.member_payment_id
  JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
  WHERE a.gym_id = ${big.id} AND a.state = 'recorded'
  LIMIT ${RUNS}`;
const [today] = await sql<{ d: string }[]>`SELECT ((now() AT TIME ZONE 'America/Chicago')::date)::text AS d`;
for (const t of taken) {
  offs.push(
    await time(async () => {
      const out = await voidPayment(sql, {
        gymId: big.id,
        entryId: t.entry_id,
        membershipId: t.held_membership_id,
        paymentId: t.member_payment_id,
        reason: "not_this_bill",
        today: today?.d ?? "",
        actorUserId: big.owner,
        now: clock,
      });
      if (out.kind !== "ok") throw new Error(`not taken off: ${out.kind}`);
    }),
  );
}
many(`Not this bill, at the gym of ${String(BIG)}`, offs);

delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
