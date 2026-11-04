// A reminder before a renewal or a minimum term's end (ROADMAP 18v-iv): the line's setting, the worker's queue
// and sender, the line's box and a person's page, against real Postgres (DATABASE_URL-gated).
//
// The first test is the worst thing this job could do to a real person: an email saying a charge is coming when
// none is (they cancelled, set it to end, or froze it), an email about somebody else's membership, the wrong day
// or amount, or the same email twice. Every claim is read from what the fake email service was handed.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { heldMembershipsResponseSchema, renewalReminderPreviewResponseSchema, dayWords, addDays, type GymMembershipTypesResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { InviteEmail } from "../src/email/resend.js";
import { sendDueRenewalReminders } from "../src/modules/orgs/memberships/renewalReminders.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "renewal-reminder-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  INVITE_HMAC_SECRET: "renewal-reminder-address-key-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

const T = 300_000;
const LIVE_PLAN = "zz_renewal_reminders";

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Gym {
  id: string;
  name: string;
  cookies: Cookies;
}

let ipCounter = 0;
const nextIp = () => `10.62.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const weekly = {
  name: "Gold Weekly",
  description: null,
  kind: "recurring",
  priceMinor: 2500,
  termCount: 1,
  termUnit: "week",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};

d("A reminder before a renewal or a minimum term's end (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  // Noon in Chicago today: the gym's morning has begun, whatever hour the test runs.
  const chicagoToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  let clock = new Date(`${chicagoToday}T17:00:00Z`);
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const gyms: Gym[] = [];
  const mail: InviteEmail[] = [];
  const HMAC_KEY = Buffer.from(baseEnv.INVITE_HMAC_SECRET, "utf8");
  const remind = () =>
    sendDueRenewalReminders({
      sql,
      log: quiet,
      settings: { hmacKey: HMAC_KEY, webOrigin: "http://localhost:5173", perDay: 0, paused: false, sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" } },
      sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" },
      transport: {
        send: (m) => {
          mail.push(m);
          return Promise.resolve({ kind: "sent", id: `re_${uniq()}` });
        },
      },
      now: () => clock,
      sleep: () => Promise.resolve(),
      gymIds: gyms.map((g) => g.id),
    });

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rrem-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'rrem-t-%@example.com'`;
    await sql`DELETE FROM gym_renewal_reminders WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mineSql})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gyms WHERE id IN (${mineSql})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'rrem-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const makeGym = async (label: string): Promise<Gym> => {
    const email = `rrem-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: `${label} Owner` });
    expect(reg.statusCode, reg.body).toBe(201);
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const cookies = cookieMap(login);
    const name = `${label} ${uniq()}`;
    const res = await send("POST", "/v1/orgs", cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const gym = { id, name, cookies };
    gyms.push(gym);
    return gym;
  };
  /** Gold Weekly with a reminder 3 days before every renewal. */
  const lineOf = async (gym: Gym): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.cookies, { ...weekly, renewalReminderDays: 3 });
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === weekly.name);
    if (found === undefined) throw new Error("no type");
    expect([found.renewalReminderDays, found.termReminderDays]).toEqual([3, null]);
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const person = async (gym: Gym, fullName: string, email: string | null = `rrem-r-${uniq()}@example.com`): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.cookies, email === null ? { fullName, phone: `+1 312 555 ${String(1000 + (seq++ % 9000))}` } : { fullName, email });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const emailOf = async (entryId: string): Promise<string> => {
    const [row] = await sql<{ email: string }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE id = ${entryId}`;
    return row?.email ?? "";
  };
  /** Gold Weekly from `startsOn`, its first week paid at the desk. */
  const give = async (gym: Gym, typeId: string, entryId: string, startsOn: string): Promise<string> => {
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships.find((x) => x.startsOn === startsOn);
    if (m === undefined) throw new Error("no membership");
    return m.id;
  };
  const pageOf = async (gym: Gym, entryId: string, cookies = gym.cookies) => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const mailTo = (address: string) => mail.filter((m) => m.to === address);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
    });
    await api().ready();
  }, T);
  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("emails only whoever pays for a renewal that will happen, about their own, on the right day and amount, once", async () => {
    const today = chicagoToday;
    const gym = await makeGym("Remind Gym");
    const other = await makeGym("Other Gym");
    const line = await lineOf(gym);
    const otherLine = await lineOf(other);
    // Started five days ago: renews in two days, inside the three.
    const fiveAgo = addDays(today, -5);
    const renewsOn = addDays(today, 2);

    const ana = await person(gym, "Ana Renewing");
    await give(gym, line, ana, fiveAgo);
    // Ben cancelled today, Cal set his to end at the end of what is paid, Dee froze hers: no charge is coming.
    const ben = await person(gym, "Ben Cancelled");
    const benM = await give(gym, line, ben, fiveAgo);
    expect((await send("POST", `${entryUrl(gym, ben)}/memberships/${benM}/cancel`, gym.cookies, { when: "today" })).statusCode).toBe(200);
    const cal = await person(gym, "Cal Stopping");
    const calM = await give(gym, line, cal, fiveAgo);
    expect((await send("POST", `${entryUrl(gym, cal)}/memberships/${calM}/cancel`, gym.cookies, { when: "period_end" })).statusCode).toBe(200);
    const dee = await person(gym, "Dee Frozen");
    const deeM = await give(gym, line, dee, fiveAgo);
    const frozen = await send("POST", `${entryUrl(gym, dee)}/memberships/${deeM}/freeze`, gym.cookies, { feeMinor: 0 });
    expect(frozen.statusCode, frozen.body).toBe(200);
    // Tom pays for Kim: Tom is told, by her name, and Kim is not.
    const tom = await person(gym, "Tom Payer");
    const kim = await person(gym, "Kim Child");
    await give(gym, line, kim, fiveAgo);
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${kim}, ${tom})`;
    // Eve renews in five days: not yet. Nell has a phone only: nobody to email.
    const eve = await person(gym, "Eve Later");
    await give(gym, line, eve, addDays(today, -2));
    const nell = await person(gym, "Nell Phone", null);
    await give(gym, line, nell, fiveAgo);
    // The other gym's own member, due too: emailed by her own gym, never named in this one's.
    const ola = await person(other, "Ola Other");
    await give(other, otherLine, ola, fiveAgo);

    const first = await remind();
    expect(first.sent).toBe(3);
    const anaMail = mailTo(await emailOf(ana));
    const tomMail = mailTo(await emailOf(tom));
    const olaMail = mailTo(await emailOf(ola));
    expect(anaMail).toHaveLength(1);
    expect(tomMail).toHaveLength(1);
    expect(olaMail).toHaveLength(1);
    for (const who of [ben, cal, dee, kim, eve]) expect(mailTo(await emailOf(who))).toHaveLength(0);
    expect(anaMail[0]?.subject).toBe(`Your membership at ${gym.name} renews on ${dayWords(renewsOn)}`);
    expect(anaMail[0]?.text).toContain(`Your Gold Weekly membership at ${gym.name} renews on ${dayWords(renewsOn)} for $25.00.`);
    expect(anaMail[0]?.text).toContain("The payment is due that day.");
    expect(tomMail[0]?.text).toContain(`Hi Tom,`);
    expect(tomMail[0]?.text).toContain(`Kim Child's Gold Weekly membership at ${gym.name} renews on ${dayWords(renewsOn)} for $25.00.`);
    expect(olaMail[0]?.text).toContain(other.name);
    expect(olaMail[0]?.text).not.toContain(gym.name);

    // The worker's next minutes, two at once, and the next morning: nothing again.
    await Promise.all([remind(), remind()]);
    clock = new Date(clock.getTime() + 24 * 60 * 60_000);
    await remind();
    expect(mail).toHaveLength(3);
    clock = new Date(`${chicagoToday}T17:00:00Z`);

    // Ana's page says it was sent; Nell's says why not; Ben's has none to come.
    const anaPage = await pageOf(gym, ana);
    expect(anaPage.renewalReminders.map((r) => r.status)).toEqual([{ state: "sent", on: today, aboutOn: renewsOn }]);
    expect((await pageOf(gym, nell)).renewalReminders.map((r) => r.status.state)).toEqual(["no_email"]);
    expect((await pageOf(gym, ben)).renewalReminders).toEqual([]);
    expect((await pageOf(gym, cal)).renewalReminders.map((r) => r.status.state)).toEqual(["not_renewing"]);
    expect((await pageOf(gym, dee)).renewalReminders.map((r) => r.status.state)).toEqual(["frozen"]);
    expect((await pageOf(gym, eve)).renewalReminders.map((r) => r.status)).toEqual([{ state: "will_send", on: addDays(today, 2), aboutOn: addDays(today, 5) }]);
  });

  it("checks again before each email: one cancelled after it was written is never sent", async () => {
    const gym = await makeGym("Race Gym");
    const line = await lineOf(gym);
    const fay = await person(gym, "Fay Cancels");
    const fayM = await give(gym, line, fay, addDays(chicagoToday, -5));
    // As the queue would have written it this morning, then she cancels before it goes.
    await sql`
      INSERT INTO gym_renewal_reminders (gym_id, held_membership_id, entry_id, occasion, what, about_on, email, state, not_before, created_at)
      VALUES (${gym.id}, ${fayM}, ${fay}, 'renew:1', 'renews', ${addDays(chicagoToday, 2)}::date, ${await emailOf(fay)}, 'queued', ${clock}, ${clock})`;
    await sql`UPDATE gyms SET renewal_reminders_checked_on = ${chicagoToday}::date WHERE id = ${gym.id}`;
    expect((await send("POST", `${entryUrl(gym, fay)}/memberships/${fayM}/cancel`, gym.cookies, { when: "today" })).statusCode).toBe(200);
    // Gil's is still running, but set to end at the end of what is paid after it was written: no renewal comes.
    const gil = await person(gym, "Gil Stops");
    const gilM = await give(gym, line, gil, addDays(chicagoToday, -5));
    await sql`
      INSERT INTO gym_renewal_reminders (gym_id, held_membership_id, entry_id, occasion, what, about_on, email, state, not_before, created_at)
      VALUES (${gym.id}, ${gilM}, ${gil}, 'renew:1', 'renews', ${addDays(chicagoToday, 2)}::date, ${await emailOf(gil)}, 'queued', ${clock}, ${clock})`;
    expect((await send("POST", `${entryUrl(gym, gil)}/memberships/${gilM}/cancel`, gym.cookies, { when: "period_end" })).statusCode).toBe(200);
    const run = await remind();
    expect(run.dropped).toBe(2);
    expect(mailTo(await emailOf(fay))).toHaveLength(0);
    expect(mailTo(await emailOf(gil))).toHaveLength(0);
    expect(await sql`SELECT 1 FROM gym_renewal_reminders WHERE held_membership_id IN (${fayM}, ${gilM})`).toHaveLength(0);
  });

  it("the line's box lists who would be emailed and why not; another gym's owner gets nothing", async () => {
    const gym = await makeGym("Box Gym");
    const stranger = await makeGym("Stranger Gym");
    const created = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.cookies, weekly);
    expect(created.statusCode, created.body).toBe(201);
    const line = (JSON.parse(created.body) as GymMembershipTypesResponse).types.find((t) => t.name === weekly.name)?.id ?? "";
    const gus = await person(gym, "Gus Box");
    await give(gym, line, gus, addDays(chicagoToday, -1));
    const hal = await person(gym, "Hal Phone", null);
    await give(gym, line, hal, addDays(chicagoToday, -1));
    const path = `/v1/orgs/${gym.id}/membership-types/${line}/renewal-reminders/preview`;

    const box = await send("POST", path, gym.cookies, { renewalReminder: { when: "every_renewal", days: 3 } });
    expect(box.statusCode, box.body).toBe(200);
    const people = renewalReminderPreviewResponseSchema.parse(JSON.parse(box.body)).people;
    expect(people.map((p) => [p.name, p.status.state, p.status.on])).toEqual([
      ["Gus Box", "will_send", addDays(chicagoToday, 3)],
      ["Hal Phone", "no_email", null],
    ]);
    // Asking for the box writes nothing: the line still has no reminder, and nobody is emailed.
    await remind();
    expect(mailTo(await emailOf(gus))).toHaveLength(0);

    // A wrong pick is refused; another gym's owner, on this gym's path or with this line on their own, gets nothing.
    expect((await send("POST", path, gym.cookies, { renewalReminder: { when: "every_renewal", days: 10 } })).statusCode).toBe(400);
    const theirs = await send("POST", path, stranger.cookies, { renewalReminder: { when: "every_renewal", days: 3 } });
    expect([403, 404]).toContain(theirs.statusCode);
    expect(theirs.body).not.toContain("Gus");
    const crossed = await send("POST", `/v1/orgs/${stranger.id}/membership-types/${line}/renewal-reminders/preview`, stranger.cookies, { renewalReminder: { when: "every_renewal", days: 3 } });
    expect(crossed.statusCode).toBe(404);
    expect(crossed.body).not.toContain("Gus");
    expect((await send("GET", `${entryUrl(gym, gus)}/memberships`, stranger.cookies)).statusCode).toBeGreaterThanOrEqual(403);
  });

  it("a line refuses a reminder before the minimum term ends without a term, and 30 days before every weekly renewal", async () => {
    const gym = await makeGym("Rule Gym");
    for (const asked of [{ termReminderDays: 30 }, { renewalReminderDays: 7 }]) {
      const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.cookies, { ...weekly, ...asked });
      expect(res.statusCode, res.body).toBe(400);
    }
    const ok = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.cookies, { ...weekly, contractPeriods: 12, contractThen: "renews", renewalReminderDays: 3, termReminderDays: 30 });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("a line with both: before its minimum term ends and before every renewal, each emailed once, each saying its own", async () => {
    const gym = await makeGym("Both Gym");
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.cookies, { ...weekly, contractPeriods: 4, contractThen: "renews", renewalReminderDays: 3, termReminderDays: 7 });
    expect(res.statusCode, res.body).toBe(201);
    const line = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === weekly.name)?.id ?? "";
    // Four weekly payments from 26 days ago: the term's last day is tomorrow, and it renews the day after.
    const ivy = await person(gym, "Ivy Both");
    await give(gym, line, ivy, addDays(chicagoToday, -26));
    const lastDay = addDays(chicagoToday, 1);
    const renewsOn = addDays(chicagoToday, 2);
    await remind();
    await remind();
    const ivyMail = mailTo(await emailOf(ivy));
    expect(ivyMail.map((m) => m.subject).sort()).toEqual(
      [`Your membership at ${gym.name} renews on ${dayWords(renewsOn)}`, `Your minimum term at ${gym.name} ends on ${dayWords(lastDay)}`].sort(),
    );
    expect(ivyMail.find((m) => m.subject.includes("minimum term"))?.text).toContain("After that, it carries on at $25.00 every week until you cancel.");
    const page = await pageOf(gym, ivy);
    expect(page.renewalReminders.map((r) => [r.when, r.status.state]).sort()).toEqual([
      ["every_renewal", "sent"],
      ["term_end", "sent"],
    ]);
  });
});
