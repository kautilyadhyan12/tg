// Square's merges followed (ROADMAP 18d-iii-b-ii-b-ii-a; spec Part 3 §14.8): when Square merges customers into a
// new one, Square's signed message that the old one was deleted, the worker's minute and the routes follow it,
// against real Postgres (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`, which
// merges as Square's pages say Square does (an old id answers as the new customer; the cards go with it).
//
// The first block is the worst thing this job could do to a real person: a merge of two people followed, Sam
// (added on his mum Pat's email) merged by Square into "Pat Smith" and moved onto her customer, so her payments
// at the till land on his page. Every claim is read from the tables, or from Square's own record of what it took,
// never from the reply alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  squareMembersResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type SquareMembers,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 12).toString("base64"); // dummy test key, gitleaks:allow
const WEBHOOK_KEY = "square-merges-webhook-key"; // dummy test key, gitleaks:allow
const WEBHOOK_URL = "https://hooks.example.test/v1/webhooks/square";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "square-merges-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-SQUAREMERGES", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-SQUAREMERGESSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
};

const T = 240_000;
const LIVE_PLAN = "zz_square_merges";

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
interface Holder {
  entryId: string;
  membershipId: string;
}

let ipCounter = 0;
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

const weekly = {
  name: "Gold Weekly",
  description: null,
  kind: "recurring",
  priceMinor: 2500,
  termCount: 1,
  termUnit: "week",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};

