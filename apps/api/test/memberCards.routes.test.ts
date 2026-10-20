// A member's card on file, saved on Square's own form (ROADMAP 18d-ii; spec Part 3 §14.5),
// through its routes against real Postgres (DATABASE_URL-gated), with Square answered by a fake
// that keeps accounts, tokens, customers and cards as Square does: a token reaches only its own
// account, a customer and a card belong to one account, a form's token is used once, and the
// same idempotency key gives back the same card. Square's real test area is run by
// `tools/square-sandbox-check.ts`.
//
// The first block is the worst thing this job could do to a real person: a card saved on the
// wrong person, or without their agreement, so that somebody else's bills could later be
// charged to it.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  cardAgreementWords,
  memberCardResponseSchema,
  myCardResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type MemberCardView,
  type MyCardView,
  type SquareCard,
  type SquareLocation,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { deleteExpiredCardAgreements } from "../src/modules/privacy/repo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import type { SquareApi, SquareResult } from "../src/modules/orgs/payments/square.js";
import { stopSquare } from "../src/modules/orgs/payments/stop.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const WEBHOOK_KEY = "member-cards-webhook-key"; // dummy test key, gitleaks:allow
const WEBHOOK_URL = "https://hooks.example.test/v1/webhooks/square";
// Square's other environment from `payments.routes.test.ts`, whose worker runs days ahead over
// every connection of its own environment in the shared database.
const APP_ID = "sq0idp-MEMBERCARDSAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-cards-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-MEMBERCARDSSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
};

const T = 180_000;
const LIVE_PLAN = "zz_member_cards";

