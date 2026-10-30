// A gym pairs its Square Terminal (ROADMAP 18d-ii-b-i), through its routes against real
// Postgres (DATABASE_URL-gated), with Square answered by a fake that keeps accounts, tokens and
// Terminal codes as Square does: a code belongs to the account whose token made it, waits five
// minutes, and names the Terminal that signed in with it. Square's real test area is run by
// `tools/square-sandbox-check.ts --terminals`.
//
// The first block is the worst thing this job could do: a Terminal used for the wrong gym or the
// wrong Square account, so that one gym's members would be sent to another's Terminal.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  gymPaymentsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  squarePairResponseSchema,
  squarePairingCheckResponseSchema,
  type GymPayments,
  type SquareDeviceCode,
  type SquareFinishResponse,
  type SquareLocation,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { endConnectionsForHandOver } from "../src/modules/orgs/payments/repo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { SQUARE_SCOPES, type SquareApi, type SquareResult } from "../src/modules/orgs/payments/square.js";
import { addSimulatedTerminal } from "../src/modules/orgs/payments/terminals.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 5).toString("base64"); // dummy test key, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "terminals-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sandbox-sq0idb-TERMINALSROUTES", // dummy, gitleaks:allow
  SQUARE_APPLICATION_SECRET: "sandbox-sq0csb-TERMINALSROUTESSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_terminals_routes";

interface Account {
  merchantId: string;
  businessName: string;
  country: string;
  currency: string;
  locations: SquareLocation[];
}
interface Code {
  id: string;
  code: string;
  accountId: string;
  locationId: string;
  name: string;
  status: "UNPAIRED" | "PAIRED" | "EXPIRED";
  deviceId: string | null;
  pairBy: string;
  /** Square no longer returns it. */
  gone: boolean;
}

