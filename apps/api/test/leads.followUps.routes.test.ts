// A lead's three follow-up emails, sent by the gym from its own mailbox â€” routes against
// real Postgres (DATABASE_URL-gated). ROADMAP 20c-ii; spec Part 3 Â§16.3; RULINGS
// 2026-09-27.
//
// The first block is the worst thing this job could do to a real person: tell staff to
// email somebody who never said yes, or who is no longer a New lead â€” or let somebody
// outside the gym's ticked staff mark or read another gym's follow-ups.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import { ROLE_PRIVILEGES, type Lead, type LeadsResponse } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "lead-follow-ups-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_lead_follow_ups";
const ZONE = "Europe/London";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const addDays = (day: string, days: number): string => {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

d("a lead's follow-up emails (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'lead-f-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'lead-f-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "PUT", path: string, payload: unknown, cookies: Record<string, string>) =>
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

  const makeUser = async (local: string) => {
    const email = `lead-f-${local}@example.com`;
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
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: ZONE }, cookies);
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
  const sentUrl = (gymId: string, leadId: string) => `${leadUrl(gymId, leadId)}/follow-up`;
  const leadOf = (res: { body: string }) => (JSON.parse(res.body) as { lead: Lead }).lead;
  const pageOf = (res: { body: string }) => JSON.parse(res.body) as LeadsResponse;
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const today = () => dayInTz(new Date(), ZONE);

  const addLead = async (gymId: string, cookies: Record<string, string>, over: Record<string, unknown> = {}) => {
    const res = await post(leadsUrl(gymId), { fullName: "Priya Shah", email: "priya@example.com", source: "walk_in", mayEmail: true, ...over }, cookies);
    expect(res.statusCode).toBe(201);
    return leadOf(res);
  };

  /** What is really stored, never what a reply says. */
  const stored = async (gymId: string) =>
    await sql<{ id: string; status: string; sent: number; last: Date | null; due: string | null }[]>`
      SELECT id, status, follow_ups_sent AS sent, follow_up_last_at AS last, follow_up_due_on::text AS due
      FROM gym_leads WHERE gym_id = ${gymId} ORDER BY created_at, id`;
  const dueIds = async (gymId: string, cookies: Record<string, string>) => {
    const page = pageOf(await get(`${leadsUrl(gymId)}?followUp=due`, cookies));
    return { ids: page.leads.map((l) => l.id).sort(), count: page.counts.followUpsDue };
  };
  /** The address a lead has now, as the panel sends it with "Mark as sent". */
  const emailOf = async (leadId: string): Promise<string> =>
    (await sql<{ email: string | null }[]>`SELECT email::text AS email FROM gym_leads WHERE id = ${leadId}`)[0]?.email ?? "nobody@example.com";
  const mark = async (gymId: string, leadId: string, step: number, cookies: Record<string, string>, email?: string) =>
    await post(sentUrl(gymId, leadId), { step, email: email ?? (await emailOf(leadId)) }, cookies);
  /** "A week later": every time the lead holds moved back 7 days, as the clock would. */
  const dueToday = async (leadId: string) => {
    await sql`
      UPDATE gym_leads
      SET email_ok_at = email_ok_at - interval '7 days',
          follow_up_last_at = follow_up_last_at - interval '7 days',
          follow_up_due_on = follow_up_due_on - 7
      WHERE id = ${leadId} AND follow_up_due_on IS NOT NULL`;
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

  // â”€â”€ THE WORST THING: A NUDGE TO EMAIL SOMEBODY WHO NEVER SAID YES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it(
    "only a New lead who said yes to email is ever due a follow-up: no tick, another status, a changed address or Joined never is",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeOrg(owner.cookies, "Worst Follow-ups Gym");
      const gym = org.org.id;

      const yes = await addLead(gym, owner.cookies);
      const noTick = await addLead(gym, owner.cookies, { fullName: "Ana Silva", email: "ana@example.com", mayEmail: false });
      const phoneOnly = await addLead(gym, owner.cookies, { fullName: "Tom Reid", email: undefined, phone: "07700 900456", mayEmail: undefined });
      const contacted = await addLead(gym, owner.cookies, { fullName: "Lee Chan", email: "lee@example.com" });
      const onTrial = await addLead(gym, owner.cookies, { fullName: "Mo Khan", email: "mo@example.com" });
      const lost = await addLead(gym, owner.cookies, { fullName: "Sam Gold", email: "sam@example.com" });
      const moved = await addLead(gym, owner.cookies, { fullName: "Jo Park", email: "jo@example.com" });
      const untick = await addLead(gym, owner.cookies, { fullName: "Kit Ray", email: "kit@example.com" });
      const joined = await addLead(gym, owner.cookies, { fullName: "Eve Stone", email: "eve@example.com" });
      // One already sent, then the tick taken off: the rest never come due.
      const sentThenUntick = await addLead(gym, owner.cookies, { fullName: "Ray Low", email: "ray@example.com" });
      expect((await mark(gym, sentThenUntick.id, 1, owner.cookies)).statusCode).toBe(200);
      const sentThenLost = await addLead(gym, owner.cookies, { fullName: "Uma Bell", email: "uma@example.com" });
      expect((await mark(gym, sentThenLost.id, 1, owner.cookies)).statusCode).toBe(200);

      // Each is due on the day of the tick, before anything moves.
      expect(yes.followUp).toEqual({ sent: 0, dueOn: today(), dueNow: true, overdue: false, lastSentAt: null, by: "you", notSent: null, optedOutAt: null });
      expect(noTick.followUp).toEqual({ sent: 0, dueOn: null, dueNow: false, overdue: false, lastSentAt: null, by: null, notSent: null, optedOutAt: null });
      expect(phoneOnly.followUp.dueOn).toBeNull();

      expect((await patch(leadUrl(gym, contacted.id), { status: "contacted" }, owner.cookies)).statusCode).toBe(200);
      expect((await patch(leadUrl(gym, onTrial.id), { status: "on_trial" }, owner.cookies)).statusCode).toBe(200);
      expect((await patch(leadUrl(gym, lost.id), { status: "lost" }, owner.cookies)).statusCode).toBe(200);
      const newAddress = await patch(leadUrl(gym, moved.id), { email: "jo.park@example.com" }, owner.cookies);
      expect(leadOf(newAddress)).toMatchObject({ mayEmail: false, followUp: { dueOn: null, dueNow: false } });
      expect((await patch(leadUrl(gym, untick.id), { mayEmail: false }, owner.cookies)).statusCode).toBe(200);
      const unticked = await patch(leadUrl(gym, sentThenUntick.id), { mayEmail: false }, owner.cookies);
      expect(unticked.statusCode).toBe(200);
      expect(leadOf(unticked).followUp).toMatchObject({ sent: 1, dueOn: null, dueNow: false });
      const lostAfterOne = await patch(leadUrl(gym, sentThenLost.id), { status: "lost" }, owner.cookies);
      expect(lostAfterOne.statusCode).toBe(200);
      expect(leadOf(lostAfterOne).followUp).toMatchObject({ sent: 1, dueOn: null, dueNow: false });
      const join = await post(`${leadUrl(gym, joined.id)}/join`, {}, owner.cookies);
      expect(join.statusCode).toBe(200);
      expect(leadOf(join).followUp.dueOn).toBeNull();

      // Only Priya is due, in the list, in the count, and in the database.
      expect(await dueIds(gym, owner.cookies)).toEqual({ ids: [yes.id], count: 1 });
      const rows = await stored(gym);
      expect(rows.filter((r) => r.due !== null).map((r) => r.id)).toEqual([yes.id]);

      // None of the others can be marked as sent, and nothing is written for them.
      for (const [lead, step] of [
        [noTick, 1],
        [phoneOnly, 1],
        [contacted, 1],
        [onTrial, 1],
        [lost, 1],
        [moved, 1],
        [untick, 1],
        [joined, 1],
        [sentThenUntick, 2],
        [sentThenLost, 2],
      ] as const) {
        const res = await mark(gym, lead.id, step, owner.cookies);
        expect({ id: lead.id, status: res.statusCode, error: errorOf(res) }).toEqual({ id: lead.id, status: 409, error: "follow_up_not_due" });
      }
      expect(await stored(gym)).toEqual(rows);

      // The database itself refuses a due day on anybody but a New lead with the tick.
      await expect(sql`UPDATE gym_leads SET follow_up_due_on = ${today()}::date WHERE id = ${lost.id}`).rejects.toThrow(
        /gym_leads_follow_up_due_check/,
      );
      await expect(sql`UPDATE gym_leads SET follow_up_due_on = ${today()}::date WHERE id = ${noTick.id}`).rejects.toThrow(
        /gym_leads_follow_up_due_check/,
      );
    },
    TIMEOUT_MS,
  );

  it(
    "nobody outside this gym's ticked staff can see or mark its follow-ups, and every refusal writes nothing",
    async () => {
      const owner = await makeUser("door-owner");
      const stranger = await makeUser("door-stranger");
      const member = await makeUser("door-member");
      const rival = await makeUser("door-rival");
      const org = await makeOrg(owner.cookies, "Door Follow-ups Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Rival Follow-ups Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      const trainer = await makeStaff(org, owner.cookies, "door-trainer", "trainer");
      expect(ROLE_PRIVILEGES.trainer).not.toContain("members.confirm");

      const lead = await addLead(org.org.id, owner.cookies);
      const rivalLead = await addLead(rivalOrg.org.id, rival.cookies, { fullName: "Rival Person", email: "rival.lead@example.com" });
      // The positive control: the owner opens both doors.
      expect((await get(`${leadsUrl(org.org.id)}?followUp=due`, owner.cookies)).statusCode).toBe(200);
      const before = await stored(org.org.id);
      const rivalBefore = await stored(rivalOrg.org.id);

      const outsiders = [
        { who: "a stranger", cookies: stranger.cookies, status: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, status: 404 },
        { who: "this gym's member", cookies: member.cookies, status: 404 },
        { who: "this gym's trainer", cookies: trainer.cookies, status: 403 },
        { who: "nobody signed in", cookies: {}, status: 401 },
      ];
      for (const { who, cookies, status } of outsiders) {
        for (const res of [
          await get(`${leadsUrl(org.org.id)}?followUp=due`, cookies),
          await mark(org.org.id, lead.id, 1, cookies),
        ]) {
          expect({ who, status: res.statusCode }).toEqual({ who, status });
          expect(res.body).not.toContain("Priya");
          expect(res.body).not.toContain("priya");
        }
      }
      // A rival's lead under this gym's address, and this gym's under the rival's: 404.
      expect((await mark(org.org.id, rivalLead.id, 1, owner.cookies)).statusCode).toBe(404);
      expect((await mark(rivalOrg.org.id, lead.id, 1, rival.cookies)).statusCode).toBe(404);
      expect(await stored(org.org.id)).toEqual(before);
      expect(await stored(rivalOrg.org.id)).toEqual(rivalBefore);
      // The due list holds only this gym's lead.
      expect(await dueIds(org.org.id, owner.cookies)).toEqual({ ids: [lead.id], count: 1 });
    },
    TIMEOUT_MS,
  );

  // â”€â”€ THE THREE, IN ORDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it(
    "day 0, then 3 days after the first, then 4 after the second; each counted once, in order, then none",
    async () => {
      const owner = await makeUser("order-owner");
      const manager = await makeUser("order-manager");
      const org = await makeOrg(owner.cookies, "Order Follow-ups Gym");
      await joinAsMember(manager.cookies, org, owner.cookies);
      expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: manager.email, role: "manager" }, owner.cookies)).statusCode).toBe(201);
      const gym = org.org.id;
      const lead = await addLead(gym, manager.cookies);

      // Out of order: the second before the first.
      const early = await mark(gym, lead.id, 2, manager.cookies);
      expect({ status: early.statusCode, error: errorOf(early) }).toEqual({ status: 409, error: "follow_up_not_due" });

      const first = await mark(gym, lead.id, 1, manager.cookies);
      expect(first.statusCode).toBe(200);
      expect(leadOf(first).followUp).toMatchObject({ sent: 1, dueOn: addDays(today(), 3), dueNow: false });
      expect(leadOf(first).followUp.lastSentAt).not.toBeNull();
      expect(await dueIds(gym, manager.cookies)).toEqual({ ids: [], count: 0 });

      // The second before its day: refused, and nothing written.
      const before = await stored(gym);
      const tooSoon = await mark(gym, lead.id, 2, manager.cookies);
      expect({ status: tooSoon.statusCode, error: errorOf(tooSoon) }).toEqual({ status: 409, error: "follow_up_not_due" });
      expect(await stored(gym)).toEqual(before);

      // The same press again: counted once.
      const again = await mark(gym, lead.id, 1, manager.cookies);
      expect(again.statusCode).toBe(200);
      expect(leadOf(again).followUp.sent).toBe(1);

      await dueToday(lead.id);
      expect(await dueIds(gym, manager.cookies)).toEqual({ ids: [lead.id], count: 1 });
      const second = await mark(gym, lead.id, 2, manager.cookies);
      expect(leadOf(second).followUp).toMatchObject({ sent: 2, dueOn: addDays(today(), 4), dueNow: false });

      await dueToday(lead.id);
      const third = await mark(gym, lead.id, 3, manager.cookies);
      expect(leadOf(third).followUp).toMatchObject({ sent: 3, dueOn: null, dueNow: false });
      expect((await stored(gym))[0]).toMatchObject({ sent: 3, due: null });

      const audit = await sql<{ step: string }[]>`
        SELECT meta->>'step' AS step FROM audit_log
        WHERE gym_id = ${gym} AND action = 'org.lead_follow_up_sent' AND target_id = ${lead.id} AND actor_user_id = ${manager.userId}
        ORDER BY at`;
      expect(audit.map((a) => a.step)).toEqual(["1", "2", "3"]);
    },
    TIMEOUT_MS,
  );

  it(
    "a status that moves stops them and New takes up where they were; a new address starts them from the first",
    async () => {
      const owner = await makeUser("move-owner");
      const org = await makeOrg(owner.cookies, "Move Follow-ups Gym");
      const gym = org.org.id;
      const lead = await addLead(gym, owner.cookies);
      expect((await mark(gym, lead.id, 1, owner.cookies)).statusCode).toBe(200);

      const contacted = leadOf(await patch(leadUrl(gym, lead.id), { status: "contacted" }, owner.cookies));
      expect(contacted.followUp).toMatchObject({ sent: 1, dueOn: null });
      const back = leadOf(await patch(leadUrl(gym, lead.id), { status: "new" }, owner.cookies));
      expect(back.followUp).toMatchObject({ sent: 1, dueOn: addDays(today(), 3) });

      // A new address clears the tick; ticked again, the three start again for it.
      const moved = leadOf(await patch(leadUrl(gym, lead.id), { email: "priya.shah@example.com" }, owner.cookies));
      expect(moved.followUp).toEqual({ sent: 0, dueOn: null, dueNow: false, overdue: false, lastSentAt: null, by: null, notSent: null, optedOutAt: null });
      const reticked = leadOf(await patch(leadUrl(gym, lead.id), { mayEmail: true }, owner.cookies));
      expect(reticked.followUp).toEqual({ sent: 0, dueOn: today(), dueNow: true, overdue: false, lastSentAt: null, by: "you", notSent: null, optedOutAt: null });

      // The same address in other capitals is the same address: nothing restarts.
      expect((await mark(gym, lead.id, 1, owner.cookies)).statusCode).toBe(200);
      const caps = leadOf(await patch(leadUrl(gym, lead.id), { email: "Priya.Shah@Example.com" }, owner.cookies));
      expect(caps.followUp.sent).toBe(1);
      expect(caps.mayEmail).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    "two staff marking the same one at the same instant count it once, and a trainer beside them is refused",
    async () => {
      const owner = await makeUser("race-owner");
      const org = await makeOrg(owner.cookies, "Race Follow-ups Gym");
      const manager = await makeStaff(org, owner.cookies, "race-manager", "manager");
      const trainer = await makeStaff(org, owner.cookies, "race-trainer", "trainer");
      const gym = org.org.id;
      const lead = await addLead(gym, owner.cookies);
      const answers = await Promise.all([
        mark(gym, lead.id, 1, owner.cookies),
        mark(gym, lead.id, 1, manager.cookies),
        mark(gym, lead.id, 1, trainer.cookies),
        mark(gym, lead.id, 1, manager.cookies),
      ]);
      expect(answers.map((a) => a.statusCode)).toEqual([200, 200, 403, 200]);
      expect((await stored(gym))[0]?.sent).toBe(1);
      const audit = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym} AND action = 'org.lead_follow_up_sent'`;
      expect(audit[0]?.n).toBe(1);
    },
    TIMEOUT_MS,
  );

  it(
    "a mark from a panel opened before the address changed counts for nobody",
    async () => {
      const owner = await makeUser("stale-owner");
      const org = await makeOrg(owner.cookies, "Stale Follow-ups Gym");
      const gym = org.org.id;
      const lead = await addLead(gym, owner.cookies);
      // Staff A's panel shows priya@example.com; staff B corrects the address and ticks it again.
      expect(leadOf(await patch(leadUrl(gym, lead.id), { email: "priya.shah@example.com" }, owner.cookies)).followUp.sent).toBe(0);
      expect(leadOf(await patch(leadUrl(gym, lead.id), { mayEmail: true }, owner.cookies)).followUp.dueNow).toBe(true);
      const before = await stored(gym);
      // A marks the email that went to the old address.
      const stale = await mark(gym, lead.id, 1, owner.cookies, "priya@example.com");
      expect({ status: stale.statusCode, error: errorOf(stale) }).toEqual({ status: 409, error: "follow_up_not_due" });
      expect(await stored(gym)).toEqual(before);
      // The address on screen now, in other capitals, is the same address.
      const current = await mark(gym, lead.id, 1, owner.cookies, "Priya.Shah@Example.com");
      expect(current.statusCode).toBe(200);
      expect(leadOf(current).followUp.sent).toBe(1);
    },
    TIMEOUT_MS,
  );

  it(
    "due days are the gym's own: a gym at +14 hours and one at -11 are always a day apart",
    async () => {
      const owner = await makeUser("zone-owner");
      const days: string[] = [];
      for (const [name, timezone] of [
        ["Kiritimati Follow-ups Gym", "Pacific/Kiritimati"],
        ["Pago Pago Follow-ups Gym", "Pacific/Pago_Pago"],
      ] as const) {
        const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone }, owner.cookies);
        expect(res.statusCode).toBe(201);
        const gym = (JSON.parse(res.body) as CreatedOrg).org.id;
        await subscribeGym(gym);
        const lead = await addLead(gym, owner.cookies);
        expect(lead.followUp).toMatchObject({ dueOn: dayInTz(new Date(), timezone), dueNow: true, overdue: false });
        const first = leadOf(await mark(gym, lead.id, 1, owner.cookies));
        expect(first.followUp.dueOn).toBe(addDays(dayInTz(new Date(), timezone), 3));
        days.push(lead.followUp.dueOn ?? "");
      }
      // 25 hours apart: whatever the hour, the two gyms are on different days.
      expect(days[0]).not.toBe(days[1]);
    },
    TIMEOUT_MS,
  );

  it(
    "an email whose day has passed is due now and says it is late",
    async () => {
      const owner = await makeUser("late-owner");
      const org = await makeOrg(owner.cookies, "Late Follow-ups Gym");
      const gym = org.org.id;
      const lead = await addLead(gym, owner.cookies);
      await sql`UPDATE gym_leads SET follow_up_due_on = ${addDays(today(), -20)}::date WHERE id = ${lead.id}`;
      const read = leadOf(await get(leadUrl(gym, lead.id), owner.cookies));
      expect(read.followUp).toMatchObject({ dueOn: addDays(today(), -20), dueNow: true, overdue: true });
      expect(leadOf(await mark(gym, lead.id, 1, owner.cookies)).followUp.sent).toBe(1);
    },
    TIMEOUT_MS,
  );

  /** `0047`'s fill-in for leads ticked before it, read out of the shipped file and run on
   *  TEMPORARY copies, never the live tables, then rolled back. */
  it(
    "0047 makes a New lead ticked before it due on the gym's day of the tick, and nobody else",
    async () => {
      const migration = await readFile(new URL("../drizzle/0047_lead_follow_ups.sql", import.meta.url), "utf8");
      const fills = migration
        .split("--> statement-breakpoint")
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.includes("UPDATE gym_leads"));
      if (fills.length !== 1) throw new Error(`0047 no longer holds exactly one fill-in (found ${String(fills.length)})`);
      const fill = (fills[0] ?? "").replace("UPDATE gym_leads l", "UPDATE leads_0047 l").replace("FROM gyms g", "FROM gyms_0047 g");
      const ROLLBACK = "ROLLBACK-0047-FIXTURE";
      await sql
        .begin(async (tx) => {
          await tx`CREATE TEMP TABLE gyms_0047 (id uuid PRIMARY KEY, timezone text NOT NULL) ON COMMIT DROP`;
          await tx`CREATE TEMP TABLE leads_0047 (LIKE gym_leads INCLUDING DEFAULTS) ON COMMIT DROP`;
          const east = randomUUID();
          const west = randomUUID();
          const nowhere = randomUUID();
          await tx`INSERT INTO gyms_0047 VALUES (${east}, 'Pacific/Kiritimati'), (${west}, 'Pacific/Pago_Pago'), (${nowhere}, 'Mars/Olympus')`;
          // 12:00 UTC on 26 Sept is the 27th at +14 and still the 26th at -11.
          const tick = new Date("2026-09-26T12:00:00Z");
          const lead = async (gymId: string, status: string, ticked: boolean): Promise<string> => {
            const [row] = await tx<{ id: string }[]>`
              INSERT INTO leads_0047 (gym_id, full_name, email, source, status, email_ok_at)
              VALUES (${gymId}, 'Priya Shah', 'priya@example.com', 'walk_in', ${status}, ${ticked ? tick : null})
              RETURNING id`;
            if (row === undefined) throw new Error("fixture insert failed");
            return row.id;
          };
          const cases: [string, string | null][] = [
            [await lead(east, "new", true), "2026-09-27"],
            [await lead(west, "new", true), "2026-09-26"],
            [await lead(east, "new", false), null],
            [await lead(east, "lost", true), null],
            [await lead(east, "contacted", true), null],
            [await lead(nowhere, "new", true), null],
          ];
          for (let run = 1; run <= 2; run += 1) {
            await tx.unsafe(fill);
            for (const [id, due] of cases) {
              const [row] = await tx<{ due: string | null }[]>`SELECT follow_up_due_on::text AS due FROM leads_0047 WHERE id = ${id}`;
              expect({ run, id, due: row?.due }).toEqual({ run, id, due });
            }
          }
          throw new Error(ROLLBACK);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === ROLLBACK) return;
          throw err;
        });
    },
    TIMEOUT_MS,
  );

  it(
    "a step that is not 1, 2 or 3 is refused; a lapsed gym can read its due list but mark nothing",
    async () => {
      const owner = await makeUser("edge-owner");
      const org = await makeOrg(owner.cookies, "Edge Follow-ups Gym");
      const gym = org.org.id;
      const lead = await addLead(gym, owner.cookies);
      const at = "priya@example.com";
      for (const body of [
        {},
        { email: at },
        { step: 1 },
        { step: 1, email: "" },
        { step: 0, email: at },
        { step: 4, email: at },
        { step: 1.5, email: at },
        { step: "1", email: at },
        { step: 1, email: at, extra: true },
      ]) {
        const res = await post(sentUrl(gym, lead.id), body, owner.cookies);
        expect({ body, status: res.statusCode }).toEqual({ body, status: 400 });
      }
      expect((await get(`${leadsUrl(gym)}?followUp=soon`, owner.cookies)).statusCode).toBe(400);

      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym}`;
      expect(await dueIds(gym, owner.cookies)).toEqual({ ids: [lead.id], count: 1 });
      const lapsed = await mark(gym, lead.id, 1, owner.cookies);
      expect({ status: lapsed.statusCode, error: errorOf(lapsed) }).toEqual({ status: 409, error: "gym_not_on_plan" });
      expect((await stored(gym))[0]).toMatchObject({ sent: 0, due: today() });
    },
    TIMEOUT_MS,
  );
});
