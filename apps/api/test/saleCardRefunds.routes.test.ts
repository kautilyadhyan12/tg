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
  let clock = new Date();
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
    sql<{ state: string; outcome: string | null; code: string | null; square_refund_id: string | null; sale_refund_id: string | null }[]>`
      SELECT state, outcome, code, square_refund_id, sale_refund_id FROM gym_square_refunds WHERE gym_id = ${gym.id} AND sale_id = ${saleId} ORDER BY started_at`;
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
      expect(cardRefundCheckSchema.parse(JSON.parse(box.body))).toEqual({ card: { brand: "VISA", last4: "1111" }, leftMinor: 400, refundedInSquareMinor: 0, block: null });

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

    it("Square refuses it: nothing written, nothing on the shelf, and the box's key is new", async () => {
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

  describe("what stops a refund before it is sent", () => {
    it("an Interac debit card, a payment over a year old, one in another account, and a sale whose total differs", async () => {
      const blockOf = async (b: Basket) => cardRefundCheckSchema.parse(JSON.parse((await send("GET", refundUrl(b.gym, b.towel), b.gym.owner.cookies)).body)).block;

      const interac = await sold(gym);
      const paid = square.paymentById(interac.squarePaymentId);
      if (paid === undefined) throw new Error("no payment");
      paid.card_details = { card: { card_brand: "INTERAC", last_4: "4242" }, refund_requires_card_presence: true };
      expect(await blockOf(interac)).toBe("card_present");
      expect(errorOf(await press(interac, interac.towel, 100))).toBe("card_refund_card_present");

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
});
