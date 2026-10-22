// MOVE TO ANOTHER MEMBERSHIP, through the real routes and the hourly bill run against real
// Postgres (spec Part 3 §14.8; ROADMAP 18x). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: charge a member again for days they have
// already paid for, or show them owing money they do not. That is the first test: a member who
// paid $50.00 for October and moves to an $80.00 membership on 16 October pays $54.20 today and
// $80.00 a month after, never a second October; a change at any credit or total the server did
// not work out writes nothing at all; a cheaper move waits for the next payment date, so no money
// is ever left over; an unpaid month is never credited.
//
// Every amount was worked out by hand (October has 31 days; 16 to 31 October is 16), and every
// refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { heldMembershipsResponseSchema, receiptSchema, type ClassBookingsEnding, type HeldMembershipsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "membership-change-routes-secret-012345", // dummy test value, gitleaks:allow
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
const LIVE_PLAN = "zz_membership_change_routes";
const log = { info: () => undefined, error: () => undefined };
const OCT_1 = new Date("2026-10-01T17:00:00Z"); // 12:00 in Chicago
const OCT_16 = new Date("2026-10-16T17:00:00Z");

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
/** A fresh request key, as the screen makes one a form. */
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (name: string, priceMinor: number, over: Record<string, unknown> = {}) => ({
  name,
  description: null,
  kind: "recurring",
  priceMinor,
  termCount: 1,
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
  ...over,
});

