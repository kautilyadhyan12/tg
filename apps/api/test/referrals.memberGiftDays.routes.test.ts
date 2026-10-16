// Refer a friend: the member's gift as free days — routes against real Postgres
// (DATABASE_URL-gated). ROADMAP 20e-ii-b-ii-b; spec Part 3 §16.3.
//
// The first block is the worst thing this job could do to a real person: days added to
// somebody else's membership (another member's, or the same member's at another business),
// added twice, or a day already paid for or owed moved. Every claim is checked against the
// database or the page staff read, never against a reply alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { RobotCheck } from "../src/modules/orgs/gymPage/robotCheck.js";
import { createMemoryRedis } from "../src/redis.js";
import {
  addDays,
  heldMembershipsResponseSchema,
  memberGiftLine,
  type HeldMembershipsResponse,
  type Lead,
  type MemberReferralResponse,
  type ReferralSettings,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-gift-days-routes-secret-0123456", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TIMEOUT_MS = 180_000;
const LIVE_PLAN = "zz_member_gift_days_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}
interface Person {
  id: string;
  email: string;
  cookies: Cookies;
}

let ipCounter = 0;
const nextIp = () => `10.113.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;

const robotCheck: RobotCheck = { siteKey: "test-site-key", verify: () => Promise.resolve("passed") };

const gold = {
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 5000,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
};

d("Refer a friend: the member's gift as free days (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  /** A second api on the same database, so two requests can race. */
  let second: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mdays-t-%@example.com')`;
    await sql`DELETE FROM gym_referral_member_gifts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_lead_enquiries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_referral_settings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_referral_links WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_discounts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mdays-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (target: App, method: "GET" | "POST" | "PUT", path: string, payload: unknown, cookies: Cookies) =>
    target.inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send(api(), "GET", path, undefined, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}, target: App = api()) => send(target, "POST", path, payload, cookies);
  /** The offer's version as it stands, for a save that does not name one (item 20's passes, H3). */
  const withVersion = async (path: string, payload: unknown, cookies: Cookies): Promise<unknown> => {
    if (!path.endsWith("/referral-settings") || typeof payload !== "object" || payload === null || "version" in payload) return payload;
    const read = await send(api(), "GET", path, undefined, cookies);
    const version = read.statusCode === 200 ? (JSON.parse(read.body) as { settings: { version: string } }).settings.version : "";
    return { ...payload, version };
  };
  const put = async (path: string, payload: unknown, cookies: Cookies) => send(api(), "PUT", path, await withVersion(path, payload, cookies), cookies);

  const makeUser = async (local: string, displayName: string): Promise<Person> => {
    const email = `mdays-t-${local}@example.com`;
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName })).statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    if (row === undefined) throw new Error("no user row");
    return { id: row.id, email, cookies: cookieMap(login) };
  };

  const makeOrg = async (cookies: Cookies, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };

  const join = async (org: CreatedOrg, owner: Cookies, person: Person) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner)).statusCode).toBe(200);
  };

  const TEN_POUNDS = { kind: "amount" as const, amountMinor: 1000, percentBp: null };

  const linkOf = async (org: CreatedOrg, person: Person): Promise<string> => {
    const res = await get(`/v1/orgs/${org.org.id}/referral`, person.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as MemberReferralResponse;
    if (body.status !== "on") throw new Error("the offer is off");
    return body.path.replace("/invite/", "");
  };
  const invited = async (code: string, fullName: string, email: string): Promise<string> => {
    const res = await post(`/v1/public/invites/${code}/enquiries`, { fullName, email, robotToken: "ok-token" });
    expect(res.statusCode, res.body).toBe(202);
    // This file's businesses' lead alone: another test file may invite the same address at once.
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_leads WHERE gym_id IN (SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mdays-t-%@example.com')) AND email = ${email}::citext AND referred_at IS NOT NULL`;
    if (row === undefined) throw new Error(`no invited lead for ${email}`);
    return row.id;
  };
  const added = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const memberships = async (gymId: string, entryId: string, cookies: Cookies): Promise<HeldMembershipsResponse> => {
    const res = await get(heldUrl(gymId, entryId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, paid: boolean, extra: Record<string, unknown> = {}) =>
    post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn: today, paid, ...(paid ? { method: "cash" } : {}), ...extra }, cookies);
  const leadPage = async (gymId: string, leadId: string, cookies: Cookies): Promise<Lead> => {
    const res = await get(`/v1/orgs/${gymId}/leads/${leadId}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { lead: Lead }).lead;
  };

  /** Every bill of a record, oldest first: what they would be asked to pay. */
  const billsOfEntry = (gymId: string, entryId: string) =>
    sql<{ id: string; period_index: number; amount_minor: number; status: string }[]>`
      SELECT b.id, b.period_index, b.amount_minor, b.status FROM gym_member_bills b
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE b.gym_id = ${gymId} AND h.entry_id = ${entryId}
      ORDER BY h.created_at, b.period_index`;
  const messagesOf = (userId: string) =>
    sql<{ gym_id: string; kind: string; body: string }[]>`SELECT gym_id, kind, body FROM gym_member_messages WHERE user_id = ${userId} AND kind = 'referral_gift' ORDER BY sent_at`;

  let owner: Person;
  let ownerB: Person;
  let gymA: CreatedOrg;
  let gymB: CreatedOrg;
  let goldA: string;
  let goldB: string;
  let packA: string;
  let barA: string;
  let today: string;

  /** A member who holds their own record at gym A, with Gold Monthly: its first bill open
   *  (5000) unless `paid`. Answers them, their record and their invite code. */
  const memberWithBill = async (local: string, name: string, paid: boolean, startsOn: string = today) => {
    const person = await makeUser(local, name);
    await join(gymA, owner.cookies, person);
    const entryId = await added(gymA.org.id, owner.cookies, { fullName: name, email: `${local}-record@example.com` });
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gymA.org.id} AND user_id = ${person.id}`;
    expect((await give(gymA.org.id, entryId, owner.cookies, goldA, paid, { startsOn })).statusCode).toBe(201);
    return { person, entryId, code: await linkOf(gymA, person) };
  };
  /** A friend comes by the link, is added from Leads, and their Gold Monthly is given. */
  const friendJoins = async (code: string, name: string, email: string, paid: boolean) => {
    const leadId = await invited(code, name, email);
    const entryId = await added(gymA.org.id, owner.cookies, { fullName: name, email, leadId });
    const res = await give(gymA.org.id, entryId, owner.cookies, goldA, paid);
    expect(res.statusCode, res.body).toBe(201);
    return { leadId, entryId };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'GBP', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const deps = {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
      robotCheck,
      redis,
    };
    app = await buildApp(loadConfig(baseEnv), deps);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), deps);
    await second.ready();

    owner = await makeUser("owner-a", "Owner A");
    ownerB = await makeUser("owner-b", "Owner B");
    gymA = await makeOrg(owner.cookies, "Northside Free Days A");
    gymB = await makeOrg(ownerB.cookies, "Southside Free Days B");
    // The offer: 14 free days, and £10 off for a member with no membership (`setDays`, below).
    await setDays(gymA, owner.cookies, 14);
    await setDays(gymB, ownerB.cookies, 14);
    const typeOf = async (gym: CreatedOrg, cookies: Cookies, body: Record<string, unknown> & { name?: string }): Promise<string> => {
      const res = await post(`/v1/orgs/${gym.org.id}/membership-types`, { ...gold, ...body }, cookies);
      expect(res.statusCode, res.body).toBe(201);
      const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_membership_types WHERE gym_id = ${gym.org.id} AND name = ${body.name ?? gold.name}`;
      if (row === undefined) throw new Error("no type");
      return row.id;
    };
    goldA = await typeOf(gymA, owner.cookies, {});
    goldB = await typeOf(gymB, ownerB.cookies, {});
    packA = await typeOf(gymA, owner.cookies, { name: "Ten classes", kind: "pack", priceMinor: 9000, termCount: null, termUnit: null, packClasses: 10, packDays: 60 });
    const product = await post(`/v1/orgs/${gymA.org.id}/register/products`, { name: "Protein tub", priceMinor: 2500, taxRateId: null, stock: null }, owner.cookies);
    expect(product.statusCode, product.body).toBe(201);
    const [bar] = await sql<{ id: string }[]>`SELECT id FROM gym_products WHERE gym_id = ${gymA.org.id} AND name = 'Protein tub'`;
    if (bar === undefined) throw new Error("no product");
    barA = bar.id;
    const probe = await added(gymA.org.id, owner.cookies, { fullName: "Day Probe", email: "mdays-probe@example.com" });
    today = (await memberships(gymA.org.id, probe, owner.cookies)).today;
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  /** The offer with free days: `days` on the member's membership, the £10 for one with none. */
  const setDays = async (org: CreatedOrg, cookies: Cookies, days: number) => {
    const friend = { kind: "percent", percentBp: 2000, amountMinor: null, on: "first" };
    const res = await put(`/v1/orgs/${org.org.id}/referral-settings`, { on: true, member: { ...TEN_POUNDS, on: "membership", days }, friend }, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as { settings: ReferralSettings };
  };
  /** Every membership row of a gym with free days on it. */
  const withDays = (gymId: string) =>
    sql<{ id: string; entry_id: string; gift_days: number; gift_from: number }[]>`
      SELECT id, entry_id, gift_days, gift_from FROM gym_held_memberships WHERE gym_id = ${gymId} AND gift_days > 0 ORDER BY created_at`;
  const daysGifts = (gymId: string) =>
    sql<{ friend_entry_id: string | null; days: number | null; days_from: number | null; used_membership_id: string | null; taken_back_why: string | null; used_bill_id: string | null }[]>`
      SELECT friend_entry_id, days, days_from, used_membership_id, taken_back_why, used_bill_id
      FROM gym_referral_member_gifts WHERE gym_id = ${gymId} ORDER BY given_at, id`;
  const firstOf = async (gymId: string, entryId: string) => {
    const m = (await memberships(gymId, entryId, owner.cookies)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    return m;
  };
  const voidFriendPayment = async (entryId: string) => {
    const m = await firstOf(gymA.org.id, entryId);
    const undo = m.billing?.undo;
    if (undo?.kind !== "payment") throw new Error("no payment to void");
    expect((await post(`${heldUrl(gymA.org.id, entryId)}/${m.id}/payments/${undo.paymentId}/undo`, {}, owner.cookies)).statusCode).toBe(200);
  };

  describe("the worst thing: days on somebody else's membership, given twice, or a day already paid for moved", () => {
    it(
      "the days go only on the inviting member's own membership at this business, once: its renewal moves 14 days and nothing paid or owed moves",
      async () => {
        const maya = await memberWithBill("maya", "Maya Patel", true);
        const ben = await memberWithBill("ben", "Ben Okafor", true);
        await join(gymB, ownerB.cookies, maya.person);
        const mayaB = await added(gymB.org.id, ownerB.cookies, { fullName: "Maya Patel", email: "maya-b-record@example.com" });
        await sql`UPDATE gym_members SET entry_id = ${mayaB} WHERE gym_id = ${gymB.org.id} AND user_id = ${maya.person.id}`;
        expect((await give(gymB.org.id, mayaB, ownerB.cookies, goldB, true)).statusCode).toBe(201);
        const before = await firstOf(gymA.org.id, maya.entryId);
        const benBefore = await firstOf(gymA.org.id, ben.entryId);
        const mayaBBefore = (await memberships(gymB.org.id, mayaB, ownerB.cookies)).memberships[0];
        if (before.view.renewsOn === null || mayaBBefore === undefined) throw new Error("no renewal");

        const tara = await friendJoins(maya.code, "Tara Shah", "tara.shah@example.com", true);

        const after = await firstOf(gymA.org.id, maya.entryId);
        expect(after.view.renewsOn).toBe(addDays(before.view.renewsOn, 14));
        expect(after.view.payment).toEqual({ state: "paid", until: addDays(before.view.renewsOn, 14) });
        expect(after.startsOn).toBe(before.startsOn);
        expect(after.freeDays).toEqual([{ days: 14, friendName: "Tara Shah" }]);
        // Maya's one row, and nobody else's: not Ben's, not hers at the other business.
        expect(await withDays(gymA.org.id)).toEqual([{ id: after.id, entry_id: maya.entryId, gift_days: 14, gift_from: 1 }]);
        expect(await withDays(gymB.org.id)).toEqual([]);
        expect(await firstOf(gymA.org.id, ben.entryId)).toEqual(benBefore);
        expect((await memberships(gymB.org.id, mayaB, ownerB.cookies)).memberships[0]).toEqual(mayaBBefore);
        // No money came off anything, and no money waits.
        expect(await billsOfEntry(gymA.org.id, maya.entryId)).toMatchObject([{ period_index: 0, amount_minor: 5000, status: "paid" }]);
        expect((await memberships(gymA.org.id, maya.entryId, owner.cookies)).memberGift).toBeNull();
        expect(await daysGifts(gymA.org.id)).toEqual([
          { friend_entry_id: tara.entryId, days: 14, days_from: 1, used_membership_id: after.id, taken_back_why: null, used_bill_id: null },
        ]);
        const told = await messagesOf(maya.person.id);
        expect(told).toHaveLength(1);
        expect(told[0]?.body).toMatch(
          /^A friend you invited has joined Northside Free Days A and made their first payment\. You get 14 free days, added to your Gold Monthly: it now renews on \d{1,2} [A-Z][a-z]+ \d{4}\.$/,
        );
        expect(await messagesOf(ben.person.id)).toEqual([]);

        // The friend pays again, and buys at the desk: no second gift, the days added once.
        const tub = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: tara.entryId, method: "cash", totalMinor: 2500 }, owner.cookies);
        expect(tub.statusCode, tub.body).toBe(201);
        expect(await withDays(gymA.org.id)).toMatchObject([{ gift_days: 14 }]);
        expect(await messagesOf(maya.person.id)).toHaveLength(1);

        // The lead says where they went.
        const lead = await leadPage(gymA.org.id, tara.leadId, owner.cookies);
        expect(lead.memberGift).toEqual({ gift: { state: "days_added", words: "14 free days", what: "Gold Monthly", day: today }, memberName: "Maya Patel", on: "membership" });
        if (lead.memberGift === null) throw new Error("no line");
        expect(memberGiftLine(lead.memberGift.gift, "Maya Patel", "Tara")).toMatch(/^Maya Patel's gift for inviting Tara \(14 free days\) was added to their Gold Monthly on /);
        // A stranger to the business reads none of it.
        const stranger = await makeUser("stranger", "Stranger");
        expect([403, 404]).toContain((await get(heldUrl(gymA.org.id, maya.entryId), stranger.cookies)).statusCode);
        expect([403, 404]).toContain((await get(`/v1/orgs/${gymA.org.id}/leads/${tara.leadId}`, ownerB.cookies)).statusCode);
      },
      TIMEOUT_MS,
    );

    it(
      "a member who owes for the month they are in still owes it, the same amount from the same day",
      async () => {
        const una = await memberWithBill("una", "Una Price", false);
        const before = await firstOf(gymA.org.id, una.entryId);
        expect(before.view.payment).toEqual({ state: "due", since: today });
        if (before.view.renewsOn === null) throw new Error("no renewal");
        const coversTo = async () => (await firstOf(gymA.org.id, una.entryId)).billing?.bills[0]?.covers?.to ?? null;
        expect(await coversTo()).toBe(addDays(before.view.renewsOn, -1));
        const vik = await friendJoins(una.code, "Vik Rao", "vik.rao@example.com", true);
        const after = await firstOf(gymA.org.id, una.entryId);
        expect(after.view.payment).toEqual({ state: "due", since: today });
        expect(after.view.renewsOn).toBe(addDays(before.view.renewsOn, 14));
        expect(await billsOfEntry(gymA.org.id, una.entryId)).toMatchObject([{ period_index: 0, amount_minor: 5000, status: "open" }]);
        // The bill she owes is for the days the month now runs to, as its renewal says (round one, L2).
        expect(await coversTo()).toBe(addDays(before.view.renewsOn, 13));
        // Vik's payment voided: the days go, and the bill's days with them.
        await voidFriendPayment(vik.entryId);
        expect(await coversTo()).toBe(addDays(before.view.renewsOn, -1));
      },
      TIMEOUT_MS,
    );

    it(
      "a member in their second month who owes for it is still shown owing it, from the day it began, never paid",
      async () => {
        // Started about forty days ago and given unpaid: the month they are in now is owed.
        const vera = await memberWithBill("vera", "Vera Lund", false, addDays(today, -40));
        const before = await firstOf(gymA.org.id, vera.entryId);
        expect(before.view.payment?.state).toBe("due");
        const bills = await billsOfEntry(gymA.org.id, vera.entryId);
        await friendJoins(vera.code, "Wyn Cole", "wyn.cole@example.com", true);
        const after = await firstOf(gymA.org.id, vera.entryId);
        expect(after.view.payment).toEqual(before.view.payment);
        expect(after.view.status).toBe(before.view.status);
        if (before.view.renewsOn === null) throw new Error("no renewal");
        expect(after.view.renewsOn).toBe(addDays(before.view.renewsOn, 14));
        expect(await billsOfEntry(gymA.org.id, vera.entryId)).toEqual(bills);
      },
      TIMEOUT_MS,
    );

    it(
      "two servers record two of the friend's payments at one instant: one gift, the days added once, one message",
      async () => {
        const nia = await memberWithBill("nia", "Nia Clarke", true);
        const leadId = await invited(nia.code, "Omar Farooq", "omar.farooq@example.com");
        const omar = await added(gymA.org.id, owner.cookies, { fullName: "Omar Farooq", email: "omar.farooq@example.com", leadId });
        const sale = () => ({ requestKey: nextForm(), productId: barA, quantity: 1, entryId: omar, method: "cash", totalMinor: 2500 });
        const both = await Promise.all([post(`/v1/orgs/${gymA.org.id}/register/sales`, sale(), owner.cookies), post(`/v1/orgs/${gymA.org.id}/register/sales`, sale(), owner.cookies, second)]);
        expect(both.map((r) => r.statusCode)).toEqual([201, 201]);
        expect((await daysGifts(gymA.org.id)).filter((g) => g.friend_entry_id === omar)).toHaveLength(1);
        expect((await withDays(gymA.org.id)).filter((m) => m.entry_id === nia.entryId)).toMatchObject([{ gift_days: 14 }]);
        expect(await messagesOf(nia.person.id)).toHaveLength(1);
      },
      TIMEOUT_MS,
    );
  });

  describe("no membership that can take them: the money instead", () => {
    it(
      "a member with no membership, or only a free one, gets £10.00 off their next membership payment, waiting",
      async () => {
        const free = await post(`/v1/orgs/${gymA.org.id}/membership-types`, { ...gold, name: "Free week", kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day" }, owner.cookies);
        expect(free.statusCode, free.body).toBe(201);
        const [freeType] = await sql<{ id: string }[]>`SELECT id FROM gym_membership_types WHERE gym_id = ${gymA.org.id} AND name = 'Free week'`;
        if (freeType === undefined) throw new Error("no type");
        for (const [local, name, friendName, withFree] of [
          ["ola", "Ola Berg", "Finn Lake", false],
          ["pip", "Pip Moss", "Gus Hale", true],
        ] as const) {
          const person = await makeUser(local, name);
          await join(gymA, owner.cookies, person);
          const entryId = await added(gymA.org.id, owner.cookies, { fullName: name, email: `${local}-record@example.com` });
          await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gymA.org.id} AND user_id = ${person.id}`;
          if (withFree) expect((await give(gymA.org.id, entryId, owner.cookies, freeType.id, false)).statusCode).toBe(201);
          const friend = await friendJoins(await linkOf(gymA, person), friendName, `${local}.friend@example.com`, true);
          expect((await daysGifts(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId)).toMatchObject([{ days: null, used_membership_id: null, taken_back_why: null }]);
          expect((await memberships(gymA.org.id, entryId, owner.cookies)).memberGift).toMatchObject({ words: "£10.00 off", on: "membership", friendName });
          expect((await messagesOf(person.id)).map((m) => m.body)).toEqual([
            "A friend you invited has joined Northside Free Days A and made their first payment. You get £10.00 off your next membership payment: it comes off by itself.",
          ]);
          expect((await withDays(gymA.org.id)).filter((m) => m.entry_id === entryId)).toEqual([]);
        }
      },
      TIMEOUT_MS,
    );
  });

  describe("the friend's payment voided or refunded", () => {
    it(
      "voided before the member reaches the days: taken back, the renewal where it was, the lead says why",
      async () => {
        const kit = await memberWithBill("kit", "Kit Moss", true);
        const before = await firstOf(gymA.org.id, kit.entryId);
        const friend = await friendJoins(kit.code, "Ana Lopez", "ana.lopez@example.com", true);
        expect((await firstOf(gymA.org.id, kit.entryId)).view.renewsOn).not.toBe(before.view.renewsOn);
        await voidFriendPayment(friend.entryId);
        const after = await firstOf(gymA.org.id, kit.entryId);
        expect(after.view).toEqual(before.view);
        expect(after.freeDays).toEqual([]);
        expect((await withDays(gymA.org.id)).filter((m) => m.entry_id === kit.entryId)).toEqual([]);
        expect((await daysGifts(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId)).toMatchObject([{ days: 14, used_membership_id: null, taken_back_why: "voided" }]);
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift?.gift).toEqual({ state: "taken_back", words: "14 free days", why: "voided", day: today });
        // Nothing waits as money either, and the member was told once, when it was given.
        expect((await memberships(gymA.org.id, kit.entryId, owner.cookies)).memberGift).toBeNull();
        expect(await messagesOf(kit.person.id)).toHaveLength(1);
      },
      TIMEOUT_MS,
    );

    it(
      "voided after the member's membership was cancelled before the days: the gift is taken back, and the friend's next payment gives one again (the data-integrity pass over item 20, L3)",
      async () => {
        const ivy = await memberWithBill("ivy", "Ivy Cole", true);
        const friend = await friendJoins(ivy.code, "Max Hale", "max.hale@example.com", true);
        const m = await firstOf(gymA.org.id, ivy.entryId);
        expect((await post(`${heldUrl(gymA.org.id, ivy.entryId)}/${m.id}/cancel`, { when: "today" }, owner.cookies)).statusCode).toBe(200);
        await voidFriendPayment(friend.entryId);
        expect((await daysGifts(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId)).toMatchObject([{ days: 14, used_membership_id: null, taken_back_why: "voided" }]);
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift?.gift).toMatchObject({ state: "taken_back", why: "voided" });

        // The friend pays again: that payment stands, so the member is given the gift for it.
        const again = await firstOf(gymA.org.id, friend.entryId);
        const pay = again.billing?.pay;
        if (pay === null || pay === undefined) throw new Error("nothing to pay");
        const paid = await post(`${heldUrl(gymA.org.id, friend.entryId)}/${again.id}/payments`, { requestKey: nextForm(), periodIndex: pay.periodIndex, amountMinor: pay.leftMinor, method: "cash" }, owner.cookies);
        expect(paid.statusCode, paid.body).toBe(200);
        expect((await daysGifts(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId)).toMatchObject([{ taken_back_why: "voided" }, { taken_back_why: null }]);
      },
      TIMEOUT_MS,
    );

    it(
      "voided once the member is in the free days: they stay",
      async () => {
        const lia = await memberWithBill("lia", "Lia Ward", true);
        const friend = await friendJoins(lia.code, "Bo Grey", "bo.grey@example.com", true);
        // Two months on: the membership started two months earlier, so its first free day has passed.
        const m = await firstOf(gymA.org.id, lia.entryId);
        await sql`UPDATE gym_held_memberships SET starts_on = starts_on - interval '2 months', paid_periods = 3 WHERE id = ${m.id}`;
        const moved = await firstOf(gymA.org.id, lia.entryId);
        await voidFriendPayment(friend.entryId);
        expect((await firstOf(gymA.org.id, lia.entryId)).view).toEqual(moved.view);
        expect((await withDays(gymA.org.id)).filter((r) => r.entry_id === lia.entryId)).toMatchObject([{ gift_days: 14 }]);
        expect((await daysGifts(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId)).toMatchObject([{ days: 14, taken_back_why: null }]);
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift?.gift).toMatchObject({ state: "days_added" });

        // The friend pays again: the payment is taken like any other, and nothing more is given.
        const again = await firstOf(gymA.org.id, friend.entryId);
        const pay = again.billing?.pay;
        if (pay === null || pay === undefined) throw new Error("nothing to pay");
        const paid = await post(`${heldUrl(gymA.org.id, friend.entryId)}/${again.id}/payments`, { requestKey: nextForm(), periodIndex: pay.periodIndex, amountMinor: pay.leftMinor, method: "cash" }, owner.cookies);
        expect(paid.statusCode, paid.body).toBe(200);
        expect((await daysGifts(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId)).toHaveLength(1);
        expect((await withDays(gymA.org.id)).filter((r) => r.entry_id === lia.entryId)).toMatchObject([{ gift_days: 14 }]);
        expect(await messagesOf(lia.person.id)).toHaveLength(1);
      },
      TIMEOUT_MS,
    );

    it(
      "voided after the member left the list: their record is not touched beyond the days (round one, L1)",
      async () => {
        const pam = await memberWithBill("pam", "Pam Ross", true);
        const friend = await friendJoins(pam.code, "Cy Moore", "cy.moore@example.com", true);
        const m = await firstOf(gymA.org.id, pam.entryId);
        // Pam left the list; her membership's clock has since run on past what anybody was asked for.
        await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${pam.entryId}`;
        await sql`UPDATE gym_held_memberships SET starts_on = starts_on - interval '3 months' WHERE id = ${m.id}`;
        const [before] = await sql<{ paid_periods: number; status: string }[]>`SELECT paid_periods, status FROM gym_held_memberships WHERE id = ${m.id}`;
        await voidFriendPayment(friend.entryId);
        const [after] = await sql<{ paid_periods: number; status: string }[]>`SELECT paid_periods, status FROM gym_held_memberships WHERE id = ${m.id}`;
        expect(after).toEqual(before);
      },
      TIMEOUT_MS,
    );

    it(
      "refunded in full: taken back; refunded in part: they stay",
      async () => {
        const rae = await memberWithBill("rae", "Rae Quinn", true);
        const before = await firstOf(gymA.org.id, rae.entryId);
        const friend = await friendJoins(rae.code, "Gil Ford", "gil.ford@example.com", true);
        const fm = await firstOf(gymA.org.id, friend.entryId);
        const payment = fm.billing?.bills[0]?.payments[0];
        if (payment === undefined) throw new Error("no payment");
        const refundUrl = `${heldUrl(gymA.org.id, friend.entryId)}/${fm.id}/payments/${payment.id}/refunds`;
        expect((await post(refundUrl, { requestKey: nextForm(), amountMinor: 1000, method: "cash", reason: "charged_too_much" }, owner.cookies)).statusCode).toBe(200);
        expect((await withDays(gymA.org.id)).filter((r) => r.entry_id === rae.entryId)).toMatchObject([{ gift_days: 14 }]);
        expect((await post(refundUrl, { requestKey: nextForm(), amountMinor: 4000, method: "cash", reason: "leaving" }, owner.cookies)).statusCode).toBe(200);
        expect((await firstOf(gymA.org.id, rae.entryId)).view).toEqual(before.view);
        expect((await daysGifts(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId)).toMatchObject([{ days: 14, taken_back_why: "refunded" }]);
      },
      TIMEOUT_MS,
    );
  });

  describe("the offer, and a class pack", () => {
    it(
      "Settings keeps the days and what the money comes off; the member reads both; out of range is refused, and a stranger changes nothing",
      async () => {
        const saved = (await setDays(gymA, owner.cookies, 14)).settings;
        expect(saved.member).toMatchObject({ kind: "amount", amountMinor: 1000, on: "membership", days: 14, words: "14 free days on your membership" });
        expect(saved.memberLines.slice(0, 2)).toEqual([
          "When a friend you invite joins Northside Free Days A and makes their first payment, you get 14 free days on your membership. They are added by themselves, and we'll tell you in your inbox.",
          "If you have no membership then, you get £10.00 off your next membership payment instead.",
        ]);
        const zed = await memberWithBill("zed", "Zed Park", true);
        const own = JSON.parse((await get(`/v1/orgs/${gymA.org.id}/referral`, zed.person.cookies)).body) as MemberReferralResponse;
        expect(own.status === "on" ? own.memberGift : null).toBe("14 free days on your membership");
        const friend = { kind: "percent", percentBp: 2000, amountMinor: null, on: "first" };
        for (const days of [0, 91, 1.5]) {
          const res = await put(`/v1/orgs/${gymA.org.id}/referral-settings`, { on: true, member: { ...TEN_POUNDS, on: "membership", days }, friend }, owner.cookies);
          expect(res.statusCode).toBe(400);
        }
        const stranger = await put(`/v1/orgs/${gymA.org.id}/referral-settings`, { on: true, member: { ...TEN_POUNDS, on: "membership", days: 90 }, friend }, ownerB.cookies);
        expect([403, 404]).toContain(stranger.statusCode);
        const [row] = await sql<{ member_days: number | null; member_gift_on: string }[]>`SELECT member_days, member_gift_on FROM gym_referral_settings WHERE gym_id = ${gymA.org.id}`;
        expect(row).toEqual({ member_days: 14, member_gift_on: "membership" });
      },
      TIMEOUT_MS,
    );

    it(
      "a class pack's last day moves, its classes do not",
      async () => {
        const person = await makeUser("quin", "Quin Day");
        await join(gymA, owner.cookies, person);
        const entryId = await added(gymA.org.id, owner.cookies, { fullName: "Quin Day", email: "quin-record@example.com" });
        await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gymA.org.id} AND user_id = ${person.id}`;
        expect((await give(gymA.org.id, entryId, owner.cookies, packA, true, { priceMinor: 9000, totalMinor: 9000 })).statusCode).toBe(201);
        const before = await firstOf(gymA.org.id, entryId);
        if (before.view.endsOn === null) throw new Error("no last day");
        await friendJoins(await linkOf(gymA, person), "Hal Fry", "hal.fry@example.com", true);
        const after = await firstOf(gymA.org.id, entryId);
        expect(after.view.endsOn).toBe(addDays(before.view.endsOn, 14));
        expect(after.classesLeft).toBe(before.classesLeft);
        expect((await messagesOf(person.id))[0]?.body).toMatch(/You get 14 free days, added to your Ten classes: it now ends on /);
      },
      TIMEOUT_MS,
    );
  });
});
