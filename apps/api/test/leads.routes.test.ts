// A gym's leads — routes against real Postgres (DATABASE_URL-gated). ROADMAP 20c-i;
// spec Part 3 §16.3.
//
// The first block is the worst thing this job could do to a real person: one gym's
// leads (names, emails, phone numbers) seen or changed by somebody outside that gym's
// ticked staff. Every refusal is checked against the database, and every door is
// first opened by the owner, so a missing route cannot pass for a refusal.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { archiveLapsedGyms } from "../src/modules/orgs/archiveSweep.js";
import { LEADS_PAGE, ROLE_PRIVILEGES, type Lead, type LeadsResponse } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "leads-routes-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 90_000;
/** INR, as the other route suites: the orgs suite owns the GBP "no price book" case. */
const LIVE_PLAN = "zz_leads_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.62.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("a gym's leads (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'lead-t-%@example.com')`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'lead-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", path: string, payload: unknown, cookies: Record<string, string>) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Record<string, string>) => send("GET", path, undefined, cookies);
  const post = (path: string, payload: unknown, cookies: Record<string, string>) => send("POST", path, payload, cookies);
  const patch = (path: string, payload: unknown, cookies: Record<string, string>) => send("PATCH", path, payload, cookies);
  const del = (path: string, cookies: Record<string, string>) => send("DELETE", path, undefined, cookies);

  const makeUser = async (local: string) => {
    const email = `lead-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Lead ${local}` }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
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

  const joinAsMember = async (memberCookies: Record<string, string>, org: CreatedOrg, staffCookies: Record<string, string>) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staffCookies)).statusCode).toBe(200);
  };

  const makeStaff = async (org: CreatedOrg, owner: Record<string, string>, local: string, role: "manager" | "trainer") => {
    const person = await makeUser(local);
    await joinAsMember(person.cookies, org, owner);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role }, owner)).statusCode).toBe(201);
    return person;
  };

  const leadsUrl = (gymId: string) => `/v1/orgs/${gymId}/leads`;
  const leadUrl = (gymId: string, leadId: string) => `${leadsUrl(gymId)}/${leadId}`;
  const joinUrl = (gymId: string, leadId: string) => `${leadUrl(gymId, leadId)}/join`;
  const leadOf = (res: { body: string }) => (JSON.parse(res.body) as { lead: Lead }).lead;
  const pageOf = (res: { body: string }) => JSON.parse(res.body) as LeadsResponse;

  const addLead = async (gymId: string, cookies: Record<string, string>, over: Record<string, unknown> = {}) => {
    const res = await post(leadsUrl(gymId), { fullName: "Priya Shah", email: "priya@example.com", source: "walk_in", ...over }, cookies);
    expect(res.statusCode).toBe(201);
    return leadOf(res);
  };

  /** What is really stored, never what a reply says. */
  const storedLeads = async (gymId: string) =>
    await sql<{ id: string; full_name: string; email: string | null; status: string; notes: string; entry_id: string | null }[]>`
      SELECT id, full_name, email::text AS email, status, notes, entry_id FROM gym_leads WHERE gym_id = ${gymId} ORDER BY created_at, id`;
  const storedEntries = async (gymId: string) =>
    await sql<{ id: string; full_name: string; email: string | null; former: boolean }[]>`
      SELECT id, full_name, email::text AS email, (former_at IS NOT NULL) AS former
      FROM gym_member_list_entries WHERE gym_id = ${gymId} ORDER BY full_name, id`;

  const addEntry = async (gymId: string, cookies: Record<string, string>, body: Record<string, unknown>) => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, body, cookies);
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

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
    });
    await api().ready();
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  // ── THE WORST THING: SOMEBODY ELSE'S LEADS ─────────────────────────────────

  it(
    "nobody outside this gym's ticked staff can list, read, add, change, join or delete its leads, and every refusal writes nothing",
    async () => {
      const owner = await makeUser("worst-owner");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Worst Leads Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Rival Leads Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      const trainer = await makeStaff(org, owner.cookies, "worst-trainer", "trainer");
      expect(ROLE_PRIVILEGES.trainer).not.toContain("members.confirm");

      // The positive control: the owner opens every door.
      const lead = await addLead(org.org.id, owner.cookies, { notes: "Asked about personal training" });
      expect((await get(leadsUrl(org.org.id), owner.cookies)).statusCode).toBe(200);
      expect((await get(leadUrl(org.org.id, lead.id), owner.cookies)).statusCode).toBe(200);
      const rivalLead = await addLead(rivalOrg.org.id, rival.cookies, { fullName: "Rival Person", email: "rival.lead@example.com" });
      const before = await storedLeads(org.org.id);
      const rivalBefore = await storedLeads(rivalOrg.org.id);

      const outsiders = [
        { who: "a stranger", cookies: stranger.cookies, status: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, status: 404 },
        { who: "this gym's member", cookies: member.cookies, status: 404 },
        { who: "this gym's trainer", cookies: trainer.cookies, status: 403 },
        { who: "nobody signed in", cookies: {}, status: 401 },
      ];
      for (const { who, cookies, status } of outsiders) {
        const answers = [
          await get(leadsUrl(org.org.id), cookies),
          await get(`${leadsUrl(org.org.id)}?q=priya`, cookies),
          await get(leadUrl(org.org.id, lead.id), cookies),
          await post(leadsUrl(org.org.id), { fullName: "Snoop", email: "snoop@example.com", source: "other" }, cookies),
          await patch(leadUrl(org.org.id, lead.id), { status: "lost", notes: "gone" }, cookies),
          await post(joinUrl(org.org.id, lead.id), {}, cookies),
          await del(leadUrl(org.org.id, lead.id), cookies),
        ];
        for (const res of answers) {
          expect({ who, status: res.statusCode }).toEqual({ who, status });
          // No name, email or phone in any refusal.
          expect(res.body).not.toContain("priya");
          expect(res.body).not.toContain("Priya");
        }
      }
      expect(await storedLeads(org.org.id)).toEqual(before);
      expect(await storedEntries(org.org.id)).toEqual([]);

      // A rival's lead id under this gym's address, and this gym's under the rival's: 404.
      expect((await get(leadUrl(org.org.id, rivalLead.id), owner.cookies)).statusCode).toBe(404);
      expect((await patch(leadUrl(org.org.id, rivalLead.id), { status: "lost" }, owner.cookies)).statusCode).toBe(404);
      expect((await post(joinUrl(org.org.id, rivalLead.id), {}, owner.cookies)).statusCode).toBe(404);
      expect((await del(leadUrl(org.org.id, rivalLead.id), owner.cookies)).statusCode).toBe(404);
      expect((await get(leadUrl(rivalOrg.org.id, lead.id), rival.cookies)).statusCode).toBe(404);
      expect(await storedLeads(rivalOrg.org.id)).toEqual(rivalBefore);
      // The owner's list holds only this gym's lead.
      const listed = pageOf(await get(leadsUrl(org.org.id), owner.cookies));
      expect(listed.leads.map((l) => l.id)).toEqual([lead.id]);
      expect(listed.counts.all).toBe(1);
    },
    TIMEOUT_MS,
  );

  it(
    "a manager holds the tick and may keep leads; unticked, they are refused",
    async () => {
      const owner = await makeUser("tick-owner");
      const org = await makeOrg(owner.cookies, "Tick Leads Gym");
      const manager = await makeStaff(org, owner.cookies, "tick-manager", "manager");
      const lead = await addLead(org.org.id, manager.cookies);
      expect((await get(leadsUrl(org.org.id), manager.cookies)).statusCode).toBe(200);

      const without = ROLE_PRIVILEGES.manager.filter((p) => p !== "members.confirm");
      expect(
        (await send("PUT", `/v1/orgs/${org.org.id}/staff/${manager.userId}/privileges`, { privileges: without }, owner.cookies)).statusCode,
      ).toBe(200);
      expect((await get(leadsUrl(org.org.id), manager.cookies)).statusCode).toBe(403);
      expect((await patch(leadUrl(org.org.id, lead.id), { status: "lost" }, manager.cookies)).statusCode).toBe(403);
      expect((await storedLeads(org.org.id))[0]?.status).toBe("new");
    },
    TIMEOUT_MS,
  );

  // ── KEEPING THE LIST ───────────────────────────────────────────────────────

  it(
    "add, list with counts, search, filter by status, change and delete",
    async () => {
      const owner = await makeUser("keep-owner");
      const org = await makeOrg(owner.cookies, "Keep Leads Gym");
      const gym = org.org.id;
      const priya = await addLead(gym, owner.cookies, { email: "Priya@Example.com", phone: "07700 900123", notes: "  Mornings  " });
      expect(priya).toMatchObject({
        fullName: "Priya Shah",
        email: "priya@example.com",
        phone: "+447700900123",
        source: "walk_in",
        status: "new",
        notes: "Mornings",
        entryId: null,
      });
      const tom = await addLead(gym, owner.cookies, { fullName: "Tom Reid", email: undefined, phone: "+44 7700 900456", source: "friend" });
      await addLead(gym, owner.cookies, { fullName: "Ana Silva", email: "ana_silva@example.com", source: "social" });

      const all = pageOf(await get(leadsUrl(gym), owner.cookies));
      expect(all.total).toBe(3);
      expect(all.leads.map((l) => l.fullName)).toEqual(["Ana Silva", "Tom Reid", "Priya Shah"]);
      expect(all.counts).toEqual({ all: 3, new: 3, contacted: 0, on_trial: 0, joined: 0, lost: 0 });
      expect(all.cursor).toBeNull();

      const moved = await patch(leadUrl(gym, tom.id), { status: "on_trial", notes: "Trial week from Monday" }, owner.cookies);
      expect(moved.statusCode).toBe(200);
      expect(leadOf(moved)).toMatchObject({ status: "on_trial", notes: "Trial week from Monday", phone: "+447700900456" });
      expect(Date.parse(leadOf(moved).statusChangedAt)).toBeGreaterThanOrEqual(Date.parse(tom.statusChangedAt));

      const onTrial = pageOf(await get(`${leadsUrl(gym)}?status=on_trial`, owner.cookies));
      expect(onTrial.leads.map((l) => l.id)).toEqual([tom.id]);
      expect(onTrial.counts.on_trial).toBe(1);
      expect(onTrial.counts.all).toBe(3);

      expect(pageOf(await get(`${leadsUrl(gym)}?q=SHAH`, owner.cookies)).leads.map((l) => l.id)).toEqual([priya.id]);
      expect(pageOf(await get(`${leadsUrl(gym)}?q=900456`, owner.cookies)).leads.map((l) => l.id)).toEqual([tom.id]);
      // "_" is a letter here, not a LIKE wildcard.
      expect(pageOf(await get(`${leadsUrl(gym)}?q=a_s`, owner.cookies)).leads.map((l) => l.fullName)).toEqual(["Ana Silva"]);
      expect(pageOf(await get(`${leadsUrl(gym)}?q=nobody`, owner.cookies)).total).toBe(0);

      expect((await del(leadUrl(gym, priya.id), owner.cookies)).statusCode).toBe(204);
      expect((await del(leadUrl(gym, priya.id), owner.cookies)).statusCode).toBe(404);
      expect((await storedLeads(gym)).map((l) => l.full_name).sort()).toEqual(["Ana Silva", "Tom Reid"]);
    },
    TIMEOUT_MS,
  );

  it(
    "\"Happy to hear from us\" is a yes to one email address: refused without one, kept while it stays, cleared when it changes",
    async () => {
      const owner = await makeUser("tick-lead-owner");
      const org = await makeOrg(owner.cookies, "Tick Lead Gym");
      const gym = org.org.id;
      const okAt = async (id: string) =>
        (await sql<{ at: Date | null }[]>`SELECT email_ok_at AS at FROM gym_leads WHERE gym_id = ${gym} AND id = ${id}`)[0]?.at ?? null;

      const noEmail = await post(leadsUrl(gym), { fullName: "Tom Reid", phone: "07700900456", source: "friend", mayEmail: true }, owner.cookies);
      expect({ status: noEmail.statusCode, error: (JSON.parse(noEmail.body) as { error: string }).error }).toEqual({ status: 400, error: "needs_email" });

      const unticked = await addLead(gym, owner.cookies, { fullName: "Ana Silva", email: "ana@example.com" });
      expect(unticked.mayEmail).toBe(false);
      expect(await okAt(unticked.id)).toBeNull();

      const ticked = await addLead(gym, owner.cookies, { mayEmail: true });
      expect(ticked.mayEmail).toBe(true);
      const first = await okAt(ticked.id);
      expect(first).not.toBeNull();

      // A note or a status leaves it, and the same address in another case is the same address.
      expect(leadOf(await patch(leadUrl(gym, ticked.id), { notes: "Evenings", status: "contacted" }, owner.cookies)).mayEmail).toBe(true);
      expect(leadOf(await patch(leadUrl(gym, ticked.id), { email: "PRIYA@example.com" }, owner.cookies)).mayEmail).toBe(true);
      expect(await okAt(ticked.id)).toEqual(first);
      // A new address was never said yes to.
      expect(leadOf(await patch(leadUrl(gym, ticked.id), { email: "priya.new@example.com" }, owner.cookies)).mayEmail).toBe(false);
      // Ticked again with the new address, then unticked.
      expect(leadOf(await patch(leadUrl(gym, ticked.id), { mayEmail: true }, owner.cookies)).mayEmail).toBe(true);
      expect(leadOf(await patch(leadUrl(gym, ticked.id), { mayEmail: false }, owner.cookies)).mayEmail).toBe(false);
      // The email removed takes the tick with it, and a tick with no email is refused.
      await patch(leadUrl(gym, ticked.id), { mayEmail: true, phone: "07700900999" }, owner.cookies);
      expect(leadOf(await patch(leadUrl(gym, ticked.id), { email: null }, owner.cookies)).mayEmail).toBe(false);
      expect((await patch(leadUrl(gym, ticked.id), { mayEmail: true }, owner.cookies)).statusCode).toBe(400);
      expect(await okAt(ticked.id)).toBeNull();
    },
    TIMEOUT_MS,
  );

  it(
    "a page holds 100, and the cursor brings the rest without repeats",
    async () => {
      const owner = await makeUser("page-owner");
      const org = await makeOrg(owner.cookies, "Page Leads Gym");
      const gym = org.org.id;
      await sql`
        INSERT INTO gym_leads (gym_id, full_name, email, source, created_at)
        SELECT ${gym}, 'Person ' || n, 'p' || n || '@example.com', 'website', now() - (n || ' minutes')::interval
        FROM generate_series(1, ${LEADS_PAGE + 5}) AS n`;
      const first = pageOf(await get(leadsUrl(gym), owner.cookies));
      expect(first.leads).toHaveLength(LEADS_PAGE);
      expect(first.total).toBe(LEADS_PAGE + 5);
      if (first.cursor === null) throw new Error("no cursor on a full page");
      const second = pageOf(await get(`${leadsUrl(gym)}?cursor=${encodeURIComponent(first.cursor)}`, owner.cookies));
      expect(second.leads).toHaveLength(5);
      expect(second.cursor).toBeNull();
      const ids = [...first.leads, ...second.leads].map((l) => l.id);
      expect(new Set(ids).size).toBe(LEADS_PAGE + 5);
      expect((await get(`${leadsUrl(gym)}?cursor=not-a-cursor`, owner.cookies)).statusCode).toBe(400);
    },
    TIMEOUT_MS,
  );

  it(
    "refuses what cannot be kept, and says why",
    async () => {
      const owner = await makeUser("refuse-owner");
      const org = await makeOrg(owner.cookies, "Refuse Leads Gym");
      const gym = org.org.id;
      const refused = async (body: Record<string, unknown>, code: string, status = 400) => {
        const res = await post(leadsUrl(gym), { fullName: "Priya Shah", source: "walk_in", ...body }, owner.cookies);
        expect({ code: (JSON.parse(res.body) as { error: string }).error, status: res.statusCode }).toEqual({ code, status });
      };
      await refused({}, "needs_contact");
      await refused({ fullName: "   ", email: "p@example.com" }, "needs_name");
      await refused({ email: "not-an-address" }, "bad_email");
      await refused({ phone: "12" }, "bad_phone");
      await refused({ email: "p@example.com", notes: "Paid with 4111 1111 1111 1111" }, "notes_card");
      await refused({ email: "p@example.com", source: "billboard" }, "validation_error");
      await refused({ email: "p@example.com", status: "joined" }, "validation_error");
      expect(await storedLeads(gym)).toEqual([]);

      const lead = await addLead(gym, owner.cookies, { phone: "07700900777" });
      await refused({ fullName: "Somebody Else", email: "PRIYA@example.com" }, "lead_exists", 409);
      await refused({ fullName: "Somebody Else", email: "x@example.com", phone: "+447700900777" }, "lead_exists", 409);
      // "Joined" is set by Joined alone.
      expect((await patch(leadUrl(gym, lead.id), { status: "joined" }, owner.cookies)).statusCode).toBe(400);
      expect((await patch(leadUrl(gym, lead.id), {}, owner.cookies)).statusCode).toBe(400);
      expect((await storedLeads(gym)).map((l) => l.status)).toEqual(["new"]);
    },
    TIMEOUT_MS,
  );

  it(
    "a gym with no live plan can read its leads and change nothing",
    async () => {
      const owner = await makeUser("lapsed-owner");
      const org = await makeOrg(owner.cookies, "Lapsed Leads Gym");
      const lead = await addLead(org.org.id, owner.cookies);
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
      expect((await get(leadsUrl(org.org.id), owner.cookies)).statusCode).toBe(200);
      const refused = await patch(leadUrl(org.org.id, lead.id), { status: "lost" }, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect((await post(joinUrl(org.org.id, lead.id), {}, owner.cookies)).statusCode).toBe(409);
      expect((await storedLeads(org.org.id))[0]?.status).toBe("new");
    },
    TIMEOUT_MS,
  );

  // ── JOINED ─────────────────────────────────────────────────────────────────

  it(
    "Joined makes a record from the lead, and pressing it again changes nothing",
    async () => {
      const owner = await makeUser("join-new-owner");
      const org = await makeOrg(owner.cookies, "Join New Gym");
      const gym = org.org.id;
      const lead = await addLead(gym, owner.cookies, { phone: "07700900321" });
      const res = await post(joinUrl(gym, lead.id), {}, owner.cookies);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { lead: Lead; outcome: string };
      expect(body.outcome).toBe("added");
      const entries = await storedEntries(gym);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ full_name: "Priya Shah", email: "priya@example.com", former: false });
      expect(body.lead).toMatchObject({ status: "joined", entryId: entries[0]?.id });

      const again = await post(joinUrl(gym, lead.id), {}, owner.cookies);
      expect(again.statusCode).toBe(200);
      expect((JSON.parse(again.body) as { outcome: string }).outcome).toBe("already_joined");
      expect(await storedEntries(gym)).toHaveLength(1);

      // Moved off Joined, the link goes; the record stays on the list.
      const lost = await patch(leadUrl(gym, lead.id), { status: "lost" }, owner.cookies);
      expect(leadOf(lost)).toMatchObject({ status: "lost", entryId: null });
      expect(await storedEntries(gym)).toHaveLength(1);
    },
    TIMEOUT_MS,
  );

  it(
    "the same email and name already on the list: linked, never a second copy",
    async () => {
      const owner = await makeUser("join-link-owner");
      const org = await makeOrg(owner.cookies, "Join Link Gym");
      const gym = org.org.id;
      const entryId = await addEntry(gym, owner.cookies, { fullName: "priya shah", email: "priya@example.com", phone: "+447700900111" });
      const lead = await addLead(gym, owner.cookies, { email: "PRIYA@example.com" });
      const res = await post(joinUrl(gym, lead.id), {}, owner.cookies);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ outcome: "linked", lead: { entryId, status: "joined" } });
      expect(await storedEntries(gym)).toHaveLength(1);
    },
    TIMEOUT_MS,
  );

  it(
    "a son whose email is his mother's is never put on the list as her: staff choose",
    async () => {
      const owner = await makeUser("join-family-owner");
      const org = await makeOrg(owner.cookies, "Join Family Gym");
      const gym = org.org.id;
      const mother = await addEntry(gym, owner.cookies, { fullName: "Priya Shah", email: "shah.family@example.com" });
      const son = await addLead(gym, owner.cookies, { fullName: "Arjun Shah", email: "shah.family@example.com" });

      const asked = await post(joinUrl(gym, son.id), {}, owner.cookies);
      expect(asked.statusCode).toBe(409);
      const choice = JSON.parse(asked.body) as { error: string; candidates: { entryId: string; fullName: string; former: boolean }[] };
      expect(choice.error).toBe("lead_join_choose");
      expect(choice.candidates).toEqual([expect.objectContaining({ entryId: mother, fullName: "Priya Shah", former: false })]);
      expect((await storedLeads(gym))[0]).toMatchObject({ status: "new", entry_id: null });
      expect(await storedEntries(gym)).toHaveLength(1);

      // A record that does not share the contact cannot be chosen.
      const stranger = await addEntry(gym, owner.cookies, { fullName: "Arjun Shah", email: "someone.else@example.com" });
      const stale = await post(joinUrl(gym, son.id), { entryId: stranger }, owner.cookies);
      expect(stale.statusCode).toBe(409);
      expect((JSON.parse(stale.body) as { error: string }).error).toBe("lead_join_stale");
      // Nor can another gym's record.
      const rival = await makeUser("join-family-rival");
      const rivalOrg = await makeOrg(rival.cookies, "Join Family Rival");
      const rivalEntry = await addEntry(rivalOrg.org.id, rival.cookies, { fullName: "Arjun Shah", email: "shah.family@example.com" });
      expect((await post(joinUrl(gym, son.id), { entryId: rivalEntry }, owner.cookies)).statusCode).toBe(409);
      expect((await storedLeads(gym))[0]).toMatchObject({ status: "new", entry_id: null });

      // "Someone new": his own record, beside his mother's.
      const added = await post(joinUrl(gym, son.id), { asNew: true }, owner.cookies);
      expect(added.statusCode).toBe(200);
      expect((JSON.parse(added.body) as { outcome: string }).outcome).toBe("added");
      const entries = await storedEntries(gym);
      expect(entries.map((e) => e.full_name)).toEqual(["Arjun Shah", "Arjun Shah", "Priya Shah"]);
      const own = entries.find((e) => e.full_name === "Arjun Shah" && e.email === "shah.family@example.com");
      expect((await storedLeads(gym))[0]).toMatchObject({ status: "joined", entry_id: own?.id });
      expect(own?.id).not.toBe(mother);
    },
    TIMEOUT_MS,
  );

  it(
    "staff choose the record that is this person; a record taken off the list is put back",
    async () => {
      const owner = await makeUser("join-choose-owner");
      const org = await makeOrg(owner.cookies, "Join Choose Gym");
      const gym = org.org.id;
      const listed = await addEntry(gym, owner.cookies, { fullName: "Shah, Priya", email: "priya@example.com" });
      const lead = await addLead(gym, owner.cookies);
      const chosen = await post(joinUrl(gym, lead.id), { entryId: listed }, owner.cookies);
      expect(chosen.statusCode).toBe(200);
      expect(JSON.parse(chosen.body)).toMatchObject({ outcome: "linked", lead: { entryId: listed } });

      const former = await addEntry(gym, owner.cookies, { fullName: "Tom Reid", phone: "+447700900222" });
      expect((await del(`/v1/orgs/${gym}/member-list/entries/${former}`, owner.cookies)).statusCode).toBe(200);
      const tom = await addLead(gym, owner.cookies, { fullName: "Tom Reid", email: undefined, phone: "07700 900222" });
      const asked = await post(joinUrl(gym, tom.id), {}, owner.cookies);
      expect(asked.statusCode).toBe(409);
      expect((JSON.parse(asked.body) as { candidates: { former: boolean }[] }).candidates).toEqual([expect.objectContaining({ former: true })]);
      const back = await post(joinUrl(gym, tom.id), { entryId: former }, owner.cookies);
      expect(back.statusCode).toBe(200);
      expect((JSON.parse(back.body) as { outcome: string }).outcome).toBe("restored");
      expect((await storedEntries(gym)).find((e) => e.id === former)?.former).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    "joining two records moves a lead's link to the one kept; deleting a record for good clears it",
    async () => {
      const owner = await makeUser("join-merge-owner");
      const org = await makeOrg(owner.cookies, "Join Merge Gym");
      const gym = org.org.id;
      const lead = await addLead(gym, owner.cookies);
      expect((await post(joinUrl(gym, lead.id), {}, owner.cookies)).statusCode).toBe(200);
      const made = (await storedLeads(gym))[0]?.entry_id;
      if (made === null || made === undefined) throw new Error("the join linked no record");
      const keep = await addEntry(gym, owner.cookies, { fullName: "Priya Shah", phone: "+447700900555" });

      // Staff open the record they do not want (the lead's) and keep the other.
      const merged = await post(`/v1/orgs/${gym}/member-list/entries/${made}/merge`, { keepEntryId: keep }, owner.cookies);
      expect(merged.statusCode).toBe(200);
      expect((await storedLeads(gym))[0]).toMatchObject({ status: "joined", entry_id: keep });

      expect((await del(`/v1/orgs/${gym}/member-list/entries/${keep}`, owner.cookies)).statusCode).toBe(200);
      expect((await del(`/v1/orgs/${gym}/member-list/former/${keep}`, owner.cookies)).statusCode).toBe(200);
      expect(await storedEntries(gym)).toEqual([]);
      expect((await storedLeads(gym))[0]).toMatchObject({ status: "joined", entry_id: null });
      // A joined lead whose record is gone can be joined again.
      const again = await post(joinUrl(gym, lead.id), {}, owner.cookies);
      expect(JSON.parse(again.body)).toMatchObject({ outcome: "added" });
    },
    TIMEOUT_MS,
  );

  it(
    "a gym closed by the archive sweep loses its leads in the same step as its list",
    async () => {
      const owner = await makeUser("closed-owner");
      const org = await makeOrg(owner.cookies, "Closing Leads Gym");
      const lead = await addLead(org.org.id, owner.cookies);
      expect((await post(joinUrl(org.org.id, lead.id), {}, owner.cookies)).statusCode).toBe(200);
      await addLead(org.org.id, owner.cookies, { fullName: "Tom Reid", email: "tom@example.com" });
      // Ended five months ago: the sweep counts four months from the plan's end.
      await sql`
        UPDATE subscriptions SET status = 'canceled', ended_at = now() - interval '5 months'
        WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
      await archiveLapsedGyms({ sql, log: { info: () => undefined } }, { gymIds: [org.org.id] });
      expect((await sql<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${org.org.id}`)[0]?.status).toBe("archived");
      expect(await storedLeads(org.org.id)).toEqual([]);
      expect(await storedEntries(org.org.id)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "the database refuses a lead linked to another gym's record",
    async () => {
      const owner = await makeUser("fk-owner");
      const rival = await makeUser("fk-rival");
      const org = await makeOrg(owner.cookies, "FK Leads Gym");
      const rivalOrg = await makeOrg(rival.cookies, "FK Rival Gym");
      const lead = await addLead(org.org.id, owner.cookies);
      const rivalEntry = await addEntry(rivalOrg.org.id, rival.cookies, { fullName: "Priya Shah", email: "priya@example.com" });
      await expect(
        sql`UPDATE gym_leads SET status = 'joined', entry_id = ${rivalEntry} WHERE id = ${lead.id}`,
      ).rejects.toThrow(/gym_leads_entry_fk/);
    },
    TIMEOUT_MS,
  );
});