d("Square's merges followed (real Postgres)", { timeout: T }, () => {
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
  /** The worker's minute, for these of Square's messages and this test's gyms alone. */
  const work = (eventIds: readonly string[] = []) =>
    processSquareWork(
      { sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock },
      eventIds,
      gyms.map((g) => g.id),
    );

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sqg-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'sqg-t-%@example.com'`;
    await sql`DELETE FROM gym_square_customer_merges WHERE account_id LIKE 'MSQG%'`;
    await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${mineSql}) OR account_id LIKE 'MSQG%'`;
    await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'sqg-t-%'`;
    await sql`DELETE FROM gym_square_member_runs WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_customers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'sqg-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  const signedIn = async (name: string): Promise<Person> => {
    const email = `sqg-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to a Square account (its own, unless one is given). */
  const makeGym = async (name: string, acct: Account = account(`MSQG${uniq()}`)): Promise<Gym> => {
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
  const typeOf = async (gym: Gym): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, weekly);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === weekly.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const held = async (gym: Gym, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  /** Gold Weekly from today, its first week paid at the desk in cash, then moved a week back so its second
   *  week's bill falls due today, opened by the bill run. */
  const owing = async (gym: Gym, typeId: string, entryId: string): Promise<Holder> => {
    const today = (await held(gym, entryId)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    await sql`UPDATE gym_held_memberships SET starts_on = starts_on - 7 WHERE gym_id = ${gym.id} AND id = ${m.id}`;
    await sql`UPDATE gym_member_bills SET due_on = due_on - 7, covers_from = covers_from - 7, covers_to = covers_to - 7 WHERE gym_id = ${gym.id} AND held_membership_id = ${m.id}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
    return { entryId, membershipId: m.id };
  };
  /** A card on file for a record, saved on this Square customer, as Card on file keeps one. */
  const cardOn = async (gym: Gym, entryId: string, customerId: string): Promise<string> => {
    const cardId = `ccof:${randomUUID()}`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', '1111', now())
      RETURNING id`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${gym.acct.merchantId}, ${customerId}, ${cardId}, 'VISA', '1111', 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    square.card(cardId, gym.acct.merchantId, customerId);
    return cardId;
  };
  const boxUrl = (gym: Gym) => `/v1/orgs/${gym.id}/payments/square/members`;
  const box = async (gym: Gym): Promise<SquareMembers> => {
    const res = await send("GET", boxUrl(gym), gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return squareMembersResponseSchema.parse(JSON.parse(res.body)).members;
  };
  /** The owner's Add members to Square, then Add, as the box shows them. */
  const addMembers = async (gym: Gym): Promise<SquareMembers> => {
    const checked = await send("POST", `${boxUrl(gym)}/check`, gym.owner.cookies);
    expect(checked.statusCode, checked.body).toBe(200);
    const runId = squareMembersResponseSchema.parse(JSON.parse(checked.body)).members.runId;
    const added = await send("POST", `${boxUrl(gym)}/add`, gym.owner.cookies, { runId });
    expect(added.statusCode, added.body).toBe(200);
    return squareMembersResponseSchema.parse(JSON.parse(added.body)).members;
  };
  /** The record's customer in the gym's Square account, as the app keeps it. */
  const customerOf = async (gym: Gym, entryId: string) => {
    const [row] = await sql<{ customer_id: string | null; joined_at: Date | null }[]>`
      SELECT customer_id, joined_at FROM gym_square_customers
      WHERE gym_id = ${gym.id} AND entry_id = ${entryId} AND environment = 'production' AND account_id = ${gym.acct.merchantId}`;
    return row ?? null;
  };
  const cardRow = async (gym: Gym, entryId: string) => {
    const [row] = await sql<{ customer_id: string; card_id: string; merged_away_at: Date | null }[]>`
      SELECT customer_id, card_id, merged_away_at FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
    return row ?? null;
  };
  /** Square's signed message, through the real route; `customer.deleted` for each old customer of a merge. */
  const signed = async (acct: Account, type: string, data: { type: string; id: string }): Promise<string> => {
    const eventId = `sqg-t-${uniq()}`;
    const payload = JSON.stringify({ merchant_id: acct.merchantId, type, event_id: eventId, data });
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
  const deleted = (acct: Account, customerId: string) => signed(acct, "customer.deleted", { type: "customer", id: customerId });
  /** A payment taken in Square Point of Sale, told to the app and taken in by the worker's minute. */
  const takenIn = async (gym: Gym, o: Parameters<typeof square.appPayment>[1]) => {
    const paid = square.appPayment(gym.acct, { locationId: gym.locationId, ...o });
    await work([await signed(gym.acct, "payment.created", { type: "payment", id: paid.id })]);
    const [row] = await sql<{ state: string; reason: string | null; entry_id: string | null }[]>`
      SELECT state, reason, entry_id FROM gym_square_app_payments WHERE square_payment_id = ${paid.id}`;
    if (row === undefined) throw new Error("not taken in");
    return row;
  };
  /** What Square took from a card on file, with the customer it was charged through. */
  const takenFrom = (cardId: string) => square.taken().filter((p) => p.cardId === cardId);
  const second = async (h: Holder) => {
    const [bill] = await sql<{ status: string }[]>`
      SELECT status FROM gym_member_bills WHERE held_membership_id = ${h.membershipId} AND period_index = 1`;
    return bill?.status ?? null;
  };
  const gymToday = async (gym: Gym) => (await held(gym, await person(gym, "Clock Reader", { email: `clock.${uniq()}@gmail.com` }))).today;

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

  describe("THE WORST THING: a merge of two people followed", () => {
    it("Square merges Sam's customer into his mum Pat's: Sam is not moved onto her, he is added again, his card is still charged for his bill, and her payment at the till is never his", async () => {
      const gym = await makeGym("Iron Barn");
      const typeId = await typeOf(gym);
      clock = new Date(`${await gymToday(gym)}T10:00:00Z`);
      const pat = `pat.smith.${uniq()}@gmail.com`;
      // Pat, typed in at the till long ago; Sam, her son, on her email, owes this week's Gold Weekly.
      square.customer(gym.acct, { id: "CPATSMITH", given_name: "Pat", family_name: "Smith", email_address: pat });
      const sam = await owing(gym, typeId, await person(gym, "Sam Smith", { email: pat }));
      expect((await addMembers(gym)).state).toBe("added");
      const samFirst = (await customerOf(gym, sam.entryId))?.customer_id ?? "";
      expect(samFirst).toMatch(/^CUS/);
      const samCard = await cardOn(gym, sam.entryId, samFirst);

      // Staff merge the two in Square's Dashboard, which keeps the older customer's details: "Pat Smith".
      const merged = square.merge(gym.acct, ["CPATSMITH", samFirst]);
      await work([await deleted(gym.acct, "CPATSMITH"), await deleted(gym.acct, samFirst)]);

      // Sam is not Pat's customer: he was separated from it, and added again by himself, with his own name.
      expect((await customerOf(gym, sam.entryId))?.customer_id, "Sam is never linked to Pat's merged customer").not.toBe(merged);
      await work();
      const samNow = (await customerOf(gym, sam.entryId))?.customer_id ?? null;
      expect(samNow).toMatch(/^CUS/);
      expect(samNow).not.toBe(samFirst);
      expect(square.customersMade.filter((c) => c.referenceId === sam.entryId).map((c) => [c.givenName, c.familyName, c.email])).toEqual([
        ["Sam", "Smith", pat],
        ["Sam", "Smith", pat],
      ]);
      // His card stays where Square keeps it, on the merged customer, and no longer says that customer is his.
      expect(await cardRow(gym, sam.entryId)).toMatchObject({ customer_id: merged, merged_away_at: expect.any(Date) as Date });

      // Pat pays $20.00 at the till with her merged customer picked: nobody's here, and not on Sam's page.
      const patPays = await takenIn(gym, { amount: 2000, customerId: merged });
      expect(patPays).toMatchObject({ state: "waiting", reason: "not_linked", entry_id: null });
      expect((await held(gym, sam.entryId)).squareAppWaiting, "nothing of Pat's waits on Sam's page").toEqual([]);

      // Noon: Sam's bill is charged to his own card, through the customer Square keeps it on, once.
      clock = new Date(clock.getTime() + 7 * 60 * 60_000);
      await work();
      expect(takenFrom(samCard).map((p) => [p.amount_money.amount, p.customer_id])).toEqual([[2500, merged]]);
      expect(await second(sam)).toBe("paid");
      // The box names nobody being added or left out: Sam is in Square, with a customer of his own.
      const seen = await box(gym);
      expect([seen.inSquare, seen.groups.waiting.count, seen.groups.merged_away.count]).toEqual([seen.members, 0, 0]);
    });

    it("Square merges Leo's two customers into one with his name: Leo follows it, his card is charged, and his payments at the till, before and after, come to his page", async () => {
      const gym = await makeGym("Elm Street Gym");
      const typeId = await typeOf(gym);
      clock = new Date(`${await gymToday(gym)}T10:00:00Z`);
      const leoEmail = `leo.grant.${uniq()}@gmail.com`;
      // Leo, typed in at the till by phone; the app links him and saves his card on that customer.
      square.customer(gym.acct, { id: "CLEOTILL", given_name: "LEO", family_name: "GRANT", phone_number: "(312) 555-0142" });
      const leo = await owing(gym, typeId, await person(gym, "Leo Grant", { email: leoEmail, phone: "312-555-0142" }));
      expect((await addMembers(gym)).state).toBe("added");
      expect((await customerOf(gym, leo.entryId))?.customer_id).toBe("CLEOTILL");
      const leoCard = await cardOn(gym, leo.entryId, "CLEOTILL");
      const merging = clock;
      // Square makes a second Leo (an instant profile from his email at the café), then merges the two.
      square.customer(gym.acct, { id: "CLEOCAFE", given_name: "Leo", family_name: "Grant", email_address: leoEmail });
      const merged = square.merge(gym.acct, ["CLEOTILL", "CLEOCAFE"]);
      await work([await deleted(gym.acct, "CLEOTILL"), await deleted(gym.acct, "CLEOCAFE")]);

      // Leo keeps the merged customer, as one Square made, never one the app may take out of Square.
      expect(await customerOf(gym, leo.entryId)).toMatchObject({ customer_id: merged, joined_at: expect.any(Date) as Date });
      expect(await cardRow(gym, leo.entryId)).toMatchObject({ customer_id: merged, merged_away_at: null });
      // Noon: his card is charged through the merged customer, where Square now keeps it.
      clock = new Date(clock.getTime() + 7 * 60 * 60_000);
      await work();
      expect(takenFrom(leoCard).map((p) => [p.amount_money.amount, p.customer_id])).toEqual([[2500, merged]]);
      expect(await second(leo)).toBe("paid");
      // His payments at the till come to his page: one Square took before the merge under the old id, told late, and a new one.
      expect((await takenIn(gym, { amount: 1500, customerId: "CLEOTILL", at: merging })).entry_id).toBe(leo.entryId);
      expect((await takenIn(gym, { amount: 1800, customerId: merged })).entry_id).toBe(leo.entryId);
    });

    it("a merged customer carrying Sam's own reference id, under Pat's name, is still never his", async () => {
      const gym = await makeGym("Oak Hall");
      const pat = `pat.oak.${uniq()}@gmail.com`;
      const sam = await person(gym, "Sam Smith", { email: pat });
      expect((await addMembers(gym)).state).toBe("added");
      const samFirst = (await customerOf(gym, sam))?.customer_id ?? "";
      square.customer(gym.acct, { id: "CPATOAK", given_name: "Pat", family_name: "Smith", email_address: pat });
      // Sam's customer is the older here, so the merged one keeps his record's id as its reference; staff keep Pat's name.
      const merged = square.merge(gym.acct, [samFirst, "CPATOAK"], { given_name: "Pat", family_name: "Smith" });
      expect(square.customersOf(gym.acct).find((c) => c.id === merged)?.reference_id).toBe(sam);
      await work([await deleted(gym.acct, samFirst), await deleted(gym.acct, "CPATOAK")]);
      await work();
      const now = (await customerOf(gym, sam))?.customer_id ?? null;
      expect(now, "Sam's reference id on Pat's merged customer never makes it his").not.toBe(merged);
      expect(now).toMatch(/^CUS/);
      // Pat's payment at the till with the merged customer picked is nobody's.
      expect(await takenIn(gym, { amount: 900, customerId: merged })).toMatchObject({ state: "waiting", reason: "not_linked", entry_id: null });
    });
  });

  describe("following a merge", () => {
    it("Square merging Sam into Pat's customer a second time within 30 days leaves him out, named in the box, until his details change", async () => {
      const gym = await makeGym("Twice Gym");
      const pat = `pat.twice.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CPATTWICE", given_name: "Pat", family_name: "Smith", email_address: pat });
      const sam = await person(gym, "Sam Smith", { email: pat });
      expect((await addMembers(gym)).state).toBe("added");
      const first = (await customerOf(gym, sam))?.customer_id ?? "";
      const once = square.merge(gym.acct, ["CPATTWICE", first]);
      await work([await deleted(gym.acct, "CPATTWICE"), await deleted(gym.acct, first)]);
      await work();
      const again = (await customerOf(gym, sam))?.customer_id ?? "";
      expect(again).toMatch(/^CUS/);
      // A week on, Square merges his new customer into Pat's again.
      clock = new Date(clock.getTime() + 7 * 24 * 60 * 60_000);
      square.merge(gym.acct, [once, again]);
      await work([await deleted(gym.acct, once), await deleted(gym.acct, again)]);
      await work();
      expect(await customerOf(gym, sam), "not added for Square to merge once more").toBeNull();
      expect(square.customersMade.filter((c) => c.referenceId === sam)).toHaveLength(2);
      const seen = await box(gym);
      expect(seen.groups.merged_away).toEqual({ count: 1, names: ["Sam Smith"] });
      // Nor a day later.
      clock = new Date(clock.getTime() + 25 * 60 * 60_000);
      await work();
      expect(await customerOf(gym, sam)).toBeNull();
      // His own email on his page: he is added again.
      const edit = await send("PATCH", entryUrl(gym, sam), gym.owner.cookies, { email: `sam.own.${uniq()}@gmail.com` });
      expect(edit.statusCode, edit.body).toBe(200);
      await work();
      expect((await customerOf(gym, sam))?.customer_id).toMatch(/^CUS/);
      expect((await box(gym)).groups.merged_away.count).toBe(0);
    });

    it("two records of one person whose customers Square merges: the one whose email the merged customer has keeps it, the other gets a customer of its own", async () => {
      const gym = await makeGym("Two Records Gym");
      const oneEmail = `nora.one.${uniq()}@gmail.com`;
      const one = await person(gym, "Nora Price", { email: oneEmail });
      const two = await person(gym, "Nora Price", { email: `nora.two.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      const a = (await customerOf(gym, one))?.customer_id ?? "";
      const b = (await customerOf(gym, two))?.customer_id ?? "";
      // Square keeps the first's details: Nora's first email.
      const merged = square.merge(gym.acct, [a, b]);
      await work([await deleted(gym.acct, a), await deleted(gym.acct, b)]);
      await work();
      // Neither kept it by the name alone (two records here have it); the look then linked the one whose email it has.
      expect((await customerOf(gym, one))?.customer_id).toBe(merged);
      const twoNow = (await customerOf(gym, two))?.customer_id ?? null;
      expect(twoNow).toMatch(/^CUS/);
      expect(twoNow).not.toBe(b);
      expect((await takenIn(gym, { amount: 700, customerId: merged })).entry_id).toBe(one);
    });

    it("a check waiting for its press that would link Ivy to a customer Square merges since does nothing for her; she is looked at again after", async () => {
      const gym = await makeGym("Waiting Check Gym");
      const ivyEmail = `ivy.chen.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CIVY", given_name: "Ivy", family_name: "Chen", email_address: ivyEmail });
      square.customer(gym.acct, { id: "CIVYTWO", given_name: "Ivy", family_name: "Chen", phone_number: "(312) 555-0199" });
      const ivy = await person(gym, "Ivy Chen", { email: ivyEmail });
      const checked = await send("POST", `${boxUrl(gym)}/check`, gym.owner.cookies);
      const members = squareMembersResponseSchema.parse(JSON.parse(checked.body)).members;
      expect(members.groups.link).toEqual({ count: 1, names: ["Ivy Chen"] });
      const merged = square.merge(gym.acct, ["CIVY", "CIVYTWO"]);
      await work([await deleted(gym.acct, "CIVY")]);
      expect((await box(gym)).groups.link.count, "the press no longer links her").toBe(0);
      const added = await send("POST", `${boxUrl(gym)}/add`, gym.owner.cookies, { runId: members.runId });
      expect(added.statusCode, added.body).toBe(200);
      expect((await customerOf(gym, ivy))?.customer_id ?? null, "never linked to the customer Square no longer has").not.toBe("CIVY");
      // Members are now added by themselves: the next look links her to the merged customer, which has her name.
      await work();
      expect((await customerOf(gym, ivy))?.customer_id).toBe(merged);
    });

    it("only the gyms that hold the old customer, in that Square account, are changed; a message about a customer nobody holds asks Square nothing", async () => {
      const shared = account(`MSQG${uniq()}`);
      const north = await makeGym("North Branch", shared);
      const south = await makeGym("South Branch", shared);
      const stranger = await makeGym("Stranger Gym");
      const email = `max.reed.${uniq()}@gmail.com`;
      square.customer(shared, { id: "CMAX", given_name: "Max", family_name: "Reed", email_address: email });
      square.customer(stranger.acct, { id: "CMAXS", given_name: "Max", family_name: "Reed", email_address: email });
      const maxNorth = await person(north, "Max Reed", { email });
      const maxSouth = await person(south, "Max Reed", { email });
      const maxStranger = await person(stranger, "Max Reed", { email });
      for (const g of [north, south, stranger]) expect((await addMembers(g)).state).toBe("added");
      expect((await customerOf(north, maxNorth))?.customer_id).toBe("CMAX");
      expect((await customerOf(south, maxSouth))?.customer_id).toBe("CMAX");
      expect((await customerOf(stranger, maxStranger))?.customer_id).toBe("CMAXS");
      square.customer(shared, { id: "CMAXTWO", given_name: "Max", family_name: "Reed", phone_number: "(312) 555-0177" });
      const merged = square.merge(shared, ["CMAX", "CMAXTWO"]);
      // The stranger's Square account says a customer of the same id was deleted: it is that account's own.
      await work([await deleted(shared, "CMAX"), await deleted(shared, "CMAXTWO"), await deleted(stranger.acct, "CMAX")]);
      expect((await customerOf(north, maxNorth))?.customer_id).toBe(merged);
      expect((await customerOf(south, maxSouth))?.customer_id).toBe(merged);
      expect((await customerOf(stranger, maxStranger))?.customer_id).toBe("CMAXS");
      const [kept] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_square_customer_merges WHERE account_id = ${stranger.acct.merchantId}`;
      expect(kept?.n).toBe(0);
      // A message about a customer no gym here holds: Square is not asked.
      const asked = square.customerReads.length;
      await work([await deleted(shared, "CNOBODY")]);
      expect(square.customerReads.length).toBe(asked);
    });

    it("Square not answering: nothing changes, and the message is tried again until it does", async () => {
      const gym = await makeGym("Quiet Square Gym");
      const zoe = await person(gym, "Zoe Park", { email: `zoe.park.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      const first = (await customerOf(gym, zoe))?.customer_id ?? "";
      square.customer(gym.acct, { id: "CZOETWO", given_name: "Zoe", family_name: "Park", phone_number: "(312) 555-0166" });
      const merged = square.merge(gym.acct, [first, "CZOETWO"]);
      const event = await deleted(gym.acct, first);
      square.state.down = true;
      await work([event]);
      square.state.down = false;
      expect((await customerOf(gym, zoe))?.customer_id).toBe(first);
      const [waiting] = await sql<{ not_before: Date }[]>`SELECT not_before FROM webhook_events WHERE provider = 'square' AND event_id = ${event} AND processed_at IS NULL`;
      expect(waiting?.not_before.getTime()).toBeGreaterThan(clock.getTime());
      clock = new Date(waiting?.not_before.getTime() ?? clock.getTime());
      await work([event]);
      expect((await customerOf(gym, zoe))?.customer_id).toBe(merged);
    });
  });
});
