// A gym connects its own Square account (ROADMAP 18d-i; spec Part 3 §14.5), through its
// routes against real Postgres (DATABASE_URL-gated), with Square answered by a fake that
// keeps accounts, codes and tokens as Square does. Square's real test area is run by
// `tools/square-sandbox-check.ts`.
//
// The first block is the worst thing this job could do: one gym's members' card money paid
// into somebody else's Square account: another gym's, a staff member's own, or a stranger's.
import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  gymPaymentsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  startHereResponseSchema,
  type GymPayments,
  type SquareFinishResponse,
  type SquareLocation,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import type { SquareApi, SquareResult } from "../src/modules/orgs/payments/square.js";
import { createTokenBox } from "../src/modules/orgs/payments/tokenBox.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 3).toString("base64"); // dummy test key, gitleaks:allow
const WEBHOOK_KEY = "payments-routes-webhook-key"; // dummy test key, gitleaks:allow
const WEBHOOK_URL = "https://hooks.example.test/v1/webhooks/square";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "payments-routes-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sandbox-sq0idb-PAYMENTSROUTES", // dummy, gitleaks:allow
  SQUARE_APPLICATION_SECRET: "sandbox-sq0csb-PAYMENTSROUTESSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
};

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_payments_routes";

// ── Square, as a fake that behaves as Square does: a code works once, a token works until it
// is revoked, revoking the whole account stops every token of it. ──
interface Account {
  merchantId: string;
  businessName: string;
  country: string;
  currency: string;
  locations: SquareLocation[];
}
const cardLocation = (id: string, name: string, currency = "GBP"): SquareLocation => ({
  id,
  name,
  status: "ACTIVE",
  country: "GB",
  currency,
  capabilities: ["CREDIT_CARD_PROCESSING", "AUTOMATIC_TRANSFERS"],
});

function fakeSquare() {
  const codes = new Map<string, Account>();
  const tokens = new Map<string, { account: Account; stopped: boolean; refresh: string }>();
  const refreshes = new Map<string, Account>();
  const revokes: { token: string; wholeAccount: boolean }[] = [];
  const state = { down: false, exchanges: 0, refreshesRefused: false };
  let n = 0;
  const mint = (account: Account) => {
    n += 1;
    const access = `EAAAfake-access-${String(n)}-${randomBytes(6).toString("hex")}`;
    const refresh = `EQAAfake-refresh-${String(n)}-${randomBytes(6).toString("hex")}`;
    tokens.set(access, { account, stopped: false, refresh });
    refreshes.set(refresh, account);
    return { access_token: access, token_type: "bearer", expires_at: "2099-01-01T00:00:00Z", merchant_id: account.merchantId, refresh_token: refresh };
  };
  const unavailable = { kind: "unavailable", status: 503 } as const;
  const unauthorized = { kind: "refused", status: 401, code: "UNAUTHORIZED" } as const;
  const live = (token: string) => {
    const t = tokens.get(token);
    return t === undefined || t.stopped ? null : t;
  };
  const api: SquareApi = {
    authorizeUrl: (s) => `https://connect.squareupsandbox.com/oauth2/authorize?state=${s}`,
    exchangeCode(code) {
      if (state.down) return Promise.resolve(unavailable);
      state.exchanges += 1;
      const account = codes.get(code);
      codes.delete(code);
      if (account === undefined) return Promise.resolve({ kind: "refused", status: 400, code: "invalid_request" });
      return Promise.resolve({ kind: "ok", value: mint(account) });
    },
    refresh(refreshToken) {
      if (state.down) return Promise.resolve(unavailable);
      const account = refreshes.get(refreshToken);
      const anyLive = [...tokens.values()].some((t) => t.refresh === refreshToken && !t.stopped);
      if (account === undefined || !anyLive || state.refreshesRefused) return Promise.resolve(unauthorized);
      return Promise.resolve({ kind: "ok", value: mint(account) });
    },
    revoke(token, wholeAccount) {
      if (state.down) return Promise.resolve(unavailable);
      revokes.push({ token, wholeAccount });
      const t = tokens.get(token);
      if (t === undefined) return Promise.resolve(unauthorized);
      if (wholeAccount) for (const other of tokens.values()) if (other.account.merchantId === t.account.merchantId) other.stopped = true;
      t.stopped = true;
      return Promise.resolve({ kind: "ok", value: null });
    },
    tokenStatus(token) {
      if (state.down) return Promise.resolve(unavailable);
      const t = live(token);
      return Promise.resolve(t === null ? unauthorized : { kind: "ok", value: { merchant_id: t.account.merchantId } });
    },
    merchant(token): Promise<SquareResult<{ id: string; business_name?: string; country: string; currency: string }>> {
      if (state.down) return Promise.resolve(unavailable);
      const t = live(token);
      if (t === null) return Promise.resolve(unauthorized);
      return Promise.resolve({ kind: "ok", value: { id: t.account.merchantId, business_name: t.account.businessName, country: t.account.country, currency: t.account.currency } });
    },
    locations(token) {
      if (state.down) return Promise.resolve(unavailable);
      const t = live(token);
      return Promise.resolve(t === null ? unauthorized : { kind: "ok", value: t.account.locations });
    },
  };
  /** The gym signs in at Square as this account and presses Allow: Square hands back a code. */
  const allow = (account: Account): string => {
    const code = `sq0cgb-${randomBytes(8).toString("hex")}`;
    codes.set(code, account);
    return code;
  };
  const liveTokensOf = (merchantId: string) => [...tokens.values()].filter((t) => t.account.merchantId === merchantId && !t.stopped).length;
  return { api, allow, revokes, state, liveTokensOf, tokens };
}

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  cookies: Cookies;
}

