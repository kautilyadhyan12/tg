// What a gym's waiver costs (ROADMAP 3e-i; CLAUDE.md §4 "Cost at full size"). One gym of
// 2,000 people on its list (--people= for another size) beside 19 gyms of 200, the launch
// shape. Six in ten of each gym's people are in the app; every gym has a waiver of the
// longest size kept (30,000 characters), and half of the people in the app have signed it.
//
// For each thing the owner, staff and a member do: Settings' box (the words and how many
// have signed), Save with changed words, what a person's page reads more than before, a
// member reading the waiver, and a member signing it. Since 3e-ii, also: a quarter of the
// people with no app signed at the desk; Members with "Waiver not signed" (the list's
// count and a page of names), and the desk's box read and signed. Two numbers each: how long it takes,
// and how long the server's one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_c'
//   corepack pnpm --filter api exec tsx tools/measure-waiver-cost.ts [--people=200]
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, waivers and signatures, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { WAIVER_MAX_CHARS, memberListEntriesQuerySchema } from "@app/shared";
import { createMemoryRedis } from "../src/redis.js";
import { membersAgainstList } from "../src/modules/orgs/memberList/repo.js";
import { readEntries, readList, type MemberListDeps } from "../src/modules/orgs/memberList/service.js";
import { signaturesOf, waiverInUse } from "../src/modules/orgs/waiver/repo.js";
import { getDeskWaiver, getGymWaiver, getMyWaiver, saveGymWaiver, signAtDesk, signMyWaiver, type WaiverDeps } from "../src/modules/orgs/waiver/service.js";
import { signedRecords } from "../src/modules/orgs/waiver/signed.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-waiver-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2000 : Number(peopleArg.slice("--people=".length));
const OTHER_GYMS = 19;
const OTHER_PEOPLE = 200;
const RUNS = 20;
const BURST = 20;
const PLAN = "zz_waiver_cost";
const PREFIX = "waiver-cost-";
if (!Number.isInteger(PEOPLE) || PEOPLE < 200) {
  console.error("measure-waiver-cost: --people= takes a whole number, 200 or more");
  process.exit(2);
}
const LONGEST = "I take part at my own risk. ".repeat(Math.ceil(WAIVER_MAX_CHARS / 28)).slice(0, WAIVER_MAX_CHARS - 10);

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_waiver_desk_signatures WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_waiver_signatures WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_waivers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

/** A table filled seconds ago has no statistics, and a plan made without them is not the
 *  one a gym meets (`measure-bookings-cost.ts`). */
async function analyse(): Promise<void> {
  for (const table of ["users", "gyms", "gym_staff", "gym_members", "gym_member_list_entries", "gym_waivers", "gym_waiver_signatures", "gym_waiver_desk_signatures"]) {
    await sql`VACUUM ANALYZE ${sql(table)}`;
  }
}

interface Gym {
  id: string;
  owner: string;
  waiverId: string;
  /** People in the app who have signed, and who have not. */
  signed: string[];
  unsigned: string[];
  /** Records with nobody in the app that have not signed at the desk. */
  deskUnsigned: string[];
}

/** One gym with `size` people on its list, six in ten of them in the app, a waiver of the
 *  longest size, signed by every other person in the app. */
