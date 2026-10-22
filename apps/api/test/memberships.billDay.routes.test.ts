// BILLING EVERYONE ON ONE DAY OF THE MONTH, through the real routes and the hourly bill run
// against real Postgres (spec Part 3 §14.8; ROADMAP 18y). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: charge them twice for the same days, or a
// whole month for a part month. That is the first test: a member who joins on 15 October at a
// gym that bills on the 1st pays for 15 to 31 October alone, at the price for those days, and
// every bill after it starts on the 1st at the full price, each the day after the last one ended;
// a total or a billing day the screen did not show is refused with nothing written.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { billSettingsResponseSchema, heldMembershipsResponseSchema, receiptSchema, sellPageResponseSchema, type GymMembershipTypesResponse, type HeldMembershipsResponse } from "@app/shared";
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
  JWT_SECRET: "bill-day-routes-secret-0123456789abcd", // dummy test value, gitleaks:allow
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
const LIVE_PLAN = "zz_bill_day_routes";
const log = { info: () => undefined, error: () => undefined };
// 12:00 in Chicago.
const at = (day: string) => new Date(`${day}T17:00:00Z`);

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
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

d("billing everyone on one day of the month (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = at("2026-10-15");
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'bday-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_tax_rates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'bday-t-%@example.com'`;
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
    const email = `bday-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Bday ${local}` });
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
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `bday-p-${String(++formCounter)}@example.com` }, cookies);
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
  const setBillDay = async (gymId: string, cookies: Cookies, billDay: number | null) => {
    const res = await put(settingsUrl(gymId), { overdueAfterDays: 0, billDay }, cookies);
    expect(res.statusCode, res.body).toBe(200);
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const giveBody = (typeId: string, priceMinor: number, totalMinor: number, fullFrom: string | null, over: Record<string, unknown> = {}) => ({
    requestKey: nextForm(),
    typeId,
    startsOn: "2026-10-15",
    paid: true,
    method: "cash",
    priceMinor,
    totalMinor,
    fullFrom,
    ...over,
  });
  const give = (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) => post(heldUrl(gymId, entryId), body, cookies);
  const held = (res: { body: string }): HeldMembershipsResponse => heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  const idsOf = async (gymId: string, entryId: string) =>
    (await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at, id`).map((r) => r.id);
  const count = async (gymId: string, table: "gym_held_memberships" | "gym_member_bills" | "gym_member_payments") =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(table)} WHERE gym_id = ${gymId}`)[0]?.n;
  /** Each bill as [from, to, what is to pay, its status]. */
  const bills = async (gymId: string, membershipId: string) =>
    (
      await sql<{ from: string; to: string; amount_minor: number; status: string }[]>`
        SELECT covers_from::text AS from, covers_to::text AS to, amount_minor, status
        FROM gym_member_bills WHERE gym_id = ${gymId} AND held_membership_id = ${membershipId} ORDER BY period_index`
    ).map((b) => [b.from, b.to, b.amount_minor, b.status]);
  const run = (gymId: string, day: string) => openDueBills({ sql, log }, { now: at(day), gymIds: [gymId] });
  const payOpen = async (gymId: string, entryId: string, membershipId: string, cookies: Cookies) => {
    const page = held(await get(heldUrl(gymId, entryId), cookies));
    const pay = page.memberships.find((m) => m.id === membershipId)?.billing?.pay;
    if (pay === null || pay === undefined) throw new Error("nothing to pay");
    const res = await post(`${heldUrl(gymId, entryId)}/${membershipId}/payments`, { requestKey: nextForm(), periodIndex: pay.periodIndex, amountMinor: pay.leftMinor, method: "cash" }, cookies);
    expect(res.statusCode, res.body).toBe(200);
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
    "a member who joins on the 15th pays for the 15th to the 31st alone, then the full price from the 1st: no day billed twice or missed, and nothing given at a total or a day the screen did not show",
    async () => {
      clock = at("2026-10-15");
      const owner = await makeUser("worst-owner");
      const gymId = (await makeGym(owner, "Bday Worst Gym")).org.id;
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      await setBillDay(gymId, owner.cookies, 1);
      const maya = await addPerson(gymId, owner.cookies, "Maya Rao");

      // A screen that showed the whole month, one that showed no billing day, and one that showed
      // another day: each refused, with nothing written, and told it is the billing day.
      for (const body of [
        giveBody(gold, 5000, 5000, null),
        giveBody(gold, 5000, 2741, null),
        giveBody(gold, 5000, 2741, "2026-10-31"),
        // A screen that showed a price and said nothing of a billing day.
        Object.fromEntries(Object.entries(giveBody(gold, 5000, 2741, "2026-11-01")).filter(([key]) => key !== "fullFrom")),
      ]) {
        const res = await give(gymId, maya, owner.cookies, body);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("membership_bill_day_changed");
      }
      // The right day and a whole month's total: the total is what is refused.
      const whole = await give(gymId, maya, owner.cookies, giveBody(gold, 5000, 5000, "2026-11-01"));
      expect(whole.statusCode, whole.body).toBe(409);
      expect(errorOf(whole)).toBe("membership_price_changed");
      expect([await count(gymId, "gym_held_memberships"), await count(gymId, "gym_member_bills"), await count(gymId, "gym_member_payments")]).toEqual([0, 0, 0]);

      // 15 to 31 October is 17 of October's 31 days: $50.00 × 17 / 31 = $27.41.
      const res = await give(gymId, maya, owner.cookies, giveBody(gold, 5000, 2741, "2026-11-01"));
      expect(res.statusCode, res.body).toBe(201);
      const [id = ""] = await idsOf(gymId, maya);
      expect(await bills(gymId, id)).toEqual([["2026-10-15", "2026-10-31", 2741, "paid"]]);
      const shown = held(res).memberships[0];
      expect(shown?.fullFrom).toBe("2026-11-01");
      expect(shown?.view).toMatchObject({ renewsOn: "2026-11-01", payment: { state: "paid", until: "2026-11-01" } });
      expect(shown?.billing?.bills[0]).toMatchObject({ part: true, amountMinor: 2741, covers: { from: "2026-10-15", to: "2026-10-31" } });

      // Nothing more before the 1st; then each month from the 1st, at the full price.
      expect((await run(gymId, "2026-10-31")).opened).toBe(0);
      expect((await run(gymId, "2026-11-01")).opened).toBe(1);
      await payOpen(gymId, maya, id, owner.cookies);
      expect((await run(gymId, "2026-12-01")).opened).toBe(1);
      await payOpen(gymId, maya, id, owner.cookies);
      expect((await run(gymId, "2027-01-01")).opened).toBe(1);
      const all = await bills(gymId, id);
      expect(all).toEqual([
        ["2026-10-15", "2026-10-31", 2741, "paid"],
        ["2026-11-01", "2026-11-30", 5000, "paid"],
        ["2026-12-01", "2026-12-31", 5000, "paid"],
        ["2027-01-01", "2027-01-31", 5000, "open"],
      ]);
      // Each bill starts the day after the one before it ended.
      for (let i = 1; i < all.length; i += 1) {
        const prev = new Date(`${String(all[i - 1]?.[1])}T00:00:00Z`);
        prev.setUTCDate(prev.getUTCDate() + 1);
        expect(all[i]?.[0]).toBe(prev.toISOString().slice(0, 10));
      }
      const later = held(await get(heldUrl(gymId, maya), owner.cookies)).memberships[0];
      // Only the first bill is the part month.
      expect(later?.billing?.bills.filter((b) => b.part).map((b) => b.periodIndex)).toEqual([0]);

      // The receipt of the first payment says the days, and that they are the part month.
      const [first] = await sql<{ n: number }[]>`SELECT receipt_number AS n FROM gym_member_payments WHERE gym_id = ${gymId} ORDER BY seq LIMIT 1`;
      const printed = await get(`/v1/orgs/${gymId}/receipts/${String(first?.n)}`, owner.cookies);
      expect(printed.statusCode, printed.body).toBe(200);
      const receipt = receiptSchema.parse(JSON.parse(printed.body));
      if (receipt.kind !== "payment") throw new Error("not a payment receipt");
      expect(receipt.item).toEqual({ name: "Gold Monthly", covers: { from: "2026-10-15", to: "2026-10-31" }, part: true });
      expect(receipt.amounts.totalMinor).toBe(2741);
    },
    T,
  );

  it(
    "a joining fee and tax on top go on the part month's bill, the gym's day is the gym's own, and the same press twice gives one membership",
    async () => {
      clock = at("2026-10-15");
      const owner = await makeUser("tax-owner");
      const gymId = (await makeGym(owner, "Bday Tax Gym")).org.id;
      const rateRes = await post(`/v1/orgs/${gymId}/register/tax-rates`, { name: "Sales tax", bp: 1000 }, owner.cookies);
      expect(rateRes.statusCode, rateRes.body).toBe(201);
      const rate = sellPageResponseSchema.parse(JSON.parse(rateRes.body)).tax.rates.find((r) => r.name === "Sales tax");
      if (rate === undefined) throw new Error("no rate");
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 6200, { joiningFeeMinor: 2500, taxRateId: rate.id }));
      await setBillDay(gymId, owner.cookies, 1);
      expect(held(await get(heldUrl(gymId, await addPerson(gymId, owner.cookies, "Look Only")), owner.cookies)).billDay).toBe(1);
      expect((JSON.parse((await get(`/v1/orgs/${gymId}/membership-types`, owner.cookies)).body) as GymMembershipTypesResponse).billDay).toBe(1);

      // $62.00 × 17 / 31 = $34.00, the $25.00 joining fee, and 10% on both: $64.90.
      const tara = await addPerson(gymId, owner.cookies, "Tara Shah");
      const body = giveBody(gold, 6200, 6490, "2026-11-01", { joiningFeeMinor: 2500 });
      const [a, b] = await Promise.all([give(gymId, tara, owner.cookies, body), give(gymId, tara, owner.cookies, body)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 201]);
      const [id = ""] = await idsOf(gymId, tara);
      expect(await idsOf(gymId, tara)).toHaveLength(1);
      expect(await bills(gymId, id)).toEqual([["2026-10-15", "2026-10-31", 6490, "paid"]]);
      const [tax] = await sql<{ tax_minor: number; joining_fee_minor: number }[]>`SELECT tax_minor, joining_fee_minor FROM gym_member_bills WHERE held_membership_id = ${id}`;
      expect(tax).toEqual({ tax_minor: 590, joining_fee_minor: 2500 });
      // The next month: the full price and its tax, no fee.
      expect((await run(gymId, "2026-11-01")).opened).toBe(1);
      expect((await bills(gymId, id))[1]).toEqual(["2026-11-01", "2026-11-30", 6820, "open"]);

      // Starting on the 1st itself: no part month, the whole price.
      const noah = await addPerson(gymId, owner.cookies, "Noah Brown");
      clock = at("2026-11-01");
      const whole = await give(gymId, noah, owner.cookies, giveBody(gold, 6200, 9570, null, { startsOn: "2026-11-01", joiningFeeMinor: 2500 }));
      expect(whole.statusCode, whole.body).toBe(201);
      expect(await bills(gymId, (await idsOf(gymId, noah))[0] ?? "")).toEqual([["2026-11-01", "2026-11-30", 9570, "paid"]]);
    },
    T,
  );

  it(
    "the setting: only staff who take payments change it, each change is in the gym's activity, members who already have a membership keep their own day, and turning it off moves nobody",
    async () => {
      clock = at("2026-10-05");
      const owner = await makeUser("set-owner");
      const org = await makeGym(owner, "Bday Settings Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const read = async (cookies: Cookies) => billSettingsResponseSchema.parse(JSON.parse((await get(settingsUrl(gymId), cookies)).body));
      expect(await read(owner.cookies)).toEqual({ overdueAfterDays: 0, billDay: null, canChange: true });

      // Somebody given a membership before the gym had a day keeps theirs, the 5th.
      const early = await addPerson(gymId, owner.cookies, "Early Member");
      expect((await give(gymId, early, owner.cookies, giveBody(gold, 5000, 5000, null, { startsOn: "2026-10-05" }))).statusCode).toBe(201);
      const [earlyId = ""] = await idsOf(gymId, early);

      const desk = await makeUser("set-desk");
      await makeDeskStaff(org, owner, desk);
      const refused = await put(settingsUrl(gymId), { overdueAfterDays: 0, billDay: 1 }, desk.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(await read(desk.cookies)).toEqual({ overdueAfterDays: 0, billDay: null, canChange: false });

      for (const billDay of [0, 29, 31, 1.5, "1"]) expect((await put(settingsUrl(gymId), { overdueAfterDays: 0, billDay }, owner.cookies)).statusCode).toBe(400);
      await setBillDay(gymId, owner.cookies, 1);
      // Saving the same again writes nothing; a save of the grace alone leaves the day as it is.
      await setBillDay(gymId, owner.cookies, 1);
      const graceOnly = await put(settingsUrl(gymId), { overdueAfterDays: 3 }, owner.cookies);
      expect(graceOnly.statusCode, graceOnly.body).toBe(200);
      expect(await read(owner.cookies)).toEqual({ overdueAfterDays: 3, billDay: 1, canChange: true });
      const lines = async () =>
        (await sql<{ meta: Record<string, string> }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.bill_day_changed' ORDER BY at`).map((r) => r.meta["billDay"]);
      expect(await lines()).toEqual(["1"]);

      clock = at("2026-11-05");
      expect((await run(gymId, "2026-11-05")).opened).toBe(1);
      expect(await bills(gymId, earlyId)).toEqual([
        ["2026-10-05", "2026-11-04", 5000, "paid"],
        ["2026-11-05", "2026-12-04", 5000, "open"],
      ]);

      // A member given one while the day was set, then the day turned off: theirs stays on the 1st.
      clock = at("2026-11-10");
      const mid = await addPerson(gymId, owner.cookies, "Mid Member");
      // 10 to 30 November is 21 of November's 30 days: $35.00.
      expect((await give(gymId, mid, owner.cookies, giveBody(gold, 5000, 3500, "2026-12-01", { startsOn: "2026-11-10" }))).statusCode).toBe(201);
      await setBillDay(gymId, owner.cookies, null);
      expect(await lines()).toEqual(["1", "off"]);
      const [midId = ""] = await idsOf(gymId, mid);
      expect((await run(gymId, "2026-12-01")).opened).toBe(1);
      expect(await bills(gymId, midId)).toEqual([
        ["2026-11-10", "2026-11-30", 3500, "paid"],
        ["2026-12-01", "2026-12-31", 5000, "open"],
      ]);
      // And one given now is billed from its own start again.
      const late = await addPerson(gymId, owner.cookies, "Late Member");
      expect((await give(gymId, late, owner.cookies, giveBody(gold, 5000, 5000, null, { startsOn: "2026-11-10" }))).statusCode).toBe(201);
      expect(await bills(gymId, (await idsOf(gymId, late))[0] ?? "")).toEqual([["2026-11-10", "2026-12-09", 5000, "paid"]]);
    },
    T,
  );

  it(
    "a part month with no bill yet is offered and opened at the part month's price, and a first-month discount's receipt prints the price and the discount for those days",
    async () => {
      clock = at("2026-10-15");
      const owner = await makeUser("open-owner");
      const gymId = (await makeGym(owner, "Bday Open Gym")).org.id;
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      await setBillDay(gymId, owner.cookies, 1);

      // Given unpaid, then its first bill gone (as no screen does): what is offered and what a payment
      // opens are the part month's, $27.41, never the whole month.
      const leo = await addPerson(gymId, owner.cookies, "Leo Part");
      expect((await give(gymId, leo, owner.cookies, giveBody(gold, 5000, 2741, "2026-11-01", { paid: false }))).statusCode).toBe(201);
      const [leoId = ""] = await idsOf(gymId, leo);
      await sql`DELETE FROM gym_member_bills WHERE gym_id = ${gymId} AND held_membership_id = ${leoId}`;
      const page = held(await get(heldUrl(gymId, leo), owner.cookies));
      expect(page.memberships[0]?.billing?.pay).toMatchObject({ periodIndex: 0, leftMinor: 2741 });
      await payOpen(gymId, leo, leoId, owner.cookies);
      expect(await bills(gymId, leoId)).toEqual([["2026-10-15", "2026-10-31", 2741, "paid"]]);

      // 20% off the first payment: $40.00 a month, for 17 of 31 days $21.93; the days at the full
      // price are $27.41, so the receipt says $5.48 off.
      const discountRes = await post(
        `/v1/orgs/${gymId}/register/discounts`,
        {
          name: "First month",
          code: null,
          kind: "percent",
          percentBp: 2000,
          amountMinor: null,
          startsOn: null,
          endsOn: null,
          maxUses: null,
          forProducts: false,
          allProducts: true,
          productIds: [],
          forMemberships: true,
          allMembershipTypes: true,
          membershipTypeIds: [],
          membershipPayments: "first",
        },
        owner.cookies,
      );
      expect(discountRes.statusCode, discountRes.body).toBe(201);
      const firstMonth = sellPageResponseSchema.parse(JSON.parse(discountRes.body)).discounts[0];
      if (firstMonth === undefined) throw new Error("no discount");
      const mia = await addPerson(gymId, owner.cookies, "Mia Discount");
      const res = await give(gymId, mia, owner.cookies, giveBody(gold, 5000, 2193, "2026-11-01", { discountId: firstMonth.id, discountMinor: 1000 }));
      expect(res.statusCode, res.body).toBe(201);
      const [last] = await sql<{ n: number }[]>`SELECT receipt_number AS n FROM gym_member_payments WHERE gym_id = ${gymId} ORDER BY seq DESC LIMIT 1`;
      const printed = receiptSchema.parse(JSON.parse((await get(`/v1/orgs/${gymId}/receipts/${String(last?.n)}`, owner.cookies)).body));
      if (printed.kind !== "payment") throw new Error("not a payment receipt");
      expect(printed.amounts).toMatchObject({ listedMinor: 2741, discount: { name: "First month", minor: 548 }, totalMinor: 2193 });
    },
    T,
  );

  it(
    "a change today at a gym that bills on the 1st: the new one's part month, less the unused days of the old one's part month",
    async () => {
      clock = at("2026-10-15");
      const owner = await makeUser("chg-owner");
      const gymId = (await makeGym(owner, "Bday Change Gym")).org.id;
      const basic = await addType(gymId, owner.cookies, monthly("Basic Monthly", 3000));
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      await setBillDay(gymId, owner.cookies, 1);
      const maya = await addPerson(gymId, owner.cookies, "Maya Change");
      // $30.00 × 17 / 31 = $16.45 for 15 to 31 October.
      expect((await give(gymId, maya, owner.cookies, giveBody(basic, 3000, 1645, "2026-11-01"))).statusCode).toBe(201);
      const [basicId = ""] = await idsOf(gymId, maya);

      clock = at("2026-10-20");
      // 20 to 31 October is 12 of the part month's 17 days: $16.45 × 12 / 17 = $11.61 unused.
      // Gold for those 12 days of October's 31: $50.00 × 12 / 31 = $19.35; less $11.61, $7.74.
      const page = held(await get(heldUrl(gymId, maya), owner.cookies));
      expect(page.memberships.find((m) => m.id === basicId)?.billing?.change).toMatchObject({ ok: true, creditMinor: 1161, nextOn: "2026-11-01" });
      const changeBody = (fullFrom: string | null) => ({
        requestKey: nextForm(),
        typeId: gold,
        when: "today",
        startsOn: "2026-10-20",
        fullFrom,
        priceMinor: 5000,
        creditMinor: 1161,
        totalMinor: 774,
        paid: true,
        method: "cash",
      });
      const wrong = await post(`${heldUrl(gymId, maya)}/${basicId}/change`, changeBody(null), owner.cookies);
      expect(wrong.statusCode, wrong.body).toBe(409);
      expect(errorOf(wrong)).toBe("membership_bill_day_changed");
      expect(await idsOf(gymId, maya)).toHaveLength(1);
      const res = await post(`${heldUrl(gymId, maya)}/${basicId}/change`, changeBody("2026-11-01"), owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const [, goldId = ""] = await idsOf(gymId, maya);
      expect(await bills(gymId, goldId)).toEqual([["2026-10-20", "2026-10-31", 774, "paid"]]);
      expect((await run(gymId, "2026-11-01")).opened).toBe(1);
      expect((await bills(gymId, goldId))[1]).toEqual(["2026-11-01", "2026-11-30", 5000, "open"]);
    },
    T,
  );

  it(
    "another gym's staff and a stranger get 404 for the setting, and nothing of it changes",
    async () => {
      clock = at("2026-10-15");
      const owner = await makeUser("tenant-owner");
      const gymId = (await makeGym(owner, "Bday Tenant Gym")).org.id;
      const stranger = await makeUser("tenant-stranger");
      const otherId = (await makeGym(stranger, "Bday Next Door")).org.id;
      await setBillDay(otherId, stranger.cookies, 15);
      // A membership given here while the gym next door bills on the 15th: from its own start, whole.
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const ana = await addPerson(gymId, owner.cookies, "Ana Own Day");
      expect((await give(gymId, ana, owner.cookies, giveBody(gold, 5000, 5000, null))).statusCode).toBe(201);
      expect(await bills(gymId, (await idsOf(gymId, ana))[0] ?? "")).toEqual([["2026-10-15", "2026-11-14", 5000, "paid"]]);
      expect((await get(settingsUrl(gymId), stranger.cookies)).statusCode).toBe(404);
      expect((await put(settingsUrl(gymId), { overdueAfterDays: 0, billDay: 1 }, stranger.cookies)).statusCode).toBe(404);
      expect((await put(settingsUrl(gymId), { overdueAfterDays: 0, billDay: 1 }, {})).statusCode).toBe(401);
      const [row] = await sql<{ bills_day: number | null }[]>`SELECT bills_day FROM gyms WHERE id = ${gymId}`;
      expect(row?.bills_day).toBeNull();
      const [theirs] = await sql<{ bills_day: number | null }[]>`SELECT bills_day FROM gyms WHERE id = ${otherId}`;
      expect(theirs?.bills_day).toBe(15);
    },
    T,
  );
});