function fakeSquare(clock: () => Date) {
  const codes = new Map<string, Account>();
  const tokens = new Map<string, { account: Account; stopped: boolean }>();
  const deviceCodes = new Map<string, Code>();
  const revokes: { token: string; wholeAccount: boolean }[] = [];
  // `codeHidden`: Square gives the code with its text empty, as it does a code asked for again.
  const state: { down: boolean; deviceCodeRefusal: number | null; codeHidden: boolean } = { down: false, deviceCodeRefusal: null, codeHidden: false };
  let n = 0;
  const unavailable = { kind: "unavailable", status: 503 } as const;
  const unauthorized = { kind: "refused", status: 401, code: "UNAUTHORIZED" } as const;
  const live = (token: string) => {
    const t = tokens.get(token);
    return t === undefined || t.stopped ? null : t;
  };
  const json = (c: Code): SquareDeviceCode => ({
    id: c.id,
    code: c.code,
    location_id: c.locationId,
    status: c.status,
    pair_by: c.pairBy,
    ...(c.deviceId === null ? {} : { device_id: c.deviceId }),
  });
  const api: SquareApi = {
    authorizeUrl: (s) => `https://connect.squareupsandbox.com/oauth2/authorize?state=${s}`,
    exchangeCode(code) {
      if (state.down) return Promise.resolve(unavailable);
      const account = codes.get(code);
      codes.delete(code);
      if (account === undefined) return Promise.resolve({ kind: "refused", status: 400, code: "invalid_request" });
      n += 1;
      const access = `EAAAterm-access-${String(n)}-${randomBytes(6).toString("hex")}`;
      tokens.set(access, { account, stopped: false });
      return Promise.resolve({
        kind: "ok",
        value: { access_token: access, token_type: "bearer", expires_at: "2099-01-01T00:00:00Z", merchant_id: account.merchantId, refresh_token: `EQAAterm-refresh-${String(n)}-xxxxxxxx` },
      });
    },
    refresh: () => Promise.resolve(unavailable),
    revoke(token, wholeAccount) {
      revokes.push({ token, wholeAccount });
      const t = tokens.get(token);
      if (t === undefined) return Promise.resolve(unauthorized);
      if (wholeAccount) for (const other of tokens.values()) if (other.account.merchantId === t.account.merchantId) other.stopped = true;
      t.stopped = true;
      return Promise.resolve({ kind: "ok", value: null });
    },
    tokenStatus(token) {
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
    createCustomer: () => Promise.resolve(unavailable),
    createCard: () => Promise.resolve(unavailable),
    retrieveCard: () => Promise.resolve(unavailable),
    retrieveCustomer: () => Promise.resolve(unavailable),
    disableCard: () => Promise.resolve(unavailable),
    revokeAccount: () => Promise.resolve(unavailable),
    createDeviceCode(token, c) {
      if (state.down) return Promise.resolve(unavailable);
      const t = live(token);
      if (t === null) return Promise.resolve(unauthorized);
      if (state.deviceCodeRefusal !== null) return Promise.resolve({ kind: "refused", status: state.deviceCodeRefusal, code: "INSUFFICIENT_SCOPES" });
      if (!t.account.locations.some((l) => l.id === c.locationId)) return Promise.resolve({ kind: "refused", status: 400, code: "INVALID_VALUE" });
      const made: Code = {
        id: `DC${randomBytes(5).toString("hex").toUpperCase()}`,
        code: Array.from(randomBytes(6), (b) => String.fromCharCode(65 + (b % 26))).join(""),
        accountId: t.account.merchantId,
        locationId: c.locationId,
        name: c.name,
        status: "UNPAIRED",
        deviceId: null,
        pairBy: new Date(clock().getTime() + 5 * 60_000).toISOString(),
        gone: false,
      };
      deviceCodes.set(made.id, made);
      return Promise.resolve({ kind: "ok", value: state.codeHidden ? { ...json(made), code: "" } : json(made) });
    },
    retrieveDeviceCode(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const t = live(token);
      if (t === null) return Promise.resolve(unauthorized);
      const c = deviceCodes.get(id);
      // Square answers about its own account's codes, and no longer returns one that ran out.
      if (c === undefined || c.gone || c.accountId !== t.account.merchantId) return Promise.resolve({ kind: "refused", status: 404, code: "NOT_FOUND" });
      return Promise.resolve({ kind: "ok", value: json(c) });
    },
    // Save card on Terminal (18d-ii-b-ii) is driven in `terminalCards.routes.test.ts`.
    createTerminalAction: () => Promise.resolve(unavailable),
    getTerminalAction: () => Promise.resolve(unavailable),
    cancelTerminalAction: () => Promise.resolve(unavailable),
    createTerminalCheckout: () => Promise.resolve(unavailable),
    getTerminalCheckout: () => Promise.resolve(unavailable),
    cancelTerminalCheckout: () => Promise.resolve(unavailable),
    getPayment: () => Promise.resolve(unavailable),
    createCardPayment: () => Promise.resolve(unavailable),
    listPayments: () => Promise.resolve(unavailable),
    searchCustomers: () => Promise.resolve(unavailable),
    searchSubscriptions: () => Promise.resolve(unavailable),
    deleteCustomer: () => Promise.resolve(unavailable),
  };
  const allow = (account: Account): string => {
    const code = `sq0cgb-${randomBytes(8).toString("hex")}`;
    codes.set(code, account);
    return code;
  };
  const byText = (text: string): Code => {
    const c = [...deviceCodes.values()].find((x) => x.code === text);
    if (c === undefined) throw new Error("no such code");
    return c;
  };
  /** A Terminal types the code on its sign-in screen. */
  const signIn = (text: string, deviceId: string) => {
    const c = byText(text);
    c.status = "PAIRED";
    c.deviceId = deviceId;
  };
  const liveTokensOf = (merchantId: string) => [...tokens.values()].filter((t) => t.account.merchantId === merchantId && !t.stopped).length;
  return { api, allow, state, signIn, byText, revokes, liveTokensOf, tokens };
}

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  cookies: Cookies;
}