async function makeGym(size: number): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${id}, ${PREFIX + id}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const entries = Array.from({ length: size }, (_, i) => {
    const entryId = randomUUID();
    return {
      id: entryId,
      gym_id: id,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}l-${String(i)}-${entryId}@example.com`,
      identity_key: createHash("sha256").update(entryId).digest("hex"),
      source: "upload",
    };
  });
  for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
  const accounts = entries.filter((_, i) => i % 10 < 6).map((e) => ({ id: randomUUID(), email: e.email, display_name: e.full_name, entry: e.id }));
  for (let i = 0; i < accounts.length; i += 1000) {
    const part = accounts.slice(i, i + 1000);
    await sql`INSERT INTO users ${sql(part.map((a) => ({ id: a.id, email: a.email, display_name: a.display_name })))}`;
    await sql`INSERT INTO gym_members ${sql(part.map((a) => ({ gym_id: id, user_id: a.id, entry_id: a.entry })))}`;
  }
  const waiverId = randomUUID();
  await sql`INSERT INTO gym_waivers (id, gym_id, version, body, saved_by) VALUES (${waiverId}, ${id}, 1, ${LONGEST}, ${owner})`;
  const signed = accounts.filter((_, i) => i % 2 === 0).map((a) => a.id);
  const unsigned = accounts.filter((_, i) => i % 2 === 1).map((a) => a.id);
  for (let i = 0; i < signed.length; i += 1000) {
    await sql`INSERT INTO gym_waiver_signatures ${sql(signed.slice(i, i + 1000).map((userId) => ({ gym_id: id, waiver_id: waiverId, user_id: userId, signed_name: "Person Cost" })))}`;
  }
  // A quarter of the records with nobody in the app signed at the desk.
  const noApp = entries.filter((_, i) => i % 10 >= 6).map((e) => e.id);
  const atDesk = noApp.filter((_, i) => i % 4 === 0);
  for (let i = 0; i < atDesk.length; i += 1000) {
    await sql`INSERT INTO gym_waiver_desk_signatures ${sql(atDesk.slice(i, i + 1000).map((entryId) => ({ gym_id: id, waiver_id: waiverId, entry_id: entryId, signer: "person", signed_name: "Person Cost", witnessed_by: owner })))}`;
  }
  return { id, owner, waiverId, signed, unsigned, deskUnsigned: noApp.filter((_, i) => i % 4 !== 0) };
}

const deps: WaiverDeps = { sql, now: () => new Date() };
const yes = () => Promise.resolve(true);

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const delay = monitorEventLoopDelay({ resolution: 1 });

async function measure(name: string, run: (i: number) => Promise<unknown>, runs = RUNS): Promise<void> {
  const walls: number[] = [];
  const busy: number[] = [];
  const stalls: number[] = [];
  for (let i = 0; i < runs + 1; i++) {
    delay.reset();
    delay.enable();
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    await run(i);
    const wall = performance.now() - start;
    delay.disable();
    // The first run warms the connections and is not counted.
    if (i === 0) continue;
    walls.push(wall);
    busy.push(performance.eventLoopUtilization(before).active);
    stalls.push(delay.max / 1e6);
  }
  console.log(
    `  ${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} · longest stall ${fmt(Math.max(...stalls))}`,
  );
}

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const big = await makeGym(PEOPLE);
const others: Gym[] = [];
for (let n = 0; n < OTHER_GYMS; n++) others.push(await makeGym(OTHER_PEOPLE));
const all = [big, ...others];
await analyse();
const inApp = big.signed.length + big.unsigned.length;
const pick = (ids: readonly string[], i: number): string => {
  const id = ids[i % ids.length];
  if (id === undefined) throw new Error("nobody to pick");
  return id;
};

console.log(
  `one gym of ${String(PEOPLE)} (${String(inApp)} in the app) beside ${String(OTHER_GYMS)} of ${String(OTHER_PEOPLE)}; a waiver of ${String(LONGEST.length)} characters; cpu ${String(os.cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each, medians`,
);

console.log("Settings' Waiver box (the words, and how many have signed):");
await measure(`the gym of ${String(PEOPLE)}`, async () => {
  const got = await getGymWaiver(deps, big.owner, big.id, yes);
  if (got?.people !== inApp || got.signed !== big.signed.length) throw new Error(`the box counted ${String(got?.signed)} of ${String(got?.people)}`);
});
await measure(`the gym of ${String(PEOPLE)}, its 5 staff at one moment`, async () => {
  await Promise.all(Array.from({ length: 5 }, () => getGymWaiver(deps, big.owner, big.id, yes)));
});
await measure("all 20 gyms at one moment", async () => {
  await Promise.all(all.map((gym) => getGymWaiver(deps, gym.owner, gym.id, yes)));
});

console.log("a person's page, what it reads more than before:");
await measure("the waiver in use and one person's signature", async (i) => {
  const waiver = await waiverInUse(sql, big.id);
  if (waiver === null) throw new Error("no waiver in use");
  await signaturesOf(sql, big.id, waiver.id, [pick(big.signed, i)]);
});

console.log("a member:");
await measure("reads the waiver", async (i) => {
  const got = await getMyWaiver(deps, pick(big.signed, i), big.id, yes);
  if (got?.signed === null || got?.waiver === null) throw new Error("the member's read was not a signed waiver");
});
await measure(`${String(BURST)} members read it at the same moment`, async (i) => {
  await Promise.all(Array.from({ length: BURST }, (_, n) => getMyWaiver(deps, pick(big.unsigned, i * BURST + n), big.id, yes)));
});
await measure("one at each of the 20 gyms reads it at the same moment", async (i) => {
  await Promise.all(all.map((gym) => getMyWaiver(deps, pick(gym.unsigned, i), gym.id, yes)));
});
// Each run signs for people who have not signed yet.
let next = 0;
await measure("signs it", async () => {
  const got = await signMyWaiver(deps, pick(big.unsigned, next++), big.id, { waiverId: big.waiverId, name: "Person Cost" }, yes);
  if (got === null) throw new Error("the signature was not written");
});
await measure(
  `${String(BURST)} members sign at the same moment`,
  async () => {
    const signers = Array.from({ length: BURST }, () => pick(big.unsigned, next++));
    await Promise.all(signers.map((userId) => signMyWaiver(deps, userId, big.id, { waiverId: big.waiverId, name: "Person Cost" }, yes)));
  },
  5,
);

const listDeps: MemberListDeps = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => new Date() };
const notSignedQuery = memberListEntriesQuerySchema.parse({ waiver: "not_signed" });
console.log("Members, Waiver not signed (3e-ii):");
await measure("who has signed, by record (the one rule's own read)", async () => {
  await signedRecords(sql, big.id, await membersAgainstList(sql, big.id));
});
await measure(`the list's numbers, with the count beside the choice`, async () => {
  const got = await readList(listDeps, big.owner, big.id, yes);
  if (got?.waiverNotSigned == null) throw new Error("the list read no waiver count");
});
const plainQuery = memberListEntriesQuerySchema.parse({});
await measure("one page of everybody, no filter (as before this job)", async () => {
  await readEntries(listDeps, big.owner, big.id, plainQuery, yes);
});
await measure("one page of the people who have not signed", async () => {
  const got = await readEntries(listDeps, big.owner, big.id, notSignedQuery, yes);
  if (got === null || got.total === 0) throw new Error("the page found nobody");
});
await measure("a page of everybody, all 20 gyms at one moment (as before)", async () => {
  await Promise.all(all.map((gym) => readEntries(listDeps, gym.owner, gym.id, plainQuery, yes)));
});
await measure("the page not signed, all 20 gyms at one moment", async () => {
  await Promise.all(all.map((gym) => readEntries(listDeps, gym.owner, gym.id, notSignedQuery, yes)));
});
console.log("the desk's box (3e-ii):");
await measure("reads the words for one person", async (i) => {
  const got = await getDeskWaiver(deps, big.owner, big.id, pick(big.deskUnsigned, i), yes);
  if (got?.waiver === null) throw new Error("the box read no waiver");
});
let nextDesk = 0;
await measure("signs for one person", async () => {
  const got = await signAtDesk(deps, big.owner, big.id, pick(big.deskUnsigned, nextDesk++), { waiverId: big.waiverId, signer: "person", name: "Person Cost" }, yes);
  if (got === null) throw new Error("the desk signature was not written");
});

console.log("Save, with changed words (everybody is asked again):");
await measure(`the gym of ${String(PEOPLE)}`, async (i) => {
  const got = await saveGymWaiver(deps, big.owner, big.id, `${LONGEST} ${String(i)}`, yes);
  if (got?.signed !== 0) throw new Error("a changed waiver still counted signatures");
});

await cleanup();
await sql.end();
