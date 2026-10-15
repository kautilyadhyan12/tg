// Refer a friend — routes against real Postgres (DATABASE_URL-gated). ROADMAP 20e-ii-a;
// spec Part 3 §16.3.
//
// The first block is the worst thing this job could do to a real person: a lead marked,
// or a gift promised, as one member's when it is not theirs — another business's member,
// somebody who has left, a made-up link — or a member's name shown to whoever opens their
// link. Every claim is checked against the database, never against a reply alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { RobotCheck } from "../src/modules/orgs/gymPage/robotCheck.js";
import type { Lead, MemberReferralResponse, PublicInvite, ReferralSettings } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "referral-routes-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 120_000;
const LIVE_PLAN = "zz_referral_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}
interface Person {
  id: string;
  email: string;
  cookies: Record<string, string>;
}

let ipCounter = 0;
const nextIp = () => `10.71.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const robotCheck: RobotCheck = { siteKey: "test-site-key", verify: () => Promise.resolve("passed") };

d("Refer a friend (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  /** A second api on the same database, so two requests can race. */
  let second: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'refer-t-%@example.com')`;
    await sql`DELETE FROM gym_lead_enquiries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_referral_settings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_referral_links WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_discounts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_pages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'refer-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (target: App, method: "GET" | "POST" | "PUT", path: string, payload: unknown, cookies: Record<string, string>) =>
    target.inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Record<string, string> = {}, target: App = api()) => send(target, "GET", path, undefined, cookies);
  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) => send(api(), "POST", path, payload, cookies);
  const put = (path: string, payload: unknown, cookies: Record<string, string>) => send(api(), "PUT", path, payload, cookies);

  const makeUser = async (local: string, displayName: string): Promise<Person> => {
    const email = `refer-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    if (row === undefined) throw new Error("no user row");
    return { id: row.id, email, cookies: cookieMap(login) };
  };

  const makeOrg = async (cookies: Record<string, string>, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };

  /** Joins by the gym's code and is let in by the owner: a live member. */
  const join = async (org: CreatedOrg, owner: Record<string, string>, person: Person) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner)).statusCode).toBe(200);
  };

  const discount = async (org: CreatedOrg, owner: Record<string, string>, name: string, code: string | null, percent: number) => {
    const res = await post(
      `/v1/orgs/${org.org.id}/register/discounts`,
      {
        name,
        code,
        kind: "percent",
        percentBp: percent * 100,
        amountMinor: null,
        startsOn: null,
        endsOn: null,
        maxUses: null,
        forProducts: false,
        allProducts: true,
        productIds: [],
        forMemberships: true,
        allMembershipTypes: true,
        membershipTypeIds: [],
        membershipPayments: "first",
      },
      owner,
    );
    expect(res.statusCode).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_discounts WHERE gym_id = ${org.org.id} AND name = ${name}`;
    if (row === undefined) throw new Error("no discount row");
    return row.id;
  };

  const settingsUrl = (gymId: string) => `/v1/orgs/${gymId}/referral-settings`;
  const memberUrl = (gymId: string) => `/v1/orgs/${gymId}/referral`;
  const inviteUrl = (code: string) => `/v1/public/invites/${code}`;
  const formUrl = (code: string) => `${inviteUrl(code)}/enquiries`;

  const switchOn = async (org: CreatedOrg, owner: Record<string, string>, memberDiscountId: string | null, friendDiscountId: string | null) => {
    const res = await put(settingsUrl(org.org.id), { on: true, memberDiscountId, friendDiscountId }, owner);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { settings: ReferralSettings }).settings;
  };

  const linkOf = async (org: CreatedOrg, person: Person): Promise<string> => {
    const res = await get(memberUrl(org.org.id), person.cookies);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as MemberReferralResponse;
    if (body.status !== "on") throw new Error("the offer is off");
    return body.path.replace("/invite/", "");
  };

  const enquiry = (over: Record<string, unknown> = {}) => ({
    fullName: "Asha Rao",
    email: "asha.rao@example.com",
    message: "Do you have evening classes?",
    robotToken: "ok-token",
    ...over,
  });

  const storedLeads = async (gymId: string) =>
    await sql<{ id: string; full_name: string; email: string | null; source: string; referred_by: string | null; referred: boolean }[]>`
      SELECT id, full_name, email::text AS email, source, referred_by::text AS referred_by, (referred_at IS NOT NULL) AS referred
      FROM gym_leads WHERE gym_id = ${gymId} ORDER BY created_at, id`;

  let ownerA: Person;
  let ownerB: Person;
  let maya: Person;
  let ravi: Person;
  let stranger: Person;
  let gymA: CreatedOrg;
  let gymB: CreatedOrg;
  let thanksA: string;
  let welcomeA: string;
  let thanksB: string;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const deps = {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
      robotCheck,
    };
    app = await buildApp(loadConfig(baseEnv), deps);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), deps);
    await second.ready();

    ownerA = await makeUser("owner-a", "Owner A");
    ownerB = await makeUser("owner-b", "Owner B");
    maya = await makeUser("maya", "Maya Patel");
    ravi = await makeUser("ravi", "Ravi Kumar");
    stranger = await makeUser("stranger", "Stranger");
    gymA = await makeOrg(ownerA.cookies, "Northside Refer A");
    gymB = await makeOrg(ownerB.cookies, "Southside Refer B");
    await join(gymA, ownerA.cookies, maya);
    await join(gymB, ownerB.cookies, maya);
    await join(gymA, ownerA.cookies, ravi);
    thanksA = await discount(gymA, ownerA.cookies, "Thank you", "THANKSA", 10);
    welcomeA = await discount(gymA, ownerA.cookies, "Welcome", "WELCOMEA", 20);
    thanksB = await discount(gymB, ownerB.cookies, "Thank you B", "THANKSB", 15);
    await switchOn(gymA, ownerA.cookies, thanksA, welcomeA);
    await switchOn(gymB, ownerB.cookies, thanksB, null);
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  describe("the worst thing: a lead or a gift credited to the wrong person, or a member named to a stranger", () => {
    it(
      "one member of two businesses has two links, and each brings its lead to its own business alone, marked as theirs",
      async () => {
        const codeA = await linkOf(gymA, maya);
        const codeB = await linkOf(gymB, maya);
        expect(codeA).not.toBe(codeB);

        const sent = await post(formUrl(codeA), enquiry({ fullName: "Tara Friend", email: "tara.friend@example.com" }));
        expect(sent.statusCode).toBe(202);
        const a = await storedLeads(gymA.org.id);
        expect(a).toEqual([
          { id: expect.any(String) as unknown, full_name: "Tara Friend", email: "tara.friend@example.com", source: "friend", referred_by: maya.id, referred: true },
        ]);
        expect(await storedLeads(gymB.org.id)).toEqual([]);

        // B's link brings B's lead, marked as Maya's, and A's leads are untouched.
        expect((await post(formUrl(codeB), enquiry({ fullName: "Omar B", email: "omar.b@example.com" }))).statusCode).toBe(202);
        const b = await storedLeads(gymB.org.id);
        expect(b.map((l) => [l.full_name, l.referred_by])).toEqual([["Omar B", maya.id]]);
        expect((await storedLeads(gymA.org.id)).length).toBe(1);
      },
      TIMEOUT_MS,
    );

    it(
      "the invite page names the business and its own gift, and nothing of the member who sent it",
      async () => {
        const codeA = await linkOf(gymA, maya);
        const res = await get(inviteUrl(codeA));
        expect(res.statusCode).toBe(200);
        const invite = (JSON.parse(res.body) as { invite: PublicInvite }).invite;
        expect(invite.gymName).toBe("Northside Refer A");
        expect(invite.friendGift).toEqual({ code: "WELCOMEA", words: "20% off the first payment of a membership" });
        // B's gift is never on A's page, and the member's own gift (her code) is not shown to a stranger.
        expect(res.body).not.toContain("THANKSB");
        expect(res.body).not.toContain("THANKSA");
        expect(res.body).not.toContain("Maya");
        expect(res.body).not.toContain(maya.email);
        expect(res.body).not.toContain(maya.id);
      },
      TIMEOUT_MS,
    );

    it(
      "a made-up link, a malformed one, and one whose member has left are each refused, and write nothing",
      async () => {
        const raviCode = await linkOf(gymA, ravi);
        const before = (await storedLeads(gymA.org.id)).length;
        const madeUp = "abcdefghijklmnop";
        expect(madeUp).not.toBe(raviCode);
        for (const code of [madeUp, "ABCDEFGHIJKLMNOP", "short", `${raviCode}x`]) {
          expect((await get(inviteUrl(code))).statusCode).toBe(404);
          expect((await post(formUrl(code), enquiry({ email: `nobody.${code}@example.com` }))).statusCode).toBe(404);
        }
        // Ravi leaves: his link stops working at once, and the form writes nothing.
        await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gymA.org.id} AND user_id = ${ravi.id} AND removed_at IS NULL`;
        expect((await get(inviteUrl(raviCode))).statusCode).toBe(404);
        expect((await post(formUrl(raviCode), enquiry({ fullName: "After Ravi", email: "after.ravi@example.com" }))).statusCode).toBe(404);
        expect((await storedLeads(gymA.org.id)).length).toBe(before);
        // …and he cannot ask for his link any more.
        expect((await get(memberUrl(gymA.org.id), ravi.cookies)).statusCode).toBe(404);
        await sql`
          INSERT INTO gym_members (gym_id, user_id) VALUES (${gymA.org.id}, ${ravi.id})`;
      },
      TIMEOUT_MS,
    );

    it(
      "somebody already in Leads is never marked as a friend's, and a member's own email through their own link is not their friend",
      async () => {
        const codeA = await linkOf(gymA, maya);
        // Already a lead, added by staff before the link was used.
        const added = await post(`/v1/orgs/${gymA.org.id}/leads`, { fullName: "Old Lead", email: "old.lead@example.com", source: "walk_in" }, ownerA.cookies);
        expect(added.statusCode).toBe(201);
        expect((await post(formUrl(codeA), enquiry({ fullName: "Old Lead", email: "old.lead@example.com" }))).statusCode).toBe(202);
        const old = (await storedLeads(gymA.org.id)).find((l) => l.email === "old.lead@example.com");
        expect(old).toMatchObject({ source: "walk_in", referred_by: null, referred: false });

        // Maya fills her own link with her own address: a lead, and not her friend.
        expect((await post(formUrl(codeA), enquiry({ fullName: "Maya Patel", email: maya.email.toUpperCase() }))).statusCode).toBe(202);
        const own = (await storedLeads(gymA.org.id)).find((l) => l.email === maya.email);
        expect(own).toMatchObject({ source: "friend", referred_by: null, referred: false });
      },
      TIMEOUT_MS,
    );

    it(
      "switched off, every link is refused; a business on no plan, or closed, likewise",
      async () => {
        const codeA = await linkOf(gymA, maya);
        expect((await put(settingsUrl(gymA.org.id), { on: false, memberDiscountId: thanksA, friendDiscountId: welcomeA }, ownerA.cookies)).statusCode).toBe(200);
        expect((await get(inviteUrl(codeA))).statusCode).toBe(404);
        expect((await post(formUrl(codeA), enquiry({ email: "while.off@example.com" }))).statusCode).toBe(404);
        const member = JSON.parse((await get(memberUrl(gymA.org.id), maya.cookies)).body) as MemberReferralResponse;
        expect(member).toEqual({ status: "off", gymName: "Northside Refer A" });
        await switchOn(gymA, ownerA.cookies, thanksA, welcomeA);

        await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gymA.org.id}`;
        expect((await get(inviteUrl(codeA))).statusCode).toBe(404);
        expect((await post(formUrl(codeA), enquiry({ email: "no.plan@example.com" }))).statusCode).toBe(404);
        await sql`UPDATE subscriptions SET status = 'trialing' WHERE owner_type = 'gym' AND owner_id = ${gymA.org.id}`;
        expect((await storedLeads(gymA.org.id)).some((l) => l.email === "while.off@example.com" || l.email === "no.plan@example.com")).toBe(false);
      },
      TIMEOUT_MS,
    );
  });

  describe("who may read and set it", () => {
    it(
      "a stranger, another business's owner and a member are refused the settings; a stranger is refused a link",
      async () => {
        for (const who of [stranger, ownerB, maya]) {
          const res = await get(settingsUrl(gymA.org.id), who.cookies);
          expect([403, 404]).toContain(res.statusCode);
          const saved = await put(settingsUrl(gymA.org.id), { on: false, memberDiscountId: null, friendDiscountId: null }, who.cookies);
          expect([403, 404]).toContain(saved.statusCode);
        }
        expect((await get(memberUrl(gymA.org.id), stranger.cookies)).statusCode).toBe(404);
        expect((await get(memberUrl(gymA.org.id), ownerB.cookies)).statusCode).toBe(404);
        expect((await get(memberUrl(gymA.org.id))).statusCode).toBe(401);
        const [settings] = await sql<{ switched_on: boolean }[]>`SELECT switched_on FROM gym_referral_settings WHERE gym_id = ${gymA.org.id}`;
        expect(settings?.switched_on).toBe(true);
      },
      TIMEOUT_MS,
    );

    it(
      "a body the schema refuses is a 400, and switching on with no gift is refused",
      async () => {
        expect((await put(settingsUrl(gymA.org.id), { on: true, memberDiscountId: "not-a-uuid", friendDiscountId: null }, ownerA.cookies)).statusCode).toBe(400);
        expect((await put(settingsUrl(gymA.org.id), { on: true, memberDiscountId: null, friendDiscountId: null }, ownerA.cookies)).statusCode).toBe(400);
        expect((await put(settingsUrl(gymA.org.id), { on: true, memberDiscountId: thanksA, friendDiscountId: null, extra: 1 }, ownerA.cookies)).statusCode).toBe(400);
      },
      TIMEOUT_MS,
    );

    it(
      "another business's discount, one with no promo code, an ended one and an archived one are refused; one starting later is taken and not promised",
      async () => {
        expect((await put(settingsUrl(gymA.org.id), { on: true, memberDiscountId: thanksB, friendDiscountId: null }, ownerA.cookies)).statusCode).toBe(404);
        const noCode = await discount(gymA, ownerA.cookies, "No code", null, 5);
        expect((await put(settingsUrl(gymA.org.id), { on: true, memberDiscountId: noCode, friendDiscountId: null }, ownerA.cookies)).statusCode).toBe(409);
        const ended = await discount(gymA, ownerA.cookies, "Ended", "ENDEDA", 5);
        await sql`UPDATE gym_discounts SET starts_on = '2020-01-01', ends_on = '2020-01-31' WHERE id = ${ended}`;
        expect((await put(settingsUrl(gymA.org.id), { on: true, memberDiscountId: ended, friendDiscountId: null }, ownerA.cookies)).statusCode).toBe(409);
        const archived = await discount(gymA, ownerA.cookies, "Archived", "ARCHA", 5);
        await sql`UPDATE gym_discounts SET archived_at = now() WHERE id = ${archived}`;
        expect((await put(settingsUrl(gymA.org.id), { on: true, memberDiscountId: archived, friendDiscountId: null }, ownerA.cookies)).statusCode).toBe(409);

        const later = await discount(gymA, ownerA.cookies, "Later", "LATERA", 5);
        await sql`UPDATE gym_discounts SET starts_on = '2099-01-01' WHERE id = ${later}`;
        const saved = await switchOn(gymA, ownerA.cookies, thanksA, later);
        expect(saved.discounts.find((x) => x.id === later)?.problem).toBe("It starts on 1 January 2099.");
        const codeA = await linkOf(gymA, maya);
        const invite = (JSON.parse((await get(inviteUrl(codeA))).body) as { invite: PublicInvite }).invite;
        expect(invite.friendGift).toBeNull();
        expect(JSON.stringify(invite)).not.toContain("LATERA");

        // Whatever was refused, the stored offer is the last one saved.
        const [row] = await sql<{ member_discount_id: string | null; friend_discount_id: string | null }[]>`
          SELECT member_discount_id, friend_discount_id FROM gym_referral_settings WHERE gym_id = ${gymA.org.id}`;
        expect(row).toEqual({ member_discount_id: thanksA, friend_discount_id: later });
        await switchOn(gymA, ownerA.cookies, thanksA, welcomeA);
      },
      TIMEOUT_MS,
    );
  });

  describe("the member's link and what they are told", () => {
    it(
      "asked twice at once on two servers, the member gets one link",
      async () => {
        const fresh = await makeUser("asha", "Asha Two");
        await join(gymA, ownerA.cookies, fresh);
        const [one, two] = await Promise.all([get(memberUrl(gymA.org.id), fresh.cookies), get(memberUrl(gymA.org.id), fresh.cookies, second)]);
        expect(one.statusCode).toBe(200);
        expect(two.statusCode).toBe(200);
        const a = JSON.parse(one.body) as MemberReferralResponse;
        const b = JSON.parse(two.body) as MemberReferralResponse;
        expect(a.status === "on" && b.status === "on" && a.path === b.path).toBe(true);
        const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_referral_links WHERE gym_id = ${gymA.org.id} AND user_id = ${fresh.id}`;
        expect(count?.n).toBe(1);
      },
      TIMEOUT_MS,
    );

    it(
      "the offer says both gifts, that the business set it, and never the member's own code",
      async () => {
        const res = await get(memberUrl(gymA.org.id), maya.cookies);
        const body = JSON.parse(res.body) as MemberReferralResponse;
        expect(body).toMatchObject({
          status: "on",
          gymName: "Northside Refer A",
          memberGift: "10% off the first payment of a membership",
          friendGift: "20% off the first payment of a membership",
          lines: [
            "When a friend you invite joins Northside Refer A and makes their first payment, you get 10% off the first payment of a membership. We'll send your code to your inbox.",
            "Your friend gets 20% off the first payment of a membership when they join.",
            "This offer is set by Northside Refer A and may change.",
          ],
        });
        expect(res.body).not.toContain("THANKSA");
      },
      TIMEOUT_MS,
    );
  });

  describe("Leads", () => {
    it(
      "the lead reads who invited them, and still does after Joined; one whose member left says so",
      async () => {
        const list = await get(`/v1/orgs/${gymA.org.id}/leads`, ownerA.cookies);
        expect(list.statusCode).toBe(200);
        const leads = (JSON.parse(list.body) as { leads: Lead[] }).leads;
        const tara = leads.find((l) => l.fullName === "Tara Friend");
        expect(tara?.invitedBy).toEqual({ name: "Maya Patel", member: true });
        expect(leads.find((l) => l.fullName === "Old Lead")?.invitedBy).toBeNull();
        if (tara === undefined) throw new Error("no lead");

        const joined = await post(`/v1/orgs/${gymA.org.id}/leads/${tara.id}/join`, {}, ownerA.cookies);
        expect(joined.statusCode).toBe(200);
        expect((JSON.parse(joined.body) as { lead: Lead }).lead.invitedBy).toEqual({ name: "Maya Patel", member: true });

        await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gymA.org.id} AND user_id = ${maya.id} AND removed_at IS NULL`;
        const one = await get(`/v1/orgs/${gymA.org.id}/leads/${tara.id}`, ownerA.cookies);
        expect((JSON.parse(one.body) as { lead: Lead }).lead.invitedBy).toEqual({ name: "Maya Patel", member: false });
        // B's leads read Maya as B's member still: her leaving A changes only A.
        const bLeads = (JSON.parse((await get(`/v1/orgs/${gymB.org.id}/leads`, ownerB.cookies)).body) as { leads: Lead[] }).leads;
        expect(bLeads.find((l) => l.fullName === "Omar B")?.invitedBy).toEqual({ name: "Maya Patel", member: true });
        await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymA.org.id}, ${maya.id})`;
      },
      TIMEOUT_MS,
    );

    it(
      "a business without its own page still has the invite page; with one, the invite links to it",
      async () => {
        const codeA = await linkOf(gymA, maya);
        const off = (JSON.parse((await get(inviteUrl(codeA))).body) as { invite: PublicInvite }).invite;
        expect(off.pageSlug).toBeNull();
        expect((await put(`/v1/orgs/${gymA.org.id}/page`, { shown: true, about: "", facilities: [], ownFacilities: [] }, ownerA.cookies)).statusCode).toBe(200);
        const on = (JSON.parse((await get(inviteUrl(codeA))).body) as { invite: PublicInvite }).invite;
        expect(on.pageSlug).toBe(gymA.org.slug);
      },
      TIMEOUT_MS,
    );
  });
});
