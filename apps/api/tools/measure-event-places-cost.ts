// What "I'm coming" costs at full size (ROADMAP 19c-ii; CLAUDE.md §4 "Cost at full size").
// One gym of 200 live app members (--members= for another size) with the most coming
// events a gym may keep (100). All but the last two are full: three members in ten are
// coming, the next 100 wait (the most a gym's waitlist may hold), and the rest are not
// down for it. Two numbers each, over several runs:
//   - total: how long it takes (a write holds the gym's row meanwhile);
//   - server thread busy: how long the server's one thread answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-event-places-cost.ts [--members=200]
//
// LOCAL DATABASES ONLY: it writes a gym, its accounts, events and places, and removes them.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { GYM_EVENTS_COMING_MAX } from "@app/shared";
import { createLine } from "../src/modules/orgs/classes/bookingsService.js";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import { come, endLeaversPlaces, getPeople, handOverComingEvents, notComing, removePerson } from "../src/modules/orgs/events/places.js";
import { getEvents, getStaffEvents } from "../src/modules/orgs/events/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-event-places-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api holds (Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const membersArg = process.argv.find((a) => a.startsWith("--members="));
const MEMBERS = membersArg === undefined ? 200 : Number(membersArg.slice("--members=".length));
const RUNS = 5;
const PLAN = "zz_event_places_cost";
const PREFIX = "event-places-cost-";
const PLACES = Math.floor(MEMBERS * 0.3);
const WAITLIST = Math.min(100, MEMBERS - PLACES);

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_events WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Seeded {
  gymId: string;
  owner: string;
  members: string[];
  /** A full event with a full waitlist, the soonest. */
  full: string;
  /** Two events nobody is down for: one with no limit, one with as many places as members. */
  open: string;
  roomy: string;
}

async function seed(): Promise<Seeded> {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const users = Array.from({ length: MEMBERS + 1 }, (_, i) => ({ id: randomUUID(), email: `${PREFIX}${String(i)}-${randomUUID()}@example.com`, display_name: `Member Number${String(i)}` }));
  for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
  const owner = users[0]?.id ?? "";
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, owner_user_id, waitlist_max) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', ${owner}, 100)`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const memberIds = users.slice(1).map((u) => u.id);
  const rows = memberIds.map((id) => ({ gym_id: gymId, user_id: id, joined_at: new Date(Date.now() - 365 * 86_400_000) }));
  for (let i = 0; i < rows.length; i += 1000) await sql`INSERT INTO gym_members ${sql(rows.slice(i, i + 1000))}`;
  // Each event ten days out and a day apart, so a freed place is handed over by itself.
  const events = await sql<{ id: string; n: number }[]>`
    INSERT INTO gym_events (gym_id, event_key, name, details, place, starts_on, start_minute, ends_on, end_minute, starts_at, ends_at, places)
    SELECT ${gymId}, gen_random_uuid(), 'Event ' || n, repeat('Words of an event. ', 52), repeat('P', 120),
           (t.at AT TIME ZONE 'Europe/London')::date, 600, (t.at AT TIME ZONE 'Europe/London')::date, 660, t.at, t.at + interval '1 hour',
           CASE WHEN n = ${GYM_EVENTS_COMING_MAX - 1} THEN NULL WHEN n = ${GYM_EVENTS_COMING_MAX} THEN ${MEMBERS}::int ELSE ${PLACES}::int END
    FROM generate_series(1, ${GYM_EVENTS_COMING_MAX}) AS n, LATERAL (SELECT now() + interval '10 days' + n * interval '1 day' AS at) AS t
    RETURNING id, (substring(name from 7))::int AS n`;
  const byN = new Map(events.map((e) => [e.n, e.id]));
  const busy = events.filter((e) => e.n <= GYM_EVENTS_COMING_MAX - 2).map((e) => e.id);
  // The first members are coming to each, the next 100 wait, in the members' order.
  await sql`
    INSERT INTO gym_event_places (gym_id, event_id, user_id, status, request_key, coming_at)
    SELECT ${gymId}, e.id, m.id, CASE WHEN m.i <= ${PLACES} THEN 'coming' ELSE 'waitlisted' END, gen_random_uuid(),
           CASE WHEN m.i <= ${PLACES} THEN now() END
    FROM unnest(${busy}::uuid[]) AS e(id), unnest(${memberIds}::uuid[]) WITH ORDINALITY AS m(id, i)
    WHERE m.i <= ${PLACES + WAITLIST}
    ORDER BY e.id, m.i`;
  await sql`ANALYZE gym_events`;
  await sql`ANALYZE gym_event_places`;
  return { gymId, owner, members: memberIds, full: byN.get(1) ?? "", open: byN.get(GYM_EVENTS_COMING_MAX - 1) ?? "", roomy: byN.get(GYM_EVENTS_COMING_MAX) ?? "" };
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

