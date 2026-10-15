// DISCOUNTS ON MEMBERSHIPS, through the real routes and the hourly bill run against real
// Postgres (spec Part 3 §14.3; ROADMAP 18b-ii-b). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: bill a member, month after month,
// a price the screen did not show — a "first month" discount that keeps coming off, an
// "every month" one that stops after the first, a discount used past its limit, or one
// gym's discount working at another. That is the first test: the bills of three months
// to the penny for each, a shown amount that is not the server's refused, one press sent
// six times, eight people at one instant for a limit of three, and next door's discount.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { DISCOUNT_WORDS, heldMembershipsResponseSchema, sellPageResponseSchema, type GymDiscount, type GymMembershipTypesResponse, type HeldMembershipsResponse } from "@app/shared";
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
  JWT_SECRET: "held-discount-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_held_discount_routes";
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
const dayPass = () => monthly({ name: "Day pass", kind: "pack", priceMinor: 1500, termCount: null, termUnit: null, packClasses: 1, packDays: 1 });

d("discounts on memberships (real Postgres)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'hmd-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_discounts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'hmd-t-%@example.com'`;
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
  const messageOf = (res: { body: string }) => (JSON.parse(res.body) as { message: string }).message;

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string): Promise<Person> => {
    const email = `hmd-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Hmd ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };
  const staffWith = async (gymId: string, who: Person, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${privileges})`;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `hmd-p-${String(++formCounter)}@example.com` }, cookies);
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

  /** A discount form for memberships alone, 20% off the first payment, unless it says otherwise. */
  const form = (name: string, over: Record<string, unknown> = {}) => ({
    name,
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
    ...over,
  });
  const register = (gymId: string) => `/v1/orgs/${gymId}/register`;
  const addDiscount = async (gymId: string, cookies: Cookies, name: string, over: Record<string, unknown> = {}): Promise<GymDiscount> => {
    const res = await post(`${register(gymId)}/discounts`, form(name, over), cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = sellPageResponseSchema.parse(JSON.parse(res.body)).discounts.find((x) => x.name === name);
    if (found === undefined) throw new Error(`no discount named ${name}`);
    return found;
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  /** A membership given today, paid in cash, at the price the screen showed. */
  const giveBody = (typeId: string, priceMinor: number, over: Record<string, unknown> = {}) => ({
    requestKey: nextForm(),
    typeId,
    startsOn: "2026-10-15",
    paid: true,
    method: "cash",
    priceMinor,
    ...over,
  });
  const give = (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) => post(heldUrl(gymId, entryId), body, cookies);
  const held = (res: { body: string }): HeldMembershipsResponse => heldMembershipsResponseSchema.parse(JSON.parse(res.body));

  /** What is in the tables, read directly. */
  const membershipsOf = (gymId: string) => sql<
    { id: string; entry_id: string; price_minor: number; discount_id: string | null; discount_name: string | null; discount_minor: number; discount_payments: string | null }[]
  >`
    SELECT id, entry_id, price_minor, discount_id, discount_name, discount_minor, discount_payments
    FROM gym_held_memberships WHERE gym_id = ${gymId} ORDER BY created_at, id`;
  const billsOf = (gymId: string, membershipId: string) => sql<{ period_index: number; amount_minor: number; due_on: string; status: string }[]>`
    SELECT period_index, amount_minor, due_on::text AS due_on, status
    FROM gym_member_bills WHERE gym_id = ${gymId} AND held_membership_id = ${membershipId} ORDER BY period_index`;
  const paymentsOf = (gymId: string) => sql<{ amount_minor: number }[]>`
    SELECT p.amount_minor FROM gym_member_payments p WHERE p.gym_id = ${gymId} ORDER BY p.seq`;
  const usesOf = async (discountId: string) => (await sql<{ uses: number }[]>`SELECT uses FROM gym_discounts WHERE id = ${discountId}`)[0]?.uses;
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
    "a first-payment discount comes off the first bill alone, an every-payment one off every bill, nothing is given at a price the screen did not show, and a limit of three is three",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("worst-owner");
      const desk = await makeUser("worst-desk");
      const nextDoor = await makeUser("worst-nextdoor");
      const gymId = await makeGym(owner, "Hmd Worst Gym");
      const otherGym = await makeGym(nextDoor, "Hmd Worst Next Door");
      await staffWith(gymId, desk, "manager", null);
      const gold = await addType(gymId, owner.cookies, monthly());
      const pass = await addType(gymId, owner.cookies, dayPass());
      const firstMonth = await addDiscount(gymId, owner.cookies, "First month", { code: "FIRST20" });
      const founders = await addDiscount(gymId, owner.cookies, "Founders", { kind: "amount", percentBp: null, amountMinor: 1000, membershipPayments: "every" });
      const firstThree = await addDiscount(gymId, owner.cookies, "First three", { percentBp: 1000, maxUses: 3, membershipPayments: "every" });
      const passOnly = await addDiscount(gymId, owner.cookies, "Pass only", { allMembershipTypes: false, membershipTypeIds: [pass] });
      const water = await addDiscount(gymId, owner.cookies, "Water only", { forProducts: true, forMemberships: false, membershipPayments: null });
      const theirs = await addDiscount(otherGym, nextDoor.cookies, "Their half off", { percentBp: 5000 });

      // 20% of 50.00 is 10.00: the first payment is 40.00 and every later one 50.00.
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const shown = giveBody(gold, 5000, { discountId: firstMonth.id, discountMinor: 1000 });
      // What comes off said wrongly either way, the price before it said wrongly, and the
      // discounted price sent as the price: none is what the server works out, none is given.
      for (const wrong of [
        { ...shown, requestKey: nextForm(), discountMinor: 999 },
        { ...shown, requestKey: nextForm(), discountMinor: 1001 },
        { ...shown, requestKey: nextForm(), priceMinor: 4000 },
        { ...shown, requestKey: nextForm(), priceMinor: 5001 },
      ]) {
        const res = await give(gymId, maya, owner.cookies, wrong);
        expect(res.statusCode, res.body).toBe(409);
        expect(["membership_discount_changed", "membership_price_changed"]).toContain(errorOf(res));
      }
      expect(await membershipsOf(gymId)).toEqual([]);
      expect(await paymentsOf(gymId)).toEqual([]);
      expect(await usesOf(firstMonth.id)).toBe(0);

      // The same press, six times at one instant from two people: one membership, one
      // payment of 40.00, one use.
      const six = await Promise.all([0, 1, 2, 3, 4, 5].map((n) => give(gymId, maya, n % 2 === 0 ? owner.cookies : desk.cookies, shown)));
      expect(six.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
      const [mayaGold] = await membershipsOf(gymId);
      expect(mayaGold).toMatchObject({ price_minor: 5000, discount_id: firstMonth.id, discount_name: "First month", discount_minor: 1000, discount_payments: "first" });
      expect(await paymentsOf(gymId)).toEqual([{ amount_minor: 4000 }]);
      expect(await usesOf(firstMonth.id)).toBe(1);

      // $10.00 off every payment: 40.00 kept as the price, and every bill 40.00.
      const liam = await addPerson(gymId, owner.cookies, "Liam Chen");
      const liamRes = await give(gymId, liam, desk.cookies, giveBody(gold, 5000, { discountId: founders.id, discountMinor: 1000 }));
      expect(liamRes.statusCode, liamRes.body).toBe(201);
      const liamGold = (await membershipsOf(gymId)).find((m) => m.entry_id === liam);
      expect(liamGold).toMatchObject({ price_minor: 4000, discount_minor: 1000, discount_payments: "every" });
      // And somebody with no discount at all, beside them.
      const noah = await addPerson(gymId, owner.cookies, "Noah Brown");
      expect((await give(gymId, noah, owner.cookies, giveBody(gold, 5000))).statusCode).toBe(201);
      const noahGold = (await membershipsOf(gymId)).find((m) => m.entry_id === noah);
      expect(noahGold).toMatchObject({ price_minor: 5000, discount_id: null, discount_minor: 0, discount_payments: null });

      // The discounts are changed after: 50% off the first, and $25.00 off every one.
      // Nobody's membership already given is touched by it.
      const changed = await put(`${register(gymId)}/discounts/${firstMonth.id}`, { ...form("First month", { code: "FIRST20", percentBp: 5000 }), updatedAt: firstMonth.updatedAt }, owner.cookies);
      expect(changed.statusCode, changed.body).toBe(200);
      const changedEvery = await put(
        `${register(gymId)}/discounts/${founders.id}`,
        { ...form("Founders", { kind: "amount", percentBp: null, amountMinor: 2500, membershipPayments: "first" }), updatedAt: founders.updatedAt },
        owner.cookies,
      );
      expect(changedEvery.statusCode, changedEvery.body).toBe(200);

      // Three months of the hourly run.
      for (const iso of ["2026-11-15T17:00:00Z", "2026-12-15T17:00:00Z", "2027-01-15T17:00:00Z"]) expect((await run(gymId, iso)).failed).toBe(0);
      if (mayaGold === undefined || liamGold === undefined || noahGold === undefined) throw new Error("a membership is missing");
      const amounts = async (id: string) => (await billsOf(gymId, id)).map((b) => [b.due_on, b.amount_minor]);
      expect(await amounts(mayaGold.id)).toEqual([
        ["2026-10-15", 4000],
        ["2026-11-15", 5000],
        ["2026-12-15", 5000],
        ["2027-01-15", 5000],
      ]);
      expect(await amounts(liamGold.id)).toEqual([
        ["2026-10-15", 4000],
        ["2026-11-15", 4000],
        ["2026-12-15", 4000],
        ["2027-01-15", 4000],
      ]);
      expect(await amounts(noahGold.id)).toEqual([
        ["2026-10-15", 5000],
        ["2026-11-15", 5000],
        ["2026-12-15", 5000],
        ["2027-01-15", 5000],
      ]);
      // A payment for Maya's second month is the full price, and no more.
      clock = new Date("2026-11-16T17:00:00Z");
      const payUrl = `${heldUrl(gymId, maya)}/${mayaGold.id}/payments`;
      const tooMuch = await post(payUrl, { requestKey: nextForm(), periodIndex: 1, amountMinor: 5001, method: "cash" }, owner.cookies);
      expect(tooMuch.statusCode, tooMuch.body).toBe(409);
      const second = await post(payUrl, { requestKey: nextForm(), periodIndex: 1, amountMinor: 5000, method: "cash" }, owner.cookies);
      expect(second.statusCode, second.body).toBe(200);

      // The person's page says what each was given with, as it was then.
      const page = held(await get(heldUrl(gymId, maya), owner.cookies));
      expect(page.memberships.find((m) => m.id === mayaGold.id)?.discount).toEqual({ name: "First month", offMinor: 1000, payments: "first" });
      expect(held(await get(heldUrl(gymId, liam), owner.cookies)).memberships[0]?.discount).toEqual({ name: "Founders", offMinor: 1000, payments: "every" });
      expect(held(await get(heldUrl(gymId, noah), owner.cookies)).memberships[0]?.discount).toBeNull();
      // It offers this gym's discounts for memberships, and no other.
      expect(page.discounts.map((x) => x.name).sort()).toEqual(["First month", "First three", "Founders", "Pass only"]);

      // Eight people at one instant for a discount that can be used three times: 10% of
      // 50.00 is 5.00, so 45.00 a month.
      clock = new Date("2026-11-16T17:00:00Z");
      const eight = await Promise.all(Array.from({ length: 8 }, (_, n) => addPerson(gymId, owner.cookies, `Person ${String(n)}`)));
      const tries = await Promise.all(
        eight.map((entryId, n) => give(gymId, entryId, n % 2 === 0 ? owner.cookies : desk.cookies, giveBody(gold, 5000, { startsOn: "2026-11-16", discountId: firstThree.id, discountMinor: 500 }))),
      );
      expect(tries.filter((r) => r.statusCode === 201)).toHaveLength(3);
      const refused = tries.filter((r) => r.statusCode === 409);
      expect(refused).toHaveLength(5);
      for (const res of refused) {
        expect(errorOf(res)).toBe("discount_used_up");
        expect(messageOf(res)).toBe("First three has reached its usage limit. Nothing was saved: pick another discount, or add the membership without one.");
      }
      expect(await usesOf(firstThree.id)).toBe(3);
      expect((await membershipsOf(gymId)).filter((m) => m.discount_id === firstThree.id).map((m) => m.price_minor)).toEqual([4500, 4500, 4500]);

      // A discount that is not for this membership, one for products alone, and next
      // door's: each refused, and nothing written or used.
      const before = (await membershipsOf(gymId)).length;
      const olivia = await addPerson(gymId, owner.cookies, "Olivia Garcia");
      for (const [discount, code] of [
        [passOnly, "discount_not_for_membership"],
        [water, "discount_not_for_membership"],
        [theirs, "discount_not_available"],
      ] as const) {
        const res = await give(gymId, olivia, owner.cookies, giveBody(gold, 5000, { startsOn: "2026-11-16", discountId: discount.id, discountMinor: discount.percentBp === 5000 ? 2500 : 1000 }));
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe(code);
      }
      expect(messageOf(await give(gymId, olivia, owner.cookies, giveBody(gold, 5000, { startsOn: "2026-11-16", discountId: theirs.id, discountMinor: 2500 })))).toBe(
        DISCOUNT_WORDS.membership_not_available,
      );
      expect(await membershipsOf(gymId)).toHaveLength(before);
      expect(await usesOf(theirs.id)).toBe(0);
      expect(await usesOf(passOnly.id)).toBe(0);
      expect(await usesOf(water.id)).toBe(0);
      // The day pass is what "Pass only" is for: 20% of 15.00 is 3.00.
      const passRes = await give(gymId, olivia, owner.cookies, giveBody(pass, 1500, { startsOn: "2026-11-16", discountId: passOnly.id, discountMinor: 300 }));
      expect(passRes.statusCode, passRes.body).toBe(201);
      expect((await membershipsOf(gymId)).find((m) => m.entry_id === olivia)).toMatchObject({ price_minor: 1200, discount_payments: "every" });
    },
    T,
  );

  it(
    "a discount for memberships is made only for this gym's own types, an unpaid membership carries its discount on the bill it owes, and a type's later price changes nobody's",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("kept-owner");
      const nextDoor = await makeUser("kept-nextdoor");
      const gymId = await makeGym(owner, "Hmd Kept Gym");
      const otherGym = await makeGym(nextDoor, "Hmd Kept Next Door");
      const gold = await addType(gymId, owner.cookies, monthly());
      const theirGold = await addType(otherGym, nextDoor.cookies, monthly());
      const old = await addType(gymId, owner.cookies, monthly({ name: "Old plan" }));
      expect((await send("DELETE", `/v1/orgs/${gymId}/membership-types/${old}`, owner.cookies)).statusCode).toBe(200);

      // Next door's type, or one archived here, cannot be named.
      for (const typeId of [theirGold, old]) {
        const res = await post(`${register(gymId)}/discounts`, form("Not mine", { allMembershipTypes: false, membershipTypeIds: [typeId] }), owner.cookies);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("membership_type_not_found");
      }
      expect(await sql`SELECT id FROM gym_discounts WHERE gym_id = ${gymId}`).toHaveLength(0);
      const goldOnly = await addDiscount(gymId, owner.cookies, "Gold only", { allMembershipTypes: false, membershipTypeIds: [gold] });
      expect(goldOnly).toMatchObject({ forProducts: false, forMemberships: true, allMembershipTypes: false, membershipTypeIds: [gold], membershipPayments: "first" });

      // Given unpaid: the bill it owes is 40.00, and recording 40.00 settles it.
      const ava = await addPerson(gymId, owner.cookies, "Ava Wilson");
      const res = await give(gymId, ava, owner.cookies, giveBody(gold, 5000, { paid: false, method: undefined, discountId: goldOnly.id, discountMinor: 1000 }));
      expect(res.statusCode, res.body).toBe(201);
      const [ours] = await membershipsOf(gymId);
      if (ours === undefined) throw new Error("not given");
      expect((await billsOf(gymId, ours.id)).map((b) => [b.amount_minor, b.status])).toEqual([[4000, "open"]]);
      const pay = await post(`${heldUrl(gymId, ava)}/${ours.id}/payments`, { requestKey: nextForm(), periodIndex: 0, amountMinor: 4000, method: "cash" }, owner.cookies);
      expect(pay.statusCode, pay.body).toBe(200);
      expect((await billsOf(gymId, ours.id)).map((b) => [b.amount_minor, b.status])).toEqual([[4000, "paid"]]);

      // The type's price goes up to 60.00: her membership keeps 50.00, and its next bill is 50.00.
      const types = JSON.parse((await get(`/v1/orgs/${gymId}/membership-types`, owner.cookies)).body) as GymMembershipTypesResponse;
      const goldNow = types.types.find((t) => t.id === gold);
      if (goldNow === undefined) throw new Error("no Gold");
      expect((await put(`/v1/orgs/${gymId}/membership-types/${gold}`, { ...monthly({ priceMinor: 6000 }), taxRateId: null, updatedAt: goldNow.updatedAt }, owner.cookies)).statusCode).toBe(200);
      await run(gymId, "2026-11-15T17:00:00Z");
      expect((await billsOf(gymId, ours.id)).map((b) => b.amount_minor)).toEqual([4000, 5000]);
      // A screen still showing 50.00 gives nobody Gold now.
      const ben = await addPerson(gymId, owner.cookies, "Ben Lee");
      const stale = await give(gymId, ben, owner.cookies, giveBody(gold, 5000, { discountId: goldOnly.id, discountMinor: 1000 }));
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toBe("membership_price_changed");
      expect(await usesOf(goldOnly.id)).toBe(1);
      // Next door's owner reads nothing of this gym's discounts on their own person's page.
      const theirs = await addPerson(otherGym, nextDoor.cookies, "Their person");
      expect(held(await get(heldUrl(otherGym, theirs), nextDoor.cookies)).discounts).toEqual([]);
      // And cannot give this gym's person anything.
      expect((await give(gymId, ava, nextDoor.cookies, giveBody(gold, 6000))).statusCode).toBe(404);
    },
    T,
  );

  it(
    "only staff who may take payments read the discounts or give a membership with one; staff who may add memberships without that add them at the full price",
    async () => {
      clock = new Date("2026-10-15T17:00:00Z");
      const owner = await makeUser("who-owner");
      const front = await makeUser("who-front");
      const gymId = await makeGym(owner, "Hmd Who Gym");
      await staffWith(gymId, front, "trainer", ["members.read", "members.confirm"]);
      const gold = await addType(gymId, owner.cookies, monthly());
      const founders = await addDiscount(gymId, owner.cookies, "Founders", { code: "STAFFONLY", kind: "amount", percentBp: null, amountMinor: 1000, membershipPayments: "every" });
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");

      // The person's page is theirs to read: with no discount and no promo code in it.
      const page = held(await get(heldUrl(gymId, maya), front.cookies));
      expect(page.canBill).toBe(false);
      expect(page.discounts).toEqual([]);
      expect(held(await get(heldUrl(gymId, maya), owner.cookies)).discounts.map((x) => x.code)).toEqual(["STAFFONLY"]);

      // A give that names the discount is refused, unpaid as well as paid, and nothing is written or used.
      for (const paid of [false, true]) {
        const res = await give(gymId, maya, front.cookies, giveBody(gold, 5000, { paid, ...(paid ? {} : { method: undefined }), discountId: founders.id, discountMinor: 1000 }));
        expect(res.statusCode, res.body).toBe(403);
        expect(errorOf(res)).toBe("forbidden");
      }
      expect(await membershipsOf(gymId)).toEqual([]);
      expect(await usesOf(founders.id)).toBe(0);
      // Without the discount it is theirs to add, at the full price.
      const plain = await give(gymId, maya, front.cookies, giveBody(gold, 5000, { paid: false, method: undefined }));
      expect(plain.statusCode, plain.body).toBe(201);
      expect((await membershipsOf(gymId)).map((m) => [m.price_minor, m.discount_id])).toEqual([[5000, null]]);
    },
    T,
  );

  it(
    "a discount's first and last days are the gym's own: late evening in Chicago is still the last day, though it is the next day in UTC",
    async () => {
      // 22:00 in Chicago on 15 October is 03:00 UTC on the 16th.
      clock = new Date("2026-10-16T03:00:00Z");
      const owner = await makeUser("days-owner");
      const gymId = await makeGym(owner, "Hmd Days Gym");
      const gold = await addType(gymId, owner.cookies, monthly());
      const ends = await addDiscount(gymId, owner.cookies, "Ends today", { endsOn: "2026-10-15" });
      const starts = await addDiscount(gymId, owner.cookies, "Starts tomorrow", { startsOn: "2026-10-16" });
      const ava = await addPerson(gymId, owner.cookies, "Ava Wilson");
      const ben = await addPerson(gymId, owner.cookies, "Ben Lee");
      const ok = await give(gymId, ava, owner.cookies, giveBody(gold, 5000, { discountId: ends.id, discountMinor: 1000 }));
      expect(ok.statusCode, ok.body).toBe(201);
      const early = await give(gymId, ben, owner.cookies, giveBody(gold, 5000, { discountId: starts.id, discountMinor: 1000 }));
      expect(early.statusCode, early.body).toBe(409);
      expect(errorOf(early)).toBe("discount_not_started");
      expect(await usesOf(ends.id)).toBe(1);
      expect(await usesOf(starts.id)).toBe(0);
    },
    T,
  );
});
