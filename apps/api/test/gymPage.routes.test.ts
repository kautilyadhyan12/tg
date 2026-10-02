// A gym's own page and its enquiry form — routes against real Postgres (DATABASE_URL-
// gated). ROADMAP 20c-iv-a; spec Part 3 §16.3.
//
// The first block is the worst thing this job could do to a real person: an enquiry
// kept on another gym's leads, or the form telling a stranger who a gym already has.
// Every claim is checked against the database, never against a reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { RobotCheck, RobotCheckAnswer } from "../src/modules/orgs/gymPage/robotCheck.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { enquiriesFor } from "../src/modules/orgs/leads/repo.js";
import { GYM_ENQUIRIES_KEPT_PER_LEAD, ROLE_PRIVILEGES, type GymPage, type Lead, type LeadEnquiry, type PublicGymPage } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-page-routes-secret-0123456789a", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // The join door is a fixture here; join codes are off by default (ROADMAP 3c).
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_gym_page_routes";
/** A name no other gym on a shared database has, so its address is the plain one. */
const TWIN_NAME = `Canal Twin ${Date.now().toString(36)}`;

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** The robot check, answered by the test: "passed" unless a token says otherwise. */
const robotCalls: string[] = [];
const robotAnswers = new Map<string, RobotCheckAnswer>();
const fakeRobotCheck: RobotCheck = {
  siteKey: "test-site-key",
  verify: (token) => {
    robotCalls.push(token);
    return Promise.resolve(robotAnswers.get(token) ?? "passed");
  },
};

