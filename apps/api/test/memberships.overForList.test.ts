// Which of a person's memberships that are over the Members list names, against real
// Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 23a-i.
//
// The rule (`heldOnList` in `@app/shared`) names the one that finished last. The list
// cannot read every stored row of every person, so `overForList` picks one row a person
// in SQL, working the same order out a second time. This holds the two together: over
// generated memberships of every kind, on several days, the list's answer for each
// person is the rule's answer over ALL of their rows.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { addDays, heldOnList, type GymMembershipTypesResponse, type HeldForList, type HeldMembership } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { inUseForList, overForList } from "../src/modules/orgs/memberships/heldRepo.js";
import { heldOnListOf } from "../src/modules/orgs/memberships/onList.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "over-for-list-test-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_over_for_list";

let ipCounter = 0;
const nextIp = () => `10.72.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-9000-${String(++keyCounter).padStart(12, "0")}`;

// The same choices on every run: a made-up number, never the clock.
let seed = 20261007;
const rand = (below: number): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed >>> 8) % below;
};
function pick<T>(from: readonly T[]): T {
  const one = from[rand(from.length)];
  if (one === undefined) throw new Error("nothing to pick from");
  return one;
}

/** The days the list is read on, and the start days: month ends, a leap day, and the
 *  days around them, so a term that lands on a shorter month is among them. */
const TODAYS = ["2024-02-29", "2025-02-28", "2025-03-01", "2026-10-07", "2026-10-31", "2027-01-31", "2027-02-28"];
const STARTS = [
  "2023-01-31",
  "2023-08-31",
  "2024-01-29",
  "2024-01-30",
  "2024-01-31",
  "2024-02-29",
  "2024-03-31",
  "2024-12-31",
  "2025-02-28",
  "2025-10-31",
  "2026-01-31",
  "2026-08-31",
  "2026-09-07",
  "2026-09-30",
  "2026-10-01",
  "2026-10-07",
  "2026-10-17",
];
const TYPES = 8;

interface Made {
  person: number;
  type: number;
  requestKey: string;
  priceMinor: number;
  fromList: boolean;
  membership: HeldMembership;
}

/** One membership as the table may hold it, of any kind, with this stored status. */
function make(person: number, type: number, status: HeldMembership["status"]): Made {
  const free = rand(5) === 0;
  const startsOn = pick(STARTS);
  const base = {
    free,
    startsOn,
    frozenDays: pick([0, 0, 0, 1, 3, 14, 45]),
    status,
    frozenOn: status === "frozen" ? addDays(startsOn, pick([0, 10])) : null,
    // Before it started, on the day, and long after; and some of the days the list is read on.
    cancelledOn: status === "cancelled" ? pick([addDays(startsOn, -5), startsOn, addDays(startsOn, 1), addDays(startsOn, 30), addDays(startsOn, 200), ...TODAYS]) : null,
  };
  const made = { person, type, requestKey: nextKey(), priceMinor: free ? 0 : 4500, fromList: rand(4) === 0 };
  const kind = pick(["recurring", "one_time", "pack", "trial"] as const);
  if (kind === "pack") {
    const packClasses = pick([1, 5, 10]);
    const pack = { termCount: null, termUnit: null, packClasses, packDays: pick([1, 30, 90, 365]), classesLeft: rand(packClasses + 1) };
    return { ...made, membership: { ...base, ...pack, kind, paidPeriods: free ? 0 : rand(2), paidFloor: 0, renews: false } };
  }
  const none = { packClasses: null, packDays: null, classesLeft: null };
  if (kind === "recurring") {
    const paidFloor = free ? 0 : rand(3);
    const term = { termCount: pick([1, 2, 3, 6, 12]), termUnit: pick(["week", "month", "year"] as const) };
    return { ...made, membership: { ...base, ...none, ...term, kind, paidPeriods: free ? 0 : paidFloor + rand(4), paidFloor, renews: rand(2) === 0 } };
  }
  const term = { termCount: pick([1, 3, 7, 12, 30]), termUnit: pick(["day", "week", "month", "year"] as const) };
  return { ...made, membership: { ...base, ...none, ...term, kind, paidPeriods: free ? 0 : rand(2), paidFloor: 0, renews: false } };
}

const OVER = ["ended", "cancelled"] as const;
const IN_USE = ["active", "active", "frozen"] as const;

