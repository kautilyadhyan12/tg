// SEVERAL TAXES ON ONE PRODUCT, AND RATES TO THREE DECIMALS, through the routes against real
// Postgres (ROADMAP Stage 2 item 18b-v-a; `rulings/2026-11-05-18b-v-a.md`). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: charge them the wrong amount, or hand them
// a receipt whose taxes do not add up to what they paid. That is the first test: a Quebec gym's
// $100.00 day pass with GST 5% and QST 9.975%, which Revenu Québec works out as $5.00 and $9.98,
// $114.98 (each on the price, never QST on the GST), read back from the sale, the table and the
// receipt. Every refusal is checked by reading the tables, not the reply.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { REGISTER_WORDS, receiptSchema, sellPageResponseSchema, sellProductResponseSchema, taxesOverCapWords, type SellPageResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { saleOnTerminalSchema } from "../src/modules/orgs/payments/terminalPaymentsRepo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-register-taxes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_register_taxes";

let ipCounter = 0;
const nextIp = () => `10.95.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("several taxes on one product (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'regtax-t-%@example.com')`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_tax_rates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'regtax-t-%@example.com'`;
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
  const get = (path: string, cookies: Cookies) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies) => send("PUT", path, cookies, payload);
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const messageOf = (res: { body: string }) => (JSON.parse(res.body) as { message: string }).message;

  const makeUser = async (local: string): Promise<Cookies> => {
    const email = `regtax-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Tax ${local}` }, {});
    expect(reg.statusCode, reg.body).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode, login.body).toBe(200);
    return cookieMap(login);
  };
  const makeGym = async (owner: Cookies, name: string, country: string, timezone: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Montreal", country, timezone }, owner);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };

  const base = (gymId: string) => `/v1/orgs/${gymId}/register`;
  const page = (res: { body: string }): SellPageResponse => sellPageResponseSchema.parse(JSON.parse(res.body));
  const read = async (gymId: string, cookies: Cookies): Promise<SellPageResponse> => {
    const res = await get(base(gymId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return page(res);
  };
  const addRate = async (gymId: string, cookies: Cookies, name: string, pcm: number): Promise<string> => {
    const res = await post(`${base(gymId)}/tax-rates`, { name, pcm }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).tax.rates.find((r) => r.name === name);
    if (found === undefined) throw new Error(`no rate named ${name}`);
    expect(found.pcm).toBe(pcm);
    return found.id;
  };
  const addProduct = async (gymId: string, cookies: Cookies, name: string, priceMinor: number, taxRateIds: string[]) => {
    const res = await post(`${base(gymId)}/products`, { name, priceMinor, taxRateIds, stock: null }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product named ${name}`);
    return found;
  };
  const sell = (gymId: string, cookies: Cookies, productId: string, totalMinor: number) =>
    post(`${base(gymId)}/sales`, { requestKey: nextKey(), productId, quantity: 1, entryId: null, method: "cash", totalMinor }, cookies);
  const ratesOfProduct = async (productId: string) =>
    (await sql<{ tax_rate_id: string }[]>`SELECT tax_rate_id FROM gym_product_tax_rates WHERE product_id = ${productId} ORDER BY position`).map((r) => r.tax_rate_id);
  const charge = (gymId: string, rateId: string, ids: string[], cookies: Cookies) => put(`${base(gymId)}/tax-rates/${rateId}/charged-on`, { use: "products", ids }, cookies);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
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
    await sql.end();
  }, T);

  it(
    "Quebec: a $100.00 day pass with GST and QST is $114.98, each tax on the price, and the sale, its row and its receipt all say so",
    async () => {
      const owner = await makeUser("qc-owner");
      const gymId = await makeGym(owner, "Montreal Iron", "CA", "America/Toronto");
      const gst = await addRate(gymId, owner, "GST", 5000);
      const qst = await addRate(gymId, owner, "QST", 9975);
      const pass = await addProduct(gymId, owner, "Day pass", 10000, [gst, qst]);
      expect(pass.taxRateIds).toEqual([gst, qst]);

      // QST worked out on the price and the GST ($10.47) would be $115.47; a total rounded once, $114.98 too.
      for (const wrong of [11547, 11500, 11497, 10000]) {
        const refused = await sell(gymId, owner, pass.id, wrong);
        expect(refused.statusCode).toBe(409);
        expect(messageOf(refused)).toBe(REGISTER_WORDS.price_changed);
      }
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_sales WHERE gym_id = ${gymId}`)[0]?.n).toBe(0);

      const sold = await sell(gymId, owner, pass.id, 11498);
      expect(sold.statusCode, sold.body).toBe(201);
      const { receiptNumber, register } = sellProductResponseSchema.parse(JSON.parse(sold.body));
      const line = register.sales[0];
      expect(line).toMatchObject({ netMinor: 10000, taxMinor: 1498, totalMinor: 11498, taxIncluded: false });
      expect(line?.taxes).toEqual([
        { name: "GST", pcm: 5000, minor: 500 },
        { name: "QST", pcm: 9975, minor: 998 },
      ]);
      expect(register.totals.taxMinor).toBe(1498);

      const [row] = await sql<{ tax_minor: number; tax_pcm: number; tax_name: string | null; taxes: unknown; total_minor: number }[]>`
        SELECT tax_minor, tax_pcm, tax_name, taxes, total_minor FROM gym_sales WHERE gym_id = ${gymId}`;
      expect(row).toEqual({ tax_minor: 1498, tax_pcm: 14975, tax_name: null, taxes: [{ name: "GST", pcm: 5000, minor: 500 }, { name: "QST", pcm: 9975, minor: 998 }], total_minor: 11498 });

      const res = await get(`/v1/orgs/${gymId}/receipts/${String(receiptNumber)}`, owner);
      expect(res.statusCode, res.body).toBe(200);
      const receipt = receiptSchema.parse(JSON.parse(res.body));
      if (receipt.kind !== "sale") throw new Error("not a sale's receipt");
      const amounts = receipt.lines[0]?.amounts;
      expect(amounts).toEqual({
        listedMinor: 10000,
        discount: null,
        taxes: [
          { name: "GST", pcm: 5000, included: false, minor: 500 },
          { name: "QST", pcm: 9975, included: false, minor: 998 },
        ],
        totalMinor: 11498,
      });
      // What the receipt says adds up to what was paid.
      expect((amounts?.listedMinor ?? 0) + (amounts?.taxes ?? []).reduce((n, t) => n + t.minor, 0)).toBe(receipt.totalMinor);
    },
    T,
  );

  it(
    "India: ₹50 with CGST and SGST inside is ₹50, the ₹7.63 of tax in it shared ₹3.82 and ₹3.81, and the receipt adds up",
    async () => {
      const owner = await makeUser("in-owner");
      const gymId = await makeGym(owner, "Pune Strength", "IN", "Asia/Kolkata");
      expect((await read(gymId, owner)).tax.included).toBe(true);
      const cgst = await addRate(gymId, owner, "CGST", 9000);
      const sgst = await addRate(gymId, owner, "SGST", 9000);
      const shake = await addProduct(gymId, owner, "Protein shake", 5000, [cgst, sgst]);
      const sold = await sell(gymId, owner, shake.id, 5000);
      expect(sold.statusCode, sold.body).toBe(201);
      const { receiptNumber, register } = sellProductResponseSchema.parse(JSON.parse(sold.body));
      expect(register.sales[0]).toMatchObject({
        netMinor: 4237,
        taxMinor: 763,
        totalMinor: 5000,
        taxIncluded: true,
        taxes: [
          { name: "CGST", pcm: 9000, minor: 382 },
          { name: "SGST", pcm: 9000, minor: 381 },
        ],
      });
      const receipt = receiptSchema.parse(JSON.parse((await get(`/v1/orgs/${gymId}/receipts/${String(receiptNumber)}`, owner)).body));
      if (receipt.kind !== "sale") throw new Error("not a sale's receipt");
      expect(receipt.lines[0]?.amounts).toEqual({
        listedMinor: 5000,
        discount: null,
        taxes: [
          { name: "CGST", pcm: 9000, included: true, minor: 382 },
          { name: "SGST", pcm: 9000, included: true, minor: 381 },
        ],
        totalMinor: 5000,
      });
    },
    T,
  );

  it(
    "a product's rates: this gym's, each once, at most 30% together, kept in order when another rate is charged on it, and next door's refused",
    async () => {
      const owner = await makeUser("rules-owner");
      const gymId = await makeGym(owner, "Toronto Barbell", "CA", "America/Toronto");
      const nextDoorOwner = await makeUser("rules-nextdoor");
      const nextDoor = await makeGym(nextDoorOwner, "Next Door Gym", "CA", "America/Toronto");
      const theirs = await addRate(nextDoor, nextDoorOwner, "Their tax", 5000);

      // Three decimals, as New York City's 8.875%.
      const city = await addRate(gymId, owner, "City tax", 8875);
      const state = await addRate(gymId, owner, "State tax", 20000);
      const extra = await addRate(gymId, owner, "Extra", 10001);
      const productsNow = async () => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_products WHERE gym_id = ${gymId}`)[0]?.n;

      // More than 30% together: refused, nothing saved.
      const over = await post(`${base(gymId)}/products`, { name: "Towel", priceMinor: 1000, taxRateIds: [state, extra], stock: null }, owner);
      expect(over.statusCode).toBe(409);
      expect(errorOf(over)).toBe("taxes_over_cap");
      expect(messageOf(over)).toBe(REGISTER_WORDS.taxes_over_cap);
      // The same rate twice: refused before anything is read.
      expect((await post(`${base(gymId)}/products`, { name: "Towel", priceMinor: 1000, taxRateIds: [city, city], stock: null }, owner)).statusCode).toBe(400);
      // Next door's rate: refused as not this gym's.
      const foreign = await post(`${base(gymId)}/products`, { name: "Towel", priceMinor: 1000, taxRateIds: [city, theirs], stock: null }, owner);
      expect(foreign.statusCode).toBe(409);
      expect(errorOf(foreign)).toBe("tax_rate_not_found");
      expect(await productsNow()).toBe(0);

      // 28.875% together stands.
      const towel = await addProduct(gymId, owner, "Towel", 1000, [state, city]);
      expect(await ratesOfProduct(towel.id)).toEqual([state, city]);
      const lock = await addProduct(gymId, owner, "Lock", 500, [city]);

      // Charging another rate on a product keeps the rates it has, after them; taking it off takes only that one.
      const small = await addRate(gymId, owner, "Small", 2000);
      expect((await charge(gymId, small, [lock.id], owner)).statusCode).toBe(200);
      expect(await ratesOfProduct(lock.id)).toEqual([city, small]);
      // On the Towel it would come to 30.875%: refused by name, nothing changed.
      const tooMuch = await charge(gymId, small, [lock.id, towel.id], owner);
      expect(tooMuch.statusCode).toBe(409);
      expect(messageOf(tooMuch)).toBe(taxesOverCapWords("Towel"));
      expect(await ratesOfProduct(towel.id)).toEqual([state, city]);
      expect(await ratesOfProduct(lock.id)).toEqual([city, small]);
      expect((await charge(gymId, small, [], owner)).statusCode).toBe(200);
      expect(await ratesOfProduct(lock.id)).toEqual([city]);
      expect(await ratesOfProduct(towel.id)).toEqual([state, city]);

      // A rate raised past 30% on a product's taxes together is refused, by the product's name; up to 30% stands.
      const raised = await put(`${base(gymId)}/tax-rates/${city}`, { name: "City tax", pcm: 10001 }, owner);
      expect(raised.statusCode).toBe(409);
      expect(messageOf(raised)).toBe(taxesOverCapWords("Towel"));
      expect((await sql<{ rate_pcm: number }[]>`SELECT rate_pcm FROM gym_tax_rates WHERE id = ${city}`)[0]?.rate_pcm).toBe(8875);
      expect((await put(`${base(gymId)}/tax-rates/${city}`, { name: "City tax", pcm: 10000 }, owner)).statusCode).toBe(200);

      // Next door cannot charge, change or read this gym's rates or products.
      expect([403, 404]).toContain((await charge(gymId, city, [towel.id], nextDoorOwner)).statusCode);
      expect([403, 404]).toContain((await charge(nextDoor, city, [towel.id], nextDoorOwner)).statusCode);
      expect([403, 404]).toContain(
        (await put(`${base(gymId)}/products/${towel.id}`, { name: "Mine", priceMinor: 1, taxRateIds: [], stock: null, updatedAt: towel.updatedAt }, nextDoorOwner)).statusCode,
      );
      expect(await ratesOfProduct(towel.id)).toEqual([state, city]);
      // Saving a product with no rates takes them all off.
      const towelNow = (await read(gymId, owner)).products.find((p) => p.id === towel.id);
      expect((await put(`${base(gymId)}/products/${towel.id}`, { name: "Towel", priceMinor: 1000, taxRateIds: [], stock: null, updatedAt: towelNow?.updatedAt }, owner)).statusCode).toBe(200);
      expect(await ratesOfProduct(towel.id)).toEqual([]);
    },
    T,
  );

  it(
    "the migration: every rate and sale keeps its percentage times ten, a sale its one tax by name, and a basket waiting on the Terminal its lines",
    async () => {
      // The data statements of 0206, as written, run against temporary tables of the shape they read
      // (a temporary table hides the real one of its name), then dropped.
      const text = readFileSync(new URL("../drizzle/0206_tax_thousandths.sql", import.meta.url), "utf8");
      const statements = text.split("--> statement-breakpoint").map((s) => s.replace(/^\s*--.*$/gm, "").trim());
      const sales = statements.find((s) => s.startsWith('UPDATE "gym_sales"'));
      const baskets = statements.find((s) => s.startsWith('UPDATE "gym_terminal_payments"'));
      if (sales === undefined || baskets === undefined) throw new Error("the migration's data statements were not found");
      const productId = "00000000-0000-4000-8000-0000000000c1";
      const oldBasket = {
        included: false,
        totalMinor: 1312,
        forMember: false,
        lines: [
          { productId, name: "Water", unitPriceMinor: 199, currency: "USD", quantity: 1, used: null, gift: null, rate: { name: "Sales tax", bp: 825 }, netMinor: 199, taxMinor: 16, totalMinor: 215 },
          { productId: "00000000-0000-4000-8000-0000000000c2", name: "Towel", unitPriceMinor: 1097, currency: "USD", quantity: 1, used: null, gift: null, rate: null, netMinor: 1097, taxMinor: 0, totalMinor: 1097 },
        ],
      };
      const got = await sql.begin(async (tx) => {
        await tx`CREATE TEMP TABLE gym_sales (id int PRIMARY KEY, tax_pcm integer NOT NULL, tax_name text, tax_minor integer NOT NULL, taxes jsonb NOT NULL DEFAULT '[]') ON COMMIT DROP`;
        await tx`INSERT INTO gym_sales (id, tax_pcm, tax_name, tax_minor) VALUES (1, 825, 'Sales tax', 16), (2, 0, NULL, 0), (3, 2000, NULL, 33)`;
        await tx`CREATE TEMP TABLE gym_terminal_payments (id int PRIMARY KEY, sale jsonb) ON COMMIT DROP`;
        await tx`INSERT INTO gym_terminal_payments (id, sale) VALUES (1, ${tx.json(oldBasket)}), (2, NULL), (3, ${tx.json({ ...oldBasket, lines: [] })})`;
        await tx.unsafe(sales);
        await tx.unsafe(baskets);
        return {
          sales: await tx<{ id: number; tax_pcm: number; taxes: unknown }[]>`SELECT id, tax_pcm, taxes FROM gym_sales ORDER BY id`,
          baskets: await tx<{ id: number; sale: unknown }[]>`SELECT id, sale FROM gym_terminal_payments ORDER BY id`,
        };
      });
      expect(got.sales).toEqual([
        { id: 1, tax_pcm: 8250, taxes: [{ name: "Sales tax", pcm: 8250, minor: 16 }] },
        { id: 2, tax_pcm: 0, taxes: [] },
        // A sale made before rates had names keeps no name.
        { id: 3, tax_pcm: 20000, taxes: [{ name: null, pcm: 20000, minor: 33 }] },
      ]);
      const kept = saleOnTerminalSchema.parse(got.baskets[0]?.sale);
      expect(kept.lines.map((l) => l.taxes)).toEqual([[{ name: "Sales tax", pcm: 8250, minor: 16 }], []]);
      expect(kept.lines.map((l) => l.totalMinor)).toEqual([215, 1097]);
      expect(got.baskets[1]?.sale).toBeNull();
      expect(got.baskets[2]?.sale).toEqual({ ...oldBasket, lines: [] });
    },
    T,
  );
});
