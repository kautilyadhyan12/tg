// TAX ON MEMBERSHIPS, through the real routes and the hourly bill run against real Postgres
// (spec Part 3 §14.3; ROADMAP 18b-iii). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: bill a member, month after month, an
// amount the screen did not show — tax on a membership the gym never taxed, tax missing from
// one it did, a first bill whose total is not the one the desk read out, or a change of
// type or rate that rewrites a bill already made. That is the first test: four months of
// bills to the cent for a taxed, an untaxed and a discounted member; a total the screen did
// not show refused; a rate changed and a type changed between months; a gym whose prices
// hold the tax; and next door's rate.
//
// Every refusal is checked by reading the tables, not the reply.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { heldMembershipsResponseSchema, sellPageResponseSchema, type GymMembershipTypesResponse, type GymTaxRate, type HeldMembershipsResponse, type SellPageResponse } from "@app/shared";
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
  JWT_SECRET: "membership-tax-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_membership_tax_routes";
const log = { info: () => undefined, error: () => undefined };

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("tax on memberships (real Postgres)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mtx-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_tax_rates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mtx-t-%@example.com'`;
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
  const del = (path: string, cookies: Cookies = {}) => send("DELETE", path, cookies);
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const messageOf = (res: { body: string }) => (JSON.parse(res.body) as { message: string }).message;

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string): Promise<Person> => {
    const email = `mtx-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Mtx ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string, country = "US"): Promise<string> => {
    const timezone = country === "GB" ? "Europe/London" : "America/Chicago";
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Austin", country, timezone }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `mtx-p-${String(++formCounter)}@example.com` }, cookies);
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
  /** Change one type's tax, every other field as it is. */
  const setTypeTax = async (gymId: string, cookies: Cookies, typeId: string, taxRateId: string | null) => {
    const list = JSON.parse((await get(typesUrl(gymId), cookies)).body) as GymMembershipTypesResponse;
    const t = list.types.find((x) => x.id === typeId);
    if (t === undefined) throw new Error("no such type");
    const body = {
      name: t.name,
      description: t.description,
      kind: t.kind,
      priceMinor: t.priceMinor,
      termCount: t.termCount,
      termUnit: t.termUnit,
      packClasses: t.packClasses,
      packDays: t.packDays,
      access: t.access,
      bookingsLimit: t.bookingsLimit,
      bookingsPeriod: t.bookingsPeriod,
      classTypeIds: null,
      includesPt: t.includesPt,
      ptLimit: t.ptLimit,
      ptPeriod: t.ptPeriod,
      taxRateId,
      updatedAt: t.updatedAt,
    };
    return await put(`${typesUrl(gymId)}/${typeId}`, body, cookies);
  };
  const register = (gymId: string) => `/v1/orgs/${gymId}/register`;
  const page = (res: { body: string }): SellPageResponse => sellPageResponseSchema.parse(JSON.parse(res.body));
  const addRate = async (gymId: string, cookies: Cookies, name: string, bp: number): Promise<GymTaxRate> => {
    const res = await post(`${register(gymId)}/tax-rates`, { name, bp }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).tax.rates.find((r) => r.name === name);
    if (found === undefined) throw new Error(`no rate named ${name}`);
    return found;
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  /** A membership given today, paid in cash, at the price and first total the screen showed. */
  const giveBody = (typeId: string, priceMinor: number, totalMinor: number, over: Record<string, unknown> = {}) => ({
    requestKey: nextForm(),
    typeId,
    startsOn: "2026-10-15",
    paid: true,
    method: "cash",
    priceMinor,
    totalMinor,
    ...over,
  });
  const give = (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) => post(heldUrl(gymId, entryId), body, cookies);
  const held = (res: { body: string }): HeldMembershipsResponse => heldMembershipsResponseSchema.parse(JSON.parse(res.body));

  /** What is in the tables, read directly. */
  const membershipOf = async (gymId: string, entryId: string) => {
    const [row] = await sql<{ id: string; price_minor: number; tax_rate_id: string | null }[]>`
      SELECT id, price_minor, tax_rate_id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at, id`;
    if (row === undefined) throw new Error("no membership");
    return row;
  };
  const membershipCount = async (gymId: string) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE gym_id = ${gymId}`)[0]?.n;
  const billsOf = (gymId: string, membershipId: string) => sql<
    { period_index: number; amount_minor: number; tax_minor: number; tax_bp: number; tax_name: string | null; tax_included: boolean | null; due_on: string }[]
  >`
    SELECT period_index, amount_minor, tax_minor, tax_bp, tax_name, tax_included, due_on::text AS due_on
    FROM gym_member_bills WHERE gym_id = ${gymId} AND held_membership_id = ${membershipId} ORDER BY period_index`;
  /** Each bill as [its day, what is paid, its tax, the tax's name]. */
  const bills = async (gymId: string, membershipId: string) => (await billsOf(gymId, membershipId)).map((b) => [b.due_on, b.amount_minor, b.tax_minor, b.tax_name]);
  const paymentsOf = (gymId: string) => sql<{ amount_minor: number }[]>`SELECT amount_minor FROM gym_member_payments WHERE gym_id = ${gymId} ORDER BY seq`;
  const run = (gymId: string, iso: string) => openDueBills({ sql, log }, { now: new Date(iso), gymIds: [gymId] });

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
    "a member is billed, month after month, the total the screen showed: tax only where the gym ticked it, the rate a membership was sold with, a new rate from the day it is set, and no bill already made moved",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("worst-owner");
      const gymId = await makeGym(owner, "Mtx Worst Gym");
      const gst = await addRate(gymId, owner.cookies, "GST", 1800);
      const gold = await addType(gymId, owner.cookies, monthly({ taxRateId: gst.id }));
      const silver = await addType(gymId, owner.cookies, monthly({ name: "Silver Monthly" }));

      // The Add form reads what each type charges, and that this gym adds the tax on top.
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const before = held(await get(heldUrl(gymId, maya), owner.cookies));
      expect(before.taxIncluded).toBe(false);
      expect(before.types.find((t) => t.id === gold)?.tax).toEqual({ name: "GST", bp: 1800 });
      expect(before.types.find((t) => t.id === silver)?.tax).toBeNull();

      // $50.00 plus 18% is $59.00. A screen that showed the price without its tax, a cent
      // either way, or the tax on an untaxed type: nothing is given, nothing is paid.
      for (const [typeId, total] of [
        [gold, 5000],
        [gold, 5899],
        [gold, 5901],
        [silver, 5900],
      ] as const) {
        const res = await give(gymId, maya, owner.cookies, giveBody(typeId, 5000, total));
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("membership_price_changed");
      }
      expect(await membershipCount(gymId)).toBe(0);
      expect(await paymentsOf(gymId)).toEqual([]);

      expect((await give(gymId, maya, owner.cookies, giveBody(gold, 5000, 5900))).statusCode).toBe(201);
      const mayaGold = await membershipOf(gymId, maya);
      expect(mayaGold).toMatchObject({ price_minor: 5000, tax_rate_id: gst.id });

      // Untaxed beside her: $50.00 and no tax at all.
      const noah = await addPerson(gymId, owner.cookies, "Noah Brown");
      expect((await give(gymId, noah, owner.cookies, giveBody(silver, 5000, 5000))).statusCode).toBe(201);
      const noahSilver = await membershipOf(gymId, noah);
      expect(noahSilver.tax_rate_id).toBeNull();

      // 20% off the first payment: $40.00 plus $7.20 is $47.20; every later one $59.00.
      const firstMonth = page(
        await post(
          `${register(gymId)}/discounts`,
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
        ),
      ).discounts[0];
      if (firstMonth === undefined) throw new Error("no discount");
      const liam = await addPerson(gymId, owner.cookies, "Liam Chen");
      expect((await give(gymId, liam, owner.cookies, giveBody(gold, 5000, 5900, { discountId: firstMonth.id, discountMinor: 1000 }))).statusCode).toBe(409);
      expect((await give(gymId, liam, owner.cookies, giveBody(gold, 5000, 4720, { discountId: firstMonth.id, discountMinor: 1000 }))).statusCode).toBe(201);
      const liamGold = await membershipOf(gymId, liam);
      expect(await paymentsOf(gymId)).toEqual([{ amount_minor: 5900 }, { amount_minor: 5000 }, { amount_minor: 4720 }]);

      // The types change after: Gold no longer taxed, Silver taxed. Nobody who already holds
      // one is moved; a member given Gold now pays no tax.
      expect((await setTypeTax(gymId, owner.cookies, gold, null)).statusCode).toBe(200);
      expect((await setTypeTax(gymId, owner.cookies, silver, gst.id)).statusCode).toBe(200);
      const ava = await addPerson(gymId, owner.cookies, "Ava Jones");
      expect((await give(gymId, ava, owner.cookies, giveBody(gold, 5000, 5900))).statusCode).toBe(409);
      expect((await give(gymId, ava, owner.cookies, giveBody(gold, 5000, 5000))).statusCode).toBe(201);
      const avaGold = await membershipOf(gymId, ava);
      expect(avaGold.tax_rate_id).toBeNull();

      // Two months of the hourly run, then the law changes GST to 12%, then two more.
      for (const iso of ["2026-11-15T17:00:00Z", "2026-12-15T17:00:00Z"]) expect((await run(gymId, iso)).failed).toBe(0);
      expect((await put(`${register(gymId)}/tax-rates/${gst.id}`, { name: "GST", bp: 1200 }, owner.cookies)).statusCode).toBe(200);
      for (const iso of ["2027-01-15T17:00:00Z", "2027-02-15T17:00:00Z"]) expect((await run(gymId, iso)).failed).toBe(0);

      expect(await bills(gymId, mayaGold.id)).toEqual([
        ["2026-10-15", 5900, 900, "GST"],
        ["2026-11-15", 5900, 900, "GST"],
        ["2026-12-15", 5900, 900, "GST"],
        ["2027-01-15", 5600, 600, "GST"],
        ["2027-02-15", 5600, 600, "GST"],
      ]);
      expect(await bills(gymId, noahSilver.id)).toEqual([
        ["2026-10-15", 5000, 0, null],
        ["2026-11-15", 5000, 0, null],
        ["2026-12-15", 5000, 0, null],
        ["2027-01-15", 5000, 0, null],
        ["2027-02-15", 5000, 0, null],
      ]);
      expect(await bills(gymId, liamGold.id)).toEqual([
        ["2026-10-15", 4720, 720, "GST"],
        ["2026-11-15", 5900, 900, "GST"],
        ["2026-12-15", 5900, 900, "GST"],
        ["2027-01-15", 5600, 600, "GST"],
        ["2027-02-15", 5600, 600, "GST"],
      ]);
      expect(await bills(gymId, avaGold.id)).toEqual([
        ["2026-10-15", 5000, 0, null],
        ["2026-11-15", 5000, 0, null],
        ["2026-12-15", 5000, 0, null],
        ["2027-01-15", 5000, 0, null],
        ["2027-02-15", 5000, 0, null],
      ]);
      // Every taxed bill says the rate it was opened at, and that the tax was on top.
      expect((await billsOf(gymId, mayaGold.id)).map((b) => [b.tax_bp, b.tax_included])).toEqual([
        [1800, false],
        [1800, false],
        [1800, false],
        [1200, false],
        [1200, false],
      ]);

      // A person's page says the same: each bill's amount and its tax, and what is left to pay.
      clock = new Date("2027-02-15T17:00:00Z");
      const page2 = held(await get(heldUrl(gymId, maya), owner.cookies));
      const shown = page2.memberships.find((m) => m.id === mayaGold.id);
      expect(shown?.tax).toEqual({ name: "GST", bp: 1200 });
      expect(shown?.billing?.bills.find((b) => b.periodIndex === 0)).toMatchObject({ amountMinor: 5900, tax: { name: "GST", bp: 1800, included: false, minor: 900 } });
      expect(shown?.billing?.pay).toMatchObject({ periodIndex: 1, leftMinor: 5900 });
    },
    T,
  );

  it(
    "where the gym's prices hold the tax a bill is the price and says how much of it is tax; a bill paid before it is opened is opened with its tax",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("vat-owner");
      const gymId = await makeGym(owner, "Mtx VAT Gym", "GB");
      const vat = await addRate(gymId, owner.cookies, "VAT", 2000);
      expect(page(await get(register(gymId), owner.cookies)).tax.included).toBe(true);
      const gold = await addType(gymId, owner.cookies, monthly({ taxRateId: vat.id }));
      const zoe = await addPerson(gymId, owner.cookies, "Zoe Smith");
      // £50.00 with VAT in it: £50.00 to pay, £8.33 of it VAT.
      expect((await give(gymId, zoe, owner.cookies, giveBody(gold, 5000, 6000))).statusCode).toBe(409);
      expect((await give(gymId, zoe, owner.cookies, giveBody(gold, 5000, 5000))).statusCode).toBe(201);
      const zoeGold = await membershipOf(gymId, zoe);
      expect(await bills(gymId, zoeGold.id)).toEqual([["2026-10-15", 5000, 833, "VAT"]]);

      // November paid early, before the hourly run has opened its bill: it is opened with
      // its VAT, as the run would open it.
      const pay = held(await get(heldUrl(gymId, zoe), owner.cookies)).memberships[0]?.billing?.pay;
      expect(pay).toMatchObject({ periodIndex: 1, leftMinor: 5000 });
      const paid = await post(`${heldUrl(gymId, zoe)}/${zoeGold.id}/payments`, { requestKey: nextForm(), periodIndex: 1, amountMinor: 5000, method: "cash" }, owner.cookies);
      expect(paid.statusCode, paid.body).toBe(200);
      expect((await bills(gymId, zoeGold.id))[1]).toEqual(["2026-11-15", 5000, 833, "VAT"]);

      // The gym changes to tax on top (round one, H2): Zoe keeps the total she was sold,
      // £50.00 with VAT in it, month after month; a member who joins after pays £60.00.
      expect((await put(`${register(gymId)}/tax`, { included: false }, owner.cookies)).statusCode).toBe(200);
      const ian = await addPerson(gymId, owner.cookies, "Ian Ward");
      expect((await give(gymId, ian, owner.cookies, giveBody(gold, 5000, 5000))).statusCode).toBe(409);
      expect((await give(gymId, ian, owner.cookies, giveBody(gold, 5000, 6000))).statusCode).toBe(201);
      const ianGold = await membershipOf(gymId, ian);
      expect((await run(gymId, "2026-12-15T17:00:00Z")).failed).toBe(0);
      expect(await bills(gymId, zoeGold.id)).toEqual([
        ["2026-10-15", 5000, 833, "VAT"],
        ["2026-11-15", 5000, 833, "VAT"],
        ["2026-12-15", 5000, 833, "VAT"],
      ]);
      // (November, which the run never reached for him, is not billed: the app's rule for a
      // month nobody was asked for.)
      expect(await bills(gymId, ianGold.id)).toEqual([
        ["2026-10-15", 6000, 1000, "VAT"],
        ["2026-12-15", 6000, 1000, "VAT"],
      ]);
    },
    T,
  );

  it(
    "tax on top: a period paid before its bill is opened is asked at its total, tax in, and opened with its tax",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("early-owner");
      const gymId = await makeGym(owner, "Mtx Early Gym");
      const gst = await addRate(gymId, owner.cookies, "GST", 1800);
      const gold = await addType(gymId, owner.cookies, monthly({ taxRateId: gst.id }));
      const zoe = await addPerson(gymId, owner.cookies, "Zoe Smith");
      expect((await give(gymId, zoe, owner.cookies, giveBody(gold, 5000, 5900))).statusCode).toBe(201);
      const zoeGold = await membershipOf(gymId, zoe);
      // November, before the hourly run has opened its bill: $59.00 is asked, never $50.00.
      const pay = held(await get(heldUrl(gymId, zoe), owner.cookies)).memberships[0]?.billing?.pay;
      expect(pay).toMatchObject({ periodIndex: 1, leftMinor: 5900 });
      const tooMuch = await post(`${heldUrl(gymId, zoe)}/${zoeGold.id}/payments`, { requestKey: nextForm(), periodIndex: 1, amountMinor: 5901, method: "cash" }, owner.cookies);
      expect(tooMuch.statusCode).toBe(409);
      const paid = await post(`${heldUrl(gymId, zoe)}/${zoeGold.id}/payments`, { requestKey: nextForm(), periodIndex: 1, amountMinor: 5900, method: "cash" }, owner.cookies);
      expect(paid.statusCode, paid.body).toBe(200);
      expect(await bills(gymId, zoeGold.id)).toEqual([
        ["2026-10-15", 5900, 900, "GST"],
        ["2026-11-15", 5900, 900, "GST"],
      ]);
    },
    T,
  );

  it(
    "a rate counts only memberships that will be billed again: not one the clock has ended, nor a past member's; a free type charges no tax",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("count-owner");
      const gymId = await makeGym(owner, "Mtx Count Gym");
      const gst = await addRate(gymId, owner.cookies, "GST", 1800);
      const month = await addType(gymId, owner.cookies, monthly({ name: "One month", kind: "one_time", taxRateId: gst.id }));
      const gold = await addType(gymId, owner.cookies, monthly({ name: "Gold Monthly", taxRateId: gst.id }));
      // A free type cannot charge a rate, given or ticked.
      expect((await post(typesUrl(gymId), monthly({ name: "Free week", kind: "trial", termCount: 7, termUnit: "day", priceMinor: 0, taxRateId: gst.id }), owner.cookies)).statusCode).toBe(400);
      const free = await addType(gymId, owner.cookies, monthly({ name: "Free week", kind: "trial", termCount: 7, termUnit: "day", priceMinor: 0 }));
      const freeRes = await put(`${register(gymId)}/tax-rates/${gst.id}/charged-on`, { use: "memberships", ids: [month, gold, free] }, owner.cookies);
      expect(freeRes.statusCode).toBe(409);
      expect(messageOf(freeRes)).toBe("Free week is free, so it charges no tax. Untick it and save again.");
      // Ola: one month, over by the clock and never touched since. Bea: Gold, then taken
      // off the list. Dan: Gold, a current member.
      const ola = await addPerson(gymId, owner.cookies, "Ola Bello");
      const bea = await addPerson(gymId, owner.cookies, "Bea Kane");
      const dan = await addPerson(gymId, owner.cookies, "Dan Ross");
      expect((await give(gymId, ola, owner.cookies, giveBody(month, 5000, 5900))).statusCode).toBe(201);
      expect((await give(gymId, bea, owner.cookies, giveBody(gold, 5000, 5900))).statusCode).toBe(201);
      expect((await give(gymId, dan, owner.cookies, giveBody(gold, 5000, 5900))).statusCode).toBe(201);
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gymId} AND id = ${bea}`;
      const rateRow = async () => page(await get(register(gymId), owner.cookies)).tax.rates.find((r) => r.id === gst.id);
      expect((await rateRow())?.memberships).toBe(2);
      clock = new Date("2026-12-01T17:00:00Z");
      // The stored status of Ola's still says active: the count asks the rule.
      expect((await sql<{ status: string }[]>`SELECT status FROM gym_held_memberships WHERE entry_id = ${ola}`)[0]?.status).toBe("active");
      expect((await rateRow())?.memberships).toBe(1);
      // Both types moved off GST; Dan's Gold still charges it, so it stays, and says Dan's one.
      expect((await put(`${register(gymId)}/tax-rates/${gst.id}/charged-on`, { use: "memberships", ids: [] }, owner.cookies)).statusCode).toBe(200);
      const refused = await del(`${register(gymId)}/tax-rates/${gst.id}`, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect(messageOf(refused)).toBe(
        "GST was not removed: it is charged on 1 member's membership. A membership keeps the tax it was sold with, so GST can be removed once nobody holds one. You can still change its name or rate.",
      );
      // Dan leaves too: nobody is billed it again, and it is removed.
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gymId} AND id = ${dan}`;
      expect((await del(`${register(gymId)}/tax-rates/${gst.id}`, owner.cookies)).statusCode).toBe(200);
    },
    T,
  );

  it(
    "a list word linked to a taxed type gives each person that type's rate, and how the gym charges it",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("word-owner");
      const gymId = await makeGym(owner, "Mtx Word Gym");
      const gst = await addRate(gymId, owner.cookies, "GST", 1800);
      const gold = await addType(gymId, owner.cookies, monthly({ taxRateId: gst.id }));
      const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: "Pat Quinn", email: "mtx-p-word@example.com", membershipType: "Gold" }, owner.cookies);
      expect(res.statusCode, res.body).toBe(201);
      const words = `/v1/orgs/${gymId}/membership-words`;
      const preview = await post(`${words}/preview`, { word: "Gold", typeId: gold }, owner.cookies);
      expect(preview.statusCode, preview.body).toBe(200);
      const { digest } = JSON.parse(preview.body) as { digest: string };
      const linked = await post(`${words}/link`, { word: "Gold", typeId: gold, groups: { settled: true, due: true, ask: true }, digest, paid: true }, owner.cookies);
      expect(linked.statusCode, linked.body).toBe(200);
      expect(await sql<{ tax_rate_id: string | null; tax_included: boolean | null }[]>`SELECT tax_rate_id, tax_included FROM gym_held_memberships WHERE gym_id = ${gymId}`).toEqual([
        { tax_rate_id: gst.id, tax_included: false },
      ]);
    },
    T,
  );

  it(
    "migration 0109 moves a gym's one rate into a rate named Tax, charged on the products that charged it; a gym at 0 gets none",
    async () => {
      // The two data statements of the migration, as written, run against temporary tables
      // of the shape they read (a temporary table hides the real one of its name), then dropped.
      const text = readFileSync(new URL("../drizzle/0109_tax_rates.sql", import.meta.url), "utf8");
      const statements = text.split("--> statement-breakpoint").map((s) => s.replace(/^\s*--.*$/gm, "").trim());
      const insert = statements.find((s) => s.startsWith('INSERT INTO "gym_tax_rates"'));
      const update = statements.find((s) => s.startsWith('UPDATE "gym_products"'));
      if (insert === undefined || update === undefined) throw new Error("the migration's data statements were not found");
      const got = await sql.begin(async (tx) => {
        await tx`CREATE TEMP TABLE gyms (id uuid PRIMARY KEY, sales_tax_bp integer NOT NULL) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_tax_rates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), gym_id uuid NOT NULL, name text NOT NULL, rate_bp integer NOT NULL) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_products (id uuid PRIMARY KEY, gym_id uuid NOT NULL, taxed boolean NOT NULL, tax_rate_id uuid) ON COMMIT DROP`;
        const [a, b] = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000b1"];
        await tx`INSERT INTO gyms (id, sales_tax_bp) VALUES (${a}, 825), (${b}, 0)`;
        await tx`INSERT INTO gym_products (id, gym_id, taxed) VALUES
          ('00000000-0000-4000-8000-0000000000a2', ${a}, true), ('00000000-0000-4000-8000-0000000000a3', ${a}, false),
          ('00000000-0000-4000-8000-0000000000b2', ${b}, true)`;
        await tx.unsafe(insert);
        await tx.unsafe(update);
        const rates = await tx<{ gym_id: string; name: string; rate_bp: number }[]>`SELECT gym_id, name, rate_bp FROM gym_tax_rates ORDER BY gym_id`;
        const products = await tx<{ id: string; rate: string | null }[]>`
          SELECT p.id, r.name AS rate FROM gym_products p LEFT JOIN gym_tax_rates r ON r.id = p.tax_rate_id ORDER BY p.id`;
        return { rates, products };
      });
      expect(got.rates).toEqual([{ gym_id: "00000000-0000-4000-8000-0000000000a1", name: "Tax", rate_bp: 825 }]);
      expect(got.products).toEqual([
        { id: "00000000-0000-4000-8000-0000000000a2", rate: "Tax" },
        { id: "00000000-0000-4000-8000-0000000000a3", rate: null },
        { id: "00000000-0000-4000-8000-0000000000b2", rate: null },
      ]);
    },
    T,
  );

  it(
    "what charges a rate is set in one press: ticked types and products charge it, unticked ones charge none, memberships already held keep theirs, and only this gym's own things are taken",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("charge-owner");
      const desk = await makeUser("charge-desk");
      const nextDoor = await makeUser("charge-nextdoor");
      const gymId = await makeGym(owner, "Mtx Charge Gym");
      const otherGym = await makeGym(nextDoor, "Mtx Charge Next Door");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${desk.userId}, 'manager', ${["billing.members", "members.read", "members.confirm"]})`;
      const gst = await addRate(gymId, owner.cookies, "GST", 1800);
      const vat = await addRate(gymId, owner.cookies, "VAT", 2000);
      const gold = await addType(gymId, owner.cookies, monthly());
      const silver = await addType(gymId, owner.cookies, monthly({ name: "Silver Monthly", taxRateId: vat.id }));
      const bronze = await addType(gymId, owner.cookies, monthly({ name: "Bronze Monthly", taxRateId: gst.id }));
      const theirs = await addType(otherGym, nextDoor.cookies, monthly({ name: "Their Gold" }));
      // Maya holds Bronze at GST before the change.
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      expect((await give(gymId, maya, owner.cookies, giveBody(bronze, 5000, 5900))).statusCode).toBe(201);
      const charge = (gym: string, rateId: string, body: unknown, cookies: Cookies) => put(`${register(gym)}/tax-rates/${rateId}/charged-on`, body, cookies);
      const typesNow = async () =>
        (await sql<{ name: string; rate: string | null }[]>`
          SELECT t.name, r.name AS rate FROM gym_membership_types t LEFT JOIN gym_tax_rates r ON r.id = t.tax_rate_id
          WHERE t.gym_id = ${gymId} ORDER BY t.name`).map((r) => `${r.name}: ${r.rate ?? "none"}`);
      const before = await typesNow();

      // Refused, with nothing changed: next door's type on the list, next door asking, staff
      // who may not change prices, nobody signed in, a list that is not a list.
      for (const [res, status] of [
        [await charge(gymId, gst.id, { use: "memberships", ids: [gold, theirs] }, owner.cookies), 409],
        [await charge(gymId, gst.id, { use: "memberships", ids: [gold] }, nextDoor.cookies), 404],
        [await charge(otherGym, gst.id, { use: "memberships", ids: [theirs] }, nextDoor.cookies), 404],
        [await charge(gymId, gst.id, { use: "memberships", ids: [gold] }, desk.cookies), 403],
        [await charge(gymId, gst.id, { use: "memberships", ids: [gold] }, {}), 401],
        [await charge(gymId, gst.id, { use: "everything", ids: [gold] }, owner.cookies), 400],
        [await charge(gymId, gst.id, { use: "memberships", ids: ["gold"] }, owner.cookies), 400],
      ] as const) {
        expect(res.statusCode, res.body).toBe(status);
      }
      expect(await typesNow()).toEqual(before);

      // Gold and Silver ticked for GST, Bronze not: Gold charges GST, Silver moves from VAT
      // to GST, Bronze charges none. Maya's Bronze keeps GST, as she was sold it.
      const res = await charge(gymId, gst.id, { use: "memberships", ids: [gold, silver] }, owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      expect(await typesNow()).toEqual(["Bronze Monthly: none", "Gold Monthly: GST", "Silver Monthly: GST"]);
      expect((await membershipOf(gymId, maya)).tax_rate_id).toBe(gst.id);
      expect(page(res).membershipTypes.find((t) => t.id === gold)?.taxRateId).toBe(gst.id);
      // A new member on Gold now pays the tax.
      const liam = await addPerson(gymId, owner.cookies, "Liam Chen");
      expect((await give(gymId, liam, owner.cookies, giveBody(gold, 5000, 5900))).statusCode).toBe(201);

      // Products the same way; and a membership type priced too high to tax is refused by name.
      const water = page(await post(`${register(gymId)}/products`, { name: "Water", priceMinor: 2000, taxRateId: null, stock: null }, owner.cookies)).products[0];
      if (water === undefined) throw new Error("no product");
      expect((await charge(gymId, vat.id, { use: "products", ids: [water.id] }, owner.cookies)).statusCode).toBe(200);
      expect((await sql<{ tax_rate_id: string | null }[]>`SELECT tax_rate_id FROM gym_products WHERE id = ${water.id}`)[0]?.tax_rate_id).toBe(vat.id);
      const dear = await addType(gymId, owner.cookies, monthly({ name: "Lifetime", kind: "one_time", termUnit: "year", termCount: 99, priceMinor: 80_000_000 }));
      const tooHigh = await charge(gymId, gst.id, { use: "memberships", ids: [gold, dear] }, owner.cookies);
      expect(tooHigh.statusCode).toBe(409);
      expect(messageOf(tooHigh)).toBe("Lifetime: This price is too high to charge tax on. Lower the price, or choose No tax.");
      expect(await typesNow()).toEqual(["Bronze Monthly: none", "Gold Monthly: GST", "Lifetime: none", "Silver Monthly: GST"]);
    },
    T,
  );

  it(
    "a rate is this gym's alone: next door's cannot be charged, read, changed or removed, staff who may not change prices are refused, and a rate in use is not removed",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("own-owner");
      const desk = await makeUser("own-desk");
      const nextDoor = await makeUser("own-nextdoor");
      const gymId = await makeGym(owner, "Mtx Own Gym");
      const otherGym = await makeGym(nextDoor, "Mtx Next Door");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${desk.userId}, 'manager', ${["billing.members", "members.read", "members.confirm"]})`;
      const gst = await addRate(gymId, owner.cookies, "GST", 1800);
      const theirs = await addRate(otherGym, nextDoor.cookies, "Their tax", 2500);

      // Next door's rate on this gym's type, product or new type: refused, nothing saved.
      const gold = await addType(gymId, owner.cookies, monthly());
      const onType = await setTypeTax(gymId, owner.cookies, gold, theirs.id);
      expect(onType.statusCode, onType.body).toBe(409);
      expect(errorOf(onType)).toBe("tax_rate_not_found");
      const newType = await post(typesUrl(gymId), monthly({ name: "Theirs", taxRateId: theirs.id }), owner.cookies);
      expect(newType.statusCode).toBe(409);
      const product = await post(`${register(gymId)}/products`, { name: "Water", priceMinor: 200, taxRateId: theirs.id, stock: null }, owner.cookies);
      expect(product.statusCode).toBe(409);
      expect(errorOf(product)).toBe("tax_rate_not_found");
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_membership_types WHERE gym_id = ${gymId} AND tax_rate_id IS NOT NULL`)[0]?.n).toBe(0);
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_products WHERE gym_id = ${gymId}`)[0]?.n).toBe(0);

      // Next door cannot change or remove this gym's rate, through either gym's address.
      expect((await put(`${register(gymId)}/tax-rates/${gst.id}`, { name: "Mine", bp: 100 }, nextDoor.cookies)).statusCode).toBe(404);
      expect((await del(`${register(gymId)}/tax-rates/${gst.id}`, nextDoor.cookies)).statusCode).toBe(404);
      expect((await put(`${register(otherGym)}/tax-rates/${gst.id}`, { name: "Mine", bp: 100 }, nextDoor.cookies)).statusCode).toBe(404);
      expect((await del(`${register(otherGym)}/tax-rates/${gst.id}`, nextDoor.cookies)).statusCode).toBe(404);
      expect(page(await get(register(otherGym), nextDoor.cookies)).tax.rates.map((r) => r.name)).toEqual(["Their tax"]);
      // Staff who take payments but may not change prices: no rate added, changed or removed.
      expect((await post(`${register(gymId)}/tax-rates`, { name: "VAT", bp: 2000 }, desk.cookies)).statusCode).toBe(403);
      expect((await put(`${register(gymId)}/tax-rates/${gst.id}`, { name: "GST", bp: 100 }, desk.cookies)).statusCode).toBe(403);
      expect((await del(`${register(gymId)}/tax-rates/${gst.id}`, desk.cookies)).statusCode).toBe(403);
      expect((await put(`${register(gymId)}/tax`, { included: true }, desk.cookies)).statusCode).toBe(403);
      expect((await sql<{ name: string; rate_bp: number }[]>`SELECT name, rate_bp FROM gym_tax_rates WHERE gym_id = ${gymId}`)).toEqual([{ name: "GST", rate_bp: 1800 }]);

      // A form that is wrong: no name, 0%, over 30%, a fraction of a hundredth.
      for (const bad of [{ name: "", bp: 1800 }, { name: "GST", bp: 0 }, { name: "GST", bp: 3001 }, { name: "GST", bp: 18.5 }, { name: "GST" }]) {
        expect((await post(`${register(gymId)}/tax-rates`, bad, owner.cookies)).statusCode).toBe(400);
      }
      expect((await post(`${register(gymId)}/tax-rates`, { name: " gst ", bp: 500 }, owner.cookies)).statusCode).toBe(409);

      // In use on a type and on a member's membership: not removed, and told why.
      expect((await setTypeTax(gymId, owner.cookies, gold, gst.id)).statusCode).toBe(200);
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      expect((await give(gymId, maya, owner.cookies, giveBody(gold, 5000, 5900))).statusCode).toBe(201);
      const inUse = await del(`${register(gymId)}/tax-rates/${gst.id}`, owner.cookies);
      expect(inUse.statusCode).toBe(409);
      expect(errorOf(inUse)).toBe("tax_rate_in_use");
      expect(messageOf(inUse)).toBe(
        "GST was not removed: it is charged on 1 membership type and 1 member's membership. Change them to another rate or No tax first. A membership keeps the tax it was sold with, so GST can be removed once nobody holds one. You can still change its name or rate.",
      );
      expect(page(await get(register(gymId), owner.cookies)).tax.rates[0]).toMatchObject({ name: "GST", products: 0, membershipTypes: 1, memberships: 1 });
      // One nothing charges: removed.
      const spare = await addRate(gymId, owner.cookies, "Spare", 500);
      expect((await del(`${register(gymId)}/tax-rates/${spare.id}`, owner.cookies)).statusCode).toBe(200);
      expect((await sql<{ name: string }[]>`SELECT name FROM gym_tax_rates WHERE gym_id = ${gymId}`).map((r) => r.name)).toEqual(["GST"]);
    },
    T,
  );
});
