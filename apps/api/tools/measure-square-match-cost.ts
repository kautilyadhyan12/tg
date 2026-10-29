// What Match linking Square's customer costs at full size (ROADMAP 18d-iii-b-ii-c-i; CLAUDE.md §4 "Cost at full size"). The
// launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them, each on its own Square account in Chicago; every
// person holds a weekly membership whose bill falls due today. At the gym of 2,000 the worst a press meets: a Square
// customer whose payments wait in Payments to match, 1,000 of them, linked to the person with the one press; and nine more
// customers with about a thousand waiting between them, pressed one by one. Square is the test fake, which answers at once,
// so what is measured is ours. Measured, each the way staff meet it:
//   - Match's box for the person picked (it works out whether the customer is the person), at the gym of 2,000;
//   - Match with the tick on: the payment on its bill, the customer linked, every other waiting payment of it the person's;
//   - the same press at the small gyms;
//   - the list's first page and the person's page afterwards, with the rows now theirs.
// Two numbers each: total, and how long the one thread is busy and answers nobody.
//
//   corepack pnpm --filter api exec tsx tools/measure-square-match-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, memberships and payments, and removes them. Run it alone: the worker off,
// no tests, no reviewer (the numbers are the thread's).
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { matchPayment, readMatchBills, readPaymentsToMatch } from "../src/modules/orgs/payments/paymentsToMatch.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import { squareAppWaitingFor } from "../src/modules/orgs/payments/paymentsToMatchBills.js";
import { accessContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { account, fakeSquare, type Account } from "../test/fakeSquareTerminal.js";

const url = process.env["DATABASE_URL"] ?? "postgres://aihg:aihg@localhost:5433/aihg";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-square-match-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 9;
const HEAVY = 1000;
const PLAN = "zz_square_match_cost";
const PREFIX = "sml-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_square_old_customers WHERE gym_id IN (${gyms})`;
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
    SQUARE_APPLICATION_ID: "sq0idp-SMLCOSTAPP1",
    SQUARE_APPLICATION_SECRET: "sq0csp-COSTSECRET", // dummy, gitleaks:allow
    PAYMENT_TOKENS_KEY: Buffer.alloc(32, 11).toString("base64"), // dummy, gitleaks:allow
    SQUARE_WEBHOOK_SIGNATURE_KEY: undefined,
    SQUARE_WEBHOOK_URL: undefined,
  },
  fake.api,
);
if (square === null) throw new Error("no Square settings");
const settings = square;

interface Pending {
  entryId: string;
  membershipId: string;
  rowId: string;
  customerId: string;
}
interface Gym {
  id: string;
  owner: string;
  acct: Account;
  /** People whose customer is not linked yet, each with the payment that is pressed. */
  pending: Pending[];
  location: string;
}

/** `pending` people each with a Square customer of their own (same name as theirs, so the tick is on), one payment waiting,
 *  and `extra` more payments of the same customer waiting beside it. */
