// What linking a list's membership word costs at full size (ROADMAP 17a-iii; CLAUDE.md §4
// "Cost at full size"). One gym whose whole list carries ONE word, the worst case: 2,100
// people (--people= for another size; a list holds at most 10,000), half with a renewal
// day still to come, a quarter with one that has passed, a quarter with no day. The
// words read as Settings reads them, the box's preview, and the link itself. Two numbers
// each, over several runs:
//   - total: how long the call takes (the link holds the gym's row for that long, so the
//     gym's other writes wait behind it);
//   - js: how long the server's one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-membership-words-cost.ts [--people=10000]
//
// --renew measures 21c-i instead: everybody held a one-time membership from the list that
// has ended, and the list gives half of them a later end date. The words read (which
// Members and the import's last screen now make too), the box, and the press that renews.
//
// LOCAL DATABASES ONLY: it writes a gym, its list and their memberships, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { addDays } from "@app/shared";
import { getMembershipWords, linkMembershipWord, previewMembershipLink } from "../src/modules/orgs/memberships/wordsService.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-membership-words-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RENEW = process.argv.includes("--renew");
const RUNS = 7;
const PLAN = "zz_words_cost";
const PREFIX = "words-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_word_links WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

async function seed(today: string): Promise<{ gymId: string; owner: string; typeId: string }> {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const typeId = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${typeId}, ${gymId}, 'Gold Monthly', ${RENEW ? "one_time" : "recurring"}, 4999, 'GBP', 1, 'month', 'all_classes')`;
  const records = Array.from({ length: PEOPLE }, (_, i) => {
    const id = randomUUID();
    const dated = RENEW || i % 4 !== 3;
    return {
      id,
      gym_id: gymId,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}${String(i)}-${id}@example.com`,
      identity_key: createHash("sha256").update(id).digest("hex"),
      source: "typed",
      membership_type: i % 3 === 0 ? "GOLD" : "Gold",
      // Renewal days spread over a month ahead, and a quarter of them a month behind.
      ends_on: RENEW ? addDays(today, 10) : dated ? addDays(today, i % 4 === 2 ? -(1 + (i % 28)) : 1 + (i % 28)) : null,
      ends_on_kind: RENEW ? "ends" : dated ? "renews" : null,
    };
  });
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  await sql`VACUUM ANALYZE gym_member_list_entries`;
  return { gymId, owner, typeId };
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
const deps = { sql, now: () => new Date() };
const today = new Date().toISOString().slice(0, 10);
const { gymId, owner, typeId } = await seed(today);
const mhz = await import("node:os").then((os) => os.cpus()[0]?.speed ?? 0);
if (RENEW) {
  // Last month everybody got it from the list. Forty days on it has ended for all of them,
  // and the list gives every second person a later end date.
  const given = await previewMembershipLink(deps, owner, gymId, { word: "Gold", typeId });
  await linkMembershipWord(deps, owner, gymId, { word: "Gold", typeId, groups: { settled: true, due: true, ask: true }, digest: given.digest, paid: true });
  await sql`UPDATE gym_held_memberships SET starts_on = starts_on - 40 WHERE gym_id = ${gymId}`;
  await sql`
    UPDATE gym_member_list_entries
    SET ends_on = CASE WHEN listed_seq % 2 = 0 THEN ${addDays(today, 45)}::date ELSE ${addDays(today, -30)}::date END
    WHERE gym_id = ${gymId}`;
  await sql`VACUUM ANALYZE gym_held_memberships`;
}
const first = await previewMembershipLink(deps, owner, gymId, { word: "Gold", typeId });
const TO_GIVE = first.counts.settled + first.counts.due + first.counts.ask;
console.log(
  `one gym: ${String(PEOPLE)} people, all with the one word; paid up ${String(first.counts.settled)}, due ${String(first.counts.due)}, to ask ${String(first.counts.ask)}, of them renewals ${String(first.counts.again)}; cpu ${String(mhz)} MHz; ${String(RUNS)} runs each`,
);
// The box as it stands before anybody is given anything: every timed link starts from it.
const digest = first.digest;

/** Take the link's work back, so each run gives everybody their membership afresh. */
async function undo(): Promise<void> {
  if (RENEW) {
    // Only the renewals go: each started today, and the ones before them stay ended.
    await sql`DELETE FROM gym_held_memberships WHERE gym_id = ${gymId} AND starts_on >= ${addDays(today, -1)}::date`;
    return;
  }
  await sql`DELETE FROM gym_held_memberships WHERE gym_id = ${gymId}`;
  await sql`DELETE FROM gym_membership_word_links WHERE gym_id = ${gymId}`;
}

const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
const calls: [string, () => Promise<unknown>, (() => Promise<void>) | null][] = [
  ["read the list's words", () => getMembershipWords(deps, owner, gymId), null],
  ["the box: who would get it", () => previewMembershipLink(deps, owner, gymId, { word: "Gold", typeId }), null],
  [
    RENEW ? `renew: ${String(TO_GIVE)} of ${String(PEOPLE)} people` : `link: give it to ${String(PEOPLE)} people`,
    async () => {
      const done = await linkMembershipWord(deps, owner, gymId, { word: "Gold", typeId, groups: { settled: true, due: true, ask: true }, digest, paid: true });
      if (done.given !== TO_GIVE) throw new Error(`gave ${String(done.given)} of ${String(TO_GIVE)}`);
    },
    undo,
  ],
];
for (const [name, call, after] of calls) {
  await call();
  if (after !== null) await after();
  const walls: number[] = [];
  const jss: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = await time(call);
    walls.push(t.wall);
    jss.push(t.js);
    if (after !== null) await after();
  }
  console.log(`${name.padEnd(31)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}
// The words again as Settings reads them from then on: the word linked, everybody holding it.
await linkMembershipWord(deps, owner, gymId, { word: "Gold", typeId, groups: { settled: true, due: true, ask: true }, digest, paid: true });
await sql`VACUUM ANALYZE gym_held_memberships`;
{
  const walls: number[] = [];
  const jss: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = await time(() => getMembershipWords(deps, owner, gymId));
    walls.push(t.wall);
    jss.push(t.js);
  }
  console.log(`${"read the words, once linked".padEnd(31)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}
delay.disable();
console.log(`longest single stall of the thread during all calls: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
