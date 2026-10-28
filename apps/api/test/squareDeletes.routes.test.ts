// Delete permanently takes the customer the app added out of Square (ROADMAP 18d-iii-b-ii-b-ii-b-ii; spec Part 3 §14.8):
// through the real routes and real Postgres (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`,
// which deletes a customer as Square's test area did on 2026-10-28 (the version it wants, 404 for one already gone, 200 and
// nothing done for the old id of a merged customer; `.cost/18d-iii-b-ii-b-ii-b-ii/probe-delete.mts`).
//
// The first block is the worst thing this job could do to a real person: deleting somebody else's customer. Sam, added on his
// mum Pat's email, is merged by Square into Pat's customer, the app not yet told; Sam is deleted for good, and Pat's customer,
// which is hers and has her Square subscription and loyalty points, must stay. Every claim is read from Square's own record of
// what it was asked and what it holds now, never from the reply alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  cardAgreementWords,
  memberListDeletePreviewResponseSchema,
  memberListDeletedResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  squareMembersResponseSchema,
  type MemberListDeletePreview,
  type MemberListDeleted,
  type SquareCustomer,
  type SquareMembers,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 14).toString("base64"); // dummy test key, gitleaks:allow
const WEBHOOK_KEY = "square-deletes-webhook-key"; // dummy test key, gitleaks:allow
const WEBHOOK_URL = "https://hooks.example.test/v1/webhooks/square";
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "square-deletes-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-SQUAREDELETES", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-SQUAREDELETESSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
};

