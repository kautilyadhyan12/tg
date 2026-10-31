// Save card on Terminal (ROADMAP 18d-ii-b-ii; spec Part 3 §14.5), through its routes against real
// Postgres (DATABASE_URL-gated), with Square answered by a fake that keeps accounts, tokens,
// customers, cards and Terminal actions as Square does: a token reaches only its own account and
// its own Terminals, an action asked for again with its key is the same action, a CONFIRMATION
// comes back with its words and the person's answer, and a SAVE_CARD saves the card the person
// gives on the customer it names. Square's own test area answered the same way on 2026-10-21
// (`apps/api/.cost/18d-ii-b-ii/probe-confirm-then-save.mts`).
//
// The first block is the worst thing this job could do to a real person: somebody else's card
// saved on them, or their card saved without their own I agree on the Terminal.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  cardAgreementWords,
  memberCardResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalSaveResponseSchema,
  type MemberCardView,
  type SquareCard,
  type SquareLocation,
  type SquareTerminalAction,
  type TerminalSaveResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import type { NewTerminalAction, SquareApi, SquareResult } from "../src/modules/orgs/payments/square.js";
import { TERMINAL_SAVE } from "../src/modules/orgs/payments/terminalCards.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 9).toString("base64"); // dummy test key, gitleaks:allow
// Square's other environment from `payments.routes.test.ts` and `squareTerminals.routes.test.ts`,
// as `memberCards.routes.test.ts` is: their workers run over their own environment's rows.
const APP_ID = "sq0idp-TERMINALCARDSAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "terminal-cards-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-TERMINALCARDSSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_terminal_cards";

interface Account {
  merchantId: string;
  businessName: string;
  country: string;
  locations: SquareLocation[];
}
interface FakeCard {
  accountId: string;
  customerId: string;
  enabled: boolean;
  brand: string;
  last4: string;
}
/** How a Terminal answers: as the person at it does (`person`, driven by the test), or as one of
 *  Square's simulated Terminals, each on its first look. */
type Behaviour = "person" | "saves" | "declines" | "cancels" | "times_out" | "offline";
interface FakeAction {
  id: string;
  accountId: string;
  key: string;
  deviceId: string;
  type: "CONFIRMATION" | "SAVE_CARD";
  status: string;
  cancelReason: string | null;
  body: string | null;
  hasAgreed: boolean | null;
  customerId: string | null;
  cardId: string | null;
  /** The person confirmed their email on the Terminal: Square no longer cancels the save. */
  confirmed: boolean;
  /** Square's own time of its last change. */
  updatedAt: string | null;
}

