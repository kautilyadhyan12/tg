// WHAT COMES BACK — Resend's webhook and the worker that acts on it, against REAL
// Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 3b-i-b; Part 3 §9.12.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md
// §2.1): email somebody again after they marked the gym's invitation as spam or their
// address bounced — or let a report nobody at Resend sent silence a real person's
// invitation.
//
// Emails that "went" are written straight into the table: this suite never runs the
// sender, whose queue every suite shares, so no email of another suite is taken here.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailRecordLookup, EmailRecordReader } from "../src/email/resend.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { gateFacts, resumeGym, stoppedGyms } from "../src/modules/orgs/invites/repo.js";
import { claimDueEvent, finishEvent } from "../src/modules/webhooks/repo.js";
import { INVITE_RESULTS, processInviteResults, type ResultsRun, type StoppedGym } from "../src/modules/orgs/invites/results.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { RESEND_WEBHOOK_PATH } from "../src/modules/webhooks/resendRoutes.js";
import {
  MEMBER_INVITE_WORDS,
  memberInvitePreviewSchema,
  memberListEntryResponseSchema,
  memberListEntryWrittenSchema,
  type MemberInvitePreview,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
/** A test signing secret in Resend's shape: `whsec_` and base64. */
const SECRET = "whsec_" + Buffer.from("member-invite-results-test-key!!").toString("base64"); // gitleaks:allow
const OTHER_SECRET = "whsec_" + Buffer.from("somebody-else-entirely-key-0000!").toString("base64"); // gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-invites-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  RESEND_WEBHOOK_SECRET: SECRET,
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

const LIVE_PLAN = "zz_member_invite_results";
const DOMAIN = "minvr-t.example.com";
const addr = (local: string) => `minvr-t-${local}@${DOMAIN}`;

let ipCounter = 0;
const nextIp = () => `10.64.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** Sign a body as Svix does: `${id}.${timestamp}.${body}` under the secret's key. */
function sign(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${String(timestamp)}.${body}`).digest("base64");
}

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

