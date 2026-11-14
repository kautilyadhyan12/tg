// What Ask to add card costs at full size (ROADMAP 18d-vii; CLAUDE.md §4 "Cost at full size"). One gym
// of 10,000 people, the biggest list the app takes, on Square in Chicago; every person holds a
// renewing membership, half are in the app, a quarter have a card, one in ten pays for the next
// person. And the launch shape: 20 gyms of 200 beside it. Measured, each as total and how long the one
// thread is busy (answering nobody):
//   - "No card on file"'s count, which the Members list reads for staff who take payments;
//   - the Filter's list of them (a page of the list, and Select all);
//   - the box for everybody it names, and the press that asks them all.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-card-requests-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, members, memberships and cards, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { createMemoryRedis } from "../src/redis.js";
import { needsCardCount, needsCardIds, requestStateOf } from "../src/modules/orgs/payments/cardRequestsRepo.js";
import { previewCardRequest, sendCardRequest } from "../src/modules/orgs/payments/cardRequests.js";
import { selectAll, selectedIds } from "../src/modules/orgs/memberList/selection.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-card-requests-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 10_000;
const RUNS = 9;
const PLAN = "zz_card_requests_cost";
const PREFIX = "card-req-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_payment_connections WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Gym {
  id: string;
  owner: string;
  account: string;
}

async function seedGym(people: number, n: number): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${id}, ${PREFIX + id}, 'Cost Gym', 'America/Chicago', 'US', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const account = `MCRQ${String(n)}`;
  await sql`
    INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency, location_id, location_name,
                                         access_token, refresh_token, access_expires_at, refresh_due_at, connected_by, connected_at, scopes)
    VALUES (${id}, 'square', 'production', 'connected', ${account}, 'Cost Gym', 'US', 'USD', ${`L${account}`}, 'Main',
            'unused', 'unused', now() + interval '30 days', now() + interval '6 days', ${owner}, now(), '{}'::text[])`;
  const typeId = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${typeId}, ${id}, 'Gold Weekly', 'recurring', 2500, 'USD', 1, 'week', 'all_classes')`;
  const records = Array.from({ length: people }, (_, i) => {
    const entry = randomUUID();
    return { id: entry, gym_id: id, full_name: `Person${String(i)} Cost`, email: `${PREFIX}${String(i)}-${entry}@example.com`, identity_key: createHash("sha256").update(entry).digest("hex"), source: "typed" };
  });
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  await sql`
    INSERT INTO gym_held_memberships (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 2500, 'USD', 1, 'week', (now() AT TIME ZONE 'America/Chicago')::date - 7, 'active', 1, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  // Half in the app, each with an account of their own.
  const inApp = records.filter((_, i) => i % 2 === 0);
  const users = inApp.map((r) => ({ id: randomUUID(), email: `${PREFIX}u-${r.id}@example.com`, display_name: r.full_name }));
  for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
  const links = inApp.map((r, i) => ({ gym_id: id, user_id: users[i]?.id ?? "", entry_id: r.id }));
  for (let i = 0; i < links.length; i += 1000) await sql`INSERT INTO gym_members ${sql(links.slice(i, i + 1000))}`;
  // A quarter with a card on file.
  const carded = records.filter((_, i) => i % 4 === 1);
  const agreements = carded.map((r) => ({ id: randomUUID(), gym_id: id, entry_id: r.id, words: "I agree that Cost Gym may save this card and charge it for my membership.", screen: "desk", brand: "VISA", last4: "1111", agreed_at: new Date() }));
  for (let i = 0; i < agreements.length; i += 1000) await sql`INSERT INTO gym_card_agreements ${sql(agreements.slice(i, i + 1000))}`;
  const cards = carded.map((r, i) => ({
    gym_id: id, entry_id: r.id, environment: "production", account_id: account, customer_id: `C${randomUUID().slice(0, 8)}`, card_id: `ccof:${randomUUID()}`,
    brand: "VISA", last4: "1111", exp_month: 12, exp_year: 2031, saved_from: "desk", agreement_id: agreements[i]?.id ?? "", saved_at: new Date(), updated_at: new Date(),
  }));
  for (let i = 0; i < cards.length; i += 1000) await sql`INSERT INTO gym_member_cards ${sql(cards.slice(i, i + 1000))}`;
  // One in ten pays for the person after them.
  const payers = records.flatMap((r, i) => (i % 10 === 3 && records[i + 1] !== undefined ? [{ gym_id: id, entry_id: records[i + 1]?.id ?? "", payer_entry_id: r.id }] : []));
  for (let i = 0; i < payers.length; i += 1000) await sql`INSERT INTO gym_member_payers ${sql(payers.slice(i, i + 1000))}`;
  return { id, owner, account };
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
  console.log(`${name.padEnd(62)} total median ${fmt(median(ts.map((t) => t.wall)))} (worst ${fmt(Math.max(...ts.map((t) => t.wall)))}) · thread busy median ${fmt(median(ts.map((t) => t.js)))}`);
};
const runs = async (name: string, fn: () => Promise<unknown>, n = RUNS) => {
  await fn();
  const ts: { wall: number; js: number }[] = [];
  for (let i = 0; i < n; i++) ts.push(await time(fn));
  many(name, ts);
};

