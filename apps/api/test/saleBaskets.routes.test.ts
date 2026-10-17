// A BASKET AT SELL, through the real routes against real Postgres (ROADMAP 18q;
// rulings/2026-10-16-18p.md). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: Maya buys a protein bar and two waters,
// and her receipt, the day's takings or a refund shows a total or a product that is not what
// she paid for, or another gym's sale. That is the first test: her one receipt holds exactly
// her two products and their total worked out by hand, the day counts her sale once, Ravi's
// sale and next door's stay their own and out of reach, and a refund of her water can never
// give back more than the water took.
//
// Every number is worked out by hand from the prices, and checked against the tables as well
// as the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  memberPurchasesResponseSchema,
  paymentsDownloadSummarySchema,
  receiptSchema,
  saleBaskets,
  sellPageResponseSchema,
  sellProductResponseSchema,
  type GymDiscount,
  type GymProduct,
  type SellPageResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { linesPage } from "../src/modules/orgs/paymentsDownload/repo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "sale-baskets-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_sale_baskets";

let ipCounter = 0;
const nextIp = () => `10.96.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
/** A fresh request key, as the screen makes one a sale. */
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

interface Line {
  productId: string;
  quantity: number;
  totalMinor: number;
  discountId?: string | null;
}

d("a basket at Sell (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // 12:00 in Chicago on 17 October 2026.
  const NOON = new Date("2026-10-17T17:00:00Z");
  const TODAY = "2026-10-17";
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sb-t-%@example.com')`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_discounts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'sb-t-%@example.com'`;
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
    const email = `sb-t-${local}@example.com`;
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
  const sellPage = async (gymId: string, cookies: Cookies): Promise<SellPageResponse> => {
    const res = await get(register(gymId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return page(res);
  };
  const addRate = async (gymId: string, cookies: Cookies, name: string, bp: number): Promise<string> => {
    const res = await post(`${register(gymId)}/tax-rates`, { name, bp }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).tax.rates.find((r) => r.name === name);
    if (found === undefined) throw new Error(`no rate named ${name}`);
    return found.id;
  };
  const addProduct = async (gymId: string, cookies: Cookies, name: string, priceMinor: number, stock: number | null, taxRateId: string | null = null): Promise<GymProduct> => {
    const res = await post(`${register(gymId)}/products`, { name, priceMinor, taxRateId, stock }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product named ${name}`);
    return found;
  };
  const addDiscount = async (gymId: string, cookies: Cookies, name: string, over: Record<string, unknown> = {}): Promise<GymDiscount> => {
    const form = {
      name,
      code: null,
      kind: "percent",
      percentBp: 1000,
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
    };
    const res = await post(`${register(gymId)}/discounts`, form, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).discounts.find((x) => x.name === name);
    if (found === undefined) throw new Error(`no discount named ${name}`);
    return found;
  };
  const basket = (lines: Line[], entryId: string | null = null, key = nextForm()) => ({
    requestKey: key,
    entryId,
    method: "cash",
    totalMinor: lines.reduce((n, l) => n + l.totalMinor, 0),
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, totalMinor: l.totalMinor, discountId: l.discountId ?? null })),
  });
  const sell = (gymId: string, cookies: Cookies, body: unknown) => post(`${register(gymId)}/sales`, body, cookies);
  const sold = async (gymId: string, cookies: Cookies, body: unknown): Promise<{ saleId: string; receiptNumber: number }> => {
    const res = await sell(gymId, cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    const parsed = sellProductResponseSchema.parse(JSON.parse(res.body));
    return { saleId: parsed.saleId, receiptNumber: parsed.receiptNumber };
  };
  const rowsOf = (gymId: string) =>
    sql<{ id: string; item_name: string; quantity: number; total_minor: number; tax_minor: number; receipt_number: number; line_no: number; entry_id: string | null; undone: boolean }[]>`
      SELECT id, item_name, quantity, total_minor, tax_minor, receipt_number, line_no, entry_id, undone_at IS NOT NULL AS undone
      FROM gym_sales WHERE gym_id = ${gymId} ORDER BY receipt_number, line_no`;
  const stockOf = async (productId: string) => (await sql<{ stock: number | null }[]>`SELECT stock FROM gym_products WHERE id = ${productId}`)[0]?.stock;
  const usesOf = async (discountId: string) => (await sql<{ uses: number }[]>`SELECT uses FROM gym_discounts WHERE id = ${discountId}`)[0]?.uses;
  const receiptsIssued = async (gymId: string) => (await sql<{ n: number }[]>`SELECT receipts_issued AS n FROM gyms WHERE id = ${gymId}`)[0]?.n;
  const receipt = async (gymId: string, number: number, cookies: Cookies) => {
    const res = await get(`/v1/orgs/${gymId}/receipts/${String(number)}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return receiptSchema.parse(JSON.parse(res.body));
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      orgs: { now: () => NOON },
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
    "Maya's protein bar and two waters are one sale: one receipt with exactly her two products and the total worked out by hand, counted once, her refund of a water capped at the water, and Ravi's and next door's sales untouched and out of reach",
    async () => {
      const owner = await makeUser("worst-owner", "Sam Owner");
      const priya = await makeUser("worst-priya", "Priya Desk");
      const nextDoor = await makeUser("worst-nextdoor", "Nora Next");
      const gymId = await makeGym(owner, "Sb Worst Gym");
      const theirGym = await makeGym(nextDoor, "Sb Next Door");
      await manager(gymId, priya);
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", "sb-maya@gmail.com");
      const ravi = await addPerson(gymId, owner.cookies, "Ravi Kumar", "sb-ravi@gmail.com");
      // Sales tax 8.25%, added on top in the United States.
      const salesTax = await addRate(gymId, owner.cookies, "Sales tax", 825);
      const bar = await addProduct(gymId, owner.cookies, "Protein bar", 250, 10, salesTax);
      const water = await addProduct(gymId, owner.cookies, "Water", 199, 20);
      const towel = await addProduct(gymId, owner.cookies, "Towel", 500, 3);
      const theirWater = await addProduct(theirGym, nextDoor.cookies, "Water", 100, null);

      // By hand: $2.50 + 8.25% = $2.50 + $0.20625, rounded to $0.21 = $2.71; 2 × $1.99 = $3.98.
      // Maya pays $6.69.
      const mine = await sold(gymId, priya.cookies, basket([{ productId: bar.id, quantity: 1, totalMinor: 271 }, { productId: water.id, quantity: 2, totalMinor: 398 }], maya));
      const raviSale = await sold(gymId, priya.cookies, basket([{ productId: towel.id, quantity: 1, totalMinor: 500 }], ravi));
      const theirs = await sold(theirGym, nextDoor.cookies, basket([{ productId: theirWater.id, quantity: 1, totalMinor: 100 }]));

      // The tables: Maya's two lines share one receipt, numbered 1 and 2; Ravi's is a sale of its own.
      const rows = await rowsOf(gymId);
      expect(rows.map((r) => [r.item_name, r.quantity, r.total_minor, r.tax_minor, r.receipt_number, r.line_no, r.entry_id])).toEqual([
        ["Protein bar", 1, 271, 21, mine.receiptNumber, 1, maya],
        ["Water", 2, 398, 0, mine.receiptNumber, 2, maya],
        ["Towel", 1, 500, 0, raviSale.receiptNumber, 1, ravi],
      ]);
      expect(raviSale.receiptNumber).not.toBe(mine.receiptNumber);
      expect(await stockOf(bar.id)).toBe(9);
      expect(await stockOf(water.id)).toBe(18);

      // Her receipt: exactly her two products, and $6.69 paid in cash.
      const hers = await receipt(gymId, mine.receiptNumber, owner.cookies);
      if (hers.kind !== "sale") throw new Error("not a sale's receipt");
      expect(hers.person).toBe("Maya Patel");
      expect(hers.lines.map((l) => [l.name, l.quantity, l.unitPriceMinor, l.amounts.listedMinor, l.amounts.tax?.minor ?? 0, l.amounts.totalMinor])).toEqual([
        ["Protein bar", 1, 250, 250, 21, 271],
        ["Water", 2, 199, 398, 0, 398],
      ]);
      expect([hers.totalMinor, hers.method]).toEqual([669, "cash"]);

      // The day: two sales, not three; $11.69 taken; her sale is one basket of two lines.
      const day = await sellPage(gymId, owner.cookies);
      expect([day.totals.count, day.totals.totalMinor, day.totals.taxMinor, day.totals.cash, day.salesNotShown]).toEqual([2, 1169, 21, 1169, 0]);
      const baskets = saleBaskets(day.sales);
      expect(baskets.map((b) => [b.receiptNumber, b.lines.map((l) => l.itemName), b.totalMinor, b.first.person?.name])).toEqual([
        [raviSale.receiptNumber, ["Towel"], 500, "Ravi Kumar"],
        [mine.receiptNumber, ["Protein bar", "Water"], 669, "Maya Patel"],
      ]);
      // Her page: her two products, as one sale; Ravi's: only his towel.
      const bought = async (entryId: string) => {
        const res = await get(`/v1/orgs/${gymId}/member-list/entries/${entryId}/purchases`, owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return memberPurchasesResponseSchema.parse(JSON.parse(res.body));
      };
      const mayaBought = await bought(maya);
      expect([mayaBought.sales.map((s) => s.itemName), mayaBought.notShown]).toEqual([["Protein bar", "Water"], 0]);
      expect((await bought(ravi)).sales.map((s) => s.itemName)).toEqual(["Towel"]);

      // Next door: their page has their sale only; ours is out of their reach, and theirs out of ours.
      const theirDay = await sellPage(theirGym, nextDoor.cookies);
      expect(theirDay.sales.map((s) => [s.itemName, s.totalMinor])).toEqual([["Water", 100]]);
      expect((await get(`/v1/orgs/${gymId}/receipts/${String(mine.receiptNumber)}`, nextDoor.cookies)).statusCode).toBe(404);
      const theirReceipt = await receipt(theirGym, theirs.receiptNumber, nextDoor.cookies);
      expect(theirReceipt.kind === "sale" ? theirReceipt.lines.map((l) => l.name) : null).toEqual(["Water"]);
      const waterLine = rows[1];
      if (waterLine === undefined) throw new Error("no water line");
      expect(answer(await post(`${register(theirGym)}/sales/${waterLine.id}/refunds`, { requestKey: nextForm(), amountMinor: 100, method: "cash", reason: "returned", restock: 0 }, nextDoor.cookies))).toEqual([404, "sale_not_found"]);
      expect(answer(await post(`${register(theirGym)}/sales/${waterLine.id}/void`, { reason: "mistake" }, nextDoor.cookies))[0]).toBe(404);
      expect((await post(`${register(gymId)}/sales/${waterLine.id}/void`, { reason: "mistake" }, nextDoor.cookies)).statusCode).toBe(404);

      // A water brought back: it goes back on the water, never more than the water's $3.98,
      // though the sale took $6.69.
      const refund = (amountMinor: number) =>
        post(`${register(gymId)}/sales/${waterLine.id}/refunds`, { requestKey: nextForm(), amountMinor, method: "cash", reason: "returned", restock: 0 }, priya.cookies);
      expect(answer(await refund(400))).toEqual([409, "refund_too_much"]);
      expect(answer(await refund(199))).toEqual([201, "ok"]);
      expect(answer(await refund(200))).toEqual([409, "refund_too_much"]);
      const refunds = await sql<{ sale_id: string; amount_minor: number }[]>`SELECT sale_id, amount_minor FROM gym_sale_refunds WHERE gym_id IN (${gymId}, ${theirGym})`;
      expect(refunds).toEqual([{ sale_id: waterLine.id, amount_minor: 199 }]);
      const after = await sellPage(gymId, owner.cookies);
      expect([after.totals.count, after.totals.totalMinor, after.totals.refundedMinor]).toEqual([2, 1169, 199]);
      // Her receipt names the water given back; the protein bar can still be refunded, the
      // sale no longer voided while a refund stands.
      const again = await receipt(gymId, mine.receiptNumber, owner.cookies);
      expect(again.kind === "sale" ? again.refunds.map((r) => [r.amountMinor, r.item]) : null).toEqual([[199, "Water"]]);
      const lines = after.sales.filter((s) => s.receiptNumber === mine.receiptNumber);
      expect(lines.map((s) => [s.itemName, s.refundedMinor, s.canRefund, s.canUndo])).toEqual([
        ["Protein bar", 0, true, false],
        ["Water", 199, true, false],
      ]);
      expect(answer(await post(`${register(gymId)}/sales/${mine.saleId}/void`, { reason: "mistake" }, priya.cookies))).toEqual([409, "sale_has_refund"]);
      // Next door's sale is as it was.
      expect((await rowsOf(theirGym)).map((r) => [r.item_name, r.total_minor, r.undone])).toEqual([["Water", 100, false]]);
    },
    T,
  );

  it(
    "one line refused refuses the whole sale: out of stock, a price changed, a total that is not its lines, a product twice, too many lines, a person not on the list; nothing is sold, no stock moves and no receipt number is spent",
    async () => {
      const owner = await makeUser("refused-owner", "Sam Owner");
      const gymId = await makeGym(owner, "Sb Refused Gym");
      const other = await makeUser("refused-other", "Nora Next");
      const theirGym = await makeGym(other, "Sb Refused Next Door");
      const stranger = await addPerson(theirGym, other.cookies, "Zoe Other", "sb-zoe@gmail.com");
      const water = await addProduct(gymId, owner.cookies, "Water", 199, 20);
      const towel = await addProduct(gymId, owner.cookies, "Towel", 500, 1);
      const before = { issued: await receiptsIssued(gymId), water: await stockOf(water.id), towel: await stockOf(towel.id) };
      const w = { productId: water.id, quantity: 1, totalMinor: 199 };

      expect(answer(await sell(gymId, owner.cookies, basket([w, { productId: towel.id, quantity: 2, totalMinor: 1000 }])))).toEqual([409, "out_of_stock"]);
      expect(answer(await sell(gymId, owner.cookies, basket([w, { productId: towel.id, quantity: 1, totalMinor: 499 }])))).toEqual([409, "sale_price_changed"]);
      expect(answer(await sell(gymId, owner.cookies, { ...basket([w, { productId: towel.id, quantity: 1, totalMinor: 500 }]), totalMinor: 600 }))[0]).toBe(400);
      expect(answer(await sell(gymId, owner.cookies, basket([w, w])))[0]).toBe(400);
      const many = Array.from({ length: 21 }, () => w);
      expect(answer(await sell(gymId, owner.cookies, basket(many)))[0]).toBe(400);
      expect(answer(await sell(gymId, owner.cookies, basket([w], "00000000-0000-4000-8000-00000000dead")))).toEqual([404, "entry_not_found"]);
      expect(answer(await sell(gymId, owner.cookies, basket([w], stranger)))).toEqual([404, "entry_not_found"]);

      expect(await rowsOf(gymId)).toEqual([]);
      expect({ issued: await receiptsIssued(gymId), water: await stockOf(water.id), towel: await stockOf(towel.id) }).toEqual(before);
      // And then the same two, right, are one sale.
      const ok = await sold(gymId, owner.cookies, basket([w, { productId: towel.id, quantity: 1, totalMinor: 500 }]));
      expect((await rowsOf(gymId)).map((r) => [r.item_name, r.receipt_number, r.line_no])).toEqual([
        ["Water", ok.receiptNumber, 1],
        ["Towel", ok.receiptNumber, 2],
      ]);
    },
    T,
  );

  it(
    "the same press twice is one sale, at once too; the same key for another basket is refused; two desks selling the last towel at one instant sell it once",
    async () => {
      const owner = await makeUser("twice-owner", "Sam Owner");
      const desk = await makeUser("twice-desk", "Dee Desk");
      const gymId = await makeGym(owner, "Sb Twice Gym");
      await manager(gymId, desk);
      const water = await addProduct(gymId, owner.cookies, "Water", 199, null);
      const towel = await addProduct(gymId, owner.cookies, "Towel", 500, 1);
      const body = basket([
        { productId: water.id, quantity: 2, totalMinor: 398 },
        { productId: towel.id, quantity: 1, totalMinor: 500 },
      ]);
      const presses = await Promise.all([0, 1, 2].map(() => sell(gymId, owner.cookies, body)));
      expect(presses.map((r) => r.statusCode)).toEqual([201, 201, 201]);
      const ids = new Set(presses.map((r) => sellProductResponseSchema.parse(JSON.parse(r.body)).receiptNumber));
      expect(ids.size).toBe(1);
      expect((await rowsOf(gymId)).length).toBe(2);
      expect(await stockOf(towel.id)).toBe(0);
      // The same key with one line fewer is another basket: refused, nothing added.
      expect(answer(await sell(gymId, owner.cookies, { ...body, totalMinor: 398, lines: body.lines.slice(0, 1) }))).toEqual([409, "request_reused"]);
      expect((await rowsOf(gymId)).length).toBe(2);

      // One more towel on the shelf, and two desks ring it up with a water at one instant.
      await sql`UPDATE gym_products SET stock = 1 WHERE id = ${towel.id}`;
      const race = await Promise.all(
        [owner, desk].map((who) =>
          sell(
            gymId,
            who.cookies,
            basket([
              { productId: water.id, quantity: 1, totalMinor: 199 },
              { productId: towel.id, quantity: 1, totalMinor: 500 },
            ]),
          ),
        ),
      );
      expect(race.map((r) => answer(r)).sort()).toEqual([
        [201, "ok"],
        [409, "out_of_stock"],
      ]);
      expect(await stockOf(towel.id)).toBe(0);
      // Two sales in all, each whole: no water sold without its towel.
      expect((await rowsOf(gymId)).map((r) => r.item_name)).toEqual(["Water", "Towel", "Water", "Towel"]);
    },
    T,
  );

  it(
    "Void sale voids every line of it from any line: each back on its shelf, out of the day's total, one use of its discount given back; voided twice is voided once",
    async () => {
      const owner = await makeUser("void-owner", "Sam Owner");
      const gymId = await makeGym(owner, "Sb Void Gym");
      const water = await addProduct(gymId, owner.cookies, "Water", 200, 10);
      const bar = await addProduct(gymId, owner.cookies, "Protein bar", 300, 10);
      const tenOff = await addDiscount(gymId, owner.cookies, "Ten off");
      // 10% off each: $2.00 - $0.20 = $1.80; $3.00 × 2 = $6.00 - $0.60 = $5.40.
      const made = await sold(
        gymId,
        owner.cookies,
        basket([
          { productId: water.id, quantity: 1, totalMinor: 180, discountId: tenOff.id },
          { productId: bar.id, quantity: 2, totalMinor: 540, discountId: tenOff.id },
        ]),
      );
      // One sale with the discount on two of its products is one use of it.
      expect(await usesOf(tenOff.id)).toBe(1);
      const day = await sellPage(gymId, owner.cookies);
      expect([day.totals.count, day.totals.totalMinor, day.totals.discountMinor]).toEqual([1, 720, 80]);
      const second = (await rowsOf(gymId))[1];
      if (second === undefined) throw new Error("no second line");

      const voids = await Promise.all([0, 1].map(() => post(`${register(gymId)}/sales/${second.id}/void`, { reason: "mistake" }, owner.cookies)));
      expect(voids.map((r) => r.statusCode)).toEqual([200, 200]);
      expect((await rowsOf(gymId)).map((r) => [r.item_name, r.undone])).toEqual([
        ["Water", true],
        ["Protein bar", true],
      ]);
      expect([await stockOf(water.id), await stockOf(bar.id), await usesOf(tenOff.id)]).toEqual([10, 10, 0]);
      const after = await sellPage(gymId, owner.cookies);
      expect([after.totals.count, after.totals.totalMinor]).toEqual([0, 0]);
      const voidedReceipt = await receipt(gymId, made.receiptNumber, owner.cookies);
      expect([voidedReceipt.cancelled, voidedReceipt.kind === "sale" ? voidedReceipt.lines.length : 0]).toEqual([true, 2]);
      const notes = await sql<{ action: string; meta: Record<string, string> }[]>`
        SELECT action, meta FROM audit_log WHERE gym_id = ${gymId} AND action IN ('org.sale_recorded', 'org.sale_undone') ORDER BY at, action`;
      expect(notes.map((n) => [n.action, n.meta["product"], n.meta["others"], n.meta["totalMinor"]])).toEqual([
        ["org.sale_recorded", "Water", "1", "720"],
        ["org.sale_undone", "Water", "1", "720"],
      ]);
    },
    T,
  );

  it(
    "a set amount off goes on one product of a sale, and a discount with one use left covers a whole sale",
    async () => {
      const owner = await makeUser("disc-owner", "Sam Owner");
      const gymId = await makeGym(owner, "Sb Discount Gym");
      const water = await addProduct(gymId, owner.cookies, "Water", 200, null);
      const bar = await addProduct(gymId, owner.cookies, "Protein bar", 300, null);
      const dollarOff = await addDiscount(gymId, owner.cookies, "Dollar off", { kind: "amount", percentBp: null, amountMinor: 100 });
      const once = await addDiscount(gymId, owner.cookies, "Once only", { maxUses: 1 });

      const twice = await sell(
        gymId,
        owner.cookies,
        basket([
          { productId: water.id, quantity: 1, totalMinor: 100, discountId: dollarOff.id },
          { productId: bar.id, quantity: 1, totalMinor: 200, discountId: dollarOff.id },
        ]),
      );
      expect(answer(twice)).toEqual([409, "discount_one_line"]);
      expect((JSON.parse(twice.body) as { message: string }).message).toBe("Dollar off can go on one product of a sale. Nothing was sold: leave it on one product only.");
      expect([await usesOf(dollarOff.id), (await rowsOf(gymId)).length]).toEqual([0, 0]);

      await sold(
        gymId,
        owner.cookies,
        basket([
          { productId: water.id, quantity: 1, totalMinor: 100, discountId: dollarOff.id },
          { productId: bar.id, quantity: 1, totalMinor: 300 },
        ]),
      );
      await sold(
        gymId,
        owner.cookies,
        basket([
          { productId: water.id, quantity: 1, totalMinor: 180, discountId: once.id },
          { productId: bar.id, quantity: 1, totalMinor: 270, discountId: once.id },
        ]),
      );
      expect([await usesOf(dollarOff.id), await usesOf(once.id)]).toEqual([1, 1]);
      expect(answer(await sell(gymId, owner.cookies, basket([{ productId: water.id, quantity: 1, totalMinor: 180, discountId: once.id }])))).toEqual([409, "discount_used_up"]);
    },
    T,
  );

  it(
    "the payments file pages through a sale's lines: a page that ends on its first line carries on with its second",
    async () => {
      const owner = await makeUser("file-owner", "Sam Owner");
      const gymId = await makeGym(owner, "Sb File Gym");
      const water = await addProduct(gymId, owner.cookies, "Water", 200, null);
      const bar = await addProduct(gymId, owner.cookies, "Protein bar", 300, null);
      const made = await sold(
        gymId,
        owner.cookies,
        basket([
          { productId: water.id, quantity: 1, totalMinor: 200 },
          { productId: bar.id, quantity: 1, totalMinor: 300 },
        ]),
      );
      const all = await linesPage(sql, gymId, TODAY, TODAY, made.receiptNumber, null);
      expect(all.map((l) => [l.item, l.receipt, l.line])).toEqual([
        ["Water", made.receiptNumber, 1],
        ["Protein bar", made.receiptNumber, 2],
      ]);
      const rest = await linesPage(sql, gymId, TODAY, TODAY, made.receiptNumber, { on: TODAY, receipt: made.receiptNumber, line: 1 });
      expect(rest.map((l) => l.item)).toEqual(["Protein bar"]);
      const res = await get(`/v1/orgs/${gymId}/payments-download`, owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const summary = paymentsDownloadSummarySchema.parse(JSON.parse(res.body));
      expect([summary.lines, summary.totals.map((t) => t.soldMinor)]).toEqual([2, [500]]);
    },
    T,
  );
});