function fakeSquare() {
  const codes = new Map<string, Account>();
  const tokens = new Map<string, Account>();
  const customers = new Map<string, { accountId: string; referenceId: string }>();
  const customerKeys = new Map<string, string>();
  const cards = new Map<string, FakeCard>();
  const devices = new Map<string, { accountId: string; behaviour: Behaviour }>();
  const actions = new Map<string, FakeAction>();
  const actionKeys = new Map<string, string>();
  // `down`: no answer at all. `loseAnswers`: a new action is made and its answer lost on the
  // way. `wordsSaid`: the Terminal answers for other words than asked. `answerAs`: Square's
  // answer names another Terminal or another kind of action.
  const state: { down: boolean; loseAnswers: boolean; wordsSaid: string | null; answerAs: { device_id?: string | undefined; type?: string | undefined } | null } = {
    down: false,
    loseAnswers: false,
    wordsSaid: null,
    answerAs: null,
  };
  let n = 0;
  const unavailable = { kind: "unavailable", status: 503 } as const;
  const unauthorized = { kind: "refused", status: 401, code: "UNAUTHORIZED" } as const;
  const notFound = { kind: "refused", status: 404, code: "NOT_FOUND" } as const;
  const cardJson = (id: string, c: FakeCard): SquareCard => ({
    id,
    card_brand: c.brand,
    last_4: c.last4,
    exp_month: 12,
    exp_year: 2031,
    customer_id: c.customerId,
    merchant_id: c.accountId,
    enabled: c.enabled,
  });
  const actionJson = (a: FakeAction): SquareTerminalAction => ({
    id: a.id,
    device_id: a.deviceId,
    type: a.type,
    status: a.status,
    ...(a.cancelReason === null ? {} : { cancel_reason: a.cancelReason }),
    ...(a.updatedAt === null ? {} : { updated_at: a.updatedAt }),
    ...(a.type === "CONFIRMATION"
      ? { confirmation_options: { body: state.wordsSaid ?? a.body, ...(a.hasAgreed === null ? {} : { decision: { has_agreed: a.hasAgreed } }) } }
      : { save_card_options: { customer_id: a.customerId, ...(a.cardId === null ? {} : { card_id: a.cardId }) } }),
  });
  const makeCard = (accountId: string, customerId: string, brand = "VISA", last4 = "1111"): string => {
    n += 1;
    const id = `ccof:term${String(n)}${randomBytes(4).toString("hex")}`;
    cards.set(id, { accountId, customerId, enabled: true, brand, last4 });
    return id;
  };
  /** A simulated Terminal answers on its first look, as Square's do (measured 2026-10-21). */
  const play = (a: FakeAction) => {
    const behaviour = devices.get(a.deviceId)?.behaviour ?? "person";
    if (a.status !== "PENDING" || behaviour === "person" || behaviour === "offline") return;
    if (behaviour === "cancels") Object.assign(a, { status: "CANCELED", cancelReason: "BUYER_CANCELED" });
    else if (behaviour === "times_out") Object.assign(a, { status: "CANCELED", cancelReason: "TIMED_OUT" });
    else if (a.type === "CONFIRMATION") Object.assign(a, { status: "COMPLETED", hasAgreed: behaviour === "saves" });
    else if (a.customerId !== null) Object.assign(a, { status: "COMPLETED", cardId: makeCard(a.accountId, a.customerId) });
  };
  const api: SquareApi = {
    authorizeUrl: (s) => `https://connect.squareup.com/oauth2/authorize?state=${s}`,
    exchangeCode(code) {
      const account = codes.get(code);
      codes.delete(code);
      if (account === undefined) return Promise.resolve({ kind: "refused", status: 400, code: "invalid_request" });
      n += 1;
      const access = `EAAAfake-tcards-${String(n)}-${randomBytes(6).toString("hex")}`;
      tokens.set(access, account);
      return Promise.resolve({
        kind: "ok",
        value: { access_token: access, token_type: "bearer", expires_at: "2099-01-01T00:00:00Z", merchant_id: account.merchantId, refresh_token: `EQAAfake-tcards-${String(n)}-xxxxxxxx` },
      });
    },
    refresh: () => Promise.resolve(unauthorized),
    revoke(token) {
      tokens.delete(token);
      return Promise.resolve({ kind: "ok", value: null });
    },
    tokenStatus(token) {
      const a = tokens.get(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: { merchant_id: a.merchantId } });
    },
    merchant(token): Promise<SquareResult<{ id: string; business_name?: string; country: string; currency: string }>> {
      const a = tokens.get(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: { id: a.merchantId, business_name: a.businessName, country: a.country, currency: a.country === "US" ? "USD" : "GBP" } });
    },
    locations(token) {
      const a = tokens.get(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: a.locations });
    },
    createCustomer(token, c) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const again = customerKeys.get(`${a.merchantId}:${c.idempotencyKey}`);
      if (again !== undefined) return Promise.resolve({ kind: "ok", value: { id: again } });
      n += 1;
      const id = `CUST${String(n)}${randomBytes(4).toString("hex").toUpperCase()}`;
      customers.set(id, { accountId: a.merchantId, referenceId: c.referenceId });
      customerKeys.set(`${a.merchantId}:${c.idempotencyKey}`, id);
      return Promise.resolve({ kind: "ok", value: { id } });
    },
    createCard: () => Promise.resolve(unavailable),
    retrieveCard(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const card = cards.get(id);
      return Promise.resolve(card?.accountId !== a.merchantId ? notFound : { kind: "ok", value: cardJson(id, card) });
    },
    retrieveCustomer: () => Promise.resolve(unavailable),
    disableCard(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const card = cards.get(id);
      if (card?.accountId !== a.merchantId) return Promise.resolve(notFound);
      card.enabled = false;
      return Promise.resolve({ kind: "ok", value: cardJson(id, card) });
    },
    revokeAccount: () => Promise.resolve(unavailable),
    createDeviceCode: () => Promise.resolve(unavailable),
    retrieveDeviceCode: () => Promise.resolve(unavailable),
    createTerminalAction(token, c: NewTerminalAction) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      // Only a Terminal signed in to this account takes its actions.
      if (devices.get(c.deviceId)?.accountId !== a.merchantId) return Promise.resolve(notFound);
      const again = actionKeys.get(`${a.merchantId}:${c.idempotencyKey}`);
      const known = again === undefined ? undefined : actions.get(again);
      if (known !== undefined) return Promise.resolve({ kind: "ok", value: actionJson(known) });
      if (c.type === "SAVE_CARD" && customers.get(c.customerId)?.accountId !== a.merchantId) return Promise.resolve({ kind: "refused", status: 400, code: "NOT_FOUND" });
      n += 1;
      const made: FakeAction = {
        id: `termapia:${String(n)}${randomBytes(5).toString("hex")}`,
        accountId: a.merchantId,
        key: c.idempotencyKey,
        deviceId: c.deviceId,
        type: c.type,
        status: "PENDING",
        cancelReason: null,
        body: c.type === "CONFIRMATION" ? c.body : null,
        hasAgreed: null,
        customerId: c.type === "SAVE_CARD" ? c.customerId : null,
        cardId: null,
        confirmed: false,
        updatedAt: null,
      };
      actions.set(made.id, made);
      actionKeys.set(`${a.merchantId}:${c.idempotencyKey}`, made.id);
      if (state.loseAnswers) return Promise.resolve(unavailable);
      return Promise.resolve({ kind: "ok", value: actionJson(made) });
    },
    getTerminalAction(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const action = actions.get(id);
      if (action?.accountId !== a.merchantId) return Promise.resolve(notFound);
      play(action);
      return Promise.resolve({ kind: "ok", value: { ...actionJson(action), ...(state.answerAs ?? {}) } });
    },
    cancelTerminalAction(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const action = actions.get(id);
      if (action?.accountId !== a.merchantId) return Promise.resolve(notFound);
      if (action.status === "COMPLETED" || action.status === "CANCELED" || action.confirmed) return Promise.resolve({ kind: "refused", status: 400, code: "BAD_REQUEST" });
      Object.assign(action, { status: "CANCELED", cancelReason: "SELLER_CANCELED" });
      return Promise.resolve({ kind: "ok", value: actionJson(action) });
    },
    createTerminalCheckout: () => Promise.resolve(unavailable),
    getTerminalCheckout: () => Promise.resolve(unavailable),
    cancelTerminalCheckout: () => Promise.resolve(unavailable),
    getPayment: () => Promise.resolve(unavailable),
    createCardPayment: () => Promise.resolve(unavailable),
    listPayments: () => Promise.resolve(unavailable),
    searchCustomers: () => Promise.resolve(unavailable),
    searchSubscriptions: () => Promise.resolve(unavailable),
    deleteCustomer: () => Promise.resolve(unavailable),

    refundPayment: () => Promise.resolve({ kind: "unavailable", status: null }),

    getRefund: () => Promise.resolve({ kind: "unavailable", status: null }),
    createTerminalRefund: () => Promise.resolve({ kind: "unavailable", status: null }),
    getTerminalRefund: () => Promise.resolve({ kind: "unavailable", status: null }),
    cancelTerminalRefund: () => Promise.resolve({ kind: "unavailable", status: null }),
  };
  const allow = (account: Account): string => {
    const code = `sq0cgp-${randomBytes(8).toString("hex")}`;
    codes.set(code, account);
    return code;
  };
  const open = (deviceId: string, type: "CONFIRMATION" | "SAVE_CARD"): FakeAction => {
    const found = [...actions.values()].filter((x) => x.deviceId === deviceId && x.type === type && (x.status === "PENDING" || x.status === "IN_PROGRESS"));
    const last = found[found.length - 1];
    if (last === undefined) throw new Error(`no ${type} waiting on ${deviceId}`);
    return last;
  };
  /** The person at a Terminal. */
  const at = (deviceId: string) => ({
    sees: () => Object.assign(open(deviceId, "CONFIRMATION"), { status: "IN_PROGRESS" }),
    agrees: (at: Date | null = null) => Object.assign(open(deviceId, "CONFIRMATION"), { status: "COMPLETED", hasAgreed: true, updatedAt: at === null ? null : at.toISOString() }),
    disagrees: () => Object.assign(open(deviceId, "CONFIRMATION"), { status: "COMPLETED", hasAgreed: false }),
    cancels: () => Object.assign(open(deviceId, "CONFIRMATION"), { status: "CANCELED", cancelReason: "BUYER_CANCELED" }),
    confirmsEmail: () => Object.assign(open(deviceId, "SAVE_CARD"), { status: "IN_PROGRESS", confirmed: true }),
    /** The card goes in; Square saves it on `onCustomer`, the action's own unless a test says. */
    gives: (last4: string, onCustomer?: string) => {
      const a = open(deviceId, "SAVE_CARD");
      Object.assign(a, { status: "COMPLETED", cardId: makeCard(a.accountId, onCustomer ?? a.customerId ?? "", "VISA", last4) });
    },
  });
  return { api, allow, state, devices, actions, cards, customers, at };
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
const nextIp = () => `10.48.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const account = (merchantId: string, country = "US"): Account => ({
  merchantId,
  businessName: `${merchantId} Fitness LLC`,
  country,
  locations: [{ id: `L${merchantId}`, name: `${merchantId} Main St`, status: "ACTIVE", country, currency: country === "US" ? "USD" : "GBP", capabilities: ["CREDIT_CARD_PROCESSING"] }],
});

d("Save card on Terminal: the person's own I agree, then their card, on them alone (real Postgres)", { timeout: T }, () => {
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

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tcard-t-%@example.com')`;
  const mine = async (): Promise<string[]> => (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tcard-t-%@example.com')`).map((r) => r.id);
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'tcard-t-%@example.com'`;
    await sql`DELETE FROM gym_terminal_card_saves WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_disables WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_customers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_terminals WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'tcard-t-%@example.com'`;
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
    const email = `tcard-t-${uniq()}@example.com`;
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
    const timezone = country === "US" ? "America/Chicago" : "Europe/London";
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country, timezone });
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
  const record = async (gym: Gym, fullName: string): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
      VALUES (${gym.id}, ${fullName}, ${`tcard-r-${uniq()}@example.com`}, encode(sha256(${`tcard-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    if (row === undefined) throw new Error("no record");
    return row.id;
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

  const cardUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/card`;
  const startPress = (gym: Gym, by: Person, entryId: string, terminalId: string, requestKey: string = randomUUID()) =>
    send("POST", `${cardUrl(gym, entryId)}/terminal`, by.cookies, { terminalId, requestKey });
  const parsed = (res: { statusCode: number; body: string }): TerminalSaveResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return terminalSaveResponseSchema.parse(JSON.parse(res.body));
  };
  const start = async (gym: Gym, by: Person, entryId: string, terminalId: string) => parsed(await startPress(gym, by, entryId, terminalId));
  const checkPress = (gym: Gym, by: Person, entryId: string, saveId: string) => send("GET", `${cardUrl(gym, entryId)}/terminal/${saveId}`, by.cookies);
  const check = async (gym: Gym, by: Person, entryId: string, saveId: string) => parsed(await checkPress(gym, by, entryId, saveId));
  const cancelPress = (gym: Gym, by: Person, entryId: string, saveId: string) => send("POST", `${cardUrl(gym, entryId)}/terminal/${saveId}/cancel`, by.cookies);
  const view = async (gym: Gym, by: Person, entryId: string): Promise<MemberCardView> => {
    const res = await send("GET", cardUrl(gym, entryId), by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberCardResponseSchema.parse(JSON.parse(res.body)).cardOnFile;
  };
  const cardRows = (gymId: string) =>
    sql<{ entry_id: string; account_id: string; customer_id: string; card_id: string; last4: string; saved_from: string; saved_by: string | null }[]>`
      SELECT entry_id, account_id, customer_id, card_id, last4, saved_from, saved_by FROM gym_member_cards WHERE gym_id = ${gymId} ORDER BY saved_at`;
  const agreementsOf = (gymId: string) =>
    sql<{ entry_id: string | null; words: string; screen: string; screen_user_id: string | null; device_id: string | null; last4: string }[]>`
      SELECT entry_id, words, screen, screen_user_id, device_id, last4 FROM gym_card_agreements WHERE gym_id = ${gymId} ORDER BY agreed_at, id`;
  const customerOf = async (gymId: string, entryId: string): Promise<string | null> =>
    (await sql<{ customer_id: string | null }[]>`SELECT customer_id FROM gym_square_customers WHERE gym_id = ${gymId} AND entry_id = ${entryId}`)[0]?.customer_id ?? null;
  const actionsOn = (deviceId: string, type?: "CONFIRMATION" | "SAVE_CARD") => [...square.actions.values()].filter((a) => a.deviceId === deviceId && (type === undefined || a.type === type));
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

  it("the worst thing: the card lands on the person whose save it is, only after their own I agree, never in another gym", async () => {
    clock = new Date();
    const gymA = await makeGym("Terminal Worst A");
    const gymB = await makeGym("Terminal Worst B");
    const accountA = account(`TCWA${uniq().slice(-6)}`);
    const accountB = account(`TCWB${uniq().slice(-6)}`);
    await connect(gymA, accountA);
    await connect(gymB, accountB);
    const manager = await signedIn("Desk Manager");
    const trainer = await signedIn("Desk Trainer");
    const stranger = await signedIn("Desk Stranger");
    await staff(gymA, manager, "manager");
    await staff(gymA, trainer, "trainer");
    const tara = await record(gymA, "Tara Singh");
    const sam = await record(gymA, "Sam Lee");
    const bea = await record(gymB, "Bea Brown");
    const deskA = await terminal(gymA, accountA);
    const deskB = await terminal(gymB, accountB);

    // Nobody who may not save a card here reaches a Terminal: another gym's owner (with A's
    // record at A's address or at B's, or B's own record on A's Terminal), a trainer, a stranger.
    for (const [path, who, terminalId, status] of [
      [cardUrl(gymA, tara), gymB.owner, deskA.id, 404],
      [cardUrl(gymB, tara), gymB.owner, deskA.id, 404],
      [cardUrl(gymB, bea), gymB.owner, deskA.id, 404],
      [cardUrl(gymA, tara), gymA.owner, deskB.id, 404],
      [cardUrl(gymA, tara), trainer, deskA.id, 403],
      [cardUrl(gymA, tara), stranger, deskA.id, 404],
    ] as const) {
      const res = await send("POST", `${path}/terminal`, who.cookies, { terminalId, requestKey: randomUUID() });
      expect(res.statusCode, `${path} ${res.body}`).toBe(status);
    }
    expect(square.actions.size).toBe(0);

    // The manager presses Save card on Terminal for Tara: the Terminal shows the gym's agreement,
    // word for word, and asks for no card yet.
    const started = await start(gymA, manager, tara, deskA.id);
    expect(started.save).toMatchObject({ step: "agree", outcome: null, entry: "insert_or_swipe", terminal: { id: deskA.id, serial: deskA.deviceId, practice: null } });
    const [confirm] = actionsOn(deskA.deviceId);
    expect(confirm).toMatchObject({ type: "CONFIRMATION", body: cardAgreementWords(gymA.name), status: "PENDING" });
    expect(actionsOn(deskA.deviceId, "SAVE_CARD")).toHaveLength(0);
    expect(actionsOn(deskB.deviceId)).toHaveLength(0);

    // Not agreed yet: asked again and again, still no card is asked for.
    square.at(deskA.deviceId).sees();
    for (let i = 0; i < 3; i++) expect((await check(gymA, manager, tara, started.save.id)).save).toMatchObject({ step: "agree", pickedUp: true });
    expect(actionsOn(deskA.deviceId, "SAVE_CARD")).toHaveLength(0);

    // Another gym, a trainer and a stranger can't read or cancel the save.
    for (const [g, who, entry, status] of [
      [gymB, gymB.owner, tara, 404],
      [gymA, gymB.owner, tara, 404],
      [gymA, trainer, tara, 403],
      [gymA, stranger, tara, 404],
      [gymA, manager, sam, 404],
    ] as const) {
      expect((await checkPress(g, who, entry, started.save.id)).statusCode, `check ${String(status)}`).toBe(status);
      expect((await cancelPress(g, who, entry, started.save.id)).statusCode, `cancel ${String(status)}`).toBe(status);
    }

    // Tara taps I agree: the card is asked for on Tara's own customer, in gym A's account.
    square.at(deskA.deviceId).agrees();
    const agreed = await check(gymA, manager, tara, started.save.id);
    expect(agreed.save.step).toBe("card");
    const taraCustomer = await customerOf(gymA.id, tara);
    expect(square.customers.get(taraCustomer ?? "")).toEqual({ accountId: accountA.merchantId, referenceId: tara });
    expect(actionsOn(deskA.deviceId, "SAVE_CARD")).toMatchObject([{ customerId: taraCustomer, status: "PENDING" }]);

    // She inserts her card: it is Tara's, and only Tara's.
    square.at(deskA.deviceId).gives("4242");
    const done = await check(gymA, manager, tara, started.save.id);
    expect(done.save).toMatchObject({ step: "done", outcome: "saved" });
    expect(done.cardOnFile.card).toMatchObject({ brand: "VISA", last4: "4242", savedFrom: "terminal" });
    expect(done.cardOnFile.terminalSave).toBeNull();
    expect((await cardRows(gymA.id)).map((r) => [r.entry_id, r.account_id, r.customer_id, r.last4, r.saved_from, r.saved_by])).toEqual([
      [tara, accountA.merchantId, taraCustomer, "4242", "terminal", manager.userId],
    ]);
    // Her agreement: the words the Terminal showed, on that Terminal, started by the manager.
    expect(await agreementsOf(gymA.id)).toEqual([
      { entry_id: tara, words: cardAgreementWords(gymA.name), screen: "terminal", screen_user_id: manager.userId, device_id: deskA.deviceId, last4: "4242" },
    ]);
    expect((await view(gymA, gymA.owner, sam)).card).toBeNull();
    expect(await cardRows(gymB.id)).toEqual([]);

    // Sam doesn't agree: no card is ever asked for, and nothing is kept.
    const forSam = await start(gymA, manager, sam, deskA.id);
    const samConfirm = actionsOn(deskA.deviceId, "CONFIRMATION").find((a) => a.status === "PENDING");
    expect(samConfirm?.body).toBe(cardAgreementWords(gymA.name));
    square.at(deskA.deviceId).disagrees();
    expect((await check(gymA, manager, sam, forSam.save.id)).save).toMatchObject({ step: "done", outcome: "not_agreed" });
    expect(actionsOn(deskA.deviceId, "SAVE_CARD")).toHaveLength(1);
    expect((await cardRows(gymA.id)).map((r) => r.entry_id)).toEqual([tara]);

    // The Terminal answers for other words than the gym's agreement: no card is asked for.
    const again = await start(gymA, manager, sam, deskA.id);
    square.state.wordsSaid = "I agree to anything.";
    square.at(deskA.deviceId).agrees();
    expect((await check(gymA, manager, sam, again.save.id)).save).toMatchObject({ step: "done", outcome: "refused" });
    square.state.wordsSaid = null;
    expect(actionsOn(deskA.deviceId, "SAVE_CARD")).toHaveLength(1);

    // Square saves the card on somebody else's customer: never kept, and stopped at Square.
    const third = await start(gymA, manager, sam, deskA.id);
    square.at(deskA.deviceId).agrees();
    expect((await check(gymA, manager, sam, third.save.id)).save.step).toBe("card");
    square.at(deskA.deviceId).gives("9999", taraCustomer ?? "");
    expect((await check(gymA, manager, sam, third.save.id)).save).toMatchObject({ step: "done", outcome: "refused" });
    const stray = [...square.cards.values()].find((c) => c.last4 === "9999");
    expect(stray?.enabled).toBe(false);
    expect((await cardRows(gymA.id)).map((r) => [r.entry_id, r.last4])).toEqual([[tara, "4242"]]);
  });

  it("Square's answer naming another Terminal or another kind of action is never acted on (review round one)", async () => {
    clock = new Date();
    const gym = await makeGym("Terminal Not Ours");
    const acct = account(`TCN${uniq().slice(-6)}`);
    await connect(gym, acct);
    const desk = await terminal(gym, acct);
    for (const [answerAs, who] of [
      [{ device_id: "R5SOMEOTHERONE" }, "Ann Other Terminal"],
      [{ type: "SIGNATURE" }, "Ben Other Kind"],
      [{ device_id: undefined }, "Cy No Terminal Named"],
    ] as const) {
      const person = await record(gym, who);
      const started = await start(gym, gym.owner, person, desk.id);
      square.at(desk.deviceId).agrees();
      square.state.answerAs = answerAs;
      expect((await check(gym, gym.owner, person, started.save.id)).save, who).toMatchObject({ step: "done", outcome: "refused" });
      square.state.answerAs = null;
    }
    expect(actionsOn(desk.deviceId, "SAVE_CARD")).toHaveLength(0);
    expect(await cardRows(gym.id)).toEqual([]);
  });

  it("the agreement is kept with Square's own time of I agree; a payer added while the card goes in keeps no card (review round one)", async () => {
    clock = new Date();
    const gym = await makeGym("Terminal Kept");
    const acct = account(`TCK${uniq().slice(-6)}`);
    await connect(gym, acct);
    const desk = await terminal(gym, acct);
    const tara = await record(gym, "Tara Kept");
    const started = await start(gym, gym.owner, tara, desk.id);
    const tapped = new Date(clock.getTime() + 4_000);
    clock = new Date(clock.getTime() + 9_000);
    square.at(desk.deviceId).agrees(tapped);
    expect((await check(gym, gym.owner, tara, started.save.id)).save.step).toBe("card");
    square.at(desk.deviceId).gives("1212");
    expect((await check(gym, gym.owner, tara, started.save.id)).save.outcome).toBe("saved");
    const [kept] = await sql<{ agreed_at: Date }[]>`SELECT agreed_at FROM gym_card_agreements WHERE gym_id = ${gym.id} AND entry_id = ${tara}`;
    expect(kept?.agreed_at.toISOString()).toBe(tapped.toISOString());

    // Aarav: Priya starts paying for him while his card goes in. Nothing is kept, and Square is
    // told to stop the card it saved.
    const aarav = await record(gym, "Aarav Kept");
    const priya = await record(gym, "Priya Kept");
    const second = await start(gym, gym.owner, aarav, desk.id);
    square.at(desk.deviceId).agrees();
    expect((await check(gym, gym.owner, aarav, second.save.id)).save.step).toBe("card");
    const link = await send("PUT", `/v1/orgs/${gym.id}/member-list/entries/${aarav}/payer`, gym.owner.cookies, { payerEntryId: priya });
    expect(link.statusCode, link.body).toBe(200);
    square.at(desk.deviceId).gives("3434");
    const ended = await check(gym, gym.owner, aarav, second.save.id);
    expect(ended.save).toMatchObject({ step: "done", outcome: "gone" });
    expect(ended.cardOnFile.card).toBeNull();
    expect((await cardRows(gym.id)).map((r) => r.entry_id)).toEqual([tara]);
    expect([...square.cards.values()].find((c) => c.last4 === "3434")?.enabled).toBe(false);
  });

  it("what staff see on a person's page: Terminals for the payments tick, Pair a Terminal for the owner, the save waiting", async () => {
    clock = new Date();
    const gym = await makeGym("Terminal View");
    const acct = account(`TCV${uniq().slice(-6)}`);
    await connect(gym, acct);
    const manager = await signedIn("View Manager");
    await staff(gym, manager, "manager");
    const tara = await record(gym, "Tara View");

    // No Terminal yet: the owner gets Pair a Terminal, the manager doesn't.
    expect(await view(gym, gym.owner, tara)).toMatchObject({ terminals: [], pairTerminal: true, terminalSave: null });
    expect(await view(gym, manager, tara)).toMatchObject({ terminals: [], pairTerminal: false });

    const desk = await terminal(gym, acct);
    const both = await view(gym, manager, tara);
    expect(both).toMatchObject({ terminals: [{ id: desk.id, serial: desk.deviceId, practice: null }], pairTerminal: false });
    expect((await view(gym, gym.owner, tara)).pairTerminal).toBe(false);

    // A save waiting is shown on the page, from any page that opens it.
    const started = await start(gym, manager, tara, desk.id);
    expect((await view(gym, gym.owner, tara)).terminalSave).toMatchObject({ id: started.save.id, step: "agree" });

    // A gym in a country where Square saves no card on a Terminal is offered none.
    const uk = await makeGym("Terminal UK", "GB");
    const ukAcct = account(`TCUK${uniq().slice(-6)}`, "GB");
    await connect(uk, ukAcct);
    const ben = await record(uk, "Ben UK");
    expect(await view(uk, uk.owner, ben)).toMatchObject({ state: "ready", terminals: [], pairTerminal: false, terminalSave: null });
    const ukDesk = await terminal(uk, ukAcct);
    const refused = await startPress(uk, uk.owner, ben, ukDesk.id);
    expect(refused.statusCode).toBe(409);
    expect((JSON.parse(refused.body) as { error: string }).error).toBe("terminals_not_offered");
  });

  it("one save at a time: the same press twice is one, a person waits once, a Terminal does one thing", async () => {
    clock = new Date();
    const gym = await makeGym("Terminal Once");
    const acct = account(`TCO${uniq().slice(-6)}`);
    await connect(gym, acct);
    const tara = await record(gym, "Tara Once");
    const sam = await record(gym, "Sam Once");
    const desk = await terminal(gym, acct);
    const other = await terminal(gym, acct);

    // The same press sent twice, at once: one save, one agreement on the Terminal.
    const key = randomUUID();
    const [one, two] = await Promise.all([startPress(gym, gym.owner, tara, desk.id, key), startPress(gym, gym.owner, tara, desk.id, key)]);
    expect(parsed(one).save.id).toBe(parsed(two).save.id);
    expect(actionsOn(desk.deviceId)).toHaveLength(1);

    // Pressed again for Tara (another press, another Terminal): the save waiting is answered.
    const waiting = await start(gym, gym.owner, tara, other.id);
    expect(waiting.save.id).toBe(parsed(one).save.id);
    expect(actionsOn(other.deviceId)).toHaveLength(0);

    // Sam on the busy Terminal: refused; on the other one: fine.
    const busy = await startPress(gym, gym.owner, sam, desk.id);
    expect(busy.statusCode).toBe(409);
    expect((JSON.parse(busy.body) as { error: string }).error).toBe("terminal_busy");
    expect((await start(gym, gym.owner, sam, other.id)).save.step).toBe("agree");
    expect(await sql`SELECT 1 FROM gym_terminal_card_saves WHERE gym_id = ${gym.id} AND state IN ('agreeing','saving')`).toHaveLength(2);

    // A save keeping a Terminal busy that is over (its person deleted, its page closed before the
    // worker's minute): the next press asks Square about it, stops it, and goes ahead.
    const una = await record(gym, "Una Once");
    await sql`DELETE FROM gym_square_customers WHERE gym_id = ${gym.id} AND entry_id = ${tara}`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${tara}`;
    const freed = await start(gym, gym.owner, una, desk.id);
    expect(freed.save).toMatchObject({ step: "agree", terminal: { id: desk.id } });
    const [stale] = await sql<{ state: string; outcome: string }[]>`SELECT state, outcome FROM gym_terminal_card_saves WHERE id = ${parsed(one).save.id}`;
    expect(stale).toEqual({ state: "not_saved", outcome: "gone" });
    expect(actionsOn(desk.deviceId, "CONFIRMATION").map((a) => a.status)).toEqual(["CANCELED", "PENDING"]);
  });

  it("Square's practice Terminals: agrees and saves, doesn't agree, cancels, times out, and offline for a minute at most", async () => {
    clock = new Date();
    const gym = await makeGym("Terminal Practice");
    const acct = account(`TCP${uniq().slice(-6)}`);
    await connect(gym, acct);
    const answers: [Behaviour, string][] = [
      ["saves", "saved"],
      ["declines", "not_agreed"],
      ["cancels", "cancelled_on_terminal"],
      ["times_out", "no_answer"],
    ];
    for (const [behaviour, outcome] of answers) {
      const who = await record(gym, `Pat ${behaviour}`);
      const desk = await terminal(gym, acct, behaviour);
      let after = await start(gym, gym.owner, who, desk.id);
      // Each look moves it one step on, as the page's asking every 3 seconds does.
      for (let i = 0; i < 4 && after.save.step !== "done"; i++) after = await check(gym, gym.owner, who, after.save.id);
      expect(after.save.outcome, behaviour).toBe(outcome);
      expect(after.cardOnFile.card === null, behaviour).toBe(outcome !== "saved");
    }

    // Offline: never on the Terminal; it waits a minute, then is cancelled and the desk told.
    const olu = await record(gym, "Olu Offline");
    const offline = await terminal(gym, acct, "offline");
    const started = await start(gym, gym.owner, olu, offline.id);
    expect((await check(gym, gym.owner, olu, started.save.id)).save).toMatchObject({ step: "agree", pickedUp: false });
    clock = new Date(clock.getTime() + TERMINAL_SAVE.notShownMs - 5000);
    expect((await check(gym, gym.owner, olu, started.save.id)).save).toMatchObject({ step: "agree", pickedUp: false });
    clock = new Date(clock.getTime() + 6000);
    expect((await check(gym, gym.owner, olu, started.save.id)).save).toMatchObject({ step: "done", outcome: "no_answer" });
    expect(actionsOn(offline.deviceId)).toMatchObject([{ status: "CANCELED", cancelReason: "SELLER_CANCELED" }]);

    // On the Terminal's screen: the person has Square's own five minutes to read it.
    const pia = await record(gym, "Pia Reading");
    const desk = await terminal(gym, acct);
    const reading = await start(gym, gym.owner, pia, desk.id);
    square.at(desk.deviceId).sees();
    expect((await check(gym, gym.owner, pia, reading.save.id)).save.pickedUp).toBe(true);
    clock = new Date(clock.getTime() + TERMINAL_SAVE.notShownMs + 60_000);
    expect((await check(gym, gym.owner, pia, reading.save.id)).save).toMatchObject({ step: "agree", outcome: null });
    square.at(desk.deviceId).agrees();
    expect((await check(gym, gym.owner, pia, reading.save.id)).save.step).toBe("card");
  });

  it("Cancel: stops the Terminal while Square lets it; a card already confirmed is saved, as Square saves it", async () => {
    clock = new Date();
    const gym = await makeGym("Terminal Cancel");
    const acct = account(`TCC${uniq().slice(-6)}`);
    await connect(gym, acct);
    const tara = await record(gym, "Tara Cancel");
    const desk = await terminal(gym, acct);

    const first = await start(gym, gym.owner, tara, desk.id);
    const cancelled = parsed(await cancelPress(gym, gym.owner, tara, first.save.id));
    expect(cancelled.save).toMatchObject({ step: "done", outcome: "cancelled" });
    expect(actionsOn(desk.deviceId)).toMatchObject([{ status: "CANCELED" }]);

    // Agreed, and Cancel pressed before the page asked again: no card is asked for.
    const agreedFirst = await start(gym, gym.owner, tara, desk.id);
    square.at(desk.deviceId).agrees();
    expect(parsed(await cancelPress(gym, gym.owner, tara, agreedFirst.save.id)).save).toMatchObject({ step: "done", outcome: "cancelled" });
    expect(actionsOn(desk.deviceId, "SAVE_CARD")).toHaveLength(0);

    // Agreed, card confirmed on the Terminal: too late to stop, so the card is saved.
    const second = await start(gym, gym.owner, tara, desk.id);
    square.at(desk.deviceId).agrees();
    expect((await check(gym, gym.owner, tara, second.save.id)).save.step).toBe("card");
    square.at(desk.deviceId).confirmsEmail();
    expect(parsed(await cancelPress(gym, gym.owner, tara, second.save.id)).save).toMatchObject({ step: "card", stopping: false, tooLate: true });
    square.at(desk.deviceId).gives("5151");
    expect((await check(gym, gym.owner, tara, second.save.id)).save.outcome).toBe("saved");
    expect((await cardRows(gym.id)).map((r) => r.last4)).toEqual(["5151"]);
  });

  it("Cancel pressed while another request is asking Square: it is kept, and that ask stops the Terminal (review round one, High 1)", async () => {
    clock = new Date();
    const gym = await makeGym("Terminal Cancel Race");
    const acct = account(`TCR${uniq().slice(-6)}`);
    await connect(gym, acct);
    const tara = await record(gym, "Tara Race");
    const desk = await terminal(gym, acct);
    const holding = async (id: string) => sql`UPDATE gym_terminal_card_saves SET checking_until = ${new Date(clock.getTime() + 20_000)} WHERE id = ${id}`;
    const letGo = async (id: string) => sql`UPDATE gym_terminal_card_saves SET checking_until = NULL WHERE id = ${id}`;

    // Cancel while the page's own ask holds the save: it says it is stopping, and the next ask stops it.
    const first = await start(gym, gym.owner, tara, desk.id);
    await holding(first.save.id);
    const pressed = parsed(await cancelPress(gym, gym.owner, tara, first.save.id));
    expect(pressed.save).toMatchObject({ step: "agree", outcome: null, stopping: true });
    await letGo(first.save.id);
    expect((await check(gym, gym.owner, tara, first.save.id)).save).toMatchObject({ step: "done", outcome: "cancelled" });
    expect(actionsOn(desk.deviceId)).toMatchObject([{ type: "CONFIRMATION", status: "CANCELED", cancelReason: "SELLER_CANCELED" }]);

    // Cancel while an ask holds it, and the member taps I agree meanwhile: no card is ever asked for.
    const second = await start(gym, gym.owner, tara, desk.id);
    await holding(second.save.id);
    expect(parsed(await cancelPress(gym, gym.owner, tara, second.save.id)).save.stopping).toBe(true);
    square.at(desk.deviceId).agrees();
    await letGo(second.save.id);
    expect((await check(gym, gym.owner, tara, second.save.id)).save).toMatchObject({ step: "done", outcome: "cancelled" });
    expect(actionsOn(desk.deviceId, "SAVE_CARD")).toHaveLength(0);
    expect(await cardRows(gym.id)).toEqual([]);
  });

  it("a page closed while it waits: the worker finishes it, and a record deleted meanwhile keeps nothing", async () => {
    clock = new Date();
    const gym = await makeGym("Terminal Closed");
    const acct = account(`TCX${uniq().slice(-6)}`);
    await connect(gym, acct);
    const tara = await record(gym, "Tara Closed");
    const gone = await record(gym, "Gone Closed");
    const desk = await terminal(gym, acct);
    const desk2 = await terminal(gym, acct);

    // Nobody asks after the press: the worker sends the card step, then keeps the card.
    const started = await start(gym, gym.owner, tara, desk.id);
    square.at(desk.deviceId).agrees();
    clock = new Date(clock.getTime() + TERMINAL_SAVE.idleMs + 1000);
    await work([gym.id]);
    expect(actionsOn(desk.deviceId, "SAVE_CARD")).toHaveLength(1);
    square.at(desk.deviceId).gives("7272");
    clock = new Date(clock.getTime() + TERMINAL_SAVE.idleMs + 1000);
    expect((await work([gym.id])).terminalSaves.asked).toBe(1);
    expect((await view(gym, gym.owner, tara)).card).toMatchObject({ last4: "7272", savedFrom: "terminal" });
    expect((await check(gym, gym.owner, tara, started.save.id)).save.outcome).toBe("saved");

    // A record deleted for good while its card was going in: the card is stopped at Square.
    const doomed = await start(gym, gym.owner, gone, desk2.id);
    square.at(desk2.deviceId).agrees();
    expect((await check(gym, gym.owner, gone, doomed.save.id)).save.step).toBe("card");
    square.at(desk2.deviceId).gives("6060");
    await sql`DELETE FROM gym_square_customers WHERE gym_id = ${gym.id} AND entry_id = ${gone}`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${gone}`;
    clock = new Date(clock.getTime() + TERMINAL_SAVE.idleMs + 1000);
    await work([gym.id]);
    const [row] = await sql<{ state: string; outcome: string; entry_id: string | null }[]>`SELECT state, outcome, entry_id FROM gym_terminal_card_saves WHERE id = ${doomed.save.id}`;
    expect(row).toEqual({ state: "not_saved", outcome: "gone", entry_id: null });
    expect([...square.cards.values()].find((c) => c.last4 === "6060")?.enabled).toBe(false);
    expect((await cardRows(gym.id)).map((r) => r.last4)).toEqual(["7272"]);

    // A done save is forgotten a day after.
    clock = new Date(clock.getTime() + TERMINAL_SAVE.keepMs + 60_000);
    expect((await work([gym.id])).terminalSaves.forgotten).toBe(2);
    expect(await sql`SELECT 1 FROM gym_terminal_card_saves WHERE gym_id = ${gym.id}`).toHaveLength(0);
  });

  it("Square not answering: the press waits, and asks again with the same key, so the Terminal shows it once", async () => {
    clock = new Date();
    const gym = await makeGym("Terminal Down");
    const acct = account(`TCD${uniq().slice(-6)}`);
    await connect(gym, acct);
    const tara = await record(gym, "Tara Down");
    const desk = await terminal(gym, acct);
    // Her customer is made first, so only the Terminal's answer is missing.
    const warm = await start(gym, gym.owner, tara, desk.id);
    await cancelPress(gym, gym.owner, tara, warm.save.id);

    // Square makes the agreement on the Terminal and its answer is lost on the way.
    square.state.loseAnswers = true;
    const started = await start(gym, gym.owner, tara, desk.id);
    square.state.loseAnswers = false;
    expect(started.save).toMatchObject({ step: "agree", outcome: null });
    square.state.down = true;
    expect((await check(gym, gym.owner, tara, started.save.id)).save.step).toBe("agree");
    square.state.down = false;
    expect((await check(gym, gym.owner, tara, started.save.id)).save.step).toBe("agree");
    // Asked again with the same key: Square's one action, not a second on the Terminal.
    const confirms = actionsOn(desk.deviceId, "CONFIRMATION").filter((a) => a.status === "PENDING");
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.body).toBe(cardAgreementWords(gym.name));
    square.at(desk.deviceId).agrees();
    expect((await check(gym, gym.owner, tara, started.save.id)).save.step).toBe("card");
    square.at(desk.deviceId).gives("3030");
    expect((await check(gym, gym.owner, tara, started.save.id)).save.outcome).toBe("saved");
    expect((await cardRows(gym.id)).map((r) => r.last4)).toEqual(["3030"]);
  });
});
