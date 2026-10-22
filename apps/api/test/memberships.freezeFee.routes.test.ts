// A FEE WHILE FROZEN, through the real routes and the hourly run against real Postgres (spec
// Part 3 §14.8; ROADMAP 18z). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: charge a freeze fee they do not owe: twice
// for one month, for a month after they were unfrozen, at a gym that never set one, or on a freeze
// staff made with no fee. That is the first test: a member frozen on 22 October is charged once for
// 22 October to 21 November and once for 22 November to 21 December, however often the run and the
// freeze arrive, and nothing after they are unfrozen; a fee the screen did not show is refused
// with nothing written.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { billSettingsResponseSchema, heldMembershipsResponseSchema, receiptSchema, type GymMembershipTypesResponse, type HeldMembershipsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { openDueFreezeFees } from "../src/modules/orgs/memberships/freezeFees.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "freeze-fee-routes-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface CreatedOrg {
  org: { id: string };
  joinCode: { code: string };
}

const T = 120_000;
const LIVE_PLAN = "zz_freeze_fee_routes";
const log = { info: () => undefined, error: () => undefined };
// 12:00 in Chicago.
const at = (day: string) => new Date(`${day}T17:00:00Z`);

let ipCounter = 0;
const nextIp = () => `10.98.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const typeBody = (name: string, priceMinor: number, kind: "recurring" | "one_time" = "recurring") => ({
  name,
  description: null,
  kind,
  priceMinor,
  termCount: kind === "recurring" ? 1 : 3,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
});

d("a fee while frozen (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = at("2026-10-15");
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ffee-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'ffee-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => send("PUT", path, cookies, payload);
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string): Promise<Person> => {
    const email = `ffee-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Ffee ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${created.org.id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };
  /** A manager whose payments tick the owner has taken away. */
  const makeDeskStaff = async (org: CreatedOrg, owner: Person, person: Person) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode, applied.body).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner.cookies)).statusCode).toBe(200);
    await proveAddress(sql, person.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role: "manager" }, owner.cookies)).statusCode).toBe(201);
    const ticks = await put(`/v1/orgs/${org.org.id}/staff/${person.userId}/privileges`, { privileges: ["members.read", "members.confirm"] }, owner.cookies);
    expect(ticks.statusCode, ticks.body).toBe(200);
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `ffee-p-${String(++formCounter)}@example.com` }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error(`no live type named ${String(body["name"])}`);
    return found.id;
  };
  const settingsUrl = (gymId: string) => `/v1/orgs/${gymId}/bill-settings`;
  const setFreezeFee = async (gymId: string, cookies: Cookies, freezeFeeMinor: number) => {
    const res = await put(settingsUrl(gymId), { overdueAfterDays: 0, freezeFeeMinor }, cookies);
    expect(res.statusCode, res.body).toBe(200);
    expect(billSettingsResponseSchema.parse(JSON.parse(res.body)).freezeFeeMinor).toBe(freezeFeeMinor);
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const held = (res: { body: string }): HeldMembershipsResponse => heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  /** Given today, paid in cash, as the Add box gives it. */
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, priceMinor: number): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn: clock.toISOString().slice(0, 10), paid: true, method: "cash", priceMinor, totalMinor: priceMinor, fullFrom: null }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at DESC, id LIMIT 1`;
    return row?.id ?? "";
  };
  const freeze = (gymId: string, entryId: string, id: string, cookies: Cookies, payload: unknown) => post(`${heldUrl(gymId, entryId)}/${id}/freeze`, payload, cookies);
  const unfreeze = (gymId: string, entryId: string, id: string, cookies: Cookies) => post(`${heldUrl(gymId, entryId)}/${id}/unfreeze`, {}, cookies);
  const statusOf = async (id: string) => (await sql<{ status: string; freeze_fee_minor: number }[]>`SELECT status, freeze_fee_minor FROM gym_held_memberships WHERE id = ${id}`)[0];
  /** Each freeze fee as [from, to, amount, status], oldest first. */
  const fees = async (id: string) =>
    (
      await sql<{ from: string; to: string; amount_minor: number; status: string }[]>`
        SELECT covers_from::text AS from, covers_to::text AS to, amount_minor, status
        FROM gym_member_bills WHERE held_membership_id = ${id} AND fee = 'freeze' ORDER BY covers_from, created_at`
    ).map((b) => [b.from, b.to, b.amount_minor, b.status]);
  const run = async (gymId: string, day: string) => {
    clock = at(day);
    await openDueBills({ sql, log }, { now: at(day), gymIds: [gymId] });
    return await openDueFreezeFees({ sql, log }, { now: at(day), gymIds: [gymId] });
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
    "a member frozen on 22 October is charged once a month while frozen, never twice and never after the unfreeze; a fee the screen did not show is refused with nothing written",
    async () => {
      clock = at("2026-10-15");
      const owner = await makeUser("worst-owner");
      const gymId = (await makeGym(owner, "Ffee Worst Gym")).org.id;
      const gold = await addType(gymId, owner.cookies, typeBody("Gold Monthly", 5000));
      await setFreezeFee(gymId, owner.cookies, 1000);
      const maya = await addPerson(gymId, owner.cookies, "Maya Rao");
      const id = await give(gymId, maya, owner.cookies, gold, 5000);

      clock = at("2026-10-22");
      // The page offers the gym's fee for this membership.
      expect(held(await get(heldUrl(gymId, maya), owner.cookies)).memberships.find((m) => m.id === id)?.freezeFeeMinor).toBe(1000);
      // A screen that showed another fee: refused, nothing written.
      const wrong = await freeze(gymId, maya, id, owner.cookies, { feeMinor: 500 });
      expect(wrong.statusCode, wrong.body).toBe(409);
      expect(errorOf(wrong)).toBe("membership_freeze_fee_changed");
      expect(await statusOf(id)).toEqual({ status: "active", freeze_fee_minor: 0 });
      expect(await fees(id)).toEqual([]);

      // Frozen with the fee: its first month at once; pressed twice, and the run on the same day, still one.
      for (let i = 0; i < 2; i += 1) expect((await freeze(gymId, maya, id, owner.cookies, { feeMinor: 1000 })).statusCode).toBe(200);
      expect(await statusOf(id)).toEqual({ status: "frozen", freeze_fee_minor: 1000 });
      await run(gymId, "2026-10-22");
      expect(await fees(id)).toEqual([["2026-10-22", "2026-11-21", 1000, "open"]]);
      // The page shows it as owed, due that day, and the membership as payment due.
      const page = held(await get(heldUrl(gymId, maya), owner.cookies)).memberships.find((m) => m.id === id);
      expect(page?.freezeFeeMinor).toBe(1000);
      expect(page?.billing?.fees.map((f) => [f.fee, f.of, f.forName, f.on, f.to, f.dueOn, f.state])).toEqual([
        ["freeze", "membership", "Gold Monthly", "2026-10-22", "2026-11-21", "2026-10-22", "due"],
      ]);
      expect(page?.view.payment).toEqual({ state: "due", since: "2026-10-22" });

      // The run through the month opens nothing more; the next month once, however often it runs.
      for (const day of ["2026-10-23", "2026-11-01", "2026-11-21"]) await run(gymId, day);
      expect((await fees(id)).length).toBe(1);
      for (let i = 0; i < 3; i += 1) await run(gymId, "2026-11-22");
      expect(await fees(id)).toEqual([
        ["2026-10-22", "2026-11-21", 1000, "open"],
        ["2026-11-22", "2026-12-21", 1000, "open"],
      ]);

      // Unfrozen on 5 December: the month it is in was frozen and stays owed; nothing after.
      clock = at("2026-12-05");
      expect((await unfreeze(gymId, maya, id, owner.cookies)).statusCode).toBe(200);
      expect(await statusOf(id)).toEqual({ status: "active", freeze_fee_minor: 0 });
      for (const day of ["2026-12-22", "2027-01-22", "2027-02-22"]) await run(gymId, day);
      expect(await fees(id)).toEqual([
        ["2026-10-22", "2026-11-21", 1000, "open"],
        ["2026-11-22", "2026-12-21", 1000, "open"],
      ]);
    },
    T,
  );

  it(
    "nothing is charged where it does not apply: unticked, a gym with no fee, a paid-once membership, a freeze sent with no fee, or a past member",
    async () => {
      clock = at("2026-10-15");
      const owner = await makeUser("none-owner");
      const gymId = (await makeGym(owner, "Ffee None Gym")).org.id;
      const gold = await addType(gymId, owner.cookies, typeBody("Gold Monthly", 5000));
      const once = await addType(gymId, owner.cookies, typeBody("Three Months", 12000, "one_time"));

      // A gym that never set a fee: the page offers none, and a screen that showed one is refused.
      const ana = await addPerson(gymId, owner.cookies, "Ana Nofee");
      const anaGold = await give(gymId, ana, owner.cookies, gold, 5000);
      expect(held(await get(heldUrl(gymId, ana), owner.cookies)).memberships[0]?.freezeFeeMinor).toBe(0);
      expect((await freeze(gymId, ana, anaGold, owner.cookies, { feeMinor: 1000 })).statusCode).toBe(409);
      expect((await statusOf(anaGold))?.status).toBe("active");
      expect((await freeze(gymId, ana, anaGold, owner.cookies, { feeMinor: 0 })).statusCode).toBe(200);

      await setFreezeFee(gymId, owner.cookies, 1000);
      // Unticked by staff who record payments.
      const ben = await addPerson(gymId, owner.cookies, "Ben Unticked");
      const benGold = await give(gymId, ben, owner.cookies, gold, 5000);
      expect((await freeze(gymId, ben, benGold, owner.cookies, { feeMinor: 0 })).statusCode).toBe(200);
      // A paid-once membership freezes with no fee: none offered, and one sent is refused.
      const cai = await addPerson(gymId, owner.cookies, "Cai Paidonce");
      const caiOnce = await give(gymId, cai, owner.cookies, once, 12000);
      expect(held(await get(heldUrl(gymId, cai), owner.cookies)).memberships[0]?.freezeFeeMinor).toBe(0);
      expect((await freeze(gymId, cai, caiOnce, owner.cookies, { feeMinor: 1000 })).statusCode).toBe(409);
      expect((await freeze(gymId, cai, caiOnce, owner.cookies, { feeMinor: 0 })).statusCode).toBe(200);
      // A screen from before this job sends no body: frozen with no fee.
      const dee = await addPerson(gymId, owner.cookies, "Dee Nobody");
      const deeGold = await give(gymId, dee, owner.cookies, gold, 5000);
      const bare = await api().inject({ method: "POST", url: `${heldUrl(gymId, dee)}/${deeGold}/freeze`, remoteAddress: nextIp(), cookies: owner.cookies });
      expect(bare.statusCode, bare.body).toBe(200);
      // Frozen with the fee, then moved to past members: the run charges them nothing while they are.
      const eli = await addPerson(gymId, owner.cookies, "Eli Leaving");
      const eliGold = await give(gymId, eli, owner.cookies, gold, 5000);
      expect((await freeze(gymId, eli, eliGold, owner.cookies, { feeMinor: 1000 })).statusCode).toBe(200);
      expect((await send("DELETE", `/v1/orgs/${gymId}/member-list/entries/${eli}`, owner.cookies)).statusCode).toBe(200);

      for (const day of ["2026-11-15", "2026-12-15", "2027-01-15"]) await run(gymId, day);
      for (const membership of [anaGold, benGold, caiOnce, deeGold]) {
        expect(await statusOf(membership)).toEqual({ status: "frozen", freeze_fee_minor: 0 });
        expect(await fees(membership)).toEqual([]);
      }
      // Eli's first month, opened at the freeze while on the list, and nothing after.
      expect(await fees(eliGold)).toEqual([["2026-10-15", "2026-11-14", 1000, "open"]]);
    },
    T,
  );

  it(
    "a freeze undone the same day takes its unpaid fee off, and a freeze again that day charges again; a waived fee is never opened again; a paid one has its receipt; a new gym fee moves nobody already frozen",
    async () => {
      clock = at("2026-10-15");
      const owner = await makeUser("life-owner");
      const gymId = (await makeGym(owner, "Ffee Life Gym")).org.id;
      const gold = await addType(gymId, owner.cookies, typeBody("Gold Monthly", 5000));
      await setFreezeFee(gymId, owner.cookies, 1000);
      const fay = await addPerson(gymId, owner.cookies, "Fay Sameday");
      const fayGold = await give(gymId, fay, owner.cookies, gold, 5000);

      // Frozen and unfrozen on the same day: the fee comes off, unpaid, and the page no longer shows it.
      expect((await freeze(gymId, fay, fayGold, owner.cookies, { feeMinor: 1000 })).statusCode).toBe(200);
      expect((await unfreeze(gymId, fay, fayGold, owner.cookies)).statusCode).toBe(200);
      expect(await fees(fayGold)).toEqual([["2026-10-15", "2026-11-14", 1000, "void"]]);
      expect(held(await get(heldUrl(gymId, fay), owner.cookies)).memberships[0]?.billing?.fees).toEqual([]);
      // Frozen again that day: charged again, once.
      expect((await freeze(gymId, fay, fayGold, owner.cookies, { feeMinor: 1000 })).statusCode).toBe(200);
      expect((await fees(fayGold)).filter((f) => f[3] === "open")).toEqual([["2026-10-15", "2026-11-14", 1000, "open"]]);

      // Waived: never opened again by the run.
      const fee = held(await get(heldUrl(gymId, fay), owner.cookies)).memberships[0]?.billing?.fees[0];
      if (fee === undefined) throw new Error("no fee");
      expect((await post(`${heldUrl(gymId, fay)}/${fayGold}/fees/${fee.id}/waive`, {}, owner.cookies)).statusCode).toBe(200);
      await run(gymId, "2026-10-16");
      expect((await fees(fayGold)).filter((f) => f[3] !== "void" || f[0] !== "2026-10-15").length).toBe(0);
      expect(await sql`SELECT 1 FROM gym_member_bills WHERE held_membership_id = ${fayGold} AND fee = 'freeze' AND void_reason = 'waived'`).toHaveLength(1);

      // The gym's fee goes up: Fay keeps the 10.00 she was frozen with; a freeze from now on is 15.00.
      clock = at("2026-10-20");
      await setFreezeFee(gymId, owner.cookies, 1500);
      await run(gymId, "2026-11-15");
      const second = await sql<{ id: string; amount_minor: number }[]>`
        SELECT id, amount_minor FROM gym_member_bills WHERE held_membership_id = ${fayGold} AND fee = 'freeze' AND status = 'open'`;
      expect(second.map((b) => b.amount_minor)).toEqual([1000]);
      const gus = await addPerson(gymId, owner.cookies, "Gus Later");
      const gusGold = await give(gymId, gus, owner.cookies, gold, 5000);
      expect(held(await get(heldUrl(gymId, gus), owner.cookies)).memberships[0]?.freezeFeeMinor).toBe(1500);
      // A screen still showing the old fee is refused.
      expect((await freeze(gymId, gus, gusGold, owner.cookies, { feeMinor: 1000 })).statusCode).toBe(409);
      expect((await freeze(gymId, gus, gusGold, owner.cookies, { feeMinor: 1500 })).statusCode).toBe(200);
      expect((await fees(gusGold)).map((f) => f[2])).toEqual([1500]);

      // Paid: a receipt that names the freeze fee and the membership.
      const owed = second[0];
      if (owed === undefined) throw new Error("no second fee");
      const paid = await post(`${heldUrl(gymId, fay)}/${fayGold}/fees/${owed.id}/payments`, { requestKey: nextForm(), amountMinor: 1000, method: "cash" }, owner.cookies);
      expect(paid.statusCode, paid.body).toBe(200);
      const [payment] = await sql<{ receipt_number: number }[]>`SELECT receipt_number FROM gym_member_payments WHERE bill_id = ${owed.id}`;
      const receipt = await get(`/v1/orgs/${gymId}/receipts/${String(payment?.receipt_number)}`, owner.cookies);
      expect(receipt.statusCode, receipt.body).toBe(200);
      expect(JSON.stringify(receiptSchema.parse(JSON.parse(receipt.body)))).toContain("Freeze fee · Gold Monthly");

      // Cancelled while frozen on the day a new month begins: that month's unpaid fee comes off.
      clock = at("2026-12-15");
      await run(gymId, "2026-12-15");
      expect((await fees(fayGold)).filter((f) => f[0] === "2026-12-15")).toEqual([["2026-12-15", "2027-01-14", 1000, "open"]]);
      const cancel = await post(`${heldUrl(gymId, fay)}/${fayGold}/cancel`, { when: "today" }, owner.cookies);
      expect(cancel.statusCode, cancel.body).toBe(200);
      expect((await fees(fayGold)).filter((f) => f[0] === "2026-12-15")).toEqual([["2026-12-15", "2027-01-14", 1000, "void"]]);
    },
    T,
  );

  it(
    "staff without the payments tick freeze with the gym's fee and cannot untick it or change it; strangers get 404",
    async () => {
      clock = at("2026-10-15");
      const owner = await makeUser("tick-owner");
      const org = await makeGym(owner, "Ffee Tick Gym");
      const gymId = org.org.id;
      const desk = await makeUser("tick-desk");
      await makeDeskStaff(org, owner, desk);
      const stranger = await makeUser("tick-stranger");
      const otherId = (await makeGym(stranger, "Ffee Other Gym")).org.id;
      const gold = await addType(gymId, owner.cookies, typeBody("Gold Monthly", 5000));
      await setFreezeFee(gymId, owner.cookies, 1000);
      const hal = await addPerson(gymId, owner.cookies, "Hal Desk");
      const halGold = await give(gymId, hal, owner.cookies, gold, 5000);

      // The settings read for everyone on the page, changed only with the payments tick.
      const read = billSettingsResponseSchema.parse(JSON.parse((await get(settingsUrl(gymId), desk.cookies)).body));
      expect(read).toMatchObject({ freezeFeeMinor: 1000, currency: "USD", canChange: false });
      expect((await put(settingsUrl(gymId), { overdueAfterDays: 0, freezeFeeMinor: 0 }, desk.cookies)).statusCode).toBe(403);
      // Unticking is a waiver: refused for them, nothing written.
      expect((await freeze(gymId, hal, halGold, desk.cookies, { feeMinor: 0 })).statusCode).toBe(409);
      expect(await statusOf(halGold)).toEqual({ status: "active", freeze_fee_minor: 0 });
      expect((await freeze(gymId, hal, halGold, desk.cookies, { feeMinor: 1000 })).statusCode).toBe(200);
      expect((await fees(halGold)).length).toBe(1);

      // A stranger reads and changes nothing, here or on the settings.
      clock = at("2026-10-16");
      expect((await unfreeze(gymId, hal, halGold, stranger.cookies)).statusCode).toBe(404);
      expect((await freeze(gymId, hal, halGold, stranger.cookies, { feeMinor: 0 })).statusCode).toBe(404);
      expect((await get(settingsUrl(gymId), stranger.cookies)).statusCode).toBe(404);
      expect((await put(settingsUrl(gymId), { overdueAfterDays: 0, freezeFeeMinor: 0 }, stranger.cookies)).statusCode).toBe(404);
      expect((await put(settingsUrl(gymId), { overdueAfterDays: 0, freezeFeeMinor: 0 }, {})).statusCode).toBe(401);
      expect(await statusOf(halGold)).toEqual({ status: "frozen", freeze_fee_minor: 1000 });
      const [row] = await sql<{ freeze_fee_minor: number }[]>`SELECT freeze_fee_minor FROM gyms WHERE id = ${gymId}`;
      expect(row?.freeze_fee_minor).toBe(1000);
      const [theirs] = await sql<{ freeze_fee_minor: number }[]>`SELECT freeze_fee_minor FROM gyms WHERE id = ${otherId}`;
      expect(theirs?.freeze_fee_minor).toBe(0);
      // The change is a line in Staff activity.
      const audit = await sql<{ meta: Record<string, string> }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.freeze_fee_changed'`;
      expect(audit.map((a) => a.meta["freezeFeeMinor"])).toEqual(["1000"]);
    },
    T,
  );
});
