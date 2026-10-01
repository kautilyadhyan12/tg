// Leads from a file — the two routes against real Postgres and the real file worker
// (DATABASE_URL-gated). ROADMAP 20c-iii; spec Part 3 §16.3.
//
// The first test is the worst thing this job could do to a real person: somebody in a
// gym's spreadsheet starts getting follow-up emails they never agreed to. The files are
// shaped as the vendors' own pages show their exports (read 2026-09-27): Glofox's Lead
// Report carries "Opted to Receive Marketing", ABC GymSales' uploader "Email Opted Out".
// Whatever those say, no lead from a file is ticked or due an email.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { addLeadFile, type LeadFileDeps } from "../src/modules/orgs/leads/fileService.js";
import { OrgsError } from "../src/modules/orgs/service.js";
import { createMemoryRedis } from "../src/redis.js";
import {
  LEAD_FILE_CHANGED_ERROR,
  LEADS_MAX_PER_GYM,
  ROLE_PRIVILEGES,
  type LeadFilePreview,
  type LeadsResponse,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "leads-file-routes-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 120_000;
const LIVE_PLAN = "zz_leads_file_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const csv = (lines: string[]): string => Buffer.from(lines.join("\r\n") + "\r\n", "utf8").toString("base64");

/** Glofox's Lead Report, its headings exactly as its help page lists them. */
const GLOFOX_HEADINGS =
  "First Name,Last Name,Email,Phone,Gender,Date of Birth,Zip Code,Lead Source,Last Contacted,Total Bookings,Total Attendances,Lead Status,Membership Name,Membership Plan,Membership Expiry Date,Credits Remaining,Opted to Receive Marketing,Studio Waiver";
/** ABC GymSales' uploader, its importable fields in the order its page gives them. */
const GYMSALES_HEADINGS =
  "First Name,Last Name,Mobile Phone,Home Phone,Work Phone,Email,Address,City,State/Prov,Zip/Postal,Tags,Notes,Marketing Source,Contact Method,Created Date,Status,Salesperson,Trial Start Date,Trial End Date,Sale At,External ID,SMS Opted Out,Email Opted Out,WhatsApp Opted Out";

d("leads from a file (real Postgres, real worker)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'leadf-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'leadf-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, payload: unknown, cookies: Record<string, string>) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Record<string, string>) => send("GET", path, undefined, cookies);
  const post = (path: string, payload: unknown, cookies: Record<string, string>) => send("POST", path, payload, cookies);
  /** The same, from one fixed address: a front desk with several staff signed in. */
  const postFrom = (ip: string, path: string, payload: unknown, cookies: Record<string, string>) =>
    api().inject({ method: "POST", url: path, remoteAddress: ip, cookies, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });

  const makeUser = async (local: string) => {
    const email = `leadf-t-${local}@example.com`;
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
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
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

  const checkUrl = (gymId: string) => `/v1/orgs/${gymId}/leads/from-file/check`;
  const addUrl = (gymId: string) => `/v1/orgs/${gymId}/leads/from-file`;
  const previewOf = (res: { body: string }) => (JSON.parse(res.body) as { preview: LeadFilePreview }).preview;

  const check = async (gymId: string, cookies: Record<string, string>, contentBase64: string, mapping?: LeadFilePreview["mapping"]) => {
    const res = await post(checkUrl(gymId), { contentBase64, ...(mapping === undefined ? {} : { mapping }) }, cookies);
    expect(res.statusCode).toBe(200);
    return previewOf(res);
  };
  const add = (gymId: string, cookies: Record<string, string>, contentBase64: string, preview: LeadFilePreview) =>
    post(addUrl(gymId), { contentBase64, mapping: preview.mapping, expected: preview.expected, permissionConfirmed: true }, cookies);

  /** What is really stored, never what a reply says. */
  const storedLeads = async (gymId: string) =>
    await sql<
      {
        full_name: string;
        email: string | null;
        phone_e164: string | null;
        source: string;
        status: string;
        notes: string;
        email_ok_at: Date | null;
        follow_up_due_on: string | null;
        follow_ups_sent: number;
      }[]
    >`
      SELECT full_name, email::text AS email, phone_e164, source, status, notes, email_ok_at,
             follow_up_due_on::text AS follow_up_due_on, follow_ups_sent
      FROM gym_leads WHERE gym_id = ${gymId} ORDER BY full_name, email`;

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

  // ── THE WORST THING: EMAILS NOBODY AGREED TO ────────────────────────────────────

  it(
    "no lead from a file is ever ticked or due a follow-up email, whatever its opt-in column says",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeOrg(owner.cookies, "Opt In Gym");
      const gym = org.org.id;

      const glofox = csv([
        GLOFOX_HEADINGS,
        "Asha,Rao,asha.rao@example.com,07700900101,Female,1990-04-02,LS1 4AP,Instagram,2026-09-20,0,0,Lead,,,,0,Yes,Signed",
        "Ben,Cole,ben.cole@example.com,07700900102,Male,,LS2 7DA,Walk In,,1,1,Trial,,,,0,TRUE,",
        "Cara,Dunn,cara.dunn@example.com,,,,,Referral,,0,0,Cold,,,,0,1,",
      ]);
      const gymsales = csv([
        GYMSALES_HEADINGS,
        "Dev,Iyer,7700900104,,,dev.iyer@example.com,,,,,,Wants mornings,Facebook,Walk-in,2026-09-01,Enquiry,,,,,,false,false,false",
        "Ella,Fox,7700900105,,,ella.fox@example.com,,,,,,,Google,Internet,2026-09-02,Trial,,,,,,no,n,0",
      ]);

      for (const file of [glofox, gymsales]) {
        const preview = await check(gym, owner.cookies, file);
        expect(preview.needsMapping).toBe(false);
        const res = await add(gym, owner.cookies, file, preview);
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ added: preview.counts.add });
      }

      const stored = await storedLeads(gym);
      expect(stored.map((l) => l.full_name)).toEqual(["Asha Rao", "Ben Cole", "Cara Dunn", "Dev Iyer", "Ella Fox"]);
      for (const lead of stored) {
        expect({ name: lead.full_name, ticked: lead.email_ok_at, due: lead.follow_up_due_on, sent: lead.follow_ups_sent, status: lead.status }).toEqual({
          name: lead.full_name,
          ticked: null,
          due: null,
          sent: 0,
          status: "new",
        });
      }
      // And as the screen reads them: nobody may be emailed, nobody is due.
      const listed = JSON.parse((await get(`/v1/orgs/${gym}/leads`, owner.cookies)).body) as LeadsResponse;
      expect(listed.leads.every((lead) => !lead.mayEmail && lead.followUp.dueOn === null)).toBe(true);
      expect(listed.counts.followUpsDue).toBe(0);
      expect(listed.counts.new).toBe(5);
      // Each address is kept under the invitations' key too, so the list finds its email
      // problems (20c-v-b).
      const key = inviteSettings(loadConfig(baseEnv))?.hmacKey;
      if (key === undefined) throw new Error("invitations are off in the test config");
      const keyed = await sql<{ email: string; email_hmac: string | null }[]>`
        SELECT email::text AS email, email_hmac FROM gym_leads WHERE gym_id = ${gym} ORDER BY email`;
      expect(keyed).toHaveLength(5);
      for (const row of keyed) expect(row.email_hmac).toBe(emailHmac(key, row.email));
    },
    TIMEOUT_MS,
  );

  // ── WHO MAY USE IT ──────────────────────────────────────────────────────────────

  it(
    "nobody outside this gym's ticked staff can check or add a file, and a refusal writes nothing",
    async () => {
      const owner = await makeUser("gate-owner");
      const stranger = await makeUser("gate-stranger");
      const member = await makeUser("gate-member");
      const rival = await makeUser("gate-rival");
      const org = await makeOrg(owner.cookies, "Gate Leads Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Rival File Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      const trainer = await makeStaff(org, owner.cookies, "gate-trainer", "trainer");
      expect(ROLE_PRIVILEGES.trainer).not.toContain("members.confirm");

      const file = csv(["Name,Email,Source", "Gita Patel,gita.patel@example.com,Instagram"]);
      // The positive control: the owner opens both doors (the add is left for later).
      const preview = await check(org.org.id, owner.cookies, file);
      expect(preview.counts.add).toBe(1);

      const outsiders = [
        { who: "a stranger", cookies: stranger.cookies, status: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, status: 404 },
        { who: "this gym's member", cookies: member.cookies, status: 404 },
        { who: "this gym's trainer", cookies: trainer.cookies, status: 403 },
        { who: "nobody signed in", cookies: {}, status: 401 },
      ];
      for (const { who, cookies, status } of outsiders) {
        for (const res of [
          await post(checkUrl(org.org.id), { contentBase64: file }, cookies),
          await add(org.org.id, cookies, file, preview),
        ]) {
          expect({ who, status: res.statusCode }).toEqual({ who, status });
          expect(res.body).not.toContain("gita");
          expect(res.body).not.toContain("Gita");
        }
      }
      expect(await storedLeads(org.org.id)).toEqual([]);
      expect(await storedLeads(rivalOrg.org.id)).toEqual([]);

      // A manager holds the tick; unticked, refused.
      const manager = await makeStaff(org, owner.cookies, "gate-manager", "manager");
      expect((await add(org.org.id, manager.cookies, file, preview)).statusCode).toBe(200);
      expect((await storedLeads(org.org.id)).map((l) => l.full_name)).toEqual(["Gita Patel"]);
      const without = ROLE_PRIVILEGES.manager.filter((p) => p !== "members.confirm");
      const put = await api().inject({
        method: "PUT",
        url: `/v1/orgs/${org.org.id}/staff/${manager.userId}/privileges`,
        remoteAddress: nextIp(),
        cookies: owner.cookies,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ privileges: without }),
      });
      expect(put.statusCode).toBe(200);
      expect((await post(checkUrl(org.org.id), { contentBase64: file }, manager.cookies)).statusCode).toBe(403);
    },
    TIMEOUT_MS,
  );

  it(
    "a body that is not a file and a mapping, or a key that is not one, is refused before anything is read",
    async () => {
      const owner = await makeUser("shape-owner");
      const org = await makeOrg(owner.cookies, "Shape Leads Gym");
      const gym = org.org.id;
      const file = csv(["Name,Email", "Hal Jones,hal@example.com"]);
      const preview = await check(gym, owner.cookies, file);
      const refused = [
        await post(checkUrl(gym), {}, owner.cookies),
        await post(checkUrl(gym), { contentBase64: file, extra: 1 }, owner.cookies),
        await post(checkUrl(gym), { contentBase64: file, mapping: { ...preview.mapping, status: 2 } }, owner.cookies),
        await post(addUrl(gym), { contentBase64: file, mapping: preview.mapping, permissionConfirmed: true }, owner.cookies),
        await post(addUrl(gym), { contentBase64: file, mapping: preview.mapping, expected: "not-a-key", permissionConfirmed: true }, owner.cookies),
        // Without staff's tick that they may store these people's details.
        await post(addUrl(gym), { contentBase64: file, mapping: preview.mapping, expected: preview.expected }, owner.cookies),
        await post(addUrl(gym), { contentBase64: file, mapping: preview.mapping, expected: preview.expected, permissionConfirmed: false }, owner.cookies),
      ];
      for (const res of refused) expect(res.statusCode).toBe(400);
      // Base64 that is not base64 never reaches the reader as some other file.
      const garbled = await post(checkUrl(gym), { contentBase64: "!!!!" }, owner.cookies);
      expect(garbled.statusCode).toBe(400);
      expect((JSON.parse(garbled.body) as { error: string }).error).toBe("invalid_upload");
      // A PDF is refused with words about leads.
      const pdf = await post(checkUrl(gym), { contentBase64: Buffer.from("%PDF-1.7\n1 0 obj\n").toString("base64") }, owner.cookies);
      expect(pdf.statusCode).toBe(400);
      expect((JSON.parse(pdf.body) as { message: string }).message).toContain("leads");
      expect(await storedLeads(gym)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "a gym with no live plan can neither check nor add a file",
    async () => {
      const owner = await makeUser("lapsed-owner");
      const org = await makeOrg(owner.cookies, "Lapsed File Gym");
      const file = csv(["Name,Email", "Ivy King,ivy@example.com"]);
      const preview = await check(org.org.id, owner.cookies, file);
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
      expect((await post(checkUrl(org.org.id), { contentBase64: file }, owner.cookies)).statusCode).toBe(409);
      expect((await add(org.org.id, owner.cookies, file, preview)).statusCode).toBe(409);
      expect(await storedLeads(org.org.id)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  // ── WHO IS ADDED ────────────────────────────────────────────────────────────────

  it(
    "leads already kept are left as they are, members on the list are not added, and everyone else is",
    async () => {
      const owner = await makeUser("groups-owner");
      const org = await makeOrg(owner.cookies, "Groups Leads Gym");
      const gym = org.org.id;
      // Already a lead, with staff's own notes and status.
      const kept = await post(`/v1/orgs/${gym}/leads`, { fullName: "Jo Lane", email: "jo.lane@example.com", source: "walk_in", notes: "Called twice" }, owner.cookies);
      expect(kept.statusCode).toBe(201);
      // On the list: the mother; her son shares her address. And a past member.
      await addEntry(gym, owner.cookies, { fullName: "Kate Moss", email: "family.moss@example.com" });
      const pastId = await addEntry(gym, owner.cookies, { fullName: "Lee Nash", email: "lee.nash@example.com" });
      expect((await send("DELETE", `/v1/orgs/${gym}/member-list/entries/${pastId}`, undefined, owner.cookies)).statusCode).toBeLessThan(300);

      const file = csv([
        "Full Name,Email,Phone,Lead Source,Notes",
        "Jo Lane,JO.LANE@example.com,,Instagram,From the file",
        "Kate Moss,family.moss@example.com,,Walk-in,",
        "Max Moss,family.moss@example.com,,A friend,Kate's son",
        "Lee Nash,lee.nash@example.com,,Google Ads,Used to train here",
        "Nia Obi,nia.obi@example.com,07700900111,Instagram,Evenings only",
        "Nia O.,nia.obi@example.com,,Instagram,",
        "Omar Pike,,,Flyer,",
        ",nobody@example.com,,,",
        "Pat Quinn,,07700 900112,Social media,",
      ]);
      const preview = await check(gym, owner.cookies, file);
      const names = (people: { fullName: string }[]) => people.map((p) => p.fullName);
      expect(names(preview.add)).toEqual(["Max Moss", "Lee Nash", "Nia Obi", "Pat Quinn"]);
      // Everybody not added is named, in the file's order, with the reason and whom
      // they repeat.
      expect(preview.notAdded).toEqual([
        { row: 2, fullName: "Jo Lane", reason: "already_lead", sameAs: null },
        { row: 3, fullName: "Kate Moss", reason: "already_member", sameAs: null },
        { row: 7, fullName: "Nia O.", reason: "repeated", sameAs: "Nia Obi" },
        { row: 8, fullName: "Omar Pike", reason: "no_contact", sameAs: null },
        { row: 9, fullName: "", reason: "no_name", sameAs: null },
      ]);
      expect(preview.counts).toMatchObject({ add: 4, alreadyLead: 1, alreadyMember: 1, twiceInFile: 1, noContact: 1, noName: 1, notAdded: 5 });
      // Each person carries the file's own word beside the source it becomes.
      expect(preview.add.map((p) => [p.fullName, p.source, p.sourceWord])).toEqual([
        ["Max Moss", "friend", null],
        ["Lee Nash", "website", "Google Ads"],
        ["Nia Obi", "social", "Instagram"],
        ["Pat Quinn", "social", null],
      ]);

      const res = await add(gym, owner.cookies, file, preview);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ added: 4 });
      const stored = await storedLeads(gym);
      const byName = new Map(stored.map((l) => [l.full_name, l]));
      // The lead staff kept is untouched.
      expect(byName.get("Jo Lane")).toMatchObject({ notes: "Called twice", source: "walk_in", status: "new" });
      expect(byName.get("Kate Moss")).toBeUndefined();
      expect(byName.get("Max Moss")).toMatchObject({ source: "friend", notes: "Kate's son" });
      expect(byName.get("Lee Nash")).toMatchObject({ source: "website", notes: "Used to train here\nHeard of you from: Google Ads" });
      expect(byName.get("Nia Obi")).toMatchObject({ source: "social", phone_e164: "+447700900111", notes: "Evenings only\nHeard of you from: Instagram" });
      // One of ours is kept as it is, with no note added.
      expect(byName.get("Pat Quinn")).toMatchObject({ source: "social", notes: "" });
      expect(stored).toHaveLength(5);
      // One audit row, a count and no person in it.
      const audit = await sql<{ meta: Record<string, unknown> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.leads_imported'`;
      expect(audit.map((a) => a.meta)).toEqual([{ added: "4" }]);
    },
    TIMEOUT_MS,
  );

  it(
    "another gym's leads and members decide nothing: the same people are added here, and nothing of theirs is said",
    async () => {
      const owner = await makeUser("tenancy-owner");
      const rival = await makeUser("tenancy-rival");
      const org = await makeOrg(owner.cookies, "Tenancy Leads Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Tenancy Rival Gym");
      // The rival holds one of the file's people as a lead and the other as a member.
      expect(
        (await post(`/v1/orgs/${rivalOrg.org.id}/leads`, { fullName: "Wes Young", email: "wes@example.com", source: "other" }, rival.cookies)).statusCode,
      ).toBe(201);
      await addEntry(rivalOrg.org.id, rival.cookies, { fullName: "Xia Zhou", email: "xia@example.com" });

      const file = csv(["Name,Email", "Wes Young,wes@example.com", "Xia Zhou,xia@example.com"]);
      const preview = await check(org.org.id, owner.cookies, file);
      expect(preview.add.map((p) => p.fullName)).toEqual(["Wes Young", "Xia Zhou"]);
      expect(preview.notAdded).toEqual([]);
      expect((await add(org.org.id, owner.cookies, file, preview)).statusCode).toBe(200);
      expect((await storedLeads(org.org.id)).map((l) => l.full_name)).toEqual(["Wes Young", "Xia Zhou"]);
      expect((await storedLeads(rivalOrg.org.id)).map((l) => l.full_name)).toEqual(["Wes Young"]);
    },
    TIMEOUT_MS,
  );

  it(
    "checking and adding are limited per person, and staff of several gyms at one address are not stopped by each other",
    async () => {
      const first = await makeUser("limit-first");
      const second = await makeUser("limit-second");
      const org = await makeOrg(first.cookies, "Limit Leads Gym");
      const other = await makeOrg(second.cookies, "Limit Other Gym");
      const desk = "10.64.0.1";
      const file = csv(["Name,Email", "Yan Abel,yan@example.com"]);
      // The allowance is spent before the file is read, so a body refused straight after
      // it ("!!!!" is no base64) spends it as a real file would, without a worker each.
      const garbled = { contentBase64: "!!!!" };
      for (let i = 1; i <= 30; i++) {
        expect({ i, status: (await postFrom(desk, checkUrl(org.org.id), garbled, first.cookies)).statusCode }).toEqual({ i, status: 400 });
      }
      expect((await postFrom(desk, checkUrl(org.org.id), { contentBase64: file }, first.cookies)).statusCode).toBe(429);
      // Another gym's owner at the same desk still has their own allowance.
      expect((await postFrom(desk, checkUrl(other.org.id), { contentBase64: file }, second.cookies)).statusCode).toBe(200);

      // Add: twenty presses answered (here, as changed), the twenty-first refused.
      const stale = { contentBase64: file, mapping: { sheet: 0, headerRow: 0, fullName: 0, email: [1] }, expected: "0".repeat(64), permissionConfirmed: true };
      for (let i = 1; i <= 20; i++) {
        expect({ i, status: (await postFrom(desk, addUrl(other.org.id), stale, second.cookies)).statusCode }).toEqual({ i, status: 409 });
      }
      expect((await postFrom(desk, addUrl(other.org.id), stale, second.cookies)).statusCode).toBe(429);
      expect(await storedLeads(other.org.id)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "what is added is what was shown: a lead added in between, or a second press, adds nothing",
    async () => {
      const owner = await makeUser("stale-owner");
      const org = await makeOrg(owner.cookies, "Stale Leads Gym");
      const gym = org.org.id;
      const file = csv(["Name,Email", "Quin Reed,quin@example.com", "Rosa Sims,rosa@example.com"]);
      const preview = await check(gym, owner.cookies, file);
      expect(preview.counts.add).toBe(2);

      // Somebody adds one of them by hand before Add is pressed.
      expect((await post(`/v1/orgs/${gym}/leads`, { fullName: "Rosa Sims", email: "rosa@example.com", source: "other" }, owner.cookies)).statusCode).toBe(201);
      const stale = await add(gym, owner.cookies, file, preview);
      expect(stale.statusCode).toBe(409);
      expect((JSON.parse(stale.body) as { error: string }).error).toBe(LEAD_FILE_CHANGED_ERROR);
      expect((await storedLeads(gym)).map((l) => l.full_name)).toEqual(["Rosa Sims"]);

      // A changed mapping under the same key is refused too.
      const again = await check(gym, owner.cookies, file);
      const swapped = await post(
        addUrl(gym),
        { contentBase64: file, mapping: { ...again.mapping, fullName: null }, expected: again.expected, permissionConfirmed: true },
        owner.cookies,
      );
      expect(swapped.statusCode).toBe(409);

      // Pressed twice at once: one adds, the other adds nothing — answered "0 added" once
      // the first has added them, or busy while the first is still reading the file (one
      // file a gym at a time).
      const both = await Promise.all([add(gym, owner.cookies, file, again), add(gym, owner.cookies, file, again)]);
      const answers = both.map((r) => [r.statusCode, r.statusCode === 200 ? (JSON.parse(r.body) as { added: number }).added : null]);
      expect(answers).toContainEqual([200, 1]);
      expect(answers.filter(([code, added]) => !(code === 200 && added === 1))).toSatisfy((rest: unknown[][]) =>
        rest.length === 1 && ((rest[0]?.[0] === 200 && rest[0][1] === 0) || rest[0]?.[0] === 429),
      );
      // Pressed again afterwards: nothing added, and said so truly.
      const later = await add(gym, owner.cookies, file, again);
      expect([later.statusCode, JSON.parse(later.body)]).toEqual([200, { added: 0 }]);
      expect((await storedLeads(gym)).map((l) => l.full_name)).toEqual(["Quin Reed", "Rosa Sims"]);
    },
    TIMEOUT_MS,
  );

  it(
    "Add checks again under the gym's lock: a lead or a member arriving after the file is read stops it whole",
    async () => {
      const owner = await makeUser("lock-owner");
      const org = await makeOrg(owner.cookies, "Lock Leads Gym");
      const gym = org.org.id;
      const file = csv(["Name,Email", "Uri Vale,uri@example.com", "Val West,val@example.com"]);
      const preview = await check(gym, owner.cookies, file);
      const body = { contentBase64: file, mapping: preview.mapping, expected: preview.expected, permissionConfirmed: true as const };
      const deps = (beforeAddLock: () => Promise<void>): LeadFileDeps => ({
        sql,
        redis: createMemoryRedis(),
        log: { warn: () => undefined },
        addressKey: null,
        beforeAddLock,
      });
      const refusal = async (between: () => Promise<void>) => {
        try {
          await addLeadFile(deps(between), owner.userId, gym, body, () => Promise.resolve(true));
        } catch (err) {
          return err instanceof OrgsError ? { status: err.statusCode, code: err.code } : { thrown: String(err) };
        }
        return "added";
      };

      // A lead with one of the file's addresses, added between the read and the lock.
      expect(
        await refusal(async () => {
          await sql`INSERT INTO gym_leads (gym_id, full_name, email, source) VALUES (${gym}, 'Val West', 'val@example.com', 'walk_in')`;
        }),
      ).toEqual({ status: 409, code: LEAD_FILE_CHANGED_ERROR });
      expect((await storedLeads(gym)).map((l) => l.full_name)).toEqual(["Val West"]);

      // A member with one of the file's names and addresses: they would no longer be added.
      await sql`DELETE FROM gym_leads WHERE gym_id = ${gym}`;
      expect(
        await refusal(async () => {
          await addEntry(gym, owner.cookies, { fullName: "Uri Vale", email: "uri@example.com" });
        }),
      ).toEqual({ status: 409, code: LEAD_FILE_CHANGED_ERROR });
      expect(await storedLeads(gym)).toEqual([]);

      // Another transaction holding the gym's lock while it adds one of the file's people:
      // Add waits for it, then sees them. Without the lock Add would read before that
      // commit and run into the unique address instead.
      await sql`DELETE FROM gym_member_list_entries WHERE gym_id = ${gym}`;
      let other: Promise<unknown> = Promise.resolve();
      expect(
        await refusal(async () => {
          let held: () => void = () => undefined;
          const holding = new Promise<void>((resolve) => {
            held = resolve;
          });
          other = sql.begin(async (tx) => {
            await tx`SELECT 1 FROM gyms WHERE id = ${gym} FOR UPDATE`;
            await tx`INSERT INTO gym_leads (gym_id, full_name, email, source) VALUES (${gym}, 'Val West', 'val@example.com', 'walk_in')`;
            held();
            await new Promise((resolve) => setTimeout(resolve, 500));
          });
          await holding;
        }),
      ).toEqual({ status: 409, code: LEAD_FILE_CHANGED_ERROR });
      await other;
      expect((await storedLeads(gym)).map((l) => l.full_name)).toEqual(["Val West"]);
      await sql`DELETE FROM gym_leads WHERE gym_id = ${gym}`;

      // The positive control: nothing in between, the same call adds.
      await sql`DELETE FROM gym_member_list_entries WHERE gym_id = ${gym}`;
      expect(await refusal(() => Promise.resolve())).toBe("added");
      expect((await storedLeads(gym)).map((l) => l.full_name)).toEqual(["Uri Vale", "Val West"]);
    },
    TIMEOUT_MS,
  );

  it(
    "a file that would take the gym past its leads is refused whole",
    async () => {
      const owner = await makeUser("full-owner");
      const org = await makeOrg(owner.cookies, "Full Leads Gym");
      const gym = org.org.id;
      await sql`
        INSERT INTO gym_leads (gym_id, full_name, email, source)
        SELECT ${gym}, 'Filler ' || n, 'filler' || n || '@example.com', 'other'
        FROM generate_series(1, ${LEADS_MAX_PER_GYM - 1}) AS n`;
      const file = csv(["Name,Email", "Sam Todd,sam@example.com", "Tia Upton,tia@example.com"]);
      const preview = await check(gym, owner.cookies, file);
      expect(preview.room).toBe(1);
      const res = await add(gym, owner.cookies, file, preview);
      expect(res.statusCode).toBe(409);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("leads_full");
      const counted = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_leads WHERE gym_id = ${gym}`;
      expect(counted[0]?.n).toBe(LEADS_MAX_PER_GYM - 1);
    },
    TIMEOUT_MS,
  );

  // ── THE FILE'S COLUMNS ──────────────────────────────────────────────────────────

  it(
    "a column never kept shows no cell and can never be chosen, whatever staff pick",
    async () => {
      const owner = await makeUser("cols-owner");
      const org = await makeOrg(owner.cookies, "Columns Leads Gym");
      const gym = org.org.id;
      const file = csv([
        "Name,Email,Heard about us,Card Number,Medical Notes",
        "Uma Vance,uma@example.com,Instagram,4111 1111 1111 1111,Asthma",
        "Vic Wren,vic@example.com,Walk in,5500 0000 0000 0004,Bad knee",
      ]);
      const first = await check(gym, owner.cookies, file);
      const byHeader = new Map(first.columns.map((c) => [c.header, c]));
      expect(byHeader.get("Medical Notes")?.neverKept).toBe("medical");
      expect(byHeader.get("Medical Notes")?.samples).toEqual([]);
      expect(byHeader.get("Heard about us")?.guess).toBe("source");
      expect(JSON.stringify(first)).not.toContain("Asthma");
      expect(JSON.stringify(first)).not.toContain("4111");

      // Staff choose: the card column as the notes, the medical one as the source.
      const cardAt = first.columns.findIndex((c) => c.header === "Card Number");
      const medicalAt = first.columns.findIndex((c) => c.header === "Medical Notes");
      const mapping = { ...first.mapping, fullName: 0, email: [1], notes: cardAt, source: medicalAt };
      const chosen = await check(gym, owner.cookies, file, mapping);
      expect(chosen.needsMapping).toBe(false);
      expect(chosen.mapping.source).toBeNull();
      expect(chosen.counts.add).toBe(2);
      const res = await add(gym, owner.cookies, file, chosen);
      expect(res.statusCode).toBe(200);
      const stored = await storedLeads(gym);
      expect(stored.map((l) => l.notes)).toEqual(["", ""]);
      expect(JSON.stringify(stored)).not.toContain("Asthma");
      expect(JSON.stringify(stored)).not.toContain("1111");
    },
    TIMEOUT_MS,
  );

  it(
    "Add pressed again after it worked (its answer lost on the way) says nothing was added, truly, and adds nobody twice",
    async () => {
      const owner = await makeUser("again-owner");
      const org = await makeOrg(owner.cookies, "Again File Gym");
      const file = csv(["Name,Email", "Ana Again,ana.again@example.com", "Bo Again,bo.again@example.com"]);
      const preview = await check(org.org.id, owner.cookies, file);
      const first = await add(org.org.id, owner.cookies, file, preview);
      expect([first.statusCode, JSON.parse(first.body)]).toEqual([200, { added: 2 }]);
      const again = await add(org.org.id, owner.cookies, file, preview);
      expect([again.statusCode, JSON.parse(again.body)]).toEqual([200, { added: 0 }]);
      expect((await storedLeads(org.org.id)).length).toBe(2);
    },
    TIMEOUT_MS,
  );
});
