// A JOINING FEE ON A MEMBERSHIP TYPE, through the real routes and the hourly bill run against
// real Postgres (spec Part 3 §14.8; ROADMAP 18t). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: charge the joining fee twice — on a
// renewal bill, or on a period paid ahead — or charge an amount the desk was never shown. That
// is the first test: a member's first bill carries the fee and every bill after it does not,
// month after month and paid ahead; a fee, a total or a price the screen did not show is
// refused with nothing written; a fee set since the screen was opened sends staff back.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  receiptSchema,
  sellPageResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type SellPageResponse,
} from "@app/shared";
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
  JWT_SECRET: "joining-fee-routes-secret-0123456789ab", // dummy test value, gitleaks:allow
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
const LIVE_PLAN = "zz_joining_fee_routes";
const log = { info: () => undefined, error: () => undefined };

let ipCounter = 0;
const nextIp = () => `10.96.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
/** A fresh request key, as the screen makes one a form. */
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
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
  ...over,
});

d("a joining fee on a membership type (real Postgres)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'jfee-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_discounts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_tax_rates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'jfee-t-%@example.com'`;
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
    const email = `jfee-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Jfee ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string): Promise<CreatedOrg> => {
    // Training here gives the gym its join code, which staff join by.
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${created.org.id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };
  /** A manager whose payments tick the owner has taken away: they add memberships and take no payments. */
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
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `jfee-p-${String(++formCounter)}@example.com` }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const typesUrl = (gymId: string) => `/v1/orgs/${gymId}/membership-types`;
  const priceList = async (gymId: string, cookies: Cookies) => JSON.parse((await get(typesUrl(gymId), cookies)).body) as GymMembershipTypesResponse;
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await post(typesUrl(gymId), body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error(`no live type named ${String(body["name"])}`);
    return found.id;
  };
  /** A change as the screen sends it: every field as the list has it, with `over` on top. */
  const changeType = async (gymId: string, cookies: Cookies, typeId: string, over: Record<string, unknown>) => {
    const t = (await priceList(gymId, cookies)).types.find((x) => x.id === typeId);
    if (t === undefined) throw new Error("no such type");
    const { id: _id, currency: _currency, archivedAt: _archived, classTypes: _classes, ...fields } = t;
    return await put(`${typesUrl(gymId)}/${typeId}`, { ...fields, classTypeIds: null, ...over }, cookies);
  };
  const feeOfType = async (typeId: string) => (await sql<{ fee: number }[]>`SELECT joining_fee_minor AS fee FROM gym_membership_types WHERE id = ${typeId}`)[0]?.fee;

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  /** A membership given today, paid in cash, at the price, joining fee and first total the screen showed. */
  const giveBody = (typeId: string, totalMinor: number, over: Record<string, unknown> = {}) => ({
    requestKey: nextForm(),
    typeId,
    startsOn: "2026-10-15",
    paid: true,
    method: "cash",
    priceMinor: 5000,
    totalMinor,
    ...over,
  });
  const give = (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) => post(heldUrl(gymId, entryId), body, cookies);
  const held = (res: { body: string }): HeldMembershipsResponse => heldMembershipsResponseSchema.parse(JSON.parse(res.body));

  const membershipIdOf = async (gymId: string, entryId: string) => {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId}`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const membershipCount = async (gymId: string) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE gym_id = ${gymId}`)[0]?.n;
  /** Each bill as [its day, what is paid, the joining fee in it, its status]. */
  const bills = async (gymId: string, membershipId: string) =>
    (
      await sql<{ due_on: string; amount_minor: number; joining_fee_minor: number; status: string }[]>`
        SELECT due_on::text AS due_on, amount_minor, joining_fee_minor, status
        FROM gym_member_bills WHERE gym_id = ${gymId} AND held_membership_id = ${membershipId} ORDER BY period_index`
    ).map((b) => [b.due_on, b.amount_minor, b.joining_fee_minor, b.status]);
  const paymentsOf = async (gymId: string) => (await sql<{ amount_minor: number }[]>`SELECT amount_minor FROM gym_member_payments WHERE gym_id = ${gymId} ORDER BY seq`).map((p) => p.amount_minor);
  const run = (gymId: string, iso: string) => openDueBills({ sql, log }, { now: new Date(iso), gymIds: [gymId] });
  const sellPage = (res: { body: string }): SellPageResponse => sellPageResponseSchema.parse(JSON.parse(res.body));

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
    "the joining fee is on the first bill alone, at the amount the desk was shown: never on a renewal, never on a period paid ahead, and nothing is given at a fee or total the screen did not show",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("worst-owner");
      const gymId = (await makeGym(owner, "Jfee Worst Gym")).org.id;
      const gold = await addType(gymId, owner.cookies, monthly({ joiningFeeMinor: 2500 }));

      // The Add form reads the fee with the type.
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      expect(held(await get(heldUrl(gymId, maya), owner.cookies)).types.find((t) => t.id === gold)?.joiningFeeMinor).toBe(2500);

      // A fee a cent either way, the fee with a total that leaves it out, a total with a fee
      // that is not sent: nothing is given, nothing is paid.
      for (const body of [
        giveBody(gold, 7499, { joiningFeeMinor: 2499 }),
        giveBody(gold, 7501, { joiningFeeMinor: 2501 }),
        giveBody(gold, 5000, { joiningFeeMinor: 2500 }),
        giveBody(gold, 7500),
      ]) {
        const res = await give(gymId, maya, owner.cookies, body);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("membership_price_changed");
      }
      // A fee with no price shown is refused before anything is read.
      expect((await give(gymId, maya, owner.cookies, { requestKey: nextForm(), typeId: gold, startsOn: "2026-10-15", paid: false, joiningFeeMinor: 2500 })).statusCode).toBe(400);
      expect(await membershipCount(gymId)).toBe(0);
      expect(await paymentsOf(gymId)).toEqual([]);

      // $50.00 and the $25.00 joining fee: one bill of $75.00, paid at once.
      const body = giveBody(gold, 7500, { joiningFeeMinor: 2500 });
      expect((await give(gymId, maya, owner.cookies, body)).statusCode).toBe(201);
      // The same press again gives nothing more.
      expect((await give(gymId, maya, owner.cookies, body)).statusCode).toBe(201);
      const mayaGold = await membershipIdOf(gymId, maya);

      // Paid ahead for November at the desk, then two runs of the hourly bill run.
      const before = held(await get(heldUrl(gymId, maya), owner.cookies));
      const pay = before.memberships[0]?.billing?.pay;
      if (pay === undefined || pay === null) throw new Error("nothing to pay ahead");
      expect(pay.periodIndex).toBe(1);
      const ahead = await post(`${heldUrl(gymId, maya)}/${mayaGold}/payments`, { requestKey: nextForm(), periodIndex: 1, amountMinor: 5000, method: "cash" }, owner.cookies);
      expect(ahead.statusCode, ahead.body).toBe(200);
      for (const iso of ["2026-11-15T17:00:00Z", "2026-12-15T17:00:00Z", "2027-01-15T17:00:00Z"]) expect((await run(gymId, iso)).failed).toBe(0);
      expect(await bills(gymId, mayaGold)).toEqual([
        ["2026-10-15", 7500, 2500, "paid"],
        ["2026-11-15", 5000, 0, "paid"],
        ["2026-12-15", 5000, 0, "open"],
        ["2027-01-15", 5000, 0, "open"],
      ]);
      expect(await paymentsOf(gymId)).toEqual([7500, 5000]);

      // Staff see it on the bill.
      clock = new Date("2027-01-15T18:00:00Z");
      const after = held(await get(heldUrl(gymId, maya), owner.cookies));
      expect(after.memberships[0]?.billing?.bills.map((b) => [b.amountMinor, b.joiningFeeMinor])).toEqual([
        [5000, 0],
        [5000, 0],
        [5000, 0],
        [7500, 2500],
      ]);

      // The owner raises the fee to $30.00: a screen opened before still shows $25.00, and is sent back.
      clock = new Date("2027-01-15T18:00:00Z");
      expect((await changeType(gymId, owner.cookies, gold, { joiningFeeMinor: 3000 })).statusCode).toBe(200);
      const noah = await addPerson(gymId, owner.cookies, "Noah Brown");
      const stale = await give(gymId, noah, owner.cookies, giveBody(gold, 7500, { startsOn: "2027-01-15", joiningFeeMinor: 2500 }));
      expect(stale.statusCode, stale.body).toBe(409);
      expect(await membershipCount(gymId)).toBe(1);
      expect((await give(gymId, noah, owner.cookies, giveBody(gold, 8000, { startsOn: "2027-01-15", joiningFeeMinor: 3000 }))).statusCode).toBe(201);
      expect(await bills(gymId, await membershipIdOf(gymId, noah))).toEqual([["2027-01-15", 8000, 3000, "paid"]]);
    },
    T,
  );

  it(
    "waiving the fee is for staff who take payments: the owner leaves it off; a member of staff without the payments tick cannot, and their screen is sent back",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("waive-owner");
      const desk = await makeUser("waive-desk");
      const org = await makeGym(owner, "Jfee Waive Gym");
      const gymId = org.org.id;
      await makeDeskStaff(org, owner, desk);
      const gold = await addType(gymId, owner.cookies, monthly({ joiningFeeMinor: 2500 }));

      // The owner waives it: $50.00, no fee.
      const liam = await addPerson(gymId, owner.cookies, "Liam Chen");
      expect((await give(gymId, liam, owner.cookies, giveBody(gold, 5000))).statusCode).toBe(201);
      expect(await bills(gymId, await membershipIdOf(gymId, liam))).toEqual([["2026-10-15", 5000, 0, "paid"]]);

      // The desk cannot leave it off; with it, the bill is opened unpaid for $75.00.
      const ava = await addPerson(gymId, owner.cookies, "Ava Jones");
      const waived = await give(gymId, ava, desk.cookies, { requestKey: nextForm(), typeId: gold, startsOn: "2026-10-15", paid: false, priceMinor: 5000 });
      expect(waived.statusCode, waived.body).toBe(409);
      expect(errorOf(waived)).toBe("membership_price_changed");
      expect(await sql`SELECT 1 FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${ava}`).toHaveLength(0);
      const charged = await give(gymId, ava, desk.cookies, { requestKey: nextForm(), typeId: gold, startsOn: "2026-10-15", paid: false, priceMinor: 5000, joiningFeeMinor: 2500 });
      expect(charged.statusCode, charged.body).toBe(201);
      expect(await bills(gymId, await membershipIdOf(gymId, ava))).toEqual([["2026-10-15", 7500, 2500, "open"]]);

      // A type with no fee is given by the desk as before.
      const silver = await addType(gymId, owner.cookies, monthly({ name: "Silver Monthly" }));
      const zoe = await addPerson(gymId, owner.cookies, "Zoe King");
      expect((await give(gymId, zoe, desk.cookies, { requestKey: nextForm(), typeId: silver, startsOn: "2026-10-15", paid: false, priceMinor: 5000 })).statusCode).toBe(201);
      expect(await bills(gymId, await membershipIdOf(gymId, zoe))).toEqual([["2026-10-15", 5000, 0, "open"]]);
    },
    T,
  );

  it(
    "with tax and a first-month discount: the tax is on the fee too, the discount comes off the membership alone, and the receipt prints the fee as its own line",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("tax-owner");
      const gymId = (await makeGym(owner, "Jfee Tax Gym")).org.id;
      const register = `/v1/orgs/${gymId}/register`;
      const rateRes = await post(`${register}/tax-rates`, { name: "GST", bp: 1800 }, owner.cookies);
      expect(rateRes.statusCode, rateRes.body).toBe(201);
      const gst = sellPage(rateRes).tax.rates.find((r) => r.name === "GST");
      if (gst === undefined) throw new Error("no rate");
      const gold = await addType(gymId, owner.cookies, monthly({ joiningFeeMinor: 2500, taxRateId: gst.id }));
      const discountRes = await post(
        `${register}/discounts`,
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
      const firstMonth = sellPage(discountRes).discounts[0];
      if (firstMonth === undefined) throw new Error("no discount");

      // ($50.00 − $10.00 + $25.00) plus 18% is $76.70. 20% off $75.00 would be $70.80: refused.
      const ruby = await addPerson(gymId, owner.cookies, "Ruby Green");
      const extra = { discountId: firstMonth.id, discountMinor: 1000, joiningFeeMinor: 2500 };
      expect((await give(gymId, ruby, owner.cookies, giveBody(gold, 7080, { ...extra, discountMinor: 1500 }))).statusCode).toBe(409);
      expect((await give(gymId, ruby, owner.cookies, giveBody(gold, 7670, extra))).statusCode).toBe(201);
      const rubyGold = await membershipIdOf(gymId, ruby);
      expect((await run(gymId, "2026-11-15T17:00:00Z")).failed).toBe(0);
      expect(await bills(gymId, rubyGold)).toEqual([
        ["2026-10-15", 7670, 2500, "paid"],
        ["2026-11-15", 5900, 0, "open"],
      ]);

      const [paid] = await sql<{ receipt_number: number }[]>`SELECT receipt_number FROM gym_member_payments WHERE gym_id = ${gymId}`;
      if (paid === undefined) throw new Error("no payment");
      const res = await get(`/v1/orgs/${gymId}/receipts/${String(paid.receipt_number)}`, owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const receipt = receiptSchema.parse(JSON.parse(res.body));
      expect(receipt).toMatchObject({
        kind: "payment",
        joiningFeeMinor: 2500,
        amounts: { listedMinor: 7500, discount: { name: "First month", minor: 1000 }, tax: { bp: 1800, minor: 1170, included: false }, totalMinor: 7670 },
        paidMinor: 7670,
      });
    },
    T,
  );

  it(
    "the price list keeps a fee only where a first bill can carry it, and a change must say it",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("list-owner");
      const gymId = (await makeGym(owner, "Jfee List Gym")).org.id;
      const pack = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 90 };
      const once = { kind: "one_time", termCount: 3, termUnit: "month" };
      const trial = { kind: "trial", termCount: 7, termUnit: "day", priceMinor: 0 };
      for (const [name, over] of [
        ["A pack", { ...pack, joiningFeeMinor: 1000 }],
        ["A trial", { ...trial, joiningFeeMinor: 1000 }],
        ["Free monthly", { priceMinor: 0, joiningFeeMinor: 1000 }],
        ["Too dear", { priceMinor: 99_999_000, joiningFeeMinor: 1000 }],
        ["Negative", { joiningFeeMinor: -1 }],
        ["Pennies", { joiningFeeMinor: 25.5 }],
      ] as const) {
        const res = await post(typesUrl(gymId), monthly({ name, ...over }), owner.cookies);
        expect(res.statusCode, `${name}: ${res.body}`).toBe(400);
      }
      expect((await priceList(gymId, owner.cookies)).types).toEqual([]);

      const quarter = await addType(gymId, owner.cookies, monthly({ name: "Three months", ...once, priceMinor: 12000, joiningFeeMinor: 2000 }));
      const plain = await addType(gymId, owner.cookies, monthly({ name: "No fee" }));
      const packId = await addType(gymId, owner.cookies, monthly({ name: "Ten classes", ...pack }));
      const list = await priceList(gymId, owner.cookies);
      expect(list.types.map((t) => [t.name, t.joiningFeeMinor])).toEqual([
        ["No fee", 0],
        ["Ten classes", 0],
        ["Three months", 2000],
      ]);

      // A change that leaves the fee out is refused, and the fee stays.
      const t = list.types.find((x) => x.id === quarter);
      if (t === undefined) throw new Error("no type");
      const { id: _id, currency: _currency, archivedAt: _archived, classTypes: _classes, joiningFeeMinor: _fee, ...fields } = t;
      expect((await put(`${typesUrl(gymId)}/${quarter}`, { ...fields, classTypeIds: null }, owner.cookies)).statusCode).toBe(400);
      expect(await feeOfType(quarter)).toBe(2000);
      // Taken off, put on another, and never on a pack.
      expect((await changeType(gymId, owner.cookies, quarter, { joiningFeeMinor: 0 })).statusCode).toBe(200);
      expect((await changeType(gymId, owner.cookies, plain, { joiningFeeMinor: 1500 })).statusCode).toBe(200);
      expect((await changeType(gymId, owner.cookies, packId, { joiningFeeMinor: 1500 })).statusCode).toBe(400);
      expect([await feeOfType(quarter), await feeOfType(plain), await feeOfType(packId)]).toEqual([0, 1500, 0]);
      // The database holds the same line, whoever writes.
      await expect(sql`UPDATE gym_membership_types SET joining_fee_minor = 100 WHERE id = ${packId}`).rejects.toThrow(/joining_fee_check/);
    },
    T,
  );

  it(
    "another gym's owner can neither read the fee nor give the type, and a bill's fee is never on a fee's bill",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("tenant-owner");
      const stranger = await makeUser("tenant-stranger");
      const gymId = (await makeGym(owner, "Jfee Tenant Gym")).org.id;
      const otherId = (await makeGym(stranger, "Jfee Next Door")).org.id;
      const gold = await addType(gymId, owner.cookies, monthly({ joiningFeeMinor: 2500 }));
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const theirs = await addPerson(otherId, stranger.cookies, "Their Member");

      expect((await get(typesUrl(gymId), stranger.cookies)).statusCode).toBe(404);
      expect((await get(heldUrl(gymId, maya), stranger.cookies)).statusCode).toBe(404);
      expect((await give(gymId, maya, stranger.cookies, giveBody(gold, 7500, { joiningFeeMinor: 2500 }))).statusCode).toBe(404);
      // Their own member, given our type: it is not on their price list.
      const cross = await give(otherId, theirs, stranger.cookies, giveBody(gold, 7500, { joiningFeeMinor: 2500 }));
      expect(cross.statusCode, cross.body).toBe(409);
      expect(errorOf(cross)).toBe("membership_type_not_found");
      expect(await membershipCount(gymId)).toBe(0);
      expect(await membershipCount(otherId)).toBe(0);
      expect((await changeType(gymId, owner.cookies, gold, { joiningFeeMinor: 9000 })).statusCode).toBe(200);
      const t = (await priceList(gymId, owner.cookies)).types.find((x) => x.id === gold);
      if (t === undefined) throw new Error("no type");
      const { id: _id, currency: _currency, archivedAt: _archived, classTypes: _classes, ...fields } = t;
      expect((await put(`${typesUrl(gymId)}/${gold}`, { ...fields, classTypeIds: null, joiningFeeMinor: 1 }, stranger.cookies)).statusCode).toBe(404);
      expect(await feeOfType(gold)).toBe(9000);

      // The bills' own line: a fee's bill (no period) carries no joining fee.
      expect((await give(gymId, maya, owner.cookies, giveBody(gold, 14000, { joiningFeeMinor: 9000, paid: false, method: undefined }))).statusCode).toBe(201);
      const mayaGold = await membershipIdOf(gymId, maya);
      await expect(
        sql`INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, fee, fee_for, covers_from, covers_to, joining_fee_minor)
            VALUES (${gymId}, ${mayaGold}, NULL, 500, 'USD', '2026-10-15', 'no_show', 'Spin', '2026-10-15', '2026-10-15', 100)`,
      ).rejects.toThrow(/joining_fee_check/);
      await expect(sql`UPDATE gym_member_bills SET joining_fee_minor = 14001 WHERE held_membership_id = ${mayaGold}`).rejects.toThrow(/joining_fee_check/);
    },
    T,
  );
});
