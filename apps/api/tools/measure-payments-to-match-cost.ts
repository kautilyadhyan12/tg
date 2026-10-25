// What Payments to match costs at full size (ROADMAP 18d-iii-b-ii-a; CLAUDE.md §4 "Cost at full size"). The
// launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them, each on its own Square account in
// Chicago; every person holds a weekly membership whose bill falls due today, with a card on file; and the
// worst a list can hold: at the gym of 2,000 every person has a payment from Square Point of Sale waiting,
// at the small gyms half of them, each with its bill ticked for one press (the most a page reads). Square is the test fake, which answers at once, so what is measured is
// ours. Measured, each the way staff or the worker meet it:
//   - a page of Payments to match, the first and the last, and Overview's count, at the gym of 2,000;
//   - Match's box for one person, and Match itself, at the gym of 2,000;
//   - Not a bill payment, then Undo;
//   - the worker's look for the bills its card on file charges now, every gym, with the payments that
//     hold them waiting, and the same look once none wait;
//   - the person's page's own read of what waits for them.
// Two numbers each: total, and how long the one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-payments-to-match-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, memberships, cards and payments, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { dueBills } from "../src/modules/orgs/payments/cardChargesRepo.js";
import { matchPayment, markNotABill, putBackToMatch, readMatchBills, readPaymentsToMatch, readToMatchSummary } from "../src/modules/orgs/payments/paymentsToMatch.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import { squareAppWaitingFor } from "../src/modules/orgs/payments/paymentsToMatchBills.js";
import { accessContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { account, fakeSquare, type Account } from "../test/fakeSquareTerminal.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-payments-to-match-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 9;
const PLAN = "zz_pay_to_match_cost";
const PREFIX = "ptm-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${gyms})`;
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
    SQUARE_APPLICATION_ID: "sq0idp-PTMCOSTAPP1",
    SQUARE_APPLICATION_SECRET: "sq0csp-COSTSECRET", // dummy, gitleaks:allow
    PAYMENT_TOKENS_KEY: Buffer.alloc(32, 10).toString("base64"), // dummy, gitleaks:allow
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

async function seedGym(people: number, n: number, waiting: number): Promise<Gym> {
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
  const acct = account(`MPTC${String(n)}${randomUUID().slice(0, 6)}`);
  const exchanged = await fake.api.exchangeCode(fake.allow(acct));
  if (exchanged.kind !== "ok" || square === null) throw new Error("no token");
  const sealed = square.tokens.lock(exchanged.value.access_token, accessContext(id));
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
    return { id: entry, gym_id: id, full_name: `Person${String(i)} Cost`, email: `${PREFIX}${String(i)}-${entry}@example.com`, identity_key: createHash("sha256").update(entry).digest("hex"), source: "typed" };
  });
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  // Started a week ago, its first week paid: the second week's bill falls due today.
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 2500, 'USD', 1, 'week', (now() AT TIME ZONE 'America/Chicago')::date - 7, 'active', 1, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  // The first week's bill, paid at the desk, so the second is a renewal the card on file is charged for.
  await sql`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to, status, created_at, updated_at)
    SELECT h.gym_id, h.id, 0, 2500, 'USD', h.starts_on, h.starts_on, h.starts_on + 6, 'paid', now(), now() FROM gym_held_memberships h WHERE h.gym_id = ${id}`;
  // Each card with the agreement the person made when it was saved.
  const agreed = await sql<{ id: string; entry_id: string }[]>`
    INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
    SELECT ${id}, e.id, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${owner}, 'VISA', '1111', now()
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}
    RETURNING id, entry_id`;
  const agreementOf = new Map(agreed.map((a) => [a.entry_id, a.id]));
  const cards = records.map((r) => ({
    gym_id: id,
    entry_id: r.id,
    agreement_id: agreementOf.get(r.id) ?? null,
    environment: "production",
    account_id: acct.merchantId,
    customer_id: `CPC${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    card_id: `ccof:${randomUUID()}`,
    brand: "VISA",
    last4: "1111",
    exp_month: 12,
    exp_year: 2031,
    saved_from: "desk",
    saved_at: new Date(),
    updated_at: new Date(),
  }));
  for (let i = 0; i < cards.length; i += 1000) await sql`INSERT INTO gym_member_cards ${sql(cards.slice(i, i + 1000))}`;
  for (const c of cards) fake.card(c.card_id, acct.merchantId, c.customer_id);
  // Payments from Square Point of Sale that wait, each linked to its person, the first `waiting` of them.
  const rows = cards.slice(0, waiting).map((c, i) => ({
    environment: "production",
    account_id: acct.merchantId,
    square_payment_id: `PCOST${String(n)}x${String(i)}${randomUUID().slice(0, 8)}`,
    gym_id: id,
    location_id: location,
    customer_id: c.customer_id,
    amount_minor: 2706,
    tip_minor: 0,
    currency: "USD",
    source: "CARD",
    brand: "MASTERCARD",
    last4: "4444",
    taken_at: new Date(Date.now() - i * 60_000),
    state: "waiting",
    // One bill fits each, so every row of a page has its bill ticked: the most a page reads (one press).
    reason: "ready",
    entry_id: c.entry_id,
    entered_minor: 2500,
    device_name: "Front desk 1",
    created_at: new Date(),
    updated_at: new Date(),
  }));
  for (let i = 0; i < rows.length; i += 1000) await sql`INSERT INTO gym_square_app_payments ${sql(rows.slice(i, i + 1000))}`;
  return { id, owner, acct, people: cards.map((c) => ({ entryId: c.entry_id, customerId: c.customer_id })) };
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
  console.log(`${name.padEnd(70)} total median ${fmt(median(ts.map((t) => t.wall)))} (worst ${fmt(Math.max(...ts.map((t) => t.wall)))}) · thread busy median ${fmt(median(ts.map((t) => t.js)))}`);
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
const gyms: Gym[] = [];
for (let i = 0; i < GYMS; i++) gyms.push(await seedGym(PEOPLE, i, PEOPLE / 2));
const big = await seedGym(BIG, GYMS, BIG);
const all = [...gyms.map((g) => g.id), big.id];
await openDueBills({ sql, log: { info: () => undefined, error: () => undefined } }, { now: clock, gymIds: all });
for (const table of ["gym_square_app_payments", "gym_member_cards", "gym_held_memberships", "gym_member_list_entries", "gym_member_bills", "gym_member_payments", "gym_member_payers"]) {
  await sql.unsafe(`VACUUM ANALYZE ${table}`);
}
const [waitingNow] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_square_app_payments WHERE gym_id = ANY(${all}::uuid[]) AND state = 'waiting'`;
const [dueNow] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_bills WHERE gym_id = ANY(${all}::uuid[]) AND status = 'open'`;
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}; ${String(dueNow?.n ?? 0)} bills due today, each with a card on file; ${String(waitingNow?.n ?? 0)} payments waiting; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const deps = { sql, square, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, now: () => clock };
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();

many(`a page of Payments to match (25), the first, at the gym of ${String(BIG)}`, await runs(() => readPaymentsToMatch(deps, big.owner, big.id, 0)));
many(`a page of Payments to match, the last, at the gym of ${String(BIG)}`, await runs(() => readPaymentsToMatch(deps, big.owner, big.id, BIG - 25)));
many(`Overview's count, at the gym of ${String(BIG)}`, await runs(() => readToMatchSummary(deps, big.owner, big.id)));

// Match: real payments in the fake, so Square is asked as it is at the desk.
const toMatch = await Promise.all(
  big.people.slice(0, RUNS).map(async (p, i) => {
    const paid = fake.appPayment(big.acct, { amount: 2706, customerId: p.customerId, addedTax: 206 });
    const [row] = await sql<{ id: string }[]>`
      UPDATE gym_square_app_payments SET square_payment_id = ${paid.id} WHERE gym_id = ${big.id} AND entry_id = ${p.entryId} RETURNING id`;
    if (row === undefined) throw new Error(`no row ${String(i)}`);
    return { ...p, rowId: row.id };
  }),
);
const [held] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${big.id} AND entry_id = ${toMatch[0]?.entryId ?? null}`;
many(`Match's box for one person, at the gym of ${String(BIG)}`, await runs(() => readMatchBills(deps, big.owner, big.id, toMatch[0]?.rowId ?? "", toMatch[0]?.entryId ?? "")));
if (held === undefined) throw new Error("no membership");
many(
  `Match, one payment on its bill, at the gym of ${String(BIG)}`,
  await runs(async (i) => {
    const p = toMatch[i];
    if (p === undefined) throw new Error("no payment");
    const [m] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${big.id} AND entry_id = ${p.entryId}`;
    await matchPayment(deps, big.owner, big.id, p.rowId, { requestKey: randomUUID(), entryId: p.entryId, membershipId: m?.id ?? "", target: { kind: "period", periodIndex: 1 }, amountMinor: 2500 });
  }),
);
const marking = big.people.slice(RUNS, RUNS * 2);
const markRows = await Promise.all(marking.map(async (p) => (await sql<{ id: string }[]>`SELECT id FROM gym_square_app_payments WHERE gym_id = ${big.id} AND entry_id = ${p.entryId}`)[0]?.id ?? ""));
many(`Not a bill payment, at the gym of ${String(BIG)}`, await runs((i) => markNotABill(deps, big.owner, big.id, markRows[i] ?? "", { why: "other" })));
many(`Undo, at the gym of ${String(BIG)}`, await runs((i) => putBackToMatch(deps, big.owner, big.id, markRows[i] ?? "")));

// The worker's look for the bills it charges now: every gym, as its minute asks, with the holds.
const look = (limit: number) => dueBills(sql, { environment: "production", now: clock, limit, after: null, gymIds: all });
let found = 0;
many(
  `the worker's look for bills to charge, every gym, ${String(waitingNow?.n ?? 0)} payments holding`,
  await runs(async () => {
    found = (await look(500)).length;
  }),
);
console.log(`${"  bills it would charge in one minute (it looks at 500 at most)".padEnd(70)} ${String(found)}`);
console.log(`${"  bills it would charge in all, the rest held".padEnd(70)} ${String((await look(100_000)).length)}`);
many(`the person's page, what waits for them, at the gym of ${String(BIG)}`, await runs((i) => squareAppWaitingFor(sql, big.id, big.people[RUNS * 2 + i]?.entryId ?? "", dayInTz(new Date(), "America/Chicago"))));

// And once nothing waits: the same look, for comparison.
await sql`UPDATE gym_square_app_payments SET state = 'not_bill', not_bill = 'other' WHERE gym_id = ANY(${all}::uuid[]) AND state = 'waiting'`;
await sql.unsafe("VACUUM ANALYZE gym_square_app_payments");
many(
  "the worker's look for bills to charge, every gym, none waiting",
  await runs(async () => {
    found = (await look(500)).length;
  }),
);
console.log(`${"  bills it would charge in all".padEnd(70)} ${String((await look(100_000)).length)}`);

delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