const T = 240_000;
const LIVE_PLAN = "zz_square_deletes";

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
const nextIp = () => `10.65.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("Delete permanently takes the customer the app added out of Square (real Postgres)", { timeout: T }, () => {
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
  const logged: { event: string; why?: string }[] = [];
  const quiet = {
    info: (o: object) => void logged.push(o as { event: string }),
    warn: (o: object) => void logged.push(o as { event: string }),
    error: (o: object) => void logged.push(o as { event: string }),
  };
  const gyms: Gym[] = [];
  /** The worker's minute, for this test's gyms alone. */
  const work = (eventIds: readonly string[] = []) =>
    processSquareWork({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock }, eventIds, gyms.map((g) => g.id));
  const minutes = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await work();
      clock = new Date(clock.getTime() + 61_000);
    }
  };

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sqd-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'sqd-t-%@example.com'`;
    await sql`DELETE FROM gym_square_customer_merges WHERE account_id LIKE 'MSQD%'`;
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'sqd-t-%'`;
    await sql`DELETE FROM gym_square_customer_deletes WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_member_runs WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_disables WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'sqd-t-%@example.com'`;
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
    const email = `sqd-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to a Square account (its own, unless one is given). */
  const makeGym = async (name: string, acct: Account = account(`MSQD${uniq()}`)): Promise<Gym> => {
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
  const boxUrl = (gym: Gym) => `/v1/orgs/${gym.id}/payments/square/members`;
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
  const link = async (gym: Gym, entryId: string) => {
    const [row] = await sql<{ customer_id: string | null; joined_at: Date | null; made_as: string | null }[]>`
      SELECT customer_id, joined_at, made_as FROM gym_square_customers
      WHERE gym_id = ${gym.id} AND entry_id = ${entryId} AND environment = 'production' AND account_id = ${gym.acct.merchantId}`;
    return row ?? null;
  };
  const customerIdOf = async (gym: Gym, entryId: string): Promise<string> => {
    const id = (await link(gym, entryId))?.customer_id;
    if (id === null || id === undefined) throw new Error("not in Square");
    return id;
  };
  /** Square's signed message, through the real route. */
  const signed = async (acct: Account, type: string, data: { type: string; id: string }): Promise<string> => {
    const eventId = `sqd-t-${uniq()}`;
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
  /** What Square holds of a customer now, or null where it has none. */
  const held = (gym: Gym, customerId: string) => {
    const c = square.customersOf(gym.acct).find((x) => x.id === customerId);
    return c === undefined ? null : { given: c.given_name ?? null, family: c.family_name ?? null, email: c.email_address ?? null, phone: c.phone_number ?? null, version: c.version ?? 0 };
  };
  /** The deletions Square was asked for in this gym's account. */
  const asked = (gym: Gym) => square.customersDeleteAsked.filter((c) => c.accountId === gym.acct.merchantId);
  const owedRows = async (gym: Gym) =>
    await sql<{ customer_id: string | null; reference_id: string; tries: number }[]>`
      SELECT customer_id, reference_id, tries FROM gym_square_customer_deletes WHERE gym_id = ${gym.id} ORDER BY created_at, id`;

  /** Take a person off the list (Remove): a past member. */
  const takeOff = async (gym: Gym, entryId: string): Promise<void> => {
    const res = await send("DELETE", entryUrl(gym, entryId), gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };
  const tick = (...entryIds: string[]) => ({ kind: "ticked" as const, entryIds });
  /** The Delete permanently box for these people. */
  const boxFor = async (gym: Gym, ...entryIds: string[]): Promise<MemberListDeletePreview> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/member-list/selected/delete-preview`, gym.owner.cookies, { selection: tick(...entryIds) });
    expect(res.statusCode, res.body).toBe(200);
    return memberListDeletePreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  /** Delete permanently, as the owner does: Remove, open the box, press the button the box carries. */
  const deleteForGood = async (gym: Gym, ...entryIds: string[]): Promise<{ preview: MemberListDeletePreview; done: MemberListDeleted }> => {
    for (const id of entryIds) await takeOff(gym, id);
    const preview = await boxFor(gym, ...entryIds);
    const res = await send("POST", `/v1/orgs/${gym.id}/member-list/selected/delete`, gym.owner.cookies, { selection: tick(...entryIds), digest: preview.digest });
    expect(res.statusCode, res.body).toBe(200);
    return { preview, done: memberListDeletedResponseSchema.parse(JSON.parse(res.body)).done };
  };
  const stillThere = async (gym: Gym, entryId: string): Promise<boolean> => {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${entryId}`;
    return row !== undefined;
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

  describe("THE WORST THING: deleting somebody else's customer", () => {
    /** Pat has a customer in Square; Sam is on her email and was added to Square by the app with a customer of his own; Square then
     *  merged the two in its Dashboard, which keeps the older customer's details, Pat's, and the app has not heard. */
    const samMergedIntoPat = async (name: string, looksLikeSams = false) => {
      const gym = await makeGym(name);
      const pat = `pat.smith.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: `CPAT${uniq()}`, given_name: "Pat", family_name: "Smith", email_address: pat, phone_number: "+13125550100" });
      const patId = square.customersOf(gym.acct)[0]?.id ?? "";
      const sam = await person(gym, "Sam Smith", { email: pat, phone: "+13125550177" });
      expect((await addMembers(gym)).state).toBe("added");
      const samFirst = await customerIdOf(gym, sam);
      expect(samFirst).toMatch(/^CUS/);
      // `looksLikeSams`: the worst a merge can look like, with Sam's own reference id and a source that does not say it was a
      // merge, so nothing but the id Square answers with tells the app the customer is no longer Sam's.
      const merged = square.merge(gym.acct, [patId, samFirst], looksLikeSams ? { reference_id: sam, creation_source: "THIRD_PARTY" } : {});
      return { gym, pat, sam, samFirst, merged };
    };

    it("Sam is deleted for good after Square merged his customer into Pat's: Pat's customer is never asked about as Sam's, and still has her details", async () => {
      const { gym, pat, sam, samFirst, merged } = await samMergedIntoPat("Iron Barn");
      const { preview, done } = await deleteForGood(gym, sam);
      // The app has not heard of the merge: the box and the press are for Sam's own customer, as far as it knows.
      expect(preview.square).toEqual({ deletes: 1, stays: 0, shared: 0, notReached: 0 });
      expect(done).toMatchObject({ deleted: 1, squareDeleting: 1 });
      expect(await stillThere(gym, sam)).toBe(false);
      await minutes(2);
      expect(asked(gym), "Square was never asked to delete anything: the customer it answers with is Pat's").toEqual([]);
      expect(held(gym, merged), "Pat's customer is exactly as Pat has it").toMatchObject({ given: "Pat", family: "Smith", email: pat, phone: "+13125550100", version: 0 });
      expect(held(gym, samFirst)).toBeNull();
      expect(await owedRows(gym), "and nothing is left owed").toEqual([]);
      expect(logged.some((l) => l.event === "square.customer_delete_kept" && l.why === "answered_as_another")).toBe(true);
    });

    it("the same, though Square would delete the merged customer if asked to delete the old id: the app does not lean on Square's answer", async () => {
      const { gym, pat, sam, merged } = await samMergedIntoPat("Elm Street Gym");
      square.state.deleteViaOldId = "deletes_merged";
      try {
        await deleteForGood(gym, sam);
        await minutes(2);
        expect(asked(gym)).toEqual([]);
        expect(held(gym, merged), "Pat's customer survives even a Square that deletes through the old id").toMatchObject({ given: "Pat", email: pat, phone: "+13125550100" });
      } finally {
        square.state.deleteViaOldId = "nothing";
      }
    });

    it("even a merged customer that looks exactly like Sam's own (his reference id, no sign of a merge) is never deleted: only the id Square answers with says it is no longer his", async () => {
      const { gym, pat, sam, samFirst, merged } = await samMergedIntoPat("Look-Alike Gym", true);
      square.state.deleteViaOldId = "deletes_merged";
      try {
        await deleteForGood(gym, sam);
        await minutes(2);
        expect(asked(gym), "Square was never asked to delete anything").toEqual([]);
        expect(held(gym, merged), "Pat's customer is exactly as Pat has it").toMatchObject({ email: pat, phone: "+13125550100" });
        expect(held(gym, samFirst)).toBeNull();
        expect(logged.some((l) => l.event === "square.customer_delete_kept" && l.why === "answered_as_another")).toBe(true);
      } finally {
        square.state.deleteViaOldId = "nothing";
      }
    });

    it("Square merges the customer in the instant between the app's question and its delete: Pat's customer is still hers", async () => {
      const gym = await makeGym("Quick Gym");
      const pat = `pat.quick.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: `CPATQ${uniq()}`, given_name: "Pat", family_name: "Smith", email_address: pat, phone_number: "+13125550103" });
      const patId = square.customersOf(gym.acct)[0]?.id ?? "";
      const sam = await person(gym, "Sam Smith", { email: pat, phone: "+13125550179" });
      expect((await addMembers(gym)).state).toBe("added");
      const samFirst = await customerIdOf(gym, sam);
      await deleteForGood(gym, sam);
      let merged = "";
      square.state.beforeDelete = () => {
        merged = square.merge(gym.acct, [patId, samFirst]);
      };
      await minutes(2);
      expect(merged).not.toBe("");
      // Square's test area answered a delete of the old id 200 and left the merged customer alone (2026-10-28).
      expect(held(gym, merged), "Pat's merged customer is still there with her details").toMatchObject({ given: "Pat", email: pat, phone: "+13125550103" });
    });
  });

  /** A past member with the customer the app added, deleted for good: the customer is owed its deletion and Square is not yet asked. */
  const madeAndForgotten = async (name: string) => {
    const gym = await makeGym(name);
    const email = `who.${uniq()}@gmail.com`;
    const id = await person(gym, "Wren Ito", { email, phone: "+13125550142" });
    expect((await addMembers(gym)).state).toBe("added");
    const customerId = await customerIdOf(gym, id);
    const forgotten = await deleteForGood(gym, id);
    return { gym, id, customerId, email, ...forgotten };
  };
  /** Square's customer as it is now, changed by the business in its Dashboard. */
  const changeInSquare = (gym: Gym, customerId: string, over: Partial<SquareCustomer>) => {
    const now = square.customersOf(gym.acct).find((c) => c.id === customerId);
    if (now === undefined) throw new Error("not in Square");
    const { accountId: _account, ...rest } = now;
    void _account;
    square.customer(gym.acct, { ...rest, ...over });
  };

  describe("the customer the app added", () => {
    it("added by Add members to Square: the box says so, and the worker deletes exactly that customer, with the version it read, and no other", async () => {
      const gym = await makeGym("Oak Hall");
      const amy = await person(gym, "Amy Lee", { email: `amy.${uniq()}@gmail.com`, phone: "+13125550142" });
      const bo = await person(gym, "Bo Park", { email: `bo.${uniq()}@gmail.com`, phone: "+13125550143" });
      expect((await addMembers(gym)).state).toBe("added");
      const amyId = await customerIdOf(gym, amy);
      const boId = await customerIdOf(gym, bo);
      expect(await link(gym, amy), "made by the app: it carries the record's id").toMatchObject({ joined_at: null, made_as: amy });
      const { preview, done } = await deleteForGood(gym, amy);
      expect(preview).toMatchObject({ count: 1, square: { deletes: 1, stays: 0, shared: 0, notReached: 0 }, squareNames: { deletes: ["Amy Lee"], stays: [], shared: [], notReached: [] } });
      expect(done).toMatchObject({ deleted: 1, squareDeleting: 1 });
      expect(await owedRows(gym)).toEqual([{ customer_id: amyId, reference_id: amy, tries: 0 }]);
      expect(held(gym, amyId), "the worker sends it, the press does not").not.toBeNull();
      await minutes(1);
      expect(held(gym, amyId), "Amy's customer is gone from Square").toBeNull();
      expect(asked(gym), "asked once, with the version it read").toEqual([{ customerId: amyId, version: 0, accountId: gym.acct.merchantId }]);
      expect(held(gym, boId), "Bo, still a member, keeps his").not.toBeNull();
      expect(await owedRows(gym)).toEqual([]);
      // Square's own message that it was deleted finds no record that holds it, and changes nothing.
      const eventId = await signed(gym.acct, "customer.deleted", { type: "customer", id: amyId });
      await work([eventId]);
      const [event] = await sql<{ status: string }[]>`SELECT status FROM webhook_events WHERE provider = 'square' AND event_id = ${eventId}`;
      expect(event?.status).toBe("done");
      expect(held(gym, boId)).not.toBeNull();
    });

    it("added by saving a card, with no Add members press at all: deleted too, and the card is owed its own stop", async () => {
      const gym = await makeGym("Card Only Gym");
      const nia = await person(gym, "Nia Cole", { email: `nia.${uniq()}@gmail.com`, phone: "+13125550241" });
      const saved = await send("POST", `${entryUrl(gym, nia)}/card`, gym.owner.cookies, {
        sourceId: `cnon:ok-VISA-4242-12-2030-${uniq()}`,
        agreed: true,
        agreement: cardAgreementWords(gym.name),
        requestKey: randomUUID(),
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const customerId = await customerIdOf(gym, nia);
      expect(await link(gym, nia)).toMatchObject({ joined_at: null, made_as: nia });
      const { preview, done } = await deleteForGood(gym, nia);
      expect(preview.square).toEqual({ deletes: 1, stays: 0, shared: 0, notReached: 0 });
      expect(done.squareDeleting).toBe(1);
      const [stop] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM gym_card_disables WHERE gym_id = ${gym.id}`;
      expect(Number(stop?.n), "the card is owed its stop, as before").toBe(1);
      await minutes(1);
      expect(held(gym, customerId)).toBeNull();
    });

    it("a customer the app made whose answer was lost, found again by Members in Square by the record's id: it is the app's, and deleted with the person", async () => {
      const gym = await makeGym("Lost Answer Gym");
      const email = `ola.${uniq()}@gmail.com`;
      const ola = await person(gym, "Ola Berg", { email, phone: "+13125550160" });
      // Square made it for this record, with the record's id as its reference, and the app never heard.
      const made = square.madeWithKey(gym.acct, randomUUID(), { idempotencyKey: "lost", givenName: "Ola", familyName: "Berg", email, phone: "+13125550160", referenceId: ola });
      expect((await addMembers(gym)).state).toBe("added");
      expect(await link(gym, ola), "linked as the app's own, carrying the record's id").toMatchObject({ customer_id: made, joined_at: null, made_as: ola });
      const { preview, done } = await deleteForGood(gym, ola);
      expect(preview.square).toEqual({ deletes: 1, stays: 0, shared: 0, notReached: 0 });
      expect(done.squareDeleting).toBe(1);
      await minutes(1);
      expect(held(gym, made)).toBeNull();
    });

    it("a customer that was already in Square and only linked stays, and the box says so", async () => {
      const gym = await makeGym("Linked Gym");
      const email = `leo.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CLEOTILL", given_name: "Leo", family_name: "Grant", email_address: email, phone_number: "(312) 555-0142" });
      const leo = await person(gym, "Leo Grant", { email, phone: "+13125550142" });
      expect((await addMembers(gym)).state).toBe("added");
      expect(await link(gym, leo)).toMatchObject({ customer_id: "CLEOTILL", joined_at: expect.any(Date) as Date });
      const { preview, done } = await deleteForGood(gym, leo);
      expect(preview.square).toEqual({ deletes: 0, stays: 1, shared: 0, notReached: 0 });
      expect(done.squareDeleting).toBe(0);
      await minutes(2);
      expect(asked(gym), "Square was not asked to delete anything").toEqual([]);
      expect(held(gym, "CLEOTILL"), "the business's own customer is untouched").toMatchObject({ given: "Leo", family: "Grant", email, version: 0 });
    });

    it("a customer the app made and Square then merged, which the app followed, is no longer one the app made: the box says it stays and nothing is owed", async () => {
      const gym = await makeGym("Followed Gym");
      const email = `amy.lee.${uniq()}@gmail.com`;
      const amy = await person(gym, "Amy Lee", { email, phone: "+13125550150" });
      expect((await addMembers(gym)).state).toBe("added");
      const made = await customerIdOf(gym, amy);
      // The business also typed Amy in at the till, then merged the two in its Square Dashboard; Square told the app, which followed.
      square.customer(gym.acct, { id: "CAMYTILL", given_name: "Amy", family_name: "Lee", email_address: email });
      const merged = square.merge(gym.acct, [made, "CAMYTILL"]);
      await work([await signed(gym.acct, "customer.deleted", { type: "customer", id: made }), await signed(gym.acct, "customer.deleted", { type: "customer", id: "CAMYTILL" })]);
      expect(await link(gym, amy), "Amy keeps the merged customer, as one Square made").toMatchObject({ customer_id: merged, joined_at: expect.any(Date) as Date });
      const { preview, done } = await deleteForGood(gym, amy);
      expect(preview.square).toEqual({ deletes: 0, stays: 1, shared: 0, notReached: 0 });
      expect(done.squareDeleting).toBe(0);
      expect(await owedRows(gym)).toEqual([]);
      await minutes(2);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, merged), "the merged customer is still in Square").not.toBeNull();
    });

    it("several people in one press: each counted once by what happens to their customer, and only the app's are deleted", async () => {
      const gym = await makeGym("Mixed Gym");
      const email = `mix.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CTILLONE", given_name: "Till", family_name: "One", email_address: email });
      const till = await person(gym, "Till One", { email });
      const madeOne = await person(gym, "Made One", { email: `made1.${uniq()}@gmail.com` });
      const madeTwo = await person(gym, "Made Two", { email: `made2.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      const noSquare = await person(gym, "No Square", { email: `none.${uniq()}@gmail.com` });
      const madeIds = [await customerIdOf(gym, madeOne), await customerIdOf(gym, madeTwo)];
      const { preview, done } = await deleteForGood(gym, till, madeOne, madeTwo, noSquare);
      expect(preview).toMatchObject({
        count: 4,
        square: { deletes: 2, stays: 1, shared: 0, notReached: 0 },
        squareNames: { deletes: ["Made One", "Made Two"], stays: ["Till One"], shared: [], notReached: [] },
      });
      expect(done).toMatchObject({ deleted: 4, squareDeleting: 2 });
      await minutes(2);
      expect(asked(gym).map((a) => a.customerId).sort()).toEqual([...madeIds].sort());
      expect(held(gym, "CTILLONE")).not.toBeNull();
    });
  });

  describe("what is left in Square", () => {
    it("a customer the business deleted in Square already is done: nothing is asked to be deleted", async () => {
      const { gym, customerId } = await madeAndForgotten("Gone Gym");
      square.deleteCustomer(customerId);
      await minutes(1);
      expect(asked(gym)).toEqual([]);
      expect(await owedRows(gym)).toEqual([]);
    });

    it("a customer whose reference id is no longer the one the app gave it is left: it is not the customer the app made", async () => {
      const { gym, customerId } = await madeAndForgotten("Edited Gym");
      changeInSquare(gym, customerId, { reference_id: "typed by the business" });
      await minutes(1);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, customerId)).not.toBeNull();
      expect(await owedRows(gym)).toEqual([]);
      expect(logged.some((l) => l.event === "square.customer_delete_kept" && l.why === "not_made_by_app")).toBe(true);
    });

    it("a customer Square made by a merge is left, though it carries the record's reference id", async () => {
      const { gym, customerId } = await madeAndForgotten("Merge Source Gym");
      changeInSquare(gym, customerId, { creation_source: "MERGE" });
      await minutes(1);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, customerId)).not.toBeNull();
    });

    it("a customer changed in Square between the app's question and its delete is not deleted on a stale version: it is read again and deleted on the next try", async () => {
      const { gym, customerId } = await madeAndForgotten("Busy Gym");
      square.state.beforeDelete = () => {
        changeInSquare(gym, customerId, { version: 7 });
      };
      await minutes(1);
      expect(held(gym, customerId), "Square refused the stale version").not.toBeNull();
      expect(asked(gym)).toEqual([{ customerId, version: 0, accountId: gym.acct.merchantId }]);
      expect((await owedRows(gym))[0]?.tries).toBe(1);
      await minutes(1);
      expect(held(gym, customerId)).toBeNull();
      expect(asked(gym).map((a) => a.version)).toEqual([0, 7]);
      expect(await owedRows(gym)).toEqual([]);
    });

    it("Square not answering is tried again with growing waits, and a customer Square never lets go is given up after twelve tries and said in the log", async () => {
      const { gym, customerId } = await madeAndForgotten("Down Gym");
      square.state.deleteDown = true;
      try {
        await minutes(1);
        expect((await owedRows(gym))[0]?.tries).toBe(1);
        expect(held(gym, customerId), "Square did not answer, so nothing was deleted").not.toBeNull();
      } finally {
        square.state.deleteDown = false;
      }
      await minutes(1);
      expect(held(gym, customerId)).toBeNull();
      expect(await owedRows(gym)).toEqual([]);

      const second = await madeAndForgotten("Never Gym");
      await sql`UPDATE gym_square_customer_deletes SET tries = 11 WHERE gym_id = ${second.gym.id}`;
      square.state.deleteDown = true;
      try {
        await minutes(1);
      } finally {
        square.state.deleteDown = false;
      }
      expect(await owedRows(second.gym), "given up").toEqual([]);
      expect(held(second.gym, second.customerId)).not.toBeNull();
      expect(logged.some((l) => l.event === "square.customer_delete_given_up")).toBe(true);
    });

    // Round one, High 1: deleting a customer cancels Square's own subscriptions on it, and the app does not make them.
    it.each(["ACTIVE", "PENDING", "PAUSED"])("a customer one of Square's own subscriptions still charges (%s) is left: it is asked about, never deleted", async (status) => {
      const { gym, customerId } = await madeAndForgotten(`Charged ${status} Gym`);
      square.subscription(gym.acct, customerId, status);
      await minutes(2);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, customerId)).not.toBeNull();
      expect(await owedRows(gym)).toEqual([]);
      expect(logged.some((l) => l.event === "square.customer_delete_kept" && l.why === "charged_by_square")).toBe(true);
    });

    it.each(["CANCELED", "DEACTIVATED"])("a customer whose subscription has ended (%s) is deleted", async (status) => {
      const { gym, customerId } = await madeAndForgotten(`Ended ${status} Gym`);
      square.subscription(gym.acct, customerId, status);
      await minutes(1);
      expect(held(gym, customerId)).toBeNull();
    });

    it("Square's subscriptions not answering is tried again: nothing is deleted on a guess", async () => {
      const { gym, customerId } = await madeAndForgotten("Subscriptions Down Gym");
      square.state.subscriptionsDown = true;
      try {
        await minutes(1);
        expect(asked(gym), "not deleted while it cannot be checked").toEqual([]);
        expect((await owedRows(gym))[0]?.tries).toBe(1);
      } finally {
        square.state.subscriptionsDown = false;
      }
      await minutes(1);
      expect(held(gym, customerId)).toBeNull();
    });

    it("Square refusing to show its subscriptions leaves the customer, said in the log", async () => {
      const { gym, customerId } = await madeAndForgotten("Subscriptions Refused Gym");
      square.state.subscriptionsRefused = true;
      try {
        await minutes(1);
      } finally {
        square.state.subscriptionsRefused = false;
      }
      expect(asked(gym)).toEqual([]);
      expect(held(gym, customerId)).not.toBeNull();
      expect(await owedRows(gym)).toEqual([]);
      expect(logged.some((l) => l.event === "square.customer_delete_subscriptions_refused")).toBe(true);
    });

    it("a subscription Square sends that the app cannot read leaves the customer: it is not guessed to be clear", async () => {
      const { gym, customerId } = await madeAndForgotten("Unreadable Subscription Gym");
      square.state.subscriptionsUnread = true;
      try {
        await minutes(1);
      } finally {
        square.state.subscriptionsUnread = false;
      }
      expect(asked(gym)).toEqual([]);
      expect(held(gym, customerId)).not.toBeNull();
      expect(await owedRows(gym)).toEqual([]);
    });

    it("a gym whose connection cannot read Square's subscriptions cannot be asked first: the box says the app cannot reach Square, nothing is owed, and the customer stays", async () => {
      const gym = await makeGym("No Permission Gym");
      const id = await person(gym, "Dov Ash", { email: `dov.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      const customerId = await customerIdOf(gym, id);
      await sql`UPDATE gym_payment_connections SET scopes = array_remove(scopes, 'SUBSCRIPTIONS_READ') WHERE gym_id = ${gym.id}`;
      const { preview, done } = await deleteForGood(gym, id);
      expect(preview.square).toEqual({ deletes: 0, stays: 0, shared: 0, notReached: 1 });
      expect(done.squareDeleting).toBe(0);
      await minutes(1);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, customerId)).not.toBeNull();
    });

    it("the permission taken away between the press and the worker: the customer is left, said in the log", async () => {
      const { gym, customerId } = await madeAndForgotten("Permission Lost Gym");
      await sql`UPDATE gym_payment_connections SET scopes = array_remove(scopes, 'SUBSCRIPTIONS_READ') WHERE gym_id = ${gym.id}`;
      await minutes(1);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, customerId)).not.toBeNull();
      expect(await owedRows(gym)).toEqual([]);
      expect(logged.some((l) => l.event === "square.customer_delete_kept" && l.why === "cannot_check_subscriptions")).toBe(true);
    });

    it("a gym no longer connected to that Square account cannot reach the customer: the box says so, nothing is owed, and the customer stays", async () => {
      const gym = await makeGym("Moved Gym");
      const id = await person(gym, "Cal Ng", { email: `cal.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      const customerId = await customerIdOf(gym, id);
      await sql`UPDATE gym_payment_connections SET account_id = 'MSQDOTHERACCOUNT' WHERE gym_id = ${gym.id}`;
      const { preview, done } = await deleteForGood(gym, id);
      expect(preview.square).toEqual({ deletes: 0, stays: 0, shared: 0, notReached: 1 });
      expect(preview.squareNames.notReached).toEqual(["Cal Ng"]);
      expect(done.squareDeleting).toBe(0);
      expect(await owedRows(gym)).toEqual([]);
      await minutes(1);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, customerId)).not.toBeNull();
    });

    it("a gym that disconnected after the press cannot reach it either: the owed deletion is let go, not sent to the wrong account", async () => {
      const { gym, customerId } = await madeAndForgotten("Left Gym");
      await sql`UPDATE gym_payment_connections SET account_id = 'MSQDELSEWHERE' WHERE gym_id = ${gym.id}`;
      await minutes(1);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, customerId)).not.toBeNull();
      expect(await owedRows(gym)).toEqual([]);
      expect(logged.some((l) => l.event === "square.customer_delete_unreachable")).toBe(true);
    });
  });

  describe("a customer two records use", () => {
    it("two gyms of one owner share a Square account: the gym that made the customer deletes its person, and the customer the other gym linked stays, said in the box", async () => {
      const a = await makeGym("Branch A");
      const b = await makeGym("Branch B", a.acct);
      const email = `dana.${uniq()}@gmail.com`;
      const inA = await person(a, "Dana Cole", { email, phone: "+13125550120" });
      expect((await addMembers(a)).state).toBe("added");
      const inB = await person(b, "Dana Cole", { email, phone: "+13125550120" });
      expect((await addMembers(b)).state).toBe("added");
      const customerId = await customerIdOf(a, inA);
      expect(await customerIdOf(b, inB), "Branch B linked the customer Branch A made").toBe(customerId);
      const { preview, done } = await deleteForGood(a, inA);
      expect(preview.square).toEqual({ deletes: 0, stays: 0, shared: 1, notReached: 0 });
      expect(preview.squareNames.shared, "the box names her").toEqual(["Dana Cole"]);
      expect(done.squareDeleting).toBe(0);
      await minutes(2);
      expect(asked(a)).toEqual([]);
      expect(held(a, customerId), "Branch B's Dana still has her customer").not.toBeNull();
    });

    it("the other gym links it after the press and before the worker: it is not deleted, and the owed deletion is let go", async () => {
      const a = await makeGym("Late Branch A");
      const b = await makeGym("Late Branch B", a.acct);
      const email = `eli.${uniq()}@gmail.com`;
      const inA = await person(a, "Eli Park", { email, phone: "+13125550121" });
      expect((await addMembers(a)).state).toBe("added");
      const customerId = await customerIdOf(a, inA);
      const { done } = await deleteForGood(a, inA);
      expect(done.squareDeleting).toBe(1);
      const inB = await person(b, "Eli Park", { email, phone: "+13125550121" });
      expect((await addMembers(b)).state).toBe("added");
      expect(await customerIdOf(b, inB)).toBe(customerId);
      await minutes(2);
      expect(asked(a)).toEqual([]);
      expect(held(a, customerId)).not.toBeNull();
      expect(await owedRows(a)).toEqual([]);
      expect(logged.some((l) => l.event === "square.customer_delete_kept" && l.why === "used_by_another")).toBe(true);
    });

    // Round one, tests: the other ways another record can use a customer, decided at the box and at the worker's send.
    /** Another record's card saved on this customer. */
    const cardOn = async (gym: Gym, entryId: string, customerId: string): Promise<void> => {
      const [agreement] = await sql<{ id: string }[]>`
        INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, brand, last4, agreed_at)
        VALUES (${gym.id}, ${entryId}, ${"I agree to this card being kept for my membership."}, 'desk', 'VISA', '4242', now()) RETURNING id`;
      await sql`
        INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, agreement_id, saved_at, updated_at)
        VALUES (${gym.id}, ${entryId}, 'production', ${gym.acct.merchantId}, ${customerId}, ${`ccof:test${uniq()}`}, 'VISA', '4242', 12, 2031, 'desk', ${agreement?.id ?? ""}, now(), now())`;
    };
    /** A check about to link another record to this customer. */
    const planOn = async (gym: Gym, entryId: string, customerId: string): Promise<void> => {
      const [run] = await sql<{ run_id: string }[]>`SELECT run_id FROM gym_square_member_runs WHERE gym_id = ${gym.id} AND environment = 'production'`;
      await sql`
        INSERT INTO gym_square_member_plan (gym_id, environment, entry_id, run_id, decision, customer_id, digest, looked_at)
        VALUES (${gym.id}, 'production', ${entryId}, ${run?.run_id ?? ""}, 'link', ${customerId}, md5('x'), now())`;
    };
    for (const [how, claim] of [
      ["a card of another record saved on it", cardOn],
      ["a check about to link another record to it", planOn],
    ] as const) {
      it(`${how}: the box says somebody else uses it, and nothing is owed`, async () => {
        const gym = await makeGym(`Used Box Gym ${String(how.length)}`);
        const mine = await person(gym, "Hal Moss", { email: `hal.${uniq()}@gmail.com` });
        expect((await addMembers(gym)).state).toBe("added");
        const other = await person(gym, "Ira Moss", { email: `ira.${uniq()}@gmail.com` });
        const customerId = await customerIdOf(gym, mine);
        await claim(gym, other, customerId);
        const { preview, done } = await deleteForGood(gym, mine);
        expect(preview.square).toEqual({ deletes: 0, stays: 0, shared: 1, notReached: 0 });
        expect(done.squareDeleting).toBe(0);
        await minutes(1);
        expect(asked(gym)).toEqual([]);
        expect(held(gym, customerId)).not.toBeNull();
      });

      it(`${how}, after the press and before the worker: it is not deleted`, async () => {
        const gym = await makeGym(`Used Send Gym ${String(how.length)}`);
        const mine = await person(gym, "Jo Penn", { email: `jo.${uniq()}@gmail.com` });
        expect((await addMembers(gym)).state).toBe("added");
        const other = await person(gym, "Kai Penn", { email: `kai.${uniq()}@gmail.com` });
        const customerId = await customerIdOf(gym, mine);
        const { done } = await deleteForGood(gym, mine);
        expect(done.squareDeleting).toBe(1);
        await claim(gym, other, customerId);
        await minutes(2);
        expect(asked(gym)).toEqual([]);
        expect(held(gym, customerId)).not.toBeNull();
        expect(await owedRows(gym)).toEqual([]);
        expect(logged.some((l) => l.event === "square.customer_delete_kept" && l.why === "used_by_another")).toBe(true);
      });
    }

    it("another gym with its own Square account never has anything asked of it", async () => {
      const a = await makeGym("Own Account A");
      const b = await makeGym("Own Account B");
      const email = `fay.${uniq()}@gmail.com`;
      const inA = await person(a, "Fay Moss", { email, phone: "+13125550122" });
      const inB = await person(b, "Fay Moss", { email, phone: "+13125550122" });
      expect((await addMembers(a)).state).toBe("added");
      expect((await addMembers(b)).state).toBe("added");
      const aId = await customerIdOf(a, inA);
      const bId = await customerIdOf(b, inB);
      await deleteForGood(a, inA);
      await minutes(2);
      expect(held(a, aId)).toBeNull();
      expect(held(b, bId)).not.toBeNull();
      expect(asked(b)).toEqual([]);
    });
  });

  describe("a customer the app was still making", () => {
    /** A past member whose customer Square made while the answer was lost: the app holds the key, not the id. */
    const makingFor = async (name: string) => {
      const gym = await makeGym(name);
      const id = await person(gym, "Gus Ward", { email: `gus.${uniq()}@gmail.com` });
      const key = randomUUID();
      await sql`
        INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, making_key, made_as)
        VALUES (${gym.id}, ${id}, 'production', ${gym.acct.merchantId}, ${key}, ${id})`;
      return { gym, id, key };
    };

    it("found by the record's reference id and deleted", async () => {
      const { gym, id, key } = await makingFor("Making Gym");
      const customerId = square.madeWithKey(gym.acct, key, { idempotencyKey: key, givenName: "Gus", familyName: "Ward", email: "gus@gmail.com", phone: null, referenceId: id });
      const { preview, done } = await deleteForGood(gym, id);
      expect(preview.square.deletes).toBe(1);
      expect(done.squareDeleting).toBe(1);
      expect(await owedRows(gym)).toEqual([{ customer_id: null, reference_id: id, tries: 0 }]);
      await minutes(1);
      expect(held(gym, customerId)).toBeNull();
      expect(await owedRows(gym)).toEqual([]);
    });

    it("never made at all: looked for a few times, then let go", async () => {
      const { gym, id } = await makingFor("Never Made Gym");
      await deleteForGood(gym, id);
      await minutes(1);
      expect((await owedRows(gym))[0]?.tries).toBe(1);
      await minutes(4);
      expect(await owedRows(gym)).toEqual([]);
      expect(asked(gym)).toEqual([]);
    });

    it("only a customer made with the record's own reference id, and not by a merge, is taken", async () => {
      const { gym, id, key } = await makingFor("Lookalike Gym");
      const other = square.madeWithKey(gym.acct, randomUUID(), { idempotencyKey: "x", givenName: "Gus", familyName: "Ward", email: "g@gmail.com", phone: null, referenceId: randomUUID() });
      const mine = square.madeWithKey(gym.acct, key, { idempotencyKey: key, givenName: "Gus", familyName: "Ward", email: "gus@gmail.com", phone: null, referenceId: id });
      changeInSquare(gym, mine, { creation_source: "MERGE" });
      await deleteForGood(gym, id);
      await minutes(5);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, other)).not.toBeNull();
      expect(held(gym, mine)).not.toBeNull();
    });
  });

  describe("the box and the press", () => {
    it("the press deletes exactly what the box showed: if the customers changed since, nobody is deleted and the box is shown again", async () => {
      const gym = await makeGym("Digest Gym");
      const id = await person(gym, "Hana Oda", { email: `hana.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      await takeOff(gym, id);
      const shown = await boxFor(gym, id);
      expect(shown.square.deletes).toBe(1);
      // Before the owner presses, the customer turns out to be one Square had before (linked), so deleting it would not be what the box said.
      await sql`UPDATE gym_square_customers SET joined_at = now() WHERE gym_id = ${gym.id} AND entry_id = ${id}`;
      const res = await send("POST", `/v1/orgs/${gym.id}/member-list/selected/delete`, gym.owner.cookies, { selection: tick(id), digest: shown.digest });
      expect(res.statusCode, res.body).toBe(409);
      const body = JSON.parse(res.body) as { error: string; preview: MemberListDeletePreview };
      expect(body.error).toBe("delete_changed");
      expect(body.preview.square).toEqual({ deletes: 0, stays: 1, shared: 0, notReached: 0 });
      expect(await stillThere(gym, id), "nobody was deleted").toBe(true);
      expect(await owedRows(gym)).toEqual([]);
    });

    it("the same press sent twice writes one deletion and the second says nothing was left to delete", async () => {
      const gym = await makeGym("Twice Gym");
      const id = await person(gym, "Ivo Reed", { email: `ivo.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      const { preview, done } = await deleteForGood(gym, id);
      expect(done.squareDeleting).toBe(1);
      const again = await send("POST", `/v1/orgs/${gym.id}/member-list/selected/delete`, gym.owner.cookies, { selection: tick(id), digest: preview.digest });
      expect(again.statusCode, again.body).toBe(200);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(again.body)).done).toMatchObject({ deleted: 0, nothingLeft: true, squareDeleting: 0 });
      expect(await owedRows(gym)).toHaveLength(1);
    });

    it("a gym with nobody in Square sees nothing about Square and keeps the digest of the people alone", async () => {
      const gym = await makeGym("Plain Gym");
      const id = await person(gym, "Jan Fox", { email: `jan.${uniq()}@gmail.com` });
      await takeOff(gym, id);
      const shown = await boxFor(gym, id);
      expect(shown.square).toEqual({ deletes: 0, stays: 0, shared: 0, notReached: 0 });
      const res = await send("POST", `/v1/orgs/${gym.id}/member-list/selected/delete`, gym.owner.cookies, { selection: tick(id), digest: shown.digest });
      expect(res.statusCode, res.body).toBe(200);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(res.body)).done).toMatchObject({ deleted: 1, squareDeleting: 0 });
    });

    it("someone from another gym learns nothing from the box", async () => {
      const gym = await makeGym("Private Gym");
      const id = await person(gym, "Kit Lane", { email: `kit.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      await takeOff(gym, id);
      const stranger = await signedIn("Somebody Else");
      const res = await send("POST", `/v1/orgs/${gym.id}/member-list/selected/delete-preview`, stranger.cookies, { selection: tick(id) });
      expect([403, 404]).toContain(res.statusCode);
      expect(res.body).not.toContain("\"deletes\"");
      const press = await send("POST", `/v1/orgs/${gym.id}/member-list/selected/delete`, stranger.cookies, { selection: tick(id), digest: "a".repeat(64) });
      expect([403, 404]).toContain(press.statusCode);
      expect(await stillThere(gym, id)).toBe(true);
      expect(await owedRows(gym)).toEqual([]);
    });
  });

  describe("one person's page", () => {
    it("a past member's page says what Delete permanently does about their customer in Square, and deleting them from it owes the customer", async () => {
      const gym = await makeGym("Page Gym");
      const id = await person(gym, "Lou Pace", { email: `lou.${uniq()}@gmail.com` });
      expect((await addMembers(gym)).state).toBe("added");
      const customerId = await customerIdOf(gym, id);
      const page = async () => (JSON.parse((await send("GET", entryUrl(gym, id), gym.owner.cookies)).body) as { entry: { squareOnDelete: string } }).entry.squareOnDelete;
      expect(await page(), "a member on the list is not offered Delete permanently").toBe("none");
      await takeOff(gym, id);
      expect(await page()).toBe("deletes");
      const res = await send("DELETE", `/v1/orgs/${gym.id}/member-list/former/${id}`, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ deleted: true, squareDeleting: 1 });
      await minutes(1);
      expect(held(gym, customerId)).toBeNull();
    });

    it("a past member linked to a customer Square had says it stays", async () => {
      const gym = await makeGym("Page Linked Gym");
      const email = `mo.${uniq()}@gmail.com`;
      square.customer(gym.acct, { id: "CMOTILL", given_name: "Mo", family_name: "Ray", email_address: email });
      const id = await person(gym, "Mo Ray", { email });
      expect((await addMembers(gym)).state).toBe("added");
      await takeOff(gym, id);
      const page = JSON.parse((await send("GET", entryUrl(gym, id), gym.owner.cookies)).body) as { entry: { squareOnDelete: string } };
      expect(page.entry.squareOnDelete).toBe("stays");
      const res = await send("DELETE", `/v1/orgs/${gym.id}/member-list/former/${id}`, gym.owner.cookies);
      expect(JSON.parse(res.body)).toMatchObject({ deleted: true, squareDeleting: 0 });
      await minutes(1);
      expect(held(gym, "CMOTILL")).not.toBeNull();
    });
  });

  describe("one person's page, a customer another gym uses", () => {
    it("says it is shared, so they stay", async () => {
      const a = await makeGym("Page Branch A");
      const b = await makeGym("Page Branch B", a.acct);
      const email = `gil.${uniq()}@gmail.com`;
      const inA = await person(a, "Gil Roe", { email, phone: "+13125550170" });
      expect((await addMembers(a)).state).toBe("added");
      const inB = await person(b, "Gil Roe", { email, phone: "+13125550170" });
      expect((await addMembers(b)).state).toBe("added");
      expect(await customerIdOf(b, inB)).toBe(await customerIdOf(a, inA));
      await takeOff(a, inA);
      const page = JSON.parse((await send("GET", entryUrl(a, inA), a.owner.cookies)).body) as { entry: { squareOnDelete: string } };
      expect(page.entry.squareOnDelete).toBe("shared");
    });
  });

  describe("what is not Delete permanently", () => {
    it("joining two records of one person (Merge duplicate) leaves the removed record's customer in Square as before: it is not owed a deletion", async () => {
      const gym = await makeGym("Join Gym");
      const keep = await person(gym, "Nell Shaw", { email: `nell.${uniq()}@gmail.com`, phone: "+13125550131" });
      const gone = await person(gym, "Nell P Shaw", { email: `nell.p.${uniq()}@gmail.com`, phone: "+13125550132" });
      expect((await addMembers(gym)).state).toBe("added");
      const goneCustomer = await customerIdOf(gym, gone);
      const res = await send("POST", `${entryUrl(gym, gone)}/merge`, gym.owner.cookies, { keepEntryId: keep, acknowledgeLeavesList: true });
      expect(res.statusCode, res.body).toBe(200);
      expect(await stillThere(gym, gone)).toBe(false);
      expect(await owedRows(gym)).toEqual([]);
      await minutes(2);
      expect(asked(gym)).toEqual([]);
      expect(held(gym, goneCustomer)).not.toBeNull();
    });
  });
});
