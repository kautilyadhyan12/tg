// A member's change copied to Square (ROADMAP 18d-iii-b-ii-b-ii-b-i; spec Part 3 §14.8): once the owner has added the
// gym's members to Square, a changed name, email or phone is copied to their customer there by the worker's minute,
// through the real routes and real Postgres (DATABASE_URL-gated), with Square answered by the fake in
// `fakeSquareTerminal.ts`, which changes a customer as Square's test area did on 2026-10-28 (the version it wants, a
// null clearing a part, the codes it refuses with; `.cost/18d-iii-b-ii-b-ii-b-i/probe-update.mts`).
//
// The first block is the worst thing this job could do to a real person: a change for one member landing on somebody
// else's customer. Sam, added on his mum Pat's email, is merged by Square into Pat's customer, the app not yet told;
// Sam changes his phone, and it must never become Pat's. Every claim is read from Square's own record of what it
// was asked and what it holds now, never from the reply alone.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { squareConnectResponseSchema, squareFinishResponseSchema, squareMembersNamesResponseSchema, squareMembersResponseSchema, type SquareMembers } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 13).toString("base64"); // dummy test key, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "square-copies-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-SQUARECOPIES", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-SQUARECOPIESSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 240_000;
const LIVE_PLAN = "zz_square_copies";
const DAY = 24 * 60 * 60_000;

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
}