/** Every person's memberships. */
function everybody(): { people: number; made: Made[] } {
  const made: Made[] = [];
  let person = 0;
  const give = (count: number, status: () => HeldMembership["status"]): void => {
    // A different type each, so the name the list says tells which row was chosen.
    for (let type = 0; type < count; type += 1) made.push(make(person, (person + type) % TYPES, status()));
  };
  // Only memberships stored over: the one row SQL picks is the whole answer.
  for (; person < 30; person += 1) give(1 + rand(6), () => pick(OVER));
  // Stored over and stored in use, which the clock has ended on some of the days.
  for (; person < 45; person += 1) {
    give(1 + rand(4), () => pick(OVER));
    made.push(make(person, (person + 6) % TYPES, pick(IN_USE)));
    if (rand(2) === 0) made.push(make(person, (person + 7) % TYPES, "active"));
  }
  // Only stored in use.
  for (; person < 50; person += 1) give(1 + rand(3), () => pick(IN_USE));
  // Two the same in everything but their type: the id alone decides.
  for (; person < 54; person += 1) {
    const one = make(person, 0, pick(OVER));
    made.push(one, { ...one, type: 1, requestKey: nextKey() });
  }
  // The same last day, 30 September 2026: a membership is named before a pack, though
  // the pack started later.
  const ended = { free: false, frozenDays: 0, status: "ended", frozenOn: null, cancelledOn: null, paidPeriods: 1, paidFloor: 0, renews: false } as const;
  const noPack = { packClasses: null, packDays: null, classesLeft: null };
  for (; person < 56; person += 1) {
    made.push({
      person,
      type: 0,
      requestKey: nextKey(),
      priceMinor: 4500,
      fromList: false,
      membership: { ...ended, ...noPack, kind: "one_time", termCount: 30, termUnit: "day", startsOn: "2026-09-01" },
    });
    made.push({
      person,
      type: 1,
      requestKey: nextKey(),
      priceMinor: 1500,
      fromList: false,
      membership: { ...ended, kind: "pack", termCount: null, termUnit: null, packClasses: 1, packDays: 1, classesLeft: 1, startsOn: "2026-09-30" },
    });
  }
  // Stored ended though it renews. The app writes no such row and the table can hold one:
  // it has no last day, so its start day stands in, and the one that ran out in March is named.
  for (; person < 58; person += 1) {
    made.push({
      person,
      type: 0,
      requestKey: nextKey(),
      priceMinor: 4500,
      fromList: false,
      membership: { ...ended, ...noPack, kind: "recurring", termCount: 1, termUnit: "month", startsOn: "2026-01-31", paidPeriods: 3, renews: true },
    });
    made.push({
      person,
      type: 1,
      requestKey: nextKey(),
      priceMinor: 4500,
      fromList: false,
      membership: { ...ended, ...noPack, kind: "one_time", termCount: 30, termUnit: "day", startsOn: "2026-02-14" },
    });
  }
  // Nobody's: a person with no membership at all.
  return { people: person + 2, made };
}

