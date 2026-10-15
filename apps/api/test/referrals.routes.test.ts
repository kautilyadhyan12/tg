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
import { takeEnquiry } from "../src/modules/orgs/gymPage/service.js";
import { createMemoryRedis } from "../src/redis.js";
import { REFERRAL_WORDS, type Lead, type MemberReferralResponse, type PublicInvite, type ReferralSettings } from "@app/shared";

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
  /** One Redis for both servers, so a limit can be counted into before a request. */
  const redis = createMemoryRedis();
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

  type Gift = { kind: "percent" | "amount"; percentBp: number | null; amountMinor: number | null; on: "first" | "every" | "products" };
  const pct = (n: number, on: Gift["on"] = "first"): Gift => ({ kind: "percent", percentBp: n * 100, amountMinor: null, on });
  /** The member's gift: a percentage off their next payment. */
  type MemberGift = { kind: "percent" | "amount"; percentBp: number | null; amountMinor: number | null };
  const mine = (n: number): MemberGift => ({ kind: "percent", percentBp: n * 100, amountMinor: null });
  const switchOn = async (org: CreatedOrg, owner: Record<string, string>, member: MemberGift | null, friend: Gift | null) => {
    const res = await put(settingsUrl(org.org.id), { on: true, member, friend }, owner);
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
      redis,
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
    // B's owner already has a code of their own that the app would have picked.
    await discount(gymB, ownerB.cookies, "Our own", "WELCOME15", 5);
    await switchOn(gymA, ownerA.cookies, mine(10), pct(20));
    await switchOn(gymB, ownerB.cookies, mine(15), pct(15));
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
      "the invite page names the business, its own gift and the member's first name, and nothing more of them",
      async () => {
        const codeA = await linkOf(gymA, maya);
        const res = await get(inviteUrl(codeA));
        expect(res.statusCode).toBe(200);
        const invite = (JSON.parse(res.body) as { invite: PublicInvite }).invite;
        expect(invite.gymName).toBe("Northside Refer A");
        // The gift's words, never its code: the business adds it when they join.
        expect(invite.friendGift).toEqual({ words: "20% off the first payment of a membership" });
        expect(res.body).not.toContain("WELCOME20");
        // Her first name (Kd, 2026-10-15), and nothing more: not her surname, email or id.
        expect(invite.inviterFirstName).toBe("Maya");
        expect(res.body).not.toContain("Patel");
        expect(res.body).not.toContain(maya.email);
        // B's gift is never on A's page.
        expect(res.body).not.toContain("WELCOME15");
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
      "the invite form takes no message without an email address, and keeps nothing",
      async () => {
        const codeA = await linkOf(gymA, maya);
        const before = (await storedLeads(gymA.org.id)).length;
        const noEmail = { fullName: "Phone Only", phone: "+447700900123", robotToken: "ok-token" };
        expect((await post(formUrl(codeA), noEmail)).statusCode).toBe(400);
        expect((await post(formUrl(codeA), { ...noEmail, email: "   " })).statusCode).toBe(400);
        expect((await storedLeads(gymA.org.id)).length).toBe(before);
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
        expect((await put(settingsUrl(gymA.org.id), { on: false, member: mine(10), friend: pct(20) }, ownerA.cookies)).statusCode).toBe(200);
        expect((await get(inviteUrl(codeA))).statusCode).toBe(404);
        expect((await post(formUrl(codeA), enquiry({ email: "while.off@example.com" }))).statusCode).toBe(404);
        const member = JSON.parse((await get(memberUrl(gymA.org.id), maya.cookies)).body) as MemberReferralResponse;
        expect(member).toEqual({ status: "off", gymName: "Northside Refer A" });
        await switchOn(gymA, ownerA.cookies, mine(10), pct(20));

        await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gymA.org.id}`;
        expect((await get(inviteUrl(codeA))).statusCode).toBe(404);
        expect((await post(formUrl(codeA), enquiry({ email: "no.plan@example.com" }))).statusCode).toBe(404);
        await sql`UPDATE subscriptions SET status = 'trialing' WHERE owner_type = 'gym' AND owner_id = ${gymA.org.id}`;
        expect((await storedLeads(gymA.org.id)).some((l) => l.email === "while.off@example.com" || l.email === "no.plan@example.com")).toBe(false);
      },
      TIMEOUT_MS,
    );
    it(
      "two accounts on one list record: each link shows its own member's first name, and Leads credits the member the database holds (round one, H1)",
      async () => {
        const rajesh = await makeUser("rajesh", "Rajesh Kumar");
        const priya = await makeUser("priya", "Priya Sharma");
        await join(gymA, ownerA.cookies, rajesh);
        await join(gymA, ownerA.cookies, priya);
        // The console's join of two records leaves both accounts on one record: written here
        // as that merge leaves it.
        const [entry] = await sql<{ id: string }[]>`
          INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
          VALUES (${gymA.org.id}, 'Rajesh Kumar', ${rajesh.email}, encode(sha256(${`h1-${rajesh.id}`}::bytea), 'hex'), 'typed') RETURNING id`;
        await sql`UPDATE gym_members SET entry_id = ${entry?.id ?? null} WHERE gym_id = ${gymA.org.id} AND user_id IN (${rajesh.id}, ${priya.id}) AND removed_at IS NULL`;

        const own = JSON.parse((await get(memberUrl(gymA.org.id), priya.cookies)).body) as MemberReferralResponse;
        expect(own.status === "on" && own.lines.includes("Your link shows your first name, Priya, to whoever opens it.")).toBe(true);
        const code = await linkOf(gymA, priya);
        const invite = (JSON.parse((await get(inviteUrl(code))).body) as { invite: PublicInvite }).invite;
        expect(invite.inviterFirstName).toBe("Priya");
        expect((await post(formUrl(code), enquiry({ fullName: "Priya's Friend", email: "priyas.friend@example.com" }))).statusCode).toBe(202);
        const leads = (JSON.parse((await get(`/v1/orgs/${gymA.org.id}/leads`, ownerA.cookies)).body) as { leads: Lead[] }).leads;
        expect(leads.find((l) => l.fullName === "Priya's Friend")?.invitedBy).toEqual({ name: "Priya Sharma", member: true });

        // A record that is one member's alone is what Leads calls them by; the invite page
        // still says only the first name they use in the app.
        const anil = await makeUser("anil", "Anil");
        await join(gymA, ownerA.cookies, anil);
        const [own2] = await sql<{ id: string }[]>`
          INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
          VALUES (${gymA.org.id}, 'Anil Mehta', ${anil.email}, encode(sha256(${`h1-${anil.id}`}::bytea), 'hex'), 'typed') RETURNING id`;
        await sql`UPDATE gym_members SET entry_id = ${own2?.id ?? null} WHERE gym_id = ${gymA.org.id} AND user_id = ${anil.id} AND removed_at IS NULL`;
        const anilCode = await linkOf(gymA, anil);
        expect(((JSON.parse((await get(inviteUrl(anilCode))).body) as { invite: PublicInvite }).invite).inviterFirstName).toBe("Anil");
        expect((await post(formUrl(anilCode), enquiry({ fullName: "Anil's Friend", email: "anils.friend@example.com" }))).statusCode).toBe(202);
        const after = (JSON.parse((await get(`/v1/orgs/${gymA.org.id}/leads`, ownerA.cookies)).body) as { leads: Lead[] }).leads;
        expect(after.find((l) => l.fullName === "Anil's Friend")?.invitedBy).toEqual({ name: "Anil Mehta", member: true });
      },
      TIMEOUT_MS,
    );

    it(
      "at one shared address, one link opened past its allowance closes only that link's page; other businesses' pages and every form stay open (round one, H3)",
      async () => {
        const shared = "10.99.0.1";
        const codeA = await linkOf(gymA, maya);
        const codeB = await linkOf(gymB, maya);
        const at = (method: "GET" | "POST", path: string, payload?: unknown) =>
          api().inject({ method, url: path, remoteAddress: shared, ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }) });
        // Counted into the limit's own key, not looped: the app's floor answers a loop first.
        for (let i = 0; i < 600; i += 1) await redis.incrWithTtl(`rl:referral_invite_read:id:${codeA}:${shared}`, 3600);
        expect((await at("GET", inviteUrl(codeA))).statusCode).toBe(429);
        expect((await at("GET", inviteUrl(codeB))).statusCode).toBe(200);
        expect((await at("POST", formUrl(codeB), enquiry({ fullName: "Shared One", email: "shared.one@example.com" }))).statusCode).toBe(202);
        // The form never spends the page's allowance: A's friend can still send it from there.
        expect((await at("POST", formUrl(codeA), enquiry({ fullName: "Shared Two", email: "shared.two@example.com" }))).statusCode).toBe(202);
        const names = (await storedLeads(gymA.org.id)).map((l) => l.full_name);
        expect(names).toContain("Shared Two");
      },
      TIMEOUT_MS,
    );

    it(
      "the write's own transaction asks again: a member who left after their link was read marks nobody (round one, tests)",
      async () => {
        const gone = await makeUser("gone", "Gone Member");
        await join(gymA, ownerA.cookies, gone);
        await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gymA.org.id} AND user_id = ${gone.id} AND removed_at IS NULL`;
        const [gym] = await sql<{ country: string | null; timezone: string }[]>`SELECT country, timezone FROM gyms WHERE id = ${gymA.org.id}`;
        // The link was read while they were a member: the form's own `find` answers them as
        // the inviter, and only the transaction can tell they have left.
        const passes = () => Promise.resolve(true);
        const done = await takeEnquiry(
          {
            sql,
            now: () => new Date(),
            robotCheck,
            photos: { put: () => Promise.resolve(), get: () => Promise.resolve(null), remove: () => Promise.resolve(false) },
            log: { warn: () => undefined },
            addressKey: null,
          },
          { fullName: "Late Friend", email: "late.friend@example.com", robotToken: "ok-token" },
          { robotRoom: passes, robotFailed: () => Promise.resolve(), address: passes, page: passes },
          () => Promise.resolve({ gymId: gymA.org.id, country: gym?.country ?? null, timezone: gym?.timezone ?? "UTC", referrerId: gone.id }),
        );
        expect(done).toBe("received");
        const late = (await storedLeads(gymA.org.id)).find((l) => l.email === "late.friend@example.com");
        expect(late).toMatchObject({ source: "friend", referred_by: null, referred: false });
      },
      TIMEOUT_MS,
    );

    it(
      "a member's own phone, or their own email with a +tag, through their own link is not their friend",
      async () => {
        const codeA = await linkOf(gymA, maya);
        await sql`UPDATE gym_members SET stated_phone_e164 = '+447700900777' WHERE gym_id = ${gymA.org.id} AND user_id = ${maya.id} AND removed_at IS NULL`;
        expect((await post(formUrl(codeA), enquiry({ fullName: "Maya Again", email: "someone.else@example.com", phone: "07700 900777" }))).statusCode).toBe(202);
        const byPhone = (await storedLeads(gymA.org.id)).find((l) => l.email === "someone.else@example.com");
        expect(byPhone).toMatchObject({ referred_by: null, referred: false });

        const tagged = maya.email.replace("@", "+gym@");
        expect((await post(formUrl(codeA), enquiry({ fullName: "Maya Tagged", email: tagged }))).statusCode).toBe(202);
        const byTag = (await storedLeads(gymA.org.id)).find((l) => l.email === tagged);
        expect(byTag).toMatchObject({ referred_by: null, referred: false });
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
          const saved = await put(settingsUrl(gymA.org.id), { on: false, member: null, friend: null }, who.cookies);
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
        const refused = [
          { on: true, member: null, friend: null },
          { on: true, member: { ...mine(10), amountMinor: 500 }, friend: null },
          { on: true, member: { ...mine(10), percentBp: 10000 }, friend: null },
          // The member's gift is off their next payment: it takes no "off what".
          { on: true, member: pct(10), friend: null },
          { on: true, member: null, friend: { ...pct(10), on: "everything" } },
          { on: true, member: mine(10), friend: null, extra: 1 },
          { on: true, memberDiscountId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff", friend: null },
        ];
        for (const body of refused) expect((await put(settingsUrl(gymA.org.id), body, ownerA.cookies)).statusCode, JSON.stringify(body)).toBe(400);
      },
      TIMEOUT_MS,
    );

    it(
      "the friend's promo code is the app's own; the member's gift is kept with no code; saved again nothing new is made, and the gym's own codes never clash",
      async () => {
        const before = await sql<{ id: string; name: string; code: string }[]>`
          SELECT id, name, code FROM gym_discounts WHERE gym_id = ${gymA.org.id} AND archived_at IS NULL ORDER BY code`;
        expect(before.map((d) => [d.code, d.name])).toEqual([["WELCOME20", "Refer a friend: friend's gift, WELCOME20"]]);
        const [kept] = await sql<{ kind: string; bp: number }[]>`
          SELECT member_gift_kind AS kind, member_percent_bp AS bp FROM gym_referral_settings WHERE gym_id = ${gymA.org.id}`;
        expect(kept).toEqual({ kind: "percent", bp: 1000 });
        const again = await switchOn(gymA, ownerA.cookies, mine(10), pct(20));
        expect(again.member).toMatchObject({ words: "10% off your next payment" });
        expect(again.friend?.code).toBe("WELCOME20");
        const after = await sql<{ id: string }[]>`SELECT id FROM gym_discounts WHERE gym_id = ${gymA.org.id} AND archived_at IS NULL ORDER BY code`;
        expect(after.map((d) => d.id)).toEqual(before.map((d) => d.id));
        // B already had its own WELCOME15, so B's gift got the next free one; A's codes are A's.
        const b = await sql<{ code: string }[]>`SELECT code FROM gym_discounts WHERE gym_id = ${gymB.org.id} AND archived_at IS NULL ORDER BY code`;
        expect(b.map((d) => d.code)).toEqual(["WELCOME15", "WELCOME15B"]);
      },
      TIMEOUT_MS,
    );

    it(
      "a changed friend's gift nobody has used changes its code; one somebody has used is archived (round one, H2), and the new gift gets its own",
      async () => {
        const [first] = await sql<{ friend_discount_id: string }[]>`SELECT friend_discount_id FROM gym_referral_settings WHERE gym_id = ${gymA.org.id}`;
        const changed = await switchOn(gymA, ownerA.cookies, mine(10), pct(25, "every"));
        expect(changed.friend).toMatchObject({ code: "WELCOME25", words: "25% off every payment of a membership" });
        const [same] = await sql<{ friend_discount_id: string }[]>`SELECT friend_discount_id FROM gym_referral_settings WHERE gym_id = ${gymA.org.id}`;
        expect(same?.friend_discount_id).toBe(first?.friend_discount_id);
        expect(await sql`SELECT 1 FROM gym_discounts WHERE gym_id = ${gymA.org.id} AND code = 'WELCOME20'`).toHaveLength(0);

        // Somebody used WELCOME25 at the desk: changing the gift archives it, so it takes nothing
        // off any more; its sale keeps what it was sold at.
        await sql`UPDATE gym_discounts SET uses = 1 WHERE id = ${same?.friend_discount_id ?? ""}`;
        const moved = await switchOn(gymA, ownerA.cookies, mine(10), pct(20));
        expect(moved.friend?.code).toBe("WELCOME20");
        const kept = await sql<{ code: string; percent_bp: number; archived: boolean }[]>`
          SELECT code, percent_bp, archived_at IS NOT NULL AS archived FROM gym_discounts WHERE id = ${same?.friend_discount_id ?? ""}`;
        expect(kept).toEqual([{ code: "WELCOME25", percent_bp: 2500, archived: true }]);
        // Used, and then no gift at all: archived too, and the box and the Discounts list agree.
        const [now] = await sql<{ friend_discount_id: string }[]>`SELECT friend_discount_id FROM gym_referral_settings WHERE gym_id = ${gymA.org.id}`;
        await sql`UPDATE gym_discounts SET uses = 1 WHERE id = ${now?.friend_discount_id ?? ""}`;
        const none = await put(settingsUrl(gymA.org.id), { on: false, member: null, friend: null }, ownerA.cookies);
        expect((JSON.parse(none.body) as { settings: ReferralSettings }).settings.friend).toBeNull();
        expect(await sql`SELECT 1 FROM gym_discounts WHERE gym_id = ${gymA.org.id} AND archived_at IS NULL AND name LIKE 'Refer a friend:%'`).toHaveLength(0);
        await switchOn(gymA, ownerA.cookies, mine(10), pct(20));
      },
      TIMEOUT_MS,
    );

    it(
      "No gift archives the code; an amount needs the gym's country; a code never shows a number the gift is not; a code archived under Discounts is promised to nobody until saved again",
      async () => {
        const off = await put(settingsUrl(gymA.org.id), { on: true, member: mine(10), friend: null }, ownerA.cookies);
        expect(off.statusCode).toBe(200);
        expect(await sql`SELECT 1 FROM gym_discounts WHERE gym_id = ${gymA.org.id} AND code = 'WELCOME20' AND archived_at IS NULL`).toHaveLength(0);
        await switchOn(gymA, ownerA.cookies, mine(10), pct(20));

        await sql`UPDATE gyms SET country = NULL WHERE id = ${gymA.org.id}`;
        for (const body of [
          { on: true, member: { kind: "amount", percentBp: null, amountMinor: 500 }, friend: pct(20) },
          { on: true, member: mine(10), friend: { kind: "amount", percentBp: null, amountMinor: 500, on: "products" } },
        ]) {
          const noMoney = await put(settingsUrl(gymA.org.id), body, ownerA.cookies);
          expect(noMoney.statusCode).toBe(409);
          expect((JSON.parse(noMoney.body) as { message: string }).message).toBe(REFERRAL_WORDS.no_currency);
        }
        await sql`UPDATE gyms SET country = 'GB' WHERE id = ${gymA.org.id}`;
        const pounds = await switchOn(gymA, ownerA.cookies, { kind: "amount", percentBp: null, amountMinor: 500 }, { kind: "amount", percentBp: null, amountMinor: 500, on: "products" });
        expect(pounds.member).toMatchObject({ words: "£5.00 off your next payment", currency: "GBP" });
        expect(pounds.friend).toMatchObject({ code: "WELCOME5", words: "£5.00 off products" });
        // 12.5% and £5.50 are not whole: the code says no number rather than a wrong one (L2).
        const half = await switchOn(gymA, ownerA.cookies, mine(10), pct(12.5));
        expect(half.friend).toMatchObject({ code: "WELCOME", words: "12.5% off the first payment of a membership" });
        const pence = await switchOn(gymA, ownerA.cookies, mine(10), { kind: "amount", percentBp: null, amountMinor: 550, on: "products" });
        expect(pence.friend).toMatchObject({ code: "WELCOME", words: "£5.50 off products" });
        await switchOn(gymA, ownerA.cookies, mine(10), pct(20));

        // The owner archives the friend's code under Discounts: nobody is promised it.
        await sql`UPDATE gym_discounts SET archived_at = now() WHERE gym_id = ${gymA.org.id} AND code = 'WELCOME20'`;
        const codeA = await linkOf(gymA, maya);
        const invite = (JSON.parse((await get(inviteUrl(codeA))).body) as { invite: PublicInvite }).invite;
        expect(invite.friendGift).toBeNull();
        const read = (JSON.parse((await get(settingsUrl(gymA.org.id), ownerA.cookies)).body) as { settings: ReferralSettings }).settings;
        expect(read.friend?.problem).toBe("It was archived.");
        // Saved again, it gets a new code, and is promised again.
        const fresh = await switchOn(gymA, ownerA.cookies, mine(10), pct(20));
        expect(fresh.friend).toMatchObject({ code: "WELCOME20", problem: null });
      },
      TIMEOUT_MS,
    );

    it(
      "two saves at the same instant on two servers make one code for the friend's gift, never two",
      async () => {
        const gym = await makeOrg(ownerB.cookies, "Race Refer C");
        const body = { on: true, member: mine(30), friend: pct(25) };
        const [one, two] = await Promise.all([
          send(api(), "PUT", settingsUrl(gym.org.id), body, ownerB.cookies),
          send(second ?? api(), "PUT", settingsUrl(gym.org.id), body, ownerB.cookies),
        ]);
        expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
        const made = await sql<{ code: string }[]>`SELECT code FROM gym_discounts WHERE gym_id = ${gym.org.id} ORDER BY code`;
        expect(made.map((d) => d.code)).toEqual(["WELCOME25"]);
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
      "the offer says both gifts, the first name their link shows, and that the business set it",
      async () => {
        const res = await get(memberUrl(gymA.org.id), maya.cookies);
        const body = JSON.parse(res.body) as MemberReferralResponse;
        expect(body).toMatchObject({
          status: "on",
          gymName: "Northside Refer A",
          memberGift: "10% off your next payment",
          friendGift: "20% off the first payment of a membership",
          lines: [
            "When a friend you invite joins Northside Refer A and makes their first payment, you get 10% off your next payment. It comes off by itself, and we'll tell you in your inbox.",
            "Your friend gets 20% off the first payment of a membership when they join.",
            "Your link shows your first name, Maya, to whoever opens it.",
            "This offer is set by Northside Refer A and may change.",
          ],
        });
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
