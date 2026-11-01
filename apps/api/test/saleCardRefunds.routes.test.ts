// Refund to card at Sell (ROADMAP 18d-iv-b-ii; spec Part 3 §14.8), through the routes and the worker's minute against real
// Postgres (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`. A basket of products shares ONE
// Square payment, and each product is refunded on its own.
//
// The first block is the worst thing this job could do to a real person: a customer given back more than they paid for a
// basket, refunded twice, or another gym's sale refunded. Every claim is read from the tables and from what the fake Square
// made, never from the reply alone.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  cardRefundCheckSchema,
  refundsToReviewResponseSchema,
  cardRefundResponseSchema,
  sellPageResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentResponseSchema,
  type GymSale,
  type OrgPrivilege,
  type SellPageResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { CARD_REFUND } from "../src/modules/orgs/payments/cardRefunds.js";
import { startSaleRefund, startWholeSaleRefund } from "../src/modules/orgs/payments/saleCardRefundsRepo.js";
import { linesPage, totals } from "../src/modules/orgs/paymentsDownload/repo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "sale-card-refund-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-SALEREFUNDAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-SALEREFUNDSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 240_000;
const LIVE_PLAN = "zz_sale_card_refund";

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  userId: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  name: string;
  owner: Person;
  acct: Account;
  desk: string;
  water: string;
  towel: string;
}
/** A sale of two Water ($4.00, counted on the shelf) and a Towel ($15.00, not counted): $19.00, one Square payment. */
interface Basket {
  gym: Gym;
  water: string;
  towel: string;
  squarePaymentId: string;
  receipt: number;
}

