// What charging the card on file costs at full size (ROADMAP 18d-iii-i; CLAUDE.md §4 "Cost at full
// size"). The launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them, every gym on
// Square in Chicago; every person holds a renewing membership whose second week's bill fell due
// today, and a card on file: the most a morning can ever have to charge. Square is the fake of the
// tests, answering at once, so what is measured is ours. Measured:
//   - the worker's look for bills due, when all are due and when none is left (every other minute);
//   - one minute of the worker: 50 charges, each started under its record's lock and recorded;
//   - a person's page read with its bills and their charges.
// Two numbers each: total, and how long the one thread is busy and answers nobody. The look and the
// charges are the worker's thread; the page read is the api's.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-card-charges-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, memberships, bills and cards, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { getHeldMemberships } from "../src/modules/orgs/memberships/heldService.js";
import { CARD_CHARGE, processCardCharges } from "../src/modules/orgs/payments/cardCharges.js";
import { dueBills } from "../src/modules/orgs/payments/cardChargesRepo.js";
import { accessContext, refreshContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { account, fakeSquare } from "../test/fakeSquareTerminal.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-card-charges-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 9;
const PLAN = "zz_charges_cost";
const PREFIX = "charges-cost-";
const square = fakeSquare();
const settings = squareSettings(
  {
    SQUARE_ENV: "production",
    SQUARE_APPLICATION_ID: "sq0idp-COSTAPP",
    SQUARE_APPLICATION_SECRET: "sq0csp-COSTSECRET", // dummy, gitleaks:allow
    PAYMENT_TOKENS_KEY: Buffer.alloc(32, 9).toString("base64"), // dummy, gitleaks:allow
    SQUARE_WEBHOOK_SIGNATURE_KEY: undefined,
    SQUARE_WEBHOOK_URL: undefined,
  },
  square.api,
);
if (settings === null) throw new Error("no Square settings");

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${gyms})`;
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

interface Gym {
  id: string;
  owner: string;
  first: string;
}

async function seedGym(people: number, n: number): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${id}, ${PREFIX + id}, 'Cost Gym', 'America/Chicago', 'US', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  // Its own Square account, connected, with a token the fake knows.
  const acct = account(`MCOST${String(n)}`);
  const granted = await square.api.exchangeCode(square.allow(acct));
  if (granted.kind !== "ok") throw new Error("no token");
  const tokens = settings?.tokens;
  if (tokens === undefined) throw new Error("no token box");
  const location = acct.locations[0];
  await sql`
    INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency, location_id, location_name,
                                         access_token, refresh_token, access_expires_at, refresh_due_at, connected_by, connected_at, scopes)
    VALUES (${id}, 'square', 'production', 'connected', ${acct.merchantId}, ${acct.businessName}, 'US', 'USD', ${location?.id ?? null}, ${location?.name ?? null},
            ${tokens.lock(granted.value.access_token, accessContext(id))}, ${tokens.lock("EQAAcost-refresh", refreshContext(id))},
            now() + interval '30 days', now() + interval '6 days', ${owner}, now(), '{}'::text[])`;
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
  // A week ago, its first week paid; the second week's bill opened today and owed.
  await sql`
    WITH today AS (SELECT (now() AT TIME ZONE 'America/Chicago')::date AS d)
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 2500, 'USD', 1, 'week', (SELECT d FROM today) - 7, 'active', 1, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  // The first week's bill, paid at the desk (the app charges only a bill with one before it).
  await sql`
    WITH today AS (SELECT (now() AT TIME ZONE 'America/Chicago')::date AS d)
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to, status)
    SELECT ${id}, h.id, 0, 2500, 'USD', (SELECT d FROM today) - 7, (SELECT d FROM today) - 7, (SELECT d FROM today) - 1, 'paid'
    FROM gym_held_memberships h WHERE h.gym_id = ${id}`;
  await sql`
    WITH today AS (SELECT (now() AT TIME ZONE 'America/Chicago')::date AS d)
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to)
    SELECT ${id}, h.id, 1, 2500, 'USD', (SELECT d FROM today), (SELECT d FROM today), (SELECT d FROM today) + 6
    FROM gym_held_memberships h WHERE h.gym_id = ${id}`;
  // Each person's card on file, in that account and in the fake.
  const cards = records.map((r) => ({ entry: r.id, customer: `CUST${randomUUID().slice(0, 8)}`, card: `ccof:${randomUUID()}` }));
  for (const c of cards) square.card(c.card, acct.merchantId, c.customer);
  const agreements = records.map((r) => ({
    id: randomUUID(),
    gym_id: id,
    entry_id: r.id,
    words: "I agree that Cost Gym may save this card and charge it for my membership.",
    screen: "desk",
    brand: "VISA",
    last4: "1111",
    agreed_at: new Date(),
  }));
  for (let i = 0; i < agreements.length; i += 1000) await sql`INSERT INTO gym_card_agreements ${sql(agreements.slice(i, i + 1000))}`;
  const saved = cards.map((c, i) => ({
    gym_id: id,
    entry_id: c.entry,
    environment: "production",
    account_id: acct.merchantId,
    customer_id: c.customer,
    card_id: c.card,
    brand: "VISA",
    last4: "1111",
    exp_month: 12,
    exp_year: 2031,
    saved_from: "desk",
    agreement_id: agreements[i]?.id ?? "",
    saved_at: new Date(),
    updated_at: new Date(),
  }));
  for (let i = 0; i < saved.length; i += 1000) await sql`INSERT INTO gym_member_cards ${sql(saved.slice(i, i + 1000))}`;
  return { id, owner, first: records[0]?.id ?? "" };
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
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const gyms: Gym[] = [];
for (let i = 0; i < GYMS; i++) gyms.push(await seedGym(PEOPLE, i));
const big = await seedGym(BIG, GYMS);
await sql`VACUUM ANALYZE gym_member_bills`;
await sql`VACUUM ANALYZE gym_member_cards`;
await sql`VACUUM ANALYZE gym_held_memberships`;
const all = [...gyms.map((g) => g.id), big.id];
// Noon in Chicago today: past 6 in the morning there.
const [noon] = await sql<{ at: Date }[]>`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + time '12:00') AT TIME ZONE 'America/Chicago' AS at`;
const clock = noon?.at ?? new Date();
const quiet = { info: () => undefined, warn: () => undefined, error: (obj: object) => { console.error("error", obj); } };
const deps = { sql, square: settings, log: quiet, now: () => clock };
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}, every person a bill due today and a card on file; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
const many = (name: string, ts: { wall: number; js: number }[]) =>
  { console.log(`${name.padEnd(56)} total median ${fmt(median(ts.map((t) => t.wall)))} (worst ${fmt(Math.max(...ts.map((t) => t.wall)))}) · thread busy median ${fmt(median(ts.map((t) => t.js)))}`); };

const look = () => dueBills(sql, { environment: "production", now: clock, limit: 50, after: null, gymIds: all });
const lookFull: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) lookFull.push(await time(look));
many(`the look for bills due, ${String(GYMS * PEOPLE + BIG)} due`, lookFull);

const minutes: { wall: number; js: number }[] = [];
let charged = 0;
for (;;) {
  let run = { charged: 0 };
  const t = await time(async () => {
    run = await processCardCharges(deps, settings, all);
  });
  if (run.charged === 0) break;
  charged += run.charged;
  minutes.push(t);
}
many(`one minute of the worker, ${String(CARD_CHARGE.perRun)} charges`, minutes);
console.log(`${"all charged in".padEnd(56)} ${String(minutes.length)} minutes of the worker · ${String(charged)} charges · Square took ${String(square.taken().length)}`);

const lookEmpty: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) lookEmpty.push(await time(look));
many("the look for bills due, none left (every other minute)", lookEmpty);

const page = () => getHeldMemberships({ sql, now: () => clock }, big.owner, big.id, big.first);
await page();
const pages: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) pages.push(await time(page));
many("read a person's page, with its bill and its charge", pages);

delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