d("what comes back (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");
  const hmacOf = (email: string) => emailHmac(settings.hmacKey, email);

  /** Resend ids this run made, so cleanup finds this run's reports and no one else's. */
  const providerIds: string[] = [];
  const eventIds: string[] = [];

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${`minvr-t-%@${DOMAIN}`})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'resend' AND event_id LIKE 'msg_minvr_%'`;
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE ${`minvr-t-%@${DOMAIN}`}`;
    // Hard bounces are every gym's, so they are found by this suite's own addresses.
    const locals = ["bounced", "soft", "spam", "forged", "unconfirmed", "order", "page", "twice", "early", "unknown", "wrongtag", "lease", "denied", "unknown-failed", "unknown-refused"];
    for (const [prefix, n] of [["stop", 50], ["bulk", 200], ["cmp", 120], ["gate", 50], ["refused", 50], ["race", 50], ["half", 200]] as const) {
      for (let i = 0; i < n; i++) locals.push(`${prefix}-${String(i)}`);
    }
    const everyGym = locals.map((local) => hmacOf(addr(local)));
    await sql`DELETE FROM email_suppressions WHERE gym_id IS NULL AND email_hmac = ANY(${everyGym}::text[])`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PATCH", path: string, cookies: Record<string, string>, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  const makeUser = async (local: string): Promise<User> => {
    const email = addr(local);
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: `Res ${local}` });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: User, name: string): Promise<string> => {
    const res = await inject("POST", "/v1/orgs", owner.cookies, { name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'active', 'pilot')`;
    expect((await inject("PATCH", `/v1/orgs/${gymId}`, owner.cookies, { postalAddress: "12 High Street, Leeds LS1 1AA" })).statusCode).toBe(200);
    return gymId;
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;

  const typeIn = async (gymId: string, who: User, name: string, email: string): Promise<string> => {
    const res = await inject("POST", `${listUrl(gymId)}/entries`, who.cookies, { fullName: name, email });
    expect([200, 201], res.body).toContain(res.statusCode);
    return memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId;
  };

  const previewOf = async (gymId: string, who: User): Promise<MemberInvitePreview> => {
    const res = await inject("GET", `${listUrl(gymId)}/invites/preview`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberInvitePreviewSchema.parse((JSON.parse(res.body) as { preview: unknown }).preview);
  };

  /** The send row each Resend id belongs to: its invitation tag. */
  const sendIdOf = new Map<string, string>();

  /** An invitation email that went, as the sender leaves it, with Resend's id. */
  const seedSent = async (gymId: string, email: string, at = new Date()): Promise<string> => {
    const providerId = `re_${randomUUID()}`;
    providerIds.push(providerId);
    const hmac = hmacOf(email);
    await sql`
      INSERT INTO gym_invites (gym_id, email_hmac, created_at) VALUES (${gymId}, ${hmac}, ${at})
      ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_invite_sends (gym_id, invite_id, kind, state, not_before, created_at, finished_at, provider_id)
      VALUES (${gymId}, (SELECT id FROM gym_invites WHERE gym_id = ${gymId} AND email_hmac = ${hmac}),
              'first', 'sent', ${at}, ${at}, ${at}, ${providerId})
      RETURNING id`;
    const sendId = rows[0]?.id;
    if (sendId === undefined) throw new Error("the send was not written");
    sendIdOf.set(providerId, sendId);
    resendTags.set(providerId, [{ name: "invite_send", value: sendId }]);
    return providerId;
  };

  /** Many at once, one second apart, oldest first. */
  const seedManySent = async (gymId: string, prefix: string, n: number, from: Date): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(await seedSent(gymId, addr(`${prefix}-${String(i)}`), new Date(from.getTime() + i * 1000)));
    return ids;
  };

  // ── The webhook, signed as Resend signs it ──

  const report = (
    type: string,
    emailId: string,
    opts: { secret?: string; id?: string; at?: number; bounceType?: string; bounceSubType?: string; tamper?: boolean; sendId?: string | null } = {},
  ) => {
    const sendId = opts.sendId === undefined ? (sendIdOf.get(emailId) ?? null) : opts.sendId;
    const id = opts.id ?? `msg_minvr_${randomUUID()}`;
    eventIds.push(id);
    const at = opts.at ?? Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      type,
      created_at: new Date(at * 1000).toISOString(),
      data: {
        email_id: emailId,
        from: "Gym via AI Home Gym <invites@example.com>",
        to: ["somebody@example.com"],
        subject: "You're a member",
        ...(opts.bounceType === undefined ? {} : { bounce: { type: opts.bounceType, subType: opts.bounceSubType ?? "General", message: "x" } }),
        // As Resend sends them: an object of name and value.
        tags: sendId === null ? { category: "invite" } : { category: "invite", invite_send: sendId },
      },
    });
    const signature = sign(opts.secret ?? SECRET, id, at, body);
    return api().inject({
      method: "POST",
      url: RESEND_WEBHOOK_PATH,
      remoteAddress: "44.228.126.217",
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": String(at),
        "svix-signature": signature,
      },
      payload: opts.tamper === true ? body.replace("email.", "email .") : body,
    });
  };

  const keptEvents = async () =>
    await sql<{ event_id: string; status: string; payload: unknown }[]>`
      SELECT event_id, status, payload FROM webhook_events
      WHERE provider = 'resend' AND event_id = ANY(${eventIds}::text[])`;

  // ── The worker, with Resend's own record answered by the test ──

  /** Resend's record of each email: its last event, and its tags. Absent means Resend has
   *  no such email. */
  const resendRecords = new Map<string, string>();
  const resendTags = new Map<string, { name: string; value: string }[]>();
  const reads: string[] = [];
  const reader: EmailRecordReader = {
    read: (emailId) => {
      reads.push(emailId);
      const last = resendRecords.get(emailId);
      const answer: EmailRecordLookup =
        last === undefined ? { kind: "missing" } : { kind: "found", lastEvent: last, tags: resendTags.get(emailId) ?? [] };
      return Promise.resolve(answer);
    },
  };
  const toldOperator: StoppedGym[] = [];
  let clock = new Date();
  const processResults = async (): Promise<ResultsRun> =>
    await processInviteResults({
      sql,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      reader,
      tellOperator: (stopped) => {
        toldOperator.push(stopped);
        return Promise.resolve();
      },
      now: () => clock,
      sleep: () => Promise.resolve(),
    });
  /** Run the worker until no report is due, moving the clock past each retry. */
  const processAll = async (): Promise<void> => {
    for (let i = 0; i < INVITE_RESULTS.maxTries + 2; i++) {
      await processResults();
      clock = new Date(clock.getTime() + 4 * 60 * 60 * 1000);
    }
    clock = new Date();
  };

  const suppressionsOf = async (email: string) =>
    await sql<{ gym_id: string | null; reason: string }[]>`
      SELECT gym_id, reason FROM email_suppressions WHERE email_hmac = ${hmacOf(email)} ORDER BY reason`;

  const resultOf = async (providerId: string) =>
    (await sql<{ result: string | null }[]>`SELECT result FROM gym_invite_sends WHERE provider_id = ${providerId}`)[0]?.result ?? null;

  let owner: User;
  let otherOwner: User;
  let gymA: string;
  let gymB: string;

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
    owner = await makeUser("owner-a");
    otherOwner = await makeUser("owner-b");
    gymA = await makeGym(owner, "Results Gym A");
    gymB = await makeGym(otherOwner, "Results Gym B");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api().close();
    await cleanup();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  // =========================================================================
  // THE WORST THING
  // =========================================================================

  describe("the worst thing: a person emailed after they said no, or silenced by a forgery", () => {
    it("a report Resend did not sign is refused and changes nothing", async () => {
      const email = addr("forged");
      const entryId = await typeIn(gymA, owner, "Forged Report", email);
      const providerId = await seedSent(gymA, email);
      resendRecords.set(providerId, "complained");

      const forged = await report("email.complained", providerId, { secret: OTHER_SECRET });
      const stale = await report("email.complained", providerId, { at: Math.floor(Date.now() / 1000) - 6 * 60 });
      const tampered = await report("email.complained", providerId, { tamper: true });
      const unsigned = await api().inject({
        method: "POST",
        url: RESEND_WEBHOOK_PATH,
        remoteAddress: nextIp(),
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ type: "email.complained", data: { email_id: providerId } }),
      });
      expect([forged.statusCode, stale.statusCode, tampered.statusCode, unsigned.statusCode]).toEqual([401, 401, 401, 401]);

      await processAll();
      expect(await keptEvents()).toEqual([]);
      expect(await suppressionsOf(email)).toEqual([]);
      expect(await resultOf(providerId)).toBeNull();
      // Their invitation can still be sent again when they ask.
      const again = await inject("POST", `${listUrl(gymA)}/entries/${entryId}/invite/resend`, owner.cookies, {});
      expect(again.statusCode, again.body).toBe(200);
      // Out of reach of every suite's sender: this suite sends nothing.
      await sql`UPDATE gym_invite_sends SET not_before = now() + interval '1 year' WHERE gym_id = ${gymA} AND state = 'queued'`;
    }, TEST_TIMEOUT_MS);

    it("a signed report that Resend's own record does not bear out stops nobody", async () => {
      const email = addr("unconfirmed");
      const providerId = await seedSent(gymA, email);
      // Resend's record says the email was delivered and nothing more.
      resendRecords.set(providerId, "delivered");
      expect((await report("email.complained", providerId)).statusCode).toBe(200);
      expect((await report("email.bounced", providerId, { bounceType: "Permanent" })).statusCode).toBe(200);

      await processAll();
      expect(await suppressionsOf(email)).toEqual([]);
      expect(await resultOf(providerId)).toBeNull();
      const statuses = (await keptEvents()).filter((e) => (e.payload as { emailId: string }).emailId === providerId).map((e) => e.status);
      expect(statuses).toEqual(["failed", "failed"]);
    }, TEST_TIMEOUT_MS);

    it("after a confirmed complaint, that gym can neither send again nor invite them; another gym still may", async () => {
      const email = addr("spam");
      const entryA = await typeIn(gymA, owner, "Marked Spam", email);
      await typeIn(gymB, otherOwner, "Marked Spam", email);
      const providerId = await seedSent(gymA, email);
      resendRecords.set(providerId, "complained");
      expect((await report("email.complained", providerId)).statusCode).toBe(200);
      await processAll();

      expect(await resultOf(providerId)).toBe("complained");
      expect(await suppressionsOf(email)).toEqual([{ gym_id: gymA, reason: "complained" }]);
      // A complaint about one of a gym's first 100 also stops the gym. Started again,
      // the address itself is still refused.
      expect(await stoppedGyms(sql)).toContainEqual(expect.objectContaining({ gymId: gymA, reason: "complaint" }));
      expect(await resumeGym(sql, gymA, new Date())).toBe(true);
      const again = await inject("POST", `${listUrl(gymA)}/entries/${entryA}/invite/resend`, owner.cookies, {});
      expect(again.statusCode).toBe(409);
      expect((JSON.parse(again.body) as { error: string }).error).toBe("unsubscribed");
      // Gym B never emailed them, so its press still reaches them.
      const previewB = await previewOf(gymB, otherOwner);
      expect(previewB.skipped.unsubscribed).toBe(0);
      expect(previewB.reach).toBeGreaterThanOrEqual(1);
    }, TEST_TIMEOUT_MS);

    it("after a confirmed hard bounce, no gym invites that address again", async () => {
      const email = addr("bounced");
      const entryId = await typeIn(gymB, otherOwner, "Dead Address", email);
      const providerId = await seedSent(gymA, email);
      resendRecords.set(providerId, "bounced");
      expect((await report("email.bounced", providerId, { bounceType: "Permanent" })).statusCode).toBe(200);
      await processAll();

      expect(await resultOf(providerId)).toBe("bounced");
      expect(await suppressionsOf(email)).toEqual([{ gym_id: null, reason: "bounced" }]);
      const previewB = await previewOf(gymB, otherOwner);
      expect(previewB.skipped.bounced).toBeGreaterThanOrEqual(1);
      const one = await inject("POST", `${listUrl(gymB)}/entries/${entryId}/invite`, otherOwner.cookies, {});
      expect(one.statusCode).toBe(409);
      expect((JSON.parse(one.body) as { error: string }).error).toBe("bounced");
    }, TEST_TIMEOUT_MS);

    it("a bounce Resend calls temporary is not a dead address", async () => {
      const email = addr("soft");
      const providerId = await seedSent(gymA, email);
      resendRecords.set(providerId, "bounced");
      expect((await report("email.bounced", providerId, { bounceType: "Transient" })).statusCode).toBe(200);
      await processAll();
      expect(await resultOf(providerId)).toBe("failed");
      expect(await suppressionsOf(email)).toEqual([]);
    }, TEST_TIMEOUT_MS);
  });

  // =========================================================================
  // THE WEBHOOK
  // =========================================================================

  describe("the webhook", () => {
    it("keeps an event once however often it arrives, and never the address or subject", async () => {
      const providerId = await seedSent(gymA, addr("twice"));
      const id = `msg_minvr_${randomUUID()}`;
      const first = await report("email.delivered", providerId, { id });
      const second = await report("email.delivered", providerId, { id });
      expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
      const kept = (await keptEvents()).filter((e) => e.event_id === id);
      expect(kept).toHaveLength(1);
      expect(kept[0]?.payload).toEqual({
        type: "email.delivered",
        emailId: providerId,
        sendId: sendIdOf.get(providerId),
        bounceType: null,
        bounceSubType: null,
      });
      expect(JSON.stringify(kept[0]?.payload)).not.toContain("example.com");
    }, TEST_TIMEOUT_MS);

    it("acknowledges and drops the events it does not act on", async () => {
      for (const type of ["email.sent", "email.opened", "email.delivery_delayed", "domain.updated"]) {
        expect((await report(type, `re_${randomUUID()}`)).statusCode).toBe(200);
      }
      const kept = (await keptEvents()).map((e) => (e.payload as { type: string }).type);
      expect(kept.filter((type) => !type.startsWith("email.") || ["email.sent", "email.opened", "email.delivery_delayed"].includes(type))).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("answers 503 while no signing secret is set, so Resend keeps the event", async () => {
      const bare = await buildApp(loadConfig({ ...baseEnv, RESEND_WEBHOOK_SECRET: undefined }));
      await bare.ready();
      const res = await bare.inject({ method: "POST", url: RESEND_WEBHOOK_PATH, headers: { "content-type": "application/json" }, payload: "{}" });
      await bare.close();
      expect(res.statusCode).toBe(503);
    }, TEST_TIMEOUT_MS);

    it("a report about an email that is not an invitation is let go", async () => {
      const signInCode = `re_${randomUUID()}`;
      resendRecords.set(signInCode, "bounced");
      const before = reads.length;
      expect((await report("email.bounced", signInCode, { bounceType: "Permanent" })).statusCode).toBe(200);
      await processAll();
      const kept = (await keptEvents()).filter((e) => (e.payload as { emailId: string }).emailId === signInCode);
      expect(kept.map((e) => e.status)).toEqual(["done"]);
      // Resend was not asked about it: it is not ours to judge.
      expect(reads.slice(before)).not.toContain(signInCode);
    }, TEST_TIMEOUT_MS);
  });

  // =========================================================================
  // RESULTS, AND THE GYM'S STANDING
  // =========================================================================

  describe("results and the gym's standing", () => {
    it("an email keeps its most serious result: a delivery after a complaint changes nothing", async () => {
      const providerId = await seedSent(gymA, addr("order"));
      resendRecords.set(providerId, "complained");
      await report("email.complained", providerId);
      await report("email.delivered", providerId);
      await processAll();
      expect(await resultOf(providerId)).toBe("complained");
    }, TEST_TIMEOUT_MS);

    it("a person's page shows what came back", async () => {
      const email = addr("page");
      const entryId = await typeIn(gymA, owner, "Page Person", email);
      const providerId = await seedSent(gymA, email);
      resendRecords.set(providerId, "delivered");
      await report("email.delivered", providerId);
      await processAll();
      const page = await inject("GET", `${listUrl(gymA)}/entries/${entryId}`, owner.cookies);
      expect(page.statusCode).toBe(200);
      const detail = memberListEntryResponseSchema.parse(JSON.parse(page.body));
      expect(detail.entry.invitation?.email).toMatchObject({ state: "sent", result: "delivered" });
    }, TEST_TIMEOUT_MS);

    it("two hard bounces in a gym's first 50 stop it; its operator is told once; its waiting emails are let go", async () => {
      const staff = await makeUser("owner-c");
      const gymC = await makeGym(staff, "Bouncy Gym");
      const sent = await seedManySent(gymC, "stop", 50, new Date(Date.now() - 60_000));
      // One email still waiting, far enough ahead that no suite's sender takes it.
      await sql`
        INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gymC}, ${hmacOf(addr("stop-waiting"))})`;
      await sql`
        INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at)
        VALUES (${gymC}, (SELECT id FROM gym_invites WHERE gym_id = ${gymC} AND email_hmac = ${hmacOf(addr("stop-waiting"))}),
                'first', ${addr("stop-waiting")}, now() + interval '1 year', now())`;
      const [b1, b2] = [sent[3], sent[17]];
      if (b1 === undefined || b2 === undefined) throw new Error("seeding fell short");
      resendRecords.set(b1, "bounced");
      resendRecords.set(b2, "bounced");

      await report("email.bounced", b1, { bounceType: "Permanent" });
      await processAll();
      expect(await stoppedGyms(sql)).not.toContainEqual(expect.objectContaining({ gymId: gymC }));

      const told = toldOperator.length;
      await report("email.bounced", b2, { bounceType: "Permanent" });
      // The same bounce again under a new id, as a retry from Resend's side could be.
      await report("email.bounced", b2, { bounceType: "Permanent" });
      await processAll();
      expect(await stoppedGyms(sql)).toContainEqual(expect.objectContaining({ gymId: gymC, reason: "bounces" }));
      expect(toldOperator.slice(told)).toEqual([{ gymId: gymC, gymName: "Bouncy Gym", reason: "bounces", sent: 50, bounced: 2 }]);
      const waiting = await sql<{ state: string; reason: string | null; email: string | null }[]>`
        SELECT state, reason, email::text AS email FROM gym_invite_sends WHERE gym_id = ${gymC} AND provider_id IS NULL`;
      expect(waiting).toEqual([{ state: "skipped", reason: "sending_stopped", email: null }]);

      // Staff are told why, and a press is refused.
      expect((await previewOf(gymC, staff)).blocked).toBe("sending_stopped");
      const pressed = await inject("POST", `${listUrl(gymC)}/invites`, staff.cookies, { version: 0, expectedCount: 0 });
      expect(pressed.statusCode).toBe(409);
      expect(JSON.parse(pressed.body)).toMatchObject({ error: "sending_stopped", message: MEMBER_INVITE_WORDS.sending_stopped });

      // Started again, it counts afresh: the old bounces no longer stop it.
      expect(await resumeGym(sql, gymC, new Date())).toBe(true);
      expect((await previewOf(gymC, staff)).blocked).toBeNull();
      expect(await resumeGym(sql, gymC, new Date())).toBe(false);
    }, TEST_TIMEOUT_MS);

    it("past the first 50, a gym stops only when bounces pass 2 %: four in 200 go on, five stop", async () => {
      const staff = await makeUser("owner-d");
      const gymD = await makeGym(staff, "Big List Gym");
      const sent = await seedManySent(gymD, "bulk", 200, new Date(Date.now() - 10 * 60_000));
      const bounce = async (index: number) => {
        const id = sent[index];
        if (id === undefined) throw new Error("seeding fell short");
        resendRecords.set(id, "bounced");
        await report("email.bounced", id, { bounceType: "Permanent" });
        await processAll();
      };
      for (const index of [60, 90, 120, 150]) await bounce(index);
      expect(await stoppedGyms(sql)).not.toContainEqual(expect.objectContaining({ gymId: gymD }));
      await bounce(180);
      expect(await stoppedGyms(sql)).toContainEqual(expect.objectContaining({ gymId: gymD, reason: "bounces" }));
    }, TEST_TIMEOUT_MS);

    it("a complaint about one of the first 100 stops a gym; one about the 101st does not", async () => {
      const staff = await makeUser("owner-e");
      const gymE = await makeGym(staff, "Complaint Gym");
      const sent = await seedManySent(gymE, "cmp", 120, new Date(Date.now() - 10 * 60_000));
      const late = sent[100];
      const early = sent[99];
      if (late === undefined || early === undefined) throw new Error("seeding fell short");
      resendRecords.set(late, "complained");
      await report("email.complained", late);
      await processAll();
      expect(await stoppedGyms(sql)).not.toContainEqual(expect.objectContaining({ gymId: gymE }));
      resendRecords.set(early, "complained");
      await report("email.complained", early);
      await processAll();
      expect(await stoppedGyms(sql)).toContainEqual(expect.objectContaining({ gymId: gymE, reason: "complaint" }));
    }, TEST_TIMEOUT_MS);

    it("the gate reads a gym's first 50: how many went and how many have come back", async () => {
      const staff = await makeUser("owner-f");
      const gymF = await makeGym(staff, "Gate Gym");
      const sent = await seedManySent(gymF, "gate", 50, new Date(Date.now() - 60_000));
      for (const id of sent.slice(0, 49)) await sql`UPDATE gym_invite_sends SET result = 'delivered', result_at = now() WHERE provider_id = ${id}`;
      await sql`
        INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gymF}, ${hmacOf(addr("gate-next"))})`;
      await sql`
        INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at)
        VALUES (${gymF}, (SELECT id FROM gym_invites WHERE gym_id = ${gymF} AND email_hmac = ${hmacOf(addr("gate-next"))}),
                'first', ${addr("gate-next")}, now() + interval '1 year', now())`;
      const farAhead = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);
      const facts = (await gateFacts(sql, farAhead)).find((gym) => gym.gymId === gymF)?.facts;
      expect(facts).toMatchObject({ stopped: false, sentOrSending: 50, firstBatch: { sent: 50, withResult: 49 } });
    }, TEST_TIMEOUT_MS);
  });

  // =========================================================================
  // ROUND ONE'S FINDINGS
  // =========================================================================

  describe("reports that arrive early, about refused addresses, or twice at once", () => {
    /** An email still being tried after an unclear answer from Resend: no Resend id yet. */
    const seedRetrying = async (gymId: string, email: string): Promise<string> => {
      const hmac = hmacOf(email);
      await sql`INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gymId}, ${hmac}) ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
      const rows = await sql<{ id: string }[]>`
        INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at, maybe_sent_at, attempts)
        VALUES (${gymId}, (SELECT id FROM gym_invites WHERE gym_id = ${gymId} AND email_hmac = ${hmac}),
                'again', ${email}, now() + interval '1 year', now(), now(), 1)
        RETURNING id`;
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("the send was not written");
      return id;
    };
    const tagFor = (providerId: string, sendId: string) => {
      sendIdOf.set(providerId, sendId);
      resendTags.set(providerId, [{ name: "invite_send", value: sendId }]);
    };

    it("a bounce that arrives while its email is still being retried waits, then stops the address", async () => {
      const email = addr("early");
      const sendId = await seedRetrying(gymA, email);
      const providerId = `re_${randomUUID()}`;
      tagFor(providerId, sendId);
      resendRecords.set(providerId, "bounced");
      await report("email.bounced", providerId, { bounceType: "Permanent" });
      await processAll();
      expect(await suppressionsOf(email)).toEqual([]);
      const waiting = (await keptEvents()).filter((e) => (e.payload as { emailId: string }).emailId === providerId);
      expect(waiting.map((e) => e.status)).toEqual(["pending"]);
      // The retry goes through under the same key and Resend's id comes back.
      await sql`
        UPDATE gym_invite_sends SET state = 'sent', email = NULL, finished_at = now(), provider_id = ${providerId}
        WHERE id = ${sendId}`;
      await sql`UPDATE webhook_events SET not_before = now() WHERE event_id = ${waiting[0]?.event_id ?? ""}`;
      await processAll();
      expect(await resultOf(providerId)).toBe("bounced");
      expect(await suppressionsOf(email)).toEqual([{ gym_id: null, reason: "bounced" }]);
    }, TEST_TIMEOUT_MS);

    it("an email the sender could not confirm, that Resend's record shows went, is sent after all", async () => {
      const email = addr("unknown");
      const sendId = await seedRetrying(gymA, email);
      await sql`
        UPDATE gym_invite_sends SET state = 'failed', reason = 'send_unknown', email = NULL, finished_at = now()
        WHERE id = ${sendId}`;
      const providerId = `re_${randomUUID()}`;
      tagFor(providerId, sendId);
      resendRecords.set(providerId, "bounced");
      await report("email.bounced", providerId, { bounceType: "Permanent" });
      await processAll();
      const row = await sql<{ state: string; reason: string | null; provider_id: string | null; result: string | null }[]>`
        SELECT state, reason, provider_id, result FROM gym_invite_sends WHERE id = ${sendId}`;
      expect(row).toEqual([{ state: "sent", reason: null, provider_id: providerId, result: "bounced" }]);
      expect(await suppressionsOf(email)).toEqual([{ gym_id: null, reason: "bounced" }]);
    }, TEST_TIMEOUT_MS);

    it("an email the sender could not confirm stays so when Resend says it failed or refused it", async () => {
      for (const [local, type, last] of [["unknown-failed", "email.failed", "failed"], ["unknown-refused", "email.suppressed", "suppressed"]] as const) {
        const sendId = await seedRetrying(gymA, addr(local));
        await sql`
          UPDATE gym_invite_sends SET state = 'failed', reason = 'send_unknown', email = NULL, finished_at = now()
          WHERE id = ${sendId}`;
        const providerId = `re_${randomUUID()}`;
        tagFor(providerId, sendId);
        resendRecords.set(providerId, last);
        await report(type, providerId);
        await processAll();
        const row = await sql<{ state: string; reason: string | null; provider_id: string | null; result: string | null }[]>`
          SELECT state, reason, provider_id, result FROM gym_invite_sends WHERE id = ${sendId}`;
        expect(row).toEqual([{ state: "failed", reason: "send_unknown", provider_id: null, result: null }]);
      }
    }, TEST_TIMEOUT_MS);
    it("a report whose tag Resend's record does not carry is not acted on", async () => {
      const email = addr("wrongtag");
      const providerId = await seedSent(gymA, email);
      resendRecords.set(providerId, "complained");
      resendTags.set(providerId, [{ name: "invite_send", value: randomUUID() }]);
      await report("email.complained", providerId);
      await processAll();
      expect(await suppressionsOf(email)).toEqual([]);
      expect(await resultOf(providerId)).toBeNull();
    }, TEST_TIMEOUT_MS);

    it("an address Resend refuses — another gym's complaint put it on Resend's list — never counts against this gym", async () => {
      const staff = await makeUser("owner-g");
      const gymG = await makeGym(staff, "Innocent Gym");
      const sent = await seedManySent(gymG, "refused", 50, new Date(Date.now() - 60_000));
      const [r1, r2, r3] = [sent[2], sent[9], sent[30]];
      if (r1 === undefined || r2 === undefined || r3 === undefined) throw new Error("seeding fell short");
      for (const id of [r1, r2]) {
        resendRecords.set(id, "bounced");
        await report("email.bounced", id, { bounceType: "Permanent", bounceSubType: "Suppressed" });
      }
      resendRecords.set(r3, "suppressed");
      await report("email.suppressed", r3);
      await processAll();
      expect(await stoppedGyms(sql)).not.toContainEqual(expect.objectContaining({ gymId: gymG }));
      expect([await resultOf(r1), await resultOf(r2), await resultOf(r3)]).toEqual(["refused", "refused", "refused"]);
      expect(await suppressionsOf(addr("refused-2"))).toEqual([{ gym_id: null, reason: "refused" }]);
      // Staff are told the truth about it, in any gym.
      const entryId = await typeIn(gymB, otherOwner, "Refused Person", addr("refused-2"));
      const one = await inject("POST", `${listUrl(gymB)}/entries/${entryId}/invite`, otherOwner.cookies, {});
      expect(one.statusCode).toBe(409);
      expect(JSON.parse(one.body)).toMatchObject({ error: "refused", message: MEMBER_INVITE_WORDS.refused });
      expect((await previewOf(gymB, otherOwner)).skipped.refused).toBeGreaterThanOrEqual(1);
      // A real hard bounce of the same address later replaces the refusal.
      const again = await seedSent(gymA, addr("refused-2"));
      resendRecords.set(again, "bounced");
      await report("email.bounced", again, { bounceType: "Permanent", bounceSubType: "General" });
      await processAll();
      expect(await suppressionsOf(addr("refused-2"))).toEqual([{ gym_id: null, reason: "bounced" }]);
    }, TEST_TIMEOUT_MS);

    it("emails Resend refused are left out of what a gym sent: three bounces in 100 that went stop it", async () => {
      const staff = await makeUser("owner-i");
      const gymI = await makeGym(staff, "Half Refused Gym");
      const sent = await seedManySent(gymI, "half", 200, new Date(Date.now() - 10 * 60_000));
      // Half of them Resend never tried: its own list refused them.
      await sql`
        UPDATE gym_invite_sends SET result = 'refused', result_at = now()
        WHERE gym_id = ${gymI} AND provider_id = ANY(${sent.filter((_id, i) => i % 2 === 1)}::text[])`;
      for (const index of [10, 60, 120]) {
        const id = sent[index];
        if (id === undefined) throw new Error("seeding fell short");
        resendRecords.set(id, "bounced");
        await report("email.bounced", id, { bounceType: "Permanent" });
      }
      await processAll();
      expect(await stoppedGyms(sql)).toContainEqual(expect.objectContaining({ gymId: gymI, reason: "bounces" }));
    }, TEST_TIMEOUT_MS);
    it("two workers at once act on a report once, and tell the operator once", async () => {
      const staff = await makeUser("owner-h");
      const gymH = await makeGym(staff, "Twice Gym");
      const sent = await seedManySent(gymH, "race", 50, new Date(Date.now() - 60_000));
      for (const id of [sent[1], sent[2], sent[3]]) {
        if (id === undefined) throw new Error("seeding fell short");
        resendRecords.set(id, "bounced");
        await report("email.bounced", id, { bounceType: "Permanent" });
      }
      const told = toldOperator.length;
      clock = new Date();
      const runs = await Promise.all([processResults(), processResults(), processResults()]);
      // What a failure needs to say: each report's own state beside the clock the runs
      // used and what each run did (it has failed on CI only, never locally).
      const state = async () =>
        JSON.stringify({
          clock: clock.toISOString(),
          runs,
          events: await sql`
            SELECT status, attempts, tries, not_before, received_at, payload->>'emailId' AS email_id, clock_timestamp() AS db_now
            FROM webhook_events
            WHERE provider = 'resend' AND event_id = ANY(${eventIds}::text[]) AND payload->>'emailId' = ANY(${sent}::text[])`,
          due: await sql`
            SELECT event_id, status, not_before FROM webhook_events
            WHERE provider = 'resend' AND status = 'pending' AND not_before <= ${clock}`,
        });
      expect(runs.reduce((n, run) => n + run.stopped, 0), await state()).toBe(1);
      expect(toldOperator.slice(told).filter((s) => s.gymId === gymH), await state()).toHaveLength(1);
      const mine = (await keptEvents()).filter((e) => sent.includes((e.payload as { emailId: string }).emailId));
      expect(mine.map((e) => e.status), await state()).toEqual(["done", "done", "done"]);
    }, TEST_TIMEOUT_MS);

    it("a claim that outlived its lease cannot finish the report the next claim took", async () => {
      const providerId = await seedSent(gymA, addr("lease"));
      resendRecords.set(providerId, "delivered");
      await report("email.delivered", providerId);
      const first = await claimDueEvent(sql, new Date(), 1);
      if (first === null) throw new Error("nothing to claim");
      const second = await claimDueEvent(sql, new Date(Date.now() + 10), INVITE_RESULTS.leaseMs);
      expect(second?.id, JSON.stringify({ first, second })).toBe(first.id);
      expect(await finishEvent(sql, first, "done", new Date())).toBe(false);
      if (second === null) throw new Error("the second claim took nothing");
      expect(await finishEvent(sql, second, "done", new Date())).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("a key that may not read, then a rate limit, use up none of a report's tries", async () => {
      const email = addr("denied");
      const providerId = await seedSent(gymA, email);
      resendRecords.set(providerId, "complained");
      await report("email.complained", providerId);
      const denying: EmailRecordReader = { read: () => Promise.resolve({ kind: "denied", status: 403 }) };
      const limited: EmailRecordReader = { read: () => Promise.resolve({ kind: "unavailable", status: 429 }) };
      for (const blocked of [denying, limited]) {
        for (let i = 0; i < INVITE_RESULTS.maxTries + 2; i++) {
          await processInviteResults({
            sql,
            log: { info: () => undefined, warn: () => undefined, error: () => undefined },
            reader: blocked,
            tellOperator: () => Promise.resolve(),
            now: () => clock,
            sleep: () => Promise.resolve(),
          });
          clock = new Date(clock.getTime() + 60 * 60 * 1000);
        }
      }
      clock = new Date();
      await sql`UPDATE webhook_events SET not_before = now() WHERE status = 'pending' AND event_id = ANY(${eventIds}::text[])`;
      await processAll();
      expect(await suppressionsOf(email)).toEqual([{ gym_id: gymA, reason: "complained" }]);
    }, TEST_TIMEOUT_MS);
  });
});