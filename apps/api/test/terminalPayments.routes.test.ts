// Take payment on Terminal (ROADMAP 18d-vi-a; spec Part 3 §14.8), through its routes against real
// Postgres (DATABASE_URL-gated), with Square answered by a fake that keeps accounts, tokens,
// Terminal checkouts and payments as Square does: a token reaches only its own account and its own
// Terminals, a checkout asked for again with its key is the same checkout, and a COMPLETED checkout
// names the payment it took. Square's own test area answered the same way on 2026-10-22
// (`apps/api/.cost/18d-vi-a/probe-checkout.mts`).
//
// The first block is the worst thing this job could do to a real person: their card charged and
// their bill still owing, so they are charged again, or the money recorded on somebody else's bill.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentResponseSchema,
  terminalPaymentsResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type SquareLocation,
  type SquarePayment,
  type SquareTerminalCheckout,
  type TerminalPaymentResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import type { NewTerminalCheckout, SquareApi, SquareResult } from "../src/modules/orgs/payments/square.js";
import { TERMINAL_PAYMENT } from "../src/modules/orgs/payments/terminalPayments.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const APP_ID = "sq0idp-TERMINALPAYAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "terminal-pay-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-TERMINALPAYSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_terminal_pay";

interface Account {
  merchantId: string;
  businessName: string;
  country: string;
  locations: SquareLocation[];
}
/** How a Terminal answers: as the person at it does (`person`, driven by the test), or as one of
 *  Square's simulated Terminals, each on its first look. */
type Behaviour = "person" | "pays" | "cancels" | "times_out" | "offline";
interface FakeCheckout {
  id: string;
  accountId: string;
  key: string;
  deviceId: string;
  amount: number;
  currency: string;
  referenceId: string | null;
  status: string;
  cancelReason: string | null;
  paymentIds: string[];
  /** The card is being read: Square refuses to cancel it now. */
  paying: boolean;
}

