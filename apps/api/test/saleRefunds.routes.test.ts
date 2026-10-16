// REFUND A SALE AT THE DESK, through the real routes against real Postgres (ROADMAP 18p;
// rulings/2026-10-16-18p.md). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: money noted back on the wrong sale, on
// another gym's sale, or more given back than was paid, so a gym's takings say it handed out
// money it never did. That is the first test: Priya refunds Maya's sale of yesterday; only that
// sale holds a refund, the day's refunds and the report move by exactly it, Ravi's sale and next
// door's are untouched and out of reach, and a refund of more than is left is refused.
//
// Every number is checked by reading the tables, not only the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  memberPurchasesResponseSchema,
  moneyReportResponseSchema,
  receiptSchema,
  refundSaleResponseSchema,
  sellPageResponseSchema,
  type GymProduct,
  type MoneyReport,
  type SellPageResponse,
} from "@app/shared";
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
  JWT_SECRET: "sale-refunds-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_sale_refunds";

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
/** A fresh request key, as the screen makes one a box. */
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("refund a sale at the desk (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // 12:00 in Chicago on 16 October 2026, and the same hour the day before.
  const NOON = new Date("2026-10-16T17:00:00Z");
  const YESTERDAY = new Date("2026-10-15T17:00:00Z");
  /** The server's clock: moved to sell yesterday, and put back. */
  let clock = NOON;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sr-t-%@example.com')`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'sr-t-%@example.com'`;
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
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const answer = (res: { statusCode: number; body: string }): [number, string] => [res.statusCode, (JSON.parse(res.body) as { error?: string }).error ?? "ok"];

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string, displayName: string): Promise<Person> => {
    const email = `sr-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName });
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
  /** A manager with the role's own ticks, which take payments. */
  const manager = async (gymId: string, who: Person) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, 'manager', ${null})`;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string, email: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const register = (gymId: string) => `/v1/orgs/${gymId}/register`;
  const page = (res: { body: string }): SellPageResponse => sellPageResponseSchema.parse(JSON.parse(res.body));
  const sellPage = async (gymId: string, cookies: Cookies, day?: string): Promise<SellPageResponse> => {
    const res = await get(`${register(gymId)}${day === undefined ? "" : `?day=${day}`}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return page(res);
  };
  const addProduct = async (gymId: string, cookies: Cookies, name: string, priceMinor: number, stock: number | null): Promise<GymProduct> => {
    const res = await post(`${register(gymId)}/products`, { name, priceMinor, taxRateId: null, stock }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product named ${name}`);
    return found;
  };
  /** One sale, on the day the clock says: its id. */
  const sell = async (gymId: string, cookies: Cookies, productId: string, quantity: number, totalMinor: number, entryId: string | null = null): Promise<string> => {
    const res = await post(`${register(gymId)}/sales`, { requestKey: nextForm(), productId, quantity, entryId, method: "cash", totalMinor }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { saleId: string }).saleId;
  };
  const yesterday = async <R>(work: () => Promise<R>): Promise<R> => {
    clock = YESTERDAY;
    try {
      return await work();
    } finally {
      clock = NOON;
    }
  };
  const refundsUrl = (gymId: string, saleId: string) => `${register(gymId)}/sales/${saleId}/refunds`;
  const refund = (gymId: string, saleId: string, cookies: Cookies, amountMinor: number, restock = 0, key = nextForm(), reason = "returned") =>
    post(refundsUrl(gymId, saleId), { requestKey: key, amountMinor, method: "cash", reason, restock }, cookies);
  const refundRows = (saleId: string) =>
    sql<{ amount_minor: number; restocked: number; voided: boolean; by: string | null; refunded_on: string }[]>`
      SELECT amount_minor, restocked, undone_at IS NOT NULL AS voided, recorded_by AS by, refunded_on::text AS refunded_on
      FROM gym_sale_refunds WHERE sale_id = ${saleId} ORDER BY receipt_number`;
  const stockOf = async (productId: string) => (await sql<{ stock: number | null }[]>`SELECT stock FROM gym_products WHERE id = ${productId}`)[0]?.stock;
  const money = async (gymId: string, cookies: Cookies): Promise<MoneyReport> => {
    const res = await get(`/v1/orgs/${gymId}/reports/money?period=4w`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return moneyReportResponseSchema.parse(JSON.parse(res.body)).report;
  };
  const collected = (report: MoneyReport) => (report.state === "ok" ? { sold: report.inPeriod.soldMinor, refunded: report.inPeriod.refundedMinor, net: report.inPeriod.netMinor } : null);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
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
    "money goes back only on the sale it was noted for: Maya's sale of yesterday holds the refund, the day and the report move by exactly it, Ravi's and next door's are untouched and out of reach, and more than is left is refused",
    async () => {
      const owner = await makeUser("worst-owner", "Sam Owner");
      const priya = await makeUser("worst-priya", "Priya Desk");
      const nextDoor = await makeUser("worst-nextdoor", "Nora Next");
      const gymId = await makeGym(owner, "Sr Worst Gym");
      const theirGym = await makeGym(nextDoor, "Sr Next Door");
      await manager(gymId, priya);

      const tub = await addProduct(gymId, owner.cookies, "Protein tub", 4000, null);
      const theirTub = await addProduct(theirGym, nextDoor.cookies, "Protein tub", 4000, null);
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", "sr-p-maya@example.com");
      const ravi = await addPerson(gymId, owner.cookies, "Ravi Kumar", "sr-p-ravi@example.com");
      const [mayaSale, raviSale, ninaSale] = await yesterday(async () => [
        await sell(gymId, owner.cookies, tub.id, 2, 8000, maya),
        await sell(gymId, owner.cookies, tub.id, 1, 4000, ravi),
        await sell(theirGym, nextDoor.cookies, theirTub.id, 1, 4000),
      ]);
      const reportBefore = collected(await money(gymId, owner.cookies));
      expect(reportBefore).toEqual({ sold: 12000, refunded: 0, net: 12000 });

      // Yesterday's sales are found by picking the day; today's list does not hold them.
      expect((await sellPage(gymId, owner.cookies)).sales).toEqual([]);
      const before = await sellPage(gymId, owner.cookies, "2026-10-15");
      expect(before.day).toBe("2026-10-15");
      expect(before.today).toBe("2026-10-16");
      expect(before.sales.map((s) => [s.id, s.canRefund, s.canUndo])).toEqual([
        [raviSale, true, false],
        [mayaSale, true, false],
      ]);

      // Next door cannot refund Maya's sale, through their gym or ours; Nina's sale cannot be
      // refunded through ours.
      expect(answer(await refund(theirGym, mayaSale, nextDoor.cookies, 4000))[0]).toBe(404);
      expect(answer(await refund(gymId, mayaSale, nextDoor.cookies, 4000))[0]).toBe(404);
      expect(answer(await refund(gymId, ninaSale, owner.cookies, 4000))[0]).toBe(404);
      for (const id of [mayaSale, raviSale, ninaSale]) expect(await refundRows(id)).toEqual([]);

      // Priya gives Maya back one tub's money.
      const res = await refund(gymId, mayaSale, priya.cookies, 4000, 0);
      expect(res.statusCode, res.body).toBe(201);
      const { receiptNumber } = refundSaleResponseSchema.parse(JSON.parse(res.body));
      expect(await refundRows(mayaSale)).toEqual([{ amount_minor: 4000, restocked: 0, voided: false, by: priya.userId, refunded_on: "2026-10-16" }]);
      for (const id of [raviSale, ninaSale]) expect(await refundRows(id)).toEqual([]);

      // Yesterday's list: the sale stands, with its refund under it.
      const after = await sellPage(gymId, owner.cookies, "2026-10-15");
      const shown = after.sales.find((s) => s.id === mayaSale);
      expect(shown).toMatchObject({ undone: false, totalMinor: 8000, refundedMinor: 4000, canRefund: true, canUndo: false, stockCounted: false });
      expect(shown?.refunds).toEqual([
        { id: expect.any(String) as string, amountMinor: 4000, method: "cash", reason: "returned", restocked: 0, refundedOn: "2026-10-16", by: "Priya Desk", receiptNumber, voided: null },
      ]);
      expect(after.sales.find((s) => s.id === raviSale)).toMatchObject({ refundedMinor: 0, refunds: [] });
      // Yesterday's takings stay what was taken; the refund is said on the day it went back.
      expect(after.totals).toMatchObject({ count: 2, totalMinor: 12000, refundedMinor: 0 });
      expect((await sellPage(gymId, owner.cookies)).totals).toMatchObject({ count: 0, totalMinor: 0, refundedMinor: 4000 });
      expect((await sellPage(theirGym, nextDoor.cookies)).totals.refundedMinor).toBe(0);

      // The report: Collected less exactly that refund; next door's untouched.
      expect(collected(await money(gymId, owner.cookies))).toEqual({ sold: 12000, refunded: 4000, net: 8000 });
      expect(collected(await money(theirGym, nextDoor.cookies))).toEqual({ sold: 4000, refunded: 0, net: 4000 });

      // More than is left is refused, and nothing is written.
      const tooMuch = await refund(gymId, mayaSale, priya.cookies, 4001);
      expect(answer(tooMuch)).toEqual([409, "refund_too_much"]);
      expect((JSON.parse(tooMuch.body) as { message: string }).message).toBe("Only $40.00 of that sale is left to refund. Nothing was noted.");
      expect(await refundRows(mayaSale)).toHaveLength(1);

      // Maya's page lists the same sale with its refund.
      const bought = memberPurchasesResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gymId}/member-list/entries/${maya}/purchases`, owner.cookies)).body));
      expect(bought.sales.map((s) => [s.id, s.refundedMinor, s.refunds.length])).toEqual([[mayaSale, 4000, 1]]);
    },
    T,
  );

  it(
    "part by part: never more back than the sale took nor more on the shelf than it sold; the same press twice is one refund; Void sale waits while a refund stands",
    async () => {
      const owner = await makeUser("parts-owner", "Sam Owner");
      const gymId = await makeGym(owner, "Sr Parts Gym");
      const water = await addProduct(gymId, owner.cookies, "Water", 250, 10);
      const sale = await sell(gymId, owner.cookies, water.id, 3, 750);
      expect(await stockOf(water.id)).toBe(7);

      // Today's own sale: Refund sale and Void sale are both offered until a refund stands.
      expect((await sellPage(gymId, owner.cookies)).sales[0]).toMatchObject({ canRefund: true, canUndo: true, stockCounted: true });

      // One bottle brought back, onto the shelf. The same press again is the same refund.
      const key = nextForm();
      const first = await refund(gymId, sale, owner.cookies, 250, 1, key);
      expect(first.statusCode, first.body).toBe(201);
      const again = await refund(gymId, sale, owner.cookies, 250, 1, key);
      expect(again.statusCode, again.body).toBe(201);
      expect(JSON.parse(again.body)).toEqual(JSON.parse(first.body));
      expect(await refundRows(sale)).toHaveLength(1);
      expect(await stockOf(water.id)).toBe(8);
      // The same key with another amount is not the same press.
      expect(answer(await refund(gymId, sale, owner.cookies, 500, 1, key))).toEqual([409, "request_reused"]);

      expect((await sellPage(gymId, owner.cookies)).sales[0]).toMatchObject({ canRefund: true, canUndo: false, refundedMinor: 250 });
      const voidSale = await post(`${register(gymId)}/sales/${sale}/void`, { reason: "mistake" }, owner.cookies);
      expect(answer(voidSale)).toEqual([409, "sale_has_refund"]);

      // Three more on the shelf of the two left: refused, nothing moved.
      const tooMany = await refund(gymId, sale, owner.cookies, 500, 3);
      expect(answer(tooMany)).toEqual([409, "restock_too_many"]);
      expect((JSON.parse(tooMany.body) as { message: string }).message).toBe("Only 2 can go back on the shelf for this sale. Nothing was noted.");
      expect(await stockOf(water.id)).toBe(8);

      // The rest of the money, both bottles back: all of it is given back.
      expect((await refund(gymId, sale, owner.cookies, 500, 2)).statusCode).toBe(201);
      expect(await stockOf(water.id)).toBe(10);
      expect((await sellPage(gymId, owner.cookies)).sales[0]).toMatchObject({ canRefund: false, refundedMinor: 750 });
      const nothingLeft = await refund(gymId, sale, owner.cookies, 1, 0);
      expect(answer(nothingLeft)).toEqual([409, "refund_too_much"]);
      expect((JSON.parse(nothingLeft.body) as { message: string }).message).toBe("All of that sale has already been refunded.");

      // The last refund voided: its money counts again, its bottles come off the shelf again.
      const rows = await sql<{ id: string }[]>`SELECT id FROM gym_sale_refunds WHERE sale_id = ${sale} ORDER BY receipt_number DESC LIMIT 1`;
      const last = rows[0];
      if (last === undefined) throw new Error("no refund");
      const voided = await post(`${refundsUrl(gymId, sale)}/${last.id}/void`, { reason: "wrong_amount" }, owner.cookies);
      expect(voided.statusCode, voided.body).toBe(200);
      expect(JSON.parse(voided.body)).toEqual({ voided: true });
      expect(await stockOf(water.id)).toBe(8);
      const shown = (await sellPage(gymId, owner.cookies)).sales[0];
      expect(shown).toMatchObject({ canRefund: true, refundedMinor: 250 });
      expect(shown?.refunds.map((r) => r.voided)).toEqual([null, { reason: "wrong_amount", on: "2026-10-16", by: "Sam Owner" }]);
      // Voided twice is voided once.
      expect((await post(`${refundsUrl(gymId, sale)}/${last.id}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
      expect(await stockOf(water.id)).toBe(8);
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.sale_refund_undone'`).toHaveLength(1);

      // A voided sale has nothing to give back.
      const other = await sell(gymId, owner.cookies, water.id, 1, 250);
      expect((await post(`${register(gymId)}/sales/${other}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
      expect(answer(await refund(gymId, other, owner.cookies, 250))).toEqual([409, "sale_voided"]);
    },
    T,
  );

  it(
    "two members of staff giving all of a sale back at one instant: one refund is noted, the other refused, and the shelf moves once",
    async () => {
      const owner = await makeUser("race-owner", "Sam Owner");
      const priya = await makeUser("race-priya", "Priya Desk");
      const gymId = await makeGym(owner, "Sr Race Gym");
      await manager(gymId, priya);
      const water = await addProduct(gymId, owner.cookies, "Water", 250, 10);
      const sale = await yesterday(() => sell(gymId, owner.cookies, water.id, 2, 500));
      const both = await Promise.all([refund(gymId, sale, owner.cookies, 500, 2), refund(gymId, sale, priya.cookies, 500, 2)]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(await refundRows(sale)).toHaveLength(1);
      expect(await stockOf(water.id)).toBe(10);
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.sale_refund_noted'`).toHaveLength(1);
    },
    T,
  );

  it(
    "its receipt: the refund has its own number and names the sale's; the sale's receipt names its refunds; a voided refund reads voided",
    async () => {
      const owner = await makeUser("receipt-owner", "Sam Owner");
      const gymId = await makeGym(owner, "Sr Receipt Gym");
      const tub = await addProduct(gymId, owner.cookies, "Protein tub", 4000, null);
      const ana = await addPerson(gymId, owner.cookies, "Ana Silva", "sr-p-ana@example.com");
      const sale = await yesterday(() => sell(gymId, owner.cookies, tub.id, 1, 4000, ana));
      const saleNumber = (await sellPage(gymId, owner.cookies, "2026-10-15")).sales[0]?.receiptNumber;
      const res = await refund(gymId, sale, owner.cookies, 1500, 0, nextForm(), "charged_too_much");
      const { receiptNumber } = refundSaleResponseSchema.parse(JSON.parse(res.body));
      const receipt = async (n: number) => receiptSchema.parse(JSON.parse((await get(`/v1/orgs/${gymId}/receipts/${String(n)}`, owner.cookies)).body));
      expect(await receipt(receiptNumber)).toMatchObject({
        kind: "refund",
        number: receiptNumber,
        on: "2026-10-16",
        person: "Ana Silva",
        by: "Sam Owner",
        cancelled: false,
        forReceipt: saleNumber,
        item: { name: "Protein tub", covers: null },
        refundedMinor: 1500,
        method: "cash",
      });
      expect(await receipt(saleNumber ?? 0)).toMatchObject({ kind: "sale", cancelled: false, refunds: [{ number: receiptNumber, on: "2026-10-16", amountMinor: 1500 }] });

      const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_sale_refunds WHERE sale_id = ${sale}`;
      if (row === undefined) throw new Error("no refund");
      expect((await post(`${refundsUrl(gymId, sale)}/${row.id}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
      expect(await receipt(receiptNumber)).toMatchObject({ kind: "refund", cancelled: true });
      expect(await receipt(saleNumber ?? 0)).toMatchObject({ kind: "sale", refunds: [] });
    },
    T,
  );

  it(
    "asked wrongly: a bad body or reason is 400, a day not come is refused, a refund of another sale's refund is 404, and staff who only change prices may not refund",
    async () => {
      const owner = await makeUser("asks-owner", "Sam Owner");
      const pricer = await makeUser("asks-pricer", "Pat Prices");
      const gymId = await makeGym(owner, "Sr Asks Gym");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${pricer.userId}, 'trainer', ${["memberships.manage"]})`;
      const water = await addProduct(gymId, owner.cookies, "Water", 250, null);
      const a = await sell(gymId, owner.cookies, water.id, 1, 250);
      const b = await sell(gymId, owner.cookies, water.id, 1, 250);
      for (const body of [
        {},
        { requestKey: nextForm(), amountMinor: 0, method: "cash", reason: "returned", restock: 0 },
        { requestKey: nextForm(), amountMinor: 100, method: "cash", reason: "changed their mind", restock: 0 },
        { requestKey: nextForm(), amountMinor: 100, method: "company", reason: "returned", restock: 0 },
        { requestKey: nextForm(), amountMinor: 100, method: "cash", reason: "returned", restock: 0, saleId: b },
      ]) {
        expect(answer(await post(refundsUrl(gymId, a), body, owner.cookies))[0]).toBe(400);
      }
      expect(answer(await post(refundsUrl(gymId, "not-a-sale"), { requestKey: nextForm(), amountMinor: 100, method: "cash", reason: "returned", restock: 0 }, owner.cookies))[0]).toBe(400);
      expect(answer(await refund(gymId, a, pricer.cookies, 100))[0]).toBe(403);
      expect(answer(await refund(gymId, a, {}, 100))[0]).toBe(401);
      expect(await refundRows(a)).toEqual([]);

      // A's refund cannot be voided through B, and a typed reason is refused.
      expect((await refund(gymId, a, owner.cookies, 100)).statusCode).toBe(201);
      const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_sale_refunds WHERE sale_id = ${a}`;
      if (row === undefined) throw new Error("no refund");
      expect(answer(await post(`${refundsUrl(gymId, b)}/${row.id}/void`, { reason: "mistake" }, owner.cookies))).toEqual([404, "refund_not_found"]);
      expect(answer(await post(`${refundsUrl(gymId, a)}/${row.id}/void`, { reason: "oops" }, owner.cookies))[0]).toBe(400);
      expect(answer(await post(`${refundsUrl(gymId, a)}/${row.id}/void`, { reason: "mistake" }, pricer.cookies))[0]).toBe(403);
      expect((await refundRows(a))[0]?.voided).toBe(false);

      // The day picked: not one to come, and only a day.
      expect(answer(await get(`${register(gymId)}?day=2026-10-17`, owner.cookies))).toEqual([409, "day_ahead"]);
      expect(answer(await get(`${register(gymId)}?day=yesterday`, owner.cookies))[0]).toBe(400);
      expect(answer(await get(`${register(gymId)}?day=2026-10-15&extra=1`, owner.cookies))[0]).toBe(400);
      // Staff who only change prices are sent no sale, on any day.
      expect((await sellPage(gymId, pricer.cookies, "2026-10-16")).sales).toEqual([]);

      // The database holds a reason only from its list, and a void reason only on a voided row.
      await expect(sql`UPDATE gym_sale_refunds SET reason = 'oops' WHERE id = ${row.id}`).rejects.toThrow(/reason_check/);
      await expect(sql`UPDATE gym_sale_refunds SET void_reason = 'mistake' WHERE id = ${row.id}`).rejects.toThrow(/void_reason_check/);
    },
    T,
  );
});