let ipCounter = 0;
const nextIp = () => `10.42.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const stateOf = (squareUrl: string): string => new URL(squareUrl).searchParams.get("state") ?? "";

d("A gym's own Square account: who connects it, to which gym, and letting it go (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const square = fakeSquare();
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = loadConfig(baseEnv);
  const workDeps = () => ({
    sql,
    square: squareSettings(config, square.api),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    now: () => clock,
  });

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'pay-t-%@example.com')`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'pay-t-%'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'pay-t-%@example.com'`;
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

  const person = async (local: string): Promise<User> => {
    const email = `pay-t-${local}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: `Pay ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  const subscribe = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const gym = async (owner: User, name: string, country = "GB"): Promise<string> => {
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country, timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await subscribe(gymId);
    return gymId;
  };
  const staff = async (gymId: string, who: User, role: "owner" | "manager" | "trainer") => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
  };

  const account = (merchantId: string, over: Partial<Account> = {}): Account => ({
    merchantId,
    businessName: `${merchantId} Fitness Ltd`,
    country: "GB",
    currency: "GBP",
    locations: [cardLocation(`L${merchantId}`, `${merchantId} High Street`)],
    ...over,
  });

  const connectPress = (gymId: string, who: User) => send("POST", `/v1/orgs/${gymId}/payments/square/connect`, who.cookies);
  const startConnect = async (gymId: string, who: User): Promise<string> => {
    const res = await connectPress(gymId, who);
    expect(res.statusCode, res.body).toBe(200);
    return stateOf(squareConnectResponseSchema.parse(JSON.parse(res.body)).url);
  };
  const finishPress = (who: User, body: unknown) => send("POST", "/v1/payments/square/finish", who.cookies, body);
  const finish = async (who: User, body: unknown): Promise<SquareFinishResponse> => {
    const res = await finishPress(who, body);
    expect(res.statusCode, res.body).toBe(200);
    return squareFinishResponseSchema.parse(JSON.parse(res.body));
  };
  const read = async (gymId: string, who: User): Promise<GymPayments> => {
    const res = await send("GET", `/v1/orgs/${gymId}/payments`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return gymPaymentsResponseSchema.parse(JSON.parse(res.body)).payments;
  };
  const connect = async (gymId: string, owner: User, acct: Account) => finish(owner, { state: await startConnect(gymId, owner), code: square.allow(acct) });
  const rowOf = async (gymId: string) =>
    (await sql<{ account_id: string; state: string; access_token: string | null; location_id: string | null }[]>`
      SELECT account_id, state, access_token, location_id FROM gym_payment_connections WHERE gym_id = ${gymId}`)[0] ?? null;
  const owedOf = (gymId: string) => sql<{ whole_account: boolean }[]>`SELECT whole_account FROM gym_payment_revokes WHERE gym_id = ${gymId}`;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(config, {
      squareApi: square.api,
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  it(
    "the worst thing: a gym's members' money never goes into another gym's, a staff member's or a stranger's Square account",
    async () => {
      clock = new Date();
      const ownerA = await person("worst-owner-a");
      const ownerB = await person("worst-owner-b");
      const gymA = await gym(ownerA, "Worst A Gym");
      const gymB = await gym(ownerB, "Worst B Gym");
      const manager = await person("worst-manager");
      const coOwner = await person("worst-co-owner");
      const trainer = await person("worst-trainer");
      const stranger = await person("worst-stranger");
      const member = await person("worst-member");
      await staff(gymA, manager, "manager");
      await staff(gymA, coOwner, "owner");
      await staff(gymA, trainer, "trainer");
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymA}, ${member.userId})`;
      const accountA = account("MLWORSTA");
      const accountB = account("MLWORSTB");
      const accountOfManager = account("MLWORSTMANAGER");

      // Nobody but gym A's own owner may even start: not its co-owner, manager or trainer
      // (each holding a Square account of their own), a member, a stranger, or another
      // gym's owner.
      for (const who of [coOwner, manager, trainer]) expect((await connectPress(gymA, who)).statusCode).toBe(403);
      for (const who of [member, stranger, ownerB]) expect((await connectPress(gymA, who)).statusCode).toBe(404);
      expect(await sql`SELECT 1 FROM gym_payment_connect_starts WHERE gym_id = ${gymA}`).toHaveLength(0);

      // Gym A's owner presses Connect. Square's answer, brought back by anybody else with
      // their own Square account, is refused, and A's press still works for A afterwards.
      const pressA = await startConnect(gymA, ownerA);
      for (const [who, acct] of [[ownerB, accountB], [manager, accountOfManager], [coOwner, accountOfManager], [stranger, accountOfManager]] as const) {
        const res = await finishPress(who, { state: pressA, code: square.allow(acct) });
        expect(res.statusCode, res.body).toBe(404);
      }
      expect(await rowOf(gymA)).toBeNull();
      expect(await rowOf(gymB)).toBeNull();

      // The gym is the press's, never the request's: a finish naming a gym is refused.
      expect((await finishPress(ownerA, { state: pressA, code: square.allow(accountA), gymId: gymB })).statusCode).toBe(400);

      // B's owner presses for B; A's owner bringing B's press back gets nothing either.
      const pressB = await startConnect(gymB, ownerB);
      expect((await finishPress(ownerA, { state: pressB, code: square.allow(accountA) })).statusCode).toBe(404);

      const exchangesBefore = square.state.exchanges;
      const answerA = await finish(ownerA, { state: pressA, code: square.allow(accountA) });
      expect(answerA).toMatchObject({ outcome: "connected", refusal: null });
      expect(answerA.gymSlug).toBe((await sql<{ slug: string }[]>`SELECT slug FROM gyms WHERE id = ${gymA}`)[0]?.slug);
      expect(await finish(ownerB, { state: pressB, code: square.allow(accountB) })).toMatchObject({ outcome: "connected" });
      expect(square.state.exchanges).toBe(exchangesBefore + 2);
      expect((await rowOf(gymA))?.account_id).toBe("MLWORSTA");
      expect((await rowOf(gymB))?.account_id).toBe("MLWORSTB");

      // A press works once: brought back again, even by its owner, it is refused, and Square
      // is never asked to trade the second code.
      const again = await finishPress(ownerA, { state: pressA, code: square.allow(accountOfManager) });
      expect(again.statusCode).toBe(404);
      expect(square.state.exchanges).toBe(exchangesBefore + 2);
      expect((await rowOf(gymA))?.account_id).toBe("MLWORSTA");

      // Ten minutes is all a press lasts.
      await send("DELETE", `/v1/orgs/${gymA}/payments/square`, ownerA.cookies);
      const late = await startConnect(gymA, ownerA);
      clock = new Date(clock.getTime() + 10 * 60_000 + 1000);
      expect((await finishPress(ownerA, { state: late, code: square.allow(accountOfManager) })).statusCode).toBe(404);
      expect(await rowOf(gymA)).toBeNull();

      // An owner who handed the gym on while Square was open is no longer its owner when
      // Square answers.
      clock = new Date();
      const handed = await startConnect(gymA, ownerA);
      await sql`UPDATE gyms SET owner_user_id = ${coOwner.userId} WHERE id = ${gymA}`;
      await sql`UPDATE gym_staff SET role = 'owner' WHERE gym_id = ${gymA} AND user_id = ${coOwner.userId}`;
      expect((await finishPress(ownerA, { state: handed, code: square.allow(accountOfManager) })).statusCode).toBe(403);
      expect(await rowOf(gymA)).toBeNull();

      // The tokens are locked under their own gym: A's copied onto B's row do not open, and
      // the worker finds B's connection gone rather than using A's account for B.
      const tokensOfB = await sql<{ access_token: string }[]>`SELECT access_token FROM gym_payment_connections WHERE gym_id = ${gymB}`;
      const plainB = [...square.tokens.keys()].find((t) => square.tokens.get(t)?.account.merchantId === "MLWORSTB" && square.tokens.get(t)?.stopped === false);
      expect(tokensOfB[0]?.access_token).not.toContain(plainB ?? "none");
      const box = createTokenBox(LOCK_KEY);
      expect(box.open(tokensOfB[0]?.access_token ?? "", { gymId: gymA, provider: "square", kind: "access" })).toBeNull();
      expect(box.open(tokensOfB[0]?.access_token ?? "", { gymId: gymB, provider: "square", kind: "access" })).toBe(plainB);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "what each person reads, by the gym's country",
    async () => {
      clock = new Date();
      const owner = await person("read-owner");
      const manager = await person("read-manager");
      const stranger = await person("read-stranger");
      const gb = await gym(owner, "Read GB Gym");
      const india = await gym(owner, "Read India Gym", "IN");
      const germany = await gym(owner, "Read Germany Gym", "DE");
      const nowhere = await gym(owner, "Read No Country Gym");
      await sql`UPDATE gyms SET country = NULL WHERE id = ${nowhere}`;
      await staff(gb, manager, "manager");

      expect(await read(gb, owner)).toEqual({ availability: "square", country: "GB", canConnect: true, squareReady: true, square: null });
      expect(await read(gb, manager)).toEqual({ availability: "square", country: "GB", canConnect: false, squareReady: true, square: null });
      expect((await send("GET", `/v1/orgs/${gb}/payments`, stranger.cookies)).statusCode).toBe(404);
      expect((await send("GET", `/v1/orgs/${gb}/payments`, {})).statusCode).toBe(401);
      expect((await read(india, owner)).availability).toBe("india_soon");
      expect((await read(germany, owner)).availability).toBe("not_available");
      expect((await read(nowhere, owner)).availability).toBe("no_country");
      // Square is not offered where it takes no card payments.
      for (const gymId of [india, germany, nowhere]) expect((await connectPress(gymId, owner)).statusCode).toBe(409);

      // A gym on no live plan cannot connect, as it can change nothing else.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gb}`;
      expect((await connectPress(gb, owner)).statusCode).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a Square account in another country or money, with no card location, or after Deny, is never kept, and its tokens are stopped",
    async () => {
      clock = new Date();
      const owner = await person("refuse-owner");
      const gymId = await gym(owner, "Refuse Gym");
      const cases: { acct: Account; reason: string; country: string | null; currency: string | null }[] = [
        { acct: account("MLUS", { country: "US", currency: "USD", locations: [cardLocation("LUS", "Main St", "USD")] }), reason: "wrong_country", country: "US", currency: "USD" },
        { acct: account("MLIE", { country: "IE", currency: "EUR" }), reason: "wrong_country", country: "IE", currency: "EUR" },
        { acct: account("MLGBUSD", { currency: "USD" }), reason: "wrong_currency", country: "GB", currency: "USD" },
        { acct: account("MLNOCARD", { locations: [{ ...cardLocation("LNC", "Pop-up"), capabilities: ["AUTOMATIC_TRANSFERS"] }] }), reason: "no_card_location", country: null, currency: null },
        { acct: account("MLCLOSED", { locations: [{ ...cardLocation("LCL", "Old site"), status: "INACTIVE" }] }), reason: "no_card_location", country: null, currency: null },
        { acct: account("MLNOLOC", { locations: [] }), reason: "no_card_location", country: null, currency: null },
      ];
      for (const c of cases) {
        const answer = await connect(gymId, owner, c.acct);
        expect(answer, c.acct.merchantId).toMatchObject({ outcome: "refused", refusal: { reason: c.reason, squareCountry: c.country, squareCurrency: c.currency } });
        expect(await rowOf(gymId), c.acct.merchantId).toBeNull();
        expect(square.liveTokensOf(c.acct.merchantId), c.acct.merchantId).toBe(0);
        expect(square.revokes[square.revokes.length - 1]?.wholeAccount, c.acct.merchantId).toBe(true);
      }
      expect(await owedOf(gymId)).toHaveLength(0);

      // Deny on Square's page: nothing is traded or kept.
      const exchanges = square.state.exchanges;
      expect(await finish(owner, { state: await startConnect(gymId, owner), error: "access_denied" })).toMatchObject({ outcome: "cancelled", refusal: null });
      expect(square.state.exchanges).toBe(exchanges);
      expect(await rowOf(gymId)).toBeNull();

      // A code Square refuses.
      expect(await finish(owner, { state: await startConnect(gymId, owner), code: "sq0cgb-never-issued" })).toMatchObject({ outcome: "refused", refusal: { reason: "square_said_no" } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "several locations: the owner picks one, from the account's own list",
    async () => {
      clock = new Date();
      const owner = await person("loc-owner");
      const manager = await person("loc-manager");
      const gymId = await gym(owner, "Locations Gym");
      await staff(gymId, manager, "manager");
      const acct = account("MLLOCS", { locations: [cardLocation("LLEEDS", "Leeds"), cardLocation("LYORK", "York"), { ...cardLocation("LSHUT", "Closed"), status: "INACTIVE" }] });
      expect(await connect(gymId, owner, acct)).toMatchObject({ outcome: "choose_location" });

      const ownerSees = await read(gymId, owner);
      expect(ownerSees.square).toMatchObject({ state: "choose_location", businessName: "MLLOCS Fitness Ltd", locationName: null, locations: [{ id: "LLEEDS", name: "Leeds" }, { id: "LYORK", name: "York" }] });
      expect((await read(gymId, manager)).square).toMatchObject({ state: "choose_location", locations: [] });
      const startHere = startHereResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gymId}/start-here`, owner.cookies)).body)).startHere;
      expect(startHere.steps.find((s) => s.step === "payments")).toEqual({ step: "payments", done: false });

      const pick = (who: User, locationId: string) => send("PUT", `/v1/orgs/${gymId}/payments/square/location`, who.cookies, { locationId });
      expect((await pick(manager, "LLEEDS")).statusCode).toBe(403);
      expect((await pick(owner, "LSHUT")).statusCode).toBe(409);
      expect((await pick(owner, "LSOMEWHERE")).statusCode).toBe(409);
      expect((await pick(owner, "bad id!")).statusCode).toBe(400);
      expect((await pick(owner, "LYORK")).statusCode).toBe(200);
      expect((await read(gymId, owner)).square).toMatchObject({ state: "connected", locationName: "York", locations: [] });
      // Picked once: it is not changed by another pick.
      expect((await pick(owner, "LLEEDS")).statusCode).toBe(409);
      const after = startHereResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gymId}/start-here`, owner.cookies)).body)).startHere;
      expect(after.steps.find((s) => s.step === "payments")).toEqual({ step: "payments", done: true });
      // Staff read it, and never get the owner's step.
      const managerList = startHereResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gymId}/start-here`, manager.cookies)).body)).startHere;
      expect(managerList.steps.map((s) => s.step)).not.toContain("payments");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Disconnect: the owner's alone, once, and Square's whole account is stopped only when no other gym holds it",
    async () => {
      clock = new Date();
      const owner = await person("off-owner");
      const manager = await person("off-manager");
      const stranger = await person("off-stranger");
      const gymOne = await gym(owner, "Off One Gym");
      const gymTwo = await gym(owner, "Off Two Gym");
      await staff(gymOne, manager, "manager");
      // One business, two gyms here, one Square account.
      const shared = account("MLSHARED", { locations: [cardLocation("LONE", "One")] });
      await connect(gymOne, owner, shared);
      await connect(gymTwo, owner, { ...shared, locations: [cardLocation("LONE", "One")] });
      expect(square.liveTokensOf("MLSHARED")).toBe(2);

      const off = (gymId: string, who: User) => send("DELETE", `/v1/orgs/${gymId}/payments/square`, who.cookies);
      expect((await off(gymOne, manager)).statusCode).toBe(403);
      expect((await off(gymOne, stranger)).statusCode).toBe(404);
      expect(await rowOf(gymOne)).not.toBeNull();

      const res = await off(gymOne, owner);
      expect(res.statusCode).toBe(200);
      expect(gymPaymentsResponseSchema.parse(JSON.parse(res.body)).payments.square).toBeNull();
      expect(square.revokes[square.revokes.length - 1]?.wholeAccount).toBe(false);
      // The other gym's connection still works.
      expect(square.liveTokensOf("MLSHARED")).toBe(1);
      expect((await read(gymTwo, owner)).square?.state).toBe("connected");
      // Twice is once.
      const revokes = square.revokes.length;
      expect((await off(gymOne, owner)).statusCode).toBe(200);
      expect(square.revokes.length).toBe(revokes);

      // The last gym holding it stops the whole account. A lapsed plan does not stop it.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymTwo}`;
      expect((await off(gymTwo, owner)).statusCode).toBe(200);
      expect(square.revokes[square.revokes.length - 1]?.wholeAccount).toBe(true);
      expect(square.liveTokensOf("MLSHARED")).toBe(0);
      expect(await sql`SELECT action FROM audit_log WHERE gym_id = ${gymOne} AND action LIKE 'org.payments_%' ORDER BY id`).toEqual([
        { action: "org.payments_square_connected" },
        { action: "org.payments_square_disconnected" },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "when Square does not answer: nothing is kept half-done, and what Square must be told is sent later",
    async () => {
      clock = new Date();
      const owner = await person("down-owner");
      const gymId = await gym(owner, "Down Gym");
      const acct = account("MLDOWN");
      await connect(gymId, owner, acct);
      square.state.down = true;
      try {
        // Disconnect while Square is down: the gym is disconnected here at once, and Square's
        // stop is owed.
        expect((await send("DELETE", `/v1/orgs/${gymId}/payments/square`, owner.cookies)).statusCode).toBe(200);
        expect(await rowOf(gymId)).toBeNull();
        expect(await owedOf(gymId)).toEqual([{ whole_account: true }]);
        expect(square.liveTokensOf("MLDOWN")).toBe(1);
        // Connect while Square is down.
        expect(await finish(owner, { state: await startConnect(gymId, owner), code: square.allow(acct) })).toMatchObject({ outcome: "refused", refusal: { reason: "square_unavailable" } });
      } finally {
        square.state.down = false;
      }
      // The worker's next minute sends the stop.
      clock = new Date(clock.getTime() + 61_000);
      await processSquareWork(workDeps());
      expect(await owedOf(gymId)).toHaveLength(0);
      expect(square.liveTokensOf("MLDOWN")).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Square's message that a gym took the app off: signed, kept once, and believed only when Square's own answer agrees",
    async () => {
      clock = new Date();
      const owner = await person("hook-owner");
      const gymId = await gym(owner, "Hook Gym");
      const acct = account("MLHOOK");
      await connect(gymId, owner, acct);
      const body = (eventId: string, type = "oauth.authorization.revoked") =>
        JSON.stringify({ merchant_id: "MLHOOK", type, event_id: eventId, created_at: clock.toISOString(), data: { type: "revocation", id: "x", object: { revocation: { revoked_at: clock.toISOString(), revoker_type: "MERCHANT" } } } });
      const sign = (payload: string, key = WEBHOOK_KEY) => createHmac("sha256", key).update(WEBHOOK_URL + payload).digest("base64");
      const deliver = (payload: string, signature: string | undefined) =>
        api().inject({ method: "POST", url: "/v1/webhooks/square", remoteAddress: nextIp(), headers: { "content-type": "application/json", ...(signature === undefined ? {} : { "x-square-hmacsha256-signature": signature }) }, payload });

      const first = body("pay-t-hook-1");
      expect((await deliver(first, undefined)).statusCode).toBe(401);
      expect((await deliver(first, sign(first, "another-key-entirely"))).statusCode).toBe(401);
      expect((await deliver(first.replace("MLHOOK", "MLHOOX"), sign(first))).statusCode).toBe(401);
      expect(await sql`SELECT 1 FROM webhook_events WHERE provider = 'square' AND event_id = 'pay-t-hook-1'`).toHaveLength(0);

      // A message saying so while the gym's token still works changes nothing.
      expect((await deliver(first, sign(first))).statusCode).toBe(200);
      expect((await deliver(first, sign(first))).statusCode).toBe(200);
      expect(await sql`SELECT 1 FROM webhook_events WHERE provider = 'square' AND event_id = 'pay-t-hook-1'`).toHaveLength(1);
      await processSquareWork(workDeps(), ["pay-t-hook-1"]);
      expect((await read(gymId, owner)).square?.state).toBe("connected");

      // Another kind of message is acknowledged and not kept.
      const other = body("pay-t-hook-other", "payment.updated");
      expect((await deliver(other, sign(other))).statusCode).toBe(200);
      expect(await sql`SELECT 1 FROM webhook_events WHERE provider = 'square' AND event_id = 'pay-t-hook-other'`).toHaveLength(0);

      // The gym removes the app inside Square: its tokens stop, and Square's message says so.
      for (const [token, t] of square.tokens) if (t.account.merchantId === "MLHOOK") square.tokens.set(token, { ...t, stopped: true });
      const second = body("pay-t-hook-2");
      expect((await deliver(second, sign(second))).statusCode).toBe(200);
      square.state.down = true;
      try {
        await processSquareWork(workDeps(), ["pay-t-hook-2"]);
        expect((await read(gymId, owner)).square?.state).toBe("connected");
      } finally {
        square.state.down = false;
      }
      clock = new Date(clock.getTime() + 2 * 60_000);
      await processSquareWork(workDeps(), ["pay-t-hook-2"]);
      const seen = await read(gymId, owner);
      expect(seen.square).toMatchObject({ state: "removed", businessName: "MLHOOK Fitness Ltd" });
      expect(seen.square?.removedAt).not.toBeNull();
      expect((await rowOf(gymId))?.access_token).toBeNull();
      // Connect again is offered, and works.
      expect(await connect(gymId, owner, account("MLHOOK"))).toMatchObject({ outcome: "connected" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "renewal every six days, and a gym whose tokens Square refuses reads as taken off",
    async () => {
      clock = new Date();
      const owner = await person("renew-owner");
      const gymId = await gym(owner, "Renew Gym");
      await connect(gymId, owner, account("MLRENEW"));
      const before = (await rowOf(gymId))?.access_token;
      await processSquareWork(workDeps());
      expect((await rowOf(gymId))?.access_token).toBe(before);

      clock = new Date(clock.getTime() + 6 * 24 * 60 * 60_000 + 1000);
      await processSquareWork(workDeps());
      const renewed = await rowOf(gymId);
      expect(renewed?.access_token).not.toBe(before);
      expect(renewed?.state).toBe("connected");

      // Square refuses the renewal, but the token still works: kept, and tried again later.
      square.state.refreshesRefused = true;
      clock = new Date(clock.getTime() + 6 * 24 * 60 * 60_000 + 1000);
      await processSquareWork(workDeps());
      expect((await rowOf(gymId))?.state).toBe("connected");
      // Then the token stops too: taken off.
      for (const [token, t] of square.tokens) if (t.account.merchantId === "MLRENEW") square.tokens.set(token, { ...t, stopped: true });
      clock = new Date(clock.getTime() + 2 * 60 * 60_000);
      await processSquareWork(workDeps());
      square.state.refreshesRefused = false;
      expect((await rowOf(gymId))?.state).toBe("removed");
      expect(await sql`SELECT actor_user_id FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.payments_square_removed_in_square'`).toEqual([{ actor_user_id: null }]);
    },
    TEST_TIMEOUT_MS,
  );
});
