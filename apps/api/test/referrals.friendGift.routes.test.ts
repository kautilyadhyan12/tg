// Refer a friend: the friend's gift, and Add member finding the person in Leads — routes
// against real Postgres (DATABASE_URL-gated). ROADMAP 20e-ii-b-i; spec Part 3 §16.3.
//
// The first block is the worst thing this job could do to a real person: a stranger linked
// to somebody else's lead, so a member is credited for a friend who never came, or the
// friend's gift given to somebody nobody invited, or given twice. Every claim is checked
// against the database, never against a reply alone.
//
// The emails and phones come from how people really write them, not from the code's own
// rules: a UK mobile as "07700 900123", "+44 7700 900123" and "+44 (0)7700 900123"; an
// address in capitals; Gmail's dots and "+tags", which reach the same inbox but are not the
// same address to anybody else, and so never link two people.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { RobotCheck } from "../src/modules/orgs/gymPage/robotCheck.js";
import { createMemoryRedis } from "../src/redis.js";
import {
  FRIEND_GIFT_WORDS,
  friendGiftResponseSchema,
  heldMembershipsResponseSchema,
  leadMatchResponseSchema,
  type HeldMembershipsResponse,
  type Lead,
  type LeadMatch,
  type MemberReferralResponse,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "friend-gift-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TIMEOUT_MS = 180_000;
const LIVE_PLAN = "zz_friend_gift_routes";

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
const nextIp = () => `10.72.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
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

d("Refer a friend: the friend's gift (real Postgres)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'fgift-t-%@example.com')`;
    await sql`DELETE FROM gym_lead_enquiries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_referral_settings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_referral_links WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'fgift-t-%@example.com'`;
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
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error?: string }).error;

  const makeUser = async (local: string, displayName: string): Promise<Person> => {
    const email = `fgift-t-${local}@example.com`;
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

  type Gift = { kind: "percent"; percentBp: number; amountMinor: null; on: "first" | "every" | "products" };
  const pct = (n: number, on: Gift["on"] = "first"): Gift => ({ kind: "percent", percentBp: n * 100, amountMinor: null, on });
  const switchOn = async (org: CreatedOrg, owner: Cookies, friend: Gift) => {
    const res = await put(`/v1/orgs/${org.org.id}/referral-settings`, { on: true, member: null, friend }, owner);
    expect(res.statusCode, res.body).toBe(200);
  };
  const friendDiscountOf = async (gymId: string): Promise<string> => {
    const [row] = await sql<{ id: string | null }[]>`SELECT friend_discount_id AS id FROM gym_referral_settings WHERE gym_id = ${gymId}`;
    if (row?.id === null || row?.id === undefined) throw new Error("no friend's gift");
    return row.id;
  };

  const linkOf = async (org: CreatedOrg, person: Person): Promise<string> => {
    const res = await get(`/v1/orgs/${org.org.id}/referral`, person.cookies);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as MemberReferralResponse;
    if (body.status !== "on") throw new Error("the offer is off");
    return body.path.replace("/invite/", "");
  };
  /** The friend sends the invite page's form: a new lead, marked with who invited them. */
  const invited = async (code: string, fullName: string, email: string, phone?: string): Promise<string> => {
    const res = await post(`/v1/public/invites/${code}/enquiries`, { fullName, email, ...(phone === undefined ? {} : { phone }), robotToken: "ok-token" });
    expect(res.statusCode, res.body).toBe(202);
    // This file's businesses' lead alone: another test file may invite the same address at once.
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_leads WHERE gym_id IN (SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'fgift-t-%@example.com')) AND email = ${email}::citext AND referred_at IS NOT NULL`;
    if (row === undefined) throw new Error(`no invited lead for ${email}`);
    return row.id;
  };

  const addMember = (gymId: string, cookies: Cookies, body: Record<string, unknown>) => post(`/v1/orgs/${gymId}/member-list/entries`, body, cookies);
  const added = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<{ entryId: string; lead: { id: string; fullName: string } | undefined }> => {
    const res = await addMember(gymId, cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    const parsed = JSON.parse(res.body) as { entry: { entryId: string }; lead?: { id: string; fullName: string } };
    return { entryId: parsed.entry.entryId, lead: parsed.lead };
  };
  const match = async (gymId: string, cookies: Cookies, query: Record<string, string>): Promise<LeadMatch | null> => {
    const res = await get(`/v1/orgs/${gymId}/leads/match?${new URLSearchParams(query).toString()}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return leadMatchResponseSchema.parse(JSON.parse(res.body)).lead;
  };
  const leadRow = async (leadId: string) =>
    (await sql<{ status: string; entry_id: string | null }[]>`SELECT status, entry_id FROM gym_leads WHERE id = ${leadId}`)[0];
  const leadPage = async (gymId: string, leadId: string, cookies: Cookies): Promise<Lead> => {
    const res = await get(`/v1/orgs/${gymId}/leads/${leadId}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { lead: Lead }).lead;
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const memberships = async (gymId: string, entryId: string, cookies: Cookies): Promise<HeldMembershipsResponse> => {
    const res = await get(heldUrl(gymId, entryId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  /** Gold Monthly, paid in cash, with the discount at 20% off its first payment. */
  const giveBody = (typeId: string, today: string, discountId: string | null) => ({
    requestKey: nextForm(),
    typeId,
    startsOn: today,
    paid: true,
    method: "cash",
    priceMinor: 5000,
    ...(discountId === null ? {} : { discountId, discountMinor: 1000 }),
  });
  const heldOf = (gymId: string, entryId: string) =>
    sql<{ discount_id: string | null }[]>`SELECT discount_id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at, id`;

  let owner: Person;
  let ownerB: Person;
  let maya: Person;
  let stranger: Person;
  let gymA: CreatedOrg;
  let gymB: CreatedOrg;
  let goldA: string;
  let packA: string;
  let freeA: string;
  let desk: Person;
  let today: string;
  let codeA: string;

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
    maya = await makeUser("maya", "Maya Patel");
    stranger = await makeUser("stranger", "Stranger");
    gymA = await makeOrg(owner.cookies, "Northside Gift A");
    gymB = await makeOrg(ownerB.cookies, "Southside Gift B");
    await join(gymA, owner.cookies, maya);
    await join(gymB, ownerB.cookies, maya);
    await switchOn(gymA, owner.cookies, pct(20));
    await switchOn(gymB, ownerB.cookies, pct(15, "products"));
    const typeRes = await post(`/v1/orgs/${gymA.org.id}/membership-types`, gold, owner.cookies);
    expect(typeRes.statusCode, typeRes.body).toBe(201);
    const [type] = await sql<{ id: string }[]>`SELECT id FROM gym_membership_types WHERE gym_id = ${gymA.org.id} AND name = 'Gold Monthly'`;
    if (type === undefined) throw new Error("no type");
    goldA = type.id;
    const addType = async (body: Record<string, unknown>): Promise<string> => {
      const res = await post(`/v1/orgs/${gymA.org.id}/membership-types`, { ...gold, ...body }, owner.cookies);
      expect(res.statusCode, res.body).toBe(201);
      const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_membership_types WHERE gym_id = ${gymA.org.id} AND name = ${String(body["name"])}`;
      if (row === undefined) throw new Error("no type");
      return row.id;
    };
    packA = await addType({ name: "Ten classes", kind: "pack", priceMinor: 9000, termCount: null, termUnit: null, packClasses: 10, packDays: 60 });
    freeA = await addType({ name: "Free Trial Week", kind: "one_time", priceMinor: 0, termCount: 7, termUnit: "day" });
    desk = await makeUser("desk", "Dee Desk");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymA.org.id}, ${desk.id}, 'trainer', ${["members.read", "members.confirm"]})`;
    codeA = await linkOf(gymA, maya);
    const someone = await added(gymA.org.id, owner.cookies, { fullName: "Day Probe", email: "fgift-probe@example.com" });
    today = (await memberships(gymA.org.id, someone.entryId, owner.cookies)).today;
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  describe("the worst thing: a stranger linked to somebody else's lead, or the gift given to somebody nobody invited, or twice", () => {
    it(
      "a different person with the invited friend's email is not linked, is not offered the gift, and is refused it",
      async () => {
        const leadId = await invited(codeA, "Tara Shah", "tara.shah@example.com");
        const gift = await friendDiscountOf(gymA.org.id);

        // Her mother on the same address: shown to staff, never joined by itself.
        const shown = await match(gymA.org.id, owner.cookies, { fullName: "Priya Shah", email: "tara.shah@example.com" });
        expect(shown).toMatchObject({ id: leadId, fullName: "Tara Shah", sameName: false });
        const priya = await added(gymA.org.id, owner.cookies, { fullName: "Priya Shah", email: "tara.shah@example.com" });
        expect(priya.lead).toBeUndefined();
        expect(await leadRow(leadId)).toEqual({ status: "new", entry_id: null });

        const read = await memberships(gymA.org.id, priya.entryId, owner.cookies);
        expect(read.friendGift).toBeNull();
        expect(read.discounts.map((x) => x.id)).not.toContain(gift);
        const res = await post(heldUrl(gymA.org.id, priya.entryId), giveBody(goldA, today, gift), owner.cookies);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("friend_gift_not_theirs");
        expect((JSON.parse(res.body) as { message: string }).message).toBe(FRIEND_GIFT_WORDS.not_theirs);
        expect(await heldOf(gymA.org.id, priya.entryId)).toEqual([]);
      },
      TIMEOUT_MS,
    );

    it(
      "another business never sees, links or gives for this business's lead",
      async () => {
        const leadId = await invited(codeA, "Omar Farooq", "omar.farooq@example.com");
        expect(await match(gymB.org.id, ownerB.cookies, { fullName: "Omar Farooq", email: "omar.farooq@example.com" })).toBeNull();
        const omarB = await added(gymB.org.id, ownerB.cookies, { fullName: "Omar Farooq", email: "omar.farooq@example.com" });
        expect(omarB.lead).toBeUndefined();
        expect(await leadRow(leadId)).toEqual({ status: "new", entry_id: null });
        // B's own friend's gift is for B's invited friends; Omar is none of B's.
        const res = await get(`/v1/orgs/${gymB.org.id}/member-list/entries/${omarB.entryId}/friend-gift`, ownerB.cookies);
        expect(res.statusCode).toBe(200);
        expect(friendGiftResponseSchema.parse(JSON.parse(res.body)).friendGift).toBeNull();
        // A lead id of A's, sent to B's Add member, joins nothing.
        const sent = await added(gymB.org.id, ownerB.cookies, { fullName: "Omar Khan", email: "o.khan@example.com", leadId });
        expect(sent.lead).toBeUndefined();
        expect(await leadRow(leadId)).toEqual({ status: "new", entry_id: null });
      },
      TIMEOUT_MS,
    );

    it(
      "the invited friend is linked, offered the gift once, and refused it the second time",
      async () => {
        const leadId = await invited(codeA, "Lena Brooks", "lena.brooks@example.com");
        const gift = await friendDiscountOf(gymA.org.id);
        const shown = await match(gymA.org.id, owner.cookies, { fullName: "lena  brooks", email: "LENA.BROOKS@Example.com" });
        expect(shown).toMatchObject({ id: leadId, sameName: true, invitedBy: { name: "Maya Patel", member: true } });
        expect(shown?.friendGift?.discount.id).toBe(gift);
        const lena = await added(gymA.org.id, owner.cookies, { fullName: "Lena Brooks", email: "LENA.BROOKS@Example.com", leadId });
        expect(lena.lead).toEqual({ id: leadId, fullName: "Lena Brooks" });
        expect(await leadRow(leadId)).toEqual({ status: "joined", entry_id: lena.entryId });

        const read = await memberships(gymA.org.id, lena.entryId, owner.cookies);
        expect(read.friendGift).toMatchObject({ discount: { id: gift }, invitedBy: "Maya Patel" });
        expect((await post(heldUrl(gymA.org.id, lena.entryId), giveBody(goldA, today, gift), owner.cookies)).statusCode).toBe(201);
        expect(await heldOf(gymA.org.id, lena.entryId)).toEqual([{ discount_id: gift }]);
        expect((await memberships(gymA.org.id, lena.entryId, owner.cookies)).friendGift).toBeNull();

        const again = await post(heldUrl(gymA.org.id, lena.entryId), giveBody(goldA, today, gift), owner.cookies);
        expect(again.statusCode, again.body).toBe(409);
        expect(errorOf(again)).toBe("friend_gift_not_theirs");
        expect(await heldOf(gymA.org.id, lena.entryId)).toEqual([{ discount_id: gift }]);
        expect((await leadPage(gymA.org.id, leadId, owner.cookies)).friendGift).toEqual({ state: "given", on: "Gold Monthly", day: today });
      },
      TIMEOUT_MS,
    );

    it(
      "two staff giving the gift at one instant, on two servers, give it once",
      async () => {
        const leadId = await invited(codeA, "Kofi Mensah", "kofi.mensah@example.com");
        const gift = await friendDiscountOf(gymA.org.id);
        const kofi = await added(gymA.org.id, owner.cookies, { fullName: "Kofi Mensah", email: "kofi.mensah@example.com", leadId });
        if (second === undefined) throw new Error("no second app");
        // Two different memberships, so nothing but the gift's own rule can refuse the second.
        const both = await Promise.all([
          post(heldUrl(gymA.org.id, kofi.entryId), giveBody(goldA, today, gift), owner.cookies),
          post(heldUrl(gymA.org.id, kofi.entryId), { ...giveBody(packA, today, gift), priceMinor: 9000, discountMinor: 1800 }, owner.cookies, second),
        ]);
        expect(both.map((r) => r.statusCode).sort(), both.map((r) => r.body).join(" | ")).toEqual([201, 409]);
        expect(both.map((r) => errorOf(r)).filter((e) => e !== undefined)).toEqual(["friend_gift_not_theirs"]);
        expect((await heldOf(gymA.org.id, kofi.entryId)).map((h) => h.discount_id)).toEqual([gift]);
      },
      TIMEOUT_MS,
    );

    it(
      "somebody with a membership here before they were invited is not offered the gift",
      async () => {
        const gift = await friendDiscountOf(gymA.org.id);
        const nikhil = await added(gymA.org.id, owner.cookies, { fullName: "Nikhil Rao", email: "nikhil.rao@example.com" });
        expect((await post(heldUrl(gymA.org.id, nikhil.entryId), giveBody(goldA, today, null), owner.cookies)).statusCode).toBe(201);
        // He opens Maya's link with another address and is a new lead; Leads → Join links him.
        const leadId = await invited(codeA, "Nikhil Rao", "nik.rao@example.com");
        await sql`UPDATE gym_leads SET email = 'nikhil.rao@example.com' WHERE id = ${leadId}`;
        expect((await post(`/v1/orgs/${gymA.org.id}/leads/${leadId}/join`, {}, owner.cookies)).statusCode).toBe(200);
        expect(await leadRow(leadId)).toEqual({ status: "joined", entry_id: nikhil.entryId });
        expect((await memberships(gymA.org.id, nikhil.entryId, owner.cookies)).friendGift).toBeNull();
        const res = await post(heldUrl(gymA.org.id, nikhil.entryId), giveBody(goldA, today, gift), owner.cookies);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("friend_gift_not_theirs");
        expect((await leadPage(gymA.org.id, leadId, owner.cookies)).friendGift).toEqual({ state: "member_before" });
      },
      TIMEOUT_MS,
    );

    it(
      "a desk sale with the gift: never to a walk-in, never to somebody nobody invited, once to the friend",
      async () => {
        const product = await post(`/v1/orgs/${gymB.org.id}/register/products`, { name: "Protein bar", priceMinor: 200, taxRateId: null, stock: null }, ownerB.cookies);
        expect(product.statusCode, product.body).toBe(201);
        const [bar] = await sql<{ id: string }[]>`SELECT id FROM gym_products WHERE gym_id = ${gymB.org.id} AND name = 'Protein bar'`;
        if (bar === undefined) throw new Error("no product");
        const gift = await friendDiscountOf(gymB.org.id);
        const sale = (entryId: string | null) => ({ requestKey: nextForm(), productId: bar.id, quantity: 1, entryId, method: "cash", totalMinor: 170, discountId: gift });
        const sell = (body: Record<string, unknown>) => post(`/v1/orgs/${gymB.org.id}/register/sales`, body, ownerB.cookies);

        const walkIn = await sell(sale(null));
        expect(walkIn.statusCode, walkIn.body).toBe(409);
        expect(errorOf(walkIn)).toBe("friend_gift_not_theirs");
        const nobody = await added(gymB.org.id, ownerB.cookies, { fullName: "Nobody Invited", email: "nobody@example.com" });
        expect(errorOf(await sell(sale(nobody.entryId)))).toBe("friend_gift_not_theirs");

        const codeB = await linkOf(gymB, maya);
        const leadId = await invited(codeB, "Leo Grant", "leo.grant@example.com");
        const leo = await added(gymB.org.id, ownerB.cookies, { fullName: "Leo Grant", email: "leo.grant@example.com", leadId });
        expect(leo.lead).toEqual({ id: leadId, fullName: "Leo Grant" });
        const offered = await get(`/v1/orgs/${gymB.org.id}/member-list/entries/${leo.entryId}/friend-gift`, ownerB.cookies);
        expect(friendGiftResponseSchema.parse(JSON.parse(offered.body)).friendGift?.discount.id).toBe(gift);
        expect((await sell(sale(leo.entryId))).statusCode).toBe(201);
        expect(errorOf(await sell(sale(leo.entryId)))).toBe("friend_gift_not_theirs");
        const count = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_sales WHERE gym_id = ${gymB.org.id} AND discount_id = ${gift}`;
        expect(count[0]?.n).toBe(1);
      },
      TIMEOUT_MS,
    );
  });

  describe("somebody already on Members before they were invited (round one, H1)", () => {
    it(
      "a record on Members with no membership, joined from Leads, is not offered the gift and is refused it",
      async () => {
        const gift = await friendDiscountOf(gymA.org.id);
        const rahul = await added(gymA.org.id, owner.cookies, { fullName: "Rahul Mehta", email: "rahul.mehta@example.com" });
        const leadId = await invited(codeA, "Rahul Mehta", "rahul.mehta@example.com");
        expect((await post(`/v1/orgs/${gymA.org.id}/leads/${leadId}/join`, {}, owner.cookies)).statusCode).toBe(200);
        expect(await leadRow(leadId)).toEqual({ status: "joined", entry_id: rahul.entryId });
        expect((await memberships(gymA.org.id, rahul.entryId, owner.cookies)).friendGift).toBeNull();
        const res = await post(heldUrl(gymA.org.id, rahul.entryId), giveBody(goldA, today, gift), owner.cookies);
        expect(errorOf(res), res.body).toBe("friend_gift_not_theirs");
        expect((await leadPage(gymA.org.id, leadId, owner.cookies)).friendGift).toEqual({ state: "member_before" });
      },
      TIMEOUT_MS,
    );

    it(
      "a past member put back by Add member is joined to their old record and is not offered the gift",
      async () => {
        const gift = await friendDiscountOf(gymA.org.id);
        const ines = await added(gymA.org.id, owner.cookies, { fullName: "Ines Lopez", email: "ines.lopez@example.com" });
        await sql`UPDATE gym_member_list_entries SET former_at = now() - interval '30 days' WHERE id = ${ines.entryId}`;
        const leadId = await invited(codeA, "Ines Lopez", "ines.lopez@example.com");
        const back = await addMember(gymA.org.id, owner.cookies, { fullName: "Ines Lopez", email: "ines.lopez@example.com", leadId });
        expect(back.statusCode, back.body).toBeLessThan(300);
        expect((JSON.parse(back.body) as { outcome: string }).outcome).toBe("revived");
        expect(await leadRow(leadId)).toEqual({ status: "joined", entry_id: ines.entryId });
        expect((await memberships(gymA.org.id, ines.entryId, owner.cookies)).friendGift).toBeNull();
        expect(errorOf(await post(heldUrl(gymA.org.id, ines.entryId), giveBody(goldA, today, gift), owner.cookies))).toBe("friend_gift_not_theirs");
      },
      TIMEOUT_MS,
    );
  });

  describe("the lead says a gift was not used only where it could have been (round one, H2)", () => {
    it(
      "a free trial added first is not a gift left off: the line still says it will be filled in",
      async () => {
        const leadId = await invited(codeA, "Mia Wong", "mia.wong@example.com");
        const mia = await added(gymA.org.id, owner.cookies, { fullName: "Mia Wong", email: "mia.wong@example.com", leadId });
        const trial = await post(heldUrl(gymA.org.id, mia.entryId), { requestKey: nextForm(), typeId: freeA, startsOn: today, paid: false, priceMinor: 0 }, owner.cookies);
        expect(trial.statusCode, trial.body).toBe(201);
        expect((await leadPage(gymA.org.id, leadId, owner.cookies)).friendGift).toMatchObject({ state: "to_give", skipped: null });
        // It is still offered for the paid membership after the trial.
        expect((await memberships(gymA.org.id, mia.entryId, owner.cookies)).friendGift).not.toBeNull();
      },
      TIMEOUT_MS,
    );

    it(
      "a membership added while the gift was for products only is not a gift left off once the gift covers memberships",
      async () => {
        const silver = await post(`/v1/orgs/${gymB.org.id}/membership-types`, { ...gold, name: "Silver Monthly" }, ownerB.cookies);
        expect(silver.statusCode, silver.body).toBe(201);
        const [type] = await sql<{ id: string }[]>`SELECT id FROM gym_membership_types WHERE gym_id = ${gymB.org.id} AND name = 'Silver Monthly'`;
        if (type === undefined) throw new Error("no type");
        const codeB = await linkOf(gymB, maya);
        const leadId = await invited(codeB, "Zoe Park", "zoe.park@example.com");
        const zoe = await added(gymB.org.id, ownerB.cookies, { fullName: "Zoe Park", email: "zoe.park@example.com", leadId });
        const given = await post(heldUrl(gymB.org.id, zoe.entryId), { requestKey: nextForm(), typeId: type.id, startsOn: today, paid: false, priceMinor: 5000 }, ownerB.cookies);
        expect(given.statusCode, given.body).toBe(201);
        // The owner changes the friend's gift to memberships afterwards.
        await switchOn(gymB, ownerB.cookies, pct(15));
        expect((await leadPage(gymB.org.id, leadId, ownerB.cookies)).friendGift).toMatchObject({ state: "to_give", forMemberships: true, skipped: null });
      },
      TIMEOUT_MS,
    );

    it(
      "a gift nobody has used, changed in place from products to memberships, does not reach back to a membership added before",
      async () => {
        // B's gift is unused, so changing it edits the same discount: it keeps the day it was made.
        await switchOn(gymB, ownerB.cookies, pct(15, "products"));
        const before = await friendDiscountOf(gymB.org.id);
        const [silver] = await sql<{ id: string }[]>`SELECT id FROM gym_membership_types WHERE gym_id = ${gymB.org.id} AND name = 'Silver Monthly'`;
        if (silver === undefined) throw new Error("no type");
        const codeB = await linkOf(gymB, maya);
        const leadId = await invited(codeB, "Kai Moreno", "kai.moreno@example.com");
        const kai = await added(gymB.org.id, ownerB.cookies, { fullName: "Kai Moreno", email: "kai.moreno@example.com", leadId });
        const given = await post(heldUrl(gymB.org.id, kai.entryId), { requestKey: nextForm(), typeId: silver.id, startsOn: today, paid: false, priceMinor: 5000 }, ownerB.cookies);
        expect(given.statusCode, given.body).toBe(201);
        await switchOn(gymB, ownerB.cookies, pct(15));
        expect(await friendDiscountOf(gymB.org.id)).toBe(before);
        expect((await leadPage(gymB.org.id, leadId, ownerB.cookies)).friendGift).toMatchObject({ state: "to_give", forMemberships: true, skipped: null });
      },
      TIMEOUT_MS,
    );
  });

  describe("Add member finds the person in Leads, as people really write an email and a phone", () => {
    it(
      "a UK mobile written three ways finds the lead; another address that reaches the same inbox does not",
      async () => {
        const leadId = await invited(codeA, "Sam", "sam.okafor@example.com", "+44 7700 900123");
        for (const phone of ["07700 900123", "+44 7700 900123", "07700900123"]) {
          expect(await match(gymA.org.id, owner.cookies, { fullName: "Samuel Okafor", phone }), phone).toMatchObject({ id: leadId, sameName: false });
        }
        for (const email of ["samokafor@example.com", "sam.okafor+gym@example.com", "sam.okafor@example.co"]) {
          expect(await match(gymA.org.id, owner.cookies, { fullName: "Sam", email }), email).toBeNull();
        }
        // Staff who may not take payments are shown the lead, never the gift and its code.
        const asDesk = await match(gymA.org.id, desk.cookies, { fullName: "Sam", email: "sam.okafor@example.com" });
        expect(asDesk).toMatchObject({ id: leadId, friendGift: null });
        expect((await match(gymA.org.id, owner.cookies, { fullName: "Sam", email: "sam.okafor@example.com" }))?.friendGift).not.toBeNull();
        // Half typed: nobody yet, and no error.
        expect(await match(gymA.org.id, owner.cookies, { fullName: "Sam", email: "sam.okafor@" })).toBeNull();
      },
      TIMEOUT_MS,
    );

    it(
      "a lead with another name is joined only when staff say it is the same person",
      async () => {
        const leadId = await invited(codeA, "Bea", "bea.lindqvist@example.com", "+44 7700 900456");
        const notTicked = await added(gymA.org.id, owner.cookies, { fullName: "Beatrice Lindqvist", email: "beatrice.l@example.com", phone: "07700 900456" });
        expect(notTicked.lead).toBeUndefined();
        expect(await leadRow(leadId)).toEqual({ status: "new", entry_id: null });
        // Nor one with the same name that the screen did not show: only the lead sent is joined.
        const unseen = await invited(codeA, "Ana Costa", "ana.costa@example.com");
        const ana = await added(gymA.org.id, owner.cookies, { fullName: "Ana Costa", email: "ana.costa@example.com" });
        expect(ana.lead).toBeUndefined();
        expect(await leadRow(unseen)).toEqual({ status: "new", entry_id: null });
        const joLead = await invited(codeA, "Jo", "jo.pike@example.com", "+44 7700 900789");
        const ticked = await added(gymA.org.id, owner.cookies, { fullName: "Joanna Pike", email: "joanna.pike@example.com", phone: "07700 900789", leadId: joLead });
        expect(ticked.lead).toEqual({ id: joLead, fullName: "Jo" });
        expect(await leadRow(joLead)).toEqual({ status: "joined", entry_id: ticked.entryId });
        // Staff add her membership without the gift: her lead says so, by whom and when.
        expect((await post(heldUrl(gymA.org.id, ticked.entryId), giveBody(goldA, today, null), owner.cookies)).statusCode).toBe(201);
        expect((await leadPage(gymA.org.id, joLead, owner.cookies)).friendGift).toEqual({
          state: "to_give",
          words: "20% off the first payment of a membership",
          forMemberships: true,
          forProducts: false,
          skipped: { on: "Gold Monthly", day: today, by: "Owner A" },
        });
      },
      TIMEOUT_MS,
    );
  });

  describe("who may ask", () => {
    it(
      "a stranger, and a member, are refused the lead match and the friend's gift",
      async () => {
        const anyEntry = (await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gymA.org.id} LIMIT 1`)[0]?.id ?? "";
        for (const who of [stranger, maya]) {
          const m = await get(`/v1/orgs/${gymA.org.id}/leads/match?email=lena.brooks%40example.com`, who.cookies);
          expect([403, 404], m.body).toContain(m.statusCode);
          const g = await get(`/v1/orgs/${gymA.org.id}/member-list/entries/${anyEntry}/friend-gift`, who.cookies);
          expect([403, 404], g.body).toContain(g.statusCode);
        }
        // B's owner, asking about A's person through A, is refused; through B, finds nothing.
        const g = await get(`/v1/orgs/${gymA.org.id}/member-list/entries/${anyEntry}/friend-gift`, ownerB.cookies);
        expect([403, 404]).toContain(g.statusCode);
        const viaB = await get(`/v1/orgs/${gymB.org.id}/member-list/entries/${anyEntry}/friend-gift`, ownerB.cookies);
        expect(friendGiftResponseSchema.parse(JSON.parse(viaB.body)).friendGift).toBeNull();
      },
      TIMEOUT_MS,
    );
  });
});
