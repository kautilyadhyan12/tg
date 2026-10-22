// UPI FOR GYMS IN INDIA, through the real routes against real Postgres (ROADMAP Stage 2 item
// 18r; spec Part 3 §14.8). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: a receipt or the day's takings naming a
// way of paying the member did not use, so the gym's cash count is out; or UPI recorded by a
// gym abroad. That is the first test: a gym in India records UPI on a bill, a membership given
// as paid, a sale, and the refunds of each, and each reads back as UPI and nothing else; a gym
// in the US sending UPI to every one of those routes is refused, and nothing is written.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { UPI_ONLY_IN_INDIA, receiptSchema, sellPageResponseSchema, type GymMembershipTypesResponse, type HeldMembershipsResponse } from "@app/shared";
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
  JWT_SECRET: "upi-payments-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_upi_payments_routes";

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = {
  name: "Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 150000,
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
};

d("UPI as a payment method, for gyms in India (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'upi-t-%@example.com')`;
    await sql`DELETE FROM gym_sale_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'upi-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies) => send("POST", path, cookies, payload);
  const answer = (res: { statusCode: number; body: string }) => {
    const body = JSON.parse(res.body) as { error?: string; message?: string };
    return [res.statusCode, body.error ?? "ok", body.message ?? null];
  };
  const REFUSED = [400, "payment_method_not_offered", UPI_ONLY_IN_INDIA];

  const makeUser = async (local: string) => {
    const email = `upi-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Upi ${local}` }, {});
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode, login.body).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (cookies: Cookies, name: string, country: string, city: string, timezone: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city, country, timezone }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };
  const addType = async (gymId: string, cookies: Cookies): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, monthly, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === monthly.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `upi-p-${String(++keyCounter)}@example.com` }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const addProduct = async (gymId: string, cookies: Cookies): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/register/products`, { name: "Water bottle", priceMinor: 5000, taxRateId: null, stock: null }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = sellPageResponseSchema.parse(JSON.parse(res.body)).products.find((p) => p.name === "Water bottle");
    if (found === undefined) throw new Error("no product");
    return found.id;
  };
  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const held = (res: { body: string }) => JSON.parse(res.body) as HeldMembershipsResponse;
  const today = async (gymId: string, entryId: string, cookies: Cookies) => held(await get(heldUrl(gymId, entryId), cookies)).today;
  const firstBill = (page: HeldMembershipsResponse) => {
    const m = page.memberships[0];
    const bill = m?.billing?.bills[0];
    if (m === undefined || bill === undefined) throw new Error("no bill");
    return { id: m.id, bill };
  };
  const receiptMethod = async (gymId: string, number: number, cookies: Cookies) => {
    const res = await get(`/v1/orgs/${gymId}/receipts/${String(number)}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    const receipt = receiptSchema.parse(JSON.parse(res.body));
    return "method" in receipt ? receipt.method : null;
  };
  /** Every way of paying the gym's tables hold, read directly. */
  const methodsIn = async (gymId: string) => {
    const [payments, refunds, sales, saleRefunds] = await Promise.all([
      sql<{ method: string }[]>`SELECT method FROM gym_member_payments WHERE gym_id = ${gymId} ORDER BY seq`,
      sql<{ method: string }[]>`SELECT method FROM gym_member_refunds WHERE gym_id = ${gymId} ORDER BY created_at, id`,
      sql<{ method: string }[]>`SELECT method FROM gym_sales WHERE gym_id = ${gymId} ORDER BY seq`,
      sql<{ method: string }[]>`SELECT method FROM gym_sale_refunds WHERE gym_id = ${gymId} ORDER BY receipt_number`,
    ]);
    const of = (rows: { method: string }[]) => rows.map((r) => r.method);
    return { payments: of(payments), refunds: of(refunds), sales: of(sales), saleRefunds: of(saleRefunds) };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis: createMemoryRedis(),
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
    "a gym in India records UPI on a bill, a membership given as paid, a sale and their refunds, each read back as UPI; a gym in the US sending UPI anywhere is refused and nothing is written",
    async () => {
      const owner = await makeUser("in-owner");
      const gymId = await makeGym(owner.cookies, "Upi Mumbai Gym", "IN", "Mumbai", "Asia/Kolkata");
      const type = await addType(gymId, owner.cookies);
      const product = await addProduct(gymId, owner.cookies);
      const asha = await addPerson(gymId, owner.cookies, "Asha Rao");
      const ravi = await addPerson(gymId, owner.cookies, "Ravi Kumar");
      const day = await today(gymId, asha, owner.cookies);

      // A membership given as paid, by UPI.
      const given = await post(heldUrl(gymId, asha), { requestKey: nextKey(), typeId: type, startsOn: day, paid: true, method: "upi" }, owner.cookies);
      expect(given.statusCode, given.body).toBe(201);
      const paidFirst = firstBill(held(given)).bill.payments[0];
      expect(paidFirst).toMatchObject({ method: "upi", amountMinor: 150000 });

      // A bill paid later, by UPI.
      const owing = firstBill(held(await post(heldUrl(gymId, ravi), { requestKey: nextKey(), typeId: type, startsOn: day, paid: false }, owner.cookies)));
      const paid = await post(`${heldUrl(gymId, ravi)}/${owing.id}/payments`, { requestKey: nextKey(), periodIndex: 0, amountMinor: 150000, method: "upi" }, owner.cookies);
      expect(answer(paid)).toEqual([200, "ok", null]);
      const payment = firstBill(held(paid)).bill.payments[0];
      if (payment === undefined) throw new Error("no payment");
      expect(payment.method).toBe("upi");
      expect(await receiptMethod(gymId, payment.receiptNumber, owner.cookies)).toBe("upi");

      // Part of it given back by UPI.
      const back = await post(`${heldUrl(gymId, ravi)}/${owing.id}/payments/${payment.id}/refunds`, { requestKey: nextKey(), amountMinor: 50000, method: "upi", reason: "charged_too_much" }, owner.cookies);
      expect(answer(back)).toEqual([200, "ok", null]);

      // A sale by UPI, Sell's day line, and part of it given back by UPI.
      const sold = await post(`/v1/orgs/${gymId}/register/sales`, { requestKey: nextKey(), productId: product, quantity: 2, entryId: null, method: "upi", totalMinor: 10000 }, owner.cookies);
      expect(sold.statusCode, sold.body).toBe(201);
      const sale = JSON.parse(sold.body) as { saleId: string; receiptNumber: number; register: unknown };
      expect(await receiptMethod(gymId, sale.receiptNumber, owner.cookies)).toBe("upi");
      const totals = sellPageResponseSchema.parse(sale.register).totals;
      expect(totals).toMatchObject({ upi: 310000, cash: 0, card_at_desk: 0, bank_transfer: 0 });
      const saleBack = await post(`/v1/orgs/${gymId}/register/sales/${sale.saleId}/refunds`, { requestKey: nextKey(), amountMinor: 5000, method: "upi", reason: "returned", restock: 0 }, owner.cookies);
      expect(saleBack.statusCode, saleBack.body).toBe(201);

      expect(await methodsIn(gymId)).toEqual({ payments: ["upi", "upi"], refunds: ["upi"], sales: ["upi"], saleRefunds: ["upi"] });

      // The same in the US: every route refuses UPI, and nothing is written.
      const us = await makeUser("us-owner");
      const usGym = await makeGym(us.cookies, "Upi Austin Gym", "US", "Austin", "America/Chicago");
      const usType = await addType(usGym, us.cookies);
      const usProduct = await addProduct(usGym, us.cookies);
      const sam = await addPerson(usGym, us.cookies, "Sam Lee");
      const usDay = await today(usGym, sam, us.cookies);
      expect(answer(await post(heldUrl(usGym, sam), { requestKey: nextKey(), typeId: usType, startsOn: usDay, paid: true, method: "upi" }, us.cookies))).toEqual(REFUSED);
      expect((await sql`SELECT 1 FROM gym_held_memberships WHERE gym_id = ${usGym}`).length).toBe(0);
      const usOwing = firstBill(held(await post(heldUrl(usGym, sam), { requestKey: nextKey(), typeId: usType, startsOn: usDay, paid: false }, us.cookies)));
      expect(answer(await post(`${heldUrl(usGym, sam)}/${usOwing.id}/payments`, { requestKey: nextKey(), periodIndex: 0, amountMinor: 150000, method: "upi" }, us.cookies))).toEqual(REFUSED);
      expect(answer(await post(`/v1/orgs/${usGym}/register/sales`, { requestKey: nextKey(), productId: usProduct, quantity: 1, entryId: null, method: "upi", totalMinor: 5000 }, us.cookies))).toEqual(REFUSED);
      expect(await methodsIn(usGym)).toEqual({ payments: [], refunds: [], sales: [], saleRefunds: [] });

      // Paid by cash there, given back by UPI: refused, and nothing given back.
      const cash = await post(`${heldUrl(usGym, sam)}/${usOwing.id}/payments`, { requestKey: nextKey(), periodIndex: 0, amountMinor: 150000, method: "cash" }, us.cookies);
      expect(answer(cash)).toEqual([200, "ok", null]);
      const cashPayment = firstBill(held(cash)).bill.payments[0];
      if (cashPayment === undefined) throw new Error("no payment");
      expect(answer(await post(`${heldUrl(usGym, sam)}/${usOwing.id}/payments/${cashPayment.id}/refunds`, { requestKey: nextKey(), amountMinor: 1000, method: "upi", reason: "other" }, us.cookies))).toEqual(REFUSED);
      const cashSale = await post(`/v1/orgs/${usGym}/register/sales`, { requestKey: nextKey(), productId: usProduct, quantity: 1, entryId: null, method: "cash", totalMinor: 5000 }, us.cookies);
      expect(cashSale.statusCode, cashSale.body).toBe(201);
      const cashSaleId = (JSON.parse(cashSale.body) as { saleId: string }).saleId;
      expect(answer(await post(`/v1/orgs/${usGym}/register/sales/${cashSaleId}/refunds`, { requestKey: nextKey(), amountMinor: 1000, method: "upi", reason: "returned", restock: 0 }, us.cookies))).toEqual(REFUSED);
      expect(await methodsIn(usGym)).toEqual({ payments: ["cash"], refunds: [], sales: ["cash"], saleRefunds: [] });

      // A fee's payment and a change of membership paid by UPI ask before anything is read: refused
      // there, and past that check (to a fee or a change that does not exist) in India.
      const NO_FEE = "00000000-0000-4000-8000-ffffffffffff";
      const feePay = (gym: string, entry: string, membership: string, cookies: Cookies) =>
        post(`${heldUrl(gym, entry)}/${membership}/fees/${NO_FEE}/payments`, { requestKey: nextKey(), amountMinor: 1000, method: "upi" }, cookies);
      expect(answer(await feePay(usGym, sam, usOwing.id, us.cookies))).toEqual(REFUSED);
      expect((await feePay(gymId, ravi, owing.id, owner.cookies)).statusCode).toBe(404);
      const change = (gym: string, entry: string, membership: string, startsOn: string, cookies: Cookies) =>
        post(
          `${heldUrl(gym, entry)}/${membership}/change`,
          { requestKey: nextKey(), typeId: NO_FEE, when: "today", startsOn, priceMinor: 1000, creditMinor: 0, totalMinor: 1000, paid: true, method: "upi" },
          cookies,
        );
      expect(answer(await change(usGym, sam, usOwing.id, usDay, us.cookies))).toEqual(REFUSED);
      expect(answer(await change(gymId, ravi, owing.id, day, owner.cookies))[1]).not.toBe("payment_method_not_offered");
      expect(await methodsIn(usGym)).toEqual({ payments: ["cash"], refunds: [], sales: ["cash"], saleRefunds: [] });

      // The Indian gym's owner reaching into the US gym, or the other way round: refused.
      expect((await post(`${heldUrl(usGym, sam)}/${usOwing.id}/payments`, { requestKey: nextKey(), periodIndex: 1, amountMinor: 150000, method: "upi" }, owner.cookies)).statusCode).toBe(404);
      expect((await post(`/v1/orgs/${gymId}/register/sales`, { requestKey: nextKey(), productId: product, quantity: 1, entryId: null, method: "upi", totalMinor: 5000 }, us.cookies)).statusCode).toBe(404);
      expect(await methodsIn(usGym)).toEqual({ payments: ["cash"], refunds: [], sales: ["cash"], saleRefunds: [] });
      expect((await methodsIn(gymId)).sales).toEqual(["upi"]);
    },
    T,
  );
});
