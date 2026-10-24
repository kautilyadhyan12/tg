// A reminder before a card expires (ROADMAP 18d-iii-c; spec Part 3 §14.8): the gym's switch in Bills,
// the worker's queue and sender, the box's list and the person's page, against real Postgres
// (DATABASE_URL-gated), with Square's connect answered by the fake in `fakeSquareTerminal.ts`.
//
// The first test is the worst thing this job could do to a real person: an email about a card that
// is not theirs, an email from a gym that never switched these on, or the same email twice. Every
// claim is read from what the fake email service was handed, never from a count alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  billSettingsResponseSchema,
  heldMembershipsResponseSchema,
  memberCardResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type CardExpiryOutcome,
  type GymMembershipTypesResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { InviteEmail } from "../src/email/resend.js";
import { sendDueCardExpiryNotices } from "../src/modules/orgs/payments/cardExpiry.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "card-expiry-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-CARDEXPIRYAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-CARDEXPIRYSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 300_000;
const LIVE_PLAN = "zz_card_expiry";
const HOUR = 60 * 60_000;

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  userId: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  name: string;
  owner: Person;
  acct: Account;
}

let ipCounter = 0;
const nextIp = () => `10.61.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("A reminder before a card expires (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const gyms: Gym[] = [];
  const mail: InviteEmail[] = [];
  const HMAC_KEY = Buffer.alloc(32, 3);
  // The app's daily cap is 0: a reminder about the card they saved is not held by it.
  const remind = () =>
    sendDueCardExpiryNotices({
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
      environment: "production",
      now: () => clock,
      sleep: () => Promise.resolve(),
      gymIds: gyms.map((g) => g.id),
    });

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'cexp-t-%@example.com')`;
  const BOUNCED = "cexp-bounced@example.com";
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'cexp-t-%@example.com'`;
    await sql`DELETE FROM gym_card_expiry_notices WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM email_suppressions WHERE email_hmac = ${createHmac("sha256", HMAC_KEY).update(BOUNCED).digest("hex")}`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'cexp-t-%@example.com'`;
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
  const signedIn = async (name: string): Promise<Person> => {
    const email = `cexp-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to its own Square account. */
  const makeGym = async (label: string): Promise<Gym> => {
    const owner = await signedIn(`${label} Owner`);
    const name = `${label} ${uniq()}`;
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const acct = account(`MEX${uniq()}`);
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    const gym = { id, name, owner, acct };
    gyms.push(gym);
    return gym;
  };
  const typeOf = async (gym: Gym): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, weekly);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === weekly.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  /** A person on the list; `email: null` for one with a phone only. */
  const person = async (gym: Gym, fullName: string, email: string | null = `cexp-r-${uniq()}@example.com`): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, email === null ? { fullName, phone: "+1 312 555 0100" } : { fullName, email });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const emailOf = async (entryId: string): Promise<string> => {
    const [row] = await sql<{ email: string }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE id = ${entryId}`;
    return row?.email ?? "";
  };
  /** Gold Weekly from today, paid at the desk: it renews until it is cancelled. */
  const renewing = async (gym: Gym, typeId: string, entryId: string): Promise<string> => {
    const today = heldMembershipsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies)).body)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    return m.id;
  };
  /** The gym's month on the test's clock, Chicago's. */
  const chicagoMonth = (at: Date): { month: number; year: number } => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric" }).formatToParts(at);
    return { month: Number(parts.find((p) => p.type === "month")?.value), year: Number(parts.find((p) => p.type === "year")?.value) };
  };
  const nextMonth = (m: { month: number; year: number }) => (m.month === 12 ? { month: 1, year: m.year + 1 } : { month: m.month + 1, year: m.year });
  /** A card on file for the record, in the gym's connected account (or `accountId`), ending `last4`. */
  const cardFor = async (gym: Gym, entryId: string, last4: string, exp: { month: number; year: number }, accountId = gym.acct.merchantId): Promise<string> => {
    const cardId = `ccof:${randomUUID()}`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', ${last4}, now())
      RETURNING id`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${accountId}, ${`CUST${uniq()}`}, ${cardId}, 'VISA', ${last4}, ${exp.month}, ${exp.year}, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    return cardId;
  };
  const switchOn = async (gym: Gym, on = true) => {
    const res = await send("PUT", `/v1/orgs/${gym.id}/bill-settings`, gym.owner.cookies, { overdueAfterDays: 0, cardExpiryReminders: on });
    expect(res.statusCode, res.body).toBe(200);
    expect(billSettingsResponseSchema.parse(JSON.parse(res.body)).cardExpiryReminders).toBe(on);
  };
  const settingsOf = async (gym: Gym, cookies = gym.owner.cookies) => {
    const res = await send("GET", `/v1/orgs/${gym.id}/bill-settings`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return billSettingsResponseSchema.parse(JSON.parse(res.body));
  };
  const outcomes = async (gym: Gym): Promise<Record<string, CardExpiryOutcome>> =>
    Object.fromEntries(((await settingsOf(gym)).cardExpiry?.people ?? []).map((p) => [p.name, p.outcome]));
  const cardBox = async (gym: Gym, entryId: string) => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/card`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberCardResponseSchema.parse(JSON.parse(res.body)).cardOnFile.card;
  };
  const mailTo = (address: string) => mail.filter((m) => m.to === address);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(config(), {
      squareApi: square.api,
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

  /** Noon in Chicago today. */
  const noonToday = (): Date => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    return new Date(`${day}T17:00:00Z`);
  };

  it("emails only the cardholder, about their own card, only at a gym that switched it on, and only once", async () => {
    clock = noonToday();
    const now = chicagoMonth(clock);
    const on = await makeGym("Remind Gym");
    const off = await makeGym("Quiet Gym");
    const onType = await typeOf(on);
    const offType = await typeOf(off);

    // Gina's own card pays for her own membership: she is the one emailed.
    const gina = await person(on, "Gina Expiring");
    await renewing(on, onType, gina);
    await cardFor(on, gina, "4242", now);
    // Tom pays for his daughter Kim; Tom's card is the one charged, so Tom is emailed and Kim is not,
    // although Kim kept an older card of her own that also runs out this month.
    const tom = await person(on, "Tom Payer");
    const kim = await person(on, "Kim Child");
    await renewing(on, onType, kim);
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${on.id}, ${kim}, ${tom})`;
    await cardFor(on, tom, "5555", now);
    await cardFor(on, kim, "6666", now);
    // Lars's card runs out next month: not this month's.
    const lars = await person(on, "Lars Later");
    await renewing(on, onType, lars);
    await cardFor(on, lars, "7777", nextMonth(now));
    // The gym that never switched it on: Bea's card runs out this month, and nobody is emailed.
    const bea = await person(off, "Bea Quiet");
    await renewing(off, offType, bea);
    await cardFor(off, bea, "8888", now);

    // Nothing at all before the gym switches it on.
    await remind();
    expect(mail).toHaveLength(0);
    await switchOn(on);
    const first = await remind();
    expect(first.sent).toBe(2);

    const ginaMail = mailTo(await emailOf(gina));
    const tomMail = mailTo(await emailOf(tom));
    expect(ginaMail).toHaveLength(1);
    expect(tomMail).toHaveLength(1);
    expect(mail.map((m) => m.to).sort()).toEqual([await emailOf(gina), await emailOf(tom)].sort());
    for (const address of [await emailOf(kim), await emailOf(lars), await emailOf(bea)]) expect(mailTo(address)).toHaveLength(0);
    const monthName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(now.year, now.month - 1, 15)));
    expect(ginaMail[0]?.text).toContain(`Your Visa ending in 4242 expires at the end of ${monthName}. It pays for your membership at ${on.name}.`);
    expect(ginaMail[0]?.text).not.toContain("5555");
    expect(tomMail[0]?.text).toContain(`Your Visa ending in 5555 expires at the end of ${monthName}. It pays for Kim Child's membership at ${on.name}.`);
    expect(tomMail[0]?.text).not.toContain("6666");
    expect(tomMail[0]?.subject).toBe(`Your card on file with ${on.name} expires this month`);

    // The worker's next minutes, and two at once: nothing again.
    await Promise.all([remind(), remind()]);
    clock = new Date(clock.getTime() + 2 * HOUR);
    await remind();
    expect(mail).toHaveLength(2);

    // The other gym's owner: neither the settings nor a card of this gym.
    expect((await send("GET", `/v1/orgs/${on.id}/bill-settings`, off.owner.cookies)).statusCode).toBe(404);
    expect((await send("PUT", `/v1/orgs/${on.id}/bill-settings`, off.owner.cookies, { overdueAfterDays: 0, cardExpiryReminders: false })).statusCode).toBe(404);
    expect((await send("GET", `${entryUrl(on, gina)}/card`, off.owner.cookies)).statusCode).toBe(404);
    expect(await outcomes(off)).toEqual({ "Bea Quiet": "will_email" });
    expect((await settingsOf(off)).cardExpiryReminders).toBe(false);
  });

  it("says, for each card that runs out this month, who is emailed, who isn't and why, and the person's page says the same", async () => {
    clock = noonToday();
    const now = chicagoMonth(clock);
    const gym = await makeGym("Table Gym");
    const typeId = await typeOf(gym);
    const cases: { name: string; email?: string | null; set: (entryId: string) => Promise<void>; outcome: CardExpiryOutcome }[] = [
      { name: "Ava Renews", set: async (e) => void (await renewing(gym, typeId, e)), outcome: "emailed" },
      {
        name: "Fred Frozen",
        set: async (e) => {
          const m = await renewing(gym, typeId, e);
          await sql`UPDATE gym_held_memberships SET status = 'frozen', frozen_on = starts_on WHERE id = ${m}`;
        },
        outcome: "emailed",
      },
      { name: "Nell No Email", email: null, set: async (e) => void (await renewing(gym, typeId, e)), outcome: "no_email" },
      {
        name: "Stan Stopping",
        set: async (e) => {
          const m = await renewing(gym, typeId, e);
          await sql`UPDATE gym_held_memberships SET renews = false WHERE id = ${m}`;
        },
        outcome: "not_renewing",
      },
      {
        name: "Carl Cancelled",
        set: async (e) => {
          const m = await renewing(gym, typeId, e);
          await sql`UPDATE gym_held_memberships SET status = 'cancelled', cancelled_on = starts_on WHERE id = ${m}`;
        },
        outcome: "not_renewing",
      },
      {
        name: "Pam Past Member",
        set: async (e) => {
          await renewing(gym, typeId, e);
          await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${e}`;
        },
        outcome: "not_renewing",
      },
      { name: "Nina Nothing", set: () => Promise.resolve(), outcome: "not_renewing" },
      { name: "Bo Bounced", email: BOUNCED, set: async (e) => void (await renewing(gym, typeId, e)), outcome: "not_sent" },
    ];
    await sql`INSERT INTO email_suppressions (email_hmac, gym_id, reason) VALUES (${createHmac("sha256", HMAC_KEY).update(BOUNCED).digest("hex")}, NULL, 'bounced') ON CONFLICT DO NOTHING`;
    const ids = new Map<string, string>();
    for (const c of cases) {
      const entryId = c.email === undefined ? await person(gym, c.name) : await person(gym, c.name, c.email);
      await c.set(entryId);
      await cardFor(gym, entryId, "1111", now);
      ids.set(c.name, entryId);
    }
    // A card in a Square account the gym is no longer connected to is never this gym's to remind.
    const otto = await person(gym, "Otto Other Account");
    await renewing(gym, typeId, otto);
    await cardFor(gym, otto, "2222", now, "OTHERACCOUNT1");

    // Before it is switched on: what would happen, from the same rule.
    const before = await outcomes(gym);
    expect(before).toEqual({
      "Ava Renews": "will_email",
      "Fred Frozen": "will_email",
      "Nell No Email": "no_email",
      "Stan Stopping": "not_renewing",
      "Carl Cancelled": "not_renewing",
      "Pam Past Member": "not_renewing",
      "Nina Nothing": "not_renewing",
      "Bo Bounced": "will_email",
    });

    await switchOn(gym);
    const sentBefore = mail.length;
    await remind();
    const sentTo = mail.slice(sentBefore).filter((m) => m.text.includes(gym.name)).map((m) => m.to);
    expect(sentTo.sort()).toEqual([await emailOf(ids.get("Ava Renews") ?? ""), await emailOf(ids.get("Fred Frozen") ?? "")].sort());
    expect(await outcomes(gym)).toEqual(Object.fromEntries(cases.map((c) => [c.name, c.outcome])));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(clock);
    const ava = await cardBox(gym, ids.get("Ava Renews") ?? "");
    expect(ava).toMatchObject({ expiresThisMonth: true, expiryReminder: "emailed", expiryReminderOn: today });
    expect(await cardBox(gym, ids.get("Nell No Email") ?? "")).toMatchObject({ expiryReminder: "no_email" });
    expect(await cardBox(gym, ids.get("Stan Stopping") ?? "")).toMatchObject({ expiresThisMonth: true, expiryReminder: null });
    expect(await cardBox(gym, ids.get("Bo Bounced") ?? "")).toMatchObject({ expiryReminder: "not_sent" });
  });

  it("waits until 6 in the morning, and sends nothing for a card that changed, a gym that switched off or an address that changed meanwhile", async () => {
    const gym = await makeGym("Change Gym");
    const typeId = await typeOf(gym);
    // 5 a.m. in Chicago on the first of this month: nothing yet.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    const chicagoHour = (at: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(at));
    clock = [10, 11].map((utc) => new Date(`${day.slice(0, 8)}01T${String(utc)}:00:00Z`)).find((at) => chicagoHour(at) === 5) ?? new Date(NaN);
    const now = chicagoMonth(clock);
    const una = await person(gym, "Una Updated");
    const sid = await person(gym, "Sid Steady");
    const ada = await person(gym, "Ada Address");
    for (const e of [una, sid, ada]) {
      await renewing(gym, typeId, e);
      await cardFor(gym, e, "3333", now);
    }
    await switchOn(gym);
    const sentBefore = mail.length;
    expect((await remind()).queued).toBe(0);
    clock = new Date(clock.getTime() + HOUR); // 6 a.m.
    // Written by the queue, then each changes before the email goes.
    const { queueDueNotices } = await import("../src/modules/orgs/payments/cardExpiryRepo.js");
    expect(await queueDueNotices(sql, { environment: "production", now: clock, gymIds: [gym.id] })).toBe(3);
    // Square updated Una's card with the bank's new date.
    await sql`UPDATE gym_member_cards SET exp_year = exp_year + 3 WHERE gym_id = ${gym.id} AND entry_id = ${una}`;
    // Ada's address was corrected at the desk: the new one is emailed, never the old.
    const oldAda = await emailOf(ada);
    const newAda = `cexp-r-new-${uniq()}@example.com`;
    await sql`UPDATE gym_member_list_entries SET email = ${newAda} WHERE id = ${ada}`;
    const sentHere = () => mail.slice(sentBefore).filter((m) => m.text.includes(gym.name)).map((m) => m.to).sort();
    // The next minute, the gym still sending them: Sid's goes; Una's and Ada's old one never do.
    await remind();
    expect(sentHere()).toEqual([await emailOf(sid)]);
    expect(mailTo(oldAda)).toHaveLength(0);
    // The minute after, Ada's is written again for the address on her record now.
    await remind();
    expect(sentHere()).toEqual([await emailOf(sid), newAda].sort());

    // Sue's is written; the gym switches them off before it goes, then on again the next minute.
    const sue = await person(gym, "Sue Switched");
    await renewing(gym, typeId, sue);
    await cardFor(gym, sue, "4444", now);
    expect(await queueDueNotices(sql, { environment: "production", now: clock, gymIds: [gym.id] })).toBe(1);
    await sql`UPDATE gyms SET card_expiry_reminders = false WHERE id = ${gym.id}`;
    await remind();
    expect(mailTo(await emailOf(sue))).toHaveLength(0);
    await sql`UPDATE gyms SET card_expiry_reminders = true WHERE id = ${gym.id}`;
    await remind();
    expect(mailTo(await emailOf(sue))).toHaveLength(1);
    expect(sentHere()).toEqual([await emailOf(sid), newAda, await emailOf(sue)].sort());
    expect(mailTo(oldAda)).toHaveLength(0);
    expect(mailTo(await emailOf(una))).toHaveLength(0);
    // Una's card's new date has no reminder until its own last month.
    expect(await cardBox(gym, una)).toMatchObject({ expiresThisMonth: false, expiryReminder: null });
  });

  it("is changed only by staff who record payments, refuses a bad value, and is kept in the gym's activity", async () => {
    clock = noonToday();
    const gym = await makeGym("Role Gym");
    const trainer = await signedIn("Tia Trainer");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${trainer.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer]})`;
    const asTrainer = await settingsOf(gym, trainer.cookies);
    expect(asTrainer.canChange).toBe(false);
    // Card details are the payments tick's.
    expect(asTrainer.cardExpiry).toBeNull();
    expect((await send("PUT", `/v1/orgs/${gym.id}/bill-settings`, trainer.cookies, { overdueAfterDays: 0, cardExpiryReminders: true })).statusCode).toBe(403);
    expect((await send("PUT", `/v1/orgs/${gym.id}/bill-settings`, gym.owner.cookies, { overdueAfterDays: 0, cardExpiryReminders: "yes" })).statusCode).toBe(400);
    expect((await send("GET", `/v1/orgs/${gym.id}/bill-settings`, {})).statusCode).toBe(401);
    expect((await settingsOf(gym)).cardExpiryReminders).toBe(false);
    await switchOn(gym);
    // Left out, it stays as it is.
    const kept = await send("PUT", `/v1/orgs/${gym.id}/bill-settings`, gym.owner.cookies, { overdueAfterDays: 2 });
    expect(billSettingsResponseSchema.parse(JSON.parse(kept.body)).cardExpiryReminders).toBe(true);
    await switchOn(gym, false);
    const lines = await sql<{ meta: { cardExpiryReminders: string } }[]>`
      SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.card_expiry_reminders_changed' ORDER BY at, id`;
    expect(lines.map((l) => l.meta.cardExpiryReminders)).toEqual(["on", "off"]);
    // A gym not connected to Square has no cards to remind about: the box draws no list.
    const loose = await signedIn("Loose Owner");
    const res = await send("POST", "/v1/orgs", loose.cookies, { trainsHere: false, name: `Loose Gym ${uniq()}`, city: "Chicago", country: "US", timezone: "America/Chicago" });
    const looseId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    const looseSettings = billSettingsResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${looseId}/bill-settings`, loose.cookies)).body));
    expect(looseSettings.cardExpiry).toBeNull();
  });
});