d("move to another membership (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = OCT_1;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chg-t-%@example.com')`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_type_classes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_tax_rates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'chg-t-%@example.com'`;
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
    const email = `chg-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Chg ${local}` });
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
  /** A manager without the payments tick: they add memberships and take no payments. */
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
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `chg-p-${String(++formCounter)}@example.com` }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error(`no live type named ${String(body["name"])}`);
    return found.id;
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const held = (res: { body: string }): HeldMembershipsResponse => heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  const page = async (gymId: string, entryId: string, cookies: Cookies) => held(await get(heldUrl(gymId, entryId), cookies));
  /** A membership given at the desk, paid in cash, at its price. */
  const givePaid = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, priceMinor: number, startsOn: string, totalMinor = priceMinor): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn, paid: true, method: "cash", priceMinor, totalMinor }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND membership_type_id = ${typeId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("not given");
    return row.id;
  };
  const changeBody = (typeId: string, priceMinor: number, creditMinor: number, totalMinor: number, over: Record<string, unknown> = {}) => ({
    requestKey: nextForm(),
    typeId,
    when: "today",
    startsOn: "2026-10-16",
    priceMinor,
    creditMinor,
    totalMinor,
    paid: true,
    method: "cash",
    ...over,
  });
  const change = (gymId: string, entryId: string, membershipId: string, cookies: Cookies, body: Record<string, unknown>) =>
    post(`${heldUrl(gymId, entryId)}/${membershipId}/change`, body, cookies);

  const rows = async (gymId: string, entryId: string) =>
    (
      await sql<{ id: string; type: string; status: string; starts_on: string; cancelled_on: string | null; renews: boolean; paid_periods: number; replaces_id: string | null }[]>`
        SELECT h.id, t.name AS type, h.status, h.starts_on::text AS starts_on, h.cancelled_on::text AS cancelled_on, h.renews, h.paid_periods, h.replaces_id
        FROM gym_held_memberships h JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
        WHERE h.gym_id = ${gymId} AND h.entry_id = ${entryId} ORDER BY h.created_at, h.id`
    ).map((r) => ({ ...r }));
  /** Each bill as [its day, what is to pay, the change credit off it, its status]. */
  const bills = async (gymId: string, membershipId: string) =>
    (
      await sql<{ due_on: string; amount_minor: number; change_credit_minor: number; status: string }[]>`
        SELECT due_on::text AS due_on, amount_minor, change_credit_minor, status
        FROM gym_member_bills WHERE gym_id = ${gymId} AND held_membership_id = ${membershipId} ORDER BY period_index`
    ).map((b) => [b.due_on, b.amount_minor, b.change_credit_minor, b.status]);
  const paymentsOf = async (gymId: string) => (await sql<{ amount_minor: number }[]>`SELECT amount_minor FROM gym_member_payments WHERE gym_id = ${gymId} ORDER BY seq`).map((p) => p.amount_minor);
  const run = (gymId: string, iso: string) => openDueBills({ sql, log }, { now: new Date(iso), gymIds: [gymId] });
  const changeOf = (res: HeldMembershipsResponse, id: string) => res.memberships.find((m) => m.id === id)?.billing?.change;

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
    "a member who paid for October and moves on 16 October pays for the 16 days once: the credit is taken off, nothing is written at any other amount, a cheaper move waits, and an unpaid month is never credited",
    async () => {
      clock = OCT_1;
      const owner = await makeUser("worst-owner");
      const gymId = (await makeGym(owner, "Chg Worst Gym")).org.id;
      const basic = await addType(gymId, owner.cookies, monthly("Basic Monthly", 5000));
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 8000));
      const cheap = await addType(gymId, owner.cookies, monthly("Off Peak", 3000));
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const mayaBasic = await givePaid(gymId, maya, owner.cookies, basic, 5000, "2026-10-01");

      clock = OCT_16;
      // The page says what a change today takes off: $50.00 × 16 / 31 = $25.80.
      expect(changeOf(await page(gymId, maya, owner.cookies), mayaBasic)).toEqual({ ok: true, creditMinor: 2580, daysLeft: 16, nextOn: "2026-11-01" });

      // A credit a cent either way, none at all, a total that leaves the credit out: nothing is written.
      for (const [body, error] of [
        [changeBody(gold, 8000, 2581, 5419), "membership_change_credit_changed"],
        [changeBody(gold, 8000, 2579, 5421), "membership_change_credit_changed"],
        [changeBody(gold, 8000, 0, 8000), "membership_change_credit_changed"],
        [changeBody(gold, 8000, 2580, 8000), "membership_price_changed"],
        [changeBody(gold, 7999, 2580, 5419), "membership_price_changed"],
      ] as const) {
        const res = await change(gymId, maya, mayaBasic, owner.cookies, body);
        expect([res.statusCode, errorOf(res)], res.body).toEqual([409, error]);
      }
      expect((await rows(gymId, maya)).map((r) => [r.type, r.status])).toEqual([["Basic Monthly", "active"]]);
      expect(await paymentsOf(gymId)).toEqual([5000]);

      // $80.00 less $25.80: $54.20 paid today. The same press again changes nothing more.
      const body = changeBody(gold, 8000, 2580, 5420);
      const done = await change(gymId, maya, mayaBasic, owner.cookies, body);
      expect(done.statusCode, done.body).toBe(200);
      expect((await change(gymId, maya, mayaBasic, owner.cookies, body)).statusCode).toBe(200);
      const [old, now] = await rows(gymId, maya);
      expect(old).toMatchObject({ id: mayaBasic, status: "cancelled", cancelled_on: "2026-10-16", replaces_id: null });
      expect(now).toMatchObject({ type: "Gold Monthly", status: "active", starts_on: "2026-10-16", paid_periods: 1, replaces_id: mayaBasic });
      if (now === undefined) throw new Error("no new membership");
      expect(await bills(gymId, mayaBasic)).toEqual([["2026-10-01", 5000, 0, "paid"]]);
      expect(await bills(gymId, now.id)).toEqual([["2026-10-16", 5420, 2580, "paid"]]);
      expect(await paymentsOf(gymId)).toEqual([5000, 5420]);

      // Month after month, $80.00 and nothing more; the old one is never billed again.
      for (const iso of ["2026-11-16T17:00:00Z", "2026-12-16T17:00:00Z"]) expect((await run(gymId, iso)).failed).toBe(0);
      expect(await bills(gymId, mayaBasic)).toEqual([["2026-10-01", 5000, 0, "paid"]]);
      expect(await bills(gymId, now.id)).toEqual([
        ["2026-10-16", 5420, 2580, "paid"],
        ["2026-11-16", 8000, 0, "open"],
        ["2026-12-16", 8000, 0, "open"],
      ]);
      clock = new Date("2026-10-16T18:00:00Z");
      const shown = await page(gymId, maya, owner.cookies);
      expect(shown.memberships.find((m) => m.id === now.id)?.changedFrom).toEqual({ typeName: "Basic Monthly", stopped: false });
      expect(shown.memberships.find((m) => m.id === mayaBasic)?.changedTo).toEqual({ typeName: "Gold Monthly", startsOn: "2026-10-16" });
      expect(changeOf(shown, mayaBasic)).toBeNull();

      // Noah paid $80.00 for October: half a month is $41.29, more than Off Peak's $30.00.
      clock = OCT_1;
      const noah = await addPerson(gymId, owner.cookies, "Noah Brown");
      const noahGold = await givePaid(gymId, noah, owner.cookies, gold, 8000, "2026-10-01");
      clock = OCT_16;
      const left = await change(gymId, noah, noahGold, owner.cookies, changeBody(cheap, 3000, 4129, 0));
      expect([left.statusCode, errorOf(left)]).toEqual([409, "membership_change_left_over"]);
      expect((await rows(gymId, noah)).map((r) => [r.status, r.renews])).toEqual([["active", true]]);
      // On the next payment date: October runs out on Gold, and Off Peak starts on 1 November at $30.00.
      // A screen that said another day (a payment ahead recorded meanwhile) changes nothing (Low-1).
      const stale = await change(gymId, noah, noahGold, owner.cookies, changeBody(cheap, 3000, 0, 3000, { when: "next_payment", startsOn: "2026-12-01", paid: false }));
      expect([stale.statusCode, errorOf(stale)]).toEqual([409, "membership_change_credit_changed"]);
      expect((await rows(gymId, noah)).map((r) => [r.status, r.renews])).toEqual([["active", true]]);
      const later = await change(gymId, noah, noahGold, owner.cookies, changeBody(cheap, 3000, 0, 3000, { when: "next_payment", startsOn: "2026-11-01", paid: false }));
      expect(later.statusCode, later.body).toBe(200);
      // The page no longer offers a second change of Gold, which runs to 31 October.
      expect(changeOf(await page(gymId, noah, owner.cookies), noahGold)).toEqual({ ok: false, reason: "changed_already" });
      const [noahOld, noahNew] = await rows(gymId, noah);
      expect(noahOld).toMatchObject({ status: "active", renews: false, cancelled_on: null });
      expect(noahNew).toMatchObject({ type: "Off Peak", starts_on: "2026-11-01", replaces_id: noahGold });
      if (noahNew === undefined) throw new Error("no new membership");
      expect(await bills(gymId, noahNew.id)).toEqual([["2026-11-01", 3000, 0, "open"]]);
      expect((await run(gymId, "2026-11-02T17:00:00Z")).failed).toBe(0);
      expect(await bills(gymId, noahGold)).toEqual([["2026-10-01", 8000, 0, "paid"]]);

      // Ava has not paid for October: nothing is credited, and nothing changes.
      clock = OCT_1;
      const ava = await addPerson(gymId, owner.cookies, "Ava Unpaid");
      const given = await post(heldUrl(gymId, ava), { requestKey: nextForm(), typeId: basic, startsOn: "2026-10-01", paid: false, priceMinor: 5000, totalMinor: 5000 }, owner.cookies);
      expect(given.statusCode, given.body).toBe(201);
      const avaBasic = (await rows(gymId, ava))[0]?.id ?? "";
      clock = OCT_16;
      expect(changeOf(await page(gymId, ava, owner.cookies), avaBasic)).toEqual({ ok: false, reason: "unpaid" });
      const unpaid = await change(gymId, ava, avaBasic, owner.cookies, changeBody(gold, 8000, 0, 8000));
      expect([unpaid.statusCode, errorOf(unpaid)]).toEqual([409, "membership_change_unpaid"]);
      expect((await rows(gymId, ava)).map((r) => r.status)).toEqual(["active"]);
    },
    T,
  );

  it(
    "tax on top is charged on what is left, the bill and the receipt say what came off, and a same-price move on the first day starts paid with no bill",
    async () => {
      clock = OCT_1;
      const owner = await makeUser("tax-owner");
      const gymId = (await makeGym(owner, "Chg Tax Gym")).org.id;
      const rate = await post(`/v1/orgs/${gymId}/register/tax-rates`, { name: "Sales tax", bp: 1000 }, owner.cookies);
      expect(rate.statusCode, rate.body).toBe(201);
      const [taxRow] = await sql<{ id: string }[]>`SELECT id FROM gym_tax_rates WHERE gym_id = ${gymId}`;
      const taxRateId = taxRow?.id ?? null;
      const basic = await addType(gymId, owner.cookies, monthly("Basic Monthly", 5000, { taxRateId }));
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 8000, { taxRateId }));
      const silver = await addType(gymId, owner.cookies, monthly("Silver Monthly", 5000));
      const maya = await addPerson(gymId, owner.cookies, "Maya Tax");
      // $50.00 and 10% on top: $55.00 paid for October.
      const mayaBasic = await givePaid(gymId, maya, owner.cookies, basic, 5000, "2026-10-01", 5500);
      clock = OCT_16;
      expect(changeOf(await page(gymId, maya, owner.cookies), mayaBasic)).toMatchObject({ ok: true, creditMinor: 2580 });
      // $80.00 less $25.80 is $54.20, and 10% on that: $59.62.
      const res = await change(gymId, maya, mayaBasic, owner.cookies, changeBody(gold, 8000, 2580, 5962));
      expect(res.statusCode, res.body).toBe(200);
      const mayaGold = (await rows(gymId, maya))[1]?.id ?? "";
      expect(await bills(gymId, mayaGold)).toEqual([["2026-10-16", 5962, 2580, "paid"]]);
      const bill = held(res).memberships.find((m) => m.id === mayaGold)?.billing?.bills[0];
      expect([bill?.amountMinor, bill?.changeCreditMinor, bill?.tax?.minor]).toEqual([5962, 2580, 542]);
      const [receipt] = await sql<{ n: number }[]>`SELECT receipt_number AS n FROM gym_member_payments WHERE gym_id = ${gymId} ORDER BY seq DESC LIMIT 1`;
      const printed = await get(`/v1/orgs/${gymId}/receipts/${String(receipt?.n)}`, owner.cookies);
      expect(printed.statusCode, printed.body).toBe(200);
      const parsed = receiptSchema.parse(JSON.parse(printed.body));
      if (parsed.kind !== "payment") throw new Error("not a payment receipt");
      expect(parsed.changeCredit).toEqual({ minor: 2580, fromName: "Basic Monthly" });
      expect([parsed.amounts.listedMinor, parsed.amounts.totalMinor, parsed.paidMinor]).toEqual([5420, 5962, 5962]);

      // Started on 16 October and moved the same day to Silver at the same $50.00: the whole month
      // is already paid, so Silver starts paid, with no bill, until 16 November.
      const zoe = await addPerson(gymId, owner.cookies, "Zoe Same");
      const zoeBasic = await givePaid(gymId, zoe, owner.cookies, basic, 5000, "2026-10-16", 5500);
      expect(changeOf(await page(gymId, zoe, owner.cookies), zoeBasic)).toMatchObject({ ok: true, creditMinor: 5000 });
      const same = await change(gymId, zoe, zoeBasic, owner.cookies, changeBody(silver, 5000, 5000, 0, { paid: false }));
      expect(same.statusCode, same.body).toBe(200);
      const zoeSilver = held(same).memberships.find((m) => m.typeName === "Silver Monthly");
      expect(zoeSilver?.view.payment).toEqual({ state: "paid", until: "2026-11-16" });
      expect(await bills(gymId, zoeSilver?.id ?? "")).toEqual([]);
      expect((await run(gymId, "2026-11-16T17:00:00Z")).failed).toBe(0);
      expect(await bills(gymId, zoeSilver?.id ?? "")).toEqual([["2026-11-16", 5000, 0, "open"]]);
    },
    T,
  );

  it(
    "classes booked on the old membership move to the new one where it covers them; the rest end only once confirmed, and nothing is written before",
    async () => {
      clock = OCT_1;
      const owner = await makeUser("book-owner");
      const gymId = (await makeGym(owner, "Chg Book Gym")).org.id;
      const classType = async (name: string) =>
        (await sql<{ id: string }[]>`INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gymId}, ${name}, 45, 10, 'blue', false) RETURNING id`)[0]?.id ?? "";
      const spin = await classType("Spin");
      const yoga = await classType("Yoga");
      const all = await addType(gymId, owner.cookies, monthly("All Classes", 5000));
      const spinOnly = await addType(gymId, owner.cookies, monthly("Spin Only", 6000, { classTypeIds: [spin], access: "all_classes" }));
      await sql`UPDATE gym_membership_types SET covers_all_classes = false WHERE id = ${spinOnly}`;
      await sql`INSERT INTO gym_membership_type_classes (membership_type_id, class_type_id, gym_id) VALUES (${spinOnly}, ${spin}, ${gymId}) ON CONFLICT DO NOTHING`;
      const member = await makeUser("book-member");
      const maya = await addPerson(gymId, owner.cookies, "Maya Classes");
      const mayaAll = await givePaid(gymId, maya, owner.cookies, all, 5000, "2026-10-01");
      const session = async (classTypeId: string, day: string) =>
        (
          await sql<{ id: string }[]>`
            INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
            VALUES (${gymId}, ${classTypeId}, ${day}::date, 600, (${day}::date + interval '10 hours') AT TIME ZONE 'America/Chicago', 45, 10, 'scheduled')
            RETURNING id`
        )[0]?.id ?? "";
      const book = async (sessionId: string) =>
        await sql`
          INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, held_membership_id, pack_charged, created_at, booked_at)
          VALUES (${gymId}, ${sessionId}, ${member.userId}, ${maya}, gen_random_uuid(), 'booked', ${mayaAll}, false, now(), now())`;
      const spinClass = await session(spin, "2026-10-20");
      const yogaClass = await session(yoga, "2026-10-21");
      await book(spinClass);
      await book(yogaClass);
      const bookingOf = async (sessionId: string) =>
        (await sql<{ status: string; held: string | null }[]>`SELECT status, held_membership_id AS held FROM gym_class_bookings WHERE session_id = ${sessionId}`).map((b) => [b.status, b.held]);

      clock = OCT_16;
      // $60.00 less $25.80: $34.20. Yoga is not on Spin Only, so the screen is asked first.
      const body = changeBody(spinOnly, 6000, 2580, 3420);
      const asked = await change(gymId, maya, mayaAll, owner.cookies, body);
      expect([asked.statusCode, errorOf(asked)], asked.body).toEqual([409, "membership_has_bookings"]);
      const ending = (JSON.parse(asked.body) as { ending: ClassBookingsEnding }).ending;
      expect([ending.booked, ending.classes]).toEqual([1, 1]);
      expect((await rows(gymId, maya)).map((r) => r.status)).toEqual(["active"]);
      expect(await bookingOf(spinClass)).toEqual([["booked", mayaAll]]);
      expect(await paymentsOf(gymId)).toEqual([5000]);

      const confirmed = await change(gymId, maya, mayaAll, owner.cookies, { ...body, confirmBookings: ending.mark });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const mayaSpin = (await rows(gymId, maya))[1]?.id ?? "";
      expect(await bookingOf(spinClass)).toEqual([["booked", mayaSpin]]);
      expect((await bookingOf(yogaClass)).map(([status]) => status)).toEqual(["cancelled"]);
      const [audit] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.held_membership_changed'`;
      expect(audit?.meta).toMatchObject({ type: "All Classes", toType: "Spin Only", changeCreditMinor: "2580", bookingsMoved: "1", bookingsEnded: "1" });

      // Moved within the new type's own limit (Low-3): Once a Week takes the first of the two
      // classes in the week of 19 Oct, and the second goes through the same question.
      clock = OCT_1;
      const once = await addType(gymId, owner.cookies, monthly("Once a Week", 4000, { access: "limited", bookingsLimit: 1, bookingsPeriod: "week" }));
      const noah = await addPerson(gymId, owner.cookies, "Noah Limits");
      const noahAll = await givePaid(gymId, noah, owner.cookies, all, 5000, "2026-10-01");
      const first = await session(spin, "2026-10-20");
      const second = await session(spin, "2026-10-22");
      for (const s of [first, second]) {
        await sql`
          INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, held_membership_id, pack_charged, created_at, booked_at)
          VALUES (${gymId}, ${s}, ${member.userId}, ${noah}, gen_random_uuid(), 'booked', ${noahAll}, false, now(), now())`;
      }
      clock = OCT_16;
      // $40.00 less $25.80: $14.20.
      const limitBody = changeBody(once, 4000, 2580, 1420);
      const limitAsk = await change(gymId, noah, noahAll, owner.cookies, limitBody);
      expect([limitAsk.statusCode, errorOf(limitAsk)], limitAsk.body).toEqual([409, "membership_has_bookings"]);
      const limitEnding = (JSON.parse(limitAsk.body) as { ending: ClassBookingsEnding }).ending;
      expect(limitEnding.booked).toBe(1);
      expect((await change(gymId, noah, noahAll, owner.cookies, { ...limitBody, confirmBookings: limitEnding.mark })).statusCode).toBe(200);
      const noahOnce = (await rows(gymId, noah))[1]?.id ?? "";
      expect(await bookingOf(first)).toEqual([["booked", noahOnce]]);
      expect((await bookingOf(second)).map(([status]) => status)).toEqual(["cancelled"]);
    },
    T,
  );

  it(
    "only staff who record payments can change one; another gym finds nothing; two staff pressing at once change it once",
    async () => {
      clock = OCT_1;
      const owner = await makeUser("who-owner");
      const org = await makeGym(owner, "Chg Who Gym");
      const gymId = org.org.id;
      const basic = await addType(gymId, owner.cookies, monthly("Basic Monthly", 5000));
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 8000));
      const maya = await addPerson(gymId, owner.cookies, "Maya Who");
      const mayaBasic = await givePaid(gymId, maya, owner.cookies, basic, 5000, "2026-10-01");
      clock = OCT_16;

      const desk = await makeUser("who-desk");
      await makeDeskStaff(org, owner, desk);
      const byDesk = await change(gymId, maya, mayaBasic, desk.cookies, changeBody(gold, 8000, 2580, 5420));
      expect(byDesk.statusCode, byDesk.body).toBe(403);
      // The desk reads the page and sees no money, so no change either.
      expect((await page(gymId, maya, desk.cookies)).memberships[0]?.billing).toBeNull();

      const stranger = await makeUser("who-stranger");
      const theirs = (await makeGym(stranger, "Chg Other Gym")).org.id;
      expect((await change(theirs, maya, mayaBasic, stranger.cookies, changeBody(gold, 8000, 2580, 5420))).statusCode).toBe(404);
      expect((await change(gymId, maya, mayaBasic, stranger.cookies, changeBody(gold, 8000, 2580, 5420))).statusCode).toBe(404);
      expect((await post(`${heldUrl(gymId, maya)}/${mayaBasic}/change`, changeBody(gold, 8000, 2580, 5420))).statusCode).toBe(401);
      expect((await change(gymId, maya, mayaBasic, owner.cookies, { ...changeBody(gold, 8000, 2580, 5420), when: "next_payment" })).statusCode).toBe(400);
      expect((await rows(gymId, maya)).map((r) => r.status)).toEqual(["active"]);

      // Two presses with two forms at one instant: one change, one payment.
      const answers = await Promise.all([
        change(gymId, maya, mayaBasic, owner.cookies, changeBody(gold, 8000, 2580, 5420)),
        change(gymId, maya, mayaBasic, owner.cookies, changeBody(gold, 8000, 2580, 5420)),
      ]);
      expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 409]);
      const lost = answers.find((a) => a.statusCode === 409);
      expect(lost === undefined ? null : errorOf(lost)).toBe("membership_change_changed_already");
      expect((await rows(gymId, maya)).map((r) => [r.type, r.status])).toEqual([
        ["Basic Monthly", "cancelled"],
        ["Gold Monthly", "active"],
      ]);
      expect(await paymentsOf(gymId)).toEqual([5000, 5420]);
    },
    T,
  );

  it(
    "after a change: the old payment refunds only what did not move, a bill for days after it goes, and cancelling a later change before it starts sets the old one renewing again",
    async () => {
      clock = OCT_1;
      const owner = await makeUser("after-owner");
      const gymId = (await makeGym(owner, "Chg After Gym")).org.id;
      const basic = await addType(gymId, owner.cookies, monthly("Basic Monthly", 5000));
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 8000));
      const cheap = await addType(gymId, owner.cookies, monthly("Off Peak", 3000));
      const maya = await addPerson(gymId, owner.cookies, "Maya After");
      const mayaBasic = await givePaid(gymId, maya, owner.cookies, basic, 5000, "2026-10-01");
      const lee = await addPerson(gymId, owner.cookies, "Lee Open");
      const leeBasic = await givePaid(gymId, lee, owner.cookies, basic, 5000, "2026-10-01");
      const noah = await addPerson(gymId, owner.cookies, "Noah Undo");
      const noahGold = await givePaid(gymId, noah, owner.cookies, gold, 8000, "2026-10-01");
      clock = OCT_16;

      // High-2: $25.80 of Maya's $50.00 moved to Gold. $24.20 can be refunded, never the whole $50.00.
      expect((await change(gymId, maya, mayaBasic, owner.cookies, changeBody(gold, 8000, 2580, 5420))).statusCode).toBe(200);
      const shown = (await page(gymId, maya, owner.cookies)).memberships.find((m) => m.id === mayaBasic)?.billing?.bills[0];
      expect([shown?.movedMinor, shown?.payments[0]?.refundableMinor]).toEqual([2580, 2420]);
      const paymentId = shown?.payments[0]?.id ?? "";
      const refund = (amountMinor: number) =>
        post(`${heldUrl(gymId, maya)}/${mayaBasic}/payments/${paymentId}/refunds`, { requestKey: nextForm(), amountMinor, method: "cash", reason: "leaving" }, owner.cookies);
      const whole = await refund(5000);
      expect([whole.statusCode, errorOf(whole)]).toEqual([409, "refund_too_much"]);
      expect((await refund(2420)).statusCode).toBe(200);
      const more = await refund(1);
      expect([more.statusCode, errorOf(more)]).toEqual([409, "refund_too_much"]);
      expect((await sql<{ n: number }[]>`SELECT coalesce(sum(r.amount_minor), 0)::int AS n FROM gym_member_refunds r WHERE r.gym_id = ${gymId} AND r.undone_at IS NULL`)[0]?.n).toBe(2420);

      // A bill already open for November on Lee's Basic goes with the change: nobody owes for it.
      await sql`
        INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to)
        VALUES (${gymId}, ${leeBasic}, 1, 5000, 'USD', '2026-11-01', '2026-11-01', '2026-11-30')`;
      expect((await change(gymId, lee, leeBasic, owner.cookies, changeBody(gold, 8000, 2580, 5420))).statusCode).toBe(200);
      expect(await bills(gymId, leeBasic)).toEqual([
        ["2026-10-01", 5000, 0, "paid"],
        ["2026-11-01", 5000, 0, "void"],
      ]);

      // Low-2: Noah moves to Off Peak on 1 November; staff then cancel Off Peak before it starts, and
      // Gold renews again as it did before. A November bill already open on Gold goes with the change,
      // and is owed again once it is undone (the re-check's Low).
      await sql`
        INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to)
        VALUES (${gymId}, ${noahGold}, 1, 8000, 'USD', '2026-11-01', '2026-11-01', '2026-11-30')`;
      expect((await change(gymId, noah, noahGold, owner.cookies, changeBody(cheap, 3000, 0, 3000, { when: "next_payment", startsOn: "2026-11-01", paid: false }))).statusCode).toBe(200);
      expect((await bills(gymId, noahGold)).map((b) => b[3])).toEqual(["paid", "void"]);
      const offPeak = (await rows(gymId, noah))[1]?.id ?? "";
      expect((await page(gymId, noah, owner.cookies)).memberships.find((m) => m.id === offPeak)?.changedFrom).toEqual({ typeName: "Gold Monthly", stopped: true });
      expect((await rows(gymId, noah)).map((r) => [r.type, r.renews])).toEqual([
        ["Gold Monthly", false],
        ["Off Peak", true],
      ]);
      const undo = await post(`${heldUrl(gymId, noah)}/${offPeak}/cancel`, { when: "today" }, owner.cookies);
      expect(undo.statusCode, undo.body).toBe(200);
      expect((await rows(gymId, noah)).map((r) => [r.type, r.status, r.renews])).toEqual([
        ["Gold Monthly", "active", true],
        ["Off Peak", "cancelled", true],
      ]);
      expect(changeOf(await page(gymId, noah, owner.cookies), noahGold)).toMatchObject({ ok: true, nextOn: "2026-11-01" });
      expect(await bills(gymId, noahGold)).toEqual([
        ["2026-10-01", 8000, 0, "paid"],
        ["2026-11-01", 8000, 0, "open"],
      ]);
      // On 2 November the payment due has its bill to pay.
      clock = new Date("2026-11-02T17:00:00Z");
      expect((await page(gymId, noah, owner.cookies)).memberships.find((m) => m.id === noahGold)?.billing?.pay).toMatchObject({ periodIndex: 1, leftMinor: 8000 });
    },
    T,
  );
});