try {
  await cleanup();
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const small: Gym[] = [];
  for (let i = 0; i < GYMS; i++) small.push(await seedGym(PEOPLE, i));
  const big = await seedGym(BIG, GYMS);
  for (const table of ["gym_member_cards", "gym_held_memberships", "gym_member_list_entries", "gym_member_payers", "gym_members", "gym_member_messages"]) await sql.unsafe(`VACUUM ANALYZE ${table}`);
  console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();

  const now = () => new Date();
  const a = { environment: "production" as const, accountId: big.account };
  const first = small[0];
  if (first === undefined) throw new Error("no gym");
  let count = 0;
  await runs(`No card on file's count, gym of ${String(BIG)}`, async () => {
    count = await needsCardCount(sql, big.id, a, now());
  });
  console.log(`${"  people who need a card".padEnd(62)} ${String(count)}`);
  await runs(`No card on file's count, gym of ${String(PEOPLE)}`, () => needsCardCount(sql, first.id, { environment: "production", accountId: first.account }, now()));
  await runs(`the Filter's list of them, gym of ${String(BIG)}`, () => needsCardIds(sql, big.id, a, now()));

  const deps = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now, invites: null, cardsEnvironment: "production" as const };
  const yes = () => Promise.resolve(true);
  const all = await selectAll(deps, big.owner, big.id, { filter: { card: "none" } }, yes);
  if (all === null) throw new Error("no selection");
  const selection = { kind: "all" as const, filter: { card: "none" as const }, count: all.count, digest: all.digest };
  let asking = 0;
  await runs(`the box for Select all of ${String(all.count)}`, async () => {
    asking = (await previewCardRequest(deps, big.owner, big.id, { selection }, yes))?.askCount ?? 0;
  }, 5);
  console.log(`${"  the box asks".padEnd(62)} ${String(asking)}`);
  // Where the box's time goes: who Select all means, and the one read of their state.
  await runs(`  of which: Select all resolved (${String(all.count)})`, () => selectedIds(deps, big.id, selection), 5);
  const ids = await needsCardIds(sql, big.id, a, now());
  await runs(`  of which: the one read of ${String(ids.length)} records`, () => requestStateOf(sql, big.id, ids, a, now()), 5);
  const smallAll = await selectAll(deps, first.owner, first.id, { filter: { card: "none" } }, yes);
  if (smallAll === null) throw new Error("no selection");
  const smallSel = { kind: "all" as const, filter: { card: "none" as const }, count: smallAll.count, digest: smallAll.digest };
  await runs(`the box for Select all of ${String(smallAll.count)}, gym of ${String(PEOPLE)}`, () => previewCardRequest(deps, first.owner, first.id, { selection: smallSel }, yes));
  const box = await previewCardRequest(deps, big.owner, big.id, { selection }, yes);
  if (box === null) throw new Error("no box");
  const press = await time(() => sendCardRequest(deps, big.owner, big.id, { selection, askCount: box.askCount, askDigest: box.askDigest, key: randomUUID() }, yes));
  many(`the press that asks all ${String(box.askCount)}`, [press]);
  console.log(`${"longest single block of the thread".padEnd(62)} ${fmt(delay.max / 1e6)}`);
} finally {
  await cleanup();
  await sql.end();
}
