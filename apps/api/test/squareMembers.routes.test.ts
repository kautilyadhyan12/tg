// Members in Square (ROADMAP 18d-iii-b-ii-b-i; spec Part 3 §14.8): the owner's press checks the gym's Square
// customer list, the box says who is added, linked or left out and whom Square charges itself, the press of
// Add does that, and each new member is added by itself after; through the real routes, the worker's
// minute and Square's signed messages, against real Postgres (DATABASE_URL-gated), with Square answered by
// the fake in `fakeSquareTerminal.ts`.
//
// The first block is the worst thing this job could do to a real person: a member linked to somebody else's
// customer in Square, a child on a parent's email linked to the parent, so the parent's payments wait on the
// child's bill. Every claim is read from the tables, or from Square's own record of what it was sent, never
// from the reply alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { gymPaymentsResponseSchema, squareConnectResponseSchema, squareFinishResponseSchema, squareMembersNamesResponseSchema, squareMembersResponseSchema, type SquareMembers } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { claimCustomer } from "../src/modules/orgs/payments/cardsRepo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { SQUARE_MEMBERS_WORK, processSquareMembers } from "../src/modules/orgs/payments/squareMembers.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 11).toString("base64"); // dummy test key, gitleaks:allow
const WEBHOOK_KEY = "square-members-webhook-key"; // dummy test key, gitleaks:allow
const WEBHOOK_URL = "https://hooks.example.test/v1/webhooks/square";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "square-members-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-SQUAREMEMBERS", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-SQUAREMEMBERSSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
};

const T = 240_000;
const LIVE_PLAN = "zz_square_members";

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
  locationId: string;
}