function fakeSquare() {
  const codes = new Map<string, Account>();
  const tokens = new Map<string, Account>();
  const devices = new Map<string, { accountId: string; behaviour: Behaviour }>();
  const checkouts = new Map<string, FakeCheckout>();
  const checkoutKeys = new Map<string, string>();
  const payments = new Map<string, SquarePayment & { accountId: string }>();
  // `down`: no answer at all. `refuseNew`: a new checkout is refused (the Terminal is not signed in).
  // `loseAnswers`: a new checkout is made and its answer lost on the way. `refuseRead`: Square
  // refuses to show a checkout (a permission taken away).
  const state: { down: boolean; refuseNew: boolean; loseAnswers: boolean; refuseRead: boolean } = { down: false, refuseNew: false, loseAnswers: false, refuseRead: false };
  let n = 0;
  const unavailable = { kind: "unavailable", status: 503 } as const;
  const unauthorized = { kind: "refused", status: 401, code: "UNAUTHORIZED" } as const;
  const notFound = { kind: "refused", status: 404, code: "NOT_FOUND" } as const;
  const json = (c: FakeCheckout): SquareTerminalCheckout => ({
    id: c.id,
    amount_money: { amount: c.amount, currency: c.currency },
    reference_id: c.referenceId,
    device_options: { device_id: c.deviceId },
    status: c.status,
    ...(c.cancelReason === null ? {} : { cancel_reason: c.cancelReason }),
    ...(c.paymentIds.length === 0 ? {} : { payment_ids: c.paymentIds }),
  });
  /** Square takes a payment for the checkout: the amount asked, unless a test says otherwise. */
  const take = (c: FakeCheckout, over: Partial<SquarePayment> = {}) => {
    n += 1;
    const id = `PAY${String(n)}${randomBytes(6).toString("hex")}`;
    const account = [...tokens.values()].find((a) => a.merchantId === c.accountId);
    payments.set(id, {
      id,
      accountId: c.accountId,
      status: "COMPLETED",
      amount_money: { amount: c.amount, currency: c.currency },
      total_money: { amount: c.amount, currency: c.currency },
      location_id: account?.locations[0]?.id ?? null,
      terminal_checkout_id: c.id,
      card_details: { card: { card_brand: "VISA", last_4: "1111" } },
      ...over,
    });
    Object.assign(c, { status: "COMPLETED", paymentIds: [...c.paymentIds, id] });
  };
  /** A simulated Terminal answers on its first look, as Square's do (measured 2026-10-22). */
  const play = (c: FakeCheckout) => {
    const behaviour = devices.get(c.deviceId)?.behaviour ?? "person";
    if (c.status !== "PENDING" || behaviour === "person" || behaviour === "offline") return;
    if (behaviour === "cancels") Object.assign(c, { status: "CANCELED", cancelReason: "BUYER_CANCELED" });
    else if (behaviour === "times_out") Object.assign(c, { status: "CANCELED", cancelReason: "TIMED_OUT" });
    else take(c);
  };
  const tokenAccount = (token: string): Account | undefined => tokens.get(token);
  const api: SquareApi = {
    authorizeUrl: (s) => `https://connect.squareup.com/oauth2/authorize?state=${s}`,
    exchangeCode(code) {
      const account = codes.get(code);
      codes.delete(code);
      if (account === undefined) return Promise.resolve({ kind: "refused", status: 400, code: "invalid_request" });
      n += 1;
      const access = `EAAAfake-tpay-${String(n)}-${randomBytes(6).toString("hex")}`;
      tokens.set(access, account);
      return Promise.resolve({
        kind: "ok",
        value: { access_token: access, token_type: "bearer", expires_at: "2099-01-01T00:00:00Z", merchant_id: account.merchantId, refresh_token: `EQAAfake-tpay-${String(n)}-xxxxxxxx` },
      });
    },
    refresh: () => Promise.resolve(unauthorized),
    revoke(token) {
      tokens.delete(token);
      return Promise.resolve({ kind: "ok", value: null });
    },
    tokenStatus(token) {
      const a = tokenAccount(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: { merchant_id: a.merchantId } });
    },
    merchant(token): Promise<SquareResult<{ id: string; business_name?: string; country: string; currency: string }>> {
      const a = tokenAccount(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: { id: a.merchantId, business_name: a.businessName, country: a.country, currency: a.country === "US" ? "USD" : "CAD" } });
    },
    locations(token) {
      const a = tokenAccount(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: a.locations });
    },
    createCustomer: () => Promise.resolve(unavailable),
    createCard: () => Promise.resolve(unavailable),
    retrieveCard: () => Promise.resolve(unavailable),
    retrieveCustomer: () => Promise.resolve(unavailable),
    disableCard: () => Promise.resolve(unavailable),
    revokeAccount: () => Promise.resolve({ kind: "ok", value: null }),
    createDeviceCode: () => Promise.resolve(unavailable),
    retrieveDeviceCode: () => Promise.resolve(unavailable),
    createTerminalAction: () => Promise.resolve(unavailable),
    getTerminalAction: () => Promise.resolve(unavailable),
    cancelTerminalAction: () => Promise.resolve(unavailable),
    createTerminalCheckout(token, c: NewTerminalCheckout) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const again = checkoutKeys.get(`${a.merchantId}:${c.idempotencyKey}`);
      const known = again === undefined ? undefined : checkouts.get(again);
      if (known !== undefined) return Promise.resolve({ kind: "ok", value: json(known) });
      if (state.refuseNew || devices.get(c.deviceId)?.accountId !== a.merchantId) return Promise.resolve({ kind: "refused", status: 400, code: "NOT_FOUND" });
      n += 1;
      const made: FakeCheckout = {
        id: `CHK${String(n)}${randomBytes(4).toString("hex")}`,
        accountId: a.merchantId,
        key: c.idempotencyKey,
        deviceId: c.deviceId,
        amount: c.amountMinor,
        currency: c.currency,
        referenceId: c.referenceId,
        status: "PENDING",
        cancelReason: null,
        paymentIds: [],
        paying: false,
      };
      checkouts.set(made.id, made);
      checkoutKeys.set(`${a.merchantId}:${c.idempotencyKey}`, made.id);
      if (state.loseAnswers) return Promise.resolve(unavailable);
      return Promise.resolve({ kind: "ok", value: json(made) });
    },
    getTerminalCheckout(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const c = checkouts.get(id);
      if (c?.accountId !== a.merchantId) return Promise.resolve(notFound);
      if (state.refuseRead) return Promise.resolve({ kind: "refused", status: 403, code: "INSUFFICIENT_SCOPES" });
      play(c);
      return Promise.resolve({ kind: "ok", value: json(c) });
    },
    cancelTerminalCheckout(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const c = checkouts.get(id);
      if (c?.accountId !== a.merchantId) return Promise.resolve(notFound);
      if (c.status === "COMPLETED" || c.paying) return Promise.resolve({ kind: "refused", status: 400, code: "BAD_REQUEST" });
      Object.assign(c, { status: "CANCELED", cancelReason: c.cancelReason ?? "SELLER_CANCELED" });
      return Promise.resolve({ kind: "ok", value: json(c) });
    },
    getPayment(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const p = payments.get(id);
      if (p?.accountId !== a.merchantId) return Promise.resolve(notFound);
      const payment: SquarePayment = { ...p };
      delete (payment as { accountId?: string }).accountId;
      return Promise.resolve({ kind: "ok", value: payment });
    },
  };
  const allow = (account: Account): string => {
    const code = `sq0cgp-${randomBytes(8).toString("hex")}`;
    codes.set(code, account);
    return code;
  };
  const open = (deviceId: string): FakeCheckout => {
    const found = [...checkouts.values()].filter((c) => c.deviceId === deviceId && (c.status === "PENDING" || c.status === "IN_PROGRESS"));
    const last = found[found.length - 1];
    if (last === undefined) throw new Error(`no checkout waiting on ${deviceId}`);
    return last;
  };
  /** The person at a Terminal. */
  const at = (deviceId: string) => ({
    sees: () => Object.assign(open(deviceId), { status: "IN_PROGRESS" }),
    /** Their card is being read: Square no longer lets the checkout be cancelled. */
    paying: () => Object.assign(open(deviceId), { status: "IN_PROGRESS", paying: true }),
    taps: (over: Partial<SquarePayment> = {}) => {
      take(open(deviceId), over);
    },
    cancels: () => Object.assign(open(deviceId), { status: "CANCELED", cancelReason: "BUYER_CANCELED" }),
  });
  return { api, allow, state, devices, checkouts, payments, at };
}

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
}

