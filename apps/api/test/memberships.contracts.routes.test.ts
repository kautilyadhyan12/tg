// A CONTRACT ON A REPEATING MEMBERSHIP, through the real routes and the hourly bill run against
// real Postgres (ROADMAP 18v-i). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: charge them for a month after their
// contract ended, or after the gym let them out of it because they moved away or died. That is
// the first test: twelve monthly bills and no thirteenth, month after month to well past the
// end; a member released stops being billed the day staff say so; and a cancel inside a
// contract with no reason is refused with nothing written.
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
  JWT_SECRET: "contract-routes-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_contract_routes";
const log = { info: () => undefined, error: () => undefined };

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("a contract on a repeating membership (real Postgres)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'contract-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'contract-t-%@example.com'`;
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
    const email = `contract-t-${local}@example.com`;
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Contract ${local}` }, {})).statusCode).toBe(201);
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
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `contract-p-${String(++formCounter)}@example.com` }, cookies);
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
    (await sql<{ status: string; renews: boolean; contract_periods: number | null; contract_then: string | null; contract_release: string | null }[]>`
      SELECT status, renews, contract_periods, contract_then, contract_release FROM gym_held_memberships WHERE id = ${id}`)[0];
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
    "nobody is billed after their contract ends, or after they are released; a cancel inside a contract with no reason writes nothing",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("worst-owner");
      const gymId = await makeGym(owner, "Contract Worst Gym");
      const ends = await addType(gymId, owner, monthly({ name: "Gold 12 months", contractPeriods: 12, contractThen: "ends" }));
      const renews = await addType(gymId, owner, monthly({ name: "Gold 12 then monthly", contractPeriods: 12, contractThen: "renews" }));

      // Ana: twelve months, then it ends. Twelve bills, none after, run to March 2028.
      const ana = await addPerson(gymId, owner, "Ana Lopez");
      const anaGold = await give(gymId, ana, owner, ends, "2026-10-15");
      expect(await stored(anaGold)).toMatchObject({ contract_periods: 12, contract_then: "ends" });
      // Ben: twelve months, then month to month; released today, he moved away.
      const ben = await addPerson(gymId, owner, "Ben Okafor");
      const benGold = await give(gymId, ben, owner, renews, "2026-10-15");
      // Cara: the same; she died, and the gym ends her membership today.
      const cara = await addPerson(gymId, owner, "Cara Singh");
      const caraGold = await give(gymId, cara, owner, renews, "2026-10-15");

      // Three months in. A cancel today with no reason is refused.
      clock = new Date("2027-01-20T17:00:00Z");
      await runAll(gymId, 3);
      const noReason = await post(`${heldUrl(gymId, ben)}/${benGold}/cancel`, { when: "today" }, owner);
      expect(noReason.statusCode, noReason.body).toBe(409);
      expect(errorOf(noReason)).toBe("contract_release_needed");
      // Nothing is paid ahead, so there is no later end of what is paid to stop at.
      expect((await post(`${heldUrl(gymId, ben)}/${benGold}/cancel`, { when: "period_end" }, owner)).statusCode).toBe(409);
      expect(await stored(benGold)).toMatchObject({ status: "active", renews: true, contract_then: "renews", contract_release: null });

      // Ben released, moved away: cancelled today, the reason kept.
      const out = await post(`${heldUrl(gymId, ben)}/${benGold}/cancel`, { when: "today", release: "moved" }, owner);
      expect(out.statusCode, out.body).toBe(200);
      expect(await stored(benGold)).toMatchObject({ status: "cancelled", contract_release: "moved" });
      const benView = held(out).memberships.find((m) => m.id === benGold);
      expect(benView?.release).toBe("moved");
      // Cara released, death: the same.
      expect((await post(`${heldUrl(gymId, cara)}/${caraGold}/cancel`, { when: "today", release: "death" }, owner)).statusCode).toBe(200);
      expect(await stored(caraGold)).toMatchObject({ status: "cancelled", contract_release: "death" });

      // Every month to March 2028.
      await runAll(gymId);
      expect(await billed(anaGold)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(await billed(benGold)).toEqual([0, 1, 2, 3]);
      expect(await billed(caraGold)).toEqual([0, 1, 2, 3]);

      // Staff read Ana's last day while she is in it, and Ended after it.
      clock = new Date("2027-10-14T17:00:00Z");
      const inIt = held(await get(heldUrl(gymId, ana), owner)).memberships.find((m) => m.id === anaGold);
      expect(inIt?.view).toMatchObject({ status: "active", endsOn: "2027-10-14", renewsOn: null, contract: { until: "2027-10-14", then: "ends" } });
      expect(inIt?.contractPeriods).toBe(12);
      clock = new Date("2027-10-15T17:00:00Z");
      expect(held(await get(heldUrl(gymId, ana), owner)).memberships.find((m) => m.id === anaGold)?.view.status).toBe("ended");
    },
    T,
  );

  it(
    "End when the contract ends keeps billing to the contract's last month, then stops; sent twice it is one change",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("end-owner");
      const gymId = await makeGym(owner, "Contract End Gym");
      const renews = await addType(gymId, owner, monthly({ name: "Gold 12 then monthly", contractPeriods: 12, contractThen: "renews" }));
      const dev = await addPerson(gymId, owner, "Dev Rao");
      const devGold = await give(gymId, dev, owner, renews, "2026-10-15");

      clock = new Date("2027-01-20T17:00:00Z");
      await runAll(gymId, 3);
      const before = held(await get(heldUrl(gymId, dev), owner)).memberships.find((m) => m.id === devGold);
      expect(before?.view.can).toMatchObject({ cancelAtContractEnd: "2027-10-14", releaseNeeded: true });
      for (let i = 0; i < 2; i += 1) {
        const res = await post(`${heldUrl(gymId, dev)}/${devGold}/cancel`, { when: "contract_end" }, owner);
        expect(res.statusCode, res.body).toBe(200);
      }
      expect(await stored(devGold)).toMatchObject({ status: "active", renews: true, contract_then: "ends", contract_release: null });
      const audits = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND target_id = ${devGold} AND meta->>'contractThen' = 'ends'`;
      expect(audits[0]?.n).toBe(1);
      await runAll(gymId);
      expect(await billed(devGold)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    },
    T,
  );

  it(
    "the price list keeps a contract, a membership keeps the one it was given, and nothing changes for a type without one",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("list-owner");
      const gymId = await makeGym(owner, "Contract List Gym");
      const gold = await addType(gymId, owner, monthly({ contractPeriods: 12, contractThen: "renews" }));
      const plain = await addType(gymId, owner, monthly({ name: "Silver Monthly" }));
      const list = JSON.parse((await get(typesUrl(gymId), owner)).body) as GymMembershipTypesResponse;
      expect(list.types.find((t) => t.id === gold)).toMatchObject({ contractPeriods: 12, contractThen: "renews" });
      expect(list.types.find((t) => t.id === plain)).toMatchObject({ contractPeriods: null, contractThen: null, noticeDays: null });

      // A contract on a paid-once type, or half of one, is refused.
      expect((await post(typesUrl(gymId), monthly({ name: "Year once", kind: "one_time", contractPeriods: 12, contractThen: "ends" }), owner)).statusCode).toBe(400);
      expect((await post(typesUrl(gymId), monthly({ name: "Half", contractPeriods: 12 }), owner)).statusCode).toBe(400);

      const eli = await addPerson(gymId, owner, "Eli Park");
      const eliGold = await give(gymId, eli, owner, gold, "2026-10-15");
      // The owner takes the contract off the line: Eli keeps his.
      const t = list.types.find((x) => x.id === gold);
      if (t === undefined) throw new Error("no type");
      const change = await put(
        `${typesUrl(gymId)}/${gold}`,
        { ...monthly(), name: t.name, includesPt: false, ptLimit: null, ptPeriod: null, taxRateId: null, joiningFeeMinor: 0, contractPeriods: null, contractThen: null, noticeDays: null, leaveFeeMinor: null, updatedAt: t.updatedAt },
        owner,
      );
      expect(change.statusCode, change.body).toBe(200);
      expect(await stored(eliGold)).toMatchObject({ contract_periods: 12, contract_then: "renews" });

      // Without a contract, a cancel asks for nothing, as before.
      const fay = await addPerson(gymId, owner, "Fay Nguyen");
      const faySilver = await give(gymId, fay, owner, plain, "2026-10-15");
      clock = new Date("2026-10-20T17:00:00Z");
      expect((await post(`${heldUrl(gymId, fay)}/${faySilver}/cancel`, { when: "today" }, owner)).statusCode).toBe(200);
    },
    T,
  );

  it(
    "another gym's owner can neither release a member nor end their contract",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("tenant-owner");
      const stranger = await makeUser("tenant-stranger");
      const gymId = await makeGym(owner, "Contract Tenant Gym");
      const otherGym = await makeGym(stranger, "Contract Other Gym");
      const gold = await addType(gymId, owner, monthly({ contractPeriods: 12, contractThen: "renews" }));
      const gus = await addPerson(gymId, owner, "Gus Hall");
      const gusGold = await give(gymId, gus, owner, gold, "2026-10-15");
      for (const body of [{ when: "today", release: "moved" }, { when: "contract_end" }]) {
        const direct = await post(`${heldUrl(gymId, gus)}/${gusGold}/cancel`, body, stranger);
        expect([403, 404]).toContain(direct.statusCode);
        const viaOwn = await post(`${heldUrl(otherGym, gus)}/${gusGold}/cancel`, body, stranger);
        expect(viaOwn.statusCode).toBe(404);
      }
      expect(await stored(gusGold)).toMatchObject({ status: "active", contract_then: "renews", contract_release: null });
      // A reason that is not one of the four is refused before anything is read.
      expect((await post(`${heldUrl(gymId, gus)}/${gusGold}/cancel`, { when: "today", release: "bored" }, owner)).statusCode).toBe(400);
    },
    T,
  );

  it(
    "the SQL reads a minimum term as the rule does: its last day, billed from the gym's day too, and whether a renewal is left",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("sql-owner");
      const gymId = await makeGym(owner, "Contract Sql Gym");
      const ends = await addType(gymId, owner, monthly({ name: "Gold 12 months", contractPeriods: 12, contractThen: "ends" }));
      const three = await addType(gymId, owner, monthly({ name: "Gold 3 months", contractPeriods: 3, contractThen: "ends" }));
      const ivy = await addPerson(gymId, owner, "Ivy Chen");
      const ivyGold = await give(gymId, ivy, owner, ends, "2026-10-15");
      // Billed on the 1st from here on: Jay's part month comes before his three whole ones (H2).
      await sql`UPDATE gyms SET bills_day = 1 WHERE id = ${gymId}`;
      const jay = await addPerson(gymId, owner, "Jay Kim");
      const res = await post(heldUrl(gymId, jay), { requestKey: nextForm(), typeId: three, startsOn: "2026-10-15", paid: false, priceMinor: 5000, fullFrom: "2026-11-01", minimumTerm: { periods: 3, then: "ends" } }, owner);
      expect(res.statusCode, res.body).toBe(201);
      const jayGold = (await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${jay}`)[0]?.id ?? "";

      const sqlLast = async (id: string) => (await sql<{ d: string }[]>`SELECT (${LAST_DAY(sql)})::text AS d FROM gym_held_memberships h WHERE h.id = ${id}`)[0]?.d;
      const ruleLast = async (entryId: string, id: string) => held(await get(heldUrl(gymId, entryId), owner)).memberships.find((m) => m.id === id)?.view.endsOn;
      expect(await sqlLast(ivyGold)).toBe("2027-10-14");
      expect(await ruleLast(ivy, ivyGold)).toBe("2027-10-14");
      expect(await sqlLast(jayGold)).toBe("2027-01-31");
      expect(await ruleLast(jay, jayGold)).toBe("2027-01-31");
      const jayView = held(await get(heldUrl(gymId, jay), owner)).memberships.find((m) => m.id === jayGold)?.view;
      expect(jayView?.contract?.until).toBe("2027-01-31");

      const renews = async (id: string, iso: string) => (await sql<{ r: boolean }[]>`SELECT ${STILL_RENEWS(sql, new Date(iso))} AS r FROM gym_held_memberships h WHERE h.id = ${id}`)[0]?.r;
      expect(await renews(ivyGold, "2027-09-10T17:00:00Z")).toBe(true);
      // In its last month no renewal is left (L3).
      expect(await renews(ivyGold, "2027-09-20T17:00:00Z")).toBe(false);
      await sql`UPDATE gym_held_memberships SET status = 'frozen', frozen_on = '2027-09-01' WHERE id = ${ivyGold}`;
      expect(await renews(ivyGold, "2027-12-20T17:00:00Z")).toBe(true);
    },
    T,
  );

  it(
    "a reason with End is a 400, and a minimum term changed since the Add form opened gives nothing",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("l1-owner");
      const gymId = await makeGym(owner, "Contract L1 Gym");
      const gold = await addType(gymId, owner, monthly({ contractPeriods: 12, contractThen: "renews" }));
      const kim = await addPerson(gymId, owner, "Kim Ray");
      const kimGold = await give(gymId, kim, owner, gold, "2026-10-15");
      clock = new Date("2026-11-20T17:00:00Z");
      const both = await post(`${heldUrl(gymId, kim)}/${kimGold}/cancel`, { when: "contract_end", release: "moved" }, owner);
      expect(both.statusCode, both.body).toBe(400);
      expect(await stored(kimGold)).toMatchObject({ status: "active", contract_then: "renews", contract_release: null });

      const lee = await addPerson(gymId, owner, "Lee Fox");
      const body = (minimumTerm: unknown) => ({ requestKey: nextForm(), typeId: gold, startsOn: "2026-11-20", paid: true, method: "cash", priceMinor: 5000, totalMinor: 5000, minimumTerm });
      for (const shown of [null, { periods: 6, then: "renews" }, { periods: 12, then: "ends" }]) {
        const res = await post(heldUrl(gymId, lee), body(shown), owner);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("membership_minimum_term_changed");
      }
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE entry_id = ${lee}`)[0]?.n).toBe(0);
      expect((await post(heldUrl(gymId, lee), body({ periods: 12, then: "renews" }), owner)).statusCode).toBe(201);

      // Change membership checks it the same way: Pia moves from Silver to Gold on her next payment date.
      const silver = await addType(gymId, owner, monthly({ name: "Silver Monthly" }));
      const pia = await addPerson(gymId, owner, "Pia Lund");
      const piaSilver = await give(gymId, pia, owner, silver, "2026-11-20");
      const changeTo = (minimumTerm: unknown) => ({
        requestKey: nextForm(), typeId: gold, when: "next_payment", startsOn: "2026-12-20", priceMinor: 5000, creditMinor: 0, totalMinor: 5000, paid: false, minimumTerm,
      });
      for (const shown of [null, { periods: 6, then: "renews" }, { periods: 12, then: "ends" }]) {
        const res = await post(`${heldUrl(gymId, pia)}/${piaSilver}/change`, changeTo(shown), owner);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("membership_minimum_term_changed");
      }
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE entry_id = ${pia}`)[0]?.n).toBe(1);
      const changed = await post(`${heldUrl(gymId, pia)}/${piaSilver}/change`, changeTo({ periods: 12, then: "renews" }), owner);
      expect(changed.statusCode, changed.body).toBe(200);
      const [piaGold] = await sql<{ contract_periods: number; contract_then: string }[]>`SELECT contract_periods, contract_then FROM gym_held_memberships WHERE entry_id = ${pia} AND membership_type_id = ${gold}`;
      expect(piaGold).toEqual({ contract_periods: 12, contract_then: "renews" });
    },
    T,
  );
});