let ipCounter = 0;
const nextIp = () => `10.61.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("Members in Square (real Postgres)", { timeout: T }, () => {
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
  const gyms: Gym[] = [];
  const deps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });
  /** The worker's Members in Square step, for this test's gyms alone (or only these). */
  const membersWork = (only: readonly Gym[] = gyms) => {
    const settings = squareSettings(config(), square.api);
    if (settings === null) throw new Error("Square is not set up");
    return processSquareMembers(deps(), settings, only.map((g) => g.id));
  };
  /** The worker's whole minute, for these of Square's messages and this test's gyms. */
  const work = (eventIds: readonly string[] = []) => processSquareWork(deps(), eventIds, gyms.map((g) => g.id));

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sqm-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'sqm-t-%@example.com'`;
    await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${mineSql}) OR account_id LIKE 'MSQM%'`;
    await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'sqm-t-%'`;
    await sql`DELETE FROM gym_square_member_runs WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_customers WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'sqm-t-%@example.com'`;
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
    const email = `sqm-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to a Square account of its own. */
  const makeGym = async (name: string, acct: Account = account(`MSQM${uniq()}`)): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    const gym = { id, name, owner, acct, locationId: acct.locations[0]?.id ?? "" };
    gyms.push(gym);
    return gym;
  };
  /** Somebody added on Members by hand, as staff do. */
  const person = async (gym: Gym, fullName: string, contact: { email?: string; phone?: string }): Promise<string> => {
    let add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, ...contact });
    if (add.statusCode === 409) {
      const people = (JSON.parse(add.body) as { people: { entryId: string }[] }).people.map((p) => p.entryId);
      add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, ...contact, acknowledgedDuplicates: people });
    }
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const boxUrl = (gym: Gym) => `/v1/orgs/${gym.id}/payments/square/members`;
  const box = async (gym: Gym, cookies = gym.owner.cookies): Promise<SquareMembers> => {
    const res = await send("GET", boxUrl(gym), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return squareMembersResponseSchema.parse(JSON.parse(res.body)).members;
  };
  const check = async (gym: Gym): Promise<SquareMembers> => {
    const res = await send("POST", `${boxUrl(gym)}/check`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return squareMembersResponseSchema.parse(JSON.parse(res.body)).members;
  };
  const add = async (gym: Gym, runId: string): Promise<SquareMembers> => {
    const res = await send("POST", `${boxUrl(gym)}/add`, gym.owner.cookies, { runId });
    expect(res.statusCode, res.body).toBe(200);
    return squareMembersResponseSchema.parse(JSON.parse(res.body)).members;
  };
  /** The record's customer in the gym's Square account, as the app keeps it. */
  const customerOf = async (gym: Gym, entryId: string) => {
    const [row] = await sql<{ customer_id: string | null; joined_at: Date | null }[]>`
      SELECT customer_id, joined_at FROM gym_square_customers
      WHERE gym_id = ${gym.id} AND entry_id = ${entryId} AND environment = 'production' AND account_id = ${gym.acct.merchantId}`;
    return row ?? null;
  };
  const sentFor = (entryId: string) => square.customersMade.filter((c) => c.referenceId === entryId);
  /** Square's signed message about a payment, through the real route. */
  const deliver = async (acct: Account, paymentId: string): Promise<string> => {
    const eventId = `sqm-t-${uniq()}`;
    const payload = JSON.stringify({ merchant_id: acct.merchantId, type: "payment.created", event_id: eventId, data: { type: "payment", id: paymentId } });
    const signature = createHmac("sha256", WEBHOOK_KEY).update(WEBHOOK_URL + payload).digest("base64");
    const res = await api().inject({
      method: "POST",
      url: "/v1/webhooks/square",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", "x-square-hmacsha256-signature": signature },
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
    await sql`UPDATE webhook_events SET not_before = ${clock} WHERE provider = 'square' AND event_id = ${eventId}`;
    return eventId;
  };
  const takenRow = async (squarePaymentId: string) => {
    const [row] = await sql<{ state: string; reason: string | null; entry_id: string | null }[]>`
      SELECT state, reason, entry_id FROM gym_square_app_payments WHERE square_payment_id = ${squarePaymentId}`;
    return row ?? null;
  };

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

  describe("THE WORST THING: a member linked to somebody else's customer in Square", () => {
    it("Sam on his mum Pat's email gets a customer of his own; Pat's payments are never put on Sam, nor any gym's members in another's Square", async () => {
      const gym = await makeGym("Iron Barn");
      const other = await makeGym("Elm Street Gym");
      const pat = `pat.smith.${uniq()}@gmail.com`;
      const leo = `leo.grant.${uniq()}@gmail.com`;
      // In the gym's Square: Pat, who bought a water bottle once, and Leo, typed in at the till.
      square.customer(gym.acct, { id: "CPATSMITH", given_name: "Pat", family_name: "Smith", email_address: pat });
      square.customer(gym.acct, { id: "CLEOGRANT", given_name: "LEO", family_name: "GRANT", email_address: null, phone_number: "(312) 555-0142" });
      // And the same Pat in the other gym's own Square account.
      square.customer(other.acct, { id: "COTHERPAT", given_name: "Pat", family_name: "Smith", email_address: pat });
      const sam = await person(gym, "Sam Smith", { email: pat });
      const leoId = await person(gym, "Leo Grant", { email: leo, phone: "312-555-0142" });
      const amy = await person(gym, "Amy Lee", { email: `amy.lee.${uniq()}@gmail.com` });

      const checked = await check(gym);
      expect(checked.state).toBe("checked");
      expect(checked.groups.add).toEqual({ count: 2, names: ["Amy Lee", "Sam Smith"] });
      expect(checked.groups.link).toEqual({ count: 1, names: ["Leo Grant"] });
      expect(checked.groups.several_customers.count + checked.groups.several_people.count).toBe(0);
      // Nothing is sent to Square before the press.
      expect(sentFor(sam)).toHaveLength(0);
      expect(await customerOf(gym, sam)).toBeNull();

      const added = await add(gym, checked.runId ?? "");
      expect(added.state).toBe("added");
      expect(added.automatic).toBe(true);
      expect(added).toMatchObject({ members: 3, inSquare: 3 });

      // Sam: a customer of his own, made with his own name and his record's id; never Pat's.
      const samCustomer = await customerOf(gym, sam);
      expect(samCustomer?.customer_id).not.toBe("CPATSMITH");
      expect(samCustomer?.joined_at).toBeNull();
      expect(sentFor(sam)).toEqual([expect.objectContaining({ givenName: "Sam", familyName: "Smith", email: pat, referenceId: sam, accountId: gym.acct.merchantId })]);
      // Leo: linked to the customer the till made, by his phone and name; nothing made for him.
      expect(await customerOf(gym, leoId)).toMatchObject({ customer_id: "CLEOGRANT", joined_at: expect.any(Date) as Date });
      expect(sentFor(leoId)).toHaveLength(0);
      expect((await customerOf(gym, amy))?.customer_id).toMatch(/^CUS/);
      // Pat's own customer is untouched, and nobody of this gym went to the other gym's account.
      expect(square.customersOf(gym.acct).find((c) => c.id === "CPATSMITH")).toMatchObject({ given_name: "Pat", family_name: "Smith", email_address: pat });
      expect(square.customersMade.filter((c) => c.accountId !== gym.acct.merchantId)).toHaveLength(0);
      expect(square.customersOf(other.acct).map((c) => c.id)).toEqual(["COTHERPAT"]);

      // Pat pays $20.00 in Square Point of Sale with herself picked: it is nobody's here, and waits.
      const patPays = square.appPayment(gym.acct, { amount: 2000, customerId: "CPATSMITH", locationId: gym.locationId });
      await work([await deliver(gym.acct, patPays.id)]);
      expect(await takenRow(patPays.id)).toMatchObject({ state: "waiting", reason: "not_linked", entry_id: null });
      // Sam pays with himself picked: his.
      const samPays = square.appPayment(gym.acct, { amount: 2000, customerId: samCustomer?.customer_id ?? "", locationId: gym.locationId });
      await work([await deliver(gym.acct, samPays.id)]);
      expect(await takenRow(samPays.id)).toMatchObject({ state: "waiting", entry_id: sam });
    });
  });

  describe("who may", () => {
    it("staff read the counts without names; only the owner checks or adds; another gym's owner reads nothing", async () => {
      const gym = await makeGym("Who May Gym");
      const stranger = await makeGym("Stranger Gym");
      await person(gym, "Nina Park", { email: `nina.${uniq()}@gmail.com` });
      const staff = await signedIn("Desk Staff");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${staff.userId}, 'manager', ${null})`;
      const checked = await check(gym);
      const seen = await box(gym, staff.cookies);
      expect(seen.groups.add).toEqual({ count: 1, names: [] });
      expect(seen.canAdd).toBe(false);
      expect((await send("POST", `${boxUrl(gym)}/check`, staff.cookies)).statusCode).toBe(403);
      expect((await send("POST", `${boxUrl(gym)}/add`, staff.cookies, { runId: checked.runId })).statusCode).toBe(403);
      expect((await send("GET", `${boxUrl(gym)}/names?group=add`, staff.cookies)).statusCode).toBe(403);
      for (const [method, path, body] of [
        ["GET", boxUrl(gym), undefined],
        ["POST", `${boxUrl(gym)}/check`, undefined],
        ["POST", `${boxUrl(gym)}/add`, { runId: checked.runId }],
        ["GET", `${boxUrl(gym)}/names?group=add`, undefined],
      ] as const) {
        expect((await send(method, path, stranger.owner.cookies, body)).statusCode).toBe(404);
      }
      expect((await send("POST", `${boxUrl(gym)}/add`, gym.owner.cookies, { runId: "not-a-uuid" })).statusCode).toBe(400);
      expect((await send("GET", `${boxUrl(gym)}/names?group=everybody`, gym.owner.cookies)).statusCode).toBe(400);
      // Nothing was added by anybody but the owner, and nothing at all yet.
      expect(square.customersMade.filter((c) => c.accountId === gym.acct.merchantId)).toHaveLength(0);
    });

    it("a gym connected before Square let the app read its subscriptions reconnects first", async () => {
      const gym = await makeGym("Old Connection Gym");
      await sql`UPDATE gym_payment_connections SET scopes = array_remove(scopes, 'SUBSCRIPTIONS_READ') WHERE gym_id = ${gym.id}`;
      const res = await send("POST", `${boxUrl(gym)}/check`, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(409);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("square_members_need_allow");
      const payments = gymPaymentsResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gym.id}/payments`, gym.owner.cookies)).body));
      expect(payments.payments.squareApp?.needsAllow).toBe(true);
    });
  });

  describe("what the box says before the press", () => {
    it("Square's own subscriptions are named; Square's duplicates and one customer for two records are left out", async () => {
      const gym = await makeGym("Left Out Gym");
      const leo = `leo.${uniq()}@gmail.com`;
      const nora = `nora.${uniq()}@gmail.com`;
      const kai = `kai.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CLEO1", given_name: "Leo", family_name: "Grant", email_address: leo });
      square.subscription(gym.acct, "CLEO1", "ACTIVE");
      square.customer(gym.acct, { id: "CKAI1", given_name: "Kai", family_name: "Moss", email_address: kai });
      square.subscription(gym.acct, "CKAI1", "CANCELED");
      square.customer(gym.acct, { id: "CNORA1", given_name: "Nora", family_name: "Price", email_address: nora });
      square.customer(gym.acct, { id: "CNORA2", given_name: "NORA", family_name: "PRICE", email_address: nora.toUpperCase() });
      square.customer(gym.acct, { id: "CTOM1", given_name: "Tom", family_name: "Reed", email_address: null, phone_number: "+1 312 555 0190" });
      await person(gym, "Leo Grant", { email: leo });
      await person(gym, "Kai Moss", { email: kai });
      const noraId = await person(gym, "Nora Price", { email: nora });
      const tomA = await person(gym, "Tom Reed", { email: `tom.${uniq()}@gmail.com`, phone: "312-555-0190" });
      const tomB = await person(gym, "Tom Reed", { phone: "+13125550190" });
      const checked = await check(gym);
      expect(checked.groups.link).toEqual({ count: 2, names: ["Kai Moss", "Leo Grant"] });
      expect(checked.groups.billed).toEqual({ count: 1, names: ["Leo Grant"] });
      expect(checked.groups.several_customers).toEqual({ count: 1, names: ["Nora Price"] });
      expect(checked.groups.several_people).toEqual({ count: 2, names: ["Tom Reed", "Tom Reed"] });
      expect(checked.groups.add.count).toBe(0);
      const all = squareMembersNamesResponseSchema.parse(JSON.parse((await send("GET", `${boxUrl(gym)}/names?group=link`, gym.owner.cookies)).body));
      expect(all).toEqual({ names: ["Kai Moss", "Leo Grant"], next: null });

      const added = await add(gym, checked.runId ?? "");
      expect(added).toMatchObject({ state: "added", members: 5, inSquare: 2 });
      expect(added.groups.several_customers).toEqual({ count: 1, names: ["Nora Price"] });
      expect(added.groups.several_people.count).toBe(2);
      for (const id of [noraId, tomA, tomB]) expect(await customerOf(gym, id)).toBeNull();
      expect(square.customersMade.filter((c) => c.accountId === gym.acct.merchantId)).toHaveLength(0);

      // The gym merges Nora's two customers in Square; Check again links her to the one left.
      square.forgetCustomer("CNORA2");
      const again = await check(gym);
      expect(again.groups.link).toEqual({ count: 1, names: ["Nora Price"] });
      await add(gym, again.runId ?? "");
      expect((await customerOf(gym, noraId))?.customer_id).toBe("CNORA1");
    });
  });

  describe("doing what the box said, once", () => {
    it("a long list read a page at a time; Square giving no answer is tried again; nothing is made twice", async () => {
      const gym = await makeGym("Big List Gym");
      // 250 of the business's customers nobody here is, and one who is.
      for (let i = 0; i < 250; i++) square.customer(gym.acct, { id: `CBIG${String(i)}`, given_name: "Cafe", family_name: `Customer ${String(i)}`, email_address: `cafe${String(i)}.${uniq()}@gmail.com` });
      const mia = `mia.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CMIA", given_name: "Mia", family_name: "Cole", email_address: mia });
      const miaId = await person(gym, "Mia Cole", { email: mia });
      const zoe = await person(gym, "Zoe Hart", { email: `zoe.${uniq()}@gmail.com` });
      square.state.customerPagesUntilDown = 1;
      const first = await check(gym);
      expect(first).toMatchObject({ state: "checking", looked: 100, unanswered: true });
      // Nobody's details but those who could be somebody here are kept.
      const kept = await sql<{ customer_id: string }[]>`SELECT customer_id FROM gym_square_member_candidates WHERE gym_id = ${gym.id}`;
      expect(kept).toHaveLength(0);
      square.state.customerPagesUntilDown = null;
      await membersWork();
      const checked = await box(gym);
      expect(checked.state).toBe("checked");
      expect(checked.groups.link.names).toEqual(["Mia Cole"]);
      expect(await sql`SELECT 1 FROM gym_square_member_candidates WHERE gym_id = ${gym.id}`).toHaveLength(0);

      // Square makes Zoe's customer and the answer is lost; the next minute asks with the same key.
      square.state.loseCustomers = true;
      const adding = await add(gym, checked.runId ?? "");
      expect(adding.state).toBe("adding");
      square.state.loseCustomers = false;
      // The same press again while it adds changes nothing.
      expect((await send("POST", `${boxUrl(gym)}/add`, gym.owner.cookies, { runId: checked.runId })).statusCode).toBe(200);
      await membersWork();
      expect((await box(gym)).state).toBe("added");
      const zoes = square.customersOf(gym.acct).filter((c) => c.reference_id === zoe);
      expect(zoes).toHaveLength(1);
      expect((await customerOf(gym, zoe))?.customer_id).toBe(zoes[0]?.id);
      expect(new Set(sentFor(zoe).map((c) => c.idempotencyKey)).size).toBe(1);
      expect((await customerOf(gym, miaId))?.customer_id).toBe("CMIA");
    });

    it("two presses of Add at once add each member once; a check an hour old or replaced is refused", async () => {
      const gym = await makeGym("Two Press Gym");
      const ids = await Promise.all(["Ava Bell", "Ben Ortiz", "Cara Diaz"].map((n, i) => person(gym, n, { email: `p${String(i)}.${uniq()}@gmail.com` })));
      const checked = await check(gym);
      const presses = await Promise.all([1, 2].map(() => send("POST", `${boxUrl(gym)}/add`, gym.owner.cookies, { runId: checked.runId })));
      expect(presses.map((r) => r.statusCode).sort()).toEqual([200, 200]);
      await membersWork();
      for (const id of ids) {
        expect(sentFor(id)).toHaveLength(1);
        expect(square.customersOf(gym.acct).filter((c) => c.reference_id === id)).toHaveLength(1);
      }
      // A check replaced by another, and one past its hour, are not added (somebody new to add in each).
      await person(gym, "Dee Fox", { email: `dee.${uniq()}@gmail.com` });
      const old = await check(gym);
      expect(old.state).toBe("checked");
      await check(gym);
      const replaced = await send("POST", `${boxUrl(gym)}/add`, gym.owner.cookies, { runId: old.runId });
      expect((JSON.parse(replaced.body) as { error: string }).error).toBe("square_members_check_changed");
      const current = await box(gym);
      clock = new Date(clock.getTime() + 61 * 60_000);
      const late = await send("POST", `${boxUrl(gym)}/add`, gym.owner.cookies, { runId: current.runId });
      expect((JSON.parse(late.body) as { error: string }).error).toBe("square_members_check_expired");
      clock = new Date();
    });

    it("a member whose details changed after the check is not added on the old reading", async () => {
      const gym = await makeGym("Changed Gym");
      const ivy = await person(gym, "Ivy Chen", { email: `ivy.${uniq()}@gmail.com` });
      const checked = await check(gym);
      const newer = `ivy.new.${uniq()}@gmail.com`;
      await sql`UPDATE gym_member_list_entries SET email = ${newer} WHERE gym_id = ${gym.id} AND id = ${ivy}`;
      await add(gym, checked.runId ?? "");
      const [plan] = await sql<{ outcome: string | null }[]>`SELECT outcome FROM gym_square_member_plan WHERE gym_id = ${gym.id} AND entry_id = ${ivy}`;
      // Looked at again by herself, with the email she has now, on the worker's minute.
      expect(plan?.outcome === "changed" || sentFor(ivy).every((c) => c.email === newer)).toBe(true);
      await membersWork();
      expect(sentFor(ivy).map((c) => c.email)).toEqual([newer]);
      expect((await customerOf(gym, ivy))?.customer_id).toMatch(/^CUS/);
    });

    it("a card being saved for the same member at that moment: one customer, whoever asks first", async () => {
      const gym = await makeGym("Card Race Gym");
      const jo = await person(gym, "Jo Rivera", { email: `jo.${uniq()}@gmail.com`, phone: "312-555-0111" });
      const checked = await check(gym);
      // A card save claimed the record's customer and Square made it with the card save's own body (no phone).
      const key = { gymId: gym.id, entryId: jo, environment: "production" as const, accountId: gym.acct.merchantId };
      const claimed = await claimCustomer(sql, key, randomUUID());
      if (!("makingKey" in claimed)) throw new Error("not being made");
      const made = square.customersMade.length;
      // Square answered the card save's ask, made with its own body (no phone), before ours arrives.
      square.madeWithKey(gym.acct, claimed.makingKey, { idempotencyKey: claimed.makingKey, givenName: "Jo", familyName: "Rivera", email: "jo-card-body@gmail.com", phone: null, referenceId: jo });
      await add(gym, checked.runId ?? "");
      await membersWork();
      expect(square.customersMade.length).toBeGreaterThan(made);
      const jos = square.customersOf(gym.acct).filter((c) => c.reference_id === jo);
      expect(jos).toHaveLength(1);
      expect((await customerOf(gym, jo))?.customer_id).toBe(jos[0]?.id);
    });
  });

  describe("nothing to add, and Square let go", () => {
    it("a check with nobody to add or link switches on adding new members by itself, with no press", async () => {
      const gym = await makeGym("All In Gym");
      const ida = `ida.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CIDA1", given_name: "Ida", family_name: "Ray", email_address: ida });
      square.customer(gym.acct, { id: "CIDA2", given_name: "Ida", family_name: "Ray", email_address: ida });
      await person(gym, "Ida Ray", { email: ida });
      const checked = await check(gym);
      expect(checked).toMatchObject({ state: "added", automatic: true });
      expect(checked.groups.several_customers).toEqual({ count: 1, names: ["Ida Ray"] });
      const later = await person(gym, "Jon Ray", { email: `jon.${uniq()}@gmail.com` });
      await membersWork([gym]);
      expect((await customerOf(gym, later))?.customer_id).toMatch(/^CUS/);
    });

    it("Disconnect drops the Square customers a check was holding, and the check starts from the first page again", async () => {
      const gym = await makeGym("Disconnect Mid Check Gym");
      for (let i = 0; i < 120; i++) square.customer(gym.acct, { id: `CDMC${String(i)}`, given_name: "Shop", family_name: `Buyer ${String(i)}`, email_address: `buyer${String(i)}.${uniq()}@gmail.com` });
      const lia = `lia.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CLIA", given_name: "Lia", family_name: "Moon", email_address: lia });
      // Lia comes on Square's second page; a member here shares the first page's first customer's email.
      const first = square.customersOf(gym.acct)[0]?.email_address ?? "";
      await person(gym, "Shop Buyer 0", { email: first });
      await person(gym, "Lia Moon", { email: lia });
      square.state.customerPagesUntilDown = 1;
      expect((await check(gym)).state).toBe("checking");
      square.state.customerPagesUntilDown = null;
      expect(await sql`SELECT 1 FROM gym_square_member_candidates WHERE gym_id = ${gym.id}`).toHaveLength(1);
      expect((await send("DELETE", `/v1/orgs/${gym.id}/payments/square`, gym.owner.cookies)).statusCode).toBe(200);
      expect(await sql`SELECT 1 FROM gym_square_member_candidates WHERE gym_id = ${gym.id}`).toHaveLength(0);
      const [run] = await sql<{ cursor: string | null; looked: number; listed_at: Date | null }[]>`SELECT cursor, looked, listed_at FROM gym_square_member_runs WHERE gym_id = ${gym.id}`;
      expect(run).toEqual({ cursor: null, looked: 0, listed_at: null });
    });
  });

  describe("new members, added by themselves", () => {
    it("a member added after: added on the worker's minute, or linked where Square has them; a refused one is said", async () => {
      const gym = await makeGym("Later Gym");
      await person(gym, "First Member", { email: `first.${uniq()}@gmail.com` });
      await add(gym, (await check(gym)).runId ?? "");
      const rose = `rose.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CROSE", given_name: "Rose", family_name: "Kim", email_address: rose });
      const roseId = await person(gym, "Rose Kim", { email: rose });
      const theo = await person(gym, "Theo Park", { email: `theo.${uniq()}@gmail.com` });
      const bad = `bad.${uniq()}@gmail.com`;
      square.state.createRefused.add(bad);
      const badId = await person(gym, "Una Refused", { email: bad });
      const run = await membersWork([gym]);
      expect(run.looked).toBe(3);
      expect((await customerOf(gym, roseId))?.customer_id).toBe("CROSE");
      expect(sentFor(roseId)).toHaveLength(0);
      expect((await customerOf(gym, theo))?.customer_id).toMatch(/^CUS/);
      expect(await customerOf(gym, badId)).toBeNull();
      const after = await box(gym);
      expect(after.groups.refused).toEqual({ count: 1, names: ["Una Refused"] });
      expect(after).toMatchObject({ members: 4, inSquare: 3 });
      // Nothing more to look at until the list moves or a day passes.
      expect((await membersWork([gym])).looked).toBe(0);
      square.state.createRefused.delete(bad);
      clock = new Date(clock.getTime() + SQUARE_MEMBERS_WORK.lookAgainMs + 60_000);
      expect((await membersWork([gym])).looked).toBe(1);
      clock = new Date();
      expect((await customerOf(gym, badId))?.customer_id).toMatch(/^CUS/);
    });

    it("the same rule as the check: a child on a parent's email is never linked to the parent", async () => {
      const gym = await makeGym("Later Family Gym");
      await person(gym, "Opening Member", { email: `open.${uniq()}@gmail.com` });
      await add(gym, (await check(gym)).runId ?? "");
      const dad = `dad.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CDAD", given_name: "John", family_name: "Smith", email_address: dad });
      const junior = await person(gym, "John Smith Jr", { email: dad });
      await membersWork();
      const linked = await customerOf(gym, junior);
      expect(linked?.customer_id).not.toBe("CDAD");
      expect(sentFor(junior)).toEqual([expect.objectContaining({ givenName: "John Smith", familyName: "Jr", email: dad })]);
    });
  });
});