interface Account {
  merchantId: string;
  businessName: string;
  locations: SquareLocation[];
}
interface FakeCard {
  accountId: string;
  customerId: string;
  enabled: boolean;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** Square, as a fake: a form's token reads `cnon:ok-<brand>-<last4>-<month>-<year>`, or
 *  `cnon:declined`. */
function fakeSquare() {
  const codes = new Map<string, Account>();
  const tokens = new Map<string, Account>();
  const customers = new Map<string, { accountId: string; referenceId: string; givenName: string | null; familyName: string | null; email: string | null }>();
  const cards = new Map<string, FakeCard>();
  const keys = new Map<string, string>();
  const usedSources = new Set<string>();
  const revokedAccounts: string[] = [];
  const state: { down: boolean } = { down: false };
  let n = 0;
  const unavailable = { kind: "unavailable", status: 503 } as const;
  const unauthorized = { kind: "refused", status: 401, code: "UNAUTHORIZED" } as const;
  const notFound = { kind: "refused", status: 404, code: "NOT_FOUND" } as const;
  const cardJson = (id: string, c: FakeCard): SquareCard => ({
    id,
    card_brand: c.brand,
    last_4: c.last4,
    exp_month: c.expMonth,
    exp_year: c.expYear,
    customer_id: c.customerId,
    merchant_id: c.accountId,
    enabled: c.enabled,
  });
  const api: SquareApi = {
    authorizeUrl: (s) => `https://connect.squareupsandbox.com/oauth2/authorize?state=${s}`,
    exchangeCode(code) {
      const account = codes.get(code);
      codes.delete(code);
      if (account === undefined) return Promise.resolve({ kind: "refused", status: 400, code: "invalid_request" });
      n += 1;
      const access = `EAAAfake-cards-${String(n)}-${randomBytes(6).toString("hex")}`;
      tokens.set(access, account);
      return Promise.resolve({
        kind: "ok",
        value: { access_token: access, token_type: "bearer", expires_at: "2099-01-01T00:00:00Z", merchant_id: account.merchantId, refresh_token: `EQAAfake-refresh-${String(n)}-${randomBytes(6).toString("hex")}` },
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
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: { id: a.merchantId, business_name: a.businessName, country: "GB", currency: "GBP" } });
    },
    locations(token) {
      const a = tokens.get(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: a.locations });
    },
    createCustomer(token, c) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      n += 1;
      const id = `CUST${String(n)}${randomBytes(4).toString("hex").toUpperCase()}`;
      customers.set(id, { accountId: a.merchantId, referenceId: c.referenceId, givenName: c.givenName, familyName: c.familyName, email: c.email });
      return Promise.resolve({ kind: "ok", value: { id } });
    },
    createCard(token, c) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const customer = customers.get(c.customerId);
      if (customer?.accountId !== a.merchantId) return Promise.resolve({ kind: "refused", status: 400, code: "CUSTOMER_NOT_FOUND" });
      const again = keys.get(`${a.merchantId}:${c.idempotencyKey}`);
      if (again !== undefined) {
        const card = cards.get(again);
        if (card !== undefined) return Promise.resolve({ kind: "ok", value: cardJson(again, card) });
      }
      if (usedSources.has(c.sourceId)) return Promise.resolve({ kind: "refused", status: 400, code: "SOURCE_USED" });
      if (c.sourceId === "cnon:declined") return Promise.resolve({ kind: "refused", status: 400, code: "GENERIC_DECLINE" });
      const m = /^cnon:ok-([A-Z_]+)-([0-9]{4})-([0-9]{1,2})-([0-9]{4})/.exec(c.sourceId);
      if (m === null) return Promise.resolve({ kind: "refused", status: 400, code: "INVALID_CARD_DATA" });
      usedSources.add(c.sourceId);
      n += 1;
      const id = `ccof:fake${String(n)}${randomBytes(4).toString("hex")}`;
      const card: FakeCard = { accountId: a.merchantId, customerId: c.customerId, enabled: true, brand: m[1] ?? "", last4: m[2] ?? "", expMonth: Number(m[3]), expYear: Number(m[4]) };
      cards.set(id, card);
      keys.set(`${a.merchantId}:${c.idempotencyKey}`, id);
      return Promise.resolve({ kind: "ok", value: cardJson(id, card) });
    },
    retrieveCard(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const card = cards.get(id);
      return Promise.resolve(card?.accountId !== a.merchantId ? notFound : { kind: "ok", value: cardJson(id, card) });
    },
    disableCard(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokens.get(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const card = cards.get(id);
      if (card?.accountId !== a.merchantId) return Promise.resolve(notFound);
      card.enabled = false;
      return Promise.resolve({ kind: "ok", value: cardJson(id, card) });
    },
    revokeAccount(accountId) {
      if (state.down) return Promise.resolve(unavailable);
      revokedAccounts.push(accountId);
      for (const [t, a] of tokens) if (a.merchantId === accountId) tokens.delete(t);
      return Promise.resolve({ kind: "ok", value: null });
    },
  };
  const allow = (account: Account): string => {
    const code = `sq0cgb-${randomBytes(8).toString("hex")}`;
    codes.set(code, account);
    return code;
  };
  return { api, allow, customers, cards, revokedAccounts, state };
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
const nextIp = () => `10.44.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const account = (merchantId: string): Account => ({
  merchantId,
  businessName: `${merchantId} Fitness Ltd`,
  locations: [{ id: `L${merchantId}`, name: `${merchantId} High Street`, status: "ACTIVE", country: "GB", currency: "GBP", capabilities: ["CREDIT_CARD_PROCESSING"] }],
});

d("A member's card on file: saved on Square's own form, on the right person, with their agreement (real Postgres)", { timeout: T }, () => {
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

  /** This file's gyms: its worker runs touch nothing else in the shared database. */
  const mine = async (): Promise<string[]> =>
    (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'card-t-%@example.com')`).map((r) => r.id);
  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'card-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'card-t-%@example.com'`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_card_disables WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_square_customers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'card-t-%'`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'card-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, headers: Record<string, string> = {}) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json", ...headers }, payload: typeof payload === "string" ? payload : JSON.stringify(payload) }),
    });

  const signedIn = async (name: string): Promise<Person> => {
    const email = `card-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (name: string, country = "GB"): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country, timezone: "Europe/London" });
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
      VALUES (${gym.id}, ${fullName}, ${`card-r-${uniq()}@example.com`}, encode(sha256(${`card-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    if (row === undefined) throw new Error("no record");
    return row.id;
  };
  /** In the gym's app, linked to `entryId`. */
  const inApp = async (gym: Gym, who: Person, entryId: string) => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${who.userId}, ${entryId})`;
  };
  const connect = async (gym: Gym, acct: Account) => {
    const start = await send("POST", `/v1/orgs/${gym.id}/payments/square/connect`, gym.owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", gym.owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
  };
  const disconnect = async (gym: Gym) => {
    const res = await send("DELETE", `/v1/orgs/${gym.id}/payments/square`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };

  const cardUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/card`;
  const body = (gym: Gym, sourceId: string, over: Record<string, unknown> = {}) => ({
    sourceId,
    agreed: true,
    agreement: cardAgreementWords(gym.name),
    requestKey: randomUUID(),
    ...over,
  });
  const visa = (last4: string, year = 2030) => `cnon:ok-VISA-${last4}-12-${String(year)}-${uniq()}`;
  const saveAt = (gym: Gym, by: Person, entryId: string, payload: unknown) => send("POST", cardUrl(gym, entryId), by.cookies, payload);
  const saved = async (gym: Gym, by: Person, entryId: string, sourceId: string): Promise<MemberCardView> => {
    const res = await saveAt(gym, by, entryId, body(gym, sourceId));
    expect(res.statusCode, res.body).toBe(200);
    return memberCardResponseSchema.parse(JSON.parse(res.body)).cardOnFile;
  };
  const view = async (gym: Gym, by: Person, entryId: string): Promise<MemberCardView> => {
    const res = await send("GET", cardUrl(gym, entryId), by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberCardResponseSchema.parse(JSON.parse(res.body)).cardOnFile;
  };
  const myView = async (gym: Gym, who: Person): Promise<MyCardView> => {
    const res = await send("GET", `/v1/orgs/${gym.id}/my-card`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myCardResponseSchema.parse(JSON.parse(res.body)).myCard;
  };
  const cardRows = (gymId: string) =>
    sql<{ entry_id: string; account_id: string; customer_id: string; card_id: string; last4: string; saved_from: string; saved_by: string | null }[]>`
      SELECT entry_id, account_id, customer_id, card_id, last4, saved_from, saved_by FROM gym_member_cards WHERE gym_id = ${gymId} ORDER BY saved_at`;
  const agreementsOf = (gymId: string) =>
    sql<{ entry_id: string | null; words: string; screen: string; screen_user_id: string | null; last4: string; record_deleted_at: Date | null }[]>`
      SELECT entry_id, words, screen, screen_user_id, last4, record_deleted_at FROM gym_card_agreements WHERE gym_id = ${gymId} ORDER BY agreed_at, id`;
  const owedOf = (gymId: string) => sql<{ card_id: string }[]>`SELECT card_id FROM gym_card_disables WHERE gym_id = ${gymId}`;
  const squareCardsOf = (merchantId: string) => [...square.cards.values()].filter((c) => c.accountId === merchantId);
  const signed = (raw: string) => createHmac("sha256", WEBHOOK_KEY).update(WEBHOOK_URL + raw).digest("base64");
  const webhook = (event: { id: string; type: string; merchantId: string; cardId: string }, sign = true) => {
    const raw = JSON.stringify({ merchant_id: event.merchantId, type: event.type, event_id: event.id, created_at: clock.toISOString(), data: { type: "card", id: event.cardId, object: { card: { id: event.cardId } } } });
    return api().inject({
      method: "POST",
      url: "/v1/webhooks/square",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", ...(sign ? { "x-square-hmacsha256-signature": signed(raw) } : {}) },
      payload: raw,
    });
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'GBP', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
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

  it("the worst thing: a card lands on that person alone, in their own gym's Square account, and never without their tick", async () => {
    clock = new Date();
    const gymA = await makeGym("Card Worst A");
    const gymB = await makeGym("Card Worst B");
    const accountA = account(`MLCWA${uniq().slice(-6)}`);
    const accountB = account(`MLCWB${uniq().slice(-6)}`);
    await connect(gymA, accountA);
    await connect(gymB, accountB);
    const manager = await signedIn("Card Manager");
    const trainer = await signedIn("Card Trainer");
    const stranger = await signedIn("Card Stranger");
    await staff(gymA, manager, "manager");
    await staff(gymA, trainer, "trainer");
    const tara = await record(gymA, "Tara Singh");
    const zed = await record(gymA, "Zed Jones");
    const bea = await record(gymB, "Bea Brown");
    const taraApp = await signedIn("Tara Singh");
    await inApp(gymA, taraApp, tara);

    // Nothing reaches Square, and nothing is kept, for anybody who may not save a card here:
    // another gym's owner (at A's address, or with A's record at B's), a trainer, a stranger,
    // or the member herself at the desk's route.
    for (const [path, who, status] of [
      [cardUrl(gymA, tara), gymB.owner, 404],
      [cardUrl(gymB, tara), gymB.owner, 404],
      [cardUrl(gymA, tara), trainer, 403],
      [cardUrl(gymA, tara), stranger, 404],
      [cardUrl(gymA, tara), taraApp, 404],
    ] as const) {
      const res = await send("POST", path, who.cookies, body(gymA, visa("1111")));
      expect(res.statusCode, `${path} ${res.body}`).toBe(status);
    }
    // Without the person's own tick, or with words other than the ones shown: refused.
    for (const payload of [body(gymA, visa("1111"), { agreed: false }), { ...body(gymA, visa("1111")), agreed: undefined }]) {
      expect((await saveAt(gymA, gymA.owner, tara, payload)).statusCode).toBe(400);
    }
    const changed = await saveAt(gymA, gymA.owner, tara, body(gymA, visa("1111"), { agreement: cardAgreementWords("Some Other Gym") }));
    expect(changed.statusCode).toBe(409);
    expect((JSON.parse(changed.body) as { error: string }).error).toBe("card_agreement_changed");
    expect(square.customers.size === 0 || [...square.customers.values()].every((c) => c.referenceId !== tara)).toBe(true);
    expect(await cardRows(gymA.id)).toEqual([]);

    // The manager saves Tara's card: in gym A's Square account, on a customer that is Tara.
    const after = await saved(gymA, manager, tara, visa("1111"));
    expect(after.card).toMatchObject({ brand: "VISA", last4: "1111", expMonth: 12, expYear: 2030, savedFrom: "desk" });
    const rows = await cardRows(gymA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entry_id: tara, account_id: accountA.merchantId, last4: "1111", saved_from: "desk", saved_by: manager.userId });
    const customer = square.customers.get(rows[0]?.customer_id ?? "");
    expect(customer).toMatchObject({ accountId: accountA.merchantId, referenceId: tara, givenName: "Tara", familyName: "Singh" });
    expect(squareCardsOf(accountA.merchantId)).toHaveLength(1);
    expect(squareCardsOf(accountB.merchantId)).toHaveLength(0);
    // Zed, on the same list, and gym B have nothing.
    expect((await view(gymA, gymA.owner, zed)).card).toBeNull();
    expect(await cardRows(gymB.id)).toEqual([]);
    expect((await view(gymB, gymB.owner, bea)).card).toBeNull();
    // The agreement is kept word for word, with the time and whose screen it was.
    expect(await agreementsOf(gymA.id)).toEqual([
      { entry_id: tara, words: cardAgreementWords(gymA.name), screen: "desk", screen_user_id: manager.userId, last4: "1111", record_deleted_at: null },
    ]);

    // In the app, Tara saves on her own record only: the route names none. Somebody of
    // another gym is a stranger to it, and a record two accounts share saves for neither.
    const mine = await send("POST", `/v1/orgs/${gymA.id}/my-card`, taraApp.cookies, body(gymA, visa("4242")));
    expect(mine.statusCode, mine.body).toBe(200);
    expect(myCardResponseSchema.parse(JSON.parse(mine.body)).myCard.card).toMatchObject({ last4: "4242", savedFrom: "app" });
    expect((await cardRows(gymA.id)).map((r) => [r.entry_id, r.last4, r.saved_from])).toEqual([[tara, "4242", "app"]]);
    const zedApp = await signedIn("Zed Jones");
    const zedTwin = await signedIn("Zed Jones Two");
    await inApp(gymA, zedApp, zed);
    await inApp(gymA, zedTwin, zed);
    const shared = await send("POST", `/v1/orgs/${gymA.id}/my-card`, zedApp.cookies, body(gymA, visa("5555")));
    expect(shared.statusCode).toBe(409);
    expect((await myView(gymA, zedApp)).record).toBe("shared");
    expect((await send("POST", `/v1/orgs/${gymB.id}/my-card`, taraApp.cookies, body(gymB, visa("6666")))).statusCode).toBe(404);
    expect((await send("GET", `/v1/orgs/${gymB.id}/my-card`, taraApp.cookies)).statusCode).toBe(404);
    // A member removes nothing: only the desk does.
    expect((await send("DELETE", `/v1/orgs/${gymA.id}/my-card`, taraApp.cookies)).statusCode).toBe(404);
    expect(squareCardsOf(accountB.merchantId)).toHaveLength(0);

    // Somebody paid for by another person: that person's card is used, so none is saved here.
    const aarav = await record(gymA, "Aarav Sharma");
    const priya = await record(gymA, "Priya Sharma");
    const link = await send("PUT", `/v1/orgs/${gymA.id}/member-list/entries/${aarav}/payer`, gymA.owner.cookies, { payerEntryId: priya });
    expect(link.statusCode, link.body).toBe(200);
    const customersBefore = square.customers.size;
    const paidFor = await saveAt(gymA, gymA.owner, aarav, body(gymA, visa("7777")));
    expect(paidFor.statusCode).toBe(409);
    expect((JSON.parse(paidFor.body) as { message: string }).message).toBe("Priya Sharma pays for Aarav Sharma, so Priya Sharma's card is used.");
    expect(square.customers.size).toBe(customersBefore);
    const aaravView = await view(gymA, gymA.owner, aarav);
    expect(aaravView.paidBy).toEqual({ entryId: priya, name: "Priya Sharma" });
    expect(aaravView.form).toBeNull();
  });

  it("what staff see: only the payments tick reads the card, in the account the gym is connected to now", async () => {
    clock = new Date();
    const gym = await makeGym("Card Seen");
    const trainer = await signedIn("Seen Trainer");
    const manager = await signedIn("Seen Manager");
    await staff(gym, trainer, "trainer");
    await staff(gym, manager, "manager");
    const tara = await record(gym, "Tara Seen");

    // Not connected yet: the owner is told to connect, nobody gets Square's form.
    const before = await view(gym, manager, tara);
    expect(before).toMatchObject({ state: "connect", card: null, isOwner: false, canChange: false, form: null, gymName: gym.name });
    expect((await view(gym, gym.owner, tara)).isOwner).toBe(true);
    expect((await saveAt(gym, gym.owner, tara, body(gym, visa("1111")))).statusCode).toBe(409);

    const first = account(`MLCSA${uniq().slice(-6)}`);
    await connect(gym, first);
    const ready = await view(gym, manager, tara);
    expect(ready).toMatchObject({ state: "ready", canChange: true });
    expect(ready.form).toEqual({
      environment: "production",
      applicationId: APP_ID,
      locationId: `L${first.merchantId}`,
      contact: { givenName: "Tara", familyName: "Seen", email: ready.form?.contact.email ?? null, countryCode: "GB" },
    });
    expect(ready.form?.contact.email).toMatch(/^card-r-.*@example\.com$/);
    await saved(gym, manager, tara, visa("1111", 2020));
    const expired = await view(gym, manager, tara);
    expect(expired.card).toMatchObject({ last4: "1111", expired: true });
    // A member of staff without the payments tick reads nothing of it.
    expect((await send("GET", cardUrl(gym, tara), trainer.cookies)).statusCode).toBe(403);

    // Connected to another Square account since (a hand-over to a new owner does the same: Kd,
    // 2026-10-20): that card is not this gym's to show or use, and it is named so the person is
    // asked to add theirs again, at the desk and in the app.
    const taraApp = await signedIn("Tara Seen");
    await inApp(gym, taraApp, tara);
    await disconnect(gym);
    expect((await view(gym, manager, tara)).card).toBeNull();
    await connect(gym, account(`MLCSB${uniq().slice(-6)}`));
    const since = await view(gym, manager, tara);
    expect(since).toMatchObject({ state: "ready", card: null, earlierCard: { brand: "VISA", last4: "1111" } });
    expect(await myView(gym, taraApp)).toMatchObject({ record: "own", card: null, earlierCard: { brand: "VISA", last4: "1111" }, canSave: true });
    // And the first account again: it is shown again, for it is still in that account.
    await disconnect(gym);
    await connect(gym, first);
    expect(await view(gym, manager, tara)).toMatchObject({ card: { last4: "1111" }, earlierCard: null });

    // A gym outside Square's countries shows nothing.
    const india = await makeGym("Card India", "IN");
    const indian = await record(india, "Isha Rao");
    expect((await view(india, india.owner, indian)).state).toBe("not_offered");
  });

  it("one card a person: a new one replaces the old, which Square is told to stop; the same press twice saves once; Remove", async () => {
    clock = new Date();
    const gym = await makeGym("Card Replace");
    const acct = account(`MLCRA${uniq().slice(-6)}`);
    await connect(gym, acct);
    const tara = await record(gym, "Tara Replace");

    await saved(gym, gym.owner, tara, visa("1111"));
    const [old] = await cardRows(gym.id);
    // The same press sent twice (one key, one form token): one card, one agreement.
    const twice = body(gym, visa("2222"));
    for (let i = 0; i < 2; i++) expect((await saveAt(gym, gym.owner, tara, twice)).statusCode).toBe(200);
    const rows = await cardRows(gym.id);
    expect(rows.map((r) => r.last4)).toEqual(["2222"]);
    expect((await agreementsOf(gym.id)).map((a) => a.last4).sort()).toEqual(["1111", "2222"]);
    // The old card was stopped at Square at once; nothing is left owed.
    expect(square.cards.get(old?.card_id ?? "")?.enabled).toBe(false);
    expect(square.cards.get(rows[0]?.card_id ?? "")?.enabled).toBe(true);
    expect(await owedOf(gym.id)).toEqual([]);
    // One customer for Tara, however many cards.
    expect(new Set(squareCardsOf(acct.merchantId).map((c) => c.customerId)).size).toBe(1);

    // Square refuses a card: nothing is kept, and the card on file stays.
    const declined = await saveAt(gym, gym.owner, tara, body(gym, "cnon:declined"));
    expect(declined.statusCode).toBe(409);
    expect((JSON.parse(declined.body) as { error: string; message: string }).message).toBe("The bank didn't accept this card. Try another card.");
    expect((await cardRows(gym.id)).map((r) => r.last4)).toEqual(["2222"]);

    // Remove: Square down changes nothing; then Square stops it and the record lets go. The
    // agreement stays as the gym's proof.
    square.state.down = true;
    try {
      expect((await send("DELETE", cardUrl(gym, tara), gym.owner.cookies)).statusCode).toBe(503);
    } finally {
      square.state.down = false;
    }
    expect(await cardRows(gym.id)).toHaveLength(1);
    const removed = await send("DELETE", cardUrl(gym, tara), gym.owner.cookies);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(memberCardResponseSchema.parse(JSON.parse(removed.body)).cardOnFile.card).toBeNull();
    expect(square.cards.get(rows[0]?.card_id ?? "")?.enabled).toBe(false);
    expect(await cardRows(gym.id)).toEqual([]);
    expect(await agreementsOf(gym.id)).toHaveLength(2);
    // Pressed twice, removed once.
    expect((await send("DELETE", cardUrl(gym, tara), gym.owner.cookies)).statusCode).toBe(200);
    const notes = await sql<{ action: string; meta: Record<string, string | null> }[]>`
      SELECT action, meta FROM audit_log WHERE gym_id = ${gym.id} AND action LIKE 'org.member_card%' ORDER BY id`;
    expect(notes.map((n) => [n.action, n.meta["last4"], n.meta["replacedLast4"] ?? null])).toEqual([
      ["org.member_card_saved", "1111", null],
      ["org.member_card_saved", "2222", "1111"],
      ["org.member_card_removed", "2222", null],
    ]);

    // Square no longer has the customer (the gym deleted it there): told, and the next save
    // makes a new one.
    await saved(gym, gym.owner, tara, visa("3333"));
    const [kept] = await cardRows(gym.id);
    square.customers.delete(kept?.customer_id ?? "");
    const gone = await saveAt(gym, gym.owner, tara, body(gym, visa("4444")));
    expect((JSON.parse(gone.body) as { error: string }).error).toBe("card_customer_gone");
    await saved(gym, gym.owner, tara, visa("5555"));
    const [fresh] = await cardRows(gym.id);
    expect(fresh?.customer_id).not.toBe(kept?.customer_id);
    expect(square.customers.get(fresh?.customer_id ?? "")?.referenceId).toBe(tara);
  });

  it("Square's card messages: signed, kept once, and Square is asked for the card before anything changes", async () => {
    clock = new Date();
    const gym = await makeGym("Card Messages");
    const acct = account(`MLCMA${uniq().slice(-6)}`);
    await connect(gym, acct);
    const tara = await record(gym, "Tara Messages");
    await saved(gym, gym.owner, tara, visa("1111"));
    const [row] = await cardRows(gym.id);
    const cardId = row?.card_id ?? "";
    const fake = square.cards.get(cardId);
    if (fake === undefined) throw new Error("no card at Square");

    // Unsigned: refused, nothing kept.
    const unsigned = await webhook({ id: `card-t-${uniq()}`, type: "card.automatically_updated", merchantId: acct.merchantId, cardId }, false);
    expect(unsigned.statusCode).toBe(401);
    // The bank sent a new expiry; Square says so. The message alone changes nothing: Square
    // is asked, and what Square says is kept. Sent twice, kept once.
    fake.expYear = 2033;
    fake.expMonth = 4;
    const updated = `card-t-${uniq()}`;
    for (let i = 0; i < 2; i++) expect((await webhook({ id: updated, type: "card.automatically_updated", merchantId: acct.merchantId, cardId })).statusCode).toBe(200);
    expect(await sql`SELECT 1 FROM webhook_events WHERE provider = 'square' AND event_id = ${updated}`).toHaveLength(1);
    expect((await view(gym, gym.owner, tara)).card).toMatchObject({ expMonth: 12, expYear: 2030 });
    // Square down: tried again later. (The worker's clock is the real one: a message is due
    // from the moment it arrived.)
    clock = new Date();
    square.state.down = true;
    try {
      expect((await processSquareWork(workDeps(), [updated], await mine())).deferred).toBe(1);
    } finally {
      square.state.down = false;
    }
    clock = new Date(Date.now() + 2 * 60_000);
    await processSquareWork(workDeps(), [updated], await mine());
    expect((await view(gym, gym.owner, tara)).card).toMatchObject({ last4: "1111", expMonth: 4, expYear: 2033 });

    // A message that a card was stopped which Square does not bear out changes nothing.
    const notReally = `card-t-${uniq()}`;
    await webhook({ id: notReally, type: "card.disabled", merchantId: acct.merchantId, cardId });
    clock = new Date(Date.now() + 1000);
    await processSquareWork(workDeps(), [notReally], await mine());
    expect(await cardRows(gym.id)).toHaveLength(1);
    // Stopped inside Square, as Square says: the record no longer has a card.
    fake.enabled = false;
    const disabled = `card-t-${uniq()}`;
    await webhook({ id: disabled, type: "card.disabled", merchantId: acct.merchantId, cardId });
    clock = new Date(Date.now() + 1000);
    await processSquareWork(workDeps(), [disabled], await mine());
    expect(await cardRows(gym.id)).toEqual([]);
    expect(await agreementsOf(gym.id)).toHaveLength(1);
    expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.member_card_removed_in_square'`).toHaveLength(1);
    // A message about a card of another account or of nobody here: nothing changes.
    const other = `card-t-${uniq()}`;
    await webhook({ id: other, type: "card.forgotten", merchantId: acct.merchantId, cardId: "ccof:nobodyhere" });
    clock = new Date(Date.now() + 1000);
    expect((await processSquareWork(workDeps(), [other], await mine())).unchanged).toBe(1);
  });

  it("two records joined keep the newer card; a record deleted for good owes its card's stop and keeps its agreement", async () => {
    clock = new Date();
    const gym = await makeGym("Card Join");
    const acct = account(`MLCJA${uniq().slice(-6)}`);
    await connect(gym, acct);
    const gone = await record(gym, "Tara Join");
    const keep = await record(gym, "Tara J");
    await saved(gym, gym.owner, keep, visa("1111"));
    clock = new Date(clock.getTime() + 60_000);
    await saved(gym, gym.owner, gone, visa("2222"));
    const [older] = (await cardRows(gym.id)).filter((r) => r.entry_id === keep);
    const merge = await send("POST", `/v1/orgs/${gym.id}/member-list/entries/${gone}/merge`, gym.owner.cookies, { keepEntryId: keep, acknowledgeLeavesList: true });
    expect(merge.statusCode, merge.body).toBe(200);
    expect((await cardRows(gym.id)).map((r) => [r.entry_id, r.last4])).toEqual([[keep, "2222"]]);
    expect((await owedOf(gym.id)).map((o) => o.card_id)).toEqual([older?.card_id]);
    expect((await agreementsOf(gym.id)).map((a) => a.entry_id)).toEqual([keep, keep]);
    // The worker sends the stop (its clock past the join's, which ran a minute ahead).
    clock = new Date(Date.now() + 2 * 60_000);
    await processSquareWork(workDeps(), [], await mine());
    expect(square.cards.get(older?.card_id ?? "")?.enabled).toBe(false);
    expect(await owedOf(gym.id)).toEqual([]);

    // Taken off the list, then deleted for good: Square is owed the card's stop, and the
    // agreements stay with the day, as the gym's proof.
    const off = await send("DELETE", `/v1/orgs/${gym.id}/member-list/entries/${keep}`, gym.owner.cookies);
    expect(off.statusCode, off.body).toBe(200);
    const del = await send("DELETE", `/v1/orgs/${gym.id}/member-list/former/${keep}`, gym.owner.cookies);
    expect(del.statusCode, del.body).toBe(200);
    expect(await cardRows(gym.id)).toEqual([]);
    expect(await owedOf(gym.id)).toHaveLength(1);
    clock = new Date(Date.now() + 3 * 60_000);
    const kept = await agreementsOf(gym.id);
    expect(kept.map((a) => [a.entry_id, a.record_deleted_at === null])).toEqual([
      [null, false],
      [null, false],
    ]);
    await processSquareWork(workDeps(), [], await mine());
    expect(squareCardsOf(acct.merchantId).every((c) => !c.enabled)).toBe(true);

    // The purge removes an agreement once a year has passed since the record went and three
    // since it was agreed; not before.
    const at = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await sql`UPDATE gym_card_agreements SET record_deleted_at = ${at(200)}, agreed_at = ${at(1200)} WHERE gym_id = ${gym.id} AND last4 = '1111'`;
    await sql`UPDATE gym_card_agreements SET record_deleted_at = ${at(400)}, agreed_at = ${at(1200)} WHERE gym_id = ${gym.id} AND last4 = '2222'`;
    await deleteExpiredCardAgreements(sql, new Date());
    expect((await agreementsOf(gym.id)).map((a) => a.last4)).toEqual(["1111"]);
    await sql`UPDATE gym_card_agreements SET record_deleted_at = ${at(400)}, agreed_at = ${at(900)} WHERE gym_id = ${gym.id}`;
    await deleteExpiredCardAgreements(sql, new Date());
    expect(await agreementsOf(gym.id)).toHaveLength(1);
  });

  it("the stop tool: nothing changes without --yes; with it Square ends the account's access and every gym holding it reads disconnected", async () => {
    clock = new Date();
    const gym = await makeGym("Card Stop");
    const other = await makeGym("Card Stop Other");
    const acct = account(`MLCTA${uniq().slice(-6)}`);
    await connect(gym, acct);
    await connect(other, account(`MLCTB${uniq().slice(-6)}`));
    const tara = await record(gym, "Tara Stop");
    await saved(gym, gym.owner, tara, visa("1111"));
    const settings = squareSettings(config(), square.api);
    if (settings === null) throw new Error("no Square settings");

    const dry = await stopSquare(workDeps(), settings, gym.id, false);
    expect(dry).toEqual([{ accountId: acct.merchantId, gyms: [{ gymId: gym.id, name: gym.name }], outcome: "would_stop" }]);
    expect(square.revokedAccounts).not.toContain(acct.merchantId);
    expect((await view(gym, gym.owner, tara)).state).toBe("ready");

    const done = await stopSquare(workDeps(), settings, gym.id, true);
    expect(done.map((a) => a.outcome)).toEqual(["stopped"]);
    expect(square.revokedAccounts).toContain(acct.merchantId);
    const after = await view(gym, gym.owner, tara);
    expect(after).toMatchObject({ state: "connect", card: null, form: null });
    expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.payments_square_stopped'`).toHaveLength(1);
    // The other gym is left alone.
    expect((await sql<{ state: string }[]>`SELECT state FROM gym_payment_connections WHERE gym_id = ${other.id}`)[0]?.state).toBe("connected");
  });
});
