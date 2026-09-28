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
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_gym_page_routes";

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
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
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
  const PAGE_ON = { shown: true, about: "Friendly gym by the canal.", facilities: ["showers", "free_weights"], otherFacilities: "Boxing ring" };

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
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  // ── THE WORST THING: AN ENQUIRY ON ANOTHER GYM, OR THE FORM SAYING WHO A GYM HAS ──

  it(
    "an enquiry is kept only by the gym whose page it was sent from, and the form answers the same for a new person, a known lead and a robot",
    async () => {
      const ownerA = await makeUser("worst-a");
      const ownerB = await makeUser("worst-b");
      const gymA = await makeOrg(ownerA.cookies, "Canal Street Gym");
      const gymB = await makeOrg(ownerB.cookies, "Hill Top Gym");
      await switchOn(gymA, ownerA.cookies);
      await switchOn(gymB, ownerB.cookies);
      // A newer gym of the same name, whose address starts with gym A's.
      const ownerTwin = await makeUser("worst-twin");
      const twin = await makeOrg(ownerTwin.cookies, "Canal Street Gym");
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
      const robot = await post(formUrl(gymB.org.slug), enquiry({ fullName: "Someone New", email: "new.person@example.com", fax: "555-0101" }));
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
        otherFacilities: "Boxing ring",
        robotCheckKey: "test-site-key",
      });
      expect(Object.keys(page).sort()).toEqual(["about", "city", "facilities", "hours", "name", "orgType", "otherFacilities", "robotCheckKey"]);

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
    "a message from someone already a lead is kept on that lead, and changes nothing staff keep but the tick for the lead's own email",
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

      // Her own email, ticked: the tick is taken; she is Contacted, so nothing is due.
      expect((await post(formUrl(gym.org.slug), enquiry({ fullName: "Maria Park", email: "MARIA.PARK@example.com", mayEmail: true }))).statusCode).toBe(202);
      stored = await storedLeads(gym.org.id);
      expect(stored[0]).toMatchObject({ email_ok: true, status: "contacted", due: null });

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
      expect((await post(formUrl(gym.org.slug), enquiry({ fax: "x" }))).statusCode).toBe(202);
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
    "the form takes 60 an hour from one address, for any number of people there, and the 61st is refused",
    async () => {
      const owner = await makeUser("limit-owner");
      const gym = await makeOrg(owner.cookies, "Busy Gym");
      await switchOn(gym, owner.cookies);
      const address = "10.64.0.9";
      for (let i = 0; i < 60; i += 1) {
        const res = await send("POST", formUrl(gym.org.slug), enquiry({ fullName: `Person ${String(i)}`, email: `p${String(i)}@example.com` }), {}, address);
        expect(res.statusCode, `message ${String(i + 1)}`).toBe(202);
      }
      const over = await send("POST", formUrl(gym.org.slug), enquiry({ email: "late@example.com" }), {}, address);
      expect(over.statusCode).toBe(429);
      // Another address still gets through.
      expect((await post(formUrl(gym.org.slug), enquiry({ email: "elsewhere@example.com" }))).statusCode).toBe(202);
      expect(await storedLeads(gym.org.id)).toHaveLength(61);
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
        otherFacilities: "",
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
});
