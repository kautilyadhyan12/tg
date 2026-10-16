// Refer a friend: the member's gift — routes against real Postgres (DATABASE_URL-gated).
// ROADMAP 20e-ii-b-ii-a; spec Part 3 §16.3.
//
// The first block is the worst thing this job could do to a real person: money taken off
// somebody else's bill (another member's, or the same member's at another business), or the
// gift given twice. Every claim is checked against the database, never against a reply alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { RobotCheck } from "../src/modules/orgs/gymPage/robotCheck.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { createMemoryRedis } from "../src/redis.js";
import {
  MEMBER_GIFT_WORDS,
  friendGiftResponseSchema,
  heldMembershipsResponseSchema,
  memberGiftLine,
  type HeldMembershipsResponse,
  type Lead,
  type MemberReferralResponse,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-gift-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TIMEOUT_MS = 180_000;
const LIVE_PLAN = "zz_member_gift_routes";

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
const nextIp = () => `10.73.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
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

d("Refer a friend: the member's gift (real Postgres)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mgift-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'mgift-t-%@example.com'`;
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
  const put = (path: string, payload: unknown, cookies: Cookies) => send(api(), "PUT", path, payload, cookies);
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error?: string }).error;

  const makeUser = async (local: string, displayName: string): Promise<Person> => {
    const email = `mgift-t-${local}@example.com`;
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

  /** The offer: the member's gift as given, and the friend's 20% off their first payment. */
  const setOffer = async (
    org: CreatedOrg,
    owner: Cookies,
    member: { kind: "amount" | "percent"; amountMinor: number | null; percentBp: number | null } | null,
    on: "membership" | "products" = "membership",
  ) => {
    const friend = { kind: "percent", percentBp: 2000, amountMinor: null, on: "first" };
    const res = await put(`/v1/orgs/${org.org.id}/referral-settings`, { on: true, member: member === null ? null : { ...member, on, days: null }, friend }, owner);
    expect(res.statusCode, res.body).toBe(200);
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
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_leads WHERE gym_id IN (SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mgift-t-%@example.com')) AND email = ${email}::citext AND referred_at IS NOT NULL`;
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
  const giftsOf = (gymId: string) =>
    sql<{ member_user_id: string | null; friend_entry_id: string | null; used_bill_id: string | null; used_sale_id: string | null; used_off_minor: number | null; taken_back_why: string | null }[]>`
      SELECT member_user_id, friend_entry_id, used_bill_id, used_sale_id, used_off_minor, taken_back_why
      FROM gym_referral_member_gifts WHERE gym_id = ${gymId} ORDER BY given_at, id`;
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
    gymA = await makeOrg(owner.cookies, "Northside Member Gift A");
    gymB = await makeOrg(ownerB.cookies, "Southside Member Gift B");
    await setOffer(gymA, owner.cookies, TEN_POUNDS);
    await setOffer(gymB, ownerB.cookies, TEN_POUNDS);
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
    const probe = await added(gymA.org.id, owner.cookies, { fullName: "Day Probe", email: "mgift-probe@example.com" });
    today = (await memberships(gymA.org.id, probe, owner.cookies)).today;
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  describe("the worst thing: money off somebody else's bill, or the gift given twice", () => {
    it(
      "the gift comes off only the inviting member's own open bill at this business, once, and they are told once",
      async () => {
        const maya = await memberWithBill("maya", "Maya Patel", false);
        // Another member at the same business with an open bill, and Maya's own record at
        // another business with an open bill: neither is touched.
        const ben = await memberWithBill("ben", "Ben Okafor", false);
        await join(gymB, ownerB.cookies, maya.person);
        const mayaB = await added(gymB.org.id, ownerB.cookies, { fullName: "Maya Patel", email: "maya-b-record@example.com" });
        await sql`UPDATE gym_members SET entry_id = ${mayaB} WHERE gym_id = ${gymB.org.id} AND user_id = ${maya.person.id}`;
        expect((await give(gymB.org.id, mayaB, ownerB.cookies, goldB, false)).statusCode).toBe(201);

        const tara = await friendJoins(maya.code, "Tara Shah", "tara.shah@example.com", true);

        expect(await billsOfEntry(gymA.org.id, maya.entryId)).toMatchObject([{ period_index: 0, amount_minor: 4000, status: "open" }]);
        expect(await billsOfEntry(gymA.org.id, ben.entryId)).toMatchObject([{ period_index: 0, amount_minor: 5000, status: "open" }]);
        expect(await billsOfEntry(gymB.org.id, mayaB)).toMatchObject([{ period_index: 0, amount_minor: 5000, status: "open" }]);
        expect(await giftsOf(gymA.org.id)).toMatchObject([{ member_user_id: maya.person.id, friend_entry_id: tara.entryId, used_off_minor: 1000, taken_back_why: null }]);
        expect(await giftsOf(gymB.org.id)).toEqual([]);
        expect(await messagesOf(maya.person.id)).toEqual([
          {
            gym_id: gymA.org.id,
            kind: "referral_gift",
            body: "A friend you invited has joined Northside Member Gift A and made their first payment. You get £10.00 off your next membership payment: it comes off by itself.",
          },
        ]);
        expect(await messagesOf(ben.person.id)).toEqual([]);

        // The friend pays again, and buys at the desk: no second gift, no second message.
        const tub = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: tara.entryId, method: "cash", totalMinor: 2500 }, owner.cookies);
        expect(tub.statusCode, tub.body).toBe(201);
        expect(await giftsOf(gymA.org.id)).toHaveLength(1);
        expect(await messagesOf(maya.person.id)).toHaveLength(1);
        expect(await billsOfEntry(gymA.org.id, maya.entryId)).toMatchObject([{ amount_minor: 4000 }]);

        // What the person's page and the lead's page say.
        const page = await memberships(gymA.org.id, maya.entryId, owner.cookies);
        expect(page.memberships[0]?.billing?.bills[0]).toMatchObject({ amountMinor: 4000, gift: { offMinor: 1000, currency: "GBP", friendName: "Tara Shah" } });
        expect(page.memberGift).toBeNull();
        const lead = await leadPage(gymA.org.id, tara.leadId, owner.cookies);
        expect(lead.memberGift).toEqual({ gift: { state: "used", words: "£10.00 off", on: { kind: "bill", what: "Gold Monthly", dueOn: today } }, memberName: "Maya Patel", on: "membership" });
        if (lead.memberGift === null) throw new Error("no line");
        expect(memberGiftLine(lead.memberGift.gift, "Maya Patel", "Tara")).toMatch(/^Maya Patel's gift for inviting Tara \(£10\.00 off\) came off their Gold Monthly bill due /);
      },
      TIMEOUT_MS,
    );

    it(
      "two servers record two of the friend's payments at one instant: one gift, one message",
      async () => {
        const nia = await memberWithBill("nia", "Nia Clarke", false);
        const leadId = await invited(nia.code, "Omar Farooq", "omar.farooq@example.com");
        const omar = await added(gymA.org.id, owner.cookies, { fullName: "Omar Farooq", email: "omar.farooq@example.com", leadId });
        const sale = () => ({ requestKey: nextForm(), productId: barA, quantity: 1, entryId: omar, method: "cash", totalMinor: 2500 });
        const both = await Promise.all([post(`/v1/orgs/${gymA.org.id}/register/sales`, sale(), owner.cookies), post(`/v1/orgs/${gymA.org.id}/register/sales`, sale(), owner.cookies, second)]);
        expect(both.map((r) => r.statusCode)).toEqual([201, 201]);
        const mine = (await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === omar);
        expect(mine).toHaveLength(1);
        expect(await messagesOf(nia.person.id)).toHaveLength(1);
        expect(await billsOfEntry(gymA.org.id, nia.entryId)).toMatchObject([{ amount_minor: 4000 }]);
      },
      TIMEOUT_MS,
    );

    it(
      "nobody else can use a member's waiting gift: not another member of the business, not another business",
      async () => {
        const ivy = await memberWithBill("ivy", "Ivy Chen", true);
        await friendJoins(ivy.code, "Sam Reed", "sam.reed@example.com", true);
        const waiting = (await memberships(gymA.org.id, ivy.entryId, owner.cookies)).memberGift;
        if (waiting === null) throw new Error("no waiting gift");
        expect(waiting).toMatchObject({ words: "£10.00 off", friendName: "Sam Reed" });

        const someoneElse = await added(gymA.org.id, owner.cookies, { fullName: "Zed Other", email: "zed.other@example.com" });
        const theirs = await give(gymA.org.id, someoneElse, owner.cookies, packA, false, { priceMinor: 9000, memberGiftId: waiting.id, memberGiftMinor: 1000 });
        expect([theirs.statusCode, errorOf(theirs)]).toEqual([409, "member_gift_not_theirs"]);
        expect((JSON.parse(theirs.body) as { message: string }).message).toBe(MEMBER_GIFT_WORDS.not_theirs);
        const sold = await post(
          `/v1/orgs/${gymA.org.id}/register/sales`,
          { requestKey: nextForm(), productId: barA, quantity: 1, entryId: someoneElse, method: "cash", totalMinor: 1500, memberGift: { id: waiting.id, offMinor: 1000 } },
          owner.cookies,
        );
        expect([sold.statusCode, errorOf(sold)]).toEqual([409, "member_gift_not_theirs"]);

        const otherGym = await added(gymB.org.id, ownerB.cookies, { fullName: "Ivy Chen", email: "ivy-b@example.com" });
        const fromB = await give(gymB.org.id, otherGym, ownerB.cookies, goldB, false, { priceMinor: 5000, memberGiftId: waiting.id, memberGiftMinor: 1000 });
        expect([fromB.statusCode, errorOf(fromB)]).toEqual([409, "member_gift_not_theirs"]);
        // Nothing moved: the gift still waits for Ivy, and nobody else's bill is lower.
        expect((await giftsOf(gymA.org.id)).filter((g) => g.member_user_id === ivy.person.id)).toMatchObject([{ used_bill_id: null, used_sale_id: null }]);
        expect(await billsOfEntry(gymA.org.id, someoneElse)).toEqual([]);
        expect(await billsOfEntry(gymB.org.id, otherGym)).toEqual([]);
        // A stranger to the business reads none of it.
        const stranger = await makeUser("stranger", "Stranger");
        expect([403, 404]).toContain((await get(heldUrl(gymA.org.id, ivy.entryId), stranger.cookies)).statusCode);
        const fromOtherGym = await get(`/v1/orgs/${gymA.org.id}/member-list/entries/${ivy.entryId}/friend-gift`, ownerB.cookies);
        expect([403, 404]).toContain(fromOtherGym.statusCode);
        expect(fromOtherGym.body).not.toContain(waiting.id);
      },
      TIMEOUT_MS,
    );

    it(
      "no gift for a payment nobody was invited for, a walk-in, the member's own purchase, or with the member's gift switched off",
      async () => {
        const kit = await memberWithBill("kit", "Kit Moss", false);
        const before = (await giftsOf(gymA.org.id)).length;
        const walkIn = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: null, method: "cash", totalMinor: 2500 }, owner.cookies);
        expect(walkIn.statusCode).toBe(201);
        const nobody = await added(gymA.org.id, owner.cookies, { fullName: "Nobody Invited", email: "nobody.invited@example.com" });
        expect((await give(gymA.org.id, nobody, owner.cookies, goldA, true)).statusCode).toBe(201);
        const own = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: kit.entryId, method: "cash", totalMinor: 2500 }, owner.cookies);
        expect(own.statusCode).toBe(201);
        expect(await giftsOf(gymA.org.id)).toHaveLength(before);

        await setOffer(gymA, owner.cookies, null);
        try {
          await friendJoins(kit.code, "Ana Lopez", "ana.lopez@example.com", true);
          expect(await giftsOf(gymA.org.id)).toHaveLength(before);
          expect(await billsOfEntry(gymA.org.id, kit.entryId)).toMatchObject([{ amount_minor: 5000 }]);
          expect(await messagesOf(kit.person.id)).toEqual([]);
        } finally {
          await setOffer(gymA, owner.cookies, TEN_POUNDS);
        }
      },
      TIMEOUT_MS,
    );
  });

  describe("round one: the first payment only, a used gift whose source is gone, a member not on the list", () => {
    it(
      "H1: a later payment of the friend gives nothing, whatever changed since their first",
      async () => {
        // The offer has no member's gift when the friend first pays.
        await setOffer(gymA, owner.cookies, null);
        const pia = await memberWithBill("pia", "Pia Holt", false);
        const friend = await friendJoins(pia.code, "Ray Cole", "ray.cole@example.com", true);
        await setOffer(gymA, owner.cookies, TEN_POUNDS);
        // The owner then gives a member's gift; the friend buys at the desk.
        const tub = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: friend.entryId, method: "cash", totalMinor: 2500 }, owner.cookies);
        expect(tub.statusCode, tub.body).toBe(201);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId)).toEqual([]);
        expect(await billsOfEntry(gymA.org.id, pia.entryId)).toMatchObject([{ amount_minor: 5000 }]);
        expect(await messagesOf(pia.person.id)).toEqual([]);
      },
      TIMEOUT_MS,
    );

    it(
      "H2: a used gift whose friend's payment no longer stands is taken back when its bill is cancelled, its membership cancelled, or its sale voided",
      async () => {
        const voidFriendPayment = async (entryId: string) => {
          const m = (await memberships(gymA.org.id, entryId, owner.cookies)).memberships[0];
          const undo = m?.billing?.undo;
          if (m === undefined || undo?.kind !== "payment") throw new Error("no payment to void");
          expect((await post(`${heldUrl(gymA.org.id, entryId)}/${m.id}/payments/${undo.paymentId}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
        };
        // Void the bill.
        const pat = await memberWithBill("pat", "Pat Lowe", false);
        const f1 = await friendJoins(pat.code, "Sol Reid", "sol.reid@example.com", true);
        await voidFriendPayment(f1.entryId);
        const page = await memberships(gymA.org.id, pat.entryId, owner.cookies);
        const m = page.memberships[0];
        const billId = m?.billing?.cancel?.billId;
        if (m === undefined || billId === undefined) throw new Error("no bill to cancel");
        expect((await post(`${heldUrl(gymA.org.id, pat.entryId)}/${m.id}/bills/${billId}/cancel`, { reason: "not_charging" }, owner.cookies)).statusCode).toBe(200);
        expect((await memberships(gymA.org.id, pat.entryId, owner.cookies)).memberGift).toBeNull();
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === f1.entryId)).toMatchObject([{ taken_back_why: "voided", used_bill_id: null }]);
        const theirs = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: pat.entryId, method: "cash", totalMinor: 1500, memberGift: { id: "00000000-0000-4000-8000-000000000999", offMinor: 1000 } }, owner.cookies);
        expect([theirs.statusCode, errorOf(theirs)]).toEqual([409, "member_gift_not_theirs"]);

        // Cancel membership: the same. It starts in ten days, so its first bill is due after
        // the day it is cancelled on and goes with it.
        const inTen = new Date(Date.parse(`${today}T12:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);
        const vic = await memberWithBill("vic", "Vic Shaw", false, inTen);
        expect(await billsOfEntry(gymA.org.id, vic.entryId)).toMatchObject([{ amount_minor: 5000, status: "open" }]);
        const f2 = await friendJoins(vic.code, "Ada Kerr", "ada.kerr@example.com", true);
        await voidFriendPayment(f2.entryId);
        const vm = (await memberships(gymA.org.id, vic.entryId, owner.cookies)).memberships[0];
        if (vm === undefined) throw new Error("no membership");
        const cancelled = await post(`${heldUrl(gymA.org.id, vic.entryId)}/${vm.id}/cancel`, { when: "today" }, owner.cookies);
        expect(cancelled.statusCode, cancelled.body).toBe(200);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === f2.entryId)).toMatchObject([{ taken_back_why: "voided", used_bill_id: null }]);

        // A cancelled membership whose friend's payment still stands: the gift waits again.
        const wes = await memberWithBill("wes", "Wes Pryor", false, inTen);
        await friendJoins(wes.code, "Ola Hart", "ola.hart@example.com", true);
        const wm = (await memberships(gymA.org.id, wes.entryId, owner.cookies)).memberships[0];
        if (wm === undefined) throw new Error("no membership");
        expect((await post(`${heldUrl(gymA.org.id, wes.entryId)}/${wm.id}/cancel`, { when: "today" }, owner.cookies)).statusCode).toBe(200);
        expect((await memberships(gymA.org.id, wes.entryId, owner.cookies)).memberGift).toMatchObject({ words: "£10.00 off", friendName: "Ola Hart" });

        // A sale the gift came off, voided after the friend's only sale was voided: taken back.
        // The offer's money comes off products here (20e-ii-b-ii-b), so Sell fills it in.
        await setOffer(gymA, owner.cookies, TEN_POUNDS, "products");
        try {
        const kim = await memberWithBill("kim", "Kim Ford", true);
        const leadId = await invited(kim.code, "Ian Webb", "ian.webb@example.com");
        const ian = await added(gymA.org.id, owner.cookies, { fullName: "Ian Webb", email: "ian.webb@example.com", leadId });
        const iansSale = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: ian, method: "cash", totalMinor: 2500 }, owner.cookies);
        expect(iansSale.statusCode).toBe(201);
        const waiting = (await memberships(gymA.org.id, kim.entryId, owner.cookies)).memberGiftAtSell;
        if (waiting === null) throw new Error("no waiting gift");
        const kimsSale = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: kim.entryId, method: "cash", totalMinor: 1500, memberGift: { id: waiting.id, offMinor: 1000 } }, owner.cookies);
        expect(kimsSale.statusCode, kimsSale.body).toBe(201);
        const idOf = (res: { body: string }) => (JSON.parse(res.body) as { saleId: string }).saleId;
        expect((await post(`/v1/orgs/${gymA.org.id}/register/sales/${idOf(iansSale)}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
        expect((await post(`/v1/orgs/${gymA.org.id}/register/sales/${idOf(kimsSale)}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
        expect((await memberships(gymA.org.id, kim.entryId, owner.cookies)).memberGiftAtSell).toBeNull();
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === ian)).toMatchObject([{ taken_back_why: "voided", used_sale_id: null }]);
        } finally {
          await setOffer(gymA, owner.cookies, TEN_POUNDS);
        }
      },
      TIMEOUT_MS,
    );

    it(
      "H3: a member in the app with no record on the list is told it comes off at the gym, and the lead says why it waits",
      async () => {
        const ned = await makeUser("ned", "Ned Fox");
        await join(gymA, owner.cookies, ned);
        const [row] = await sql<{ entry_id: string | null }[]>`SELECT entry_id FROM gym_members WHERE gym_id = ${gymA.org.id} AND user_id = ${ned.id}`;
        expect(row?.entry_id ?? null).toBeNull();
        const friend = await friendJoins(await linkOf(gymA, ned), "Lou Park", "lou.park@example.com", true);
        expect(await messagesOf(ned.id)).toEqual([
          {
            gym_id: gymA.org.id,
            kind: "referral_gift",
            body: "A friend you invited has joined Northside Member Gift A and made their first payment. You get £10.00 off your next membership payment at Northside Member Gift A.",
          },
        ]);
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift).toEqual({ gift: { state: "waiting_no_record", words: "£10.00 off" }, memberName: "Ned Fox", on: "membership" });
      },
      TIMEOUT_MS,
    );

    it(
      "re-check: a member who left the app, or is a past member, is never told to staff as 'in the app but not on your list'",
      async () => {
        const lee = await memberWithBill("lee", "Lee Six", true);
        const friend = await friendJoins(lee.code, "Uma Dale", "uma.dale@example.com", true);
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift?.gift).toEqual({ state: "waiting", words: "£10.00 off" });
        // A past member: their record is still on the list, marked past.
        await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gymA.org.id} AND id = ${lee.entryId}`;
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift?.gift).toEqual({ state: "waiting_past", words: "£10.00 off" });
        // Removed from the app.
        await sql`UPDATE gym_member_list_entries SET former_at = NULL WHERE gym_id = ${gymA.org.id} AND id = ${lee.entryId}`;
        await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gymA.org.id} AND user_id = ${lee.person.id}`;
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift).toEqual({ gift: { state: "waiting_left", words: "£10.00 off" }, memberName: "Lee Six", on: "membership" });
        // Their account deleted: it will not be used, and nothing promises it might.
        await sql`UPDATE users SET status = 'deleted' WHERE id = ${lee.person.id}`;
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift).toEqual({ gift: { state: "account_gone", words: "£10.00 off" }, memberName: null, on: "membership" });
      },
      TIMEOUT_MS,
    );

    it(
      "a member is not their own friend; once a friend holds in the database itself; L1's words",
      async () => {
        // A lead marked as invited by the member and joined to the member's own record.
        const zed = await memberWithBill("zed", "Zed Moon", false);
        await sql`
          INSERT INTO gym_leads (gym_id, full_name, email, source, status, entry_id, referred_by, referred_at)
          VALUES (${gymA.org.id}, 'Zed Moon', 'zed-self@example.com', 'friend', 'joined', ${zed.entryId}, ${zed.person.id}, now() - interval '1 day')`;
        const own = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: zed.entryId, method: "cash", totalMinor: 2500 }, owner.cookies);
        expect(own.statusCode).toBe(201);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.member_user_id === zed.person.id)).toEqual([]);

        // A second gift standing for one friend is refused by the table itself.
        const [one] = await sql<{ friend_entry_id: string; member_user_id: string }[]>`
          SELECT friend_entry_id, member_user_id FROM gym_referral_member_gifts WHERE gym_id = ${gymA.org.id} AND taken_back_at IS NULL AND friend_entry_id IS NOT NULL LIMIT 1`;
        if (one === undefined) throw new Error("no gift");
        await expect(sql`
          INSERT INTO gym_referral_member_gifts (gym_id, friend_entry_id, member_user_id, kind, amount_minor, currency, given_at, given_on)
          VALUES (${gymA.org.id}, ${one.friend_entry_id}, ${one.member_user_id}, 'amount', 1000, 'GBP', now(), current_date)`).rejects.toThrow(/gym_referral_member_gifts_friend_uq/);
      },
      TIMEOUT_MS,
    );

    it(
      "two gifts waiting for one member: the hourly run takes one off the bill it opens, and the other still waits",
      async () => {
        const dee = await memberWithBill("dee", "Dee Grey", true);
        await friendJoins(dee.code, "Max Hill", "max.hill@example.com", true);
        await friendJoins(dee.code, "Joy Lake", "joy.lake@example.com", true);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.member_user_id === dee.person.id)).toHaveLength(2);
        const later = new Date(Date.now() + 40 * 86_400_000);
        const run = await openDueBills({ sql, log: { info: () => undefined, error: () => undefined } }, { now: later, gymIds: [gymA.org.id] });
        expect(run.failed).toBe(0);
        expect((await billsOfEntry(gymA.org.id, dee.entryId))[1]).toMatchObject({ period_index: 1, amount_minor: 4000 });
        const mine = (await giftsOf(gymA.org.id)).filter((g) => g.member_user_id === dee.person.id);
        expect(mine.filter((g) => g.used_bill_id !== null)).toHaveLength(1);
        expect((await memberships(gymA.org.id, dee.entryId, owner.cookies)).memberGift).toMatchObject({ words: "£10.00 off" });
      },
      TIMEOUT_MS,
    );
  });

  describe("two records of one friend joined", () => {
    it(
      "the gift moves to the kept record, so the friend's next payment gives no second one",
      async () => {
        const amy = await memberWithBill("amy", "Amy Ross", true);
        const first = await friendJoins(amy.code, "Noor Ali", "noor.ali@example.com", true);
        // Staff added Noor a second time, and join the first record into it.
        const second = await added(gymA.org.id, owner.cookies, { fullName: "Noor Ali", phone: "+447700900456", acknowledgedDuplicates: [first.entryId] });
        const merged = await post(`/v1/orgs/${gymA.org.id}/member-list/entries/${first.entryId}/merge`, { keepEntryId: second, acknowledgeLeavesList: true }, owner.cookies);
        expect(merged.statusCode, merged.body).toBe(200);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.member_user_id === amy.person.id)).toMatchObject([{ friend_entry_id: second, taken_back_why: null }]);
        const tub = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: second, method: "cash", totalMinor: 2500 }, owner.cookies);
        expect(tub.statusCode, tub.body).toBe(201);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.member_user_id === amy.person.id)).toHaveLength(1);
        expect(await messagesOf(amy.person.id)).toHaveLength(1);
      },
      TIMEOUT_MS,
    );
  });

  describe("where the gift comes off", () => {
    it(
      "with no open bill it waits, then comes off the next bill the hourly run opens",
      async () => {
        const lea = await memberWithBill("lea", "Lea Novak", true);
        const friend = await friendJoins(lea.code, "Raj Mehta", "raj.mehta@example.com", true);
        expect(await billsOfEntry(gymA.org.id, lea.entryId)).toMatchObject([{ period_index: 0, amount_minor: 5000, status: "paid" }]);
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift?.gift).toEqual({ state: "waiting", words: "£10.00 off" });

        // A month and some days on, the run opens the next bill: £10 comes off it.
        const later = new Date(Date.now() + 40 * 86_400_000);
        await openDueBills({ sql, log: { info: () => undefined, error: () => undefined } }, { now: later, gymIds: [gymA.org.id] });
        const bills = await billsOfEntry(gymA.org.id, lea.entryId);
        expect(bills[1]).toMatchObject({ period_index: 1, amount_minor: 4000, status: "open" });
        // Every other new bill of the gym is at its own price, but for another member's own gift.
        const others = await sql<{ amount_minor: number; gift: boolean }[]>`
          SELECT b.amount_minor, EXISTS (SELECT 1 FROM gym_referral_member_gifts g WHERE g.used_bill_id = b.id) AS gift
          FROM gym_member_bills b
          WHERE b.gym_id = ${gymA.org.id} AND b.period_index = 1 AND b.id <> ${bills[1]?.id ?? ""}`;
        expect(others.length).toBeGreaterThan(0);
        expect(others.filter((b) => !b.gift).every((b) => b.amount_minor === 5000)).toBe(true);
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift?.gift).toMatchObject({ state: "used", on: { kind: "bill", what: "Gold Monthly" } });
      },
      TIMEOUT_MS,
    );

    it(
      "a bill with something already paid on it is never lowered: the gift waits for the next one",
      async () => {
        const joe = await memberWithBill("joe", "Joe Park", false);
        const m = (await memberships(gymA.org.id, joe.entryId, owner.cookies)).memberships[0];
        if (m === undefined) throw new Error("no membership");
        const part = await post(`${heldUrl(gymA.org.id, joe.entryId)}/${m.id}/payments`, { requestKey: nextForm(), periodIndex: 0, amountMinor: 4500, method: "cash" }, owner.cookies);
        expect(part.statusCode, part.body).toBe(200);
        await friendJoins(joe.code, "Kai West", "kai.west@example.com", true);
        expect(await billsOfEntry(gymA.org.id, joe.entryId)).toMatchObject([{ period_index: 0, amount_minor: 5000, status: "open" }]);
        expect((await memberships(gymA.org.id, joe.entryId, owner.cookies)).memberGift).toMatchObject({ words: "£10.00 off", friendName: "Kai West" });
      },
      TIMEOUT_MS,
    );

    it(
      "filled in at Sell where it is off products, and at Add membership where it is off a membership, worked out again on the server; a voided sale makes it wait again",
      async () => {
        await setOffer(gymA, owner.cookies, TEN_POUNDS, "products");
        const max = await memberWithBill("max", "Max Brandt", true);
        try {
          await friendJoins(max.code, "Eve Stone", "eve.stone@example.com", true);
        } finally {
          await setOffer(gymA, owner.cookies, TEN_POUNDS);
        }
        const waiting = (await memberships(gymA.org.id, max.entryId, owner.cookies)).memberGiftAtSell;
        expect((await memberships(gymA.org.id, max.entryId, owner.cookies)).memberGift).toBeNull();
        if (waiting === null) throw new Error("no waiting gift");
        expect(waiting.on).toBe("products");
        // It is off products: Add membership refuses it.
        const notHere = await give(gymA.org.id, max.entryId, owner.cookies, packA, true, { priceMinor: 9000, memberGiftId: waiting.id, memberGiftMinor: 1000, totalMinor: 8000 });
        expect([notHere.statusCode, errorOf(notHere)]).toEqual([409, "member_gift_not_theirs"]);

        // Sell reads it with the person; a total the gift does not make is refused.
        const offered = friendGiftResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gymA.org.id}/member-list/entries/${max.entryId}/friend-gift`, owner.cookies)).body));
        expect(offered.memberGift?.id).toBe(waiting.id);
        const sale = (offMinor: number, totalMinor: number) => ({ requestKey: nextForm(), productId: barA, quantity: 1, entryId: max.entryId, method: "cash", totalMinor, memberGift: { id: waiting.id, offMinor } });
        const wrong = await post(`/v1/orgs/${gymA.org.id}/register/sales`, sale(500, 2000), owner.cookies);
        expect([wrong.statusCode, errorOf(wrong)]).toEqual([409, "member_gift_changed"]);
        const sold = await post(`/v1/orgs/${gymA.org.id}/register/sales`, sale(1000, 1500), owner.cookies);
        expect(sold.statusCode, sold.body).toBe(201);
        const saleId = (JSON.parse(sold.body) as { saleId: string }).saleId;
        const [row] = await sql<{ total_minor: number; discount_name: string; discount_minor: number }[]>`SELECT total_minor, discount_name, discount_minor FROM gym_sales WHERE id = ${saleId}`;
        expect(row).toEqual({ total_minor: 1500, discount_name: "Refer a friend gift", discount_minor: 1000 });
        // Sell's list says who the gift was for inviting.
        const register = (JSON.parse(sold.body) as { register: { sales: { id: string; giftFor: string | null }[] } }).register;
        expect(register.sales.find((s) => s.id === saleId)?.giftFor).toBe("Eve Stone");
        expect((await memberships(gymA.org.id, max.entryId, owner.cookies)).memberGiftAtSell).toBeNull();
        const twice = await post(`/v1/orgs/${gymA.org.id}/register/sales`, sale(1000, 1500), owner.cookies);
        expect([twice.statusCode, errorOf(twice)]).toEqual([409, "member_gift_not_theirs"]);

        // The sale voided: the gift waits again for Sell.
        expect((await post(`/v1/orgs/${gymA.org.id}/register/sales/${saleId}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
        expect((await memberships(gymA.org.id, max.entryId, owner.cookies)).memberGiftAtSell?.id).toBe(waiting.id);

        // A gift off a membership: Add membership takes it off the first bill, and Sell does not offer it.
        const lou = await memberWithBill("lou", "Lou Grant", true);
        await friendJoins(lou.code, "Rex Hale", "rex.hale@example.com", true);
        const forLou = (await memberships(gymA.org.id, lou.entryId, owner.cookies)).memberGift;
        if (forLou === null) throw new Error("no waiting gift");
        expect(forLou.on).toBe("membership");
        const atSell = friendGiftResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gymA.org.id}/member-list/entries/${lou.entryId}/friend-gift`, owner.cookies)).body));
        expect(atSell.memberGift).toBeNull();
        const notSold = await post(
          `/v1/orgs/${gymA.org.id}/register/sales`,
          { requestKey: nextForm(), productId: barA, quantity: 1, entryId: lou.entryId, method: "cash", totalMinor: 1500, memberGift: { id: forLou.id, offMinor: 1000 } },
          owner.cookies,
        );
        expect([notSold.statusCode, errorOf(notSold)]).toEqual([409, "member_gift_not_theirs"]);
        const changed = await give(gymA.org.id, lou.entryId, owner.cookies, packA, true, { priceMinor: 9000, memberGiftId: forLou.id, memberGiftMinor: 900, totalMinor: 8100 });
        expect([changed.statusCode, errorOf(changed)]).toEqual([409, "member_gift_changed"]);
        const pack = await give(gymA.org.id, lou.entryId, owner.cookies, packA, true, { priceMinor: 9000, memberGiftId: forLou.id, memberGiftMinor: 1000, totalMinor: 8000 });
        expect(pack.statusCode, pack.body).toBe(201);
        expect((await billsOfEntry(gymA.org.id, lou.entryId)).at(-1)).toMatchObject({ amount_minor: 8000, status: "paid" });
        const paid = await sql<{ amount_minor: number }[]>`
          SELECT p.amount_minor FROM gym_member_payments p JOIN gym_member_bills b ON b.id = p.bill_id
          JOIN gym_held_memberships h ON h.id = b.held_membership_id
          WHERE h.entry_id = ${lou.entryId} AND h.membership_type_id = ${packA}`;
        expect(paid).toEqual([{ amount_minor: 8000 }]);
      },
      TIMEOUT_MS,
    );
  });

  describe("the friend's payment voided or refunded", () => {
    it(
      "voided before the gift is used: taken back, and the lead says why; voided after: the gift stays",
      async () => {
        const ola = await memberWithBill("ola", "Ola Berg", true);
        const friend = await friendJoins(ola.code, "Finn Hale", "finn.hale@example.com", true);
        const friendPage = await memberships(gymA.org.id, friend.entryId, owner.cookies);
        const m = friendPage.memberships[0];
        const undo = m?.billing?.undo;
        if (m === undefined || undo?.kind !== "payment") throw new Error("no payment to void");
        expect((await post(`${heldUrl(gymA.org.id, friend.entryId)}/${m.id}/payments/${undo.paymentId}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId)).toMatchObject([{ taken_back_why: "voided", used_bill_id: null }]);
        expect((await memberships(gymA.org.id, ola.entryId, owner.cookies)).memberGift).toBeNull();
        const lead = await leadPage(gymA.org.id, friend.leadId, owner.cookies);
        expect(lead.memberGift?.gift).toEqual({ state: "taken_back", words: "£10.00 off", why: "voided", day: today });
        if (lead.memberGift === null) throw new Error("no line");
        expect(memberGiftLine(lead.memberGift.gift, "Ola Berg", "Finn")).toMatch(/^Ola Berg's gift for inviting Finn \(£10\.00 off\) was taken back: Finn's payment of \d{1,2} [A-Z][a-z]+ \d{4} was voided\.$/);

        // Paid again: given again, and Ola is not told a second time.
        const again = await post(`${heldUrl(gymA.org.id, friend.entryId)}/${m.id}/payments`, { requestKey: nextForm(), periodIndex: 0, amountMinor: 4000, method: "cash" }, owner.cookies);
        expect(again.statusCode, again.body).toBe(200);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId).map((g) => g.taken_back_why)).toEqual(["voided", null]);
        expect(await messagesOf(ola.person.id)).toHaveLength(1);

        // Used, then the friend's payment voided: the gift stays where it came off.
        const used = await memberWithBill("uma", "Uma Roy", false);
        const pal = await friendJoins(used.code, "Pat Lane", "pat.lane@example.com", true);
        expect(await billsOfEntry(gymA.org.id, used.entryId)).toMatchObject([{ amount_minor: 4000 }]);
        const palMembership = (await memberships(gymA.org.id, pal.entryId, owner.cookies)).memberships[0];
        const palUndo = palMembership?.billing?.undo;
        if (palMembership === undefined || palUndo?.kind !== "payment") throw new Error("no payment to void");
        expect((await post(`${heldUrl(gymA.org.id, pal.entryId)}/${palMembership.id}/payments/${palUndo.paymentId}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
        expect(await billsOfEntry(gymA.org.id, used.entryId)).toMatchObject([{ amount_minor: 4000 }]);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === pal.entryId)).toMatchObject([{ taken_back_why: null, used_off_minor: 1000 }]);
      },
      TIMEOUT_MS,
    );

    it(
      "refunded in full before the gift is used: taken back; the refund taken back gives it again",
      async () => {
        const rae = await memberWithBill("rae", "Rae Quinn", true);
        const friend = await friendJoins(rae.code, "Gil Ford", "gil.ford@example.com", true);
        const m = (await memberships(gymA.org.id, friend.entryId, owner.cookies)).memberships[0];
        const payment = m?.billing?.bills[0]?.payments[0];
        if (m === undefined || payment === undefined) throw new Error("no payment");
        const refundUrl = `${heldUrl(gymA.org.id, friend.entryId)}/${m.id}/payments/${payment.id}/refunds`;
        const part = await post(refundUrl, { requestKey: nextForm(), amountMinor: 1000, method: "cash", reason: "charged_too_much" }, owner.cookies);
        expect(part.statusCode, part.body).toBe(200);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId).map((g) => g.taken_back_why)).toEqual([null]);
        expect(payment.amountMinor).toBe(5000);
        const rest = await post(refundUrl, { requestKey: nextForm(), amountMinor: 4000, method: "cash", reason: "leaving" }, owner.cookies);
        expect(rest.statusCode, rest.body).toBe(200);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId).map((g) => g.taken_back_why)).toEqual(["refunded"]);
        expect((await leadPage(gymA.org.id, friend.leadId, owner.cookies)).memberGift?.gift).toMatchObject({ state: "taken_back", why: "refunded" });

        const refunds = (await memberships(gymA.org.id, friend.entryId, owner.cookies)).memberships[0]?.billing?.bills[0]?.payments[0]?.refunds ?? [];
        const last = refunds.at(-1);
        if (last === undefined) throw new Error("no refund");
        expect((await post(`${refundUrl}/${last.id}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
        expect((await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === friend.entryId).map((g) => g.taken_back_why)).toEqual(["refunded", null]);
        expect(await messagesOf(rae.person.id)).toHaveLength(1);
      },
      TIMEOUT_MS,
    );

    it(
      "a friend's sale at the desk refunded in full before the gift is used: taken back; a part refund keeps it, and the refund voided gives it again (18p)",
      async () => {
        const viv = await memberWithBill("viv", "Viv Lowe", true);
        const leadId = await invited(viv.code, "Nell Shaw", "nell.shaw@example.com");
        const nell = await added(gymA.org.id, owner.cookies, { fullName: "Nell Shaw", email: "nell.shaw@example.com", leadId });
        const sold = await post(`/v1/orgs/${gymA.org.id}/register/sales`, { requestKey: nextForm(), productId: barA, quantity: 1, entryId: nell, method: "cash", totalMinor: 2500 }, owner.cookies);
        expect(sold.statusCode, sold.body).toBe(201);
        const saleId = (JSON.parse(sold.body) as { saleId: string }).saleId;
        const nells = async () => (await giftsOf(gymA.org.id)).filter((g) => g.friend_entry_id === nell).map((g) => g.taken_back_why);
        expect(await nells()).toEqual([null]);

        const refunds = `/v1/orgs/${gymA.org.id}/register/sales/${saleId}/refunds`;
        const part = await post(refunds, { requestKey: nextForm(), amountMinor: 1000, method: "cash", reason: "charged_too_much", restock: 0 }, owner.cookies);
        expect(part.statusCode, part.body).toBe(201);
        expect(await nells()).toEqual([null]);
        const rest = await post(refunds, { requestKey: nextForm(), amountMinor: 1500, method: "cash", reason: "returned", restock: 1 }, owner.cookies);
        expect(rest.statusCode, rest.body).toBe(201);
        expect(await nells()).toEqual(["refunded"]);
        expect((await memberships(gymA.org.id, viv.entryId, owner.cookies)).memberGift).toBeNull();

        const [last] = await sql<{ id: string }[]>`SELECT id FROM gym_sale_refunds WHERE gym_id = ${gymA.org.id} AND sale_id = ${saleId} AND amount_minor = 1500`;
        if (last === undefined) throw new Error("no refund");
        expect((await post(`${refunds}/${last.id}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
        expect(await nells()).toEqual(["refunded", null]);
        expect(await messagesOf(viv.person.id)).toHaveLength(1);
      },
      TIMEOUT_MS,
    );

    it(
      "a bill the gift came off, cancelled by staff: the gift waits for the next one",
      async () => {
        const tom = await memberWithBill("tom", "Tom Hart", false);
        await friendJoins(tom.code, "Ivo Lund", "ivo.lund@example.com", true);
        const page = await memberships(gymA.org.id, tom.entryId, owner.cookies);
        const m = page.memberships[0];
        const billId = m?.billing?.cancel?.billId;
        if (m === undefined || billId === undefined) throw new Error("no bill to cancel");
        expect(m.billing?.bills[0]).toMatchObject({ amountMinor: 4000, gift: { offMinor: 1000 } });
        expect((await post(`${heldUrl(gymA.org.id, tom.entryId)}/${m.id}/bills/${billId}/cancel`, { reason: "not_charging" }, owner.cookies)).statusCode).toBe(200);
        expect((await memberships(gymA.org.id, tom.entryId, owner.cookies)).memberGift).toMatchObject({ words: "£10.00 off", friendName: "Ivo Lund" });
      },
      TIMEOUT_MS,
    );
  });
});
