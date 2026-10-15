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
  const put = (path: string, payload: unknown, cookies: Cookies) => send(api(), "PUT", path, payload, cookies);
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
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_leads WHERE email = ${email}::citext AND referred_at IS NOT NULL`;
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
        const both = await Promise.all([
          post(heldUrl(gymA.org.id, kofi.entryId), giveBody(goldA, today, gift), owner.cookies),
          post(heldUrl(gymA.org.id, kofi.entryId), giveBody(goldA, today, gift), owner.cookies, second),
        ]);
        expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
        expect(await heldOf(gymA.org.id, kofi.entryId)).toEqual([{ discount_id: gift }]);
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
        const leo = await added(gymB.org.id, ownerB.cookies, { fullName: "Leo Grant", email: "leo.grant@example.com" });
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
        const joLead = await invited(codeA, "Jo", "jo.pike@example.com", "+44 7700 900789");
        const ticked = await added(gymA.org.id, owner.cookies, { fullName: "Joanna Pike", email: "joanna.pike@example.com", phone: "07700 900789", leadId: joLead });
        expect(ticked.lead).toEqual({ id: joLead, fullName: "Jo" });
        expect(await leadRow(joLead)).toEqual({ status: "joined", entry_id: ticked.entryId });
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