function report(name: string, runs: { wall: number; js: number }[]): void {
  const walls = runs.map((r) => r.wall);
  const jss = runs.map((r) => r.js);
  console.log(`${name.padEnd(52)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}

class RolledBack extends Error {}
/** Runs `work` in a transaction that is then undone, so each run meets the same gym. */
async function undone(work: (tx: postgres.TransactionSql) => Promise<void>): Promise<void> {
  await sql
    .begin(async (tx) => {
      await work(tx);
      throw new RolledBack();
    })
    .catch((err: unknown) => {
      if (!(err instanceof RolledBack)) throw err;
    });
}

await cleanup();
const seeded = await seed();
const { gymId, owner, members, full, open, roomy } = seeded;
const folder = await mkdtemp(join(tmpdir(), "aihg-event-places-cost-"));
try {
  const now = () => new Date();
  const eventsDeps = { sql, now, photos: createDiskPhotoStore(folder), log: { warn: () => undefined } };
  const deps = { sql, now, inLine: createLine() };
  const allowed = (): Promise<boolean> => Promise.resolve(true);
  const coming = members[0] ?? "";
  const waiting = members[PLACES] ?? "";
  const counted = await sql<{ events: number; coming: number; waiting: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_events WHERE gym_id = ${gymId}) AS events,
           count(*) FILTER (WHERE status = 'coming')::int AS coming, count(*) FILTER (WHERE status = 'waitlisted')::int AS waiting
    FROM gym_event_places WHERE gym_id = ${gymId}`;
  console.log(
    `one gym: ${String(MEMBERS)} members, ${String(counted[0]?.events ?? 0)} coming events, ${String(counted[0]?.coming ?? 0)} places taken and ${String(counted[0]?.waiting ?? 0)} waiting in all (${String(PLACES)} coming and ${String(WAITLIST)} waiting an event); cpu ${String(cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`,
  );
  const list = await getEvents(eventsDeps, waiting, gymId, allowed);
  console.log(`a member's list: ${String(list?.events.length ?? 0)} events, ${String(JSON.stringify(list).length)} bytes of JSON`);

  const reads: [string, () => Promise<unknown>][] = [
    ["member, the coming events (they wait for 98)", () => getEvents(eventsDeps, waiting, gymId, allowed)],
    ["staff, the coming events with their counts", () => getStaffEvents(eventsDeps, owner, gymId, allowed)],
    [`${String(MEMBERS)} members ask for the list at the same instant`, () => Promise.all(members.map((id) => getEvents(eventsDeps, id, gymId, allowed)))],
    [`staff, who is coming (${String(PLACES)} and ${String(WAITLIST)} waiting)`, () => getPeople(deps, owner, gymId, full, allowed)],
  ];
  for (const [name, fn] of reads) {
    await fn();
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await time(fn));
    report(name, runs);
  }

  const reset = async (eventId: string) => {
    await sql`DELETE FROM gym_event_places WHERE gym_id = ${gymId} AND event_id = ${eventId}`;
  };
  const taps = [];
  const backs = [];
  const crowds = [];
  const refusals = [];
  for (let i = 0; i < RUNS; i++) {
    await reset(open);
    taps.push(await time(() => come(deps, coming, gymId, open, { requestKey: randomUUID(), joinWaitlist: false }, allowed)));
    backs.push(await time(() => notComing(deps, coming, gymId, open, allowed)));
    await reset(roomy);
    // Every member taps one event at once: each is one transaction under the gym's row.
    crowds.push(await time(() => Promise.all(members.map((id) => come(deps, id, gymId, roomy, { requestKey: randomUUID(), joinWaitlist: false }, allowed)))));
    // The same crowd again on the event that is full with a full waitlist: every one a "no".
    const outside = members.slice(PLACES + WAITLIST);
    refusals.push(
      await time(() =>
        Promise.all(outside.map((id) => come(deps, id, gymId, full, { requestKey: randomUUID(), joinWaitlist: true }, allowed).catch(() => null))),
      ),
    );
  }
  report("one member says I'm coming", taps);
  report("and Can't come", backs);
  report(`${String(MEMBERS)} members say I'm coming at the same instant`, crowds);
  report(`${String(MEMBERS - PLACES - WAITLIST)} members tap a full event with a full waitlist`, refusals);

  const handed = [];
  const removed = [];
  const leaves = [];
  const settings = [];
  for (let i = 0; i < RUNS; i++) {
    // A place given up at a full event goes to the first of 100 waiting.
    handed.push(await time(() => notComing(deps, coming, gymId, full, allowed)));
    const [first] = await sql<{ id: string }[]>`SELECT id FROM gym_event_places WHERE gym_id = ${gymId} AND event_id = ${full} AND status = 'coming' ORDER BY seq LIMIT 1`;
    removed.push(await time(() => removePerson(deps, owner, gymId, full, first?.id ?? "", allowed)));
    // Put the event back as it was seeded.
    await sql`DELETE FROM gym_event_places WHERE gym_id = ${gymId} AND event_id = ${full}`;
    await sql`
      INSERT INTO gym_event_places (gym_id, event_id, user_id, status, request_key, coming_at)
      SELECT ${gymId}, ${full}, m.id, CASE WHEN m.i <= ${PLACES} THEN 'coming' ELSE 'waitlisted' END, gen_random_uuid(), CASE WHEN m.i <= ${PLACES} THEN now() END
      FROM unnest(${members}::uuid[]) WITH ORDINALITY AS m(id, i) WHERE m.i <= ${PLACES + WAITLIST} ORDER BY m.i`;
    // Somebody coming to 98 events leaves the gym: 98 places end, each handed to its waitlist.
    leaves.push(await time(() => undone((tx) => endLeaversPlaces(tx, gymId, [coming], new Date()))));
    // Ten people coming to every event leave at once, then the gym's hand-over setting is
    // saved shorter: every event with a waitlist is looked at.
    settings.push(
      await time(() =>
        undone(async (tx) => {
          await tx`UPDATE gym_event_places SET status = 'cancelled', cancelled_at = now() WHERE gym_id = ${gymId} AND status = 'coming' AND user_id = ANY(${members.slice(0, 10)}::uuid[])`;
          await handOverComingEvents(tx, gymId, new Date());
        }),
      ),
    );
  }
  report("Can't come at a full event: the first of 100 moves in", handed);
  report("staff remove a person from a full event", removed);
  report("a member down for 98 events leaves the gym", leaves);
  report("98 events hand 10 places each to their waitlists", settings);
} finally {
  await cleanup();
  await rm(folder, { recursive: true, force: true });
  await sql.end({ timeout: 5 });
}
