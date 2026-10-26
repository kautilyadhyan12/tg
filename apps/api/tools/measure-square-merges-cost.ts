// What following Square's merges costs at full size (ROADMAP 18d-iii-b-ii-b-ii-a; CLAUDE.md §4 "Cost at full
// size"). The launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them, each on its own Square
// account in Chicago, every person in Square (the app's customer for them), every second one with a card on
// file, every gym adding new members by itself; and 2,000 old merges already kept for the big gym's account.
// Square is the test fake, which merges as Square's pages say and answers at once, so what is measured is ours.
// Nobody presses anything: Square merges, and the worker follows. Measured:
//   - Square's message about one merge of a member's two customers, at the gym of 2,000;
//   - Square's message about a merge of two people (Sam into his mum's customer), and the minute that adds him again;
//   - fifty merges told at once, in one worker's minute;
//   - a payment from Square Point of Sale taken in under a customer's old id;
//   - the names Payments to match reads for 25 payments of customers merged since;
//   - the worker's minute with every gym adding new members by itself and nobody new (its look reads the merges).
// Two numbers each: total, and how long the one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-square-merges-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, customers, cards and connections, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { checkSquareCustomer } from "../src/modules/orgs/payments/cards.js";
import { linkedNames } from "../src/modules/orgs/payments/paymentsToMatchRepo.js";
import { accessContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { SQUARE_SCOPES } from "../src/modules/orgs/payments/square.js";
import { takeInSquarePayment } from "../src/modules/orgs/payments/squareAppPayments.js";
import { processSquareMembers } from "../src/modules/orgs/payments/squareMembers.js";
import { account, fakeSquare, type Account } from "../test/fakeSquareTerminal.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-square-merges-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 9;
const PLAN = "zz_square_merges_cost";
const PREFIX = "sqg-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_square_customer_merges WHERE account_id LIKE 'MSQX%'`;
  await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${gyms}) OR account_id LIKE 'MSQX%'`;
  await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_square_member_runs WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${gyms})`;
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
    SQUARE_APPLICATION_ID: "sq0idp-SQGCOSTAPP1",
    SQUARE_APPLICATION_SECRET: "sq0csp-COSTSECRET", // dummy, gitleaks:allow
    PAYMENT_TOKENS_KEY: Buffer.alloc(32, 13).toString("base64"), // dummy, gitleaks:allow
    SQUARE_WEBHOOK_SIGNATURE_KEY: undefined,
    SQUARE_WEBHOOK_URL: undefined,
  },
  fake.api,
);
if (square === null) throw new Error("no Square settings");

