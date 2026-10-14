// DISCOUNTS AND PROMO CODES, through the register's routes against real Postgres (spec
// Part 3 §14.3; ROADMAP 18b-ii-a). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: charge somebody a price the screen
// did not show, let a discount be used past its limit, or let one gym's discount work at
// another gym. That is the first test: the amounts of a discounted sale to the penny, a
// total that is not the discounted one refused, eight forms at one instant for a limit of
// three, one press sent six times, and next door's discount.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { DISCOUNTS_MAX, DISCOUNT_WORDS, sellPageResponseSchema, type GymDiscount, type MemberPurchasesResponse, type SellPageResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-discount-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_discount_routes";

let ipCounter = 0;
const nextIp = () => `10.95.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
/** A fresh request key, as the screen makes one a form. */
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("the register: discounts and promo codes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'regd-t-%@example.com')`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_discounts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'regd-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress,
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
    const email = `regd-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Regd ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string, country = "US", timezone = "America/Chicago", plan = true): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Austin", country, timezone }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    if (plan) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return id;
  };
  const staffWith = async (gymId: string, who: Person, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${privileges})`;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `regd-p-${String(++formCounter)}@example.com` }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const base = (gymId: string) => `/v1/orgs/${gymId}/register`;
  const page = (res: { body: string }): SellPageResponse => sellPageResponseSchema.parse(JSON.parse(res.body));
  const read = async (gymId: string, cookies: Cookies): Promise<SellPageResponse> => {
    const res = await get(base(gymId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return page(res);
  };
  const addProduct = async (gymId: string, cookies: Cookies, body: { name: string; priceMinor: number; taxed?: boolean; stock?: number | null }) => {
    const res = await post(`${base(gymId)}/products`, { taxed: true, stock: null, ...body }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).products.find((p) => p.name === body.name);
    if (found === undefined) throw new Error(`no product named ${body.name}`);
    return found;
  };
  /** A discount form, a percentage on every product unless it says otherwise. */
  const form = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    code: null,
    kind: "percent",
    percentBp: 2000,
    amountMinor: null,
    startsOn: null,
    endsOn: null,
    maxUses: null,
    forProducts: true,
    allProducts: true,
    productIds: [],
    forMemberships: false,
    allMembershipTypes: true,
    membershipTypeIds: [],
    membershipPayments: null,
    ...over,
  });
  const addDiscount = async (gymId: string, cookies: Cookies, name: string, over: Record<string, unknown> = {}): Promise<GymDiscount> => {
    const res = await post(`${base(gymId)}/discounts`, form(name, over), cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).discounts.find((x) => x.name === name);
    if (found === undefined) throw new Error(`no discount named ${name}`);
    return found;
  };
  const sale = (productId: string, totalMinor: number, over: Record<string, unknown> = {}) => ({
    requestKey: nextForm(),
    productId,
    quantity: 1,
    entryId: null,
    method: "cash",
    totalMinor,
    ...over,
  });
  const sell = (gymId: string, cookies: Cookies, body: Record<string, unknown>) => send("POST", `${base(gymId)}/sales`, cookies, body);

  /** What is in the tables, read directly. */
  const salesOf = (gymId: string) => sql<
    { id: string; product_id: string; quantity: number; unit_price_minor: number; net_minor: number; tax_minor: number; total_minor: number; discount_id: string | null; discount_name: string | null; discount_minor: number; undone: boolean }[]
  >`
    SELECT id, product_id, quantity, unit_price_minor, net_minor, tax_minor, total_minor, discount_id, discount_name, discount_minor, undone_at IS NOT NULL AS undone
    FROM gym_sales WHERE gym_id = ${gymId} ORDER BY seq`;
  const usesOf = async (discountId: string) => (await sql<{ uses: number }[]>`SELECT uses FROM gym_discounts WHERE id = ${discountId}`)[0]?.uses;
  const discountsOf = (gymId: string) => sql<{ id: string; name: string; code: string | null; uses: number; archived: boolean }[]>`
    SELECT id, name, code, uses, archived_at IS NOT NULL AS archived FROM gym_discounts WHERE gym_id = ${gymId} ORDER BY created_at, id`;
  const auditOf = (gymId: string, action: string) => sql<{ target_id: string; meta: Record<string, string> }[]>`
    SELECT target_id, meta FROM audit_log WHERE gym_id = ${gymId} AND action = ${action} ORDER BY at, id`;

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
    "the price charged is the price shown, a limit of three is three however many press at once, one press is one use, and next door's discount does not work here",
    async () => {
      const owner = await makeUser("worst-owner");
      const desk = await makeUser("worst-desk");
      const nextDoor = await makeUser("worst-nextdoor");
      const gymId = await makeGym(owner, "Regd Worst Gym");
      const otherGym = await makeGym(nextDoor, "Regd Worst Next Door");
      await staffWith(gymId, desk, "manager", null);
      expect((await put(`${base(gymId)}/tax`, { bp: 825, included: false }, owner.cookies)).statusCode).toBe(200);
      const water = await addProduct(gymId, owner.cookies, { name: "Water 500 ml", priceMinor: 199 });
      const summer = await addDiscount(gymId, owner.cookies, "Summer sale", { code: "SUMMER20" });
      const firstThree = await addDiscount(gymId, owner.cookies, "First three", { percentBp: 1000, maxUses: 3 });
      const theirs = await addDiscount(otherGym, nextDoor.cookies, "Their half off", { percentBp: 5000, code: "HALF" });
      const theirWater = await addProduct(otherGym, nextDoor.cookies, { name: "Their water", priceMinor: 199 });

      // Two at 1.99 is 3.98; 20% of it is 0.796, so 0.80 off; 3.18 before tax; 8.25% of
      // that is 0.26235, so 0.26; 3.44 to pay. Without the discount it is 4.31.
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const shown = sale(water.id, 344, { quantity: 2, discountId: summer.id, entryId: maya, method: "card_at_desk" });
      // The full price sent with the discount, and the discounted price sent without it:
      // neither is what a screen showed, and neither is sold.
      for (const wrong of [
        { ...shown, requestKey: nextForm(), totalMinor: 431 },
        { ...shown, requestKey: nextForm(), discountId: null },
        { ...shown, requestKey: nextForm(), totalMinor: 343 },
        { ...shown, requestKey: nextForm(), totalMinor: 345 },
      ]) {
        const res = await sell(gymId, owner.cookies, wrong);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("sale_price_changed");
      }
      expect(await salesOf(gymId)).toEqual([]);
      expect(await usesOf(summer.id)).toBe(0);

      // The same press, six times at one instant, from two people: one sale and one use.
      const six = await Promise.all([0, 1, 2, 3, 4, 5].map((n) => sell(gymId, n % 2 === 0 ? owner.cookies : desk.cookies, shown)));
      expect(six.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
      expect(new Set(six.map((r) => (JSON.parse(r.body) as { saleId: string }).saleId)).size).toBe(1);
      let rows = await salesOf(gymId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ quantity: 2, unit_price_minor: 199, discount_id: summer.id, discount_name: "Summer sale", discount_minor: 80, net_minor: 318, tax_minor: 26, total_minor: 344 });
      expect(await usesOf(summer.id)).toBe(1);
      // The same key with another discount, or none, behind it is another sale: refused.
      for (const other of [{ discountId: firstThree.id }, { discountId: null }]) {
        const res = await sell(gymId, owner.cookies, { ...shown, ...other });
        expect(res.statusCode, JSON.stringify(other)).toBe(409);
        expect(errorOf(res)).toBe("request_reused");
      }
      expect(await usesOf(summer.id)).toBe(1);
      expect(await usesOf(firstThree.id)).toBe(0);
      const notes = await auditOf(gymId, "org.sale_recorded");
      expect(notes).toHaveLength(1);
      expect(notes[0]?.meta).toMatchObject({ discountId: summer.id, discount: "Summer sale", discountMinor: "80", totalMinor: "344" });

      // Eight forms at one instant for a discount that can be used three times. One water
      // at 1.99 less 10% (0.199, so 0.20) is 1.79; tax 0.147675, so 0.15; 1.94 to pay.
      const eight = await Promise.all(Array.from({ length: 8 }, (_, n) => sell(gymId, n % 2 === 0 ? owner.cookies : desk.cookies, sale(water.id, 194, { discountId: firstThree.id }))));
      expect(eight.filter((r) => r.statusCode === 201)).toHaveLength(3);
      const refused = eight.filter((r) => r.statusCode === 409);
      expect(refused).toHaveLength(5);
      for (const res of refused) {
        expect(errorOf(res)).toBe("discount_used_up");
        expect(messageOf(res)).toBe("First three has reached its usage limit. Nothing was sold: pick another discount, or sell without one.");
      }
      expect(await usesOf(firstThree.id)).toBe(3);
      rows = await salesOf(gymId);
      expect(rows.filter((r) => r.discount_id === firstThree.id)).toHaveLength(3);
      expect(rows).toHaveLength(4);
      // And one more, a moment later, on its own.
      const fourth = await sell(gymId, desk.cookies, sale(water.id, 194, { discountId: firstThree.id }));
      expect(fourth.statusCode).toBe(409);
      expect(errorOf(fourth)).toBe("discount_used_up");
      expect(await salesOf(gymId)).toHaveLength(4);

      // A sale taken back gives its use back, once; then the limit holds again.
      const taken = rows.find((r) => r.discount_id === firstThree.id);
      if (taken === undefined) throw new Error("no sale with the limited discount");
      const undo = await Promise.all([0, 1, 2].map(() => post(`${base(gymId)}/sales/${taken.id}/undo`, {}, owner.cookies)));
      expect(undo.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(await usesOf(firstThree.id)).toBe(2);
      const two = await Promise.all([sell(gymId, owner.cookies, sale(water.id, 194, { discountId: firstThree.id })), sell(gymId, desk.cookies, sale(water.id, 194, { discountId: firstThree.id }))]);
      expect(two.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(await usesOf(firstThree.id)).toBe(3);

      // Next door's discount on this gym's sale, at the price it would give: nothing is
      // sold here, and nothing of theirs is used. 1.99 less 50% (0.995, so 1.00) is 0.99;
      // tax 0.081675, so 0.08; 1.07.
      const before = (await salesOf(gymId)).length;
      const withTheirs = await sell(gymId, owner.cookies, sale(water.id, 107, { discountId: theirs.id }));
      expect(withTheirs.statusCode).toBe(409);
      expect(errorOf(withTheirs)).toBe("discount_not_available");
      expect(messageOf(withTheirs)).toBe(DISCOUNT_WORDS.not_available);
      expect(await salesOf(gymId)).toHaveLength(before);
      expect(await usesOf(theirs.id)).toBe(0);
      // It does work at their own gym, where no tax is set: 1.99 less 1.00 is 0.99.
      expect((await sell(otherGym, nextDoor.cookies, sale(theirWater.id, 99, { discountId: theirs.id }))).statusCode).toBe(201);
      expect(await usesOf(theirs.id)).toBe(1);
      // This gym's owner cannot change it, archive it or put it back, and is not sent it.
      expect((await put(`${base(gymId)}/discounts/${theirs.id}`, { ...form("Mine now"), updatedAt: theirs.updatedAt }, owner.cookies)).statusCode).toBe(404);
      expect((await del(`${base(gymId)}/discounts/${theirs.id}`, owner.cookies)).statusCode).toBe(404);
      expect((await post(`${base(gymId)}/discounts/${theirs.id}/restore`, {}, owner.cookies)).statusCode).toBe(404);
      const mine = await get(base(gymId), owner.cookies);
      expect(page(mine).discounts.map((x) => x.name).sort()).toEqual(["First three", "Summer sale"]);
      expect(mine.body).not.toContain("HALF");
      expect((await discountsOf(otherGym)).map((x) => [x.name, x.code, x.archived])).toEqual([["Their half off", "HALF", false]]);
      // Nor can a discount of this gym's be limited to next door's product.
      const onTheirs = await post(`${base(gymId)}/discounts`, form("On their water", { allProducts: false, productIds: [theirWater.id] }), owner.cookies);
      expect(onTheirs.statusCode).toBe(409);
      expect(errorOf(onTheirs)).toBe("product_not_for_sale");
      expect((await discountsOf(gymId)).map((x) => x.name)).toEqual(["Summer sale", "First three"]);
    },
    T,
  );

  it(
    "a discount is used only on its own days, on its own products and while it is offered, and a sale keeps the discount it was made with",
    async () => {
      const owner = await makeUser("when-owner");
      // Honolulu is ten hours behind UTC all year: 2026-10-14 05:00 UTC is still the 13th there.
      const gymId = await makeGym(owner, "Regd When Gym", "US", "Pacific/Honolulu");
      const water = await addProduct(gymId, owner.cookies, { name: "Water", priceMinor: 200, taxed: false });
      const towel = await addProduct(gymId, owner.cookies, { name: "Towel", priceMinor: 500, taxed: false });
      clock = new Date("2026-10-14T05:00:00Z");
      const tomorrow = await addDiscount(gymId, owner.cookies, "Starts on the 14th", { startsOn: "2026-10-14" });
      const untilToday = await addDiscount(gymId, owner.cookies, "Ends on the 13th", { endsOn: "2026-10-13" });
      const yesterday = await addDiscount(gymId, owner.cookies, "Ended on the 12th", { startsOn: "2026-10-01", endsOn: "2026-10-12" });
      const towels = await addDiscount(gymId, owner.cookies, "Towels only", { allProducts: false, productIds: [towel.id] });
      const dollar = await addDiscount(gymId, owner.cookies, "Dollar off", { kind: "amount", percentBp: null, amountMinor: 100 });
      const whole = await addDiscount(gymId, owner.cookies, "Whole price", { percentBp: 9999 });
      const five = await addDiscount(gymId, owner.cookies, "Five dollars off", { kind: "amount", percentBp: null, amountMinor: 500 });
      const tiny = await addDiscount(gymId, owner.cookies, "Tiny", { percentBp: 1 });

      const refusedAs = async (discountId: string, productId: string, totalMinor: number, error: string, words: string) => {
        const before = (await salesOf(gymId)).length;
        const res = await sell(gymId, owner.cookies, sale(productId, totalMinor, { discountId }));
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe(error);
        expect(messageOf(res)).toBe(words);
        expect(await salesOf(gymId)).toHaveLength(before);
        expect(await usesOf(discountId)).toBe(0);
      };
      const none = "Nothing was sold: pick another discount, or sell without one.";
      // The gym's day is the 13th, whatever the server's own day is.
      await refusedAs(tomorrow.id, water.id, 160, "discount_not_started", `Starts on the 14th has not started yet. ${none}`);
      await refusedAs(yesterday.id, water.id, 160, "discount_expired", `Ended on the 12th has expired. ${none}`);
      await refusedAs(towels.id, water.id, 160, "discount_not_for_product", `Towels only does not apply to this product. ${none}`);
      await refusedAs(whole.id, water.id, 1, "discount_nothing_to_pay", DISCOUNT_WORDS.nothing_to_pay);
      await refusedAs(five.id, water.id, 1, "discount_nothing_to_pay", DISCOUNT_WORDS.nothing_to_pay);
      expect((await sell(gymId, owner.cookies, sale(water.id, 160, { discountId: untilToday.id }))).statusCode).toBe(201);
      expect((await sell(gymId, owner.cookies, sale(towel.id, 400, { discountId: towels.id }))).statusCode).toBe(201);
      // A fixed amount comes off once, however many are bought: three at 2.00 less 1.00.
      expect((await sell(gymId, owner.cookies, sale(water.id, 500, { quantity: 3, discountId: dollar.id }))).statusCode).toBe(201);
      // 0.01% of 2.00 rounds to nothing: not sold with it, so no use is spent on nothing off.
      await refusedAs(tiny.id, water.id, 200, "discount_takes_nothing_off", `Tiny takes nothing off this price. ${none}`);
      expect((await salesOf(gymId)).map((r) => [r.discount_name, r.discount_minor, r.total_minor])).toEqual([
        ["Ends on the 13th", 40, 160],
        ["Towels only", 100, 400],
        ["Dollar off", 100, 500],
      ]);

      // Six hours on it is the 14th in Honolulu: what ended on the 13th is over, what starts on the 14th works.
      clock = new Date("2026-10-14T11:00:00Z");
      await refusedAs(yesterday.id, water.id, 160, "discount_expired", `Ended on the 12th has expired. ${none}`);
      const over = await sell(gymId, owner.cookies, sale(water.id, 160, { discountId: untilToday.id }));
      expect(over.statusCode).toBe(409);
      expect(errorOf(over)).toBe("discount_expired");
      expect((await sell(gymId, owner.cookies, sale(water.id, 160, { discountId: tomorrow.id }))).statusCode).toBe(201);

      // The discount is changed after a screen showed its price: that price is not charged.
      const now = (await read(gymId, owner.cookies)).discounts.find((x) => x.id === tomorrow.id);
      if (now === undefined) throw new Error("the discount is gone");
      const changed = await put(`${base(gymId)}/discounts/${tomorrow.id}`, { ...form("Half price week", { percentBp: 5000, startsOn: "2026-10-14" }), updatedAt: now.updatedAt }, owner.cookies);
      expect(changed.statusCode, changed.body).toBe(200);
      const stale = await sell(gymId, owner.cookies, sale(water.id, 160, { discountId: tomorrow.id }));
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toBe("sale_price_changed");
      expect((await sell(gymId, owner.cookies, sale(water.id, 100, { discountId: tomorrow.id }))).statusCode).toBe(201);
      // Archived: no longer used, and the sales made with it keep its name and what it took off.
      expect((await del(`${base(gymId)}/discounts/${tomorrow.id}`, owner.cookies)).statusCode).toBe(200);
      const gone = await sell(gymId, owner.cookies, sale(water.id, 100, { discountId: tomorrow.id }));
      expect(gone.statusCode).toBe(409);
      expect(errorOf(gone)).toBe("discount_archived");
      expect((await salesOf(gymId)).filter((r) => r.discount_id === tomorrow.id).map((r) => [r.discount_name, r.discount_minor, r.total_minor])).toEqual([
        ["Starts on the 14th", 40, 160],
        ["Half price week", 100, 100],
      ]);

      // The page and a person's purchases say what each sale was made with.
      const shown = await read(gymId, owner.cookies);
      expect(shown.sales.map((s) => [s.discountName, s.discountMinor, s.totalMinor])).toEqual([
        ["Half price week", 100, 100],
        ["Starts on the 14th", 40, 160],
      ]);
      expect(shown.totals).toMatchObject({ count: 2, totalMinor: 260, discountMinor: 140 });
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      expect((await sell(gymId, owner.cookies, sale(towel.id, 400, { discountId: towels.id, entryId: maya }))).statusCode).toBe(201);
      const bought = JSON.parse((await get(`/v1/orgs/${gymId}/member-list/entries/${maya}/purchases`, owner.cookies)).body) as MemberPurchasesResponse;
      expect(bought.sales.map((s) => [s.itemName, s.discountName, s.discountMinor, s.totalMinor])).toEqual([["Towel", "Towels only", 100, 400]]);
      // A sale taken back is in no sum, its discount's with it.
      const last = (await salesOf(gymId)).at(-1);
      if (last === undefined) throw new Error("no sale");
      expect((await post(`${base(gymId)}/sales/${last.id}/undo`, {}, owner.cookies)).statusCode).toBe(200);
      expect((await read(gymId, owner.cookies)).totals).toMatchObject({ count: 2, totalMinor: 260, discountMinor: 140 });
      expect(await usesOf(towels.id)).toBe(1);

      // The gym moves to the UK: a fixed amount in dollars comes off nothing priced in
      // pounds until it is saved again, which puts it in pounds.
      expect((await send("PATCH", `/v1/orgs/${gymId}`, owner.cookies, { country: "GB" })).statusCode).toBe(200);
      const waterNow = (await read(gymId, owner.cookies)).products.find((p) => p.id === water.id);
      if (waterNow === undefined) throw new Error("the water is gone");
      expect((await put(`${base(gymId)}/products/${water.id}`, { name: "Water", priceMinor: 200, taxed: false, stock: null, updatedAt: waterNow.updatedAt }, owner.cookies)).statusCode).toBe(200);
      const inDollars = await sell(gymId, owner.cookies, sale(water.id, 100, { discountId: dollar.id }));
      expect(inDollars.statusCode).toBe(409);
      expect(errorOf(inDollars)).toBe("discount_other_currency");
      expect(messageOf(inDollars)).toBe("Dollar off is a fixed amount in another currency. Nothing was sold: open Dollar off under Discounts and save its amount again.");
      const dollarNow = (await read(gymId, owner.cookies)).discounts.find((x) => x.id === dollar.id);
      if (dollarNow === undefined) throw new Error("the discount is gone");
      expect(dollarNow.currency).toBe("USD");
      const saved = await put(`${base(gymId)}/discounts/${dollar.id}`, { ...form("Dollar off", { kind: "amount", percentBp: null, amountMinor: 100 }), updatedAt: dollarNow.updatedAt }, owner.cookies);
      expect(saved.statusCode, saved.body).toBe(200);
      expect(page(saved).discounts.find((x) => x.id === dollar.id)?.currency).toBe("GBP");
      expect((await sell(gymId, owner.cookies, sale(water.id, 100, { discountId: dollar.id }))).statusCode).toBe(201);
      clock = new Date();
    },
    T,
  );

  it(
    "discounts: one of a name and one of a promo code, a save over a newer one refused, a use does not make a form stale, archived ones kept, and no more than the cap",
    async () => {
      const owner = await makeUser("keep-owner");
      const gymId = await makeGym(owner, "Regd Keep Gym");
      const water = await addProduct(gymId, owner.cookies, { name: "Water", priceMinor: 200, taxed: false });
      const towel = await addProduct(gymId, owner.cookies, { name: "Towel", priceMinor: 500, taxed: false });
      const summer = await addDiscount(gymId, owner.cookies, "Summer sale", { code: "SUMMER20", startsOn: "2026-01-01", endsOn: "2030-12-31", maxUses: 50, allProducts: false, productIds: [water.id, towel.id] });
      expect(summer).toMatchObject({ code: "SUMMER20", kind: "percent", percentBp: 2000, amountMinor: null, currency: null, startsOn: "2026-01-01", endsOn: "2030-12-31", maxUses: 50, uses: 0, allProducts: false, archivedAt: null });
      expect([...summer.productIds].sort()).toEqual([water.id, towel.id].sort());
      const flat = await addDiscount(gymId, owner.cookies, "Staff", { kind: "amount", percentBp: null, amountMinor: 50 });
      expect(flat).toMatchObject({ kind: "amount", percentBp: null, amountMinor: 50, currency: "USD", code: null, maxUses: null, allProducts: true, productIds: [] });
      const made = await auditOf(gymId, "org.discount_created");
      expect(made.map((n) => n.meta["name"])).toEqual(["Summer sale", "Staff"]);

      const sameName = await post(`${base(gymId)}/discounts`, form(" summer SALE "), owner.cookies);
      expect(sameName.statusCode).toBe(409);
      expect(errorOf(sameName)).toBe("discount_name_taken");
      const sameCode = await post(`${base(gymId)}/discounts`, form("Another", { code: "SUMMER20" }), owner.cookies);
      expect(sameCode.statusCode).toBe(409);
      expect(errorOf(sameCode)).toBe("promo_code_taken");
      expect(messageOf(sameCode)).toBe(DISCOUNT_WORDS.code_taken);
      // Two at one instant with one promo code: one is kept.
      const pair = await Promise.all([post(`${base(gymId)}/discounts`, form("Twin A", { code: "TWIN" }), owner.cookies), post(`${base(gymId)}/discounts`, form("Twin B", { code: "TWIN" }), owner.cookies)]);
      expect(pair.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect((await discountsOf(gymId)).filter((x) => x.code === "TWIN")).toHaveLength(1);
      // What the form would not send is refused before anything is asked of the database.
      for (const bad of [form("Bad", { percentBp: 0 }), form("Bad", { code: "ab" }), form("Bad", { startsOn: "2026-08-31", endsOn: "2026-06-01" }), form("Bad", { amountMinor: 100 }), form("Bad", { uses: 5 })]) {
        const res = await post(`${base(gymId)}/discounts`, bad, owner.cookies);
        expect(res.statusCode, JSON.stringify(bad)).toBe(400);
        expect(errorOf(res)).toBe("validation_error");
      }
      // A product that is archived cannot be picked.
      const mat = await addProduct(gymId, owner.cookies, { name: "Mat", priceMinor: 900 });
      expect((await del(`${base(gymId)}/products/${mat.id}`, owner.cookies)).statusCode).toBe(200);
      const onGone = await post(`${base(gymId)}/discounts`, form("On the mat", { allProducts: false, productIds: [mat.id] }), owner.cookies);
      expect(onGone.statusCode).toBe(409);
      expect(errorOf(onGone)).toBe("product_not_for_sale");

      // A sale made with it while its form is open does not refuse the form's save, and the save keeps the count.
      expect((await sell(gymId, owner.cookies, sale(water.id, 160, { discountId: summer.id }))).statusCode).toBe(201);
      const save = await put(`${base(gymId)}/discounts/${summer.id}`, { ...form("Summer sale", { code: "SUMMER25", percentBp: 2500, maxUses: 40 }), updatedAt: summer.updatedAt }, owner.cookies);
      expect(save.statusCode, save.body).toBe(200);
      const after = page(save).discounts.find((x) => x.id === summer.id);
      expect(after).toMatchObject({ code: "SUMMER25", percentBp: 2500, maxUses: 40, uses: 1, allProducts: true, productIds: [], startsOn: null, endsOn: null });
      // The same form again, read before that save: refused, and nothing changes.
      const staleSave = await put(`${base(gymId)}/discounts/${summer.id}`, { ...form("Old summer"), updatedAt: summer.updatedAt }, owner.cookies);
      expect(staleSave.statusCode).toBe(409);
      expect(errorOf(staleSave)).toBe("discount_changed");
      expect((await discountsOf(gymId)).find((x) => x.id === summer.id)).toMatchObject({ name: "Summer sale", code: "SUMMER25", uses: 1 });
      // A change cannot take another discount's name or code.
      const flatNow = (await read(gymId, owner.cookies)).discounts.find((x) => x.id === flat.id);
      const steal = await put(`${base(gymId)}/discounts/${flat.id}`, { ...form("Staff", { code: "SUMMER25" }), updatedAt: flatNow?.updatedAt }, owner.cookies);
      expect(steal.statusCode).toBe(409);
      expect(errorOf(steal)).toBe("promo_code_taken");

      // Archived: off the list, its name and code free; put back while they are taken is refused.
      expect((await del(`${base(gymId)}/discounts/${summer.id}`, owner.cookies)).statusCode).toBe(200);
      expect((await del(`${base(gymId)}/discounts/${summer.id}`, owner.cookies)).statusCode).toBe(404);
      let now = await read(gymId, owner.cookies);
      expect(now.discounts.map((x) => x.name)).not.toContain("Summer sale");
      expect(now.archivedDiscounts.map((x) => [x.name, x.uses])).toEqual([["Summer sale", 1]]);
      expect(now.archivedDiscountsTotal).toBe(1);
      const again = await addDiscount(gymId, owner.cookies, "Summer sale", { code: "SUMMER25" });
      const back = await post(`${base(gymId)}/discounts/${summer.id}/restore`, {}, owner.cookies);
      expect(back.statusCode).toBe(409);
      expect(errorOf(back)).toBe("discount_name_taken");
      const againNow = (await read(gymId, owner.cookies)).discounts.find((x) => x.id === again.id);
      expect((await put(`${base(gymId)}/discounts/${again.id}`, { ...form("Autumn sale", { code: "SUMMER25" }), updatedAt: againNow?.updatedAt }, owner.cookies)).statusCode).toBe(200);
      const backCode = await post(`${base(gymId)}/discounts/${summer.id}/restore`, {}, owner.cookies);
      expect(backCode.statusCode).toBe(409);
      expect(errorOf(backCode)).toBe("promo_code_taken");
      expect((await del(`${base(gymId)}/discounts/${again.id}`, owner.cookies)).statusCode).toBe(200);
      expect((await post(`${base(gymId)}/discounts/${summer.id}/restore`, {}, owner.cookies)).statusCode).toBe(200);
      expect((await sell(gymId, owner.cookies, sale(water.id, 150, { discountId: summer.id }))).statusCode).toBe(201);
      expect(await usesOf(summer.id)).toBe(2);

      // The cap.
      const have = (await discountsOf(gymId)).filter((x) => !x.archived).length;
      await sql`
        INSERT INTO gym_discounts (gym_id, name, kind, percent_bp)
        SELECT ${gymId}, 'Filler ' || n, 'percent', 500 FROM generate_series(1, ${DISCOUNTS_MAX - have}) AS n`;
      const over = await post(`${base(gymId)}/discounts`, form("One more"), owner.cookies);
      expect(over.statusCode).toBe(409);
      expect(errorOf(over)).toBe("too_many_discounts");
      now = await read(gymId, owner.cookies);
      expect(now.discounts).toHaveLength(DISCOUNTS_MAX);
    },
    T,
  );

  it(
    "who may: nobody signed in 401, a stranger, next door's owner and a member 404, staff without the price tick 403, and a gym on no plan changes nothing",
    async () => {
      const owner = await makeUser("who-owner");
      const nextDoor = await makeUser("who-nextdoor");
      const stranger = await makeUser("who-stranger");
      const seller = await makeUser("who-seller");
      const pricer = await makeUser("who-pricer");
      const trainer = await makeUser("who-trainer");
      const member = await makeUser("who-member");
      const gymId = await makeGym(owner, "Regd Who Gym");
      await makeGym(nextDoor, "Regd Who Next Door");
      await staffWith(gymId, seller, "trainer", ["members.read", "billing.members"]);
      await staffWith(gymId, pricer, "trainer", ["memberships.manage"]);
      await staffWith(gymId, trainer, "trainer", ["members.read", "members.confirm", "attendance.mark"]);
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${member.userId})`;
      const water = await addProduct(gymId, owner.cookies, { name: "Water", priceMinor: 200, taxed: false });
      const kept = await addDiscount(gymId, owner.cookies, "Kept", { code: "KEPT10", percentBp: 1000 });
      const fresh = async () => (await read(gymId, owner.cookies)).discounts.find((x) => x.id === kept.id)?.updatedAt ?? kept.updatedAt;
      let n = 0;

      /** Every discount route, and a sale with the discount, as one person asks them. */
      const everything = async (cookies: Cookies) => ({
        add: (await post(`${base(gymId)}/discounts`, form(`Added ${String(++n)}`), cookies)).statusCode,
        change: (await put(`${base(gymId)}/discounts/${kept.id}`, { ...form("Kept", { code: "KEPT10", percentBp: 1000 }), updatedAt: await fresh() }, cookies)).statusCode,
        archive: (await del(`${base(gymId)}/discounts/${kept.id}`, cookies)).statusCode,
        restore: (await post(`${base(gymId)}/discounts/${kept.id}/restore`, {}, cookies)).statusCode,
        sell: (await sell(gymId, cookies, sale(water.id, 180, { discountId: kept.id }))).statusCode,
      });
      const all = (status: number) => ({ add: status, change: status, archive: status, restore: status, sell: status });
      const state = async () => ({ discounts: await discountsOf(gymId), sales: (await salesOf(gymId)).length });

      const before = await state();
      expect(await everything({})).toEqual(all(401));
      expect(await everything(stranger.cookies)).toEqual(all(404));
      expect(await everything(nextDoor.cookies)).toEqual(all(404));
      expect(await everything(member.cookies)).toEqual(all(404));
      expect(await everything(trainer.cookies)).toEqual(all(403));
      expect(await state()).toEqual(before);

      // Selling alone: uses a discount, is sent the list to pick from, and changes none.
      expect(await everything(seller.cookies)).toEqual({ add: 403, change: 403, archive: 403, restore: 403, sell: 201 });
      expect((await read(gymId, seller.cookies)).discounts.map((x) => [x.name, x.code, x.uses])).toEqual([["Kept", "KEPT10", 1]]);
      expect((await discountsOf(gymId)).map((x) => [x.name, x.archived])).toEqual([["Kept", false]]);
      // Changing prices alone: every change, no sale, and no sale's row sent.
      expect(await everything(pricer.cookies)).toEqual({ add: 201, change: 200, archive: 200, restore: 200, sell: 403 });
      const bare = await read(gymId, pricer.cookies);
      expect(bare.sales).toEqual([]);
      expect(bare.discounts.map((x) => x.name).sort()).toEqual([`Added ${String(n)}`, "Kept"]);
      expect(await salesOf(gymId)).toHaveLength(1);

      // A gym on no plan reads its discounts and changes nothing.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
      const frozen = await state();
      expect((await get(base(gymId), owner.cookies)).statusCode).toBe(200);
      expect(await everything(owner.cookies)).toEqual(all(409));
      expect(await state()).toEqual(frozen);
    },
    T,
  );

  it(
    "tax inside the price is the tax of what is left, a day that does not exist is refused, each change is noted, a discount with a sale cannot be deleted, and the limit holds at ONE address",
    async () => {
      const owner = await makeUser("more-owner");
      const pricer = await makeUser("more-pricer");
      const other = await makeUser("more-other");
      const gymId = await makeGym(owner, "Regd More Gym", "GB", "Europe/London");
      const otherGym = await makeGym(other, "Regd More Other");
      await staffWith(gymId, pricer, "trainer", ["memberships.manage"]);

      // 20% VAT inside the price. A towel at 10.00 less 2.00 is 8.00 paid; a sixth of it,
      // 1.3333, is tax, so 1.33, and 6.67 before tax. Less 15% (1.50) it is 8.50 paid;
      // a sixth, 1.41667, so 1.42, and 7.08.
      expect((await put(`${base(gymId)}/tax`, { bp: 2000, included: true }, owner.cookies)).statusCode).toBe(200);
      const towel = await addProduct(gymId, owner.cookies, { name: "Towel", priceMinor: 1000 });
      const two = await addDiscount(gymId, owner.cookies, "Two pounds off", { kind: "amount", percentBp: null, amountMinor: 200 });
      const fifteen = await addDiscount(gymId, owner.cookies, "Fifteen", { percentBp: 1500 });
      for (const wrong of [1000, 799, 801, 667]) {
        const res = await sell(gymId, owner.cookies, sale(towel.id, wrong, { discountId: two.id }));
        expect(res.statusCode, String(wrong)).toBe(409);
        expect(errorOf(res)).toBe("sale_price_changed");
      }
      expect((await sell(gymId, owner.cookies, sale(towel.id, 800, { discountId: two.id }))).statusCode).toBe(201);
      expect((await sell(gymId, owner.cookies, sale(towel.id, 850, { discountId: fifteen.id }))).statusCode).toBe(201);
      expect((await salesOf(gymId)).map((r) => [r.discount_name, r.discount_minor, r.net_minor, r.tax_minor, r.total_minor])).toEqual([
        ["Two pounds off", 200, 667, 133, 800],
        ["Fifteen", 150, 708, 142, 850],
      ]);

      // A day that has the shape of one and does not exist, on a new discount and on a change.
      const before = await discountsOf(gymId);
      for (const days of [{ startsOn: "2026-02-31" }, { endsOn: "2026-02-30" }, { startsOn: "2026-13-01" }, { startsOn: "0000-00-00" }, { percentBp: 10_000 }]) {
        const made = await post(`${base(gymId)}/discounts`, form("Bad day", days), owner.cookies);
        expect(made.statusCode, JSON.stringify(days)).toBe(400);
        expect(errorOf(made)).toBe("validation_error");
        const saved = await put(`${base(gymId)}/discounts/${fifteen.id}`, { ...form("Fifteen", { percentBp: 1500, ...days }), updatedAt: fifteen.updatedAt }, owner.cookies);
        expect(saved.statusCode, JSON.stringify(days)).toBe(400);
      }
      expect(await discountsOf(gymId)).toEqual(before);

      // Each change is noted in the gym's record, once, against the discount.
      const changed = await put(`${base(gymId)}/discounts/${fifteen.id}`, { ...form("Fifteen percent", { percentBp: 1500, code: "FIFTEEN" }), updatedAt: fifteen.updatedAt }, owner.cookies);
      expect(changed.statusCode, changed.body).toBe(200);
      expect((await del(`${base(gymId)}/discounts/${fifteen.id}`, owner.cookies)).statusCode).toBe(200);
      expect((await post(`${base(gymId)}/discounts/${fifteen.id}/restore`, {}, owner.cookies)).statusCode).toBe(200);
      const updated = await auditOf(gymId, "org.discount_updated");
      expect(updated.map((n) => [n.target_id, n.meta["before"], n.meta["name"], n.meta["code"]])).toEqual([[fifteen.id, "Fifteen", "Fifteen percent", "FIFTEEN"]]);
      expect((await auditOf(gymId, "org.discount_archived")).map((n) => [n.target_id, n.meta["name"]])).toEqual([[fifteen.id, "Fifteen percent"]]);
      expect((await auditOf(gymId, "org.discount_restored")).map((n) => [n.target_id, n.meta["name"]])).toEqual([[fifteen.id, "Fifteen percent"]]);

      // The database itself refuses to lose a discount a sale was made with.
      await expect(sql`DELETE FROM gym_discounts WHERE id = ${two.id}`).rejects.toThrow(/gym_sales_discount_fk/);
      expect(await salesOf(gymId)).toHaveLength(2);

      // The limit, counted into the store: somebody at their own ceiling is refused and
      // writes nothing; the gym's address at its ceiling stops the gym, and not next door.
      const DESK = "10.96.0.9";
      const add = (who: Person, gym: string, name: string) => send("POST", `${base(gym)}/discounts`, who.cookies, form(name), DESK);
      expect((await add(pricer, gymId, "Within the limit")).statusCode).toBe(201);
      for (let n = 1; n < 300; n++) await redis.incrWithTtl(`rl:orgs_register_manage:id:${pricer.userId}`, 3600);
      const overOwn = await add(pricer, gymId, "Past my own limit");
      expect(overOwn.statusCode).toBe(429);
      expect((await add(owner, gymId, "The owner still can")).statusCode).toBe(201);
      for (let n = 0; n < 900; n++) await redis.incrWithTtl(`rl:orgs_register_manage:ip:${gymId}:${DESK}`, 3600);
      for (const res of [
        await add(owner, gymId, "Past the address limit"),
        await send("PUT", `${base(gymId)}/discounts/${two.id}`, owner.cookies, { ...form("Renamed", { kind: "amount", percentBp: null, amountMinor: 200 }), updatedAt: two.updatedAt }, DESK),
        await send("DELETE", `${base(gymId)}/discounts/${two.id}`, owner.cookies, undefined, DESK),
        await send("POST", `${base(gymId)}/discounts/${two.id}/restore`, owner.cookies, {}, DESK),
      ]) {
        expect(res.statusCode, res.body).toBe(429);
      }
      expect((await add(other, otherGym, "Next door at the same address")).statusCode).toBe(201);
      expect((await discountsOf(gymId)).map((x) => [x.name, x.archived]).sort()).toEqual(
        [
          ["Fifteen percent", false],
          ["The owner still can", false],
          ["Two pounds off", false],
          ["Within the limit", false],
        ].sort(),
      );
    },
    T,
  );
});
