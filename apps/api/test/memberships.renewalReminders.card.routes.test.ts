// A reminder before a renewal names the card it will be paid with only where the app's own charge will take that
// payment (ROADMAP 18v-iv; round one, H2), and a renewal inside a running minimum term never offers a way out (H1).
// Real Postgres (DATABASE_URL-gated), with Square's connect answered by the fake in `fakeSquareTerminal.ts`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { addDays, dayWords, heldMembershipsResponseSchema, squareConnectResponseSchema, squareFinishResponseSchema, type GymMembershipTypesResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { InviteEmail } from "../src/email/resend.js";
import { sendDueRenewalReminders } from "../src/modules/orgs/memberships/renewalReminders.js";
import { account, fakeSquare } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "renewal-card-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  INVITE_HMAC_SECRET: "renewal-card-address-key-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-RENEWALCARDAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-RENEWALCARDSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};
const T = 300_000;
const LIVE_PLAN = "zz_renewal_card";
type Cookies = Record<string, string>;
let ipCounter = 0;
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("A renewal reminder's card and its minimum term (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  const chicagoToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const clock = new Date(`${chicagoToday}T17:00:00Z`);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const mail: InviteEmail[] = [];
  const gymIds: string[] = [];
  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rcard-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'rcard-t-%@example.com'`;
    await sql`DELETE FROM gym_renewal_reminders WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_autopay_pauses WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'rcard-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };
  const send = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) => {
    if (app === undefined) throw new Error("no app");
    return app.inject({ method, url: path, remoteAddress: nextIp(), cookies, ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }) });
  };
  const emailOf = async (entryId: string): Promise<string> => (await sql<{ email: string }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE id = ${entryId}`)[0]?.email ?? "";

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      squareApi: square.api,
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
    });
    await app.ready();
  }, T);
  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("names the card only where the app will charge it, and inside a minimum term offers no way out", async () => {
    const email = `rcard-t-${uniq()}@example.com`;
    expect((await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: "Card Owner" })).statusCode).toBe(201);
    await proveAddress(sql, email);
    const owner = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    const cookies = cookieMap(owner);
    const name = `Card Gym ${uniq()}`;
    const made = await send("POST", "/v1/orgs", cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    const gymId = (JSON.parse(made.body) as { org: { id: string } }).org.id;
    gymIds.push(gymId);
    const ownerId = (await sql<{ id: string }[]>`SELECT owner_user_id AS id FROM gyms WHERE id = ${gymId}`)[0]?.id ?? "";
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const acct = account(`MRC${uniq()}`);
    const start = await send("POST", `/v1/orgs/${gymId}/payments/square/connect`, cookies);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", cookies, { state, code: square.allow(acct) });
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");

    // Gold Weekly, twelve weeks' minimum term, then it renews; a reminder 3 days before every renewal.
    const line = await send("POST", `/v1/orgs/${gymId}/membership-types`, cookies, {
      name: "Gold Weekly", description: null, kind: "recurring", priceMinor: 2500, termCount: 1, termUnit: "week", packClasses: null, packDays: null,
      access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classTypeIds: null, contractPeriods: 12, contractThen: "renews", renewalReminderDays: 3,
    });
    expect(line.statusCode, line.body).toBe(201);
    const typeId = (JSON.parse(line.body) as GymMembershipTypesResponse).types[0]?.id ?? "";
    const startsOn = addDays(chicagoToday, -5);
    const renewsOn = addDays(chicagoToday, 2);
    const termUntil = addDays(startsOn, 12 * 7 - 1);
    const member = async (fullName: string, paid: boolean): Promise<string> => {
      const add = await send("POST", `/v1/orgs/${gymId}/member-list/entries`, cookies, { fullName, email: `rcard-r-${uniq()}@example.com` });
      const entryId = (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
      const given = await send("POST", `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`, cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn, paid });
      expect(given.statusCode, given.body).toBe(201);
      expect(heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships).toHaveLength(1);
      const [agreed] = await sql<{ id: string }[]>`
        INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
        VALUES (${gymId}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${ownerId}, 'VISA', '4242', now())
        RETURNING id`;
      await sql`
        INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
        VALUES (${gymId}, ${entryId}, 'production', ${acct.merchantId}, ${`CUST${uniq()}`}, ${`ccof:${randomUUID()}`}, 'VISA', '4242', 12, 2030, 'desk', ${ownerId}, ${agreed?.id ?? null}, now(), now())`;
      return entryId;
    };
    // Ana paid her first week: her card takes the renewal. Ben still owes his first: the app charges no renewal
    // while an earlier bill is owed. Cal's automatic payments are paused.
    const ana = await member("Ana Card", true);
    const ben = await member("Ben Owes", false);
    const cal = await member("Cal Paused", true);
    await sql`INSERT INTO gym_autopay_pauses (gym_id, entry_id, paused_at) VALUES (${gymId}, ${cal}, now())`;

    await sendDueRenewalReminders({
      sql,
      log: { info: () => undefined, warn: () => undefined },
      settings: { hmacKey: Buffer.from(baseEnv.INVITE_HMAC_SECRET), webOrigin: "http://localhost:5173", perDay: 0, paused: false, sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" } },
      sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" },
      transport: {
        send: (m) => {
          mail.push(m);
          return Promise.resolve({ kind: "sent", id: `re_${uniq()}` });
        },
      },
      now: () => clock,
      sleep: () => Promise.resolve(),
      gymIds,
    });
    const textOf = async (entryId: string) => {
      const to = await emailOf(entryId);
      const found = mail.filter((m) => m.to === to);
      expect(found).toHaveLength(1);
      return found[0]?.text ?? "";
    };
    const anaText = await textOf(ana);
    expect(anaText).toContain(`renews on ${dayWords(renewsOn)} for $25.00.`);
    expect(anaText).toContain("It will be paid with your Visa ending in 4242 that day.");
    // Inside the twelve weeks they cannot stop it: the term, never "let us know before".
    expect(anaText).toContain(`The minimum term runs until ${dayWords(termUntil)}.`);
    expect(anaText).not.toContain("let us know before");
    for (const entryId of [ben, cal]) {
      const text = await textOf(entryId);
      expect(text).toContain("The payment is due that day.");
      expect(text).not.toContain("4242");
    }
  });
});
