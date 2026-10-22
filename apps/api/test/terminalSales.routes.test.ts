// Take payment on Terminal at Sell (ROADMAP 18d-vi-b-ii; spec Part 3 §14.8), through its routes
// against real Postgres (DATABASE_URL-gated), with Square answered by the fake in
// `fakeSquareTerminal.ts`. A basket is priced as a sale by hand is, its total goes to the gym's
// Terminal, and the sale is recorded once Square takes the money.
//
// The first block is the worst thing this job could do to a real person: charged on the Terminal
// with no sale recorded, or two recorded, or the money recorded at another gym.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  sellPageResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentResponseSchema,
  terminalPaymentsResponseSchema,
  terminalSalesResponseSchema,
  type SellPageResponse,
  type TerminalPaymentResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { TERMINAL_PAYMENT } from "../src/modules/orgs/payments/terminalPayments.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account, type Behaviour } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 9).toString("base64"); // dummy test key, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "terminal-sale-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-TERMINALSALEAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-TERMINALSALESECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_terminal_sale";

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  userId: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  owner: Person;
}

let ipCounter = 0;
const nextIp = () => `10.51.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("Take payment on Terminal at Sell: one sale for the money taken, at this gym alone (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  const square = fakeSquare();
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const workDeps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tsale-t-%@example.com')`;
  const mine = async (): Promise<string[]> => (await sql<{ id: string }[]>`${mineSql}`).map((r) => r.id);
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'tsale-t-%@example.com'`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_discounts WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_terminals WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'tsale-t-%@example.com'`;
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

  const signedIn = async (name: string): Promise<Person> => {
    const email = `tsale-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (name: string, country = "US"): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country, timezone: country === "IN" ? "Asia/Kolkata" : "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, owner };
  };
  const staff = async (gym: Gym, who: Person, role: "manager" | "trainer") => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${who.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
  };
  const connect = async (gym: Gym, acct: Account) => {
    const start = await send("POST", `/v1/orgs/${gym.id}/payments/square/connect`, gym.owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", gym.owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
  };
  const terminal = async (gym: Gym, acct: Account, behaviour: Behaviour = "person"): Promise<{ id: string; deviceId: string }> => {
    const deviceId = `R5${randomBytes(6).toString("hex").toUpperCase()}`;
    square.devices.set(deviceId, { accountId: acct.merchantId, behaviour });
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at, created_by)
      VALUES (${gym.id}, 'production', ${acct.merchantId}, 'paired', ${deviceId}, ${clock}, ${gym.owner.userId})
      RETURNING id`;
    if (row === undefined) throw new Error("no terminal");
    return { id: row.id, deviceId };
  };
  const register = async (gym: Gym, by: Person = gym.owner): Promise<SellPageResponse> => {
    const res = await send("GET", `/v1/orgs/${gym.id}/register`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return sellPageResponseSchema.parse(JSON.parse(res.body));
  };
  const product = async (gym: Gym, name: string, priceMinor: number, stock: number | null = null): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/register/products`, gym.owner.cookies, { name, priceMinor, taxRateId: null, stock });
    expect(res.statusCode, res.body).toBe(201);
    const found = sellPageResponseSchema.parse(JSON.parse(res.body)).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product ${name}`);
    return found.id;
  };
  const discount = async (gym: Gym, name: string, maxUses: number): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/register/discounts`, gym.owner.cookies, {
      name,
      code: null,
      kind: "percent",
      percentBp: 1000,
      amountMinor: null,
      startsOn: null,
      endsOn: null,
      maxUses,
      forProducts: true,
      allProducts: true,
      productIds: [],
      forMemberships: false,
      allMembershipTypes: true,
      membershipTypeIds: [],
      membershipPayments: null,
    });
    expect(res.statusCode, res.body).toBe(201);
    const found = sellPageResponseSchema.parse(JSON.parse(res.body)).discounts.find((x) => x.name === name);
    if (found === undefined) throw new Error(`no discount ${name}`);
    return found.id;
  };
  const person = async (gym: Gym, fullName: string): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `tsale-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const saleUrl = (gym: Gym) => `/v1/orgs/${gym.id}/terminal-sales`;
  /** A basket: each [productId, quantity, total, discountId?]. */
  const basket = (terminalId: string, entryId: string | null, lines: readonly (readonly [string, number, number, (string | null)?])[], over: Record<string, unknown> = {}) => ({
    terminalId,
    requestKey: randomUUID(),
    entryId,
    totalMinor: lines.reduce((n, l) => n + l[2], 0),
    lines: lines.map(([productId, quantity, totalMinor, discountId]) => ({ productId, quantity, totalMinor, discountId: discountId ?? null })),
    ...over,
  });
  const parsed = (res: { statusCode: number; body: string }): TerminalPaymentResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return terminalPaymentResponseSchema.parse(JSON.parse(res.body));
  };
  const press = (gym: Gym, by: Person, body: unknown) => send("POST", saleUrl(gym), by.cookies, body);
  const check = async (gym: Gym, by: Person, payId: string) => parsed(await send("GET", `${saleUrl(gym)}/${payId}`, by.cookies));
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const salesOf = (gymId: string) =>
    sql<{ request_key: string; product_id: string; entry_id: string | null; quantity: number; total_minor: number; method: string; square_payment_id: string | null; receipt_number: number; recorded_by: string | null; undone: boolean }[]>`
      SELECT request_key, product_id, entry_id, quantity, total_minor, method, square_payment_id, receipt_number, recorded_by, undone_at IS NOT NULL AS undone
      FROM gym_sales WHERE gym_id = ${gymId} ORDER BY seq`;
  const stockOf = async (productId: string): Promise<number | null> => (await sql<{ stock: number | null }[]>`SELECT stock FROM gym_products WHERE id = ${productId}`)[0]?.stock ?? null;
  const checkoutsOn = (deviceId: string) => [...square.checkouts.values()].filter((c) => c.deviceId === deviceId);
  const work = async (gymIds?: string[]) => processSquareWork(workDeps(), [], gymIds ?? (await mine()));

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
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("the worst thing: the money Square took is one sale, recorded once, at this gym alone", async () => {
    clock = new Date();
    const gymA = await makeGym("Sale Worst A");
    const gymB = await makeGym("Sale Worst B");
    const accountA = account(`TSWA${uniq().slice(-6)}`);
    const accountB = account(`TSWB${uniq().slice(-6)}`);
    await connect(gymA, accountA);
    await connect(gymB, accountB);
    const manager = await signedIn("Desk Manager");
    const trainer = await signedIn("Desk Trainer");
    const stranger = await signedIn("Desk Stranger");
    await staff(gymA, manager, "manager");
    await staff(gymA, trainer, "trainer");
    const water = await product(gymA, "Water", 200, 10);
    const towel = await product(gymA, "Towel", 1500);
    const theirs = await product(gymB, "Their shake", 600);
    const tara = await person(gymA, "Tara Singh");
    const bea = await person(gymB, "Bea Brown");
    const deskA = await terminal(gymA, accountA);
    const deskB = await terminal(gymB, accountB);
    const mineBasket = (over: Record<string, unknown> = {}) => basket(deskA.id, tara, [[water, 2, 400], [towel, 1, 1500]], over);

    // Nobody who may not sell here reaches a Terminal, nor reads the gym's: another gym's owner, a
    // trainer, a stranger; nor A's own owner with B's Terminal, B's product or B's person.
    for (const [gym, who, body, status] of [
      [gymA, gymB.owner, mineBasket(), 404],
      [gymB, gymB.owner, mineBasket(), 404],
      [gymA, trainer, mineBasket(), 403],
      [gymA, stranger, mineBasket(), 404],
      [gymA, gymA.owner, basket(deskB.id, tara, [[water, 1, 200]]), 404],
      [gymA, gymA.owner, basket(deskA.id, null, [[theirs, 1, 600]]), 409],
      [gymA, gymA.owner, basket(deskA.id, bea, [[water, 1, 200]]), 404],
    ] as const) {
      const res = await press(gym, who, body);
      expect(res.statusCode, res.body).toBe(status);
    }
    for (const [gym, who] of [
      [gymA, gymB.owner],
      [gymA, trainer],
      [gymA, stranger],
    ] as const) {
      const res = await send("GET", saleUrl(gym), who.cookies);
      expect([403, 404], res.body).toContain(res.statusCode);
    }
    expect(square.checkouts.size).toBe(0);

    // The manager sends Tara's basket: Square is asked for its whole total on A's Terminal, named as
    // a sale and never as the person; nothing is sold, counted or recorded yet.
    const body = mineBasket();
    const started = parsed(await press(gymA, manager, body));
    expect(started.payment).toMatchObject({ step: "waiting", outcome: null, amountMinor: 1900, currency: "USD", membershipId: null, forSale: true, terminal: { id: deskA.id }, receiptNumber: null });
    const [checkout] = checkoutsOn(deskA.deviceId);
    expect(checkout).toMatchObject({ amount: 1900, currency: "USD", referenceId: started.payment.id, note: "Sale at the desk", status: "PENDING" });
    expect(await salesOf(gymA.id)).toEqual([]);
    expect(await stockOf(water)).toBe(10);
    // Sell, opened again, shows it waiting; Tara's own page does not: it is no bill of hers.
    const box = terminalSalesResponseSchema.parse(JSON.parse((await send("GET", saleUrl(gymA), manager.cookies)).body));
    expect(box.waiting.map((w) => w.id)).toEqual([started.payment.id]);
    const herPage = terminalPaymentsResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gymA.id}/member-list/entries/${tara}/terminal-payments`, gymA.owner.cookies)).body));
    expect(herPage.waiting).toEqual([]);
    const throughHer = await send("GET", `/v1/orgs/${gymA.id}/member-list/entries/${tara}/terminal-payments/${started.payment.id}`, gymA.owner.cookies);
    expect(throughHer.statusCode, throughHer.body).toBe(404);
    // Where it stands, and Cancel, are this gym's sellers' alone.
    for (const [gym, who, status] of [
      [gymB, gymB.owner, 404],
      [gymA, gymB.owner, 404],
      [gymA, trainer, 403],
      [gymA, stranger, 404],
    ] as const) {
      const look = await send("GET", `${saleUrl(gym)}/${started.payment.id}`, who.cookies);
      expect(look.statusCode, look.body).toBe(status);
      const stop = await send("POST", `${saleUrl(gym)}/${started.payment.id}/cancel`, who.cookies);
      expect(stop.statusCode, stop.body).toBe(status);
    }
    expect(checkoutsOn(deskA.deviceId)[0]?.status).toBe("PENDING");
    // The same press again is the same payment; another basket on that Terminal is told it is busy;
    // the same key for another basket is refused.
    expect(parsed(await press(gymA, manager, body)).payment.id).toBe(started.payment.id);
    const busy = await press(gymA, manager, basket(deskA.id, null, [[water, 1, 200]]));
    expect(busy.statusCode, busy.body).toBe(409);
    expect(errorOf(busy)).toBe("terminal_busy");
    const reused = await press(gymA, manager, { ...basket(deskA.id, null, [[towel, 1, 1500]]), requestKey: body.requestKey });
    expect(reused.statusCode, reused.body).toBe(404);
    expect(checkoutsOn(deskA.deviceId)).toHaveLength(1);

    // Tara taps her card: one sale of both products, to her, at A, as Card on Terminal with Square's
    // payment id and one receipt; the water's count comes down; nothing at B.
    square.at(deskA.deviceId).sees();
    square.at(deskA.deviceId).taps();
    const paid = await check(gymA, manager, started.payment.id);
    expect(paid.payment).toMatchObject({ step: "done", outcome: "paid" });
    const squarePaymentId = checkoutsOn(deskA.deviceId)[0]?.paymentIds[0] ?? "";
    const sold = await salesOf(gymA.id);
    const receipt = sold[0]?.receipt_number;
    expect(paid.payment.receiptNumber).toBe(receipt);
    expect(sold).toEqual([
      { request_key: started.payment.id, product_id: water, entry_id: tara, quantity: 2, total_minor: 400, method: "terminal", square_payment_id: squarePaymentId, receipt_number: receipt, recorded_by: manager.userId, undone: false },
      { request_key: started.payment.id, product_id: towel, entry_id: tara, quantity: 1, total_minor: 1500, method: "terminal", square_payment_id: squarePaymentId, receipt_number: receipt, recorded_by: manager.userId, undone: false },
    ]);
    expect(await stockOf(water)).toBe(8);
    expect(await salesOf(gymB.id)).toEqual([]);

    // Asked again, by the page, the worker and the same press, and once more after being made to
    // wait again: still one sale.
    await check(gymA, manager, started.payment.id);
    parsed(await press(gymA, manager, body));
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.idleMs + 1000);
    await work([gymA.id]);
    await sql`UPDATE gym_terminal_payments SET state = 'waiting', outcome = NULL, sale_receipt_number = NULL, finished_at = NULL WHERE id = ${started.payment.id}`;
    await work([gymA.id]);
    expect(await salesOf(gymA.id)).toHaveLength(2);
    expect(await stockOf(water)).toBe(8);
    expect((await check(gymA, manager, started.payment.id)).payment).toMatchObject({ outcome: "paid", receiptNumber: receipt });

    // Sell's day counts it as Card on Terminal, and it cannot be voided here: Square holds the money.
    const page = await register(gymA);
    expect(page.totals.terminal).toBe(1900);
    expect(page.sales.filter((s) => s.receiptNumber === receipt).map((s) => [s.method, s.canUndo, s.canRefund])).toEqual([
      ["terminal", false, true],
      ["terminal", false, true],
    ]);
    const saleId = page.sales.find((s) => s.receiptNumber === receipt)?.id ?? "";
    const voided = await send("POST", `/v1/orgs/${gymA.id}/register/sales/${saleId}/void`, gymA.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(409);
    expect(errorOf(voided)).toBe("terminal_sale_void");
    expect((await salesOf(gymA.id)).every((s) => !s.undone)).toBe(true);
  });

  it("what the Terminal took is what is recorded, though a price, the stock or a discount changed while it waited", async () => {
    clock = new Date();
    const gym = await makeGym("Sale Changes");
    const acct = account(`TSC${uniq().slice(-6)}`);
    await connect(gym, acct);
    const bar = await product(gym, "Protein bar", 300, 1);
    const tenOff = await discount(gym, "Ten off once", 1);
    const desk = await terminal(gym, acct);
    const started = parsed(await press(gym, gym.owner, basket(desk.id, null, [[bar, 1, 270, tenOff]])));
    expect(started.payment.amountMinor).toBe(270);
    // Meanwhile the owner puts the price up, and another desk sells the last bar with the discount's
    // one use.
    const bought = await send("POST", `/v1/orgs/${gym.id}/register/sales`, gym.owner.cookies, {
      requestKey: randomUUID(),
      entryId: null,
      method: "cash",
      totalMinor: 270,
      lines: [{ productId: bar, quantity: 1, discountId: tenOff, totalMinor: 270 }],
    });
    expect(bought.statusCode, bought.body).toBe(201);
    const listed = (await register(gym)).products.find((p) => p.id === bar);
    const raised = await send("PUT", `/v1/orgs/${gym.id}/register/products/${bar}`, gym.owner.cookies, { name: "Protein bar", priceMinor: 350, taxRateId: null, stock: 0, updatedAt: listed?.updatedAt });
    expect(raised.statusCode, raised.body).toBe(200);
    // A sale by hand of the same basket is refused now; the one on the Terminal is recorded as it
    // was priced when the card was asked for, the count kept at none.
    square.at(desk.deviceId).taps();
    expect((await check(gym, gym.owner, started.payment.id)).payment).toMatchObject({ step: "done", outcome: "paid" });
    const sold = (await salesOf(gym.id)).filter((s) => s.method === "terminal");
    expect(sold).toMatchObject([{ product_id: bar, quantity: 1, total_minor: 270, entry_id: null }]);
    expect(await stockOf(bar)).toBe(0);
    const [used] = await sql<{ uses: number }[]>`SELECT uses FROM gym_discounts WHERE id = ${tenOff}`;
    expect(used?.uses).toBe(2);
  });

  it("Square taking another amount than asked records no sale, and tells Staff activity", async () => {
    clock = new Date();
    const gym = await makeGym("Sale Other Amount");
    const acct = account(`TSO${uniq().slice(-6)}`);
    await connect(gym, acct);
    const water = await product(gym, "Water", 200, 5);
    const desk = await terminal(gym, acct);
    const started = parsed(await press(gym, gym.owner, basket(desk.id, null, [[water, 1, 200]])));
    square.at(desk.deviceId).taps({ amount_money: { amount: 300, currency: "USD" }, total_money: { amount: 300, currency: "USD" } });
    expect((await check(gym, gym.owner, started.payment.id)).payment).toMatchObject({ step: "done", outcome: "not_recorded" });
    expect(await salesOf(gym.id)).toEqual([]);
    expect(await stockOf(water)).toBe(5);
    const told = await sql<{ meta: Record<string, string> }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.terminal_payment_not_recorded'`;
    expect(told.map((t) => t.meta)).toEqual([{ sale: "true", amountMinor: "200", currency: "USD", why: "amount_differs" }]);
  });

  it("each way it ends without money sells nothing and frees the Terminal", async () => {
    clock = new Date();
    const gym = await makeGym("Sale Ends");
    const acct = account(`TSE${uniq().slice(-6)}`);
    await connect(gym, acct);
    const water = await product(gym, "Water", 200, 5);
    for (const [behaviour, outcome] of [
      ["cancels", "cancelled_on_terminal"],
      ["times_out", "no_answer"],
    ] as const) {
      const desk = await terminal(gym, acct, behaviour);
      const started = parsed(await press(gym, gym.owner, basket(desk.id, null, [[water, 1, 200]])));
      expect((await check(gym, gym.owner, started.payment.id)).payment, behaviour).toMatchObject({ step: "done", outcome });
    }
    const desk = await terminal(gym, acct);
    const waiting = parsed(await press(gym, gym.owner, basket(desk.id, null, [[water, 1, 200]])));
    expect(parsed(await send("POST", `${saleUrl(gym)}/${waiting.payment.id}/cancel`, gym.owner.cookies)).payment).toMatchObject({ step: "done", outcome: "cancelled" });
    expect(await salesOf(gym.id)).toEqual([]);
    expect(await stockOf(water)).toBe(5);
    // The Terminal is free: the next basket goes.
    expect(parsed(await press(gym, gym.owner, basket(desk.id, null, [[water, 1, 200]]))).payment.step).toBe("waiting");
  });

  it("Sell's box says whether Square is connected, to the owner who can connect it, and lists the Terminals", async () => {
    clock = new Date();
    const gym = await makeGym("Sale Box");
    const manager = await signedIn("Box Manager");
    await staff(gym, manager, "manager");
    const read = async (who: Person) => terminalSalesResponseSchema.parse(JSON.parse((await send("GET", saleUrl(gym), who.cookies)).body));
    expect(await read(gym.owner)).toEqual({ square: "connect", isOwner: true, terminals: [], pairTerminal: false, waiting: [] });
    expect(await read(manager)).toMatchObject({ square: "connect", isOwner: false });
    const acct = account(`TSB${uniq().slice(-6)}`);
    await connect(gym, acct);
    expect(await read(gym.owner)).toMatchObject({ square: "ready", terminals: [], pairTerminal: true });
    expect(await read(manager)).toMatchObject({ square: "ready", pairTerminal: false });
    const desk = await terminal(gym, acct);
    expect((await read(manager)).terminals.map((t) => t.id)).toEqual([desk.id]);
    // A gym where Square does not take payments is told nothing about it.
    const india = await makeGym("Sale Box India", "IN");
    const there = terminalSalesResponseSchema.parse(JSON.parse((await send("GET", saleUrl(india), india.owner.cookies)).body));
    expect(there).toMatchObject({ square: "not_offered", terminals: [] });
  });
});
