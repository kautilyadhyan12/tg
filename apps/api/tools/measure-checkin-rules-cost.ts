// What "Who can check in" costs (ROADMAP 16d; CLAUDE.md §4 "Cost at full size"). One gym
// of 2,000 people on its list (--people= for another size) beside 19 gyms of 200, the
// launch shape. In each gym seven in ten hold a paid Gold Monthly, one in ten holds one
// with a bill ten days overdue, one in ten a cancelled one, and one in ten nothing. Six in
// ten are in the app, on their own record, and one more person in a hundred is in the app
// on no record at all.
//
// For each thing the desk, staff and the owner do: a key tag read with the gym's choice
// where it starts (nothing extra is read) and with both choices on, for somebody let in
// and somebody stopped; twenty read at the same moment; one at each of the 20 gyms at the
// same moment; staff's search; the box in Settings naming who would be stopped; and Save.
// Since 3e-ii, last: every gym asks for a waiver its people in the app on a record have
// signed, and the desk sends whoever has not signed to staff.
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_c'
//   corepack pnpm --filter api exec tsx tools/measure-checkin-rules-cost.ts [--people=200]
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, memberships and bills, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import type { CheckinRules } from "@app/shared";
import { createMemoryRedis } from "../src/redis.js";
import { DESK_RULES_START, type DeskDevice } from "../src/modules/orgs/checkin/repo.js";
import { findPeople, previewRules, saveRules, scan, type CheckinDeps } from "../src/modules/orgs/checkin/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-checkin-rules-cost: DATABASE_URL must be a local database");
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
const PLAN = "zz_checkin_rules_cost";
const PREFIX = "checkin-rules-cost-";
const ZONE = "Europe/London";
const STRICT: CheckinRules = { who: "current_membership", overdue: "see_staff", waiver: "let_in" };
if (!Number.isInteger(PEOPLE) || PEOPLE < 200) {
  console.error("measure-checkin-rules-cost: --people= takes a whole number, 200 or more");
  process.exit(2);
}

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_waiver_signatures WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_waivers WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

/** A table filled seconds ago has no statistics, and a plan made without them is not the
 *  one a gym meets (`measure-bookings-cost.ts`). */
async function analyse(): Promise<void> {
  for (const table of ["users", "gyms", "gym_staff", "gym_members", "gym_member_list_entries", "gym_held_memberships", "gym_member_bills", "gym_membership_types", "gym_attendance", "gym_waivers", "gym_waiver_signatures"]) {
    await sql`VACUUM ANALYZE ${sql(table)}`;
  }
}

interface Gym {
  id: string;
  owner: string;
  device: DeskDevice;
}

/** One gym with `size` people: person i is paid up (i % 10 < 7), overdue (7), cancelled
 *  (8) or holds nothing (9). Its key tags are `${tag}${i}`. */
