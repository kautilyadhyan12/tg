// A NOTICE TO CANCEL ON A REPEATING MEMBERSHIP, through the real routes and the hourly bill run
// against real Postgres (ROADMAP 18v-ii-a). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: charge them after their notice ended, or
// for a notice the gym let them out of because they moved away or died. That is the first test:
// one more bill inside the notice and none after it, month after month to well past the end; a
// member let out stops being billed the day staff say so; and ending before the notice with no
// reason is refused with nothing written.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { heldMembershipsResponseSchema, type GymMembershipTypesResponse, type HeldMembershipsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { LAST_DAY, STILL_RENEWS } from "../src/modules/orgs/memberships/heldRepo.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "notice-routes-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_notice_routes";
const log = { info: () => undefined, error: () => undefined };

let ipCounter = 0;
const nextIp = () => `10.99.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 5000,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  ...over,
});

/** The 15th of each month at noon in Chicago, from November 2026 to March 2028. */
const RUNS = Array.from({ length: 17 }, (_, i) => {
  const y = 2026 + Math.floor((10 + i) / 12);
  const mo = ((10 + i) % 12) + 1;
  return `${String(y)}-${String(mo).padStart(2, "0")}-15T17:00:00Z`;
});

d("a notice to cancel on a repeating membership (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // 12:00 in Chicago on 15 October 2026.
  let clock = new Date("2026-10-15T17:00:00Z");
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'notice-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'notice-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies) => send("PUT", path, cookies, payload);
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  const makeUser = async (local: string): Promise<Cookies> => {
    const email = `notice-t-${local}@example.com`;
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Notice ${local}` }, {})).statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode, login.body).toBe(200);
    return cookieMap(login);
  };
  const makeGym = async (owner: Cookies, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `notice-p-${String(++formCounter)}@example.com` }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const typesUrl = (gymId: string) => `/v1/orgs/${gymId}/membership-types`;
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await post(typesUrl(gymId), body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error(`no live type named ${String(body["name"])}`);
    return found.id;
  };
  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const held = (res: { body: string }): HeldMembershipsResponse => heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  /** Given today, the first month paid in cash at the desk. */
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, startsOn: string): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn, paid: true, method: "cash", priceMinor: 5000, totalMinor: 5000 }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId}`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const stored = async (id: string) =>
    (await sql<{ status: string; renews: boolean; notice_days: number | null; stops_after: number | null; notice_waived: string | null; contract_release: string | null }[]>`
      SELECT status, renews, notice_days, stops_after, notice_waived, contract_release FROM gym_held_memberships WHERE id = ${id}`)[0];
  /** The periods billed, in order. */
  const billed = async (id: string) => (await sql<{ p: number }[]>`SELECT period_index AS p FROM gym_member_bills WHERE held_membership_id = ${id} AND period_index IS NOT NULL ORDER BY period_index`).map((r) => r.p);
  const runAll = async (gymId: string, until = RUNS.length) => {
    for (const iso of RUNS.slice(0, until)) expect((await openDueBills({ sql, log }, { now: new Date(iso), gymIds: [gymId] })).failed).toBe(0);
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      orgs: { now: () => clock },
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "nobody is billed after their notice ends, or after they are let out of it; ending before the notice with no reason writes nothing",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("worst-owner");
      const gymId = await makeGym(owner, "Notice Worst Gym");
      const gold = await addType(gymId, owner, monthly({ noticeDays: 30 }));
      const ana = await addPerson(gymId, owner, "Ana Lopez");
      const anaGold = await give(gymId, ana, owner, gold, "2026-10-15");
      expect(await stored(anaGold)).toMatchObject({ notice_days: 30, stops_after: null });
      const ben = await addPerson(gymId, owner, "Ben Okafor");
      const benGold = await give(gymId, ben, owner, gold, "2026-10-15");
      const cara = await addPerson(gymId, owner, "Cara Singh");
      const caraGold = await give(gymId, cara, owner, gold, "2026-10-15");

      // 10 November: paid to 14 November. Ana gives 30 days' notice: it runs to 14 December.
      clock = new Date("2026-11-10T17:00:00Z");
      const before = held(await get(heldUrl(gymId, ana), owner)).memberships.find((m) => m.id === anaGold);
      expect(before?.view.can).toMatchObject({ cancelAfterNotice: "2026-12-14", noticeEnds: "2026-12-14" });
      const given = await post(`${heldUrl(gymId, ana)}/${anaGold}/cancel`, { when: "notice" }, owner);
      expect(given.statusCode, given.body).toBe(200);
      expect(await stored(anaGold)).toMatchObject({ status: "active", renews: true, stops_after: 2, notice_waived: null });
      expect(held(given).memberships.find((m) => m.id === anaGold)?.view).toMatchObject({ endsOn: "2026-12-14", notice: { days: 30, given: true } });

      // Ending sooner with no reason is refused, today or at the end of what is paid.
      for (const when of ["today", "period_end"]) {
        const res = await post(`${heldUrl(gymId, ben)}/${benGold}/cancel`, { when }, owner);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("contract_release_needed");
      }
      expect(await stored(benGold)).toMatchObject({ status: "active", renews: true, stops_after: null, notice_waived: null });
      // Ben died: cancelled today, the reason kept. Cara moved: she ends with what is paid.
      expect((await post(`${heldUrl(gymId, ben)}/${benGold}/cancel`, { when: "today", release: "death" }, owner)).statusCode).toBe(200);
      expect(await stored(benGold)).toMatchObject({ status: "cancelled", notice_waived: "death", contract_release: null });
      const caraOut = await post(`${heldUrl(gymId, cara)}/${caraGold}/cancel`, { when: "period_end", release: "moved" }, owner);
      expect(caraOut.statusCode, caraOut.body).toBe(200);
      expect(await stored(caraGold)).toMatchObject({ status: "active", renews: false, notice_waived: "moved" });
      expect(held(caraOut).memberships.find((m) => m.id === caraGold)).toMatchObject({ noticeWaived: "moved", view: { endsOn: "2026-11-14" } });

      // Every month to March 2028.
      await runAll(gymId);
      expect(await billed(anaGold)).toEqual([0, 1]);
      expect(await billed(benGold)).toEqual([0]);
      expect(await billed(caraGold)).toEqual([0]);
      clock = new Date("2026-12-15T17:00:00Z");
      expect(held(await get(heldUrl(gymId, ana), owner)).memberships.find((m) => m.id === anaGold)?.view.status).toBe("ended");
    },
    T,
  );

  it(
    "another gym's owner can neither give notice for a member nor end it without notice",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("tenant-owner");
      const stranger = await makeUser("tenant-stranger");
      const gymId = await makeGym(owner, "Notice Tenant Gym");
      const otherGym = await makeGym(stranger, "Notice Other Gym");
      const gold = await addType(gymId, owner, monthly({ noticeDays: 30 }));
      const gus = await addPerson(gymId, owner, "Gus Hall");
      const gusGold = await give(gymId, gus, owner, gold, "2026-10-15");
      clock = new Date("2026-11-10T17:00:00Z");
      for (const body of [{ when: "notice" }, { when: "today", release: "moved" }]) {
        const direct = await post(`${heldUrl(gymId, gus)}/${gusGold}/cancel`, body, stranger);
        expect([403, 404]).toContain(direct.statusCode);
        const viaOwn = await post(`${heldUrl(otherGym, gus)}/${gusGold}/cancel`, body, stranger);
        expect(viaOwn.statusCode).toBe(404);
      }
      expect(await stored(gusGold)).toMatchObject({ status: "active", renews: true, stops_after: null, notice_waived: null });
      // Notice with a reason is a 400.
      expect((await post(`${heldUrl(gymId, gus)}/${gusGold}/cancel`, { when: "notice", release: "moved" }, owner)).statusCode).toBe(400);
    },
    T,
  );

  it(
    "notice sent twice is one change; the SQL reads its last day and its renewals as the rule does",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("sql-owner");
      const gymId = await makeGym(owner, "Notice Sql Gym");
      const gold = await addType(gymId, owner, monthly({ noticeDays: 30 }));
      const ivy = await addPerson(gymId, owner, "Ivy Chen");
      const ivyGold = await give(gymId, ivy, owner, gold, "2026-10-15");
      clock = new Date("2026-11-10T17:00:00Z");
      for (let i = 0; i < 2; i += 1) expect((await post(`${heldUrl(gymId, ivy)}/${ivyGold}/cancel`, { when: "notice" }, owner)).statusCode).toBe(200);
      const audits = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND target_id = ${ivyGold} AND meta->>'stopsAfter' = '2'`;
      expect(audits[0]?.n).toBe(1);

      const sqlLast = (await sql<{ d: string }[]>`SELECT (${LAST_DAY(sql)})::text AS d FROM gym_held_memberships h WHERE h.id = ${ivyGold}`)[0]?.d;
      expect(sqlLast).toBe("2026-12-14");
      const renews = async (iso: string) => (await sql<{ r: boolean }[]>`SELECT ${STILL_RENEWS(sql, new Date(iso))} AS r FROM gym_held_memberships h WHERE h.id = ${ivyGold}`)[0]?.r;
      expect(await renews("2026-11-10T17:00:00Z")).toBe(true);
      // Its last period began on 15 November: no renewal is left.
      expect(await renews("2026-11-20T17:00:00Z")).toBe(false);
    },
    T,
  );

  it(
    "the price list keeps a notice, a membership keeps the one it was given, and a notice changed since the Add form opened gives nothing",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("list-owner");
      const gymId = await makeGym(owner, "Notice List Gym");
      const gold = await addType(gymId, owner, monthly({ noticeDays: 30 }));
      const list = JSON.parse((await get(typesUrl(gymId), owner)).body) as GymMembershipTypesResponse;
      const t = list.types.find((x) => x.id === gold);
      expect(t?.noticeDays).toBe(30);
      expect((await post(typesUrl(gymId), monthly({ name: "Ten classes", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, noticeDays: 30 }), owner)).statusCode).toBe(400);
      expect((await post(typesUrl(gymId), monthly({ name: "Free", priceMinor: 0, noticeDays: 30 }), owner)).statusCode).toBe(400);

      const eli = await addPerson(gymId, owner, "Eli Park");
      const eliGold = await give(gymId, eli, owner, gold, "2026-10-15");
      if (t === undefined) throw new Error("no type");
      const change = await put(
        `${typesUrl(gymId)}/${gold}`,
        { ...monthly(), includesPt: false, ptLimit: null, ptPeriod: null, taxRateIds: [], joiningFeeMinor: 0, contractPeriods: null, contractThen: null, noticeDays: 14, leaveFeeMinor: null, coolingOffDays: null, renewalReminderDays: null, termReminderDays: null, updatedAt: t.updatedAt },
        owner,
      );
      expect(change.statusCode, change.body).toBe(200);
      expect(await stored(eliGold)).toMatchObject({ notice_days: 30 });

      // The Add form opened when the line said 30 days: it now says 14, so nothing is given.
      const fay = await addPerson(gymId, owner, "Fay Nguyen");
      const body = (noticeDays: number | null) => ({ requestKey: nextForm(), typeId: gold, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor: 5000, totalMinor: 5000, noticeDays });
      for (const shown of [30, null]) {
        const res = await post(heldUrl(gymId, fay), body(shown), owner);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("membership_notice_changed");
      }
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE entry_id = ${fay}`)[0]?.n).toBe(0);
      expect((await post(heldUrl(gymId, fay), body(14), owner)).statusCode).toBe(201);
    },
    T,
  );
  it(
    "round one C1: Change membership stops the old one, with a notice or inside a minimum term, and each month is billed once",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("change-owner");
      const gymId = await makeGym(owner, "Notice Change Gym");
      const gold = await addType(gymId, owner, monthly({ noticeDays: 30 }));
      const plat = await addType(gymId, owner, monthly({ name: "Plat Monthly", contractPeriods: 12, contractThen: "renews" }));
      const silver = await addType(gymId, owner, monthly({ name: "Silver Monthly", priceMinor: 4000 }));
      const ana = await addPerson(gymId, owner, "Ana Lopez");
      const ben = await addPerson(gymId, owner, "Ben Okafor");
      const dan = await addPerson(gymId, owner, "Dan Moss");
      const anaGold = await give(gymId, ana, owner, gold, "2026-10-15");
      const benGold = await give(gymId, ben, owner, gold, "2026-10-15");
      const danPlat = await give(gymId, dan, owner, plat, "2026-10-15");

      clock = new Date("2026-11-10T17:00:00Z");
      expect((await post(`${heldUrl(gymId, ben)}/${benGold}/cancel`, { when: "notice" }, owner)).statusCode).toBe(200);
      const changeTo = { typeId: silver, when: "next_payment", startsOn: "2026-11-15", priceMinor: 4000, creditMinor: 0, totalMinor: 4000, paid: false, noticeDays: null };
      for (const [entryId, id] of [[ana, anaGold], [ben, benGold], [dan, danPlat]] as const) {
        const res = await post(`${heldUrl(gymId, entryId)}/${id}/change`, { requestKey: nextForm(), ...changeTo }, owner);
        expect(res.statusCode, res.body).toBe(200);
        expect(await stored(id)).toMatchObject({ status: "active", renews: false });
      }
      // Ben's notice is kept on the old row, so a change undone before Silver starts still ends where it said.
      expect(await stored(benGold)).toMatchObject({ stops_after: 2 });

      await runAll(gymId);
      for (const [entryId, id] of [[ana, anaGold], [ben, benGold], [dan, danPlat]] as const) {
        expect(await billed(id)).toEqual([0]);
        // Never two bills for the same month: one membership or the other.
        const twice = await sql<{ due: string }[]>`
          SELECT b.due_on::text AS due FROM gym_member_bills b JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
          WHERE b.gym_id = ${gymId} AND h.entry_id = ${entryId} AND b.period_index IS NOT NULL GROUP BY b.due_on HAVING count(*) > 1`;
        expect(twice).toEqual([]);
        const silverBills = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_bills b JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id WHERE b.gym_id = ${gymId} AND h.entry_id = ${entryId} AND h.membership_type_id = ${silver}`;
        expect(silverBills[0]?.n ?? 0).toBeGreaterThan(0);
      }
    },
    T,
  );

  it(
    "a release inside a minimum term lets them out of the notice too, and keeps one reason",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("both-owner");
      const gymId = await makeGym(owner, "Notice Both Gym");
      const both = await addType(gymId, owner, monthly({ contractPeriods: 12, contractThen: "renews", noticeDays: 30 }));
      const eve = await addPerson(gymId, owner, "Eve Hart");
      const eveGold = await give(gymId, eve, owner, both, "2026-10-15");
      clock = new Date("2026-11-10T17:00:00Z");
      expect((await post(`${heldUrl(gymId, eve)}/${eveGold}/cancel`, { when: "today" }, owner)).statusCode).toBe(409);
      expect((await post(`${heldUrl(gymId, eve)}/${eveGold}/cancel`, { when: "today", release: "medical" }, owner)).statusCode).toBe(200);
      expect(await stored(eveGold)).toMatchObject({ status: "cancelled", contract_release: "medical", notice_waived: null });
      // A line whose minimum term ends by itself takes no notice.
      expect((await post(typesUrl(gymId), monthly({ name: "Year ends", contractPeriods: 12, contractThen: "ends", noticeDays: 30 }), owner)).statusCode).toBe(400);
    },
    T,
  );

  it(
    "the SQL reads notice given as the rule does, billed from the gym's day and with free days on a period that never comes",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("twin-owner");
      const gymId = await makeGym(owner, "Notice Twin Gym");
      const gold = await addType(gymId, owner, monthly({ noticeDays: 30 }));
      await sql`UPDATE gyms SET bills_day = 1 WHERE id = ${gymId}`;
      const jay = await addPerson(gymId, owner, "Jay Kim");
      const res = await post(heldUrl(gymId, jay), { requestKey: nextForm(), typeId: gold, startsOn: "2026-10-15", paid: false, priceMinor: 5000, fullFrom: "2026-11-01", noticeDays: 30 }, owner);
      expect(res.statusCode, res.body).toBe(201);
      const jayGold = (await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${jay}`)[0]?.id ?? "";
      // 10 November: the notice's last day, 9 December, falls in December: the part month, November, December.
      clock = new Date("2026-11-10T17:00:00Z");
      expect((await post(`${heldUrl(gymId, jay)}/${jayGold}/cancel`, { when: "notice" }, owner)).statusCode).toBe(200);
      expect(await stored(jayGold)).toMatchObject({ stops_after: 3 });

      const sqlLast = async () => (await sql<{ d: string }[]>`SELECT (${LAST_DAY(sql)})::text AS d FROM gym_held_memberships h WHERE h.id = ${jayGold}`)[0]?.d;
      const ruleLast = async () => held(await get(heldUrl(gymId, jay), owner)).memberships.find((m) => m.id === jayGold)?.view.endsOn;
      const renews = async (iso: string) => (await sql<{ r: boolean }[]>`SELECT ${STILL_RENEWS(sql, new Date(iso))} AS r FROM gym_held_memberships h WHERE h.id = ${jayGold}`)[0]?.r;
      expect(await sqlLast()).toBe("2026-12-31");
      expect(await ruleLast()).toBe("2026-12-31");
      expect(await renews("2026-11-30T17:00:00Z")).toBe(true);
      expect(await renews("2026-12-02T17:00:00Z")).toBe(false);

      // Seven free days from the period after the last: the last day moves to 7 January, and the last
      // period still began on 1 December (round one, L4).
      await sql`UPDATE gym_held_memberships SET gift_days = 7, gift_from = 3 WHERE id = ${jayGold}`;
      expect(await sqlLast()).toBe("2027-01-07");
      expect(await ruleLast()).toBe("2027-01-07");
      expect(await renews("2026-11-30T17:00:00Z")).toBe(true);
      expect(await renews("2026-12-03T17:00:00Z")).toBe(false);
    },
    T,
  );
});