d("the stored row the Members list reads for somebody whose memberships are over (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ofl-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'ofl-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Cookies = {}) =>
    api().inject({ method: "POST", url: path, remoteAddress: nextIp(), cookies, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });

  /** A gym with its owner signed in, `TYPES` membership types and so many people on its list. */
  const makeGym = async (local: string, people: number): Promise<{ gymId: string; typeIds: string[]; entryIds: string[] }> => {
    const email = `ofl-t-${local}@example.com`;
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Ofl ${local}` })).statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
    const made = await post("/v1/orgs", { trainsHere: false, name: `Ofl ${local} Gym`, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(made.statusCode, made.body).toBe(201);
    const gymId = (JSON.parse(made.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const typeIds: string[] = [];
    for (let i = 0; i < TYPES; i += 1) {
      const name = `Type ${String(i)}`;
      const body = {
        name,
        description: null,
        kind: "recurring",
        priceMinor: 4500,
        termCount: 1,
        termUnit: "month",
        packClasses: null,
        packDays: null,
        access: "all_classes",
        bookingsLimit: null,
        bookingsPeriod: null,
        classTypeIds: null,
        includesPt: false,
      };
      const res = await post(`/v1/orgs/${gymId}/membership-types`, body, cookies);
      expect(res.statusCode, res.body).toBe(201);
      const id = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === name)?.id;
      if (id === undefined) throw new Error(`no type named ${name}`);
      typeIds.push(id);
    }
    const entries = Array.from({ length: people }, (_, i) => ({
      id: randomUUID(),
      gym_id: gymId,
      full_name: `Person ${String(i)}`,
      email: `ofl-p-${local}-${String(i)}@example.com`,
      identity_key: createHash("sha256").update(`${gymId}:${String(i)}`).digest("hex"),
      source: "typed",
    }));
    await sql`INSERT INTO gym_member_list_entries ${sql(entries)}`;
    return { gymId, typeIds, entryIds: entries.map((entry) => entry.id) };
  };

  /** Write them as the table holds them; each one's id, by its request key. */
  const store = async (gym: { gymId: string; typeIds: string[]; entryIds: string[] }, made: readonly Made[]): Promise<Map<string, string>> => {
    const rows = made.map(({ person, type, requestKey, priceMinor, fromList, membership: m }) => ({
      gym_id: gym.gymId,
      entry_id: gym.entryIds[person] ?? "",
      membership_type_id: gym.typeIds[type] ?? "",
      request_key: requestKey,
      kind: m.kind,
      price_minor: priceMinor,
      currency: "GBP",
      term_count: m.termCount,
      term_unit: m.termUnit,
      pack_classes: m.packClasses,
      pack_days: m.packDays,
      starts_on: m.startsOn,
      frozen_days: m.frozenDays,
      status: m.status,
      frozen_on: m.frozenOn,
      cancelled_on: m.cancelledOn,
      paid_periods: m.paidPeriods,
      paid_floor: m.paidFloor,
      renews: m.renews,
      classes_left: m.classesLeft,
      from_list: fromList,
    }));
    await sql`INSERT INTO gym_held_memberships ${sql(rows)}`;
    const ids = await sql<{ id: string; request_key: string }[]>`SELECT id, request_key FROM gym_held_memberships WHERE gym_id = ${gym.gymId}`;
    return new Map(ids.map((row) => [row.request_key, row.id]));
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  it(
    "says for each person what the rule says over all of their memberships, on every day",
    async () => {
      const { people, made } = everybody();
      const gym = await makeGym("rule", people);
      const idOf = await store(gym, made);
      const heldOf = (person: number): HeldForList[] =>
        made
          .filter((m) => m.person === person)
          .map((m) => ({ id: idOf.get(m.requestKey) ?? "", typeName: `Type ${String(m.type)}`, fromList: m.fromList, membership: m.membership }));

      // What the days ask of the pick: how often the answer is one that is over, chosen
      // from several, and how often by a row SQL chose from several stored over.
      let over = 0;
      let overFromSeveral = 0;
      for (const today of TODAYS) {
        const got = await heldOnListOf(sql, gym.gymId, today, null);
        for (let person = 0; person < people; person += 1) {
          const held = heldOf(person);
          const says = heldOnList({ held, listedUnheld: null, today });
          expect(got.get(gym.entryIds[person] ?? "")?.shown ?? null, `person ${String(person)} on ${today}`).toEqual(says);
          if (says !== null && (says.status === "ended" || says.status === "cancelled")) {
            over += 1;
            if (held.filter((m) => m.membership.status === "ended" || m.membership.status === "cancelled").length > 1) overFromSeveral += 1;
          }
        }
        // One page of people asks the same question of the ids on it, and is told the same.
        const some = gym.entryIds.filter((_, at) => at % 3 === 0);
        const page = await heldOnListOf(sql, gym.gymId, today, some);
        expect([...page.keys()].sort()).toEqual(some.filter((id) => got.has(id)).sort());
        for (const [id, shown] of page) expect(shown, `${id} on ${today}`).toEqual(got.get(id));
      }
      // The generated memberships ask the question often enough to mean something.
      expect(over).toBeGreaterThan(200);
      expect(overFromSeveral).toBeGreaterThan(150);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never reads another gym's memberships, whatever ids are asked",
    async () => {
      const ours = await makeGym("ours", 2);
      const theirs = await makeGym("theirs", 2);
      const today = "2026-10-07";
      await store(ours, [make(0, 0, "cancelled")]);
      // At the other gym: somebody whose memberships are over, and somebody with one running.
      const running: Made = {
        person: 1,
        type: 2,
        requestKey: nextKey(),
        priceMinor: 4500,
        fromList: false,
        membership: {
          kind: "recurring",
          termCount: 1,
          termUnit: "month",
          packClasses: null,
          packDays: null,
          classesLeft: null,
          free: false,
          startsOn: "2026-10-01",
          frozenDays: 0,
          status: "active",
          frozenOn: null,
          cancelledOn: null,
          paidPeriods: 1,
          paidFloor: 0,
          renews: true,
        },
      };
      await store(theirs, [make(0, 0, "cancelled"), make(0, 1, "ended"), running]);
      const [gone = "", holds = ""] = theirs.entryIds;

      expect([...(await heldOnListOf(sql, theirs.gymId, today, null)).keys()].sort()).toEqual([gone, holds].sort());
      // Asked of this gym: by the whole gym, by their people's ids, and as people the clock ended.
      expect([...(await heldOnListOf(sql, ours.gymId, today, null)).keys()]).toEqual([ours.entryIds[0]]);
      expect((await heldOnListOf(sql, ours.gymId, today, [gone, holds])).size).toBe(0);
      expect(await inUseForList(sql, ours.gymId, [holds])).toEqual([]);
      expect(await overForList(sql, ours.gymId, [gone], [gone, holds], today)).toEqual([]);
      expect((await overForList(sql, ours.gymId, null, [gone], today)).map((row) => row.entryId)).toEqual([ours.entryIds[0]]);
    },
    TEST_TIMEOUT_MS,
  );
});
