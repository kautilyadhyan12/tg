// "Send them for me": the app sends a lead's three follow-up emails itself — routes and
// the worker's sender against real Postgres (DATABASE_URL-gated). ROADMAP 20c-v-a; spec
// Part 3 §16.3; RULINGS 2026-09-27.
//
// The first block is the worst thing this job could do to a real person: an email to
// somebody who said stop — pressed Stop, had the tick taken off, was marked Lost or
// Joined, or gave a new address — or the same email twice.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { proveAddress } from "./proveAddress.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { InviteEmail, InviteSendResult, InviteTransport } from "../src/email/resend.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import type { MailCheck } from "../src/modules/orgs/invites/decide.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { writeEmailSettings } from "../src/modules/orgs/leads/emailSettings.js";
import { sendDueLeadEmails, type LeadSendRun, type LeadSenderDeps } from "../src/modules/orgs/leads/sender.js";
import { LEAD_EMAILS_PER_MONTH, leadEmailSettingsResponseSchema, type Lead, type LeadEmailSettings, type LeadsResponse } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "lead-sent-for-you-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // The join door is a fixture here; join codes are off by default (ROADMAP 3c).
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 120_000;
const LIVE_PLAN = "zz_lead_sent_for_you";
const ZONE = "Europe/London";
const POSTAL = "12 Kirkgate, Leeds LS1 6BY";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.64.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const addDays = (day: string, days: number): string => {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

d("the app sends a lead's follow-ups (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");
  const sender = settings.sender;
  if (sender === null) throw new Error("sending is off in the test config");

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'lead-s-%@example.com')`;
    await sql`DELETE FROM gym_lead_sends WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_lead_email_settings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'lead-s-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, payload: unknown, cookies: Record<string, string>) =>
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
  const put = (path: string, payload: unknown, cookies: Record<string, string>) => send("PUT", path, payload, cookies);
  const del = (path: string, cookies: Record<string, string>) => send("DELETE", path, undefined, cookies);

  const makeUser = async (local: string) => {
    const email = `lead-s-${local}@example.com`;
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

  /** A gym on a plan with its postal address set, as sending needs. */
  const makeGym = async (cookies: Record<string, string>, name: string, postal: string | null = POSTAL): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: ZONE }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    if (postal !== null) expect((await patch(`/v1/orgs/${created.org.id}`, { postalAddress: postal }, cookies)).statusCode).toBe(200);
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
    await proveAddress(sql, person.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role }, owner)).statusCode).toBe(201);
    return person;
  };

  const leadsUrl = (gymId: string) => `/v1/orgs/${gymId}/leads`;
  const leadUrl = (gymId: string, leadId: string) => `${leadsUrl(gymId)}/${leadId}`;
  const settingsUrl = (gymId: string) => `${leadsUrl(gymId)}/email-settings`;
  const leadOf = (res: { body: string }) => (JSON.parse(res.body) as { lead: Lead }).lead;
  const pageOf = (res: { body: string }) => JSON.parse(res.body) as LeadsResponse;
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const settingsOf = (res: { body: string }): LeadEmailSettings => leadEmailSettingsResponseSchema.parse(JSON.parse(res.body)).settings;
  const today = () => dayInTz(new Date(), ZONE);

  const switchOn = async (gymId: string, cookies: Record<string, string>, replyTo = "desk@ironhouse.example.com") => {
    const res = await put(settingsUrl(gymId), { sendForMe: true, replyTo }, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return settingsOf(res);
  };

  const addLead = async (gymId: string, cookies: Record<string, string>, over: Record<string, unknown> = {}) => {
    const res = await post(leadsUrl(gymId), { fullName: "Priya Shah", email: "priya@example.com", source: "walk_in", mayEmail: true, ...over }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return leadOf(res);
  };
  const readLead = async (gymId: string, leadId: string, cookies: Record<string, string>) => {
    const res = await get(leadUrl(gymId, leadId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return leadOf(res);
  };
  /** What is really stored, never what a reply says. */
  const storedLead = async (leadId: string) =>
    (
      await sql<{ status: string; sent: number; due: string | null; ok: Date | null }[]>`
        SELECT status, follow_ups_sent AS sent, follow_up_due_on::text AS due, email_ok_at AS ok FROM gym_leads WHERE id = ${leadId}`
    )[0];
  const sendsOf = async (gymId: string) =>
    await sql<{ lead_id: string | null; step: number; state: string; reason: string | null; counted: boolean; email: string | null }[]>`
      SELECT lead_id, step, state, reason, counted, email::text AS email FROM gym_lead_sends WHERE gym_id = ${gymId} ORDER BY created_at, id`;
  /** "Some days later": every time the lead holds moved back, as the clock would. */
  const daysPass = async (leadId: string, days: number) => {
    await sql`
      UPDATE gym_leads
      SET email_ok_at = email_ok_at - make_interval(days => ${days}),
          follow_up_last_at = follow_up_last_at - make_interval(days => ${days}),
          follow_up_due_on = follow_up_due_on - ${days}::int
      WHERE id = ${leadId}`;
    await sql`UPDATE gym_lead_sends SET ok_at = ok_at - make_interval(days => ${days}) WHERE lead_id = ${leadId}`;
  };

  // ── The worker's sender, with every email it would send recorded ──

  const outbox: InviteEmail[] = [];
  const calls: InviteEmail[] = [];
  const nextAnswers: InviteSendResult[] = [];
  /** Held open by a test to act while an email is being handed over. */
  let handOver: (() => Promise<void>) | null = null;
  const transport: InviteTransport = {
    send: async (message) => {
      calls.push(message);
      if (handOver !== null) await handOver();
      const answer = nextAnswers.shift() ?? { kind: "sent", id: `msg_${String(outbox.length + 1)}` };
      if (answer.kind === "sent") outbox.push(message);
      return answer;
    },
  };
  const emailsTo = (address: string) => outbox.filter((message) => message.to === address);
  const domains = new Map<string, MailCheck>();
  const log = { info: () => undefined, warn: () => undefined };
  const ourGyms = async () =>
    (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'lead-s-%@example.com')`).map(
      (row) => row.id,
    );
  /** Midday by the gym's clock on the gym's today: inside the hours emails go. */
  const midday = () => new Date(`${today()}T12:00:00Z`);
  const runSender = async (over: Partial<LeadSenderDeps> = {}): Promise<LeadSendRun> =>
    await sendDueLeadEmails({
      gymIds: await ourGyms(),
      sql,
      log,
      settings,
      sender,
      transport,
      mailDomain: (domain) => Promise.resolve(domains.get(domain) ?? "accepts"),
      now: midday,
      sleep: () => Promise.resolve(),
      ...over,
    });
  /** The one-click Stop a mail program sends for the email's List-Unsubscribe header. */
  const pressStop = async (message: InviteEmail) => {
    const link = /<([^>]+)>/.exec(message.headers["List-Unsubscribe"] ?? "")?.[1];
    if (link === undefined) throw new Error("the email has no unsubscribe link");
    const path = link.slice(link.indexOf("/v1/"));
    return await api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });
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
      // The gym page's robot check, passed: the form is what is under test here.
      robotCheck: { siteKey: "test-site-key", verify: () => Promise.resolve("passed") },
    });
    await api().ready();
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  // ── THE WORST THING: AN EMAIL TO SOMEBODY WHO SAID STOP, OR THE SAME ONE TWICE ──

  it(
    "nobody who said stop gets a follow-up — untick, Contacted, On trial, Lost, Joined, a new address, deleted, on the member list — and a second run sends nothing more",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeGym(owner.cookies, "Worst Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);

      const priya = await addLead(gym, owner.cookies);
      const noTick = await addLead(gym, owner.cookies, { fullName: "Ana Silva", email: "ana@example.com", mayEmail: false });
      const untick = await addLead(gym, owner.cookies, { fullName: "Kit Ray", email: "kit@example.com" });
      const contacted = await addLead(gym, owner.cookies, { fullName: "Lee Chan", email: "lee@example.com" });
      const onTrial = await addLead(gym, owner.cookies, { fullName: "Mo Khan", email: "mo@example.com" });
      const lost = await addLead(gym, owner.cookies, { fullName: "Sam Gold", email: "sam@example.com" });
      const joined = await addLead(gym, owner.cookies, { fullName: "Eve Stone", email: "eve@example.com" });
      const moved = await addLead(gym, owner.cookies, { fullName: "Jo Park", email: "jo@example.com" });
      const deleted = await addLead(gym, owner.cookies, { fullName: "Uma Bell", email: "uma@example.com" });
      // Somebody already on the member list under this address is a member, not a lead.
      expect(
        (await post(`/v1/orgs/${gym}/member-list/entries`, { fullName: "Ray Low", email: "ray@example.com" }, owner.cookies)).statusCode,
      ).toBeLessThan(300);
      const member = await addLead(gym, owner.cookies, { fullName: "Ray Low", email: "ray@example.com" });

      // Staff's from the start: the panel says why before the worker has tried.
      expect(member.followUp).toMatchObject({ by: "you", notSent: "on_member_list" });
      expect((await patch(leadUrl(gym, untick.id), { mayEmail: false }, owner.cookies)).statusCode).toBe(200);
      expect((await patch(leadUrl(gym, contacted.id), { status: "contacted" }, owner.cookies)).statusCode).toBe(200);
      expect((await patch(leadUrl(gym, onTrial.id), { status: "on_trial" }, owner.cookies)).statusCode).toBe(200);
      expect((await patch(leadUrl(gym, lost.id), { status: "lost" }, owner.cookies)).statusCode).toBe(200);
      expect((await post(`${leadUrl(gym, joined.id)}/join`, { asNew: true }, owner.cookies)).statusCode).toBe(200);
      expect((await patch(leadUrl(gym, moved.id), { email: "jo.park@example.com" }, owner.cookies)).statusCode).toBe(200);
      expect((await del(leadUrl(gym, deleted.id), owner.cookies)).statusCode).toBe(204);

      outbox.length = 0;
      await runSender();
      await runSender();
      await Promise.all([runSender(), runSender()]);

      // Exactly one email: Priya's first, once.
      expect(outbox.map((m) => m.to)).toEqual(["priya@example.com"]);
      expect(outbox[0]?.subject).toBe("Thanks for asking about Worst Sent Gym");
      for (const address of ["ana", "kit", "lee", "mo", "sam", "eve", "jo", "jo.park", "uma", "ray"]) {
        expect(emailsTo(`${address}@example.com`)).toEqual([]);
      }
      expect(await storedLead(priya.id)).toMatchObject({ sent: 1, due: addDays(today(), 3) });
      expect((await readLead(gym, noTick.id, owner.cookies)).followUp).toMatchObject({ sent: 0, by: null });
      // The member got nothing and staff are told why; the email waits for them.
      expect((await readLead(gym, member.id, owner.cookies)).followUp).toMatchObject({ sent: 0, by: "you", notSent: "on_member_list" });

      // Priya presses Stop in the email: her tick comes off, and nothing more is sent to
      // her from this gym — not when her next day comes, not after staff tick her again.
      const first = outbox[0];
      if (first === undefined) throw new Error("no email to press Stop in");
      const stopped = await pressStop(first);
      expect(stopped.statusCode).toBe(200);
      expect(stopped.body).toBe("");
      expect(await storedLead(priya.id)).toMatchObject({ sent: 1, due: null, ok: null });
      const afterStop = await readLead(gym, priya.id, owner.cookies);
      expect(afterStop.mayEmail).toBe(false);
      expect(afterStop.followUp.optedOutAt).not.toBeNull();
      expect(afterStop.followUp.optedOutHow).toBe("unsubscribed");

      const reticked = await patch(leadUrl(gym, priya.id), { mayEmail: true }, owner.cookies);
      expect(reticked.statusCode).toBe(200);
      // Ticked again at the desk: staff's at once, and said why, before the worker tries.
      expect(leadOf(reticked).followUp).toMatchObject({ by: "you", notSent: "unsubscribed" });
      await daysPass(priya.id, 3);
      await runSender();
      await runSender();
      expect(emailsTo("priya@example.com")).toHaveLength(1);
      expect((await readLead(gym, priya.id, owner.cookies)).followUp).toMatchObject({ sent: 1, by: "you", notSent: "unsubscribed" });
    },
    TIMEOUT_MS,
  );

  it(
    "staff pressing Mark as sent while the app is handing the same email over: one email, and the press is refused; Mark first, and the app sends nothing",
    async () => {
      const owner = await makeUser("race-owner");
      const org = await makeGym(owner.cookies, "Race Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);

      const ana = await addLead(gym, owner.cookies, { fullName: "Ana Silva", email: "ana.race@example.com" });
      let pressed: { statusCode: number; body: string } | null = null;
      handOver = async () => {
        handOver = null;
        pressed = await post(`${leadUrl(gym, ana.id)}/follow-up`, { step: 1, email: "ana.race@example.com" }, owner.cookies);
      };
      outbox.length = 0;
      await runSender();
      expect(pressed).not.toBeNull();
      const press = pressed as unknown as { statusCode: number; body: string };
      expect(press.statusCode).toBe(409);
      expect(errorOf(press)).toBe("follow_up_sent_for_you");
      expect(emailsTo("ana.race@example.com")).toHaveLength(1);
      expect(await storedLead(ana.id)).toMatchObject({ sent: 1 });

      // Staff mark it first: the app finds nothing due and sends nothing.
      const bo = await addLead(gym, owner.cookies, { fullName: "Bo Lin", email: "bo.race@example.com" });
      expect((await post(`${leadUrl(gym, bo.id)}/follow-up`, { step: 1, email: "bo.race@example.com" }, owner.cookies)).statusCode).toBe(200);
      await runSender();
      expect(emailsTo("bo.race@example.com")).toEqual([]);
      expect(await storedLead(bo.id)).toMatchObject({ sent: 1 });
    },
    TIMEOUT_MS,
  );

  it(
    "the tick taken off, the lead marked Lost, Stop pressed or the switch turned off in the moment between the app taking an email and sending it: nothing goes",
    async () => {
      const owner = await makeUser("moment-owner");
      const org = await makeGym(owner.cookies, "Moment Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      /** Staff act while the app is asking the address's domain, after it took the email. */
      const meanwhile = (act: () => Promise<unknown>) => async () => {
        await act();
        return "accepts" as const;
      };
      outbox.length = 0;

      const kit = await addLead(gym, owner.cookies, { fullName: "Kit Tick", email: "kit.moment@example.com" });
      await runSender({ mailDomain: meanwhile(() => patch(leadUrl(gym, kit.id), { mayEmail: false }, owner.cookies)) });
      const lee = await addLead(gym, owner.cookies, { fullName: "Lee Lost", email: "lee.moment@example.com" });
      await runSender({ mailDomain: meanwhile(() => patch(leadUrl(gym, lee.id), { status: "lost" }, owner.cookies)) });
      const sal = await addLead(gym, owner.cookies, { fullName: "Sal Stop", email: "sal.moment@example.com" });
      await runSender({
        mailDomain: meanwhile(async () => {
          // The same address stopped this gym's emails from an earlier one (an invitation's Stop).
          await sql`
            INSERT INTO email_suppressions (email_hmac, gym_id, reason)
            SELECT email_hmac, gym_id, 'unsubscribed' FROM gym_lead_sends WHERE lead_id = ${sal.id}`;
        }),
      });
      const oli = await addLead(gym, owner.cookies, { fullName: "Oli Off", email: "oli.moment@example.com" });
      await runSender({ mailDomain: meanwhile(() => put(settingsUrl(gym), { sendForMe: false, replyTo: null }, owner.cookies)) });

      for (const address of ["kit", "lee", "sal", "oli"]) expect(emailsTo(`${address}.moment@example.com`)).toEqual([]);
      expect(await storedLead(kit.id)).toMatchObject({ sent: 0 });
      expect(await storedLead(lee.id)).toMatchObject({ sent: 0, status: "lost" });
      expect((await readLead(gym, sal.id, owner.cookies)).followUp).toMatchObject({ sent: 0, by: "you", notSent: "unsubscribed" });
      expect(await storedLead(oli.id)).toMatchObject({ sent: 0 });
      // Dropped, not kept: the switch back on sends Oli's, once.
      await switchOn(gym, owner.cookies);
      await runSender();
      await runSender();
      expect(emailsTo("oli.moment@example.com")).toHaveLength(1);
    },
    TIMEOUT_MS,
  );

  it(
    "a lead from the gym's own page, ticked by the person on the form, is emailed as gym software does (RULINGS 2026-09-29); one not ticked is not; its Stop works",
    async () => {
      const owner = await makeUser("page-owner");
      const org = await makeGym(owner.cookies, "Page Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      expect((await put(`/v1/orgs/${gym}/page`, { shown: true, about: "", facilities: [], ownFacilities: [] }, owner.cookies)).statusCode).toBe(200);
      const form = (body: Record<string, unknown>) =>
        api().inject({
          method: "POST",
          url: `/v1/public/gyms/${org.org.slug}/enquiries`,
          remoteAddress: nextIp(),
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ fullName: "Asha Rao", source: "social", message: "Evening classes?", robotToken: "ok-token", ...body }),
        });
      expect((await form({ email: "asha.page@example.com", mayEmail: true })).statusCode).toBe(202);
      expect((await form({ fullName: "Bo Lin", email: "bo.page@example.com", mayEmail: false })).statusCode).toBe(202);
      outbox.length = 0;
      await runSender();
      await runSender();
      expect(emailsTo("asha.page@example.com").map((m) => m.subject)).toEqual(["Thanks for asking about Page Sent Gym"]);
      expect(emailsTo("bo.page@example.com")).toEqual([]);

      const [first] = emailsTo("asha.page@example.com");
      if (first === undefined) throw new Error("no email went");
      expect((await pressStop(first)).statusCode).toBe(200);
      const [asha] = await sql<{ ok: Date | null; due: string | null }[]>`
        SELECT email_ok_at AS ok, follow_up_due_on::text AS due FROM gym_leads WHERE gym_id = ${gym} AND email = 'asha.page@example.com'`;
      expect(asha).toEqual({ ok: null, due: null });
    },
    TIMEOUT_MS,
  );

  it(
    "a lead of another gym is never emailed by this gym's switch, and a stranger, a trainer and nobody signed in cannot read or change the switch",
    async () => {
      const owner = await makeUser("tenancy-owner");
      const org = await makeGym(owner.cookies, "Tenancy Sent Gym");
      const rivalOwner = await makeUser("tenancy-rival");
      const rival = await makeGym(rivalOwner.cookies, "Rival Sent Gym");
      const trainer = await makeStaff(org, owner.cookies, "tenancy-trainer", "trainer");
      const stranger = await makeUser("tenancy-stranger");

      await switchOn(org.org.id, owner.cookies);
      await addLead(rival.org.id, rivalOwner.cookies, { fullName: "Cy Rival", email: "cy.rival@example.com" });
      outbox.length = 0;
      await runSender();
      expect(emailsTo("cy.rival@example.com")).toEqual([]);

      for (const who of [stranger.cookies, trainer.cookies, rivalOwner.cookies]) {
        const read = await get(settingsUrl(org.org.id), who);
        expect([403, 404]).toContain(read.statusCode);
        const write = await put(settingsUrl(org.org.id), { sendForMe: false, replyTo: null }, who);
        expect([403, 404]).toContain(write.statusCode);
      }
      expect((await get(settingsUrl(org.org.id), {})).statusCode).toBe(401);
      expect((await put(settingsUrl(org.org.id), { sendForMe: false, replyTo: null }, {})).statusCode).toBe(401);
      expect(settingsOf(await get(settingsUrl(org.org.id), owner.cookies))).toMatchObject({ sendForMe: true });
      expect(settingsOf(await get(settingsUrl(rival.org.id), rivalOwner.cookies))).toMatchObject({ sendForMe: false });
    },
    TIMEOUT_MS,
  );

  // ── The email itself ──

  it(
    "the email comes from the gym via the app, replies go to the gym, and a name typed as a web address carries no link",
    async () => {
      const owner = await makeUser("words-owner");
      const org = await makeGym(owner.cookies, "Iron House Words");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies, "Front.Desk@IronHouse.example.com");
      const lead = await addLead(gym, owner.cookies, { fullName: "www.evil-site.com Smith", email: "words.lead@example.com" });
      outbox.length = 0;
      await runSender({ sender: { ...sender, from: "AI Home Gym <invites@mail.example.com>" } });
      const [message] = emailsTo("words.lead@example.com");
      if (message === undefined) throw new Error("no email went");
      const sent = await sendsOf(gym);
      const sendId = (await sql<{ id: string }[]>`SELECT id FROM gym_lead_sends WHERE lead_id = ${lead.id}`)[0]?.id ?? "";
      expect(message.from).toBe("Iron House Words via AI Home Gym <invites@mail.example.com>");
      expect(message.replyTo).toBe("front.desk@ironhouse.example.com");
      expect(message.subject).toBe("Thanks for asking about Iron House Words");
      expect(message.text.startsWith("Hi,\n\n")).toBe(true);
      expect(message.text).not.toContain("evil-site");
      expect(message.text).toContain(`Sent by AI Home Gym on behalf of Iron House Words, ${POSTAL}.`);
      expect(message.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(message.headers["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:\d+\/v1\/email\/leads\/unsubscribe\?t=[\w-]+\.[\w-]+>$/);
      expect(message.idempotencyKey).toBe(`lead-follow-up-${sendId}`);
      expect(message.tags).toEqual([{ name: "lead_send", value: sendId }]);
      // The address is kept only while it is being sent.
      expect(sent).toEqual([{ lead_id: lead.id, step: 1, state: "sent", reason: null, counted: true, email: null }]);
    },
    TIMEOUT_MS,
  );

  // ── Days, the switch, the list ──

  it(
    "email 2 goes 3 days after the first and email 3 four days after that, then no more; the lead is the app's and not in staff's Email due, until the switch goes off",
    async () => {
      const owner = await makeUser("days-owner");
      const org = await makeGym(owner.cookies, "Days Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      const lead = await addLead(gym, owner.cookies, { fullName: "Dee Day", email: "dee.days@example.com" });
      expect(lead.followUp).toMatchObject({ dueOn: today(), by: "app", notSent: null });
      const due = pageOf(await get(`${leadsUrl(gym)}?followUp=due`, owner.cookies));
      expect(due.counts.followUpsDue).toBe(0);
      expect(due.leads).toEqual([]);

      outbox.length = 0;
      await runSender();
      expect(emailsTo("dee.days@example.com").map((m) => m.subject)).toEqual(["Thanks for asking about Days Sent Gym"]);
      expect((await readLead(gym, lead.id, owner.cookies)).followUp).toMatchObject({ sent: 1, dueOn: addDays(today(), 3), by: "app" });

      // Two days later: not yet.
      await daysPass(lead.id, 2);
      await runSender();
      expect(emailsTo("dee.days@example.com")).toHaveLength(1);
      await daysPass(lead.id, 1);
      await runSender();
      expect(emailsTo("dee.days@example.com").map((m) => m.subject)).toEqual([
        "Thanks for asking about Days Sent Gym",
        "Come and see us at Days Sent Gym",
      ]);
      expect(await storedLead(lead.id)).toMatchObject({ sent: 2, due: addDays(today(), 4) });
      await daysPass(lead.id, 3);
      await runSender();
      expect(emailsTo("dee.days@example.com")).toHaveLength(2);
      await daysPass(lead.id, 1);
      await runSender();
      await runSender();
      expect(emailsTo("dee.days@example.com").map((m) => m.subject)).toEqual([
        "Thanks for asking about Days Sent Gym",
        "Come and see us at Days Sent Gym",
        "Still thinking about Days Sent Gym?",
      ]);
      expect(await storedLead(lead.id)).toMatchObject({ sent: 3, due: null });
      await daysPass(lead.id, 30);
      await runSender();
      expect(emailsTo("dee.days@example.com")).toHaveLength(3);

      // Switched off: a due lead is staff's again, in Email due and with its buttons.
      const other = await addLead(gym, owner.cookies, { fullName: "Oli Off", email: "oli.off@example.com" });
      expect((await put(settingsUrl(gym), { sendForMe: false, replyTo: "desk@ironhouse.example.com" }, owner.cookies)).statusCode).toBe(200);
      await runSender();
      expect(emailsTo("oli.off@example.com")).toEqual([]);
      expect((await readLead(gym, other.id, owner.cookies)).followUp).toMatchObject({ dueNow: true, by: "you" });
      const staffDue = pageOf(await get(`${leadsUrl(gym)}?followUp=due`, owner.cookies));
      expect(staffDue.counts.followUpsDue).toBe(1);
      expect(staffDue.leads.map((l) => l.id)).toEqual([other.id]);
    },
    TIMEOUT_MS,
  );

  it(
    "an email the app is already sending stays the app's while it is out, even when the address turns up on the member list; staff get it once the try settles",
    async () => {
      const owner = await makeUser("flight-owner");
      const org = await makeGym(owner.cookies, "Flight Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      const lead = await addLead(gym, owner.cookies, { fullName: "Flo Air", email: "flo.flight@example.com" });
      expect(lead.followUp.by).toBe("app");
      // The worker has taken its first email and may be sending it right now.
      await sql`
        INSERT INTO gym_lead_sends (gym_id, lead_id, ok_at, step, month, counted, email, email_hmac, state, attempts, not_before, created_at, lease_until)
        SELECT gym_id, id, email_ok_at, 1, '2026-09', true, email, lpad('f1', 64, '0'), 'sending', 1, now(), now(), now() + interval '5 minutes'
        FROM gym_leads WHERE id = ${lead.id}`;
      expect(
        (await post(`/v1/orgs/${gym}/member-list/entries`, { fullName: "Flo Air", email: "flo.flight@example.com" }, owner.cookies)).statusCode,
      ).toBeLessThan(300);
      // Staff are told why the next one will not go, never offered to send this one again.
      expect((await readLead(gym, lead.id, owner.cookies)).followUp).toMatchObject({ by: "app", notSent: "on_member_list" });
      expect(pageOf(await get(`${leadsUrl(gym)}?followUp=due`, owner.cookies)).leads.map((l) => l.id)).not.toContain(lead.id);
      // The try settles without sending: now it is staff's.
      await sql`UPDATE gym_lead_sends SET state = 'skipped', reason = 'on_member_list', email = NULL, counted = false, lease_until = NULL, finished_at = now() WHERE lead_id = ${lead.id}`;
      expect((await readLead(gym, lead.id, owner.cookies)).followUp).toMatchObject({ by: "you", notSent: "on_member_list" });
    },
    TIMEOUT_MS,
  );

  it(
    "the 101st new lead in a month goes back to staff; a lead the app already emails goes on outside the count; the Settings box says how many",
    async () => {
      const owner = await makeUser("month-owner");
      const org = await makeGym(owner.cookies, "Month Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      // Emailed last month, its second due now.
      const older = await addLead(gym, owner.cookies, { fullName: "Old Timer", email: "old.month@example.com" });
      outbox.length = 0;
      await runSender();
      expect(emailsTo("old.month@example.com")).toHaveLength(1);
      await sql`UPDATE gym_lead_sends SET month = '2000-01' WHERE lead_id = ${older.id}`;
      await daysPass(older.id, 3);
      // 99 new leads already emailed this month (their leads since deleted).
      const [{ month } = { month: "" }] = await sql<{ month: string }[]>`
        SELECT to_char(${midday()}::timestamptz AT TIME ZONE ${ZONE}, 'YYYY-MM') AS month`;
      await sql`
        INSERT INTO gym_lead_sends (gym_id, lead_id, ok_at, step, month, counted, email, email_hmac, state, attempts, not_before, created_at, finished_at)
        SELECT ${gym}, NULL, now(), 1, ${month}, true, NULL, lpad(to_hex(n), 64, '0'), 'sent', 1, now(), now(), now()
        FROM generate_series(1, ${LEAD_EMAILS_PER_MONTH - 1}) AS n`;
      expect(settingsOf(await get(settingsUrl(gym), owner.cookies))).toMatchObject({ usedThisMonth: LEAD_EMAILS_PER_MONTH - 1, perMonth: LEAD_EMAILS_PER_MONTH });

      // Due the same day, the month's last place goes to whoever asked first: Ann.
      const hundredth = await addLead(gym, owner.cookies, { fullName: "Ann Hundred", email: "ann.month@example.com" });
      const next = await addLead(gym, owner.cookies, { fullName: "Ben Next", email: "ben.month@example.com" });
      expect(hundredth.followUp.by).toBe("app");
      await runSender();
      await runSender();
      expect(emailsTo("ann.month@example.com")).toHaveLength(1);
      expect(emailsTo("ben.month@example.com")).toEqual([]);
      expect(emailsTo("old.month@example.com").map((m) => m.subject)).toEqual(["Thanks for asking about Month Sent Gym", "Come and see us at Month Sent Gym"]);
      expect(settingsOf(await get(settingsUrl(gym), owner.cookies)).usedThisMonth).toBe(LEAD_EMAILS_PER_MONTH);

      // Ben is staff's: his panel offers the buttons and he is in Email due.
      expect((await readLead(gym, next.id, owner.cookies)).followUp).toMatchObject({ dueNow: true, by: "you", notSent: null });
      const staffDue = pageOf(await get(`${leadsUrl(gym)}?followUp=due`, owner.cookies));
      expect(staffDue.leads.map((l) => l.id)).toEqual([next.id]);
      expect(staffDue.counts.followUpsDue).toBe(1);
      expect((await post(`${leadUrl(gym, next.id)}/follow-up`, { step: 1, email: "ben.month@example.com" }, owner.cookies)).statusCode).toBe(200);
    },
    TIMEOUT_MS,
  );

  it(
    "nothing goes at night by the gym's clock; it goes from 8 in the morning",
    async () => {
      const owner = await makeUser("night-owner");
      const org = await makeGym(owner.cookies, "Night Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      await addLead(gym, owner.cookies, { fullName: "Nia Night", email: "nia.night@example.com" });
      const at = async (localHour: number) => {
        const [{ t } = { t: new Date() }] = await sql<{ t: Date }[]>`
          SELECT ((${today()}::date + make_interval(hours => ${localHour})) AT TIME ZONE ${ZONE}) AS t`;
        return t;
      };
      outbox.length = 0;
      for (const hour of [0, 3, 7, 20, 23]) {
        const when = await at(hour);
        await runSender({ now: () => when });
      }
      expect(emailsTo("nia.night@example.com")).toEqual([]);
      const eight = await at(8);
      await runSender({ now: () => eight });
      expect(emailsTo("nia.night@example.com")).toHaveLength(1);

      // One the email service turned away at 8 waits: not tried again at 9 at night,
      // but the next morning.
      await addLead(gym, owner.cookies, { fullName: "Ned Next", email: "ned.night@example.com" });
      nextAnswers.push({ kind: "not_sent", status: 429 });
      expect(await runSender({ now: () => eight })).toMatchObject({ held: 1 });
      const nine = await at(21);
      await runSender({ now: () => nine });
      expect(emailsTo("ned.night@example.com")).toEqual([]);
      const tomorrow = new Date((await at(8)).getTime() + 24 * 60 * 60_000);
      await runSender({ now: () => tomorrow });
      expect(emailsTo("ned.night@example.com")).toHaveLength(1);

      // One that may have gone, at 19:59, is not tried again at night either: if the first
      // try never reached the email service, the next is the one that arrives.
      await addLead(gym, owner.cookies, { fullName: "Uma Unclear", email: "uma.night@example.com" });
      const evening = new Date((await at(19)).getTime() + 59 * 60_000);
      nextAnswers.push({ kind: "unclear", status: null });
      expect(await runSender({ now: () => evening })).toMatchObject({ retried: 1 });
      const late = new Date((await at(21)).getTime());
      await runSender({ now: () => late });
      expect(calls.filter((m) => m.to === "uma.night@example.com")).toHaveLength(1);
      const morning = new Date((await at(8)).getTime() + 24 * 60 * 60_000);
      await runSender({ now: () => morning });
      const tries = calls.filter((m) => m.to === "uma.night@example.com");
      expect(tries).toHaveLength(2);
      expect(tries[0]?.idempotencyKey).toBe(tries[1]?.idempotencyKey);
      expect(emailsTo("uma.night@example.com")).toHaveLength(1);
    },
    TIMEOUT_MS,
  );

  // ── What Resend answers ──

  it(
    "an unclear answer is tried again under the same key; a refused key stops the run and the email waits; one that may have gone for 20 hours is taken as sent and never sent again",
    async () => {
      const owner = await makeUser("answers-owner");
      const org = await makeGym(owner.cookies, "Answers Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      const lead = await addLead(gym, owner.cookies, { fullName: "Uri Unclear", email: "uri.answers@example.com" });
      calls.length = 0;
      outbox.length = 0;

      nextAnswers.push({ kind: "unclear", status: 503 });
      expect(await runSender()).toMatchObject({ retried: 1, sent: 0 });
      const later = new Date(midday().getTime() + 2 * 60_000);
      await runSender({ now: () => later });
      const tries = calls.filter((m) => m.to === "uri.answers@example.com");
      expect(tries).toHaveLength(2);
      expect(tries[0]?.idempotencyKey).toBe(tries[1]?.idempotencyKey);
      expect(emailsTo("uri.answers@example.com")).toHaveLength(1);
      expect(await storedLead(lead.id)).toMatchObject({ sent: 1 });

      // Resend refuses the key: nothing more this run, and the email waits.
      const kay = await addLead(gym, owner.cookies, { fullName: "Kay Key", email: "kay.answers@example.com" });
      nextAnswers.push({ kind: "not_sent", status: 401 });
      expect(await runSender()).toMatchObject({ stoppedByProvider: true, held: 1 });
      expect(await storedLead(kay.id)).toMatchObject({ sent: 0 });
      expect((await sendsOf(gym)).filter((s) => s.lead_id === kay.id)).toMatchObject([{ state: "queued", counted: true }]);
      expect((await readLead(gym, kay.id, owner.cookies)).followUp).toMatchObject({ by: "app", appWhen: "waiting" });
      await runSender({ now: () => new Date(midday().getTime() + 5 * 60_000) });
      expect(emailsTo("kay.answers@example.com")).toHaveLength(1);

      // May have gone, again and again for 20 hours: taken as sent, never handed over again.
      const may = await addLead(gym, owner.cookies, { fullName: "May Be", email: "may.answers@example.com" });
      nextAnswers.push({ kind: "unclear", status: null });
      await runSender();
      const dayLater = new Date(midday().getTime() + 21 * 60 * 60_000);
      expect(await runSender({ now: () => dayLater })).toMatchObject({ failed: 1 });
      expect(await storedLead(may.id)).toMatchObject({ sent: 1 });
      expect((await sendsOf(gym)).filter((s) => s.lead_id === may.id)).toMatchObject([{ state: "failed", reason: "send_unknown", counted: true }]);
      expect(calls.filter((m) => m.to === "may.answers@example.com")).toHaveLength(1);
      expect((await readLead(gym, may.id, owner.cookies)).followUp).toMatchObject({ sent: 1, notSent: null });
    },
    TIMEOUT_MS,
  );

  it(
    "with emails through the app paused, a due lead is staff's — its buttons, Email due, and Settings saying so — and the sender sends nothing; unpaused, it is the app's again",
    async () => {
      const owner = await makeUser("paused-owner");
      const org = await makeGym(owner.cookies, "Paused Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      const lead = await addLead(gym, owner.cookies, { fullName: "Pat Paused", email: "pat.paused@example.com" });
      // The api as it runs with the operator's kill switch on.
      const paused = await buildApp(loadConfig({ ...baseEnv, INVITES_PAUSED: "true" }), {
        emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
      });
      try {
        await paused.ready();
        const at = (method: "GET" | "POST", url: string, cookies: Record<string, string>, payload?: unknown) =>
          paused.inject({
            method,
            url,
            remoteAddress: nextIp(),
            cookies,
            ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
          });
        const login = await at("POST", "/v1/auth/login", {}, { email: owner.email, password: PASSWORD });
        expect(login.statusCode).toBe(200);
        const cookies = cookieMap(login);
        expect(leadOf(await at("GET", leadUrl(gym, lead.id), cookies)).followUp).toMatchObject({ dueNow: true, by: "you", appWhen: null });
        const due = pageOf(await at("GET", `${leadsUrl(gym)}?followUp=due`, cookies));
        expect(due.counts.followUpsDue).toBe(1);
        expect(due.leads.map((l) => l.id)).toEqual([lead.id]);
        expect(settingsOf(await at("GET", settingsUrl(gym), cookies))).toMatchObject({ sendForMe: true, appSending: "paused" });
      } finally {
        await paused.close();
      }
      outbox.length = 0;
      expect(await runSender({ settings: { ...settings, paused: true } })).toMatchObject({ paused: true, sent: 0 });
      expect(emailsTo("pat.paused@example.com")).toEqual([]);
      expect((await readLead(gym, lead.id, owner.cookies)).followUp).toMatchObject({ by: "app" });
      expect(settingsOf(await get(settingsUrl(gym), owner.cookies)).appSending).toBe("on");
    },
    TIMEOUT_MS,
  );

  it(
    "the whole app's day counts invitations: one invitation sent that day fills a day of one, and a day of two sends the lead's",
    async () => {
      const owner = await makeUser("day-owner");
      const org = await makeGym(owner.cookies, "Day Cap Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      await addLead(gym, owner.cookies, { fullName: "Dan Day", email: "dan.daycap@example.com" });
      // A day ten years on, which nothing else in the database reaches: only this test's
      // own invitation, sent an hour before it, is in that day.
      const future = new Date(midday().getTime() + 3650 * 24 * 60 * 60_000);
      const sentAt = new Date(future.getTime() - 60 * 60_000);
      const [invite] = await sql<{ id: string }[]>`
        INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym}, ${"f".repeat(64)}) RETURNING id`;
      if (invite === undefined) throw new Error("no invitation row");
      await sql`
        INSERT INTO gym_invite_sends (gym_id, invite_id, kind, state, attempts, not_before, created_at, finished_at)
        VALUES (${gym}, ${invite.id}, 'first', 'sent', 1, ${sentAt}, ${sentAt}, ${sentAt})`;
      try {
        outbox.length = 0;
        // This gym's leads only: the other tests' leads are due on that day too.
        expect(await runSender({ gymIds: [gym], now: () => future, settings: { ...settings, perDay: 1 } })).toMatchObject({ capped: true, sent: 0 });
        expect(emailsTo("dan.daycap@example.com")).toEqual([]);
        // One place left: the lead's email takes it, and then the day is full.
        expect(await runSender({ gymIds: [gym], now: () => future, settings: { ...settings, perDay: 2 } })).toMatchObject({ sent: 1, capped: true });
        expect(emailsTo("dan.daycap@example.com")).toHaveLength(1);
      } finally {
        // Nothing dated ten years on is left for another suite's day.
        await sql`DELETE FROM gym_invites WHERE id = ${invite.id}`;
        await sql`DELETE FROM gym_lead_sends WHERE gym_id = ${gym}`;
      }
    },
    TIMEOUT_MS,
  );

  it(
    "a gym stopped for bounces or a complaint sends nothing, and its leads are staff's",
    async () => {
      const owner = await makeUser("stopped-owner");
      const org = await makeGym(owner.cookies, "Stopped Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      const lead = await addLead(gym, owner.cookies, { fullName: "Cap Stone", email: "cap.stopped@example.com" });
      await sql`UPDATE gyms SET invites_stopped_at = now(), invites_stopped_reason = 'bounces' WHERE id = ${gym}`;
      outbox.length = 0;
      await runSender();
      expect(emailsTo("cap.stopped@example.com")).toEqual([]);
      expect((await readLead(gym, lead.id, owner.cookies)).followUp).toMatchObject({ by: "you" });
      expect(pageOf(await get(`${leadsUrl(gym)}?followUp=due`, owner.cookies)).counts.followUpsDue).toBe(1);
      expect(settingsOf(await get(settingsUrl(gym), owner.cookies))).toMatchObject({ stopped: true, sendForMe: true });
    },
    TIMEOUT_MS,
  );

  // ── Settings ──

  it(
    "the switch needs the gym's postal address and a reply address; a bad address is refused; each change is in the gym's activity",
    async () => {
      const owner = await makeUser("settings-owner");
      const org = await makeGym(owner.cookies, "Settings Sent Gym", null);
      const gym = org.org.id;
      expect(settingsOf(await get(settingsUrl(gym), owner.cookies))).toEqual({
        sendForMe: false,
        replyTo: null,
        perMonth: LEAD_EMAILS_PER_MONTH,
        usedThisMonth: 0,
        hasPostalAddress: false,
        stopped: false,
        appSending: "on",
      });
      const noPostal = await put(settingsUrl(gym), { sendForMe: true, replyTo: "desk@example.com" }, owner.cookies);
      expect(noPostal.statusCode).toBe(409);
      expect(errorOf(noPostal)).toBe("needs_postal_address");
      expect((await put(settingsUrl(gym), { sendForMe: true, replyTo: null }, owner.cookies)).statusCode).toBe(400);
      expect((await put(settingsUrl(gym), { sendForMe: true, replyTo: "not an address" }, owner.cookies)).statusCode).toBe(400);
      expect((await put(settingsUrl(gym), { sendForMe: true }, owner.cookies)).statusCode).toBe(400);
      expect((await put(settingsUrl(gym), { sendForMe: true, replyTo: "a@b.co", extra: 1 }, owner.cookies)).statusCode).toBe(400);
      expect(settingsOf(await get(settingsUrl(gym), owner.cookies)).sendForMe).toBe(false);

      expect((await patch(`/v1/orgs/${gym}`, { postalAddress: POSTAL }, owner.cookies)).statusCode).toBe(200);
      const on = await switchOn(gym, owner.cookies, " Desk@Example.com ");
      expect(on).toMatchObject({ sendForMe: true, replyTo: "desk@example.com", hasPostalAddress: true });
      const off = await put(settingsUrl(gym), { sendForMe: false, replyTo: null }, owner.cookies);
      expect(settingsOf(off)).toMatchObject({ sendForMe: false, replyTo: null });
      const audit = await sql<{ meta: { sendForMe: string } }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.lead_emails_changed' ORDER BY at, id`;
      expect(audit.map((row) => row.meta.sendForMe)).toEqual(["true", "false"]);

      // Sending not set up (production without the invitations' mailbox): nothing could go,
      // so the switch is refused as the invitations are; off is always allowed.
      const offDeps = { sql, now: () => new Date(), addressKey: null, sending: "off" as const };
      await expect(
        writeEmailSettings(offDeps, owner.userId, gym, { sendForMe: true, replyTo: "desk@example.com" }, () => Promise.resolve(true)),
      ).rejects.toMatchObject({ statusCode: 503, code: "invites_off" });
      expect(await writeEmailSettings(offDeps, owner.userId, gym, { sendForMe: false, replyTo: null }, () => Promise.resolve(true))).toMatchObject({
        sendForMe: false,
        appSending: "off",
      });

      // A lapsed gym can read the switch and not change it.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym}`;
      expect((await get(settingsUrl(gym), owner.cookies)).statusCode).toBe(200);
      expect((await put(settingsUrl(gym), { sendForMe: false, replyTo: null }, owner.cookies)).statusCode).toBe(409);
    },
    TIMEOUT_MS,
  );

  // ── The Stop link ──

  it(
    "the Stop page asks first and changes nothing when opened; its button stops the emails; a link we did not make is not valid; an invitation to that address from the gym is stopped too",
    async () => {
      const owner = await makeUser("stop-owner");
      const org = await makeGym(owner.cookies, "Stop Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      const lead = await addLead(gym, owner.cookies, { fullName: "Sid Stop", email: "sid.stop@example.com" });
      outbox.length = 0;
      await runSender();
      const [message] = emailsTo("sid.stop@example.com");
      if (message === undefined) throw new Error("no email went");
      const link = /<([^>]+)>/.exec(message.headers["List-Unsubscribe"] ?? "")?.[1] ?? "";
      const path = link.slice(link.indexOf("/v1/"));

      const opened = await api().inject({ method: "GET", url: path, remoteAddress: nextIp() });
      expect(opened.statusCode).toBe(200);
      expect(opened.body).toContain("Stop emails from Stop Sent Gym?");
      expect(opened.body).toContain('<form method="post">');
      expect((await readLead(gym, lead.id, owner.cookies)).mayEmail).toBe(true);

      const pressed = await api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "" });
      expect(pressed.statusCode).toBe(200);
      expect(pressed.body).toContain("You're unsubscribed");
      expect(pressed.body).toContain("Stop Sent Gym won't email you through AI Home Gym again.");
      const after = await readLead(gym, lead.id, owner.cookies);
      expect(after).toMatchObject({ mayEmail: false, followUp: { dueOn: null, by: null } });
      expect(after.followUp.optedOutAt).not.toBeNull();
      const again = await api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "List-Unsubscribe=One-Click" });
      expect(again.statusCode).toBe(200);
      const kept = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM email_suppressions WHERE gym_id = ${gym} AND reason = 'unsubscribed'`;
      expect(kept[0]?.n).toBe(1);
      const audit = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym} AND action = 'org.lead_unsubscribed'`;
      expect(audit[0]?.n).toBe(1);

      // Invitations from this gym check the same list (`suppressionsFor`): kept from them too.
      const suppressed = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM email_suppressions WHERE gym_id = ${gym} AND email_hmac = (SELECT email_hmac FROM gym_lead_sends WHERE lead_id = ${lead.id} LIMIT 1)`;
      expect(suppressed[0]?.n).toBe(1);

      const forged = `/v1/email/leads/unsubscribe?t=${"A".repeat(22)}.${"B".repeat(22)}`;
      expect((await api().inject({ method: "GET", url: forged, remoteAddress: nextIp() })).statusCode).toBe(404);
      const forgedClick = await api().inject({ method: "POST", url: forged, remoteAddress: nextIp(), headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "List-Unsubscribe=One-Click" });
      expect(forgedClick.statusCode).toBe(404);
      expect(forgedClick.body).toBe("");
      // An invitation's own unsubscribe link does not read a lead's token, nor the other way round.
      const token = path.slice(path.indexOf("?t=") + 3);
      expect((await api().inject({ method: "GET", url: `/v1/email/unsubscribe?t=${token}`, remoteAddress: nextIp() })).statusCode).toBe(404);
    },
    TIMEOUT_MS,
  );

  // ── The two passes over 20c (reviews 2026-09-30): a try that may have gone ──

  it(
    "WORST THING: a follow-up whose first try may have gone is never sent again under a new tick, nor marked by hand meanwhile",
    async () => {
      const owner = await makeUser("retick-owner");
      const org = await makeGym(owner.cookies, "Retick Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      const lead = await addLead(gym, owner.cookies, { fullName: "Priya Retick", email: "priya.retick@example.com" });
      calls.length = 0;
      nextAnswers.push({ kind: "unclear", status: null });
      expect(await runSender()).toMatchObject({ retried: 1, sent: 0 });
      // Staff untick and tick again while the first try waits.
      expect((await patch(leadUrl(gym, lead.id), { mayEmail: false }, owner.cookies)).statusCode).toBe(200);
      expect((await patch(leadUrl(gym, lead.id), { mayEmail: true }, owner.cookies)).statusCode).toBe(200);
      // Marking it by hand now would send it twice.
      expect(errorOf(await post(`${leadUrl(gym, lead.id)}/follow-up`, { step: 1, email: "priya.retick@example.com" }, owner.cookies))).toBe("follow_up_sent_for_you");
      await runSender();
      await runSender({ now: () => new Date(midday().getTime() + 5 * 60_000) });
      await runSender({ now: () => new Date(midday().getTime() + 4 * 60 * 60_000) });
      const keys = new Set(calls.filter((m) => m.to === "priya.retick@example.com").map((m) => m.idempotencyKey));
      expect(keys.size).toBe(1);
      expect(emailsTo("priya.retick@example.com").length).toBeLessThanOrEqual(1);
    },
    TIMEOUT_MS,
  );

  it(
    "a follow-up the app is still trying is the app's, even with the switch turned off: staff are never told to send it and then refused",
    async () => {
      const owner = await makeUser("waiting-owner");
      const org = await makeGym(owner.cookies, "Waiting Sent Gym");
      const gym = org.org.id;
      await switchOn(gym, owner.cookies);
      const lead = await addLead(gym, owner.cookies, { fullName: "Kit Ray", email: "kit.waiting@example.com" });
      nextAnswers.push({ kind: "unclear", status: 503 });
      expect(await runSender()).toMatchObject({ retried: 1 });
      expect((await put(settingsUrl(gym), { sendForMe: false, replyTo: "desk@ironhouse.example.com" }, owner.cookies)).statusCode).toBe(200);
      const panel = await readLead(gym, lead.id, owner.cookies);
      expect(panel.followUp).toMatchObject({ by: "app", appWhen: "waiting" });
      const due = pageOf(await get(`${leadsUrl(gym)}?followUp=due`, owner.cookies));
      expect(due.leads.map((l) => l.fullName)).not.toContain("Kit Ray");
    },
    TIMEOUT_MS,
  );
});