async function makeGym(size: number, tag: string): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${id}, ${PREFIX + id}, 'Cost Gym', ${ZONE}, 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const deviceId = randomUUID();
  await sql`INSERT INTO gym_checkin_devices (id, gym_id, name, created_by_user_id) VALUES (${deviceId}, ${id}, 'Front desk', ${owner})`;
  const gold = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${gold}, ${id}, 'Gold Monthly', 'recurring', 4500, 'GBP', 1, 'month', 'all_classes')`;
  const entries = Array.from({ length: size }, (_, i) => {
    const entryId = randomUUID();
    return {
      id: entryId,
      gym_id: id,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}l-${String(i)}-${entryId}@example.com`,
      member_number: `${tag}${String(i)}`,
      identity_key: createHash("sha256").update(entryId).digest("hex"),
      source: "upload",
      // The kind of person, kept in a word of the list's own so the statements below can read it.
      status: ["paid", "paid", "paid", "paid", "paid", "paid", "paid", "overdue", "cancelled", "nothing"][i % 10] ?? "paid",
    };
  });
  for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
  // Six in ten are in the app on their own record's address; one in a hundred more is in
  // the app on no record.
  const inApp = entries.filter((_, i) => i % 10 < 6).map((e) => ({ id: randomUUID(), email: e.email, display_name: e.full_name, entry: e.id }));
  const offList = Array.from({ length: Math.floor(size / 100) }, (_, i) => {
    const userId = randomUUID();
    return { id: userId, email: `${PREFIX}a-${String(i)}-${userId}@example.com`, display_name: `Apponly${String(i)} Cost`, entry: null };
  });
  const accounts = [...inApp, ...offList];
  for (let i = 0; i < accounts.length; i += 1000) {
    const part = accounts.slice(i, i + 1000);
    await sql`INSERT INTO users ${sql(part.map((a) => ({ id: a.id, email: a.email, display_name: a.display_name })))}`;
    await sql`INSERT INTO gym_members ${sql(part.map((a) => ({ gym_id: id, user_id: a.id, entry_id: a.entry })))}`;
  }
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, cancelled_on, paid_periods, renews)
    SELECT ${id}, e.id, ${gold}, gen_random_uuid(), 'recurring', 4500, 'GBP', 1, 'month', current_date - 10,
           CASE WHEN e.status = 'cancelled' THEN 'cancelled' ELSE 'active' END,
           CASE WHEN e.status = 'cancelled' THEN current_date - 3 END,
           CASE WHEN e.status = 'overdue' THEN 0 ELSE 1 END, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id} AND e.status <> 'nothing'`;
  await sql`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to)
    SELECT ${id}, h.id, 0, 4500, 'GBP', h.starts_on, h.starts_on, (h.starts_on + interval '1 month' - interval '1 day')::date
    FROM gym_held_memberships h WHERE h.gym_id = ${id} AND h.paid_periods = 0`;
  return { id, owner, device: { deviceId, gymId: id, gymName: "Cost Gym", timezone: ZONE, clockFormat: "24h", ...DESK_RULES_START } };
}

/** A desk's key tags are limited to 20 a minute in Redis: each read here gets its own, so
 *  the limit is never what is measured. */
const deps = (): CheckinDeps => ({
  sql,
  redis: createMemoryRedis(),
  now: () => new Date(),
  passKey: null,
  webOrigin: "http://localhost:5173",
  log: { warn: () => undefined },
});
const yes = () => Promise.resolve(true);

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const delay = monitorEventLoopDelay({ resolution: 1 });

/** `run(i)` is given the run's number, so a run that writes a visit names fresh people. */
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
const big = await makeGym(PEOPLE, "B");
const others: Gym[] = [];
for (let n = 0; n < OTHER_GYMS; n++) others.push(await makeGym(OTHER_PEOPLE, `S${String(n)}x`));
const all = [big, ...others];
await analyse();
const strictDesk = (gym: Gym): DeskDevice => ({ ...gym.device, rules: STRICT });
/** The nth person of a kind in the big gym: kinds repeat every ten people. */
const tagOf = (kind: number, n: number): string => `B${String(n * 10 + kind)}`;
const empty = async (): Promise<void> => {
  await sql`DELETE FROM gym_attendance WHERE gym_id = ANY(${all.map((g) => g.id)}::uuid[])`;
};

console.log(
  `one gym of ${String(PEOPLE)} beside ${String(OTHER_GYMS)} of ${String(OTHER_PEOPLE)}; cpu ${String(os.cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each, medians`,
);
console.log("the desk:");
await empty();
await measure("a key tag, the gym's choice where it starts", async (i) => {
  const answer = await scan(deps(), big.device, tagOf(0, i));
  if (answer.result !== "checked_in") throw new Error(`the scan answered ${answer.result}`);
});
await empty();
await measure("a key tag, both choices on, somebody paid up", async (i) => {
  const answer = await scan(deps(), strictDesk(big), tagOf(0, i));
  if (answer.result !== "checked_in") throw new Error(`the scan answered ${answer.result}`);
});
await measure("a key tag, both choices on, a payment overdue", async (i) => {
  const answer = await scan(deps(), strictDesk(big), tagOf(7, i));
  if (answer.result !== "see_staff") throw new Error(`the scan answered ${answer.result}`);
});
await measure("a key tag, both choices on, nothing held", async (i) => {
  const answer = await scan(deps(), strictDesk(big), tagOf(9, i));
  if (answer.result !== "see_staff") throw new Error(`the scan answered ${answer.result}`);
});
await empty();
await measure(`${String(BURST)} key tags at the same moment, both choices on`, async (i) => {
  // Kinds 1 and 2 are paid up: twenty fresh people each run.
  const answers = await Promise.all(Array.from({ length: BURST }, (_, n) => scan(deps(), strictDesk(big), tagOf(1 + (n % 2), i * 10 + Math.floor(n / 2)))));
  if (answers.some((answer) => answer.result !== "checked_in")) throw new Error("a scan in the burst did not check in");
}, 5);
await empty();
await measure("one key tag at each of the 20 gyms at the same moment", async (i) => {
  const answers = await Promise.all([scan(deps(), strictDesk(big), tagOf(3, i)), ...others.map((gym, n) => scan(deps(), strictDesk(gym), `S${String(n)}x${String(i * 10 + 3)}`))]);
  if (answers.some((answer) => answer.result !== "checked_in")) throw new Error("a scan at one of the gyms did not check in");
}, 15);

console.log("staff's search (ten people found):");
await measure("the gym's choice where it starts", async () => {
  const got = await findPeople(deps(), big.owner, big.id, "Person1", yes);
  if (got?.people.length !== 10) throw new Error("the search did not find ten");
});
await sql`UPDATE gyms SET checkin_who = 'current_membership', checkin_overdue = 'see_staff' WHERE id = ANY(${all.map((g) => g.id)}::uuid[])`;
await measure("both choices on", async () => {
  const got = await findPeople(deps(), big.owner, big.id, "Person1", yes);
  if (got?.people.length !== 10 || !got.people.some((p) => p.stopped !== null)) throw new Error("the search did not say who is stopped");
});

console.log("the box in Settings, who would be stopped today:");
const expectStopped = (size: number): number => Math.floor(size / 10) * 3;
await measure(`the gym of ${String(PEOPLE)}`, async () => {
  const got = await previewRules(deps(), big.owner, big.id, STRICT, yes);
  if (got?.stopped !== expectStopped(PEOPLE)) throw new Error(`the box counted ${String(got?.stopped)}`);
  if (got.notListed !== Math.floor(PEOPLE / 100)) throw new Error(`the box counted ${String(got.notListed)} people on no record`);
});
await measure(`the gym of ${String(PEOPLE)}, its 5 staff at one moment`, async () => {
  await Promise.all(Array.from({ length: 5 }, () => previewRules(deps(), big.owner, big.id, STRICT, yes)));
});
const small = others[0];
if (small === undefined) throw new Error("no small gym");
await measure(`a gym of ${String(OTHER_PEOPLE)}`, async () => {
  const got = await previewRules(deps(), small.owner, small.id, STRICT, yes);
  if (got?.stopped !== expectStopped(OTHER_PEOPLE)) throw new Error(`the box counted ${String(got?.stopped)}`);
});
await measure("all 20 gyms at one moment", async () => {
  await Promise.all(all.map((gym) => previewRules(deps(), gym.owner, gym.id, STRICT, yes)));
});
await measure("Save", async (i) => {
  await saveRules(deps(), big.owner, big.id, i % 2 === 0 ? STRICT : { who: "everyone", overdue: "let_in", waiver: "let_in" }, yes);
});

console.log("a waiver not signed is sent to staff (3e-ii):");
const WAIVER: CheckinRules = { who: "everyone", overdue: "let_in", waiver: "see_staff" };
for (const gym of all) {
  const [waiver] = await sql<{ id: string }[]>`
    INSERT INTO gym_waivers (gym_id, version, body, saved_by) VALUES (${gym.id}, 1, 'I take part at my own risk.', ${gym.owner}) RETURNING id`;
  await sql`
    INSERT INTO gym_waiver_signatures (gym_id, waiver_id, user_id, signed_name)
    SELECT m.gym_id, ${waiver?.id ?? null}, m.user_id, 'Person Cost' FROM gym_members m WHERE m.gym_id = ${gym.id} AND m.entry_id IS NOT NULL`;
}
await analyse();
const waiverDesk = (gym: Gym): DeskDevice => ({ ...gym.device, rules: WAIVER });
await empty();
await measure("a key tag, somebody in the app who signed", async (i) => {
  const answer = await scan(deps(), waiverDesk(big), tagOf(0, i));
  if (answer.result !== "checked_in") throw new Error(`the scan answered ${answer.result}`);
});
await measure("a key tag, somebody with no app who has not", async (i) => {
  const answer = await scan(deps(), waiverDesk(big), tagOf(8, i));
  if (answer.result !== "see_staff") throw new Error(`the scan answered ${answer.result}`);
});
await empty();
await measure("one key tag at each of the 20 gyms at the same moment", async (i) => {
  const answers = await Promise.all([scan(deps(), waiverDesk(big), tagOf(4, i)), ...others.map((gym, n) => scan(deps(), waiverDesk(gym), `S${String(n)}x${String(i * 10 + 4)}`))]);
  if (answers.some((answer) => answer.result !== "checked_in")) throw new Error("a scan at one of the gyms did not check in");
}, 15);
await measure(`the box in Settings, the gym of ${String(PEOPLE)}`, async () => {
  const got = await previewRules(deps(), big.owner, big.id, WAIVER, yes);
  if (got?.stopped !== Math.floor(PEOPLE / 10) * 4) throw new Error(`the box counted ${String(got?.stopped)}`);
  if (got.notListed !== Math.floor(PEOPLE / 100)) throw new Error(`the box counted ${String(got.notListed)} people on no record`);
});
await measure("the box in Settings, all 20 gyms at one moment", async () => {
  await Promise.all(all.map((gym) => previewRules(deps(), gym.owner, gym.id, WAIVER, yes)));
});

await cleanup();
await sql.end();