let ipCounter = 0;
const nextIp = () => `10.49.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const account = (merchantId: string, country = "US"): Account => ({
  merchantId,
  businessName: `${merchantId} Fitness LLC`,
  country,
  locations: [{ id: `L${merchantId}`, name: `${merchantId} Main St`, status: "ACTIVE", country, currency: country === "US" ? "USD" : "CAD", capabilities: ["CREDIT_CARD_PROCESSING"] }],
});
const gold = {
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 4999,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};

d("Take payment on Terminal: charged once, on this bill alone (real Postgres)", { timeout: T }, () => {
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

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tpay-t-%@example.com')`;
  const mine = async (): Promise<string[]> => (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tpay-t-%@example.com')`).map((r) => r.id);
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'tpay-t-%@example.com'`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'tpay-t-%@example.com'`;
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
    const email = `tpay-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, name, owner };
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
  /** A Terminal signed in to the account, paired by the gym (pairing itself is
   *  `squareTerminals.routes.test.ts`'s). */
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
  const typeOf = async (gym: Gym): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, gold);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === gold.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  /** A person on the list holding Gold Monthly, its first month owed. */
  const owing = async (gym: Gym, typeId: string, fullName: string): Promise<{ entryId: string; membershipId: string }> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `tpay-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    const entryId = (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
    const today = heldMembershipsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies)).body)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: false });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    return { entryId, membershipId: m.id };
  };
  const held = async (gym: Gym, by: Person, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };

  const payPress = (gym: Gym, by: Person, who: { entryId: string; membershipId: string }, terminalId: string, over: Record<string, unknown> = {}) =>
    send("POST", `${entryUrl(gym, who.entryId)}/memberships/${who.membershipId}/terminal-payment`, by.cookies, {
      terminalId,
      requestKey: randomUUID(),
      periodIndex: 0,
      amountMinor: 4999,
      ...over,
    });
  const parsed = (res: { statusCode: number; body: string }): TerminalPaymentResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return terminalPaymentResponseSchema.parse(JSON.parse(res.body));
  };
  const pay = async (gym: Gym, by: Person, who: { entryId: string; membershipId: string }, terminalId: string, over: Record<string, unknown> = {}) =>
    parsed(await payPress(gym, by, who, terminalId, over));
  const check = async (gym: Gym, by: Person, entryId: string, payId: string) => parsed(await send("GET", `${entryUrl(gym, entryId)}/terminal-payments/${payId}`, by.cookies));
  const cancel = async (gym: Gym, by: Person, entryId: string, payId: string) => parsed(await send("POST", `${entryUrl(gym, entryId)}/terminal-payments/${payId}/cancel`, by.cookies));
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const paymentsOf = (gymId: string) =>
    sql<{ bill_id: string; held_membership_id: string; amount_minor: number; method: string; provider: string | null; provider_payment_id: string | null; recorded_by: string | null }[]>`
      SELECT p.bill_id, b.held_membership_id, p.amount_minor, p.method, p.provider, p.provider_payment_id, p.recorded_by
      FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE p.gym_id = ${gymId} ORDER BY p.seq`;
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

  it("the worst thing: the money Square took is recorded once, on this person's bill alone, and nothing else can pay it meanwhile", async () => {
    clock = new Date();
    const gymA = await makeGym("Pay Worst A");
    const gymB = await makeGym("Pay Worst B");
    const accountA = account(`TPWA${uniq().slice(-6)}`);
    const accountB = account(`TPWB${uniq().slice(-6)}`);
    await connect(gymA, accountA);
    await connect(gymB, accountB);
    const manager = await signedIn("Desk Manager");
    const trainer = await signedIn("Desk Trainer");
    const stranger = await signedIn("Desk Stranger");
    await staff(gymA, manager, "manager");
    await staff(gymA, trainer, "trainer");
    const goldA = await typeOf(gymA);
    const goldB = await typeOf(gymB);
    const tara = await owing(gymA, goldA, "Tara Singh");
    const sam = await owing(gymA, goldA, "Sam Lee");
    const bea = await owing(gymB, goldB, "Bea Brown");
    const deskA = await terminal(gymA, accountA);
    const deskB = await terminal(gymB, accountB);

    // Nobody who may not take a payment here reaches a Terminal: another gym's owner (A's person at
    // A's address or at B's, B's own person on A's Terminal), A's owner on B's Terminal, a trainer,
    // a stranger.
    for (const [gym, who, person, terminalId, status] of [
      [gymA, gymB.owner, tara, deskA.id, 404],
      [gymB, gymB.owner, tara, deskA.id, 404],
      [gymB, gymB.owner, bea, deskA.id, 404],
      [gymA, gymA.owner, tara, deskB.id, 404],
      [gymA, trainer, tara, deskA.id, 403],
      [gymA, stranger, tara, deskA.id, 404],
    ] as const) {
      const res = await payPress(gym, who, person, terminalId);
      expect(res.statusCode, res.body).toBe(status);
    }
    // Nor reads where a payment stands, nor which Terminals there are.
    for (const [gym, who, entryId] of [
      [gymA, gymB.owner, tara.entryId],
      [gymB, gymB.owner, tara.entryId],
      [gymA, trainer, tara.entryId],
      [gymA, stranger, tara.entryId],
    ] as const) {
      const res = await send("GET", `${entryUrl(gym, entryId)}/terminal-payments`, who.cookies);
      expect([403, 404], res.body).toContain(res.statusCode);
    }
    expect(square.checkouts.size).toBe(0);

    // The manager takes Tara's month on the Terminal: Square is asked for exactly that amount on that
    // Terminal, for this press; nothing is on the bill yet.
    const started = await pay(gymA, manager, tara, deskA.id);
    expect(started.payment).toMatchObject({ step: "waiting", outcome: null, amountMinor: 4999, currency: "USD", membershipId: tara.membershipId, terminal: { id: deskA.id }, receiptNumber: null });
    const [checkout] = checkoutsOn(deskA.deviceId);
    expect(checkout).toMatchObject({ amount: 4999, currency: "USD", referenceId: started.payment.id, status: "PENDING" });
    expect(await paymentsOf(gymA.id)).toEqual([]);

    // While it waits nothing else pays, voids or cancels Tara's month: Record payment by hand, Void
    // bill; a second press is the same payment; Sam on the same Terminal is told it is busy.
    const byHand = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/payments`, gymA.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" });
    expect(byHand.statusCode, byHand.body).toBe(409);
    expect(errorOf(byHand)).toBe("terminal_payment_waiting");
    const billId = (await held(gymA, gymA.owner, tara.entryId)).memberships[0]?.billing?.bills[0]?.id ?? "";
    const voidBill = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/bills/${billId}/cancel`, gymA.owner.cookies, { reason: "mistake" });
    expect(voidBill.statusCode, voidBill.body).toBe(409);
    expect(errorOf(voidBill)).toBe("terminal_payment_waiting");
    // Cancelled, frozen or a mark taken back while it waits: the member would pay for it anyway.
    for (const [what, body] of [
      ["cancel", { when: "today" }],
      ["freeze", {}],
      ["paid", { paidPeriods: 0 }],
    ] as const) {
      const res = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/${what}`, gymA.owner.cookies, body);
      expect(res.statusCode, `${what} ${res.body}`).toBe(409);
      expect(errorOf(res), what).toBe("terminal_payment_waiting");
    }
    expect((await held(gymA, gymA.owner, tara.entryId)).memberships[0]?.view.status).toBe("active");
    // Where it stands, and Cancel, are this gym's payments staff's alone.
    for (const [gym, who, status] of [
      [gymB, gymB.owner, 404],
      [gymA, gymB.owner, 404],
      [gymA, trainer, 403],
      [gymA, stranger, 404],
    ] as const) {
      const look = await send("GET", `${entryUrl(gym, tara.entryId)}/terminal-payments/${started.payment.id}`, who.cookies);
      expect(look.statusCode, look.body).toBe(status);
      const stop = await send("POST", `${entryUrl(gym, tara.entryId)}/terminal-payments/${started.payment.id}/cancel`, who.cookies);
      expect(stop.statusCode, stop.body).toBe(status);
    }
    expect(checkoutsOn(deskA.deviceId)[0]?.status).toBe("PENDING");
    // Disconnect Square waits for it: the amount would stay on the Terminal with nothing to record it.
    const off = await send("DELETE", `/v1/orgs/${gymA.id}/payments/square`, gymA.owner.cookies);
    expect(off.statusCode, off.body).toBe(409);
    expect(errorOf(off)).toBe("terminal_payment_waiting");
    expect((await pay(gymA, gymA.owner, tara, deskA.id)).payment.id).toBe(started.payment.id);
    const busy = await payPress(gymA, manager, sam, deskA.id);
    expect(busy.statusCode, busy.body).toBe(409);
    expect(errorOf(busy)).toBe("terminal_busy");
    expect(checkoutsOn(deskA.deviceId)).toHaveLength(1);

    // Tara taps her card: the payment Square took is on her bill, once, as Card on Terminal, with
    // Square's payment id and a receipt; Sam's bill and B's are untouched.
    square.at(deskA.deviceId).sees();
    expect((await check(gymA, manager, tara.entryId, started.payment.id)).payment).toMatchObject({ step: "waiting", pickedUp: true });
    square.at(deskA.deviceId).taps();
    const paid = await check(gymA, manager, tara.entryId, started.payment.id);
    expect(paid.payment).toMatchObject({ step: "done", outcome: "paid" });
    expect(paid.payment.receiptNumber).not.toBeNull();
    const squarePaymentId = checkoutsOn(deskA.deviceId)[0]?.paymentIds[0];
    const recorded = await paymentsOf(gymA.id);
    expect(recorded).toEqual([
      { bill_id: billId, held_membership_id: tara.membershipId, amount_minor: 4999, method: "terminal", provider: "square", provider_payment_id: squarePaymentId, recorded_by: manager.userId },
    ]);
    expect((await held(gymA, gymA.owner, sam.entryId)).memberships[0]?.billing?.pay).toMatchObject({ leftMinor: 4999 });
    expect(await paymentsOf(gymB.id)).toEqual([]);

    // Asked again, by the page, the worker and the same press: still one payment.
    await check(gymA, manager, tara.entryId, started.payment.id);
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.idleMs + 1000);
    await work([gymA.id]);
    await sql`UPDATE gym_terminal_payments SET state = 'waiting', outcome = NULL, member_payment_id = NULL, finished_at = NULL WHERE id = ${started.payment.id}`;
    await work([gymA.id]);
    expect(await paymentsOf(gymA.id)).toHaveLength(1);
    expect((await check(gymA, manager, tara.entryId, started.payment.id)).payment.outcome).toBe("paid");

    // Its bill reads paid, and it cannot be voided here: Square holds that money.
    const view = await held(gymA, gymA.owner, tara.entryId);
    expect(view.memberships[0]?.billing?.undo).toBeNull();
    const paymentId = (await sql<{ id: string }[]>`SELECT id FROM gym_member_payments WHERE gym_id = ${gymA.id}`)[0]?.id ?? "";
    const voided = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/payments/${paymentId}/void`, gymA.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(409);
    expect(errorOf(voided)).toBe("terminal_payment_void");
    expect(await paymentsOf(gymA.id)).toHaveLength(1);
  });

  it("each way it ends without money records nothing, and frees the Terminal", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Ends");
    const acct = account(`TPE${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    const person = await owing(gym, typeId, "Noor Ali");
    for (const [behaviour, outcome] of [
      ["cancels", "cancelled_on_terminal"],
      ["times_out", "no_answer"],
    ] as const) {
      const desk = await terminal(gym, acct, behaviour);
      const started = await pay(gym, gym.owner, person, desk.id);
      expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment, behaviour).toMatchObject({ step: "done", outcome });
    }
    // An offline Terminal never shows it: cancelled after a minute.
    const offline = await terminal(gym, acct, "offline");
    const waiting = await pay(gym, gym.owner, person, offline.id);
    expect((await check(gym, gym.owner, person.entryId, waiting.payment.id)).payment.step).toBe("waiting");
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.notShownMs + 1000);
    expect((await check(gym, gym.owner, person.entryId, waiting.payment.id)).payment).toMatchObject({ step: "done", outcome: "no_answer" });
    expect(checkoutsOn(offline.deviceId)[0]?.status).toBe("CANCELED");
    // The person cancels on a Terminal a person stands at; staff cancel one.
    const desk = await terminal(gym, acct);
    const byPerson = await pay(gym, gym.owner, person, desk.id);
    square.at(desk.deviceId).cancels();
    expect((await check(gym, gym.owner, person.entryId, byPerson.payment.id)).payment).toMatchObject({ step: "done", outcome: "cancelled_on_terminal" });
    const byStaff = await pay(gym, gym.owner, person, desk.id);
    expect((await cancel(gym, gym.owner, person.entryId, byStaff.payment.id)).payment).toMatchObject({ step: "done", outcome: "cancelled" });
    expect(checkoutsOn(desk.deviceId).at(-1)?.status).toBe("CANCELED");
    // Square refuses a new checkout: said at once, nothing waits.
    square.state.refuseNew = true;
    const refused = await payPress(gym, gym.owner, person, desk.id);
    square.state.refuseNew = false;
    expect(refused.statusCode, refused.body).toBe(409);
    expect(errorOf(refused)).toBe("terminal_refused");
    expect(await paymentsOf(gym.id)).toEqual([]);
    // The month is still owed, and can be taken: the Terminal is free again.
    const again = await pay(gym, gym.owner, person, desk.id);
    square.at(desk.deviceId).taps();
    expect((await check(gym, gym.owner, person.entryId, again.payment.id)).payment.outcome).toBe("paid");
  });

  it("Cancel too late: the person is paying, the box says so, and the payment is recorded", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Too Late");
    const acct = account(`TPL${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Ravi Rao");
    const desk = await terminal(gym, acct);
    const started = await pay(gym, gym.owner, person, desk.id);
    square.at(desk.deviceId).paying();
    expect((await cancel(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "waiting", tooLate: true, stopping: false });
    square.at(desk.deviceId).taps();
    expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment.outcome).toBe("paid");
    expect(await paymentsOf(gym.id)).toHaveLength(1);
  });

  it("money Square took other than asked is never put on the bill, and is kept and told to the gym", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Other");
    const acct = account(`TPO${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Mia Wong");
    const desk = await terminal(gym, acct);
    for (const over of [{ tip_money: { amount: 500, currency: "USD" }, total_money: { amount: 5499, currency: "USD" } }, { location_id: "LSOMEWHEREELSE" }]) {
      const started = await pay(gym, gym.owner, person, desk.id);
      square.at(desk.deviceId).taps(over);
      expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "done", outcome: "not_recorded" });
    }
    expect(await paymentsOf(gym.id)).toEqual([]);
    const audit = await sql<{ action: string }[]>`SELECT action FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.terminal_payment_not_recorded'`;
    expect(audit).toHaveLength(2);
    // Kept past the day the others are kept.
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.keepMs + 60_000);
    await work([gym.id]);
    expect(await sql`SELECT id FROM gym_terminal_payments WHERE gym_id = ${gym.id} AND outcome = 'not_recorded'`).toHaveLength(2);
  });

  it("a page closed while it waits: the worker records what the Terminal took", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Closed");
    const acct = account(`TPC${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Leo Park");
    const desk = await terminal(gym, acct);
    const started = await pay(gym, gym.owner, person, desk.id);
    square.at(desk.deviceId).taps();
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.idleMs + 1000);
    expect((await work([gym.id])).terminalPayments.asked).toBe(1);
    expect(await paymentsOf(gym.id)).toHaveLength(1);
    expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment.outcome).toBe("paid");
  });

  it("Square's answer lost on the way: Cancel stops the checkout Square made, and only Square's word says Cancelled", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Lost");
    const acct = account(`TPX${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Ivy Cole");
    const desk = await terminal(gym, acct);
    // Square makes the checkout and the answer never arrives: the payment waits, with no id kept.
    square.state.loseAnswers = true;
    const started = await pay(gym, gym.owner, person, desk.id);
    square.state.loseAnswers = false;
    expect(started.payment.step).toBe("waiting");
    expect(checkoutsOn(desk.deviceId)).toHaveLength(1);
    // Square down while Cancel is pressed: not said Cancelled, still waiting, the bill still held.
    square.state.down = true;
    expect((await cancel(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "waiting", stopping: true });
    const byHand = await send("POST", `${entryUrl(gym, person.entryId)}/memberships/${person.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" });
    expect(byHand.statusCode).toBe(409);
    // Square back: asked with the press's own key, the same checkout comes back and is stopped.
    square.state.down = false;
    expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "done", outcome: "cancelled" });
    expect(checkoutsOn(desk.deviceId).map((c) => c.status)).toEqual(["CANCELED"]);
    expect(await paymentsOf(gym.id)).toEqual([]);
  });

  it("a checkout Square will not show: kept waiting until Square's own time is past, then left to check in Square, and told", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Unread");
    const acct = account(`TPU${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Max Hart");
    const desk = await terminal(gym, acct);
    const started = await pay(gym, gym.owner, person, desk.id);
    square.state.refuseRead = true;
    try {
      expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment.step).toBe("waiting");
      clock = new Date(clock.getTime() + TERMINAL_PAYMENT.deadlineMs + TERMINAL_PAYMENT.graceMs + 1000);
      expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "done", outcome: "gone" });
    } finally {
      square.state.refuseRead = false;
    }
    expect(await sql`SELECT action FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.terminal_payment_unchecked'`).toHaveLength(1);
    // The bill is not held any longer.
    const byHand = await send("POST", `${entryUrl(gym, person.entryId)}/memberships/${person.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" });
    expect(byHand.statusCode, byHand.body).toBe(200);
  });

  it("the page's list: the Terminals to choose and what waits; a refused body and too much are refused before Square", async () => {
    clock = new Date();
    const gym = await makeGym("Pay List");
    const acct = account(`TPI${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Ada King");
    const desk = await terminal(gym, acct);
    const listed = async () => {
      const res = await send("GET", `${entryUrl(gym, person.entryId)}/terminal-payments`, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      return terminalPaymentsResponseSchema.parse(JSON.parse(res.body));
    };
    expect(await listed()).toEqual({ terminals: [{ id: desk.id, serial: desk.deviceId, practice: null }], waiting: [] });
    const started = await pay(gym, gym.owner, person, desk.id);
    expect((await listed()).waiting.map((w) => w.id)).toEqual([started.payment.id]);
    await cancel(gym, gym.owner, person.entryId, started.payment.id);

    const bad = await payPress(gym, gym.owner, person, desk.id, { amountMinor: "49.99" });
    expect(bad.statusCode).toBe(400);
    const tooMuch = await payPress(gym, gym.owner, person, desk.id, { amountMinor: 5000 });
    expect(tooMuch.statusCode, tooMuch.body).toBe(409);
    expect(errorOf(tooMuch)).toBe("payment_too_much");
    expect(checkoutsOn(desk.deviceId)).toHaveLength(1);
  });
});