d("a gym's own page and its enquiry form (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  /** A second api on the same database: one api holds one connection, so two requests
   *  race only across two of them. */
  let second: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'gpage-t-%@example.com')`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_pages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_closures WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'gpage-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (
    method: "GET" | "POST" | "PUT",
    path: string,
    payload: unknown,
    cookies: Record<string, string>,
    remoteAddress: string = nextIp(),
  ) =>
    api().inject({
      method,
      url: path,
      remoteAddress,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Record<string, string> = {}) => send("GET", path, undefined, cookies);
  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) => send("POST", path, payload, cookies);
  const put = (path: string, payload: unknown, cookies: Record<string, string>) => send("PUT", path, payload, cookies);

  const makeUser = async (local: string) => {
    const email = `gpage-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Page ${local}` });
    expect(reg.statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { email, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const makeOrg = async (cookies: Record<string, string>, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  const makeStaff = async (org: CreatedOrg, owner: Record<string, string>, local: string, role: "manager" | "trainer") => {
    const person = await makeUser(local);
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner)).statusCode).toBe(200);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role }, owner)).statusCode).toBe(201);
    return person;
  };

  const pageUrl = (gymId: string) => `/v1/orgs/${gymId}/page`;
  const publicUrl = (slug: string) => `/v1/public/gyms/${slug}`;
  const formUrl = (slug: string) => `${publicUrl(slug)}/enquiries`;
  const PAGE_ON = { shown: true, about: "Friendly gym by the canal.", facilities: ["showers", "free_weights"], ownFacilities: ["Boxing ring"] };

  const switchOn = async (org: CreatedOrg, cookies: Record<string, string>) => {
    const res = await put(pageUrl(org.org.id), PAGE_ON, cookies);
    expect(res.statusCode).toBe(200);
  };

  const enquiry = (over: Record<string, unknown> = {}) => ({
    fullName: "Asha Rao",
    email: "asha.rao@example.com",
    source: "social",
    message: "Do you have evening classes?",
    robotToken: "ok-token",
    ...over,
  });

  const storedLeads = async (gymId: string) =>
    await sql<{ id: string; full_name: string; email: string | null; phone: string | null; status: string; source: string; added_by: string | null; email_ok: boolean; due: string | null }[]>`
      SELECT id, full_name, email::text AS email, phone_e164 AS phone, status, source, added_by::text AS added_by,
             (email_ok_at IS NOT NULL) AS email_ok, follow_up_due_on::text AS due
      FROM gym_leads WHERE gym_id = ${gymId} ORDER BY created_at, id`;
  const storedEnquiries = async (gymId: string) =>
    await sql<{ lead_id: string; full_name: string; email: string | null; message: string; may_email: boolean }[]>`
      SELECT lead_id, full_name, email::text AS email, message, may_email
      FROM gym_lead_enquiries WHERE gym_id = ${gymId} ORDER BY created_at, id`;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
      robotCheck: fakeRobotCheck,
    });
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), { robotCheck: fakeRobotCheck });
    await second.ready();
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  // ── THE WORST THING: AN ENQUIRY ON ANOTHER GYM, OR THE FORM SAYING WHO A GYM HAS ──

  it(
    "an enquiry is kept only by the gym whose page it was sent from, and the form answers the same for a new person, a known lead and a robot",
    async () => {
      const ownerA = await makeUser("worst-a");
      const ownerB = await makeUser("worst-b");
      const gymA = await makeOrg(ownerA.cookies, TWIN_NAME);
      const gymB = await makeOrg(ownerB.cookies, "Hill Top Gym");
      await switchOn(gymA, ownerA.cookies);
      await switchOn(gymB, ownerB.cookies);
      // A newer gym of the same name, whose address starts with gym A's.
      const ownerTwin = await makeUser("worst-twin");
      const twin = await makeOrg(ownerTwin.cookies, TWIN_NAME);
      expect(twin.org.slug.startsWith(`${gymA.org.slug}-`)).toBe(true);
      await switchOn(twin, ownerTwin.cookies);
      // Gym B already has this person as a lead; gym A has never heard of them.
      const known = await post(`/v1/orgs/${gymB.org.id}/leads`, { fullName: "Asha Rao", email: "asha.rao@example.com", source: "walk_in" }, ownerB.cookies);
      expect(known.statusCode).toBe(201);
      const bBefore = await storedLeads(gymB.org.id);

      const toA = await post(formUrl(gymA.org.slug), enquiry());
      expect(toA.statusCode).toBe(202);

      const aLeads = await storedLeads(gymA.org.id);
      expect(aLeads).toHaveLength(1);
      expect(aLeads[0]).toMatchObject({ full_name: "Asha Rao", email: "asha.rao@example.com", status: "new", source: "social", added_by: null });
      // Kept under the invitations' key too, so the Leads list finds its email problems (20c-v-b).
      const key = inviteSettings(loadConfig(baseEnv))?.hmacKey;
      if (key === undefined) throw new Error("invitations are off in the test config");
      const keyed = await sql<{ email_hmac: string | null }[]>`SELECT email_hmac FROM gym_leads WHERE gym_id = ${gymA.org.id}`;
      expect(keyed.map((row) => row.email_hmac)).toEqual([emailHmac(key, "asha.rao@example.com")]);
      const aMessages = await storedEnquiries(gymA.org.id);
      expect(aMessages).toEqual([
        { lead_id: aLeads[0]?.id, full_name: "Asha Rao", email: "asha.rao@example.com", message: "Do you have evening classes?", may_email: false },
      ]);
      // Gym B's lead with the same email is exactly as it was, with no message on it.
      expect(await storedLeads(gymB.org.id)).toEqual(bBefore);
      expect(await storedEnquiries(gymB.org.id)).toEqual([]);
      expect(await storedLeads(twin.org.id)).toEqual([]);

      // Gym B's owner cannot read gym A's lead or its messages.
      const aLeadId = aLeads[0]?.id ?? "";
      expect((await get(`/v1/orgs/${gymA.org.id}/leads/${aLeadId}`, ownerB.cookies)).statusCode).toBe(404);
      expect((await get(`/v1/orgs/${gymA.org.id}/leads/${aLeadId}/enquiries`, ownerB.cookies)).statusCode).toBe(404);
      expect((await get(`/v1/orgs/${gymB.org.id}/leads/${aLeadId}/enquiries`, ownerB.cookies)).statusCode).toBe(404);
      // Gym A's owner reads it.
      const read = await get(`/v1/orgs/${gymA.org.id}/leads/${aLeadId}/enquiries`, ownerA.cookies);
      expect(read.statusCode).toBe(200);
      expect((JSON.parse(read.body) as { enquiries: LeadEnquiry[] }).enquiries.map((e) => e.message)).toEqual(["Do you have evening classes?"]);

      // The same answer, byte for byte, for someone already a lead and for a robot.
      const again = await post(formUrl(gymB.org.slug), enquiry());
      const robot = await post(formUrl(gymB.org.slug), enquiry({ fullName: "Someone New", email: "new.person@example.com", trap: "555-0101" }));
      const fresh = await post(formUrl(gymB.org.slug), enquiry({ fullName: "Ben Cole", email: "ben.cole@example.com" }));
      for (const res of [again, robot, fresh]) {
        expect(res.statusCode).toBe(202);
        expect(res.body).toBe(toA.body);
      }
      expect(toA.body).toBe(JSON.stringify({ received: true }));
    },
    TIMEOUT_MS,
  );

  // ── WHO SEES THE PAGE ──────────────────────────────────────────────────────

  it(
    "a page that is off, of a gym with no plan, of a closed gym or of no gym is the same 404, and its form keeps nothing",
    async () => {
      const owner = await makeUser("off-owner");
      const gym = await makeOrg(owner.cookies, "Quiet Gym");
      const notFoundBody = (res: { body: string }) => {
        const body = JSON.parse(res.body) as { error: string; message: string };
        return { error: body.error, message: body.message };
      };
      const NOT_FOUND = { error: "page_not_found", message: "This page isn't available." };

      // Never switched on.
      expect(notFoundBody(await get(publicUrl(gym.org.slug)))).toEqual(NOT_FOUND);
      expect((await get(publicUrl(gym.org.slug))).statusCode).toBe(404);
      expect((await post(formUrl(gym.org.slug), enquiry())).statusCode).toBe(404);

      // On: the page shows, and says nothing about a person.
      await switchOn(gym, owner.cookies);
      const shown = await get(publicUrl(gym.org.slug));
      expect(shown.statusCode).toBe(200);
      const page = (JSON.parse(shown.body) as { page: PublicGymPage }).page;
      expect(page).toMatchObject({
        name: "Quiet Gym",
        city: "Leeds",
        about: "Friendly gym by the canal.",
        facilities: ["free_weights", "showers"],
        ownFacilities: ["Boxing ring"],
        robotCheckKey: "test-site-key",
      });
      expect(Object.keys(page).sort()).toEqual(["about", "city", "facilities", "hours", "name", "orgType", "ownFacilities", "photos", "robotCheckKey"]);

      // Off again.
      expect((await put(pageUrl(gym.org.id), { ...PAGE_ON, shown: false }, owner.cookies)).statusCode).toBe(200);
      expect(notFoundBody(await get(publicUrl(gym.org.slug)))).toEqual(NOT_FOUND);
      expect((await post(formUrl(gym.org.slug), enquiry())).statusCode).toBe(404);

      // On, but the gym's trial or plan has ended.
      await switchOn(gym, owner.cookies);
      await sql`UPDATE subscriptions SET status = 'expired' WHERE owner_type = 'gym' AND owner_id = ${gym.org.id}`;
      expect(notFoundBody(await get(publicUrl(gym.org.slug)))).toEqual(NOT_FOUND);
      expect((await post(formUrl(gym.org.slug), enquiry())).statusCode).toBe(404);

      // On, on a plan, but the gym is closed.
      await subscribeGym(gym.org.id);
      expect((await get(publicUrl(gym.org.slug))).statusCode).toBe(200);
      await sql`UPDATE gyms SET status = 'archived', archived_at = now() WHERE id = ${gym.org.id}`;
      expect(notFoundBody(await get(publicUrl(gym.org.slug)))).toEqual(NOT_FOUND);
      expect((await post(formUrl(gym.org.slug), enquiry())).statusCode).toBe(404);
      await sql`UPDATE gyms SET status = 'active', archived_at = NULL WHERE id = ${gym.org.id}`;

      // No such gym, and an address no gym could have.
      expect(notFoundBody(await get(publicUrl("no-such-gym-anywhere")))).toEqual(NOT_FOUND);
      expect((await get(publicUrl("Not_A_Slug!"))).statusCode).toBe(404);
      expect((await post(formUrl("no-such-gym-anywhere"), enquiry())).statusCode).toBe(404);

      expect(await storedLeads(gym.org.id)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  // ── A PERSON ALREADY A LEAD ────────────────────────────────────────────────

  it(
    "a message from someone already a lead is kept on that lead, and changes nothing staff keep, not even the tick",
    async () => {
      const owner = await makeUser("known-owner");
      const gym = await makeOrg(owner.cookies, "Known Lead Gym");
      await switchOn(gym, owner.cookies);
      const added = await post(
        `/v1/orgs/${gym.org.id}/leads`,
        { fullName: "Maria Park", email: "maria.park@example.com", phone: "07700 900456", source: "friend" },
        owner.cookies,
      );
      expect(added.statusCode).toBe(201);
      const lead = (JSON.parse(added.body) as { lead: Lead }).lead;
      expect((await sql`UPDATE gym_leads SET status = 'contacted' WHERE id = ${lead.id}`).count).toBe(1);

      // By phone, with another name and another email, ticked: kept on her lead; her
      // name, email, status and tick unchanged.
      const byPhone = await post(
        formUrl(gym.org.slug),
        enquiry({ fullName: "M Park", email: "someone.else@example.com", phone: "+44 7700 900456", mayEmail: true, message: "Still thinking" }),
      );
      expect(byPhone.statusCode).toBe(202);
      let stored = await storedLeads(gym.org.id);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ id: lead.id, full_name: "Maria Park", email: "maria.park@example.com", status: "contacted", source: "friend", email_ok: false });

      // Her own email, ticked: still not ticked on the lead (staff may have taken it off
      // when she asked for no more emails, and a stranger can type her address); the
      // message keeps her tick for staff to act on.
      expect((await post(formUrl(gym.org.slug), enquiry({ fullName: "Maria Park", email: "MARIA.PARK@example.com", mayEmail: true }))).statusCode).toBe(202);
      stored = await storedLeads(gym.org.id);
      expect(stored[0]).toMatchObject({ email_ok: false, status: "contacted", due: null });

      const messages = await storedEnquiries(gym.org.id);
      expect(messages.map((m) => [m.lead_id, m.full_name, m.email, m.may_email])).toEqual([
        [lead.id, "M Park", "someone.else@example.com", true],
        [lead.id, "Maria Park", "maria.park@example.com", true],
      ]);

      // The list says when she last wrote.
      const listed = await get(`/v1/orgs/${gym.org.id}/leads`, owner.cookies);
      const row = (JSON.parse(listed.body) as { leads: Lead[] }).leads[0];
      expect(row?.enquiredAt).not.toBeNull();
    },
    TIMEOUT_MS,
  );

  it(
    "a new person who ticks the box is due the first follow-up today; one who does not is not",
    async () => {
      const owner = await makeUser("tick-owner");
      const gym = await makeOrg(owner.cookies, "Tick Gym");
      await switchOn(gym, owner.cookies);
      expect((await post(formUrl(gym.org.slug), enquiry({ email: "yes@example.com", mayEmail: true }))).statusCode).toBe(202);
      expect((await post(formUrl(gym.org.slug), enquiry({ email: "no@example.com" }))).statusCode).toBe(202);
      const today = (await sql<{ d: string }[]>`SELECT (now() AT TIME ZONE 'Europe/London')::date::text AS d`)[0]?.d;
      const stored = await storedLeads(gym.org.id);
      expect(stored.map((l) => [l.email, l.email_ok, l.due])).toEqual([
        ["yes@example.com", true, today],
        ["no@example.com", false, null],
      ]);
    },
    TIMEOUT_MS,
  );

  it(
    "a lead keeps its newest messages only",
    async () => {
      const owner = await makeUser("many-owner");
      const gym = await makeOrg(owner.cookies, "Many Messages Gym");
      await switchOn(gym, owner.cookies);
      for (let i = 1; i <= GYM_ENQUIRIES_KEPT_PER_LEAD + 2; i += 1) {
        expect((await post(formUrl(gym.org.slug), enquiry({ message: `Message ${String(i)}` }))).statusCode).toBe(202);
      }
      const messages = await storedEnquiries(gym.org.id);
      expect(messages).toHaveLength(GYM_ENQUIRIES_KEPT_PER_LEAD);
      expect(messages[0]?.message).toBe("Message 3");
      expect(messages[messages.length - 1]?.message).toBe(`Message ${String(GYM_ENQUIRIES_KEPT_PER_LEAD + 2)}`);
      expect(await storedLeads(gym.org.id)).toHaveLength(1);
    },
    TIMEOUT_MS,
  );

  // ── ROBOTS, AND WHAT THE FORM REFUSES ──────────────────────────────────────

  it(
    "a failed or unreachable robot check, a filled hidden field and a refused form keep nothing",
    async () => {
      const owner = await makeUser("robot-owner");
      const gym = await makeOrg(owner.cookies, "Robot Gym");
      await switchOn(gym, owner.cookies);
      robotAnswers.set("bad-token", "failed");
      robotAnswers.set("down-token", "unavailable");

      const failed = await post(formUrl(gym.org.slug), enquiry({ robotToken: "bad-token" }));
      expect(failed.statusCode).toBe(400);
      expect(JSON.parse(failed.body)).toMatchObject({ error: "robot_check_failed" });
      const down = await post(formUrl(gym.org.slug), enquiry({ robotToken: "down-token" }));
      expect(down.statusCode).toBe(503);
      expect(JSON.parse(down.body)).toMatchObject({ error: "robot_check_unavailable" });

      // The hidden field: answered as received, and the robot check is not even asked.
      const callsBefore = robotCalls.length;
      expect((await post(formUrl(gym.org.slug), enquiry({ trap: "x" }))).statusCode).toBe(202);
      expect(robotCalls.length).toBe(callsBefore);

      const refused = [
        [enquiry({ email: undefined, phone: undefined }), "needs_contact"],
        [enquiry({ fullName: "   " }), "needs_name"],
        [enquiry({ email: "not-an-email" }), "bad_email"],
        [enquiry({ email: undefined, phone: "12", mayEmail: false }), "bad_phone"],
        [enquiry({ email: undefined, phone: "07700 900111", mayEmail: true }), "needs_email"],
        [enquiry({ message: "my card 4111 1111 1111 1111 exp 10/29" }), "card_number"],
      ] as const;
      for (const [body, code] of refused) {
        const res = await post(formUrl(gym.org.slug), body);
        expect(res.statusCode, code).toBe(400);
        expect((JSON.parse(res.body) as { error: string }).error).toBe(code);
      }
      // Fields the form does not have are refused by shape.
      expect((await post(formUrl(gym.org.slug), { ...enquiry(), status: "joined" })).statusCode).toBe(400);
      expect((await post(formUrl(gym.org.slug), { ...enquiry(), robotToken: "" })).statusCode).toBe(400);

      expect(await storedLeads(gym.org.id)).toEqual([]);
      expect(await storedEnquiries(gym.org.id)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "a quiet page takes 60 an hour from one address; failed robot checks never spend it, and after 30 of them that address is refused before the check",
    async () => {
      const owner = await makeUser("limit-owner");
      const gym = await makeOrg(owner.cookies, "Busy Gym");
      const other = await makeOrg(owner.cookies, "Busy Gym Two");
      await switchOn(gym, owner.cookies);
      await switchOn(other, owner.cookies);
      const address = "10.64.0.9";
      // Robots at that address first: 30 failed checks spend nobody's allowance...
      robotAnswers.set("limit-robot-token", "failed");
      for (let i = 0; i < 30; i += 1) {
        const res = await send("POST", formUrl(gym.org.slug), enquiry({ email: `r${String(i)}@example.com`, robotToken: "limit-robot-token" }), {}, address);
        expect(res.statusCode, `robot ${String(i + 1)}`).toBe(400);
      }
      // ...but past them, that address is refused at that page before the check is asked.
      const calls = robotCalls.length;
      robotAnswers.set("after-robots-token", "passed");
      expect((await send("POST", formUrl(gym.org.slug), enquiry({ email: "blocked@example.com", robotToken: "after-robots-token" }), {}, address)).statusCode).toBe(429);
      expect(robotCalls.slice(calls)).not.toContain("after-robots-token");
      // The same address at another gym's page is untouched, and so is anybody else at this one.
      expect((await send("POST", formUrl(other.org.slug), enquiry({ email: "elsewhere.gym@example.com" }), {}, address)).statusCode).toBe(202);
      const people = "10.64.0.10";
      for (let i = 0; i < 60; i += 1) {
        const res = await send("POST", formUrl(gym.org.slug), enquiry({ fullName: `Person ${String(i)}`, email: `p${String(i)}@example.com` }), {}, people);
        expect(res.statusCode, `message ${String(i + 1)}`).toBe(202);
      }
      // A quiet page took all 60 from one address; the 61st is that address's hour spent.
      expect((await send("POST", formUrl(gym.org.slug), enquiry({ email: "late@example.com" }), {}, people)).statusCode).toBe(429);
      expect(await storedLeads(gym.org.id)).toHaveLength(60);
    },
    TIMEOUT_MS,
  );

  it(
    "robots cannot use up a page: only sends that pass the robot check count, and the 121st real one hears the page is busy",
    async () => {
      const owner = await makeUser("page-owner");
      const gym = await makeOrg(owner.cookies, "Popular Gym");
      await switchOn(gym, owner.cookies);
      robotAnswers.set("robot-token", "failed");
      // 130 robot sends from many addresses: the hidden field filled, or a failed check.
      for (let i = 0; i < 65; i += 1) {
        expect((await post(formUrl(gym.org.slug), enquiry({ email: `bot${String(i)}@example.com`, trap: "x" }))).statusCode).toBe(202);
        expect((await post(formUrl(gym.org.slug), enquiry({ email: `bot${String(i)}@example.com`, robotToken: "robot-token" }))).statusCode).toBe(400);
      }
      expect(await storedLeads(gym.org.id)).toEqual([]);
      // 120 real people, each from their own address, all kept.
      for (let i = 0; i < 120; i += 1) {
        const res = await post(formUrl(gym.org.slug), enquiry({ fullName: `Real ${String(i)}`, email: `real${String(i)}@example.com` }));
        expect(res.statusCode, `person ${String(i + 1)}`).toBe(202);
      }
      const busy = await post(formUrl(gym.org.slug), enquiry({ fullName: "One Too Many", email: "late.real@example.com" }));
      expect(busy.statusCode).toBe(429);
      expect(JSON.parse(busy.body)).toMatchObject({
        error: "page_busy",
        message: "This page is getting a lot of messages. Please try again in an hour, or contact them directly.",
      });
      expect(await storedLeads(gym.org.id)).toHaveLength(120);
    },
    TIMEOUT_MS,
  );

  it(
    "a full gym answers a known lead and a new person alike, so the form never says who it has",
    async () => {
      const owner = await makeUser("full-owner");
      const gym = await makeOrg(owner.cookies, "Full Gym");
      await switchOn(gym, owner.cookies);
      await sql`INSERT INTO gym_leads (gym_id, full_name, email, source)
        SELECT ${gym.org.id}, 'Lead ' || n, 'full.lead' || n || '@example.com', 'website' FROM generate_series(1, 10000) n`;
      const known = await post(formUrl(gym.org.slug), enquiry({ fullName: "Lead 7", email: "full.lead7@example.com" }));
      const stranger = await post(formUrl(gym.org.slug), enquiry({ fullName: "Not Yet", email: "not.yet@example.com" }));
      const answer = (res: { statusCode: number; body: string }) => {
        const body = JSON.parse(res.body) as { error: string; message: string };
        return [res.statusCode, body.error, body.message];
      };
      expect(known.statusCode).toBe(409);
      expect(answer(stranger)).toEqual(answer(known));
      expect(await storedEnquiries(gym.org.id)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "the same new person sent twice at the same instant, through two apis, is one lead with one message, never an error",
    async () => {
      const owner = await makeUser("race-owner");
      const gym = await makeOrg(owner.cookies, "Race Gym");
      await switchOn(gym, owner.cookies);
      const other = second;
      if (other === undefined) throw new Error("beforeAll did not build the second api");
      const via = (target: App, body: unknown) =>
        target.inject({
          method: "POST",
          url: formUrl(gym.org.slug),
          remoteAddress: nextIp(),
          headers: { "content-type": "application/json" },
          payload: JSON.stringify(body),
        });
      for (let round = 0; round < 10; round += 1) {
        const body = enquiry({ fullName: `Twin ${String(round)}`, email: `twice${String(round)}@example.com` });
        const [a, b] = await Promise.all([via(api(), body), via(other, body)]);
        expect([a.statusCode, b.statusCode], `round ${String(round + 1)}`).toEqual([202, 202]);
      }
      expect(await storedLeads(gym.org.id)).toHaveLength(10);
      // The same message twice at once is the same message (the integrity pass, 2026-09-30).
      expect(await storedEnquiries(gym.org.id)).toHaveLength(10);
    },
    TIMEOUT_MS,
  );

  it(
    "a lead's messages are read with its gym: another gym's id finds none",
    async () => {
      const owner = await makeUser("read-owner");
      const gym = await makeOrg(owner.cookies, "Read Gym");
      const other = await makeOrg(owner.cookies, "Read Other Gym");
      await switchOn(gym, owner.cookies);
      expect((await post(formUrl(gym.org.slug), enquiry())).statusCode).toBe(202);
      const leadId = (await storedLeads(gym.org.id))[0]?.id ?? "";
      expect(await enquiriesFor(sql, gym.org.id, leadId, 20)).toHaveLength(1);
      expect(await enquiriesFor(sql, other.org.id, leadId, 20)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "the public page shows only today's closure; notes further ahead were written for members",
    async () => {
      const owner = await makeUser("closed-owner");
      const gym = await makeOrg(owner.cookies, "Closed Gym");
      await switchOn(gym, owner.cookies);
      await sql`INSERT INTO gym_closures (gym_id, day, note) VALUES
        (${gym.org.id}, (now() AT TIME ZONE 'Europe/London')::date, 'Deep clean'),
        (${gym.org.id}, (now() AT TIME ZONE 'Europe/London')::date + 3, 'Staff training, members only')`;
      const page = (JSON.parse((await get(publicUrl(gym.org.slug))).body) as { page: PublicGymPage }).page;
      expect(page.hours.closures.map((c) => c.note)).toEqual(["Deep clean"]);
      await sql`DELETE FROM gym_closures WHERE gym_id = ${gym.org.id}`;
    },
    TIMEOUT_MS,
  );

  // ── THE CONSOLE ────────────────────────────────────────────────────────────

  it(
    "the owner changes the page; a manager sees it and cannot change it; nobody else reads or changes it",
    async () => {
      const owner = await makeUser("console-owner");
      const rival = await makeUser("console-rival");
      const stranger = await makeUser("console-stranger");
      const gym = await makeOrg(owner.cookies, "Console Gym");
      await makeOrg(rival.cookies, "Console Rival Gym");
      const manager = await makeStaff(gym, owner.cookies, "console-manager", "manager");
      const trainer = await makeStaff(gym, owner.cookies, "console-trainer", "trainer");
      expect(ROLE_PRIVILEGES.manager).not.toContain("org.manage");
      expect(ROLE_PRIVILEGES.trainer).not.toContain("members.confirm");

      const empty = await get(pageUrl(gym.org.id), owner.cookies);
      expect(empty.statusCode).toBe(200);
      expect((JSON.parse(empty.body) as { page: GymPage }).page).toEqual({
        shown: false,
        about: "",
        facilities: [],
        ownFacilities: [],
        photos: [],
        slug: gym.org.slug,
        mayChange: true,
      });

      const saved = await put(pageUrl(gym.org.id), { ...PAGE_ON, about: "  Open late.  " }, owner.cookies);
      expect(saved.statusCode).toBe(200);
      expect((JSON.parse(saved.body) as { page: GymPage }).page).toMatchObject({ about: "Open late.", facilities: ["free_weights", "showers"] });

      const seen = await get(pageUrl(gym.org.id), manager.cookies);
      expect(seen.statusCode).toBe(200);
      expect((JSON.parse(seen.body) as { page: GymPage }).page.mayChange).toBe(false);
      expect((await put(pageUrl(gym.org.id), { ...PAGE_ON, shown: false }, manager.cookies)).statusCode).toBe(403);
      expect((await get(pageUrl(gym.org.id), trainer.cookies)).statusCode).toBe(403);
      expect((await put(pageUrl(gym.org.id), { ...PAGE_ON, shown: false }, trainer.cookies)).statusCode).toBe(403);
      for (const outsider of [rival, stranger]) {
        expect((await get(pageUrl(gym.org.id), outsider.cookies)).statusCode).toBe(404);
        expect((await put(pageUrl(gym.org.id), { ...PAGE_ON, shown: false }, outsider.cookies)).statusCode).toBe(404);
      }
      expect((await get(pageUrl(gym.org.id), {})).statusCode).toBe(401);
      const stored = await sql<{ shown: boolean; about: string }[]>`SELECT shown, about FROM gym_pages WHERE gym_id = ${gym.org.id}`;
      expect(stored).toEqual([{ shown: true, about: "Open late." }]);

      // The gym's own facilities: one in the list's words becomes that tick, one typed
      // twice is kept once, in the order added; an eleventh, or one too long, is refused.
      const own = await put(
        pageUrl(gym.org.id),
        { ...PAGE_ON, facilities: ["showers"], ownFacilities: ["Boxing ring", "  showers ", "Rooftop   track", "boxing ring"] },
        owner.cookies,
      );
      expect(own.statusCode, "own facilities").toBe(400);
      const ownSaved = await put(
        pageUrl(gym.org.id),
        { ...PAGE_ON, facilities: ["parking"], ownFacilities: ["Boxing ring", "  showers ", "Rooftop   track"] },
        owner.cookies,
      );
      expect(ownSaved.statusCode).toBe(200);
      expect((JSON.parse(ownSaved.body) as { page: GymPage }).page).toMatchObject({
        facilities: ["showers", "parking"],
        ownFacilities: ["Boxing ring", "Rooftop track"],
      });
      const ownStored = await sql<{ facilities: string[]; own_facilities: string[] }[]>`
        SELECT facilities, own_facilities FROM gym_pages WHERE gym_id = ${gym.org.id}`;
      expect(ownStored).toEqual([{ facilities: ["showers", "parking"], own_facilities: ["Boxing ring", "Rooftop track"] }]);
      const eleven = Array.from({ length: 11 }, (_, i) => `Facility ${String(i + 1)}`);
      expect((await put(pageUrl(gym.org.id), { ...PAGE_ON, ownFacilities: eleven }, owner.cookies)).statusCode).toBe(400);
      expect((await put(pageUrl(gym.org.id), { ...PAGE_ON, ownFacilities: ["x".repeat(41)] }, owner.cookies)).statusCode).toBe(400);

      // A facility the list does not have, and one twice, are refused.
      expect((await put(pageUrl(gym.org.id), { ...PAGE_ON, facilities: ["helipad"] }, owner.cookies)).statusCode).toBe(400);
      expect((await put(pageUrl(gym.org.id), { ...PAGE_ON, facilities: ["showers", "showers"] }, owner.cookies)).statusCode).toBe(400);

      // A gym whose plan has ended keeps reading its page and cannot change it.
      await sql`UPDATE subscriptions SET status = 'expired' WHERE owner_type = 'gym' AND owner_id = ${gym.org.id}`;
      expect((await get(pageUrl(gym.org.id), owner.cookies)).statusCode).toBe(200);
      expect((await put(pageUrl(gym.org.id), PAGE_ON, owner.cookies)).statusCode).toBe(409);
    },
    TIMEOUT_MS,
  );

  // ── The two passes over 20c (reviews 2026-09-30) ──

  it(
    "WORST THING: the form can never lock staff out: it stops taking new people at 1,000 untouched page leads, and staff still add a walk-in",
    async () => {
      const owner = await makeUser("flood-owner");
      const org = await makeOrg(owner.cookies, "Flood Page Gym");
      await switchOn(org, owner.cookies);
      // 999 people the page made, still New, as a flood would leave them.
      await sql`
        INSERT INTO gym_leads (gym_id, full_name, email, source, status, from_page)
        SELECT ${org.org.id}, 'Flood ' || n, 'flood' || n || '@example.com', 'other', 'new', true
        FROM generate_series(1, 999) AS n`;
      expect((await post(formUrl(org.org.slug), enquiry({ fullName: "Flood Last", email: "flood.last@example.com" }))).statusCode).toBe(202);
      const full = await post(formUrl(org.org.slug), enquiry({ fullName: "Real Visitor", email: "real.visitor@example.com" }));
      expect([full.statusCode, (JSON.parse(full.body) as { error: string }).error]).toEqual([409, "enquiries_full"]);
      const walkIn = await post(`/v1/orgs/${org.org.id}/leads`, { fullName: "Walk In", email: "walk.in@example.com", source: "walk_in" }, owner.cookies);
      expect(walkIn.statusCode).toBe(201);
      // Staff dealing with them makes room: a page lead moved on from New no longer counts.
      await sql`UPDATE gym_leads SET status = 'lost' WHERE gym_id = ${org.org.id} AND full_name = 'Flood 1'`;
      expect((await post(formUrl(org.org.slug), enquiry({ fullName: "Real Visitor", email: "real.visitor@example.com" }))).statusCode).toBe(202);
    },
    TIMEOUT_MS,
  );

  it(
    "once a page is busy, one address spends at most 10 of its messages an hour; a quiet page never refuses people sharing an address; the gym is told what was turned away",
    async () => {
      const owner = await makeUser("share-owner");
      const a = await makeOrg(owner.cookies, "Share Page Gym A");
      const b = await makeOrg(owner.cookies, "Share Page Gym B");
      await switchOn(a, owner.cookies);
      await switchOn(b, owner.cookies);
      // 60 people from 60 addresses: the page is busy now.
      for (let i = 0; i < 60; i++) {
        expect((await send("POST", formUrl(a.org.slug), enquiry({ fullName: `Busy ${String(i)}`, email: `busy${String(i)}@example.com` }), {}, `10.93.0.${String(i + 1)}`)).statusCode).toBe(202);
      }
      const shared = "10.91.0.7";
      const answers: number[] = [];
      for (let i = 0; i < 11; i++) {
        answers.push((await send("POST", formUrl(a.org.slug), enquiry({ fullName: `Share ${String(i)}`, email: `share${String(i)}@example.com` }), {}, shared)).statusCode);
      }
      expect(answers).toEqual([...Array<number>(10).fill(202), 429]);
      // Another address still reaches that page.
      expect((await send("POST", formUrl(a.org.slug), enquiry({ fullName: "Other Door", email: "other.door@example.com" }), {}, "10.91.0.8")).statusCode).toBe(202);
      // The gym's Leads page says what was turned away.
      expect((JSON.parse((await send("GET", `/v1/orgs/${a.org.id}/leads`, undefined, owner.cookies)).body) as { pageTurnedAway: number }).pageTurnedAway).toBe(1);
      // A quiet page: 11 from one shared address all get in.
      const quiet: number[] = [];
      for (let i = 0; i < 11; i++) {
        quiet.push((await send("POST", formUrl(b.org.slug), enquiry({ fullName: `Quiet ${String(i)}`, email: `quiet${String(i)}@example.com` }), {}, shared)).statusCode);
      }
      expect(quiet).toEqual(Array<number>(11).fill(202));
      // A carrier's one address, many phones, many gyms: never one limit for the whole app.
      const carrier = "10.92.0.1";
      const gyms = [a, b];
      // (a and b already heard from other addresses; the carrier's 10 each still get in.)
      for (let g = 0; g < 5; g++) {
        const more = await makeOrg(owner.cookies, `Share Page Gym ${String(g + 3)}`);
        await switchOn(more, owner.cookies);
        gyms.push(more);
      }
      const spread: number[] = [];
      for (const gym of gyms) {
        for (let i = 0; i < 10; i++) {
          spread.push((await send("POST", formUrl(gym.org.slug), enquiry({ fullName: `Phone ${String(i)}`, email: `phone${String(i)}.${gym.org.slug}@example.com` }), {}, carrier)).statusCode);
        }
      }
      expect(spread).toEqual(Array<number>(70).fill(202));
    },
    TIMEOUT_MS,
  );

  it(
    "the same message sent twice in a moment is kept once",
    async () => {
      const owner = await makeUser("twice-owner");
      const org = await makeOrg(owner.cookies, "Twice Page Gym");
      await switchOn(org, owner.cookies);
      const body = enquiry({ fullName: "Tap Twice", email: "tap.twice@example.com", message: "Do you have a trial week?" });
      expect((await post(formUrl(org.org.slug), body)).statusCode).toBe(202);
      expect((await post(formUrl(org.org.slug), body)).statusCode).toBe(202);
      expect((await storedEnquiries(org.org.id)).map((e) => e.message)).toEqual(["Do you have a trial week?"]);
    },
    TIMEOUT_MS,
  );
});