let ipCounter = 0;
const nextIp = () => `10.62.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("Refund to card at Sell (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  // Noon at the gym in Chicago, the last one past: the tests move this clock on by hours, and Sell lists
  // the gym's today, so a start near its midnight lost a sale from the list.
  const lastNoon = new Date();
  lastNoon.setUTCHours(17, 0, 0, 0);
  if (lastNoon.getTime() > Date.now()) lastNoon.setUTCDate(lastNoon.getUTCDate() - 1);
  let clock = lastNoon;
  square.state.now = () => clock;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const workDeps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });
  const gyms: Gym[] = [];
  const work = () =>
    processSquareWork(
      workDeps(),
      [],
      gyms.map((g) => g.id),
    );

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'scrf-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'scrf-t-%@example.com'`;
    await sql`DELETE FROM gym_square_refunds WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mineSql})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gyms WHERE id IN (${mineSql})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'scrf-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  const signedIn = async (name: string): Promise<Person> => {
    const email = `scrf-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const connect = async (gym: { id: string; owner: Person }, acct: Account) => {
    const start = await send("POST", `/v1/orgs/${gym.id}/payments/square/connect`, gym.owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", gym.owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
  };
  const productOf = async (gymId: string, owner: Person, name: string, priceMinor: number, stock: number | null): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gymId}/register/products`, owner.cookies, { name, priceMinor, taxRateId: null, stock });
    expect(res.statusCode, res.body).toBe(201);
    const found = sellPageResponseSchema.parse(JSON.parse(res.body)).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product ${name}`);
    return found.id;
  };
  const makeGym = async (name: string, merchantId: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const acct = account(merchantId);
    await connect({ id, owner }, acct);
    const deviceId = `R5${randomBytes(6).toString("hex").toUpperCase()}`;
    square.devices.set(deviceId, { accountId: acct.merchantId, behaviour: "pays" });
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at, created_by)
      VALUES (${id}, 'production', ${acct.merchantId}, 'paired', ${deviceId}, ${clock}, ${owner.userId})
      RETURNING id`;
    const gym = { id, name, owner, acct, desk: row?.id ?? "", water: await productOf(id, owner, "Water", 200, 1000), towel: await productOf(id, owner, "Towel", 1500, null) };
    gyms.push(gym);
    return gym;
  };
  const page = async (gym: Gym, by: Person = gym.owner): Promise<SellPageResponse> => {
    const res = await send("GET", `/v1/orgs/${gym.id}/register`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return sellPageResponseSchema.parse(JSON.parse(res.body));
  };
  const line = async (b: Basket, id: string): Promise<GymSale> => {
    const found = (await page(b.gym)).sales.find((s) => s.id === id);
    if (found === undefined) throw new Error("the sale is not on Sell's list");
    return found;
  };
  /** Sold on the Terminal, through its routes: Square holds the money. */
  const sold = async (gym: Gym): Promise<Basket> => {
    const body = {
      terminalId: gym.desk,
      requestKey: randomUUID(),
      entryId: null,
      totalMinor: 1900,
      lines: [
        { productId: gym.water, quantity: 2, totalMinor: 400, discountId: null },
        { productId: gym.towel, quantity: 1, totalMinor: 1500, discountId: null },
      ],
    };
    const press = await send("POST", `/v1/orgs/${gym.id}/terminal-sales`, gym.owner.cookies, body);
    expect(press.statusCode, press.body).toBe(200);
    const payId = terminalPaymentResponseSchema.parse(JSON.parse(press.body)).payment.id;
    const look = await send("GET", `/v1/orgs/${gym.id}/terminal-sales/${payId}`, gym.owner.cookies);
    expect(look.statusCode, look.body).toBe(200);
    const paid = terminalPaymentResponseSchema.parse(JSON.parse(look.body)).payment;
    expect(paid.outcome).toBe("paid");
    const rows = await sql<{ id: string; product_id: string; square_payment_id: string; receipt_number: number }[]>`
      SELECT id, product_id, square_payment_id, receipt_number FROM gym_sales WHERE gym_id = ${gym.id} AND receipt_number = ${paid.receiptNumber ?? 0} ORDER BY line_no`;
    const [water, towel] = rows;
    if (water === undefined || towel === undefined) throw new Error("no basket");
    return { gym, water: water.id, towel: towel.id, squarePaymentId: water.square_payment_id, receipt: water.receipt_number };
  };
  const refundUrl = (gym: Gym, saleId: string) => `/v1/orgs/${gym.id}/register/sales/${saleId}/card-refund`;
  const press = (b: Basket, saleId: string, amountMinor: number, over: Partial<{ requestKey: string; restock: number; reason: string; by: Person }> = {}) =>
    send("POST", refundUrl(b.gym, saleId), (over.by ?? b.gym.owner).cookies, { requestKey: over.requestKey ?? randomUUID(), amountMinor, reason: over.reason ?? "returned", restock: over.restock ?? 0 });
  const note = (b: Basket, saleId: string, amountMinor: number) =>
    send("POST", `/v1/orgs/${b.gym.id}/register/sales/${saleId}/refunds`, b.gym.owner.cookies, { requestKey: randomUUID(), amountMinor, method: "cash", reason: "returned", restock: 0 });
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const refundsOf = (gym: Gym, saleId: string) =>
    sql<{ id: string; amount_minor: number; method: string; restocked: number; undone: boolean; void_reason: string | null; receipt_number: number }[]>`
      SELECT id, amount_minor, method, restocked, undone_at IS NOT NULL AS undone, void_reason, receipt_number
      FROM gym_sale_refunds WHERE gym_id = ${gym.id} AND sale_id = ${saleId} ORDER BY created_at, id`;
  const pressesOf = (gym: Gym, saleId: string) =>
    sql<{ state: string; outcome: string | null; code: string | null; square_refund_id: string | null }[]>`
      SELECT state, outcome, code, square_refund_id FROM gym_square_refunds WHERE gym_id = ${gym.id} AND sale_id = ${saleId} ORDER BY started_at`;
  const madeFor = (b: Basket) => square.refundsMade.filter((f) => f.payment_id === b.squarePaymentId);
  const stockOf = async (gym: Gym): Promise<number | null> => (await sql<{ stock: number | null }[]>`SELECT stock FROM gym_products WHERE id = ${gym.water}`)[0]?.stock ?? null;

  let gym: Gym;
  let nextDoor: Gym;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(config(), {
      squareApi: square.api,
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
    gym = await makeGym(`Sale Refund Gym ${uniq()}`, `MERCH${uniq()}`);
    nextDoor = await makeGym(`Next Door ${uniq()}`, `MERCH${uniq()}`);
  }, T);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await sql.end();
  }, T);

  describe("the worst thing: more back than was paid, refunded twice, or another gym's sale", () => {
    it("a basket's two products go back once each, never more than the one payment, and nobody else's moves", async () => {
      const basket = await sold(gym);
      const other = await sold(gym);
      const theirs = await sold(nextDoor);
      const shelf = await stockOf(gym);

      // The box first: this product's share, and the card that paid.
      const box = await send("GET", refundUrl(gym, basket.water), gym.owner.cookies);
      expect(box.statusCode, box.body).toBe(200);
      expect(cardRefundCheckSchema.parse(JSON.parse(box.body))).toMatchObject({ card: { brand: "VISA", last4: "1111" }, leftMinor: 400, refundedInSquareMinor: 0, block: null });

      // Two presses of one box: one refund, and one lot back on the shelf.
      const key = randomUUID();
      const [first, again] = await Promise.all([press(basket, basket.water, 400, { requestKey: key, restock: 2 }), press(basket, basket.water, 400, { requestKey: key, restock: 2 })]);
      expect(first.statusCode, first.body).toBe(200);
      expect(again.statusCode, again.body).toBe(200);
      expect(cardRefundResponseSchema.parse(JSON.parse(first.body))).toMatchObject({ amountMinor: 400, currency: "USD", card: { brand: "VISA", last4: "1111" } });
      expect(madeFor(basket)).toHaveLength(1);
      expect(madeFor(basket)[0]).toMatchObject({ amount_money: { amount: 400, currency: "USD" }, reason: "Brought back", accountId: gym.acct.merchantId });
      const rows = await refundsOf(gym, basket.water);
      expect(rows.map((r) => [r.amount_minor, r.method, r.restocked, r.undone])).toEqual([[400, "terminal", 2, false]]);
      expect(await stockOf(gym)).toBe((shelf ?? 0) + 2);

      // That product has nothing left; a second box finds so, and more than a product's share is refused.
      const nothing = await press(basket, basket.water, 1);
      expect(nothing.statusCode).toBe(409);
      expect(errorOf(nothing)).toBe("card_refund_nothing_left");
      const tooMuch = await press(basket, basket.towel, 1501);
      expect(tooMuch.statusCode).toBe(409);
      expect(errorOf(tooMuch)).toBe("card_refund_too_much");
      expect(madeFor(basket)).toHaveLength(1);

      // The other product goes back in full: the whole payment, and not a cent more.
      const towel = await press(basket, basket.towel, 1500);
      expect(towel.statusCode, towel.body).toBe(200);
      expect(madeFor(basket).reduce((n, f) => n + f.amount_money.amount, 0)).toBe(1900);
      expect(madeFor(basket)).toHaveLength(2);
      expect((await line(basket, basket.towel)).toCard).toBe(false);

      // Next door's sale through our gym, and next door's owner on ours, by a person at our gym's own address: nothing sent.
      const ourAddress = nextIp();
      for (const path of [refundUrl(gym, theirs.towel), refundUrl(nextDoor, other.towel)]) {
        const look = await send("GET", path, gym.owner.cookies, undefined, ourAddress);
        expect([403, 404], look.body).toContain(look.statusCode);
        const stolen = await send("POST", path, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other", restock: 0 }, ourAddress);
        expect([403, 404], stolen.body).toContain(stolen.statusCode);
      }
      const stranger = await send("POST", refundUrl(gym, other.towel), nextDoor.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other", restock: 0 }, ourAddress);
      expect([403, 404], stranger.body).toContain(stranger.statusCode);
      const strangerRead = await send("GET", refundUrl(gym, other.towel), nextDoor.owner.cookies, undefined, ourAddress);
      expect([403, 404], strangerRead.body).toContain(strangerRead.statusCode);
      expect(madeFor(other)).toHaveLength(0);
      expect(madeFor(theirs)).toHaveLength(0);
      expect(await refundsOf(gym, other.towel)).toHaveLength(0);
      expect(await refundsOf(nextDoor, theirs.towel)).toHaveLength(0);
    });

    it("four staff at one instant, on both products of one basket, never send more than was paid", async () => {
      const basket = await sold(gym);
      const answers = await Promise.all([press(basket, basket.water, 400), press(basket, basket.water, 400), press(basket, basket.towel, 1500), press(basket, basket.towel, 1500)]);
      expect(answers.filter((a) => a.statusCode === 500)).toHaveLength(0);
      const made = madeFor(basket);
      expect(made.reduce((n, f) => n + f.amount_money.amount, 0)).toBeLessThanOrEqual(1900);
      expect((await refundsOf(gym, basket.water)).length).toBeLessThanOrEqual(1);
      expect((await refundsOf(gym, basket.towel)).length).toBeLessThanOrEqual(1);
      expect(made.length).toBe(answers.filter((a) => a.statusCode === 200).length);
    });

    it("what was refunded inside Square leaves less to send, across the whole basket", async () => {
      const basket = await sold(gym);
      square.refund(basket.squarePaymentId, 1800);
      const box = await send("GET", refundUrl(gym, basket.towel), gym.owner.cookies);
      expect(cardRefundCheckSchema.parse(JSON.parse(box.body))).toMatchObject({ leftMinor: 100, refundedInSquareMinor: 1800, block: null });
      const refused = await press(basket, basket.towel, 101);
      expect(errorOf(refused)).toBe("card_refund_too_much");
      expect(madeFor(basket)).toHaveLength(0);
      expect((await press(basket, basket.towel, 100)).statusCode).toBe(200);
    });

    it("a key used for another amount or another product is refused, and sends nothing", async () => {
      const basket = await sold(gym);
      const key = randomUUID();
      expect((await press(basket, basket.towel, 500, { requestKey: key })).statusCode).toBe(200);
      expect(errorOf(await press(basket, basket.towel, 600, { requestKey: key }))).toBe("card_refund_key_reused");
      expect(errorOf(await press(basket, basket.water, 500, { requestKey: key }))).toBe("card_refund_key_reused");
      expect(errorOf(await press(basket, basket.towel, 500, { requestKey: key, restock: 1 }))).toBe("card_refund_key_reused");
      expect(madeFor(basket)).toHaveLength(1);
    });

    it("a sale paid by hand is never sent to Square", async () => {
      const res = await send("POST", `/v1/orgs/${gym.id}/register/sales`, gym.owner.cookies, {
        requestKey: randomUUID(),
        entryId: null,
        method: "cash",
        totalMinor: 1500,
        lines: [{ productId: gym.towel, quantity: 1, discountId: null, totalMinor: 1500 }],
      });
      expect(res.statusCode, res.body).toBe(201);
      const saleId = (JSON.parse(res.body) as { saleId: string }).saleId;
      const before = square.refundsMade.length;
      const look = await send("GET", refundUrl(gym, saleId), gym.owner.cookies);
      expect(errorOf(look)).toBe("card_refund_not_card");
      const sent = await send("POST", refundUrl(gym, saleId), gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other", restock: 0 });
      expect(errorOf(sent)).toBe("card_refund_not_card");
      expect(square.refundsMade).toHaveLength(before);
      const shown = (await page(gym)).sales.find((s) => s.id === saleId);
      expect(shown).toMatchObject({ canRefund: true, toCard: false });
    });

    it("whoever may sell may send it back; somebody without the payments tick cannot, or see what Square says", async () => {
      const basket = await sold(gym);
      const desk = await signedIn("Desk Only");
      const payments: OrgPrivilege = "billing.members";
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${desk.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer, payments]})`;
      const trainer = await signedIn("Trainer Only");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${trainer.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer]})`;
      const refused = await press(basket, basket.towel, 100, { by: trainer });
      expect(refused.statusCode, refused.body).toBe(403);
      const look = await send("GET", refundUrl(gym, basket.towel), trainer.cookies);
      expect(look.statusCode, look.body).toBe(403);
      expect(madeFor(basket)).toHaveLength(0);
      const allowed = await press(basket, basket.towel, 100, { by: desk });
      expect(allowed.statusCode, allowed.body).toBe(200);
      expect(madeFor(basket)).toHaveLength(1);
    });
  });

  describe("all of a sale at once", () => {
    const allUrl = (gym: Gym, saleId: string) => `${refundUrl(gym, saleId)}-all`;
    const pressAll = (b: Basket, amountMinor: number, over: Partial<{ requestKey: string; shelf: unknown[]; saleId: string; by: Person }> = {}) =>
      send("POST", allUrl(b.gym, over.saleId ?? b.water), (over.by ?? b.gym.owner).cookies, { requestKey: over.requestKey ?? randomUUID(), amountMinor, reason: "returned", shelf: over.shelf ?? [] });
    const noteAll = (b: Basket, totalMinor: number, over: Partial<{ requestKey: string; method: string }> = {}) =>
      send("POST", `/v1/orgs/${b.gym.id}/register/sales/${b.water}/refunds-all`, b.gym.owner.cookies, { requestKey: over.requestKey ?? randomUUID(), totalMinor, method: over.method ?? "cash", reason: "returned", shelf: [] });

    it("the worst thing: one refund at Square for all of it, written on each product, sent once, and nobody else's moves", async () => {
      const basket = await sold(gym);
      const other = await sold(gym);
      const theirs = await sold(nextDoor);
      const shelf = await stockOf(gym);
      const box = await send("GET", allUrl(gym, basket.water), gym.owner.cookies);
      expect(box.statusCode, box.body).toBe(200);
      expect(cardRefundCheckSchema.parse(JSON.parse(box.body))).toMatchObject({ card: { brand: "VISA", last4: "1111" }, leftMinor: 1900, refundedInSquareMinor: 0, block: null });

      const key = randomUUID();
      const body = { requestKey: key, shelf: [{ saleId: basket.water, count: 2 }] };
      const [first, again] = await Promise.all([pressAll(basket, 1900, body), pressAll(basket, 1900, body)]);
      expect(first.statusCode, first.body).toBe(200);
      expect(again.statusCode, again.body).toBe(200);
      expect(madeFor(basket)).toHaveLength(1);
      expect(madeFor(basket)[0]).toMatchObject({ amount_money: { amount: 1900, currency: "USD" }, reason: "Brought back", accountId: gym.acct.merchantId });
      const water = await refundsOf(gym, basket.water);
      const towel = await refundsOf(gym, basket.towel);
      expect(water.map((r) => [r.amount_minor, r.method, r.restocked, r.undone])).toEqual([[400, "terminal", 2, false]]);
      expect(towel.map((r) => [r.amount_minor, r.method, r.restocked, r.undone])).toEqual([[1500, "terminal", 0, false]]);
      expect(water[0]?.receipt_number).not.toBe(towel[0]?.receipt_number);
      expect(await stockOf(gym)).toBe((shelf ?? 0) + 2);
      expect((await line(basket, basket.water)).toCard).toBe(false);
      expect((await line(basket, basket.towel)).refunds[0]?.square?.state).toBe("pending");

      // Nothing left: a second box finds so; asked by another key nothing more goes.
      const nothing = await pressAll(basket, 1900);
      expect(errorOf(nothing)).toBe("card_refund_nothing_left");
      expect(madeFor(basket)).toHaveLength(1);

      // Next door's through our gym, and next door's owner on ours, from one address.
      const ourAddress = nextIp();
      const stolen = await send("POST", allUrl(gym, theirs.water), gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 1900, reason: "other", shelf: [] }, ourAddress);
      expect([403, 404], stolen.body).toContain(stolen.statusCode);
      const stranger = await send("POST", allUrl(gym, other.water), nextDoor.owner.cookies, { requestKey: randomUUID(), amountMinor: 1900, reason: "other", shelf: [] }, ourAddress);
      expect([403, 404], stranger.body).toContain(stranger.statusCode);
      const strangerNote = await send("POST", `/v1/orgs/${gym.id}/register/sales/${other.water}/refunds-all`, nextDoor.owner.cookies, { requestKey: randomUUID(), totalMinor: 1900, method: "cash", reason: "other", shelf: [] }, ourAddress);
      expect([403, 404], strangerNote.body).toContain(strangerNote.statusCode);
      expect(madeFor(other)).toHaveLength(0);
      expect(madeFor(theirs)).toHaveLength(0);
      expect(await refundsOf(gym, other.towel)).toHaveLength(0);
    });

    it("what is left goes, not what was sold: a product already refunded takes nothing, and a sale that changed under the box sends nothing", async () => {
      const basket = await sold(gym);
      expect((await press(basket, basket.water, 400)).statusCode).toBe(200);
      const stale = await pressAll(basket, 1900);
      expect(errorOf(stale)).toBe("sale_refund_changed");
      expect(madeFor(basket)).toHaveLength(1);
      // Pressed from the product that has nothing left, it still reaches the rest.
      expect((await pressAll(basket, 1500)).statusCode).toBe(200);
      expect(madeFor(basket).map((f) => f.amount_money.amount)).toEqual([400, 1500]);
      expect((await refundsOf(gym, basket.water)).map((r) => r.amount_minor)).toEqual([400]);
      expect((await refundsOf(gym, basket.towel)).map((r) => r.amount_minor)).toEqual([1500]);
    });

    it("a product part refunded gives back only its own rest, on the card and by hand", async () => {
      const basket = await sold(gym);
      expect((await press(basket, basket.water, 100)).statusCode).toBe(200);
      expect((await pressAll(basket, 1800)).statusCode).toBe(200);
      expect(madeFor(basket).map((f) => f.amount_money.amount)).toEqual([100, 1800]);
      expect((await refundsOf(gym, basket.water)).map((r) => r.amount_minor).sort((a, b) => a - b)).toEqual([100, 300]);
      expect((await refundsOf(gym, basket.towel)).map((r) => r.amount_minor)).toEqual([1500]);
      expect((await line(basket, basket.water)).refundedMinor).toBe(400);

      const noted = await sold(gym);
      expect((await note(noted, noted.water, 100)).statusCode).toBe(201);
      const all = await noteAll(noted, 1800);
      expect(all.statusCode, all.body).toBe(201);
      expect((await refundsOf(gym, noted.water)).map((r) => r.amount_minor).sort((a, b) => a - b)).toEqual([100, 300]);
      expect((await line(noted, noted.water)).refundedMinor).toBe(400);
    });

    it("four staff at one instant send it once", async () => {
      const basket = await sold(gym);
      const answers = await Promise.all([pressAll(basket, 1900), pressAll(basket, 1900), pressAll(basket, 1900), pressAll(basket, 1900)]);
      expect(answers.filter((a) => a.statusCode === 200)).toHaveLength(1);
      expect(answers.filter((a) => a.statusCode >= 500)).toHaveLength(0);
      expect(madeFor(basket)).toHaveLength(1);
      expect((await refundsOf(gym, basket.water))).toHaveLength(1);
    });

    it("where Square shows less left than the app, nothing goes at once and the box says what to do", async () => {
      const basket = await sold(gym);
      square.refund(basket.squarePaymentId, 300);
      const box = await send("GET", allUrl(gym, basket.water), gym.owner.cookies);
      expect(cardRefundCheckSchema.parse(JSON.parse(box.body))).toMatchObject({ leftMinor: 1600, refundedInSquareMinor: 300, block: "less_in_square" });
      expect(errorOf(await pressAll(basket, 1900))).toBe("card_refund_less_in_square");
      expect(errorOf(await pressAll(basket, 1600))).toBe("card_refund_less_in_square");
      expect(madeFor(basket)).toHaveLength(0);
    });

    it("the shelf: more than was sold, a product that isn't counted, and another sale's product are each refused", async () => {
      const basket = await sold(gym);
      const other = await sold(gym);
      expect(errorOf(await pressAll(basket, 1900, { shelf: [{ saleId: basket.water, count: 3 }] }))).toBe("restock_too_many");
      expect(errorOf(await pressAll(basket, 1900, { shelf: [{ saleId: basket.towel, count: 1 }] }))).toBe("restock_not_counted");
      expect(errorOf(await pressAll(basket, 1900, { shelf: [{ saleId: other.water, count: 1 }] }))).toBe("restock_too_many");
      expect(madeFor(basket)).toHaveLength(0);
    });

    it("Square fails it: every product's refund is voided, the shelf count comes off, and it can be sent again", async () => {
      const basket = await sold(gym);
      const before = await stockOf(gym);
      await pressAll(basket, 1900, { shelf: [{ saleId: basket.water, count: 2 }] });
      expect(await stockOf(gym)).toBe((before ?? 0) + 2);
      square.refundEnds(madeFor(basket)[0]?.id ?? "", "FAILED");
      clock = new Date(clock.getTime() + CARD_REFUND.lookAfterMs[0] + 1000);
      await work();
      expect(await stockOf(gym)).toBe(before);
      for (const id of [basket.water, basket.towel]) expect((await refundsOf(gym, id)).map((r) => [r.undone, r.void_reason])).toEqual([[true, "square_failed"]]);
      expect((await line(basket, basket.towel))).toMatchObject({ refundedMinor: 0, toCard: true });
      const audits = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.sale_refund_failed' AND meta->>'saleId' = ANY(${[basket.water, basket.towel]})`;
      expect(audits[0]?.n).toBe(2);
      expect((await pressAll(basket, 1900)).statusCode).toBe(200);
    });

    it("no answer: nothing else moves, asked again it is one refund; never answered, it is said until a refund covers all of it", async () => {
      const basket = await sold(gym);
      square.state.refundLost = true;
      const res = cardRefundResponseSchema.parse(JSON.parse((await pressAll(basket, 1900)).body));
      square.state.refundLost = false;
      expect(res.step).toBe("checking");
      expect(errorOf(await press(basket, basket.towel, 100))).toBe("card_refund_waiting");
      expect(errorOf(await noteAll(basket, 1900))).toBe("card_refund_waiting");
      clock = new Date(clock.getTime() + CARD_REFUND.idleMs + 1000);
      await work();
      expect(madeFor(basket)).toHaveLength(1);
      expect((await refundsOf(gym, basket.towel)).map((r) => r.amount_minor)).toEqual([1500]);

      const lost = await sold(gym);
      square.state.refundDown = true;
      await pressAll(lost, 1900);
      clock = new Date(clock.getTime() + CARD_REFUND.resendForMs + 1000);
      await work();
      square.state.refundDown = false;
      expect((await line(lost, lost.water)).cardRefund).toMatchObject({ amountMinor: 1900, lost: true });
      expect((await note(lost, lost.water, 400)).statusCode).toBe(201);
      expect((await line(lost, lost.water)).cardRefund).toMatchObject({ amountMinor: 1900, lost: true });
      expect((await note(lost, lost.towel, 1500)).statusCode).toBe(201);
      expect((await line(lost, lost.water)).cardRefund).toBeNull();
    });

    it("Note a refund on all of it: a row and a receipt for each product, once, and a stale box notes nothing", async () => {
      const basket = await sold(gym);
      expect(errorOf(await noteAll(basket, 1800))).toBe("sale_refund_changed");
      const key = randomUUID();
      const [first, again] = await Promise.all([noteAll(basket, 1900, { requestKey: key }), noteAll(basket, 1900, { requestKey: key })]);
      expect(first.statusCode, first.body).toBe(201);
      expect(again.statusCode, again.body).toBe(201);
      const numbers = (JSON.parse(first.body) as { receiptNumbers: number[] }).receiptNumbers;
      expect(numbers).toHaveLength(2);
      expect((await refundsOf(gym, basket.water)).map((r) => [r.amount_minor, r.method])).toEqual([[400, "cash"]]);
      expect((await refundsOf(gym, basket.towel)).map((r) => [r.amount_minor, r.method])).toEqual([[1500, "cash"]]);
      expect(errorOf(await noteAll(basket, 1900, { requestKey: key, method: "bank_transfer" }))).toBe("request_reused");
      expect(madeFor(basket)).toHaveLength(0);
    });

    it("a key is its own sale's: on another sale it is refused, never answered as done", async () => {
      const one = await sold(gym);
      const two = await sold(gym);
      const key = randomUUID();
      expect((await pressAll(one, 1900, { requestKey: key })).statusCode).toBe(200);
      const elsewhere = await pressAll(two, 1900, { requestKey: key });
      expect(elsewhere.statusCode).toBe(409);
      expect(errorOf(elsewhere)).toBe("card_refund_key_reused");
      expect(madeFor(two)).toHaveLength(0);
      expect(await refundsOf(gym, two.water)).toHaveLength(0);
      // From the same sale's other product it is the same press.
      expect((await pressAll(one, 1900, { requestKey: key, saleId: one.towel })).statusCode).toBe(200);
      expect(madeFor(one)).toHaveLength(1);

      const noted = await sold(gym);
      const notNoted = await sold(gym);
      const noteKey = randomUUID();
      expect((await noteAll(noted, 1900, { requestKey: noteKey })).statusCode).toBe(201);
      const other = await noteAll(notNoted, 1900, { requestKey: noteKey });
      expect(other.statusCode).toBe(409);
      expect(errorOf(other)).toBe("request_reused");
      expect(await refundsOf(gym, notNoted.water)).toHaveLength(0);
    });

    it("under the gym's lock Square's own figure still stops a press, on one product and on all of a sale", async () => {
      const basket = await sold(gym);
      const start = { id: randomUUID(), gymId: gym.id, saleId: basket.towel, requestKey: randomUUID(), amountMinor: 500, reason: "returned" as const, squareLeftMinor: 100, card: null, environment: "production" as const, accountId: gym.acct.merchantId, deviceId: null, startedBy: gym.owner.userId, now: clock, checkingUntil: clock };
      expect(await startSaleRefund(sql, { ...start, restock: 0 })).toEqual({ kind: "too_much", leftMinor: 100, currency: "USD" });
      expect(await startWholeSaleRefund(sql, { ...start, amountMinor: 1900, shelf: [] })).toEqual({ kind: "changed" });
      expect(await pressesOf(gym, basket.towel)).toHaveLength(0);
    });

    it("the database itself holds one press waiting on a sale's Square payment, whatever the code in front of it does", async () => {
      const basket = await sold(gym);
      const row = (saleId: string) => sql`
        INSERT INTO gym_square_refunds (id, gym_id, sale_id, environment, account_id, square_payment_id, amount_minor, currency, reason, request_key, state, started_at, checked_at)
        VALUES (${randomUUID()}, ${gym.id}, ${saleId}, 'production', ${gym.acct.merchantId}, ${basket.squarePaymentId}, 100, 'USD', 'returned', ${randomUUID()}, 'asking', now(), now())`;
      await row(basket.water);
      await expect(row(basket.towel)).rejects.toThrow(/gym_square_refunds_sale_asking_uq/);
      await sql`DELETE FROM gym_square_refunds WHERE gym_id = ${gym.id} AND sale_id = ${basket.water}`;
    });

    it("a bad body is refused before anything is read", async () => {
      const basket = await sold(gym);
      const bad = await send("POST", allUrl(gym, basket.water), gym.owner.cookies, { requestKey: "nope", amountMinor: 0, reason: "stolen", shelf: [{ saleId: "x", count: -1 }] });
      expect(bad.statusCode).toBe(400);
      expect(madeFor(basket)).toHaveLength(0);
    });
  });

  describe("what Square answers", () => {
    it("pending, then finished by the worker's look, and Sell's list follows", async () => {
      const basket = await sold(gym);
      const res = cardRefundResponseSchema.parse(JSON.parse((await press(basket, basket.towel, 500)).body));
      expect(res.step).toBe("pending");
      const shown = (await line(basket, basket.towel)).refunds[0];
      expect(shown).toMatchObject({ method: "terminal", square: { state: "pending", card: { brand: "VISA", last4: "1111" }, late: false, pressId: res.pressId } });
      square.refundEnds(madeFor(basket)[0]?.id ?? "", "COMPLETED");
      clock = new Date(clock.getTime() + CARD_REFUND.lookAfterMs[0] + 1000);
      await work();
      expect((await pressesOf(gym, basket.towel))[0]).toMatchObject({ state: "done", outcome: "completed" });
      expect((await line(basket, basket.towel)).refunds[0]?.square?.state).toBe("completed");
    });

    it("Square fails it after taking it up: no money went, the shelf count comes off, and it can be sent again", async () => {
      const basket = await sold(gym);
      const before = await stockOf(gym);
      await press(basket, basket.water, 200, { restock: 1 });
      expect(await stockOf(gym)).toBe((before ?? 0) + 1);
      square.refundEnds(madeFor(basket)[0]?.id ?? "", "FAILED");
      clock = new Date(clock.getTime() + CARD_REFUND.lookAfterMs[0] + 1000);
      await work();
      expect(await stockOf(gym)).toBe(before);
      expect((await refundsOf(gym, basket.water)).map((r) => [r.undone, r.void_reason])).toEqual([[true, "square_failed"]]);
      expect((await pressesOf(gym, basket.water))[0]).toMatchObject({ state: "done", outcome: "failed", code: "FAILED" });
      const shown = await line(basket, basket.water);
      expect(shown).toMatchObject({ refundedMinor: 0, toCard: true, cardRefund: null });
      expect(shown.refunds[0]?.voided).toMatchObject({ reason: "square_failed", by: null });
      expect((await press(basket, basket.water, 400)).statusCode).toBe(200);
    });

    it("Square refuses it: nothing written, nothing on the shelf", async () => {
      const basket = await sold(gym);
      const before = await stockOf(gym);
      square.state.refundRefused = "INSUFFICIENT_FUNDS";
      const res = await press(basket, basket.water, 200, { restock: 1 });
      square.state.refundRefused = null;
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("card_refund_refused");
      expect(await refundsOf(gym, basket.water)).toHaveLength(0);
      expect(await stockOf(gym)).toBe(before);
    });

    it("no answer: nothing else moves on the sale, then asked again with the same key it is refunded once", async () => {
      const basket = await sold(gym);
      const before = await stockOf(gym);
      square.state.refundLost = true;
      const res = cardRefundResponseSchema.parse(JSON.parse((await press(basket, basket.water, 400, { restock: 2 })).body));
      square.state.refundLost = false;
      expect(res.step).toBe("checking");
      expect(madeFor(basket)).toHaveLength(1);
      expect(await refundsOf(gym, basket.water)).toHaveLength(0);
      expect(await stockOf(gym)).toBe(before);
      expect((await line(basket, basket.water)).cardRefund).toMatchObject({ amountMinor: 400, lost: false });
      // While it waits nothing else goes back on any product of that sale, by card or by hand: they share one payment.
      expect(errorOf(await press(basket, basket.towel, 100))).toBe("card_refund_waiting");
      expect(errorOf(await note(basket, basket.towel, 100))).toBe("card_refund_waiting");
      const look = await send("GET", refundUrl(gym, basket.towel), gym.owner.cookies);
      expect(cardRefundCheckSchema.parse(JSON.parse(look.body)).block).toBe("waiting");

      clock = new Date(clock.getTime() + CARD_REFUND.idleMs + 1000);
      await work();
      expect(madeFor(basket)).toHaveLength(1);
      expect((await refundsOf(gym, basket.water)).map((r) => [r.amount_minor, r.restocked])).toEqual([[400, 2]]);
      expect(await stockOf(gym)).toBe((before ?? 0) + 2);
      expect((await line(basket, basket.water)).cardRefund).toBeNull();
    });

    it("no answer for an hour: never sent as new, and left to check in Square until a refund is noted", async () => {
      const basket = await sold(gym);
      square.state.refundDown = true;
      await press(basket, basket.towel, 1500);
      clock = new Date(clock.getTime() + CARD_REFUND.resendForMs + 1000);
      await work();
      square.state.refundDown = false;
      expect(madeFor(basket)).toHaveLength(0);
      expect((await pressesOf(gym, basket.towel))[0]).toMatchObject({ state: "done", outcome: "lost" });
      expect((await line(basket, basket.towel)).cardRefund).toMatchObject({ amountMinor: 1500, lost: true });
      const noted = await note(basket, basket.towel, 1500);
      expect(noted.statusCode, noted.body).toBe(201);
      expect((await line(basket, basket.towel)).cardRefund).toBeNull();
    });

    it("a refund on another sale of the gym does not hold this one", async () => {
      const held = await sold(gym);
      const free = await sold(gym);
      square.state.refundLost = true;
      await press(held, held.towel, 100);
      square.state.refundLost = false;
      expect((await press(free, free.towel, 100)).statusCode).toBe(200);
      expect((await note(free, free.water, 100)).statusCode).toBe(201);
      clock = new Date(clock.getTime() + CARD_REFUND.idleMs + 1000);
      await work();
    });

    it("still pending after Square's 14 days, the list says so", async () => {
      const basket = await sold(gym);
      await press(basket, basket.towel, 100);
      expect((await line(basket, basket.towel)).refunds[0]?.square?.late).toBe(false);
      await sql`UPDATE gym_square_refunds SET started_at = started_at - interval '16 days' WHERE gym_id = ${gym.id} AND sale_id = ${basket.towel}`;
      expect((await line(basket, basket.towel)).refunds[0]?.square?.late).toBe(true);
    });
  });

  describe("a refund on the Terminal", () => {
    // A gym of its own: its owner's presses stay under the hourly limit the rest of the file's owner shares.
    let gym: Gym;
    beforeAll(async () => {
      gym = await makeGym(`Terminal Sale Gym ${uniq()}`, `MERCH${uniq()}`);
    });
    const interac = async (): Promise<Basket> => {
      const basket = await sold(gym);
      const paid = square.paymentById(basket.squarePaymentId);
      if (paid === undefined) throw new Error("no payment");
      paid.card_details = { card: { card_brand: "INTERAC", last_4: "4242" }, refund_requires_card_presence: true };
      return basket;
    };
    const waitOn = (b: Basket, url: string, payload: object) => send("POST", url, b.gym.owner.cookies, { requestKey: randomUUID(), reason: "returned", terminalId: b.gym.desk, ...payload });
    const pressIdOf = (res: { statusCode: number; body: string }) => {
      expect(res.statusCode, res.body).toBe(200);
      const answer = cardRefundResponseSchema.parse(JSON.parse(res.body));
      expect(answer.step).toBe("terminal");
      return answer.pressId;
    };
    const look = (b: Basket, pressId: string) => send("GET", `/v1/orgs/${b.gym.id}/card-refunds/${pressId}`, b.gym.owner.cookies);

    it("one product: nothing stands as given back, and nothing goes on the shelf, until Square says the person finished", async () => {
      const basket = await interac();
      const before = await stockOf(gym);
      const pressId = pressIdOf(await waitOn(basket, refundUrl(gym, basket.water), { amountMinor: 200, restock: 1 }));
      expect(await refundsOf(gym, basket.water)).toHaveLength(0);
      expect(await stockOf(gym)).toBe(before);
      expect(errorOf(await note(basket, basket.water, 200))).toBe("card_refund_waiting");
      const seen = await look(basket, pressId);
      expect(seen.statusCode, seen.body).toBe(200);
      expect(await refundsOf(gym, basket.water)).toMatchObject([{ amount_minor: 200, method: "terminal", restocked: 1, undone: false }]);
      expect(await stockOf(gym)).toBe((before ?? 0) + 1);
      expect(madeFor(basket)).toHaveLength(1);
    });

    it("all of a sale: one request for all that is left, written on each product once", async () => {
      const basket = await interac();
      const pressId = pressIdOf(await waitOn(basket, `${refundUrl(gym, basket.water)}-all`, { amountMinor: 1900, shelf: [] }));
      await look(basket, pressId);
      await look(basket, pressId);
      expect(square.terminalRefunds.filter((f) => f.payment_id === basket.squarePaymentId)).toHaveLength(1);
      expect(await refundsOf(gym, basket.water)).toHaveLength(1);
      expect(await refundsOf(gym, basket.towel)).toHaveLength(1);
    });

    it("a stranger's press reads nothing", async () => {
      const basket = await interac();
      const pressId = pressIdOf(await waitOn(basket, refundUrl(gym, basket.towel), { amountMinor: 100, restock: 0 }));
      expect((await send("GET", `/v1/orgs/${nextDoor.id}/card-refunds/${pressId}`, nextDoor.owner.cookies)).statusCode).toBe(404);
      await look(basket, pressId);
    });
  });

  describe("what stops a refund before it is sent", () => {
    it("an Interac debit card, a payment over a year old, one in another account, and a sale whose total differs", async () => {
      const blockOf = async (b: Basket) => cardRefundCheckSchema.parse(JSON.parse((await send("GET", refundUrl(b.gym, b.towel), b.gym.owner.cookies)).body)).block;

      const interac = await sold(gym);
      const paid = square.paymentById(interac.squarePaymentId);
      if (paid === undefined) throw new Error("no payment");
      paid.card_details = { card: { card_brand: "INTERAC", last_4: "4242" }, refund_requires_card_presence: true };
      expect(await blockOf(interac)).toBeNull();
      expect(errorOf(await press(interac, interac.towel, 100))).toBe("card_refund_pick_terminal");

      const old = await sold(gym);
      const oldPaid = square.paymentById(old.squarePaymentId);
      if (oldPaid === undefined) throw new Error("no payment");
      oldPaid.created_at = new Date(clock.getTime() - 400 * 24 * 60 * 60_000).toISOString();
      expect(await blockOf(old)).toBe("too_old");

      const differs = await sold(gym);
      const differsPaid = square.paymentById(differs.squarePaymentId);
      if (differsPaid === undefined) throw new Error("no payment");
      differsPaid.total_money = { amount: 1800, currency: "USD" };
      expect(await blockOf(differs)).toBe("differs");

      const elsewhere = await sold(gym);
      square.payments.delete(elsewhere.squarePaymentId);
      expect(await blockOf(elsewhere)).toBe("other_account");

      for (const b of [interac, old, differs, elsewhere]) expect(madeFor(b)).toHaveLength(0);
    });

    it("more back on the shelf than was sold, or on a product that isn't counted", async () => {
      const basket = await sold(gym);
      expect(errorOf(await press(basket, basket.water, 400, { restock: 3 }))).toBe("restock_too_many");
      expect(errorOf(await press(basket, basket.towel, 100, { restock: 1 }))).toBe("restock_not_counted");
      expect(madeFor(basket)).toHaveLength(0);
    });
  });

  describe("with everything else on the page", () => {
    it("Note a refund stands beside it: it counts, and only a refund noted by hand can be voided", async () => {
      const basket = await sold(gym);
      const noted = await note(basket, basket.towel, 500);
      expect(noted.statusCode, noted.body).toBe(201);
      const box = await send("GET", refundUrl(gym, basket.towel), gym.owner.cookies);
      expect(cardRefundCheckSchema.parse(JSON.parse(box.body)).leftMinor).toBe(1000);
      expect((await press(basket, basket.towel, 1000)).statusCode).toBe(200);
      const rows = await refundsOf(gym, basket.towel);
      const byHand = rows.find((r) => r.method === "cash");
      const toCard = rows.find((r) => r.method === "terminal");
      const voidIt = (id: string) => send("POST", `/v1/orgs/${gym.id}/register/sales/${basket.towel}/refunds/${id}/void`, gym.owner.cookies, { reason: "mistake" });
      const refused = await voidIt(toCard?.id ?? "");
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("card_refund_void");
      expect((await voidIt(byHand?.id ?? "")).statusCode).toBe(200);
    });

    it("a void of a refund waits for a refund Square has not answered on that sale", async () => {
      const basket = await sold(gym);
      const noted = await note(basket, basket.towel, 500);
      expect(noted.statusCode, noted.body).toBe(201);
      const [row] = await refundsOf(gym, basket.towel);
      square.state.refundLost = true;
      await press(basket, basket.water, 100);
      square.state.refundLost = false;
      const refused = await send("POST", `/v1/orgs/${gym.id}/register/sales/${basket.towel}/refunds/${row?.id ?? ""}/void`, gym.owner.cookies, { reason: "mistake" });
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("card_refund_waiting");
      clock = new Date(clock.getTime() + CARD_REFUND.idleMs + 1000);
      await work();
    });

    it("its receipts, Reports, the day's list, the payments download and the gym's record all say what happened", async () => {
      const basket = await sold(gym);
      const refundedInReports = async () => {
        const res = await send("GET", `/v1/orgs/${gym.id}/reports/money`, gym.owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as { report: { thisMonth: { refundedMinor: number } } }).report.thisMonth.refundedMinor;
      };
      const before = await refundedInReports();
      const dayBefore = (await page(gym)).totals.refundedMinor;
      await press(basket, basket.water, 300, { restock: 1 });
      expect(await refundedInReports()).toBe(before + 300);
      expect((await page(gym)).totals.refundedMinor).toBe(dayBefore + 300);
      const row = (await refundsOf(gym, basket.water))[0];
      const receipt = await send("GET", `/v1/orgs/${gym.id}/receipts/${String(row?.receipt_number ?? 0)}`, gym.owner.cookies);
      expect(receipt.statusCode, receipt.body).toBe(200);
      expect(JSON.parse(receipt.body)).toMatchObject({ kind: "refund", method: "terminal", refundedMinor: 300, forReceipt: basket.receipt });
      const saleReceipt = await send("GET", `/v1/orgs/${gym.id}/receipts/${String(basket.receipt)}`, gym.owner.cookies);
      expect(JSON.parse(saleReceipt.body)).toMatchObject({ kind: "sale", refunds: [{ amountMinor: 300 }] });
      const day = (await page(gym)).today;
      const { lastReceipt } = await totals(sql, gym.id, day, "2099-12-31");
      const lines = await linesPage(sql, gym.id, day, "2099-12-31", lastReceipt, null);
      expect(lines.filter((l) => l.receipt === row?.receipt_number).map((l) => [l.kind, l.item, l.amountMinor])).toEqual([["sale_refund", "Water", 300]]);
      const [audit] = await sql<{ action: string; meta: Record<string, string> }[]>`
        SELECT action, meta FROM audit_log WHERE gym_id = ${gym.id} AND target_id = ${row?.id ?? ""}`;
      expect(audit).toMatchObject({ action: "org.sale_refund_sent", meta: { product: "Water", amountMinor: "300", brand: "VISA", last4: "1111", method: "terminal", restocked: "1" } });
    });
  });

  describe("Refunds to review", () => {
    const list = async (g: Gym, by: Person = g.owner) => {
      const res = await send("GET", `/v1/orgs/${g.id}/refunds-to-review`, by.cookies);
      expect(res.statusCode, res.body).toBe(200);
      return refundsToReviewResponseSchema.parse(JSON.parse(res.body));
    };
    const noRefund = (g: Gym, pressId: string) => send("POST", `/v1/orgs/${g.id}/refunds-to-review/presses/${pressId}/no-refund`, g.owner.cookies);
    const allUrl = (gym: Gym, saleId: string) => `${refundUrl(gym, saleId)}-all`;
    const pressAll = (b: Basket, amountMinor: number) => send("POST", allUrl(b.gym, b.water), b.gym.owner.cookies, { requestKey: randomUUID(), amountMinor, reason: "returned", shelf: [] });
    const rowOf = async (b: Basket) => (await list(b.gym)).rows.find((r) => r.sale?.saleId === b.water || r.sale?.saleId === b.towel);

    // A gym of its own: a page of the list holds ten rows.
    beforeAll(async () => {
      gym = await makeGym(`Review Gym ${uniq()}`, `MERCH${uniq()}`);
    }, T);

    it("all of a sale that failed is one row naming its products; a refund since takes it off", async () => {
      const basket = await sold(gym);
      square.state.refundStatus = "REJECTED";
      await pressAll(basket, 1900);
      square.state.refundStatus = "PENDING";
      const row = await rowOf(basket);
      expect(row).toMatchObject({ kind: "failed", amountMinor: 1900, name: null, personDeleted: false, member: null, sale: { item: "Water", more: 1 } });
      expect(row?.sale?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      clock = new Date(clock.getTime() + 1000);
      const noted = await send("POST", `/v1/orgs/${gym.id}/register/sales/${basket.water}/refunds-all`, gym.owner.cookies, { requestKey: randomUUID(), totalMinor: 1900, method: "cash", reason: "returned", shelf: [] });
      expect(noted.statusCode, noted.body).toBe(201);
      expect(await rowOf(basket)).toBeUndefined();
    });

    it("two products of one basket that failed are one row, and No refund needed closes both; Sell says who decided", async () => {
      const basket = await sold(gym);
      square.state.refundStatus = "REJECTED";
      await press(basket, basket.water, 400);
      await press(basket, basket.towel, 1500);
      square.state.refundStatus = "PENDING";
      expect((await list(gym)).rows.filter((r) => r.sale?.saleId === basket.water || r.sale?.saleId === basket.towel)).toHaveLength(1);
      const row = await rowOf(basket);
      expect(row?.others).toBe(1);
      const res = await noRefund(gym, row?.id ?? "");
      expect(res.statusCode, res.body).toBe(204);
      expect(await rowOf(basket)).toBeUndefined();
      expect((await line(basket, basket.towel)).cardRefund).toMatchObject({ lost: true, decided: { by: expect.stringContaining("Owner") as string } });
      expect((await line(basket, basket.water)).cardRefund?.decided).not.toBeNull();
    });

    it("a sale Square never answered, one past 14 days, and a buyer deleted for good each read as they are", async () => {
      const lost = await sold(gym);
      square.state.refundDown = true;
      await pressAll(lost, 1900);
      square.state.refundDown = false;
      await sql`UPDATE gym_square_refunds SET state = 'done', outcome = 'lost', checking_until = NULL WHERE gym_id = ${gym.id} AND square_payment_id = ${lost.squarePaymentId}`;
      await sql`UPDATE gym_sales SET for_member = true WHERE gym_id = ${gym.id} AND receipt_number = ${lost.receipt}`;
      expect(await rowOf(lost)).toMatchObject({ kind: "lost", name: null, personDeleted: true });

      const late = await sold(gym);
      expect((await pressAll(late, 1900)).statusCode).toBe(200);
      await sql`UPDATE gym_square_refunds SET started_at = started_at - interval '15 days' WHERE gym_id = ${gym.id} AND square_payment_id = ${late.squarePaymentId}`;
      expect(await rowOf(late)).toMatchObject({ kind: "late", amountMinor: 1900 });
    });

    it("staff with the payments tick alone see a sale's row and can decide it; next door cannot", async () => {
      const basket = await sold(gym);
      square.state.refundStatus = "REJECTED";
      await pressAll(basket, 1900);
      square.state.refundStatus = "PENDING";
      const desk = await signedIn("Review Desk Sale");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${desk.userId}, 'trainer', ${["billing.members"]})`;
      const row = (await list(gym, desk)).rows.find((r) => r.sale?.saleId === basket.water);
      expect(row?.kind).toBe("failed");
      const stranger = await send("POST", `/v1/orgs/${gym.id}/refunds-to-review/presses/${row?.id ?? ""}/no-refund`, nextDoor.owner.cookies);
      expect([403, 404]).toContain(stranger.statusCode);
      expect((await noRefund(nextDoor, row?.id ?? "")).statusCode).toBe(404);
      const allowed = await send("POST", `/v1/orgs/${gym.id}/refunds-to-review/presses/${row?.id ?? ""}/no-refund`, desk.cookies);
      expect(allowed.statusCode, allowed.body).toBe(204);
    });
  });
});
