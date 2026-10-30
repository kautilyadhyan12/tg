// Square's merges followed (ROADMAP 18d-iii-b-ii-b-ii-a; spec Part 3 §14.8): when Square merges customers into a
// new one, Square's signed message that the old one was deleted, the worker's minute and the routes follow it,
// against real Postgres (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`, which
// merges as Square's pages say Square does (an old id answers as the new customer; the cards go with it).
//
// The first block is the worst thing this job could do to a real person: a merge of two people followed, Sam
// (in Square on his mum Pat's email) merged by Square into "Pat Smith" and moved onto her customer. Every claim is
// read from the tables, or from Square's own record of what it took, never from the reply alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  cardAgreementWords,
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { putMembersInSquare } from "./squareCustomersSetup.js";
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
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'sqg-t-%'`;
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
    it("Square merges Sam's customer into his mum Pat's: Sam is not moved onto her, and his card is still charged for his own bill, once", async () => {
      const gym = await makeGym("Iron Barn");
      const typeId = await typeOf(gym);
      clock = new Date(`${await gymToday(gym)}T10:00:00Z`);
      const pat = `pat.smith.${uniq()}@gmail.com`;
      // Pat, typed in at the till long ago; Sam, her son, on her email, owes this week's Gold Weekly.
      square.customer(gym.acct, { id: "CPATSMITH", given_name: "Pat", family_name: "Smith", email_address: pat });
      const sam = await owing(gym, typeId, await person(gym, "Sam Smith", { email: pat }));
      await putMembersInSquare(sql, square, gym);
      const samFirst = (await customerOf(gym, sam.entryId))?.customer_id ?? "";
      expect(samFirst).toMatch(/^CUS/);
      const samCard = await cardOn(gym, sam.entryId, samFirst);

      // Staff merge the two in Square's Dashboard, which keeps the older customer's details: "Pat Smith".
      const merged = square.merge(gym.acct, ["CPATSMITH", samFirst]);
      await work([await deleted(gym.acct, "CPATSMITH"), await deleted(gym.acct, samFirst)]);

      // Sam is not Pat's customer: he was separated from it.
      expect(await customerOf(gym, sam.entryId), "Sam is never linked to Pat's merged customer").toBeNull();
      // His card stays where Square keeps it, on the merged customer, and no longer says that customer is his.
      expect(await cardRow(gym, sam.entryId)).toMatchObject({ customer_id: merged, merged_away_at: expect.any(Date) as Date });

      // Noon: Sam's bill is charged to his own card, through the customer Square keeps it on, once.
      clock = new Date(clock.getTime() + 7 * 60 * 60_000);
      await work();
      expect(takenFrom(samCard).map((p) => [p.amount_money.amount, p.customer_id])).toEqual([[2500, merged]]);
      expect(await second(sam)).toBe("paid");
    });

    it("Square merges Leo's two customers into one with his name: Leo follows it, and his card is charged through it", async () => {
      const gym = await makeGym("Elm Street Gym");
      const typeId = await typeOf(gym);
      clock = new Date(`${await gymToday(gym)}T10:00:00Z`);
      const leoEmail = `leo.grant.${uniq()}@gmail.com`;
      // Leo, typed in at the till by phone; the app links him and saves his card on that customer.
      square.customer(gym.acct, { id: "CLEOTILL", given_name: "LEO", family_name: "GRANT", phone_number: "(312) 555-0142" });
      const leo = await owing(gym, typeId, await person(gym, "Leo Grant", { email: leoEmail, phone: "312-555-0142" }));
      await putMembersInSquare(sql, square, gym);
      expect((await customerOf(gym, leo.entryId))?.customer_id).toBe("CLEOTILL");
      const leoCard = await cardOn(gym, leo.entryId, "CLEOTILL");
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
    });

    it("a merged customer carrying Sam's own reference id, under Pat's name, is still never his", async () => {
      const gym = await makeGym("Oak Hall");
      const pat = `pat.oak.${uniq()}@gmail.com`;
      const sam = await person(gym, "Sam Smith", { email: pat });
      await putMembersInSquare(sql, square, gym);
      const samFirst = (await customerOf(gym, sam))?.customer_id ?? "";
      square.customer(gym.acct, { id: "CPATOAK", given_name: "Pat", family_name: "Smith", email_address: pat });
      // Sam's customer is the older here, so the merged one keeps his record's id as its reference; staff keep Pat's name.
      const merged = square.merge(gym.acct, [samFirst, "CPATOAK"], { given_name: "Pat", family_name: "Smith" });
      expect(square.customersOf(gym.acct).find((c) => c.id === merged)?.reference_id).toBe(sam);
      await work([await deleted(gym.acct, samFirst), await deleted(gym.acct, "CPATOAK")]);
      await work();
      expect(await customerOf(gym, sam), "Sam's reference id on Pat's merged customer never makes it his").toBeNull();
    });
  });

  describe("following a merge", () => {
    it("Pat and her son Sam both members: Square merges their customers into Pat's, and only Pat keeps it", async () => {
      const gym = await makeGym("Mother Son Gym");
      const pat = `pat.both.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CPATBOTH", given_name: "Pat", family_name: "Smith", email_address: pat });
      const patId = await person(gym, "Pat Smith", { email: pat });
      const samId = await person(gym, "Sam Smith", { email: pat });
      await putMembersInSquare(sql, square, gym);
      expect((await customerOf(gym, patId))?.customer_id).toBe("CPATBOTH");
      const samOld = (await customerOf(gym, samId))?.customer_id ?? "";
      expect(samOld).toMatch(/^CUS/);
      const merged = square.merge(gym.acct, ["CPATBOTH", samOld]);
      await work([await deleted(gym.acct, "CPATBOTH"), await deleted(gym.acct, samOld)]);
      expect((await customerOf(gym, patId))?.customer_id).toBe(merged);
      expect(await customerOf(gym, samId)).toBeNull();
    });

    it("two records of one person whose customers Square merges: neither keeps it by the name alone, and the card on it no longer says whose it is", async () => {
      const gym = await makeGym("Two Records Gym");
      const one = await person(gym, "Nora Price", { email: `nora.one.${uniq()}@gmail.com` });
      const two = await person(gym, "Nora Price", { email: `nora.two.${uniq()}@gmail.com` });
      await putMembersInSquare(sql, square, gym);
      const a = (await customerOf(gym, one))?.customer_id ?? "";
      const b = (await customerOf(gym, two))?.customer_id ?? "";
      await cardOn(gym, one, a);
      const merged = square.merge(gym.acct, [a, b]);
      await work([await deleted(gym.acct, a), await deleted(gym.acct, b)]);
      expect(await customerOf(gym, one)).toBeNull();
      expect(await customerOf(gym, two)).toBeNull();
      expect(await cardRow(gym, one)).toMatchObject({ customer_id: merged, merged_away_at: expect.any(Date) as Date });
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
      for (const g of [north, south, stranger]) await putMembersInSquare(sql, square, g);
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
      // A message about a customer no gym here holds: Square is not asked.
      const asked = square.customerReads.length;
      await work([await deleted(shared, "CNOBODY")]);
      expect(square.customerReads.length).toBe(asked);
    });

    it("a card saved at the desk after a merge the app has not heard of yet is kept on the merged customer, never thrown away", async () => {
      const gym = await makeGym("Desk Save Gym");
      square.customer(gym.acct, { id: "CMIATILL", given_name: "Mia", family_name: "Hart", phone_number: "(312) 555-0144" });
      const mia = await person(gym, "Mia Hart", { email: `mia.hart.${uniq()}@gmail.com`, phone: "312-555-0144" });
      await putMembersInSquare(sql, square, gym);
      expect((await customerOf(gym, mia))?.customer_id).toBe("CMIATILL");
      // Square merges Mia's two customers; its message has not reached the app yet.
      square.customer(gym.acct, { id: "CMIACAFE", given_name: "Mia", family_name: "Hart", email_address: `mia.cafe.${uniq()}@gmail.com` });
      const merged = square.merge(gym.acct, ["CMIATILL", "CMIACAFE"]);
      // Staff save her card: Square puts it on the merged customer, as its test area did.
      const res = await send("POST", `${entryUrl(gym, mia)}/card`, gym.owner.cookies, {
        sourceId: `cnon:ok-VISA-4242-${uniq()}`,
        agreed: true,
        agreement: cardAgreementWords(gym.name),
        requestKey: randomUUID(),
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(await cardRow(gym, mia)).toMatchObject({ customer_id: merged, merged_away_at: null });
      // The merge is followed then and there: she is the merged customer's.
      expect(await customerOf(gym, mia)).toMatchObject({ customer_id: merged, joined_at: expect.any(Date) as Date });
      // And her card is charged through it.
      const card = (await cardRow(gym, mia))?.card_id ?? "";
      expect(square.cards.get(card)?.customerId).toBe(merged);
    });

    it("a card typed for Sam after Square merged him into Pat's customer is not kept on hers: staff are asked to type it again, and it goes on a customer of his own (round one, High 2)", async () => {
      const gym = await makeGym("Desk Save Two Gym");
      const pat = `pat.desk.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CPATDESK", given_name: "Pat", family_name: "Smith", email_address: pat });
      const sam = await person(gym, "Sam Smith", { email: pat });
      await putMembersInSquare(sql, square, gym);
      const first = (await customerOf(gym, sam))?.customer_id ?? "";
      const merged = square.merge(gym.acct, ["CPATDESK", first]);
      const save = () =>
        send("POST", `${entryUrl(gym, sam)}/card`, gym.owner.cookies, {
          sourceId: `cnon:ok-VISA-5151-${uniq()}`,
          agreed: true,
          agreement: cardAgreementWords(gym.name),
          requestKey: randomUUID(),
        });
      const refused = await save();
      expect(refused.statusCode, refused.body).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "card_merged_away", message: "In Square, this person had been merged with another customer, so the card wasn't saved. Type the card again to save it." });
      expect(await cardRow(gym, sam), "no card kept on Pat's customer").toBeNull();
      // The card Square put on Pat's customer is owed its stop at Square.
      const owed = [...square.cards.entries()].filter(([, c]) => c.customerId === merged).map(([id]) => id);
      expect(owed).toHaveLength(1);
      const [stop] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_card_disables WHERE gym_id = ${gym.id} AND card_id = ${owed[0] ?? ""}`;
      expect(stop?.n).toBe(1);
      expect((await customerOf(gym, sam))?.customer_id ?? null).not.toBe(merged);
      // Typed again: on a customer of his own.
      const again = await save();
      expect(again.statusCode, again.body).toBe(200);
      const own = (await customerOf(gym, sam))?.customer_id ?? "";
      expect(own).toMatch(/^CUS/);
      expect(own).not.toBe(first);
      expect(await cardRow(gym, sam)).toMatchObject({ customer_id: own, merged_away_at: null });
    });

    it("Square not answering: nothing changes, and the message is tried again until it does", async () => {
      const gym = await makeGym("Quiet Square Gym");
      const zoe = await person(gym, "Zoe Park", { email: `zoe.park.${uniq()}@gmail.com` });
      await putMembersInSquare(sql, square, gym);
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