let ipCounter = 0;
const nextIp = () => `10.46.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const stateOf = (squareUrl: string): string => new URL(squareUrl).searchParams.get("state") ?? "";
const serial = () => randomBytes(7).toString("hex").toUpperCase().slice(0, 13);

d("A gym's Square Terminals: whose they are, pairing with Square's code, and removing (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let clock = new Date();
  const square = fakeSquare(() => clock);
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'term-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'term-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  const person = async (local: string): Promise<User> => {
    const email = `term-t-${local}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: `Term ${local}` });
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
  const gym = async (owner: User, name: string, country = "US"): Promise<string> => {
    const timezone = country === "US" ? "America/Chicago" : "Europe/London";
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country, timezone });
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await subscribe(gymId);
    return gymId;
  };
  const staff = async (gymId: string, who: User, role: "owner" | "manager" | "trainer") => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
  };
  const account = (merchantId: string, country = "US"): Account => ({
    merchantId,
    businessName: `${merchantId} Fitness LLC`,
    country,
    currency: country === "US" ? "USD" : "GBP",
    locations: [{ id: `L${merchantId}`, name: `${merchantId} Main St`, status: "ACTIVE", country, currency: country === "US" ? "USD" : "GBP", capabilities: ["CREDIT_CARD_PROCESSING"] }],
  });

  const finish = async (owner: User, body: unknown): Promise<SquareFinishResponse> => {
    const res = await send("POST", "/v1/payments/square/finish", owner.cookies, body);
    expect(res.statusCode, res.body).toBe(200);
    return squareFinishResponseSchema.parse(JSON.parse(res.body));
  };
  const connect = async (gymId: string, owner: User, acct: Account): Promise<SquareFinishResponse> => {
    const press = await send("POST", `/v1/orgs/${gymId}/payments/square/connect`, owner.cookies);
    expect(press.statusCode, press.body).toBe(200);
    return finish(owner, { state: stateOf(squareConnectResponseSchema.parse(JSON.parse(press.body)).url), code: square.allow(acct) });
  };
  const disconnect = async (gymId: string, owner: User) => {
    expect((await send("DELETE", `/v1/orgs/${gymId}/payments/square`, owner.cookies)).statusCode).toBe(200);
  };
  const read = async (gymId: string, who: User): Promise<GymPayments> => {
    const res = await send("GET", `/v1/orgs/${gymId}/payments`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return gymPaymentsResponseSchema.parse(JSON.parse(res.body)).payments;
  };
  const pairPress = (gymId: string, who: User) => send("POST", `/v1/orgs/${gymId}/payments/square/terminals/pair`, who.cookies);
  const pair = async (gymId: string, owner: User) => {
    const res = await pairPress(gymId, owner);
    expect(res.statusCode, res.body).toBe(200);
    const body = squarePairResponseSchema.parse(JSON.parse(res.body));
    const id = body.payments.terminals?.pairing?.id;
    if (id === undefined) throw new Error("no pairing shown");
    return { ...body, id };
  };
  const checkPress = (gymId: string, who: User, id: string) => send("GET", `/v1/orgs/${gymId}/payments/square/terminals/${id}/pairing`, who.cookies);
  const check = async (gymId: string, owner: User, id: string) => {
    const res = await checkPress(gymId, owner, id);
    expect(res.statusCode, res.body).toBe(200);
    return squarePairingCheckResponseSchema.parse(JSON.parse(res.body));
  };
  const removePress = (gymId: string, who: User, id: string) => send("DELETE", `/v1/orgs/${gymId}/payments/square/terminals/${id}`, who.cookies);
  /** The tester's tool (`tools/square-simulated-terminal.ts`), with this file's Square. */
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const simulate = (gymId: string, kind: "saves" | "cancels", env: Record<string, string> = {}) =>
    addSimulatedTerminal({ sql, square: squareSettings(loadConfig({ ...baseEnv, ...env }), square.api), log, now: () => clock }, gymId, kind);
  const rowsOf = (gymId: string) =>
    sql<{ id: string; state: string; account_id: string; device_id: string | null }[]>`
      SELECT id, state, account_id, device_id FROM gym_square_terminals WHERE gym_id = ${gymId} ORDER BY created_at`;
  /** A paired Terminal, through the routes: the code made, typed on the Terminal, seen. */
  const pairTerminal = async (gymId: string, owner: User, deviceId = serial()) => {
    const made = await pair(gymId, owner);
    square.signIn(made.code, deviceId);
    expect((await check(gymId, owner, made.id)).outcome).toBe("paired");
    return deviceId;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const opts = {
      squareApi: square.api,
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
    };
    app = await buildApp(loadConfig(baseEnv), opts);
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  it(
    "the worst thing: a Terminal is never shown, paired or removed for another gym, or for a Square account the gym is not connected to now",
    async () => {
      clock = new Date();
      const ownerA = await person("worst-owner-a");
      const ownerB = await person("worst-owner-b");
      const manager = await person("worst-manager");
      const coOwner = await person("worst-co-owner");
      const stranger = await person("worst-stranger");
      const gymA = await gym(ownerA, "Worst A Gym");
      const gymB = await gym(ownerB, "Worst B Gym");
      await staff(gymA, manager, "manager");
      await staff(gymA, coOwner, "owner");
      expect(await connect(gymA, ownerA, account("MLTWA"))).toMatchObject({ outcome: "connected" });
      expect(await connect(gymB, ownerB, account("MLTWB"))).toMatchObject({ outcome: "connected" });

      const deviceA = await pairTerminal(gymA, ownerA);
      const [rowA] = await rowsOf(gymA);
      if (rowA === undefined) throw new Error("A's Terminal was not kept");
      expect(rowA).toMatchObject({ state: "paired", account_id: "MLTWA", device_id: deviceA });
      const waitingA = await pair(gymA, ownerA);

      // Gym B's owner sees none of A's, and can reach none of A's rows by naming them, through
      // B's own address or A's.
      expect((await read(gymB, ownerB)).terminals?.list).toEqual([]);
      expect((await send("GET", `/v1/orgs/${gymA}/payments`, ownerB.cookies)).statusCode).toBe(404);
      expect((await checkPress(gymB, ownerB, waitingA.id)).statusCode).toBe(404);
      expect((await checkPress(gymA, ownerB, waitingA.id)).statusCode).toBe(404);
      expect((await removePress(gymA, ownerB, rowA.id)).statusCode).toBe(404);
      expect((await removePress(gymB, ownerB, rowA.id)).statusCode).toBe(200);
      expect((await removePress(gymB, ownerB, waitingA.id)).statusCode).toBe(200);
      expect(await rowsOf(gymA)).toHaveLength(2);
      for (const who of [stranger]) {
        expect((await pairPress(gymA, who)).statusCode).toBe(404);
        expect((await checkPress(gymA, who, waitingA.id)).statusCode).toBe(404);
        expect((await removePress(gymA, who, rowA.id)).statusCode).toBe(404);
      }
      // A's own staff read the list; only A's owner pairs, checks and removes, as only the owner
      // connects Square. Nobody else is shown the code waiting.
      for (const who of [manager, coOwner]) {
        const seen = await read(gymA, who);
        expect(seen.terminals?.list.map((t) => t.serial)).toEqual([deviceA]);
        expect(seen.terminals?.pairing).toBeNull();
        expect((await pairPress(gymA, who)).statusCode).toBe(403);
        expect((await checkPress(gymA, who, waitingA.id)).statusCode).toBe(403);
        expect((await removePress(gymA, who, rowA.id)).statusCode).toBe(403);
      }
      expect(await rowsOf(gymA)).toHaveLength(2);

      // A code made with account A1's token, the gym connected to another account before the
      // Terminal signs in: Square says it paired, and nothing is paired here.
      await disconnect(gymA, ownerA);
      expect(await connect(gymA, ownerA, account("MLTWA2"))).toMatchObject({ outcome: "connected" });
      square.signIn(waitingA.code, serial());
      expect((await checkPress(gymA, ownerA, waitingA.id)).statusCode).toBe(404);
      // A1's Terminal is not A2's: never listed, and never counted while A2 is connected.
      expect((await read(gymA, ownerA)).terminals?.list).toEqual([]);
      expect(await rowsOf(gymA)).toEqual([expect.objectContaining({ id: rowA.id, account_id: "MLTWA" })]);

      // Back on A1, the Terminal still signed in to it is A's again.
      await disconnect(gymA, ownerA);
      expect(await connect(gymA, ownerA, account("MLTWA"))).toMatchObject({ outcome: "connected" });
      expect((await read(gymA, ownerA)).terminals?.list.map((t) => t.serial)).toEqual([deviceA]);

      // A gym handed to a new owner: the hand-over lets the old owner's account go (4b-v's own
      // step), and with it its Terminal.
      await sql`UPDATE gyms SET owner_user_id = ${coOwner.userId} WHERE id = ${gymA}`;
      await sql.begin((tx) => endConnectionsForHandOver(tx, gymA, clock));
      expect((await read(gymA, coOwner)).terminals).toBeNull();
      expect(await connect(gymA, coOwner, account("MLTWNEW"))).toMatchObject({ outcome: "connected" });
      expect((await read(gymA, coOwner)).terminals?.list).toEqual([]);
      expect((await pairPress(gymA, ownerA)).statusCode).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the worst thing, two gyms on one Square account: a Terminal is listed by the gym it last signed in for, never by both",
    async () => {
      clock = new Date();
      const owner = await person("chain-owner");
      const north = await gym(owner, "Chain North");
      const south = await gym(owner, "Chain South");
      const chain = account("MLTCHAIN");
      expect(await connect(north, owner, chain)).toMatchObject({ outcome: "connected" });
      expect(await connect(south, owner, chain)).toMatchObject({ outcome: "connected" });

      const desk = await pairTerminal(north, owner);
      expect((await read(north, owner)).terminals?.list.map((t) => t.serial)).toEqual([desk]);
      expect((await read(south, owner)).terminals?.list).toEqual([]);

      // The Terminal is carried to South's desk and signs in with South's code: South has it, and
      // North no longer lists a Terminal that now stands elsewhere.
      await pairTerminal(south, owner, desk);
      expect((await read(south, owner)).terminals?.list.map((t) => t.serial)).toEqual([desk]);
      expect((await read(north, owner)).terminals?.list).toEqual([]);
      expect(await sql`SELECT gym_id FROM gym_square_terminals WHERE device_id = ${desk}`).toEqual([{ gym_id: south }]);
      const moved = await sql<{ meta: { serial?: string; to?: string } }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${north} AND action = 'org.payments_square_terminal_moved'`;
      expect(moved.map((m) => m.meta)).toEqual([{ serial: desk, to: "Chain South" }]);

      // Another business's owner on the same Square account (not on North's staff) takes the
      // Terminal: North's line names nobody, so North's Staff activity never shows that person.
      const other = await person("chain-other");
      const west = await gym(other, "Chain West");
      expect(await connect(west, other, chain)).toMatchObject({ outcome: "connected" });
      await pairTerminal(west, other, desk);
      const fromSouth = await sql<{ actor_user_id: string | null; meta: { to?: string } }[]>`
        SELECT actor_user_id, meta FROM audit_log WHERE gym_id = ${south} AND action = 'org.payments_square_terminal_moved'`;
      expect(fromSouth).toEqual([{ actor_user_id: null, meta: { serial: desk, to: "Chain West" } }]);
      const northMoves = await sql<{ actor_user_id: string | null }[]>`
        SELECT actor_user_id FROM audit_log WHERE gym_id = ${north} AND action = 'org.payments_square_terminal_moved'`;
      expect(northMoves).toEqual([{ actor_user_id: owner.userId }]);

      // A simulated Terminal follows the same rule.
      expect(await simulate(north, "saves")).toBe(true);
      expect(await simulate(south, "saves")).toBe(true);
      expect((await read(north, owner)).terminals?.list.map((t) => t.practice)).toEqual([]);
      // (The desk now stands at West.)
      expect((await read(south, owner)).terminals?.list.map((t) => t.practice)).toEqual(["saves"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never past twenty: counted again when a Terminal signs in, so two codes finishing together cannot pass it",
    async () => {
      clock = new Date();
      const owner = await person("cap-owner");
      const gymId = await gym(owner, "Cap Gym");
      await connect(gymId, owner, account("MLTCAP"));
      for (let i = 0; i < 19; i += 1) {
        await sql`
          INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at)
          VALUES (${gymId}, 'sandbox', 'MLTCAP', 'paired', ${`CAP${String(i)}`}, now())`;
      }
      // Nineteen paired: a code is made. Meanwhile a twentieth arrives (another code finishing).
      const made = await pair(gymId, owner);
      await sql`
        INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at)
        VALUES (${gymId}, 'sandbox', 'MLTCAP', 'paired', 'CAP19', now())`;
      square.signIn(made.code, serial());
      const late = await checkPress(gymId, owner, made.id);
      expect(late.statusCode).toBe(409);
      expect((JSON.parse(late.body) as { error: string }).error).toBe("terminals_full");
      // The box still loads, with its twenty, and no code waits.
      const now = await read(gymId, owner);
      expect(now.terminals?.list).toHaveLength(20);
      expect(now.terminals?.pairing).toBeNull();
      // The tester's tool is held to it too.
      await expect(simulate(gymId, "saves")).rejects.toThrow("You can pair up to 20 Terminals.");
      expect(await rowsOf(gymId)).toHaveLength(20);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "pairing: Square's code for the gym's location, shown once, never kept; the Terminal that signs in with it is listed once",
    async () => {
      clock = new Date();
      const owner = await person("pair-owner");
      const gymId = await gym(owner, "Pair Gym");
      expect(await connect(gymId, owner, account("MLTPAIR"))).toMatchObject({ outcome: "connected" });
      const before = await read(gymId, owner);
      expect(before.terminals).toEqual({ needsAllow: false, list: [], pairing: null });

      const made = await pair(gymId, owner);
      expect(made.code).toMatch(/^[A-Z]{6}$/);
      expect(Date.parse(made.pairBy) - clock.getTime()).toBe(5 * 60_000);
      expect(square.byText(made.code)).toMatchObject({ name: "Pair Gym", locationId: "LMLTPAIR", accountId: "MLTPAIR" });
      // The code is shown once: not in any column, and not in the box read afterwards.
      const stored = JSON.stringify(await sql`SELECT * FROM gym_square_terminals WHERE gym_id = ${gymId}`);
      expect(stored).not.toContain(made.code);
      const again = await read(gymId, owner);
      expect(JSON.stringify(again)).not.toContain(made.code);
      expect(again.terminals?.pairing).toEqual({ id: made.id, pairBy: made.pairBy });

      expect((await check(gymId, owner, made.id)).outcome).toBe("waiting");
      const device = serial();
      square.signIn(made.code, device);
      const paired = await check(gymId, owner, made.id);
      expect(paired.outcome).toBe("paired");
      expect(paired.payments.terminals?.list).toEqual([{ id: made.id, serial: device, practice: null, pairedAt: clock.toISOString() }]);
      expect(paired.payments.terminals?.pairing).toBeNull();
      // Asked again, the same answer, and one row.
      expect((await check(gymId, owner, made.id)).outcome).toBe("paired");
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.payments_square_terminal_paired'`).toHaveLength(1);

      // The same Terminal signing in with a new code stays one Terminal.
      const second = await pair(gymId, owner);
      square.signIn(second.code, device);
      expect((await check(gymId, owner, second.id)).outcome).toBe("paired");
      expect(await rowsOf(gymId)).toEqual([expect.objectContaining({ id: made.id, device_id: device })]);

      // Two checks at the same instant: one Terminal, one record of it.
      const third = await pair(gymId, owner);
      square.signIn(third.code, serial());
      const both = await Promise.all([checkPress(gymId, owner, third.id), checkPress(gymId, owner, third.id)]);
      expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(await rowsOf(gymId)).toHaveLength(2);
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.payments_square_terminal_paired'`).toHaveLength(2);

      // A new code replaces the one waiting: the first is gone, even if a Terminal uses it.
      const fourth = await pair(gymId, owner);
      const fifth = await pair(gymId, owner);
      square.signIn(fourth.code, serial());
      expect((await checkPress(gymId, owner, fourth.id)).statusCode).toBe(404);
      expect((await read(gymId, owner)).terminals?.pairing?.id).toBe(fifth.id);
      expect(await rowsOf(gymId)).toHaveLength(3);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a code that runs out goes, and one Square doesn't answer about keeps waiting",
    async () => {
      clock = new Date();
      const owner = await person("expire-owner");
      const gymId = await gym(owner, "Expire Gym");
      await connect(gymId, owner, account("MLTEXP"));

      const expired = await pair(gymId, owner);
      square.byText(expired.code).status = "EXPIRED";
      expect((await check(gymId, owner, expired.id)).outcome).toBe("expired");
      expect(await rowsOf(gymId)).toEqual([]);
      expect((await checkPress(gymId, owner, expired.id)).statusCode).toBe(404);

      const forgotten = await pair(gymId, owner);
      square.byText(forgotten.code).gone = true;
      expect((await check(gymId, owner, forgotten.id)).outcome).toBe("expired");

      // Square down: no answer, so it waits, past its time too; a Terminal may have signed in.
      const quiet = await pair(gymId, owner);
      square.state.down = true;
      clock = new Date(clock.getTime() + 10 * 60_000);
      expect((await check(gymId, owner, quiet.id)).outcome).toBe("waiting");
      square.state.down = false;
      // Square back: still unpaired past its time and the minute after it, so it ran out.
      expect((await check(gymId, owner, quiet.id)).outcome).toBe("expired");

      // A Terminal that signed in at the last second, seen only after the code's time.
      clock = new Date();
      const late = await pair(gymId, owner);
      square.signIn(late.code, serial());
      clock = new Date(clock.getTime() + 7 * 60_000);
      expect((await check(gymId, owner, late.id)).outcome).toBe("paired");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "where it is offered: a connection in the US, Canada or Australia with its location, allowing the Terminal",
    async () => {
      clock = new Date();
      const owner = await person("where-owner");
      const uk = await gym(owner, "Where UK Gym", "GB");
      await connect(uk, owner, account("MLTUK", "GB"));
      expect((await read(uk, owner)).terminals).toBeNull();
      const ukPress = await pairPress(uk, owner);
      expect(ukPress.statusCode).toBe(409);
      expect((JSON.parse(ukPress.body) as { error: string }).error).toBe("terminals_not_offered");

      const notYet = await gym(owner, "Where Not Connected Gym");
      expect((await read(notYet, owner)).terminals).toBeNull();
      expect((await pairPress(notYet, owner)).statusCode).toBe(409);

      // A gym on no live plan cannot pair, as it can change nothing else; it can still remove.
      const lapsed = await gym(owner, "Where Lapsed Gym");
      await connect(lapsed, owner, account("MLTLAPSE"));
      const kept = await pairTerminal(lapsed, owner);
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${lapsed}`;
      expect((await pairPress(lapsed, owner)).statusCode).toBe(409);
      const [row] = await rowsOf(lapsed);
      expect(row?.device_id).toBe(kept);
      expect((await removePress(lapsed, owner, row?.id ?? "")).statusCode).toBe(200);
      expect(await rowsOf(lapsed)).toEqual([]);
      // Pressed twice, removed once.
      expect((await removePress(lapsed, owner, row?.id ?? "")).statusCode).toBe(200);
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${lapsed} AND action = 'org.payments_square_terminal_removed'`).toHaveLength(1);

      // What Square refuses says so; nothing waits.
      const refused = await gym(owner, "Where Refused Gym");
      await connect(refused, owner, account("MLTREF"));
      square.state.deviceCodeRefusal = 403;
      const res = await pairPress(refused, owner);
      square.state.deviceCodeRefusal = null;
      expect(res.statusCode).toBe(409);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("terminals_need_allow");
      square.state.down = true;
      expect((await pairPress(refused, owner)).statusCode).toBe(503);
      square.state.down = false;
      square.state.codeHidden = true;
      const hidden = await pairPress(refused, owner);
      square.state.codeHidden = false;
      expect((JSON.parse(hidden.body) as { error: string }).error).toBe("pairing_refused");
      expect(await rowsOf(refused)).toEqual([]);

      // Bad addresses and bodies.
      expect((await checkPress(refused, owner, "not-a-uuid")).statusCode).toBe(400);
      expect((await removePress(refused, owner, "not-a-uuid")).statusCode).toBe(400);
      expect((await checkPress(refused, owner, randomUUID())).statusCode).toBe(404);
      expect((await send("POST", `/v1/orgs/${refused}/payments/square/terminals/pair`, {})).statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "connected before the Terminal's permissions: Connect Square again on the same account, never another",
    async () => {
      clock = new Date();
      const owner = await person("again-owner");
      const gymId = await gym(owner, "Again Gym");
      await connect(gymId, owner, account("MLTAGAIN"));
      // As a connection made before 0147 reads.
      await sql`UPDATE gym_payment_connections SET scopes = '{}' WHERE gym_id = ${gymId}`;
      const old = await read(gymId, owner);
      expect(old.terminals).toMatchObject({ needsAllow: true, list: [] });
      expect((JSON.parse((await pairPress(gymId, owner)).body) as { error: string }).error).toBe("terminals_need_allow");
      await expect(simulate(gymId, "saves")).rejects.toThrow("Reconnect Square to use Square Terminals.");
      const connectedAt = old.square?.connectedAt;

      // Signed in to another Square account on Square's page: refused, and nothing changes.
      expect(await connect(gymId, owner, account("MLTOTHER"))).toMatchObject({ outcome: "refused", refusal: { reason: "other_account" } });
      expect(square.liveTokensOf("MLTOTHER")).toBe(0);
      expect((await read(gymId, owner)).terminals?.needsAllow).toBe(true);
      expect((await read(gymId, owner)).square?.connectedAt).toBe(connectedAt);

      // The same account: allowed, its old token let go alone, the location kept.
      clock = new Date(clock.getTime() + 60_000);
      const revokesBefore = square.revokes.length;
      expect(await connect(gymId, owner, account("MLTAGAIN"))).toMatchObject({ outcome: "connected_again", refusal: null });
      const now = await read(gymId, owner);
      expect(now.square).toMatchObject({ state: "connected", locationName: "MLTAGAIN Main St", connectedAt: clock.toISOString() });
      expect(now.terminals?.needsAllow).toBe(false);
      expect(square.revokes.slice(revokesBefore)).toEqual([expect.objectContaining({ wholeAccount: false })]);
      expect(square.liveTokensOf("MLTAGAIN")).toBe(1);
      await pairTerminal(gymId, owner);

      // Everything allowed: nothing to connect again for.
      const twice = await send("POST", `/v1/orgs/${gymId}/payments/square/connect`, owner.cookies);
      expect(twice.statusCode).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "connected before Square's subscriptions could be read (18d-iii-b-ii-b-i): Terminals work as they did",
    async () => {
      clock = new Date();
      const owner = await person("before-pos-owner");
      const gymId = await gym(owner, "Before Point of Sale Gym");
      await connect(gymId, owner, account("MLTBEFOREPOS"));
      // As a connection made before 18d-iii-b-ii-b-i reads: everything but Square's own subscriptions.
      const before = SQUARE_SCOPES.filter((scope) => scope !== "SUBSCRIPTIONS_READ");
      await sql`UPDATE gym_payment_connections SET scopes = ${before} WHERE gym_id = ${gymId}`;
      const answer = await read(gymId, owner);
      expect(answer.terminals?.needsAllow, "the Terminals need nothing more").toBe(false);
      await pairTerminal(gymId, owner);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Square's sandbox: a simulated Terminal from the tester's tool, once each, never from a screen and never in Square's real one",
    async () => {
      clock = new Date();
      const owner = await person("practice-owner");
      const gymId = await gym(owner, "Practice Gym");
      await connect(gymId, owner, account("MLTPRAC"));
      // No address of the app adds one: the box is the same as a real gym's.
      expect((await send("POST", `/v1/orgs/${gymId}/payments/square/terminals/practice`, owner.cookies, { practice: "saves" })).statusCode).toBe(404);
      expect(await simulate(gymId, "saves")).toBe(true);
      expect(await simulate(gymId, "saves")).toBe(false);
      expect(await simulate(gymId, "cancels")).toBe(true);
      const list = (await read(gymId, owner)).terminals?.list ?? [];
      expect(list.map((t) => [t.serial, t.practice])).toEqual([
        [null, "saves"],
        [null, "cancels"],
      ]);
      expect((await rowsOf(gymId)).map((r) => r.device_id)).toEqual(["jg260ny-11t2-4xy2-kg21-tl949bp350ca", "aafea9fa-350c-4ab2-b033-b2fbb672e712"]);
      // The owner removes one there like any Terminal.
      const [first] = await rowsOf(gymId);
      expect((await removePress(gymId, owner, first?.id ?? "")).statusCode).toBe(200);
      expect(await simulate(gymId, "saves")).toBe(true);

      // Never with Square's real keys, and never on a gym not ready for a Terminal.
      await expect(simulate(gymId, "saves", { SQUARE_ENV: "production", SQUARE_APPLICATION_ID: "sq0idp-TERMINALSROUTES", SQUARE_APPLICATION_SECRET: "sq0csp-TERMINALSROUTESSECRET" })).rejects.toThrow("sandbox only"); // dummy, gitleaks:allow
      const uk = await gym(owner, "Practice UK Gym", "GB");
      await connect(uk, owner, account("MLTPRACUK", "GB"));
      await expect(simulate(uk, "saves")).rejects.toThrow();
      expect(await rowsOf(uk)).toEqual([]);

      // At most twenty: the twenty-first is refused.
      for (let i = 0; i < 18; i += 1) {
        await sql`
          INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at)
          VALUES (${gymId}, 'sandbox', 'MLTPRAC', 'paired', ${`FILL${String(i)}`}, now())`;
      }
      const full = await pairPress(gymId, owner);
      expect(full.statusCode).toBe(409);
      expect((JSON.parse(full.body) as { error: string }).error).toBe("terminals_full");
      expect((await read(gymId, owner)).terminals?.list).toHaveLength(20);
    },
    TEST_TIMEOUT_MS,
  );
});