interface Gym {
  id: string;
  acct: Account;
  /** Each record and its customer at Square. */
  people: { entryId: string; customerId: string; email: string }[];
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
  const run = randomUUID();
  await sql`
    INSERT INTO gym_square_member_runs (gym_id, environment, account_id, run_id, state, automatic, started_by, started_at, checked_at, added_at, list_version, look_due_at)
    VALUES (${id}, 'production', ${acct.merchantId}, ${run}, 'added', true, ${owner}, now(), now(), now(),
            (SELECT version FROM gym_member_lists WHERE gym_id = ${id}), now() + interval '1 day')`;
  const out: Gym["people"] = [];
  const links: Record<string, unknown>[] = [];
  const cards: Record<string, unknown>[] = [];
  const agreements: Record<string, unknown>[] = [];
  const plans: Record<string, unknown>[] = [];
  records.forEach((r, i) => {
    const customerId = `CX${String(n)}x${String(i)}`;
    fake.customer(acct, { id: customerId, given_name: `Person${String(i)}`, family_name: "Cost", email_address: r.email, reference_id: r.id });
    links.push({ gym_id: id, entry_id: r.id, environment: "production", account_id: acct.merchantId, customer_id: customerId });
    plans.push({
      gym_id: id,
      environment: "production",
      entry_id: r.id,
      run_id: run,
      decision: "add",
      digest: createHash("md5").update(`${r.full_name}\n${r.email}\n${r.phone_e164}`).digest("hex"),
      looked_at: new Date(),
      outcome: "done",
      done_at: new Date(),
    });
    if (i % 2 === 0) {
      const cardId = `ccof:${randomUUID()}`;
      const agreementId = randomUUID();
      fake.card(cardId, acct.merchantId, customerId);
      agreements.push({ id: agreementId, gym_id: id, entry_id: r.id, words: "I agree that this gym may save this card and charge it for my membership.", screen: "desk", brand: "VISA", last4: "1111", agreed_at: new Date() });
      cards.push({
        agreement_id: agreementId,
        gym_id: id,
        entry_id: r.id,
        environment: "production",
        account_id: acct.merchantId,
        customer_id: customerId,
        card_id: cardId,
        brand: "VISA",
        last4: "1111",
        exp_month: 12,
        exp_year: 2031,
        saved_from: "desk",
        saved_at: new Date(),
        updated_at: new Date(),
      });
    }
    out.push({ entryId: r.id, customerId, email: r.email });
  });
  for (let i = 0; i < links.length; i += 1000) await sql`INSERT INTO gym_square_customers ${sql(links.slice(i, i + 1000))}`;
  for (let i = 0; i < agreements.length; i += 1000) await sql`INSERT INTO gym_card_agreements ${sql(agreements.slice(i, i + 1000))}`;
  for (let i = 0; i < cards.length; i += 1000) await sql`INSERT INTO gym_member_cards ${sql(cards.slice(i, i + 1000))}`;
  for (let i = 0; i < plans.length; i += 1000) await sql`INSERT INTO gym_square_member_plan ${sql(plans.slice(i, i + 1000))}`;
  return { id, acct, people: out };
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
  console.log(`${name.padEnd(84)} total median ${fmt(median(ts.map((t) => t.wall)))} (worst ${fmt(Math.max(...ts.map((t) => t.wall)))}) · thread busy median ${fmt(median(ts.map((t) => t.js)))}`);
};
const once = (name: string, t: { wall: number; js: number }) => {
  console.log(`${name.padEnd(84)} total ${fmt(t.wall)} · thread busy ${fmt(t.js)}`);
};

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const gyms: Gym[] = [];
for (let i = 0; i < GYMS; i++) gyms.push(await seedGym(PEOPLE, i));
const big = await seedGym(BIG, GYMS);
const all = [...gyms.map((g) => g.id), big.id];
// Old merges of the big gym's account, from before: 2,000 rows.
const old = Array.from({ length: 2000 }, (_, i) => ({ environment: "production", account_id: big.acct.merchantId, from_customer_id: `COLD${String(i)}`, to_customer_id: `CNEW${String(i)}`, merged_at: new Date() }));
for (let i = 0; i < old.length; i += 1000) await sql`INSERT INTO gym_square_customer_merges ${sql(old.slice(i, i + 1000))}`;
for (const table of ["gym_member_list_entries", "gym_square_customers", "gym_member_cards", "gym_square_member_plan", "gym_square_customer_merges", "gym_square_member_runs"]) {
  await sql.unsafe(`VACUUM ANALYZE ${table}`);
}
console.log(
  `${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}, everybody in Square, every second with a card on file, every gym adding new members by itself, 2,000 old merges; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`,
);

const clock = new Date();
const deps = { sql, square, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, now: () => clock };
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();

// 1. One member's two customers merged (theirs and a café's instant profile of them), nine times over.
const followed: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) {
  const p = big.people[i * 2];
  if (p === undefined) break;
  fake.customer(big.acct, { id: `CCAFE${String(i)}`, given_name: `Person${String(i * 2)}`, family_name: "Cost", phone_number: "(312) 555-0100" });
  fake.merge(big.acct, [p.customerId, `CCAFE${String(i)}`]);
  followed.push(await time(() => checkSquareCustomer(deps, square, big.acct.merchantId, p.customerId)));
}
many(`Square's message about a member's two customers merged, at the gym of ${String(BIG)}`, followed);

