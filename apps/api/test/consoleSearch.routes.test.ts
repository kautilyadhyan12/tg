// People in the console's search (V1-e-ii; spec Part 3 §17.11) — the route against real
// Postgres (DATABASE_URL-gated).
//
// The first block is the worst thing this job could do to a real person: one business's
// members, leads or staff (names, emails, phones) shown to another business, to somebody who
// is not its staff, or to staff whose role may not open that list. Every door is first opened
// by the owner, so a missing route cannot pass for a refusal.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { addAnyway } from "./memberListAddAnyway.js";
import { proveAddress } from "./proveAddress.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { ROLE_PRIVILEGES, type ConsoleSearchResponse, type MemberListEntriesPage } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "console-search-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 120_000;
const LIVE_PLAN = "zz_console_search";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("people in the console's search (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const limits = createMemoryRedis();
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'csearch-t-%@example.com')`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'csearch-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT", path: string, payload: unknown, cookies: Record<string, string>, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Record<string, string>, ip?: string) => send("GET", path, undefined, cookies, ip);
  const post = (path: string, payload: unknown, cookies: Record<string, string>) => send("POST", path, payload, cookies);

  const makeUser = async (local: string, displayName = `Search ${local}`) => {
    const email = `csearch-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
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

  const joinAsMember = async (memberCookies: Record<string, string>, org: CreatedOrg, staffCookies: Record<string, string>) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staffCookies)).statusCode).toBe(200);
  };

  const makeStaff = async (org: CreatedOrg, owner: Record<string, string>, local: string, role: "manager" | "trainer", displayName?: string) => {
    const person = await makeUser(local, displayName);
    await joinAsMember(person.cookies, org, owner);
    await proveAddress(sql, person.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role }, owner)).statusCode).toBe(201);
    return person;
  };

  const addEntry = async (gymId: string, cookies: Record<string, string>, body: Record<string, unknown>) => {
    const res = await addAnyway((sent) => post(`/v1/orgs/${gymId}/member-list/entries`, sent, cookies), body);
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const addLead = async (gymId: string, cookies: Record<string, string>, body: Record<string, unknown>) => {
    const res = await post(`/v1/orgs/${gymId}/leads`, { source: "walk_in", ...body }, cookies);
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { lead: { id: string } }).lead.id;
  };

  const searchUrl = (gymId: string, typed: string) => `/v1/orgs/${gymId}/search/people?query=${encodeURIComponent(typed)}`;
  const search = async (gymId: string, typed: string, cookies: Record<string, string>) => {
    const res = await get(searchUrl(gymId, typed), cookies);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as ConsoleSearchResponse;
  };
  const memberNames = (found: ConsoleSearchResponse) => (found.members?.people ?? []).map((p) => p.fullName);

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
      redis: limits,
    });
    await api().ready();
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  // ── THE WORST THING: SOMEBODY ELSE'S PEOPLE ────────────────────────────────

  it(
    "nobody outside this business, and no staff whose role may not open a list, is shown its people",
    async () => {
      const owner = await makeUser("worst-owner");
      const rival = await makeUser("worst-rival");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const org = await makeOrg(owner.cookies, "Worst Search Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Rival Search Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      const trainer = await makeStaff(org, owner.cookies, "worst-trainer", "trainer");
      const manager = await makeStaff(org, owner.cookies, "worst-manager", "manager", "Sami Front Desk");
      expect(ROLE_PRIVILEGES.trainer).not.toContain("members.confirm");
      expect(ROLE_PRIVILEGES.manager).not.toContain("staff.manage");

      const mine = await addEntry(org.org.id, owner.cookies, { fullName: "Sam Rivera", email: "sam.rivera@example.com" });
      const mineLead = await addLead(org.org.id, owner.cookies, { fullName: "Samir Khan", email: "samir.khan@example.com" });
      const theirs = await addEntry(rivalOrg.org.id, rival.cookies, { fullName: "Sam Rivers", email: "sam.rivers@example.com" });
      const theirLead = await addLead(rivalOrg.org.id, rival.cookies, { fullName: "Samantha Rival", email: "samantha@example.com" });

      // The positive control: the owner finds this business's member, lead and staff, and
      // nothing of the rival's.
      const seen = await search(org.org.id, "sam", owner.cookies);
      expect(seen.members?.people.map((p) => p.entryId)).toEqual([mine]);
      expect(seen.leads?.people.map((p) => p.id)).toEqual([mineLead]);
      expect(seen.staff?.people.map((p) => p.displayName)).toEqual(["Sami Front Desk"]);
      const rivalSeen = await search(rivalOrg.org.id, "sam", rival.cookies);
      expect(rivalSeen.members?.people.map((p) => p.entryId)).toEqual([theirs]);
      expect(rivalSeen.leads?.people.map((p) => p.id)).toEqual([theirLead]);

      const outsiders = [
        { who: "a stranger", cookies: stranger.cookies, status: 404 },
        { who: "a rival business's owner", cookies: rival.cookies, status: 404 },
        { who: "this business's member", cookies: member.cookies, status: 404 },
        { who: "nobody signed in", cookies: {}, status: 401 },
      ];
      for (const { who, cookies, status } of outsiders) {
        for (const typed of ["sam", "rivera", "example.com"]) {
          const res = await get(searchUrl(org.org.id, typed), cookies);
          expect({ who, typed, status: res.statusCode }).toEqual({ who, typed, status });
          for (const word of ["Sam", "Rivera", "Samir", "sam.rivera", "Sami"]) expect(res.body).not.toContain(word);
        }
      }

      // Staff whose role may not open Members or Staff: answered, with no people at all.
      expect(await search(org.org.id, "sam", trainer.cookies)).toEqual({ members: null, leads: null, staff: null });
      // A manager opens Members and Leads, never Staff.
      const managed = await search(org.org.id, "sam", manager.cookies);
      expect(managed.members?.people.map((p) => p.entryId)).toEqual([mine]);
      expect(managed.leads?.people.map((p) => p.id)).toEqual([mineLead]);
      expect(managed.staff).toBeNull();
      // The Members tick taken off: no members and no leads.
      const without = ROLE_PRIVILEGES.manager.filter((p) => p !== "members.confirm");
      expect((await send("PUT", `/v1/orgs/${org.org.id}/staff/${manager.userId}/privileges`, { privileges: without }, owner.cookies)).statusCode).toBe(200);
      expect(await search(org.org.id, "sam", manager.cookies)).toEqual({ members: null, leads: null, staff: null });
    },
    TIMEOUT_MS,
  );

  // ── FINDING PEOPLE AS THE LISTS DO ─────────────────────────────────────────

  it(
    "finds by name, email, phone and member number, as the Members list does, current and past members, five at a time",
    async () => {
      const owner = await makeUser("find-owner");
      const org = await makeOrg(owner.cookies, "Find Search Gym");
      const gym = org.org.id;
      // Names as real member exports write them (Mindbody, Glofox and gym spreadsheets):
      // accents, apostrophes, hyphens, particles, scripts other than Latin, and two people
      // with one name.
      const people = [
        { fullName: "José Núñez", email: "jose.nunez@example.com" },
        { fullName: "Siobhán O'Brien", email: "siobhan@example.com" },
        { fullName: "Anne-Marie van der Berg", email: "annemarie@example.com", memberNumber: "MBR-0042" },
        { fullName: "王芳", phone: "+44 7700 900111" },
        { fullName: "Priya Sharma", email: "priya.sharma@example.com" },
        { fullName: "Priya Sharma", email: "priya.s.2@example.com" },
        { fullName: "Tom 100% Reid", email: "tom_reid@example.com" },
      ];
      const ids = new Map<string, string>();
      for (const body of people) ids.set(body.email ?? body.fullName, await addEntry(gym, owner.cookies, body));

      const cases: { typed: string; names: string[] }[] = [
        { typed: "josé", names: ["José Núñez"] },
        { typed: "NÚÑEZ", names: ["José Núñez"] },
        { typed: "o'brien", names: ["Siobhán O'Brien"] },
        { typed: "anne-marie", names: ["Anne-Marie van der Berg"] },
        { typed: "van der", names: ["Anne-Marie van der Berg"] },
        { typed: "mbr-0042", names: ["Anne-Marie van der Berg"] },
        { typed: "王芳", names: ["王芳"] },
        { typed: "7700900111", names: ["王芳"] },
        { typed: "priya", names: ["Priya Sharma", "Priya Sharma"] },
        { typed: "priya.s.2@", names: ["Priya Sharma"] },
        // A wildcard typed is a letter, never "everybody".
        { typed: "100%", names: ["Tom 100% Reid"] },
        { typed: "_r", names: ["Tom 100% Reid"] },
        { typed: "%%", names: [] },
        // Words the list has never heard of find nobody.
        { typed: "zebedee", names: [] },
        { typed: "MBR-9999", names: [] },
      ];
      for (const { typed, names } of cases) {
        const found = await search(gym, typed, owner.cookies);
        expect({ typed, names: memberNames(found) }).toEqual({ typed, names });
        // ONE ANSWER: the Members list's own search finds the same people, in the same order.
        const listed = await get(`/v1/orgs/${gym}/member-list/entries?records=all&query=${encodeURIComponent(typed)}`, owner.cookies);
        expect(listed.statusCode).toBe(200);
        const page = (JSON.parse(listed.body) as { page: MemberListEntriesPage }).page;
        expect({ typed, ids: found.members?.people.map((p) => p.entryId) }).toEqual({ typed, ids: page.entries.slice(0, 5).map((e) => e.entryId) });
      }
      // The two of one name are told apart by their email.
      expect((await search(gym, "priya", owner.cookies)).members?.people.map((p) => p.email).sort()).toEqual(["priya.s.2@example.com", "priya.sharma@example.com"]);

      // A past member is found, and says so.
      const jose = ids.get("jose.nunez@example.com") ?? "";
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym} AND id = ${jose}`;
      const past = await search(gym, "josé", owner.cookies);
      expect(past.members?.people.map((p) => ({ id: p.entryId, past: p.formerAt !== null }))).toEqual([{ id: jose, past: true }]);

      // Six of one name: five are shown, and "more" says there are others.
      for (let n = 1; n <= 4; n += 1) await addEntry(gym, owner.cookies, { fullName: `Priya Sharma ${String(n)}`, email: `priya-${String(n)}@example.com` });
      const many = await search(gym, "priya", owner.cookies);
      expect(many.members?.people).toHaveLength(5);
      expect(many.members?.more).toBe(true);
      expect((await search(gym, "siobhán", owner.cookies)).members?.more).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    "finds leads as the Leads list does, and staff by their name or email with their role",
    async () => {
      const owner = await makeUser("lead-owner", "Kofi Mensah");
      const org = await makeOrg(owner.cookies, "Lead Search Gym");
      const gym = org.org.id;
      const desk = await makeStaff(org, owner.cookies, "lead-desk", "manager", "Zoë Lambert");
      await sql`UPDATE gym_staff SET role_name = 'Front desk' WHERE gym_id = ${gym} AND user_id = ${desk.userId}`;
      const lead = await addLead(gym, owner.cookies, { fullName: "Ngozi Okafor", email: "ngozi@example.com", phone: "07700 900456" });

      for (const typed of ["ngozi", "OKAFOR", "ngozi@", "900456"]) {
        const found = await search(gym, typed, owner.cookies);
        expect({ typed, leads: found.leads?.people.map((p) => p.id) }).toEqual({ typed, leads: [lead] });
        const listed = await get(`/v1/orgs/${gym}/leads?q=${encodeURIComponent(typed)}`, owner.cookies);
        expect((JSON.parse(listed.body) as { leads: { id: string }[] }).leads.map((l) => l.id)).toEqual([lead]);
      }
      expect((await search(gym, "ngozi", owner.cookies)).leads?.people[0]).toMatchObject({ fullName: "Ngozi Okafor", status: "new" });

      expect((await search(gym, "zoë", owner.cookies)).staff?.people).toEqual([
        { userId: desk.userId, displayName: "Zoë Lambert", role: "manager", roleName: "Front desk", coOwner: false },
      ]);
      expect((await search(gym, "LAMBERT", owner.cookies)).staff?.people.map((p) => p.userId)).toEqual([desk.userId]);
      expect((await search(gym, "lead-desk@", owner.cookies)).staff?.people.map((p) => p.userId)).toEqual([desk.userId]);
      expect((await search(gym, "kofi", owner.cookies)).staff?.people.map((p) => p.userId)).toEqual([owner.userId]);
      expect((await search(gym, "zoe", owner.cookies)).staff?.people).toEqual([]);
    },
    TIMEOUT_MS,
  );

  // ── WHAT IS REFUSED ────────────────────────────────────────────────────────

  it(
    "refuses a word too short or too long, an unknown field and a malformed business, without saying what was typed",
    async () => {
      const owner = await makeUser("bad-owner");
      const org = await makeOrg(owner.cookies, "Bad Search Gym");
      const gym = org.org.id;
      for (const path of [
        `/v1/orgs/${gym}/search/people`,
        searchUrl(gym, "s"),
        searchUrl(gym, "   s  "),
        searchUrl(gym, "x".repeat(121)),
        `${searchUrl(gym, "sam")}&records=all`,
        `/v1/orgs/not-a-uuid/search/people?query=sam`,
      ]) {
        const res = await get(path, owner.cookies);
        expect({ path, status: res.statusCode }).toEqual({ path, status: 400 });
        expect(res.body).not.toContain("xxxxxxxxxx");
      }
      expect((await get(searchUrl(gym, "x".repeat(120)), owner.cookies)).statusCode).toBe(200);
    },
    TIMEOUT_MS,
  );

  it(
    "a person past their hour's searches is refused, and a colleague at the same desk is not",
    async () => {
      const owner = await makeUser("limit-owner");
      const manager = await makeUser("limit-manager");
      const org = await makeOrg(owner.cookies, "Limit Search Gym");
      const gym = org.org.id;
      await joinAsMember(manager.cookies, org, owner.cookies);
      await proveAddress(sql, manager.email);
      expect((await post(`/v1/orgs/${gym}/staff`, { email: manager.email, role: "manager" }, owner.cookies)).statusCode).toBe(201);
      const desk = "10.64.0.1";
      // The owner's hour already spent: the next search is refused.
      await limits.setex(`rl:console_search_people:id:${owner.userId}`, 3600, "1200");
      const refused = await get(searchUrl(gym, "sam"), owner.cookies, desk);
      expect(refused.statusCode).toBe(429);
      // The colleague at the same address searches on.
      expect((await get(searchUrl(gym, "sam"), manager.cookies, desk)).statusCode).toBe(200);
      // Staff with no list to search spend nothing.
      const trainer = await makeStaff(org, owner.cookies, "limit-trainer", "trainer");
      await limits.setex(`rl:console_search_people:id:${trainer.userId}`, 3600, "1200");
      expect((await get(searchUrl(gym, "sam"), trainer.cookies)).statusCode).toBe(200);
    },
    TIMEOUT_MS,
  );
});
