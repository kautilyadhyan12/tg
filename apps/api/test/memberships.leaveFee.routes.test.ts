// AN EARLY CANCELLATION FEE ON A MINIMUM TERM, through the real routes and the hourly bill run
// against real Postgres (ROADMAP 18v-ii-b). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: put the fee on somebody it must not, as a
// member released because they died or moved away, a member whose minimum term is over or who
// would end with it anyway, the same member twice, or another gym's member. That is the first test:
// one fee, and only on the member who left inside the term with no reason, and no bill after the
// last day; everybody else is charged nothing, and every refusal writes nothing.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { heldMembershipsResponseSchema, type GymMembershipTypesResponse, type HeldMembershipsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "leavefee-routes-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_leavefee_routes";
const log = { info: () => undefined, error: () => undefined };

let ipCounter = 0;
const nextIp = () => `10.98.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold 12",
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
  contractPeriods: 12,
  contractThen: "renews",
  leaveFeeMinor: 9900,
  ...over,
});

/** The 15th of each month at noon in Chicago, from November 2026 to March 2028. */
const RUNS = Array.from({ length: 17 }, (_, i) => {
  const y = 2026 + Math.floor((10 + i) / 12);
  const mo = ((10 + i) % 12) + 1;
  return `${String(y)}-${String(mo).padStart(2, "0")}-15T17:00:00Z`;
});

d("an early cancellation fee on a minimum term (real Postgres)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'leavefee-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'leavefee-t-%@example.com'`;
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
    const email = `leavefee-t-${local}@example.com`;
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Leave ${local}` }, {})).statusCode).toBe(201);
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
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `leavefee-p-${String(++formCounter)}@example.com` }, cookies);
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
    (await sql<{ status: string; renews: boolean; stops_after: number | null; left_early: boolean; leave_fee_minor: number | null; contract_release: string | null }[]>`
      SELECT status, renews, stops_after, left_early, leave_fee_minor, contract_release FROM gym_held_memberships WHERE id = ${id}`)[0];
  /** Its early cancellation fees, waived ones among them. */
  const leaveFees = async (id: string) =>
    await sql<{ amount_minor: number; status: string; fee_for: string; due_on: string }[]>`
      SELECT amount_minor, status, fee_for, due_on::text AS due_on FROM gym_member_bills WHERE held_membership_id = ${id} AND fee = 'leave_early'`;
  /** Every fee bill of any kind on it. */
  const anyFees = async (id: string) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_bills WHERE held_membership_id = ${id} AND fee IS NOT NULL`)[0]?.n;
  /** The periods billed, in order. */
  const billed = async (id: string) => (await sql<{ p: number }[]>`SELECT period_index AS p FROM gym_member_bills WHERE held_membership_id = ${id} AND period_index IS NOT NULL ORDER BY period_index`).map((r) => r.p);
  const runAll = async (gymId: string) => {
    for (const iso of RUNS) expect((await openDueBills({ sql, log }, { now: new Date(iso), gymIds: [gymId] })).failed).toBe(0);
  };
  const leave = (fee = 9900) => ({ when: "leave_early", leaveFeeMinor: fee });

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
    "the fee goes on the member who leaves inside the term, once, and on nobody released, out of the term or ending with it",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("worst-owner");
      const gymId = await makeGym(owner, "Leave Worst Gym");
      const gold = await addType(gymId, owner, monthly());
      const oneMonth = await addType(gymId, owner, monthly({ name: "Gold 1", contractPeriods: 1 }));
      const ana = await addPerson(gymId, owner, "Ana Lopez");
      const anaGold = await give(gymId, ana, owner, gold, "2026-10-15");
      expect(await stored(anaGold)).toMatchObject({ leave_fee_minor: 9900, left_early: false });
      const ben = await addPerson(gymId, owner, "Ben Okafor");
      const benGold = await give(gymId, ben, owner, gold, "2026-10-15");
      const cara = await addPerson(gymId, owner, "Cara Singh");
      const caraGold = await give(gymId, cara, owner, gold, "2026-10-15");
      const dev = await addPerson(gymId, owner, "Dev Rao");
      const devOne = await give(gymId, dev, owner, oneMonth, "2026-10-15");

      // 10 November, paid to 14 November.
      clock = new Date("2026-11-10T17:00:00Z");
      const page = held(await get(heldUrl(gymId, ana), owner)).memberships.find((m) => m.id === anaGold);
      expect(page?.view.can.leaveEarly).toEqual({ feeMinor: 9900, endsOn: "2026-11-14" });
      // A fee the screen did not show is refused, and so is a reason sent with it.
      const wrong = await post(`${heldUrl(gymId, ana)}/${anaGold}/cancel`, leave(5000), owner);
      expect(wrong.statusCode, wrong.body).toBe(409);
      expect(errorOf(wrong)).toBe("membership_leave_fee_changed");
      expect((await post(`${heldUrl(gymId, ana)}/${anaGold}/cancel`, { ...leave(), release: "moved" }, owner)).statusCode).toBe(400);
      expect((await post(`${heldUrl(gymId, ana)}/${anaGold}/cancel`, { when: "today", leaveFeeMinor: 9900 }, owner)).statusCode).toBe(400);
      expect(await stored(anaGold)).toMatchObject({ status: "active", renews: true, left_early: false });
      expect(await anyFees(anaGold)).toBe(0);

      // Ana leaves early: she keeps what she paid for, then it stops; the fee is due today. Twice is once.
      for (let i = 0; i < 2; i += 1) {
        const out = await post(`${heldUrl(gymId, ana)}/${anaGold}/cancel`, leave(), owner);
        expect(out.statusCode, out.body).toBe(200);
      }
      expect(await stored(anaGold)).toMatchObject({ status: "active", renews: false, left_early: true, contract_release: null });
      expect(await leaveFees(anaGold)).toEqual([{ amount_minor: 9900, status: "open", fee_for: "Gold 12", due_on: "2026-11-10" }]);
      const after = held(await get(heldUrl(gymId, ana), owner)).memberships.find((m) => m.id === anaGold);
      expect(after).toMatchObject({ leftEarly: true, view: { endsOn: "2026-11-14", contract: null, can: { leaveEarly: null } } });
      expect(after?.billing?.fees.map((f) => ({ fee: f.fee, of: f.of, amountMinor: f.amountMinor }))).toEqual([{ fee: "leave_early", of: "membership", amountMinor: 9900 }]);

      // Ben died and Cara moved away: released, no fee.
      expect((await post(`${heldUrl(gymId, ben)}/${benGold}/cancel`, { when: "today", release: "death" }, owner)).statusCode).toBe(200);
      expect((await post(`${heldUrl(gymId, cara)}/${caraGold}/cancel`, { when: "period_end", release: "moved" }, owner)).statusCode).toBe(200);
      // Released, leaving early is no longer theirs to be charged for.
      for (const [entry, id] of [[ben, benGold], [cara, caraGold]] as const) {
        const res = await post(`${heldUrl(gymId, entry)}/${id}/cancel`, leave(), owner);
        expect(res.statusCode, res.body).toBe(409);
        expect(await anyFees(id)).toBe(0);
      }
      expect(await stored(benGold)).toMatchObject({ status: "cancelled", left_early: false, contract_release: "death" });
      expect(await stored(caraGold)).toMatchObject({ status: "active", renews: false, left_early: false, contract_release: "moved" });

      // Dev's one-month term ends on 14 November, the end of what is paid: ending then is no early cancellation.
      const devPage = held(await get(heldUrl(gymId, dev), owner)).memberships.find((m) => m.id === devOne);
      expect(devPage?.view.can.leaveEarly).toBeNull();
      expect((await post(`${heldUrl(gymId, dev)}/${devOne}/cancel`, leave(), owner)).statusCode).toBe(409);
      // And on 20 November its term is over: no fee either.
      clock = new Date("2026-11-20T17:00:00Z");
      expect((await post(`${heldUrl(gymId, dev)}/${devOne}/cancel`, leave(), owner)).statusCode).toBe(409);
      expect(await anyFees(devOne)).toBe(0);

      // Every month to March 2028: Ana, Ben and Cara are billed nothing more.
      await runAll(gymId);
      expect(await billed(anaGold)).toEqual([0]);
      expect(await billed(benGold)).toEqual([0]);
      expect(await billed(caraGold)).toEqual([0]);
      expect(await leaveFees(anaGold)).toHaveLength(1);
    },
    T,
  );

  it(
    "another gym's owner can put no fee on a member",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("tenant-owner");
      const stranger = await makeUser("tenant-stranger");
      const gymId = await makeGym(owner, "Leave Tenant Gym");
      const otherGym = await makeGym(stranger, "Leave Other Gym");
      const gold = await addType(gymId, owner, monthly());
      const gus = await addPerson(gymId, owner, "Gus Hall");
      const gusGold = await give(gymId, gus, owner, gold, "2026-10-15");
      clock = new Date("2026-11-10T17:00:00Z");
      const direct = await post(`${heldUrl(gymId, gus)}/${gusGold}/cancel`, leave(), stranger);
      expect([403, 404]).toContain(direct.statusCode);
      const viaOwn = await post(`${heldUrl(otherGym, gus)}/${gusGold}/cancel`, leave(), stranger);
      expect(viaOwn.statusCode).toBe(404);
      expect(await stored(gusGold)).toMatchObject({ status: "active", renews: true, left_early: false });
      expect(await anyFees(gusGold)).toBe(0);
    },
    T,
  );

  it(
    "with a notice, leaving early runs to the notice's end and is billed once more; frozen with none, it ends today",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("notice-owner");
      const gymId = await makeGym(owner, "Leave Notice Gym");
      const gold = await addType(gymId, owner, monthly({ noticeDays: 30 }));
      const plain = await addType(gymId, owner, monthly({ name: "Gold Plain" }));
      const eve = await addPerson(gymId, owner, "Eve Moss");
      const eveGold = await give(gymId, eve, owner, gold, "2026-10-15");
      const fin = await addPerson(gymId, owner, "Fin Yu");
      const finPlain = await give(gymId, fin, owner, plain, "2026-10-15");

      clock = new Date("2026-11-10T17:00:00Z");
      const out = await post(`${heldUrl(gymId, eve)}/${eveGold}/cancel`, leave(), owner);
      expect(out.statusCode, out.body).toBe(200);
      expect(await stored(eveGold)).toMatchObject({ status: "active", renews: true, stops_after: 2, left_early: true });
      expect(held(out).memberships.find((m) => m.id === eveGold)?.view).toMatchObject({ endsOn: "2026-12-14", contract: null });

      // Fin is frozen, with no notice on his line: leaving early ends it today, as a release would.
      expect((await post(`${heldUrl(gymId, fin)}/${finPlain}/freeze`, {}, owner)).statusCode).toBe(200);
      const fout = await post(`${heldUrl(gymId, fin)}/${finPlain}/cancel`, leave(), owner);
      expect(fout.statusCode, fout.body).toBe(200);
      expect(await stored(finPlain)).toMatchObject({ status: "cancelled", left_early: true });
      expect(await leaveFees(finPlain)).toHaveLength(1);

      await runAll(gymId);
      expect(await billed(eveGold)).toEqual([0, 1]);
      expect(await billed(finPlain)).toEqual([0]);
      expect(await leaveFees(eveGold)).toHaveLength(1);
    },
    T,
  );

  it(
    "the price list keeps the fee on a minimum term only, a membership keeps the fee it was given, and a fee changed since the Add form opened gives nothing",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("list-owner");
      const gymId = await makeGym(owner, "Leave List Gym");
      const gold = await addType(gymId, owner, monthly());
      const list = JSON.parse((await get(typesUrl(gymId), owner)).body) as GymMembershipTypesResponse;
      const t = list.types.find((x) => x.id === gold);
      expect(t?.leaveFeeMinor).toBe(9900);
      // No minimum term, no fee.
      expect((await post(typesUrl(gymId), monthly({ name: "Open", contractPeriods: null, contractThen: null }), owner)).statusCode).toBe(400);
      expect((await post(typesUrl(gymId), monthly({ name: "Zero", leaveFeeMinor: 0 }), owner)).statusCode).toBe(400);

      const eli = await addPerson(gymId, owner, "Eli Park");
      const eliGold = await give(gymId, eli, owner, gold, "2026-10-15");
      if (t === undefined) throw new Error("no type");
      const change = await put(
        `${typesUrl(gymId)}/${gold}`,
        { ...monthly({ leaveFeeMinor: 15000 }), includesPt: false, ptLimit: null, ptPeriod: null, taxRateId: null, joiningFeeMinor: 0, noticeDays: null, updatedAt: t.updatedAt },
        owner,
      );
      expect(change.statusCode, change.body).toBe(200);
      expect(await stored(eliGold)).toMatchObject({ leave_fee_minor: 9900 });
      const audit = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND meta->>'leaveFeeAfter' = '15000'`;
      expect(audit[0]?.n).toBe(1);

      // The Add form opened when the line said 99.00: it now says 150.00, so nothing is given.
      const fay = await addPerson(gymId, owner, "Fay Nguyen");
      const body = (leaveFeeMinor: number | null) => ({
        requestKey: nextForm(),
        typeId: gold,
        startsOn: "2026-10-15",
        paid: true,
        method: "cash",
        priceMinor: 5000,
        totalMinor: 5000,
        minimumTerm: { periods: 12, then: "renews", leaveFeeMinor },
      });
      for (const shown of [9900, null]) {
        const res = await post(heldUrl(gymId, fay), body(shown), owner);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("membership_minimum_term_changed");
      }
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE entry_id = ${fay}`)[0]?.n).toBe(0);
      expect((await post(heldUrl(gymId, fay), body(15000), owner)).statusCode).toBe(201);
    },
    T,
  );
});