let ipCounter = 0;
const nextIp = () => `10.64.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("A member's change copied to Square (real Postgres)", { timeout: T }, () => {
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
  /** The worker's minute, for this test's gyms alone. */
  const work = () => processSquareWork({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock }, [], gyms.map((g) => g.id));
  /** The worker takes ten gyms a minute, oldest first: after the clock jumps a day every gym of this file is due, so a
   *  gym far down the file is reached on a later minute. */
  const workUntil = async (done: () => boolean, minutes = 6): Promise<void> => {
    for (let i = 0; i < minutes && !done(); i++) await work();
  };

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sqc-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'sqc-t-%@example.com'`;
    await sql`DELETE FROM gym_square_customer_merges WHERE account_id LIKE 'MSQC%'`;
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
    await sql`DELETE FROM users WHERE email LIKE 'sqc-t-%@example.com'`;
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
    const email = `sqc-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to a Square account (its own, unless one is given). */
  const makeGym = async (name: string, acct: Account = account(`MSQC${uniq()}`)): Promise<Gym> => {
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
    const gym = { id, name, owner, acct };
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
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  /** Staff change a member's details on their page. */
  const change = async (gym: Gym, entryId: string, patch: { fullName?: string; email?: string | null; phone?: string | null }) => {
    let res = await send("PATCH", entryUrl(gym, entryId), gym.owner.cookies, patch);
    if (res.statusCode === 409) {
      const people = (JSON.parse(res.body) as { people?: { entryId: string }[] }).people?.map((p) => p.entryId) ?? [];
      res = await send("PATCH", entryUrl(gym, entryId), gym.owner.cookies, { ...patch, acknowledgedDuplicates: people });
    }
    expect(res.statusCode, res.body).toBe(200);
  };
  const boxUrl = (gym: Gym) => `/v1/orgs/${gym.id}/payments/square/members`;
  const box = async (gym: Gym, cookies: Cookies = gym.owner.cookies): Promise<SquareMembers> => {
    const res = await send("GET", boxUrl(gym), cookies);
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
  /** The record's customer in the gym's Square account, as the app keeps it, with what Square last agreed with. */
  const link = async (gym: Gym, entryId: string) => {
    const [row] = await sql<
      { customer_id: string | null; joined_at: Date | null; copied_name: string | null; copied_email: string | null; copied_phone: string | null; copied_at: Date | null; copy_refused_at: Date | null }[]
    >`
      SELECT customer_id, joined_at, copied_name, copied_email, copied_phone, copied_at, copy_refused_at FROM gym_square_customers
      WHERE gym_id = ${gym.id} AND entry_id = ${entryId} AND environment = 'production' AND account_id = ${gym.acct.merchantId}`;
    return row ?? null;
  };
  const customerIdOf = async (gym: Gym, entryId: string): Promise<string> => {
    const id = (await link(gym, entryId))?.customer_id;
    if (id === null || id === undefined) throw new Error("not in Square");
    return id;
  };
  /** What Square holds of a customer now. */
  const held = (gym: Gym, customerId: string) => {
    const c = square.customersOf(gym.acct).find((x) => x.id === customerId);
    if (c === undefined) throw new Error("not in Square");
    return { given: c.given_name ?? null, family: c.family_name ?? null, email: c.email_address ?? null, phone: c.phone_number ?? null, version: c.version ?? 0 };
  };
  /** The changes Square was asked for in this gym's account. */
  const asked = (gym: Gym) => square.customersChanged.filter((c) => c.accountId === gym.acct.merchantId);

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

  describe("THE WORST THING: a change landing on somebody else's customer", () => {
    it("Square merged Sam's customer into his mum Pat's, the app not yet told: Sam's new phone is never written onto Pat's customer", async () => {
      const gym = await makeGym("Iron Barn");
      const pat = `pat.smith.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CPATSMITH", given_name: "Pat", family_name: "Smith", email_address: pat, phone_number: "+13125550100" });
      const sam = await person(gym, "Sam Smith", { email: pat, phone: "+13125550177" });
      expect((await addMembers(gym)).state).toBe("added");
      const samFirst = await customerIdOf(gym, sam);
      expect(samFirst).toMatch(/^CUS/);
      // Staff merge the two in Square's Dashboard, which keeps the older customer's details: Pat's. The app has not heard.
      const merged = square.merge(gym.acct, ["CPATSMITH", samFirst]);
      expect(held(gym, merged).phone).toBe("+13125550100");

      // Sam's own phone changes here.
      await change(gym, sam, { phone: "+13125550199" });
      await work();

      expect(asked(gym), "nothing was sent to Square for Sam, whose customer is now Pat's").toEqual([]);
      expect(held(gym, merged), "Pat's customer is exactly as Pat has it").toMatchObject({ given: "Pat", family: "Smith", email: pat, phone: "+13125550100", version: 0 });
      // The merge was followed instead: Sam is not Pat's customer, and is added again with his own details.
      await work();
      const samNow = await customerIdOf(gym, sam);
      expect(samNow).not.toBe(merged);
      expect(samNow).not.toBe(samFirst);
      expect(square.customersMade.filter((c) => c.referenceId === sam).map((c) => [c.givenName, c.familyName, c.phone])).toEqual([
        ["Sam", "Smith", "+13125550177"],
        ["Sam", "Smith", "+13125550199"],
      ]);
      expect(held(gym, merged).phone, "and Pat's still has hers").toBe("+13125550100");
    });

    it("the same, though the app was told of the merge: Sam is separated from Pat's customer, and his change is his own customer's", async () => {
      const gym = await makeGym("Elm Street Gym");
      const pat = `pat.elm.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CPATELM", given_name: "Pat", family_name: "Smith", email_address: pat, phone_number: "+13125550101" });
      const sam = await person(gym, "Sam Smith", { email: pat, phone: "+13125550178" });
      expect((await addMembers(gym)).state).toBe("added");
      const samFirst = await customerIdOf(gym, sam);
      const merged = square.merge(gym.acct, ["CPATELM", samFirst]);
      await change(gym, sam, { phone: "+13125550198" });
      await work();
      expect(asked(gym)).toEqual([]);
      expect(held(gym, merged).phone).toBe("+13125550101");
    });

    it("Square merges the customer in the instant between the app's question and its change: what was sent cannot be taken back, but the merge is followed and Sam is not left on Pat's customer", async () => {
      const gym = await makeGym("Quick Gym");
      const pat = `pat.quick.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CPATQUICK", given_name: "Pat", family_name: "Smith", email_address: pat });
      const sam = await person(gym, "Sam Smith", { email: pat, phone: "+13125550179" });
      expect((await addMembers(gym)).state).toBe("added");
      const samFirst = await customerIdOf(gym, sam);
      let merged = "";
      square.state.beforeUpdate = () => {
        merged = square.merge(gym.acct, ["CPATQUICK", samFirst]);
      };
      await change(gym, sam, { phone: "+13125550197" });
      await work();
      expect(merged).not.toBe("");
      await work();
      expect((await link(gym, sam))?.customer_id, "Sam is not left on the merged customer").not.toBe(merged);
      expect(await customerIdOf(gym, sam)).toMatch(/^CUS/);
    });

    it("a change at one gym never reaches another gym's Square account", async () => {
      const a = await makeGym("Gym A");
      const b = await makeGym("Gym B");
      const email = `same.person.${uniq()}@gmail.com`;
      const inA = await person(a, "Dana Cole", { email, phone: "+13125550120" });
      const inB = await person(b, "Dana Cole", { email, phone: "+13125550120" });
      expect((await addMembers(a)).state).toBe("added");
      expect((await addMembers(b)).state).toBe("added");
      const bBefore = held(b, await customerIdOf(b, inB));
      await change(a, inA, { phone: "+13125550121" });
      await work();
      expect(held(a, await customerIdOf(a, inA)).phone).toBe("+13125550121");
      expect(held(b, await customerIdOf(b, inB))).toEqual(bBefore);
      expect(asked(b)).toEqual([]);
    });
  });

  describe("a change copied", () => {
    it("a new phone changes the phone alone; Square's version moves on once, and asking again sends nothing", async () => {
      const gym = await makeGym("Oak Hall");
      const amy = await person(gym, "Amy Lee", { email: `amy.${uniq()}@gmail.com`, phone: "+13125550142" });
      expect((await addMembers(gym)).state).toBe("added");
      const customer = await customerIdOf(gym, amy);
      expect(held(gym, customer).version).toBe(0);
      expect(asked(gym), "adding a member sends no change").toEqual([]);
      await change(gym, amy, { phone: "+13125550143" });
      await work();
      expect(held(gym, customer)).toMatchObject({ given: "Amy", family: "Lee", phone: "+13125550143", version: 1 });
      expect(asked(gym)).toEqual([expect.objectContaining({ customerId: customer, version: 0, phone: "+13125550143" })]);
      expect(Object.keys(asked(gym)[0] ?? {}).sort(), "only the phone, with the version").toEqual(["accountId", "customerId", "phone", "version"]);
      await work();
      await work();
      expect(asked(gym), "nothing more to send").toHaveLength(1);
      expect(await box(gym)).toMatchObject({ unanswered: false });
    });

    it("name, email and phone changed together are one change; a part taken off the record is cleared in Square", async () => {
      const gym = await makeGym("Pine Court");
      const email = `ben.${uniq()}@gmail.com`;
      const ben = await person(gym, "Ben Ortiz", { email, phone: "+13125550150" });
      expect((await addMembers(gym)).state).toBe("added");
      const customer = await customerIdOf(gym, ben);
      const newEmail = `ben.o.${uniq()}@gmail.com`;
      await change(gym, ben, { fullName: "Ben Ortiz-Reyes", email: newEmail, phone: "+13125550151" });
      await work();
      expect(held(gym, customer)).toMatchObject({ given: "Ben", family: "Ortiz-Reyes", email: newEmail, phone: "+13125550151", version: 1 });
      expect(asked(gym)).toHaveLength(1);
      await change(gym, ben, { phone: null });
      await work();
      expect(held(gym, customer)).toMatchObject({ phone: null, email: newEmail, version: 2 });
    });

    it("a customer that was in Square before the app linked it keeps the name and email its business typed; only the changed phone is copied", async () => {
      const gym = await makeGym("Linked Gym");
      const email = `amy.linked.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CAMYTILL", given_name: "AMY L.", family_name: "LEE", email_address: email, phone_number: "(312) 555-0142" });
      const amy = await person(gym, "Amy Lee", { email, phone: "+13125550142" });
      expect((await addMembers(gym)).state).toBe("added");
      expect(await link(gym, amy)).toMatchObject({ customer_id: "CAMYTILL", joined_at: expect.any(Date) as Date });
      // The business fixes the email in Square by hand; then the member changes her phone here.
      const fixed = `amy.fixed.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CAMYTILL", given_name: "AMY L.", family_name: "LEE", email_address: fixed, phone_number: "(312) 555-0142", version: 3 });
      await change(gym, amy, { phone: "+13125550145" });
      await work();
      expect(held(gym, "CAMYTILL")).toMatchObject({ given: "AMY L.", family: "LEE", email: fixed, phone: "+13125550145", version: 4 });
    });

    it("a change that only restates what Square holds is not sent; the record is taken as agreed", async () => {
      const gym = await makeGym("Same Gym");
      const email = `cy.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CCYSAME", given_name: "Cy", family_name: "Young", email_address: email, phone_number: "(212) 555-4240" });
      const cy = await person(gym, "Cy Young", { email, phone: "+12125551111" });
      expect((await addMembers(gym)).state).toBe("added");
      // The business already changed Cy's number in Square to the one staff now type here.
      square.customer(gym.acct, { id: "CCYSAME", given_name: "Cy", family_name: "Young", email_address: email, phone_number: "+1 212-555-2222" });
      await change(gym, cy, { phone: "(212) 555-2222" });
      await work();
      expect(asked(gym)).toEqual([]);
      const row = await link(gym, cy);
      const [now] = await sql<{ same: boolean }[]>`
        SELECT copied_phone = md5(e.phone_e164) AS same FROM gym_square_customers c JOIN gym_member_list_entries e ON e.gym_id = c.gym_id AND e.id = c.entry_id
        WHERE c.gym_id = ${gym.id} AND c.entry_id = ${cy}`;
      expect(now?.same).toBe(true);
      expect(row?.copy_refused_at).toBeNull();
    });

    it("an uppercase-only or spacing-only edit of the name sends nothing", async () => {
      const gym = await makeGym("Case Gym");
      const dee = await person(gym, "Dee Park", { email: `dee.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      await change(gym, dee, { fullName: "DEE  PARK" });
      await work();
      expect(asked(gym)).toEqual([]);
    });
  });

  describe("what Square will not take", () => {
    it("a phone Square refuses is named in the box, Square keeps the old one, it is not asked again, and a good phone clears the line", async () => {
      const gym = await makeGym("Refusal Gym");
      const eli = await person(gym, "Eli Nunez", { email: `eli.${uniq()}@gmail.com`, phone: "+13125550160" });
      expect((await addMembers(gym)).state).toBe("added");
      const customer = await customerIdOf(gym, eli);
      square.state.updateRefused.add("+13125550161");
      await change(gym, eli, { phone: "+13125550161" });
      await work();
      expect(held(gym, customer).phone, "Square keeps the old phone").toBe("+13125550160");
      const seen = await box(gym);
      expect(seen.groups.not_copied).toEqual({ count: 1, names: ["Eli Nunez"] });
      expect((await link(gym, eli))?.copy_refused_at).toBeInstanceOf(Date);
      // Not asked again and again.
      const after = asked(gym).length;
      await work();
      await work();
      expect(asked(gym)).toHaveLength(after);
      // Staff who are not the owner read the count, not the names.
      const staff = await signedIn("Front Desk");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${staff.userId}, 'manager', ${null})`;
      const theirs = await send("GET", boxUrl(gym), staff.cookies);
      expect(theirs.statusCode, theirs.body).toBe(200);
      expect(squareMembersResponseSchema.parse(JSON.parse(theirs.body)).members.groups.not_copied).toEqual({ count: 1, names: [] });
      // A good phone replaces the refused one: copied, and the line goes.
      await change(gym, eli, { phone: "+13125550162" });
      await work();
      expect(held(gym, customer).phone).toBe("+13125550162");
      expect((await box(gym)).groups.not_copied.count).toBe(0);
      expect((await link(gym, eli))?.copy_refused_at).toBeNull();
    });

    it("a refusal is tried again a day later", async () => {
      const gym = await makeGym("Retry Gym");
      const fay = await person(gym, "Fay Ross", { email: `fay.${uniq()}@gmail.com`, phone: "+13125550170" });
      expect((await addMembers(gym)).state).toBe("added");
      const customer = await customerIdOf(gym, fay);
      square.state.updateRefused.add("+13125550171");
      await change(gym, fay, { phone: "+13125550171" });
      await work();
      const refusedCalls = asked(gym).length;
      expect(refusedCalls).toBe(1);
      // Square learns the number a day on.
      square.state.updateRefused.delete("+13125550171");
      clock = new Date(clock.getTime() + DAY + 60_000);
      await workUntil(() => held(gym, customer).phone === "+13125550171");
      expect(held(gym, customer).phone).toBe("+13125550171");
      expect((await box(gym)).groups.not_copied.count).toBe(0);
    });

    it("an email Square refuses is refused the same way, and the member's other parts wait with it", async () => {
      const gym = await makeGym("Email Gym");
      const gus = await person(gym, "Gus Hale", { email: `gus.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      const customer = await customerIdOf(gym, gus);
      const bad = `gus.new.${uniq()}@gmail.com`;
      square.state.updateRefused.add(bad);
      await change(gym, gus, { fullName: "Gus Hale-Kim", email: bad });
      await work();
      expect(held(gym, customer)).toMatchObject({ family: "Hale", version: 0 });
      expect((await box(gym)).groups.not_copied.count).toBe(1);
    });
  });

  describe("Square answering late, or not at all", () => {
    it("Square changed the customer meanwhile (409): nothing is written over, and the next minute copies", async () => {
      const gym = await makeGym("Conflict Gym");
      const hal = await person(gym, "Hal Vega", { email: `hal.${uniq()}@gmail.com`, phone: "+13125550180" });
      expect((await addMembers(gym)).state).toBe("added");
      const customer = await customerIdOf(gym, hal);
      await change(gym, hal, { phone: "+13125550181" });
      square.state.conflictNext = 1;
      await work();
      expect(held(gym, customer).phone, "refused by version, nothing written").toBe("+13125550180");
      expect((await box(gym)).groups.not_copied.count, "a conflict is not a refusal of the details").toBe(0);
      await work();
      expect(held(gym, customer).phone).toBe("+13125550181");
    });

    it("Square not answering: the box says so, the change waits, and it is copied when Square answers", async () => {
      const gym = await makeGym("Down Gym");
      const ivy = await person(gym, "Ivy Moon", { email: `ivy.${uniq()}@gmail.com`, phone: "+13125550190" });
      expect((await addMembers(gym)).state).toBe("added");
      const customer = await customerIdOf(gym, ivy);
      await change(gym, ivy, { phone: "+13125550191" });
      square.state.updateDown = true;
      await work();
      expect(held(gym, customer).phone).toBe("+13125550190");
      expect((await box(gym)).unanswered).toBe(true);
      square.state.updateDown = false;
      await work();
      expect(held(gym, customer).phone).toBe("+13125550191");
      expect((await box(gym)).unanswered).toBe(false);
    });

    it("a customer the business deleted in Square: the link is let go and the member is added again with their new details", async () => {
      const gym = await makeGym("Deleted Gym");
      const jon = await person(gym, "Jon Park", { email: `jon.${uniq()}@gmail.com`, phone: "+13125550200" });
      expect((await addMembers(gym)).state).toBe("added");
      const first = await customerIdOf(gym, jon);
      square.deleteCustomer(first);
      await change(gym, jon, { phone: "+13125550201" });
      await work();
      expect(asked(gym), "nothing sent to a customer that is gone").toEqual([]);
      await work();
      const next = await customerIdOf(gym, jon);
      expect(next).not.toBe(first);
      expect(held(gym, next).phone).toBe("+13125550201");
    });
  });

  describe("whose changes are copied", () => {
    it("a past member's change waits, and is copied when they are put back", async () => {
      const gym = await makeGym("Past Gym");
      const kim = await person(gym, "Kim Lowe", { email: `kim.${uniq()}@gmail.com`, phone: "+13125550210" });
      expect((await addMembers(gym)).state).toBe("added");
      const customer = await customerIdOf(gym, kim);
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${kim}`;
      await sql`UPDATE gym_member_list_entries SET phone_e164 = '+13125550211' WHERE gym_id = ${gym.id} AND id = ${kim}`;
      await sql`UPDATE gym_member_lists SET version = version + 1 WHERE gym_id = ${gym.id}`;
      await work();
      expect(asked(gym)).toEqual([]);
      await sql`UPDATE gym_member_list_entries SET former_at = NULL WHERE gym_id = ${gym.id} AND id = ${kim}`;
      await sql`UPDATE gym_member_lists SET version = version + 1 WHERE gym_id = ${gym.id}`;
      await work();
      expect(held(gym, customer).phone).toBe("+13125550211");
    });

    it("a gym whose owner never added members to Square has nothing copied, even for a member whose card made a customer", async () => {
      const gym = await makeGym("Card Only Gym");
      const lee = await person(gym, "Lee Chan", { email: `lee.${uniq()}@gmail.com`, phone: "+13125550220" });
      square.customer(gym.acct, { id: "CLEECARD", given_name: "Lee", family_name: "Chan", email_address: `lee.card.${uniq()}@gmail.com` });
      await sql`
        INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id)
        VALUES (${gym.id}, ${lee}, 'production', ${gym.acct.merchantId}, 'CLEECARD')`;
      await change(gym, lee, { phone: "+13125550221" });
      await work();
      expect(asked(gym)).toEqual([]);
      expect(held(gym, "CLEECARD").phone).toBeNull();
    });

    it("a customer a card made (nothing known of what it holds) takes the record as it is, sends nothing, and copies the next change", async () => {
      const gym = await makeGym("Card Gym");
      const mia = await person(gym, "Mia Cruz", { email: `mia.${uniq()}@gmail.com`, phone: "+13125550230" });
      const other = await person(gym, "Zed Zane", { email: `zed.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      // Mia's customer, as a card save made it, before copying knew anything of it.
      const customer = await customerIdOf(gym, mia);
      await sql`UPDATE gym_square_customers SET copied_name = NULL, copied_email = NULL, copied_phone = NULL, copied_at = NULL WHERE gym_id = ${gym.id} AND entry_id = ${mia}`;
      await change(gym, mia, { phone: "+13125550231" });
      await change(gym, other, { phone: "+13125550232" });
      await work();
      expect(asked(gym).map((c) => c.customerId), "only Zed's, whose agreement was known").toEqual([await customerIdOf(gym, other)]);
      expect(held(gym, customer).phone, "Mia's record is taken as it is: nothing is sent on a guess").toBe("+13125550230");
      expect((await link(gym, mia))?.copied_at).toBeInstanceOf(Date);
      await change(gym, mia, { phone: "+13125550233" });
      await work();
      expect(held(gym, customer).phone).toBe("+13125550233");
    });
  });

  describe("the migration's checks", () => {
    it("a copied part is a hash or nothing, and a refusal has its time", async () => {
      const gym = await makeGym("Checks Gym");
      const ned = await person(gym, "Ned Ray", { email: `ned.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      await expect(sql`UPDATE gym_square_customers SET copied_phone = 'not a hash' WHERE gym_id = ${gym.id} AND entry_id = ${ned}`).rejects.toThrow(/gym_square_customers_copied_check/);
      await expect(sql`UPDATE gym_square_customers SET copy_refused_digest = md5('x') WHERE gym_id = ${gym.id} AND entry_id = ${ned}`).rejects.toThrow(/gym_square_customers_refused_check/);
      await expect(sql`UPDATE gym_square_customers SET copy_refused_at = now() WHERE gym_id = ${gym.id} AND entry_id = ${ned}`).rejects.toThrow(/gym_square_customers_refused_check/);
    });
  });

  it("See all names the members Square did not take, for the owner", async () => {
    const gym = await makeGym("Names Gym");
    const ids: string[] = [];
    for (const [i, name] of ["Ann Bell", "Bo Cole", "Cy Dunn", "Di Eve"].entries()) {
      ids.push(await person(gym, name, { email: `names.${String(i)}.${uniq()}@gmail.com`, phone: `+1312555030${String(i)}` }));
    }
    expect((await addMembers(gym)).state).toBe("added");
    for (const [i, id] of ids.entries()) {
      square.state.updateRefused.add(`+1312555031${String(i)}`);
      await change(gym, id, { phone: `+1312555031${String(i)}` });
    }
    await work();
    await work();
    await work();
    const seen = await box(gym);
    expect(seen.groups.not_copied.count).toBe(4);
    expect(seen.groups.not_copied.names).toHaveLength(3);
    const res = await send("GET", `${boxUrl(gym)}/names?group=not_copied`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    expect(squareMembersNamesResponseSchema.parse(JSON.parse(res.body)).names).toEqual(["Ann Bell", "Bo Cole", "Cy Dunn", "Di Eve"]);
    void randomUUID;
  });
});