// 2. A merge of two people: a child on a parent's email merged into the parent's customer, then the look adds them again.
const separated: { wall: number; js: number }[] = [];
const lookAgain: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) {
  const p = big.people[100 + i * 2];
  if (p === undefined) break;
  fake.customer(big.acct, { id: `CPARENT${String(i)}`, given_name: "Parent", family_name: `Other${String(i)}`, email_address: p.email });
  fake.merge(big.acct, [`CPARENT${String(i)}`, p.customerId]);
  separated.push(await time(() => checkSquareCustomer(deps, square, big.acct.merchantId, p.customerId)));
  lookAgain.push(await time(() => processSquareMembers(deps, square, [big.id])));
}
many(`Square's message about a member merged into another person's customer, at the gym of ${String(BIG)}`, separated);
many(`  the worker's minute that adds them to Square again`, lookAgain);

// 3. Fifty merges told at once, followed one after another in one worker's minute.
const fifty = big.people.slice(400, 450);
fifty.forEach((p, i) => {
  fake.customer(big.acct, { id: `CTWIN${String(i)}`, given_name: `Person${String(400 + i)}`, family_name: "Cost", phone_number: "(312) 555-0111" });
  fake.merge(big.acct, [p.customerId, `CTWIN${String(i)}`]);
});
once(
  `fifty merges told at once, followed in one minute, at the gym of ${String(BIG)}`,
  await time(async () => {
    for (const p of fifty) await checkSquareCustomer(deps, square, big.acct.merchantId, p.customerId);
  }),
);

// 4. A payment from Square Point of Sale taken in under a customer's old id.
const takeIns: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) {
  const p = big.people[i * 2];
  if (p === undefined) break;
  const paid = fake.appPayment(big.acct, { amount: 2500, customerId: p.customerId, locationId: big.acct.locations[0]?.id ?? "" });
  takeIns.push(await time(() => takeInSquarePayment(deps, square, big.acct.merchantId, paid.id)));
}
many(`a payment from Square Point of Sale taken in under an old id, at the gym of ${String(BIG)}`, takeIns);

// 5. The names Payments to match reads for 25 payments of customers merged since.
const asked = [...fifty.slice(0, 25).map((p) => p.customerId)];
many(
  `the names Payments to match reads for 25 payments under old ids, at the gym of ${String(BIG)}`,
  await (async () => {
    const out: { wall: number; js: number }[] = [];
    for (let i = 0; i < RUNS; i++) out.push(await time(() => linkedNames(sql, { gymId: big.id, environment: "production", accountId: big.acct.merchantId, customerIds: asked })));
    return out;
  })(),
);

// 6. The worker's minute with every gym adding new members by itself, and nobody new.
await sql`UPDATE gym_square_member_runs SET look_due_at = now() - interval '1 minute' WHERE gym_id = ANY(${all}::uuid[])`;
for (const table of ["gym_square_customers", "gym_member_cards", "gym_square_member_plan", "gym_square_customer_merges"]) await sql.unsafe(`ANALYZE ${table}`);
many(
  `the worker's minute, every gym adding new members by itself, nobody new`,
  await (async () => {
    const out: { wall: number; js: number }[] = [];
    for (let i = 0; i < RUNS; i++) {
      await sql`UPDATE gym_square_member_runs SET look_due_at = now() - interval '1 minute' WHERE gym_id = ANY(${all}::uuid[])`;
      out.push(await time(() => processSquareMembers(deps, square, all)));
    }
    return out;
  })(),
);

delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);
const [left] = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM gym_square_customers c JOIN gym_member_list_entries e ON e.gym_id = c.gym_id AND e.id = c.entry_id
  WHERE c.gym_id = ${big.id} AND c.customer_id IS NOT NULL`;
console.log(`  at the gym of ${String(BIG)}: ${String(left?.n ?? 0)} in Square after it all`);

await cleanup();
await sql.end({ timeout: 5 });