async function seedGym(people: number, n: number, pending: number, extra: number): Promise<Gym> {
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
  const acct = account(`MSMC${String(n)}${randomUUID().slice(0, 6)}`);
  const exchanged = await fake.api.exchangeCode(fake.allow(acct));
  if (exchanged.kind !== "ok") throw new Error("no token");
  const sealed = settings.tokens.lock(exchanged.value.access_token, accessContext(id));
  const location = acct.locations[0]?.id ?? "";
  await sql`
    INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency, location_id, location_name,
                                         access_token, refresh_token, access_expires_at, refresh_due_at, connected_by, connected_at, scopes)
    VALUES (${id}, 'square', 'production', 'connected', ${acct.merchantId}, 'Cost Gym', 'US', 'USD', ${location}, 'Main',
            ${sealed}, ${sealed}, now() + interval '30 days', now() + interval '6 days', ${owner}, now(),
            ARRAY['MERCHANT_PROFILE_READ','CUSTOMERS_READ','CUSTOMERS_WRITE','PAYMENTS_READ','PAYMENTS_WRITE','PAYMENTS_WRITE_IN_PERSON','DEVICE_CREDENTIAL_MANAGEMENT','ORDERS_READ','ITEMS_READ']::text[])`;
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
  await sql`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to, status, created_at, updated_at)
    SELECT h.gym_id, h.id, 0, 2500, 'USD', h.starts_on, h.starts_on, h.starts_on + 6, 'paid', now(), now() FROM gym_held_memberships h WHERE h.gym_id = ${id}`;
  const out: Pending[] = [];
  for (let i = 0; i < pending; i++) {
    const r = records[i];
    if (r === undefined) throw new Error("no record");
    const customerId = `CSMC${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    fake.customer(acct, { id: customerId, given_name: `Person${String(i)}`, family_name: "Cost", email_address: r.email });
    const paid = fake.appPayment(acct, { amount: 2500, customerId });
    const [m] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${id} AND entry_id = ${r.id}`;
    const rows = Array.from({ length: extra + 1 }, (_, k) => ({
      environment: "production",
      account_id: acct.merchantId,
      square_payment_id: k === 0 ? paid.id : `PSMC${String(n)}x${String(i)}x${String(k)}${randomUUID().slice(0, 8)}`,
      gym_id: id,
      location_id: location,
      customer_id: customerId,
      amount_minor: 2500,
      tip_minor: 0,
      currency: "USD",
      source: "CARD",
      brand: "MASTERCARD",
      last4: "4444",
      taken_at: new Date(Date.now() - k * 60_000),
      state: "waiting",
      reason: "not_linked",
      entry_id: null,
      entered_minor: 2500,
      customer_name: `Person${String(i)} Cost`,
      customer_email: r.email,
      device_name: "Front desk 1",
      created_at: new Date(),
      updated_at: new Date(),
    }));
    for (let k = 0; k < rows.length; k += 1000) await sql`INSERT INTO gym_square_app_payments ${sql(rows.slice(k, k + 1000))}`;
    const [first] = await sql<{ id: string }[]>`SELECT id FROM gym_square_app_payments WHERE gym_id = ${id} AND square_payment_id = ${paid.id}`;
    if (m === undefined || first === undefined) throw new Error("no membership or row");
    out.push({ entryId: r.id, membershipId: m.id, rowId: first.id, customerId });
  }
  return { id, owner, acct, pending: out, location };
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
const runs = async (fn: (i: number) => Promise<unknown>, n = RUNS) => {
  const out: { wall: number; js: number }[] = [];
  for (let i = 0; i < n; i++) out.push(await time(() => fn(i)));
  return out;
};

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const [noon] = await sql<{ at: Date }[]>`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + time '12:00') AT TIME ZONE 'America/Chicago' AS at`;
if (noon === undefined) throw new Error("no clock");
const clock = noon.at;
fake.state.now = () => clock;
const small: Gym[] = [];
for (let i = 0; i < GYMS; i++) small.push(await seedGym(PEOPLE, i, RUNS, 10));
// The gym of 2,000: nine customers with a hundred more payments waiting each, and one with a thousand.
const big = await seedGym(BIG, GYMS, RUNS + 1, 110);
const heavy = big.pending[RUNS];
if (heavy === undefined) throw new Error("no heavy customer");
// The tenth customer's waiting payments are a thousand, the most one press can meet.
const heavyRows = Array.from({ length: HEAVY - 111 }, (_, k) => ({
  environment: "production",
  account_id: big.acct.merchantId,
  square_payment_id: `PSMCH${String(k)}${randomUUID().slice(0, 8)}`,
  gym_id: big.id,
  location_id: big.location,
  customer_id: heavy.customerId,
  amount_minor: 2500,
  tip_minor: 0,
  currency: "USD",
  source: "CARD",
  taken_at: new Date(Date.now() - (k + 200) * 60_000),
  state: "waiting",
  reason: "not_linked",
  entry_id: null,
  entered_minor: 2500,
  customer_name: "Person9 Cost",
  created_at: new Date(),
  updated_at: new Date(),
}));
for (let i = 0; i < heavyRows.length; i += 1000) await sql`INSERT INTO gym_square_app_payments ${sql(heavyRows.slice(i, i + 1000))}`;
const all = [...small.map((g) => g.id), big.id];
await openDueBills({ sql, log: { info: () => undefined, error: () => undefined } }, { now: clock, gymIds: all });
for (const table of ["gym_square_app_payments", "gym_square_customers", "gym_held_memberships", "gym_member_list_entries", "gym_member_bills", "gym_member_payments"]) {
  await sql.unsafe(`VACUUM ANALYZE ${table}`);
}
const [waitingNow] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_square_app_payments WHERE gym_id = ANY(${all}::uuid[]) AND state = 'waiting'`;
const [bigWaiting] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_square_app_payments WHERE gym_id = ${big.id} AND state = 'waiting'`;
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}; ${String(waitingNow?.n ?? 0)} payments waiting (${String(bigWaiting?.n ?? 0)} at the big gym, ${String(HEAVY)} of them one customer's); cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const deps = { sql, square, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, now: () => clock };
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();

const press = (gym: Gym, p: Pending) =>
  matchPayment(deps, gym.owner, gym.id, p.rowId, { requestKey: randomUUID(), entryId: p.entryId, membershipId: p.membershipId, target: { kind: "period", periodIndex: 1 }, amountMinor: 2500, linkTo: p.entryId });

many(`Match's box for the person picked (does the customer fit them), at the gym of ${String(BIG)}`, await runs((i) => readMatchBills(deps, big.owner, big.id, big.pending[i]?.rowId ?? "", big.pending[i]?.entryId ?? "")));
many(`Match with the tick on, ~110 other payments of the customer waiting, at the gym of ${String(BIG)}`, await runs((i) => press(big, big.pending[i] ?? heavy)));
many(`Match with the tick on, ${String(HEAVY)} other payments of the customer waiting (once), at the gym of ${String(BIG)}`, await runs(() => press(big, heavy), 1));
many(`Match with the tick on, 10 other payments waiting, at a gym of ${String(PEOPLE)}`, await runs((i) => press(small[i % GYMS] ?? big, small[i % GYMS]?.pending[i] ?? heavy)));
const [linked] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_square_customers WHERE gym_id = ANY(${all}::uuid[]) AND joined_at IS NOT NULL`;
const [theirs] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_square_app_payments WHERE gym_id = ${big.id} AND state = 'waiting' AND entry_id IS NOT NULL`;
console.log(`${"  customers linked, and payments at the big gym now their person's".padEnd(78)} ${String(linked?.n ?? 0)}, ${String(theirs?.n ?? 0)}`);
await sql.unsafe("VACUUM ANALYZE gym_square_app_payments");
many(`a page of Payments to match (25), the first, after, at the gym of ${String(BIG)}`, await runs(() => readPaymentsToMatch(deps, big.owner, big.id, 0)));
many(`the person's page, what waits for them, the person with ${String(HEAVY)} waiting`, await runs(() => squareAppWaitingFor(sql, big.id, heavy.entryId, dayInTz(new Date(), "America/Chicago"))));

delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
