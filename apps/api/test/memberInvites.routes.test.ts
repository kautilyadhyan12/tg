// PRESS INVITE — routes and the worker's sender against REAL Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 3b-i-a; Part 3 §9.12, §10.2, §11.5.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md
// §2.1): email somebody who must not get one — a second invitation from the same gym,
// one after they unsubscribed, or one about a gym whose list no longer holds them.
// Every email is counted where it would leave: the transport the sender hands it to.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { InviteEmail, InviteSendResult, InviteTransport } from "../src/email/resend.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import type { MailCheck } from "../src/modules/orgs/invites/decide.js";
import { claimNextSend } from "../src/modules/orgs/invites/repo.js";
import { sendDueInvites, type SendRun, type SenderDeps } from "../src/modules/orgs/invites/sender.js";
import { InviteChanged, invitationsOf, previewInvite, pressInvite } from "../src/modules/orgs/invites/service.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { unsubscribeToken } from "../src/modules/orgs/invites/token.js";
import { registerUnsubscribeRoutes } from "../src/modules/orgs/invites/unsubscribe.js";
import { createMemoryRedis } from "../src/redis.js";
import {
  MEMBER_INVITE_EMAIL_REASON_WORDS,
  memberInviteOneSchema,
  memberInvitePreviewSchema,
  memberInvitedSchema,
  memberListEntriesPageSchema,
  memberListEntryDetailSchema,
  memberListEntryWrittenSchema,
  type MemberInvitePreview,
  type MemberListEntryWritten,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-invites-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

/** Its own plan code: the suites share one database. */
const LIVE_PLAN = "zz_member_invites";
const DOMAIN = "minv-t.example.com";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

let ipCounter = 0;
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** An address in this suite's own domain. */
const addr = (local: string) => `minv-t-${local}@${DOMAIN}`;

d("press Invite (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const tokens = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  // Read while the tests are listed, so also where the suite is skipped for want of a
  // database: the key comes from JWT_SECRET alone, and the address is a stand-in.
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${`minv-t-%@${DOMAIN}`})`;
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
    await sql`DELETE FROM users WHERE email LIKE ${`minv-t-%@${DOMAIN}`}`;
    await sql`DELETE FROM email_suppressions WHERE gym_id IS NULL AND email_hmac = ${emailHmac(settings.hmacKey, addr("bounced"))}`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, cookies: Record<string, string>, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Record<string, string>, ip?: string) => send("POST", path, cookies, payload, ip);
  const get = (path: string, cookies: Record<string, string>, ip?: string) => send("GET", path, cookies, undefined, ip);
  const patch = (path: string, payload: unknown, cookies: Record<string, string>) => send("PATCH", path, cookies, payload);
  const del = (path: string, cookies: Record<string, string>) => send("DELETE", path, cookies);

  const makeUser = async (local: string): Promise<User> => {
    const email = addr(local);
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Inv ${local}` }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const verify = async (email: string) => {
    const token = tokens.get(email.toLowerCase());
    if (token === undefined) throw new Error(`no verification token was sent to ${email}`);
    expect((await post("/v1/auth/verify-email", { token }, {})).statusCode).toBe(200);
  };

  const subscribeGym = async (gymId: string, status: "trialing" | "active" = "trialing") => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), ${status}, 'pilot')`;
  };

  /** A gym on a trial with its postal address set. */
  const makeGym = async (owner: User, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    expect((await patch(`/v1/orgs/${created.org.id}`, { postalAddress: "12 High Street, Leeds LS1 1AA" }, owner.cookies)).statusCode).toBe(200);
    return created;
  };

  const join = async (who: User, org: CreatedOrg, staff: User) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, who.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staff.cookies)).statusCode).toBe(200);
  };

  const appoint = async (who: User, org: CreatedOrg, owner: User, role: "trainer" | "manager") => {
    await join(who, org, owner);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: who.email, role }, owner.cookies)).statusCode).toBe(201);
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const entriesUrl = (gymId: string) => `${listUrl(gymId)}/entries`;
  const entryUrl = (gymId: string, entryId: string) => `${entriesUrl(gymId)}/${entryId}`;

  const typeIn = async (gymId: string, who: User, body: Record<string, unknown>): Promise<MemberListEntryWritten> => {
    const res = await post(entriesUrl(gymId), body, who.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    return memberListEntryWrittenSchema.parse(JSON.parse(res.body));
  };

  const previewOf = async (gymId: string, who: User, query = ""): Promise<MemberInvitePreview> => {
    const res = await get(`${listUrl(gymId)}/invites/preview${query}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberInvitePreviewSchema.parse((JSON.parse(res.body) as { preview: unknown }).preview);
  };

  const press = (gymId: string, who: User, preview: MemberInvitePreview, filter: Record<string, unknown> = {}, ip?: string) =>
    post(`${listUrl(gymId)}/invites`, { ...filter, version: preview.version, expectedCount: preview.reach }, who.cookies, ip);

  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };

  // ── The worker's sender, with every email it would send recorded ──

  const outbox: InviteEmail[] = [];
  /** Every email handed to the transport, whatever it answered. */
  const calls: InviteEmail[] = [];
  /** What the next sends answer; empty means "sent". */
  const nextAnswers: InviteSendResult[] = [];
  /** Resend's answers the tests give: one that may mean the email went, one that says it did not. */
  const unclear = (status: number | null = null): InviteSendResult => ({ kind: "unclear", status });
  const notSent = (status: number): InviteSendResult => ({ kind: "not_sent", status });
  const transport: InviteTransport = {
    send: (message) => {
      calls.push(message);
      const answer = nextAnswers.shift() ?? { kind: "sent", id: `msg_${String(outbox.length + 1)}` };
      if (answer.kind === "sent") outbox.push(message);
      return Promise.resolve(answer);
    },
  };
  const callsTo = (address: string) => calls.filter((message) => message.to === address);
  const domains = new Map<string, MailCheck>();
  const logged: unknown[] = [];
  const log = {
    info: (obj: object) => {
      logged.push(obj);
    },
    warn: (obj: object) => {
      logged.push(obj);
    },
  };
  const sender = settings.sender;
  if (sender === null) throw new Error("sending is off in the test config");
  const runSender = async (over: Partial<SenderDeps> = {}): Promise<SendRun> =>
    await sendDueInvites({
      sql,
      log,
      settings,
      sender,
      transport,
      mailDomain: (domain) => Promise.resolve(domains.get(domain) ?? "accepts"),
      now: () => new Date(),
      sleep: () => Promise.resolve(),
      ...over,
    });
  const emailsTo = (address: string) => outbox.filter((message) => message.to === address);

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
        sendVerificationEmail: (email, _name, rawToken) => {
          tokens.set(email.toLowerCase(), rawToken);
          return Promise.resolve();
        },
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
    // Anything a crashed earlier run left due is not this run's.
    await runSender();
    outbox.length = 0;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // =========================================================================
  // THE WORST THING: AN EMAIL TO SOMEBODY WHO MUST NOT GET ONE
  // =========================================================================

  it(
    "one email per person per gym, ever: a second press, two staff at once, a retried send, a re-added person and an unsubscribe send nobody a second email",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeGym(owner, "Worst Invite Gym");
      const gym = org.org.id;
      const manager = await makeUser("worst-manager");
      await verify(manager.email);
      await appoint(manager, org, owner, "manager");

      await typeIn(gym, owner, { fullName: "Ann", email: addr("ann") });
      await typeIn(gym, owner, { fullName: "Bob", email: addr("bob") });
      // A household: two records, one address, one invitation.
      await typeIn(gym, owner, { fullName: "Bob's son", email: addr("bob"), memberNumber: "S-2" });
      const cat = await typeIn(gym, owner, { fullName: "Cat", email: addr("cat") });

      let preview = await previewOf(gym, owner);
      expect(preview.reach).toBe(3);
      expect(preview.skipped.alreadyInvited).toBe(1);
      const pressed = await press(gym, owner, preview);
      expect(pressed.statusCode, pressed.body).toBe(200);
      expect(memberInvitedSchema.parse((JSON.parse(pressed.body) as { invited: unknown }).invited).queued).toBe(3);

      // The same press again, as a double tap or a retry: the numbers moved, nothing queued.
      const again = await press(gym, owner, preview);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).error).toBe("invite_changed");
      // Pressed again with the new numbers: nobody left to invite.
      preview = await previewOf(gym, owner);
      expect(preview.reach).toBe(0);
      expect(preview.skipped.alreadyInvited).toBe(4);
      const empty = await press(gym, owner, preview);
      expect(empty.statusCode).toBe(200);
      expect(memberInvitedSchema.parse((JSON.parse(empty.body) as { invited: unknown }).invited).queued).toBe(0);

      // Two members of staff pressing at the same moment for one new person.
      await typeIn(gym, owner, { fullName: "Dan", email: addr("dan") });
      preview = await previewOf(gym, owner);
      expect(preview.reach).toBe(1);
      const both = await Promise.all([press(gym, owner, preview), press(gym, manager, preview)]);
      // Whichever reads second either finds the number moved (409) or queues nobody.
      let queuedByBoth = 0;
      for (const res of both) {
        expect([200, 409], res.body).toContain(res.statusCode);
        if (res.statusCode === 200) queuedByBoth += memberInvitedSchema.parse((JSON.parse(res.body) as { invited: unknown }).invited).queued;
      }
      expect(queuedByBoth).toBe(1);

      let run = await runSender();
      expect(run.sent).toBe(4);
      run = await runSender();
      expect(run.sent).toBe(0);

      // A send whose worker died after handing it to Resend: the next run sends it under
      // the SAME idempotency key, which Resend answers without sending twice.
      await typeIn(gym, owner, { fullName: "Eve", email: addr("eve") });
      preview = await previewOf(gym, owner);
      expect((await press(gym, owner, preview)).statusCode).toBe(200);
      const claimed = await claimNextSend(sql, {
        now: new Date(),
        leaseMs: 60_000,
        platformPerDay: 2000,
        gymPerDay: 500,
        trialGymPerDay: 200,
      });
      if (claimed === null || claimed === "capped") throw new Error("nothing to claim");
      expect(claimed.email).toBe(addr("eve"));
      await sql`UPDATE gym_invite_sends SET lease_until = now() - interval '1 minute' WHERE id = ${claimed.id}`;
      run = await runSender();
      expect(run.sent).toBe(1);
      expect(emailsTo(addr("eve")).map((message) => message.idempotencyKey)).toEqual([`member-invite-${claimed.id}`]);

      // A person taken off, deleted for good and typed in again is the same address:
      // already invited, and nothing is queued.
      expect((await del(entryUrl(gym, cat.entry.entryId), owner.cookies)).statusCode).toBe(200);
      expect((await del(`${listUrl(gym)}/former/${cat.entry.entryId}`, owner.cookies)).statusCode).toBe(200);
      const catAgain = await typeIn(gym, owner, { fullName: "Cat", email: addr("cat") });
      expect(catAgain.entry.invitation?.state).toBe("pending");
      preview = await previewOf(gym, owner);
      expect(preview.reach).toBe(0);
      expect((await post(`${entryUrl(gym, catAgain.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);

      // Ann unsubscribes with her email's one-click link; nothing reaches her after,
      // whether staff send it again or a queued email was already waiting.
      const annEmail = emailsTo(addr("ann"))[0];
      if (annEmail === undefined) throw new Error("Ann got no invitation");
      const link = (annEmail.headers["List-Unsubscribe"] ?? "").replace(/^<|>$/g, "");
      const oneClick = await api().inject({
        method: "POST",
        url: `${new URL(link).pathname}${new URL(link).search}`,
        remoteAddress: nextIp(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "List-Unsubscribe=One-Click",
      });
      expect(oneClick.statusCode).toBe(200);
      expect(oneClick.body).toBe("");
      const annEntry = (await sql<{ id: string }[]>`
        SELECT id FROM gym_member_list_entries WHERE gym_id = ${gym} AND email = ${addr("ann")}`)[0];
      if (annEntry === undefined) throw new Error("Ann's record is gone");
      const resend = await post(`${entryUrl(gym, annEntry.id)}/invite/resend`, {}, owner.cookies);
      expect(resend.statusCode).toBe(409);
      expect(errorOf(resend).error).toBe("unsubscribed");
      await sql`
        INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at)
        SELECT gym_id, id, 'again', ${addr("ann")}, now(), now() FROM gym_invites
        WHERE gym_id = ${gym} AND email_hmac = ${emailHmac(settings.hmacKey, addr("ann"))}`;
      run = await runSender();
      expect(run.sent).toBe(0);
      expect(run.skipped).toBe(1);

      for (const who of ["ann", "bob", "cat", "dan", "eve"]) expect(emailsTo(addr(who)), who).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an unsubscribe is for that gym alone, and a hard bounce is for every gym",
    async () => {
      const ownerA = await makeUser("scope-a");
      const gymA = (await makeGym(ownerA, "Scope Gym A")).org.id;
      const ownerB = await makeUser("scope-b");
      const gymB = (await makeGym(ownerB, "Scope Gym B")).org.id;
      for (const gym of [gymA, gymB]) {
        await typeIn(gym, gym === gymA ? ownerA : ownerB, { fullName: "Fay", email: addr("fay") });
        await typeIn(gym, gym === gymA ? ownerA : ownerB, { fullName: "Bounced", email: addr("bounced") });
      }
      await sql`
        INSERT INTO email_suppressions (email_hmac, gym_id, reason)
        VALUES (${emailHmac(settings.hmacKey, addr("fay"))}, ${gymA}, 'unsubscribed'),
               (${emailHmac(settings.hmacKey, addr("bounced"))}, NULL, 'bounced')`;
      const a = await previewOf(gymA, ownerA);
      expect(a.reach).toBe(0);
      expect(a.skipped.unsubscribed).toBe(1);
      expect(a.skipped.bounced).toBe(1);
      const b = await previewOf(gymB, ownerB);
      expect(b.reach).toBe(1);
      expect(b.skipped.bounced).toBe(1);
      expect((await press(gymB, ownerB, b)).statusCode).toBe(200);
      await runSender();
      expect(emailsTo(addr("fay"))).toHaveLength(1);
      expect(emailsTo(addr("bounced"))).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHAT THE SENDER DOES WITH RESEND'S ANSWER
  // =========================================================================

  const hours = (n: number) => new Date(Date.now() + n * 60 * 60 * 1000);
  const sendRow = async (gym: string, address: string) => {
    const rows = await sql<{ state: string; reason: string | null; email: string | null }[]>`
      SELECT s.state, s.reason, s.email::text AS email FROM gym_invite_sends s JOIN gym_invites i ON i.id = s.invite_id
      WHERE s.gym_id = ${gym} AND i.email_hmac = ${emailHmac(settings.hmacKey, address)}
      ORDER BY s.created_at DESC LIMIT 1`;
    return rows[0];
  };

  it(
    "an email Resend may already have received goes again under its own key before the gym's cap, and never once 20 hours have passed",
    async () => {
      const owner = await makeUser("unclear-owner");
      const gym = (await makeGym(owner, "Unclear Gym")).org.id;
      for (const who of ["unc1", "unc2", "unc3"]) await typeIn(gym, owner, { fullName: who, email: addr(who) });
      expect((await press(gym, owner, await previewOf(gym, owner))).statusCode).toBe(200);
      const first = await sql<{ email: string }[]>`
        SELECT email::text AS email FROM gym_invite_sends WHERE gym_id = ${gym} ORDER BY not_before, created_at, id LIMIT 1`;
      const who = first[0]?.email ?? "";
      // The first answer is a timeout: the email may have gone.
      nextAnswers.push(unclear());
      expect((await runSender({ limits: { trialGymPerDay: 2 } })).sent).toBe(2);
      // A minute later the gym is at its cap of 2; the retry is the same email, and goes.
      expect((await runSender({ limits: { trialGymPerDay: 2 }, now: () => hours(0.05) })).sent).toBe(1);
      expect(new Set(callsTo(who).map((message) => message.idempotencyKey)).size).toBe(1);

      // Another person, whose retry would come due only after Resend has forgotten the key.
      const late = await typeIn(gym, owner, { fullName: "unc4", email: addr("unc4") });
      await subscribeGym(gym, "active");
      expect((await post(`${entryUrl(gym, late.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);
      nextAnswers.push(unclear(503));
      await runSender();
      expect(callsTo(addr("unc4"))).toHaveLength(1);
      await runSender({ now: () => hours(21) });
      expect(callsTo(addr("unc4"))).toHaveLength(1);
      expect(await sendRow(gym, addr("unc4"))).toEqual({ state: "failed", reason: "send_unknown", email: null });
      expect(MEMBER_INVITE_EMAIL_REASON_WORDS.send_unknown).toBe(
        "We couldn't confirm this email went. Only send it again if the person says they didn't get it.",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an answer that says the email did not go (a bad key, a closed account, too many requests, our own request) never spends it, and a bad key stops the run",
    async () => {
      const owner = await makeUser("notsent-owner");
      const gym = (await makeGym(owner, "Not Sent Gym")).org.id;
      await typeIn(gym, owner, { fullName: "ns1", email: addr("ns1") });
      await typeIn(gym, owner, { fullName: "ns2", email: addr("ns2") });
      expect((await press(gym, owner, await previewOf(gym, owner))).statusCode).toBe(200);
      const before = calls.length;
      nextAnswers.push(notSent(401));
      await runSender();
      // The key is bad for every email: the run stops at the first answer.
      expect(calls.length - before).toBe(1);
      nextAnswers.length = 0;
      // Six hours of a closed account: nothing is given up.
      for (let hour = 1; hour <= 6; hour++) {
        for (let i = 0; i < 4; i++) nextAnswers.push(notSent(403));
        await runSender({ now: () => hours(hour) });
      }
      nextAnswers.length = 0;
      expect((await sendRow(gym, addr("ns1")))?.state).toBe("queued");
      expect((await sendRow(gym, addr("ns2")))?.state).toBe("queued");
      // A request of ours Resend could not read is our fault, not the address's.
      for (const status of [400, 422, 429]) {
        nextAnswers.push(notSent(status), notSent(status));
        await runSender({ now: () => hours(8) });
        nextAnswers.length = 0;
      }
      expect((await sendRow(gym, addr("ns1")))?.state).toBe("queued");
      // The key is fixed: both go.
      await runSender({ now: () => hours(20) });
      expect(emailsTo(addr("ns1"))).toHaveLength(1);
      expect(emailsTo(addr("ns2"))).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an invitation whose email never went can be sent by a later press or Invite, and one given up after a week of refusals too",
    async () => {
      const owner = await makeUser("again-press-owner");
      const gym = (await makeGym(owner, "Again Press Gym")).org.id;
      for (const who of ["ap1", "ap2", "ap3"]) await typeIn(gym, owner, { fullName: who, email: addr(who) });
      expect((await press(gym, owner, await previewOf(gym, owner))).statusCode).toBe(200);
      // The gym lapses for a moment: the worker skips all three.
      await sql`UPDATE subscriptions SET status = 'expired' WHERE owner_type = 'gym' AND owner_id = ${gym}`;
      expect((await runSender()).skipped).toBe(3);
      await subscribeGym(gym);
      const again = await previewOf(gym, owner);
      expect(again).toMatchObject({ reach: 3, skipped: { alreadyInvited: 0 } });
      expect((await press(gym, owner, again)).statusCode).toBe(200);
      expect((await runSender()).sent).toBe(3);
      for (const who of ["ap1", "ap2", "ap3"]) expect(emailsTo(addr(who))).toHaveLength(1);
      // Sent once, it is invited for good.
      expect((await previewOf(gym, owner)).skipped.alreadyInvited).toBe(3);

      // Invite on one person's page does the same.
      const fay = await typeIn(gym, owner, { fullName: "ap4", email: addr("ap4") });
      expect((await post(`${entryUrl(gym, fay.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);
      await sql`UPDATE gyms SET postal_address = NULL WHERE id = ${gym}`;
      expect((await runSender()).skipped).toBe(1);
      await sql`UPDATE gyms SET postal_address = '1 Mill Lane, Leeds' WHERE id = ${gym}`;
      const res = await post(`${entryUrl(gym, fay.entry.entryId)}/invite`, {}, owner.cookies);
      expect(memberInviteOneSchema.parse((JSON.parse(res.body) as { invite: unknown }).invite).outcome).toBe("queued");
      expect((await runSender()).sent).toBe(1);

      // A week of Resend refusing it: given up, and a press can send it again.
      await typeIn(gym, owner, { fullName: "ap5", email: addr("ap5") });
      expect((await press(gym, owner, await previewOf(gym, owner))).statusCode).toBe(200);
      await sql`UPDATE gym_invite_sends SET created_at = now() - interval '8 days' WHERE gym_id = ${gym} AND state = 'queued'`;
      nextAnswers.push(notSent(403));
      await runSender();
      nextAnswers.length = 0;
      expect(await sendRow(gym, addr("ap5"))).toEqual({ state: "failed", reason: "provider_unavailable", email: null });
      expect((await previewOf(gym, owner)).reach).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "with sending switched off, the unsubscribe links already sent still work and the list still shows every invitation",
    async () => {
      const owner = await makeUser("off-owner");
      const gym = (await makeGym(owner, "Off Gym")).org.id;
      const ida = await typeIn(gym, owner, { fullName: "Ida", email: addr("off-ida") });
      expect((await post(`${entryUrl(gym, ida.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);
      await runSender();
      const email = emailsTo(addr("off-ida"))[0];
      if (email === undefined) throw new Error("no email");
      const link = new URL((email.headers["List-Unsubscribe"] ?? "").replace(/^<|>$/g, ""));

      const sendingOff = { ...settings, sender: null };
      const quiet = Fastify();
      registerUnsubscribeRoutes(quiet, { sql, redis: createMemoryRedis(), settings: sendingOff });
      await quiet.ready();
      const oneClick = await quiet.inject({
        method: "POST",
        url: `${link.pathname}${link.search}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "List-Unsubscribe=One-Click",
      });
      await quiet.close();
      expect(oneClick.statusCode).toBe(200);

      const off = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => new Date(), invites: sendingOff };
      expect((await previewInvite(off, owner.userId, gym, {}, () => Promise.resolve(true)))?.blocked).toBe("invites_off");
      const views = await invitationsOf(sql, sendingOff, gym, [{ email: addr("off-ida") }]);
      expect(views[0]?.state).toBe("pending");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the version is checked again under the gym's lock: a list changed after the group was read is refused",
    async () => {
      const owner = await makeUser("lock-owner");
      const gym = (await makeGym(owner, "Lock Gym")).org.id;
      await typeIn(gym, owner, { fullName: "Lou", email: addr("lock-lou") });
      const seen = await previewOf(gym, owner);
      const deps = {
        sql,
        redis: createMemoryRedis(),
        log: { warn: () => undefined },
        now: () => new Date(),
        invites: settings,
        afterInviteGroupRead: async () => {
          await sql`UPDATE gym_member_lists SET version = version + 1 WHERE gym_id = ${gym}`;
        },
      };
      await expect(
        pressInvite(deps, owner.userId, gym, { version: seen.version, expectedCount: seen.reach }, () => Promise.resolve(true)),
      ).rejects.toBeInstanceOf(InviteChanged);
      const invited = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_invites WHERE gym_id = ${gym}`;
      expect(invited[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "several staff and several unsubscribes at one address: the front desk's allowance and every link's own",
    async () => {
      const owner = await makeUser("desk-owner");
      const org = await makeGym(owner, "Desk Gym");
      const gym = org.org.id;
      const staff: User[] = [owner];
      for (const n of [1, 2, 3, 4]) {
        const manager = await makeUser(`desk-manager-${String(n)}`);
        await verify(manager.email);
        await appoint(manager, org, owner, "manager");
        staff.push(manager);
      }
      const stale = { version: 999, reach: 0, skipped: { noEmail: 0, inApp: 0, alreadyInvited: 0, unsubscribed: 0, bounced: 0, refused: 0, sharedAddress: 0 }, blocked: null };
      const desk = "10.64.0.1";
      // Five people, 24 presses each, at one address: all answered (the list moved).
      for (const who of staff) {
        for (let i = 0; i < 24; i++) expect((await press(gym, who, stale, {}, desk)).statusCode).toBe(409);
      }
      // The address's 121st press is refused; the same person elsewhere is not.
      expect((await press(gym, owner, stale, {}, desk)).statusCode).toBe(429);
      expect((await press(gym, owner, stale, {}, "10.64.0.2")).statusCode).toBe(409);

      // 25 people's links from one mail provider's address all work; one link, 21 times, does not.
      await sql`
        INSERT INTO gym_invites (gym_id, email_hmac)
        SELECT ${gym}, encode(sha256(convert_to(${gym} || '-desk-' || n, 'UTF8')), 'hex') FROM generate_series(1, 25) AS n`;
      const ids = await sql<{ id: string }[]>`SELECT id FROM gym_invites WHERE gym_id = ${gym} ORDER BY id`;
      const mailer = "10.64.0.9";
      const unsubscribe = (id: string) =>
        api().inject({
          method: "POST",
          url: `/v1/email/unsubscribe?t=${unsubscribeToken(settings.hmacKey, id)}`,
          remoteAddress: mailer,
          headers: { "content-type": "application/x-www-form-urlencoded" },
          payload: "List-Unsubscribe=One-Click",
        });
      for (const row of ids) expect((await unsubscribe(row.id)).statusCode).toBe(200);
      const one = ids[0]?.id ?? "";
      const answers: number[] = [];
      for (let i = 0; i < 21; i++) answers.push((await unsubscribe(one)).statusCode);
      expect(answers.filter((status) => status === 429).length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHO AN INVITE REACHES, AND WHY THE REST ARE LEFT OUT
  // =========================================================================

  it(
    "the preview counts each person once: no email, in the app, already invited, unsubscribed, a shared mailbox, or reached",
    async () => {
      const owner = await makeUser("count-owner");
      const org = await makeGym(owner, "Count Gym");
      const gym = org.org.id;
      const inApp = await makeUser("count-inapp");
      await verify(inApp.email);
      await join(inApp, org, owner);

      await typeIn(gym, owner, { fullName: "Phone only", phone: "+447911000301", status: "Active" });
      await typeIn(gym, owner, { fullName: "In the app", email: inApp.email, status: "Active" });
      await typeIn(gym, owner, { fullName: "In the app too", email: inApp.email, memberNumber: "F-2", status: "Pending" });
      await typeIn(gym, owner, { fullName: "Info", email: `info@${DOMAIN}`, status: "Active" });
      await typeIn(gym, owner, { fullName: "Gil", email: addr("gil"), status: "Active" });
      await typeIn(gym, owner, { fullName: "Hal", email: addr("hal"), status: "Pending" });
      await sql`
        INSERT INTO email_suppressions (email_hmac, gym_id, reason)
        VALUES (${emailHmac(settings.hmacKey, addr("hal"))}, ${gym}, 'unsubscribed')`;

      const all = await previewOf(gym, owner);
      expect(all).toMatchObject({
        reach: 1,
        skipped: { noEmail: 1, inApp: 2, alreadyInvited: 0, unsubscribed: 1, bounced: 0, refused: 0, sharedAddress: 1 },
        blocked: null,
      });
      const active = await previewOf(gym, owner, "?status=active");
      expect(active.reach).toBe(1);
      expect(active.skipped).toMatchObject({ noEmail: 1, inApp: 1, sharedAddress: 1, unsubscribed: 0 });
      // The household's second record is in the app because its first one is, though
      // the first is outside this filter.
      const pending = await previewOf(gym, owner, "?status=pending");
      expect(pending).toMatchObject({ reach: 0, skipped: { inApp: 1, unsubscribed: 1 } });

      const res = await press(gym, owner, active, { status: "active" });
      expect(res.statusCode, res.body).toBe(200);
      expect(memberInvitedSchema.parse((JSON.parse(res.body) as { invited: unknown }).invited)).toMatchObject({ queued: 1 });
      const invited = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_invites WHERE gym_id = ${gym}`;
      expect(invited[0]?.n).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a press bigger than one batch queues everybody once, even with a second, overlapping press at the same moment",
    async () => {
      const owner = await makeUser("batch-owner");
      const gym = (await makeGym(owner, "Batch Gym")).org.id;
      const people = 1_050;
      await sql`INSERT INTO gym_member_lists (gym_id, version) VALUES (${gym}, 1)`;
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, status)
        SELECT ${gym}, 'Person ' || n, 'minv-t-batch' || n || ${`@${DOMAIN}`},
               encode(sha256(convert_to(${gym} || '-' || n, 'UTF8')), 'hex'), 'upload',
               CASE WHEN n % 2 = 0 THEN 'Active' ELSE 'Pending' END
        FROM generate_series(1, ${people}) AS n`;
      const active = await previewOf(gym, owner, "?status=active");
      const all = await previewOf(gym, owner);
      expect(all.reach).toBe(people);
      const both = await Promise.all([press(gym, owner, active, { status: "active" }), press(gym, owner, all)]);
      let queued = 0;
      for (const res of both) {
        expect([200, 409], res.body).toContain(res.statusCode);
        if (res.statusCode === 200) queued += memberInvitedSchema.parse((JSON.parse(res.body) as { invited: unknown }).invited).queued;
      }
      if (both.some((res) => res.statusCode === 409)) {
        const rest = await previewOf(gym, owner);
        const again = await press(gym, owner, rest);
        expect(again.statusCode).toBe(200);
        queued += memberInvitedSchema.parse((JSON.parse(again.body) as { invited: unknown }).invited).queued;
      }
      expect(queued).toBe(people);
      const counts = await sql<{ invites: number; firsts: number; addresses: number }[]>`
        SELECT (SELECT count(*)::int FROM gym_invites WHERE gym_id = ${gym}) AS invites,
               (SELECT count(*)::int FROM gym_invite_sends WHERE gym_id = ${gym} AND kind = 'first') AS firsts,
               (SELECT count(DISTINCT email)::int FROM gym_invite_sends WHERE gym_id = ${gym}) AS addresses`;
      expect(counts[0]).toEqual({ invites: people, firsts: people, addresses: people });
      expect((await previewOf(gym, owner)).reach).toBe(0);
      // Nobody from this gym is left waiting for another test's sender run.
      await sql`DELETE FROM gym_invite_sends WHERE gym_id = ${gym}`;
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a press is refused when the list changed, without a postal address, without a plan, and when invitations are off",
    async () => {
      const owner = await makeUser("refuse-owner");
      const org = await makeGym(owner, "Refuse Gym");
      const gym = org.org.id;
      await typeIn(gym, owner, { fullName: "Ida", email: addr("ida") });
      const seen = await previewOf(gym, owner);
      await typeIn(gym, owner, { fullName: "Jo", email: addr("jo") });
      const moved = await press(gym, owner, seen);
      expect(moved.statusCode).toBe(409);
      const body = JSON.parse(moved.body) as { error: string; preview: unknown };
      expect(body.error).toBe("invite_changed");
      expect(memberInvitePreviewSchema.parse(body.preview).reach).toBe(2);

      expect((await patch(`/v1/orgs/${gym}`, { postalAddress: null }, owner.cookies)).statusCode).toBe(200);
      expect((await previewOf(gym, owner)).blocked).toBe("no_postal_address");
      const noAddress = await press(gym, owner, await previewOf(gym, owner));
      expect(noAddress.statusCode).toBe(409);
      expect(errorOf(noAddress).error).toBe("no_postal_address");

      expect((await patch(`/v1/orgs/${gym}`, { postalAddress: "1 Mill Lane, Leeds" }, owner.cookies)).statusCode).toBe(200);
      await sql`UPDATE subscriptions SET status = 'expired' WHERE owner_type = 'gym' AND owner_id = ${gym}`;
      expect((await previewOf(gym, owner)).blocked).toBe("gym_not_on_plan");
      const lapsed = await press(gym, owner, await previewOf(gym, owner));
      expect(lapsed.statusCode).toBe(409);
      expect(errorOf(lapsed).error).toBe("gym_not_on_plan");
      await subscribeGym(gym);

      const off = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => new Date(), invites: null };
      const offPreview = await previewInvite(off, owner.userId, gym, {}, () => Promise.resolve(true));
      expect(offPreview?.blocked).toBe("invites_off");
      await expect(pressInvite(off, owner.userId, gym, { version: 0, expectedCount: 0 }, () => Promise.resolve(true))).rejects.toMatchObject({
        statusCode: 503,
        code: "invites_off",
      });
      const queued = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_invites WHERE gym_id = ${gym}`;
      expect(queued[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a stranger gets 404, a trainer 403, a bad body 400 — and one gym's staff cannot reach another gym's person",
    async () => {
      const owner = await makeUser("tenancy-owner");
      const org = await makeGym(owner, "Tenancy Gym");
      const gym = org.org.id;
      const kim = await typeIn(gym, owner, { fullName: "Kim", email: addr("kim") });
      const strangerOwner = await makeUser("tenancy-stranger");
      const strangerGym = (await makeGym(strangerOwner, "Stranger Gym")).org.id;
      const trainer = await makeUser("tenancy-trainer");
      await verify(trainer.email);
      await appoint(trainer, org, owner, "trainer");
      const preview = await previewOf(gym, owner);

      expect((await get(`${listUrl(gym)}/invites/preview`, strangerOwner.cookies)).statusCode).toBe(404);
      expect((await press(gym, strangerOwner, preview)).statusCode).toBe(404);
      expect((await post(`${entryUrl(gym, kim.entry.entryId)}/invite`, {}, strangerOwner.cookies)).statusCode).toBe(404);
      expect((await post(`${entryUrl(gym, kim.entry.entryId)}/invite/resend`, {}, strangerOwner.cookies)).statusCode).toBe(404);
      // Kim's id through the stranger's OWN gym: not one of its people.
      expect((await post(`${entryUrl(strangerGym, kim.entry.entryId)}/invite`, {}, strangerOwner.cookies)).statusCode).toBe(404);

      expect((await get(`${listUrl(gym)}/invites/preview`, trainer.cookies)).statusCode).toBe(403);
      expect((await press(gym, trainer, preview)).statusCode).toBe(403);
      expect((await post(`${entryUrl(gym, kim.entry.entryId)}/invite`, {}, trainer.cookies)).statusCode).toBe(403);

      expect((await post(`${listUrl(gym)}/invites`, { version: 0 }, owner.cookies)).statusCode).toBe(400);
      expect((await post(`${listUrl(gym)}/invites`, { version: 0, expectedCount: -1 }, owner.cookies)).statusCode).toBe(400);
      expect((await get(`${listUrl(gym)}/invites/preview?filter=all`, owner.cookies)).statusCode).toBe(400);
      expect((await post(`${entriesUrl(gym)}/not-a-uuid/invite`, {}, owner.cookies)).statusCode).toBe(400);

      const invited = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_invites WHERE gym_id IN (${gym}, ${strangerGym})`;
      expect(invited[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // ONE PERSON: INVITE, ADD AND INVITE, SEND AGAIN
  // =========================================================================

  it(
    "Add and invite adds and invites together, or neither",
    async () => {
      const owner = await makeUser("add-owner");
      const gym = (await makeGym(owner, "Add Gym")).org.id;
      const added = await post(entriesUrl(gym), { fullName: "Lou", email: addr("lou"), invite: true }, owner.cookies);
      expect(added.statusCode, added.body).toBe(201);
      const written = memberListEntryWrittenSchema.parse(JSON.parse(added.body));
      expect(written.invite?.outcome).toBe("queued");
      expect(written.invite?.invitation.state).toBe("pending");
      expect(written.entry.invitation?.email?.state).toBe("queued");

      for (const [body, code] of [
        [{ fullName: "Phone only", phone: "+447911000302", invite: true }, "no_email"],
        [{ fullName: "Front desk", email: `support@${DOMAIN}`, invite: true }, "shared_address"],
      ] as const) {
        const refused = await post(entriesUrl(gym), body, owner.cookies);
        expect(refused.statusCode, refused.body).toBe(409);
        expect(errorOf(refused).error).toBe(code);
      }
      const people = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_list_entries WHERE gym_id = ${gym}`;
      expect(people[0]?.n).toBe(1);

      // Somebody already on the list is shown, not invited again.
      const twice = await post(entriesUrl(gym), { fullName: "Lou", email: addr("lou"), invite: true }, owner.cookies);
      expect(twice.statusCode).toBe(200);
      const shown = memberListEntryWrittenSchema.parse(JSON.parse(twice.body));
      expect(shown.outcome).toBe("already_on_list");
      expect(shown.invite).toBeUndefined();
      const sends = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_invite_sends WHERE gym_id = ${gym}`;
      expect(sends[0]?.n).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "send again: only for somebody invited, once at a time, 3 a person in 30 days and 20 a gym a day",
    async () => {
      const owner = await makeUser("again-owner");
      const gym = (await makeGym(owner, "Again Gym")).org.id;
      const max = await typeIn(gym, owner, { fullName: "Max", email: addr("max") });
      const url = `${entryUrl(gym, max.entry.entryId)}/invite`;

      const notYet = await post(`${url}/resend`, {}, owner.cookies);
      expect(notYet.statusCode).toBe(409);
      expect(errorOf(notYet).error).toBe("not_invited");

      const first = await post(url, {}, owner.cookies);
      expect(first.statusCode).toBe(200);
      expect(memberInviteOneSchema.parse((JSON.parse(first.body) as { invite: unknown }).invite).outcome).toBe("queued");
      expect(memberInviteOneSchema.parse((JSON.parse((await post(url, {}, owner.cookies)).body) as { invite: unknown }).invite).outcome).toBe(
        "already_invited",
      );
      // While the first email is still to go, "send again" queues nothing more.
      const waiting = await post(`${url}/resend`, {}, owner.cookies);
      expect(memberInviteOneSchema.parse((JSON.parse(waiting.body) as { invite: unknown }).invite).outcome).toBe("already_queued");
      await runSender();

      for (let time = 1; time <= 3; time++) {
        const res = await post(`${url}/resend`, {}, owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
        const one = memberInviteOneSchema.parse((JSON.parse(res.body) as { invite: unknown }).invite);
        expect(one.outcome).toBe("queued");
        // Counted once it has gone, not while it waits.
        expect(one.invitation.sentAgain).toBe(time - 1);
        await runSender();
        expect(emailsTo(addr("max"))).toHaveLength(time + 1);
      }
      const fourth = await post(`${url}/resend`, {}, owner.cookies);
      expect(fourth.statusCode).toBe(429);
      expect(errorOf(fourth).error).toBe("again_person_limit");
      expect(emailsTo(addr("max"))).toHaveLength(4);

      // The gym's own ceiling, with 20 sent again today already.
      const ned = await typeIn(gym, owner, { fullName: "Ned", email: addr("ned") });
      expect((await post(`${entryUrl(gym, ned.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);
      await runSender();
      await sql`
        INSERT INTO gym_invite_sends (gym_id, invite_id, kind, state, not_before, created_at, finished_at)
        SELECT ${gym}, i.id, 'again', 'sent', now(), now(), now()
        FROM gym_invites i, generate_series(1, 17)
        WHERE i.gym_id = ${gym} AND i.email_hmac = ${emailHmac(settings.hmacKey, addr("max"))}`;
      const gymLimit = await post(`${entryUrl(gym, ned.entry.entryId)}/invite/resend`, {}, owner.cookies);
      expect(gymLimit.statusCode).toBe(429);
      expect(errorOf(gymLimit).error).toBe("again_gym_limit");

      // A declined invitation sent again is pending again (§10.2).
      await sql`UPDATE gym_invites SET state = 'declined' WHERE gym_id = ${gym} AND email_hmac = ${emailHmac(settings.hmacKey, addr("ned"))}`;
      await sql`DELETE FROM gym_invite_sends WHERE gym_id = ${gym} AND kind = 'again' AND email IS NULL AND provider_id IS NULL AND attempts = 0`;
      const reopened = await post(`${entryUrl(gym, ned.entry.entryId)}/invite/resend`, {}, owner.cookies);
      expect(reopened.statusCode, reopened.body).toBe(200);
      expect(memberInviteOneSchema.parse((JSON.parse(reopened.body) as { invite: unknown }).invite).invitation.state).toBe("pending");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE LIST AND THE PERSON'S PAGE SAY WHERE EACH INVITATION STANDS
  // =========================================================================

  it(
    "each row and each person's page carry the invitation, and the list filters by it",
    async () => {
      const owner = await makeUser("show-owner");
      const gym = (await makeGym(owner, "Show Gym")).org.id;
      const oli = await typeIn(gym, owner, { fullName: "Oli", email: addr("oli") });
      await typeIn(gym, owner, { fullName: "Pat", email: addr("pat") });
      await typeIn(gym, owner, { fullName: "Quin", phone: "+447911000303" });
      const rex = await typeIn(gym, owner, { fullName: "Rex", email: addr("rex") });
      expect((await post(`${entryUrl(gym, oli.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);
      expect((await post(`${entryUrl(gym, rex.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);
      await runSender();
      await sql`UPDATE gym_invites SET state = 'declined' WHERE gym_id = ${gym} AND email_hmac = ${emailHmac(settings.hmacKey, addr("rex"))}`;

      const page = async (query: string) => {
        const res = await get(`${entriesUrl(gym)}${query}`, owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return memberListEntriesPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page);
      };
      const whole = await page("");
      const byName = new Map(whole.entries.map((entry) => [entry.fullName, entry]));
      expect(byName.get("Oli")?.invitation?.email?.state).toBe("sent");
      expect(byName.get("Pat")?.invitation).toBeNull();
      expect(byName.get("Quin")?.invitation).toBeNull();
      expect((await page("?invitation=pending")).entries.map((entry) => entry.fullName)).toEqual(["Oli"]);
      expect((await page("?invitation=not_invited")).entries.map((entry) => entry.fullName)).toEqual(["Pat", "Quin"]);
      expect((await page("?invitation=declined")).entries.map((entry) => entry.fullName)).toEqual(["Rex"]);
      expect((await page("?invitation=accepted")).total).toBe(0);

      const detail = await get(entryUrl(gym, oli.entry.entryId), owner.cookies);
      const oliPage = memberListEntryDetailSchema.parse((JSON.parse(detail.body) as { entry: unknown }).entry);
      expect(oliPage.invitation).toMatchObject({ state: "pending", sentAgain: 0, email: { state: "sent", reason: null } });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE SENDER CHECKS AGAIN JUST BEFORE EACH EMAIL GOES
  // =========================================================================

  it(
    "an email is not sent when, since the press, the person left the list, joined the app, or the gym lapsed or lost its address",
    async () => {
      const owner = await makeUser("late-owner");
      const org = await makeGym(owner, "Late Gym");
      const gym = org.org.id;
      const rae = await typeIn(gym, owner, { fullName: "Rae", email: addr("rae") });
      const sam = await makeUser("late-sam");
      await typeIn(gym, owner, { fullName: "Sam", email: sam.email });
      await typeIn(gym, owner, { fullName: "Tia", email: addr("tia") });
      await typeIn(gym, owner, { fullName: "Uma", email: `uma@nomail.${DOMAIN}` });
      await typeIn(gym, owner, { fullName: "Vic", email: `vic@flaky.${DOMAIN}` });
      domains.set(`nomail.${DOMAIN}`, "no_mail");
      domains.set(`flaky.${DOMAIN}`, "unknown");
      expect((await press(gym, owner, await previewOf(gym, owner))).statusCode).toBe(200);

      expect((await del(entryUrl(gym, rae.entry.entryId), owner.cookies)).statusCode).toBe(200);
      await verify(sam.email);
      await join(sam, org, owner);

      const run = await runSender();
      expect(run).toMatchObject({ sent: 1, skipped: 3, held: 1 });
      const reasons = await sql<{ reason: string | null; state: string }[]>`
        SELECT state, reason FROM gym_invite_sends WHERE gym_id = ${gym} ORDER BY reason NULLS LAST`;
      expect(reasons.map((row) => `${row.state}:${row.reason ?? ""}`).sort()).toEqual(
        ["queued:", "sent:", "skipped:in_app", "skipped:no_mail_domain", "skipped:not_on_list"].sort(),
      );
      expect(emailsTo(addr("tia"))).toHaveLength(1);

      // The flaky domain waits, spending nothing, and after a week it is given up.
      await sql`UPDATE gym_invite_sends SET not_before = now() WHERE gym_id = ${gym} AND state = 'queued'`;
      expect((await runSender()).held).toBe(1);
      await sql`UPDATE gym_invite_sends SET not_before = now(), created_at = now() - interval '8 days' WHERE gym_id = ${gym} AND state = 'queued'`;
      expect((await runSender()).failed).toBe(1);
      const vic = await sql<{ state: string; reason: string | null; email: string | null }[]>`
        SELECT state, reason, email FROM gym_invite_sends WHERE gym_id = ${gym} AND reason = 'dns_unavailable'`;
      expect(vic).toEqual([{ state: "failed", reason: "dns_unavailable", email: null }]);

      // A lapsed gym and a gym with no address send nothing that was waiting.
      const wes = await typeIn(gym, owner, { fullName: "Wes", email: addr("wes") });
      expect((await post(`${entryUrl(gym, wes.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);
      await sql`UPDATE subscriptions SET status = 'expired' WHERE owner_type = 'gym' AND owner_id = ${gym}`;
      expect((await runSender()).skipped).toBe(1);
      await subscribeGym(gym);
      await sql`
        INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at)
        SELECT gym_id, id, 'again', ${addr("wes")}, now(), now() FROM gym_invites
        WHERE gym_id = ${gym} AND email_hmac = ${emailHmac(settings.hmacKey, addr("wes"))}`;
      await sql`UPDATE gyms SET postal_address = NULL WHERE id = ${gym}`;
      expect((await runSender()).skipped).toBe(1);
      expect(emailsTo(addr("wes"))).toHaveLength(0);
      const wesReasons = await sql<{ reason: string }[]>`
        SELECT s.reason FROM gym_invite_sends s JOIN gym_invites i ON i.id = s.invite_id
        WHERE s.gym_id = ${gym} AND i.email_hmac = ${emailHmac(settings.hmacKey, addr("wes"))} ORDER BY s.created_at`;
      expect(wesReasons.map((row) => row.reason)).toEqual(["gym_not_active", "no_postal_address"]);

      // Every finished email has lost its address (the table's own CHECK holds it).
      const kept = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_invite_sends WHERE gym_id = ${gym} AND state NOT IN ('queued','sending') AND email IS NOT NULL`;
      expect(kept[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a refused request waits and marks nothing, an outage is tried again later, and a send whose worker vanished after handing it over is never sent again",
    async () => {
      const owner = await makeUser("provider-owner");
      const gym = (await makeGym(owner, "Provider Gym")).org.id;
      await typeIn(gym, owner, { fullName: "Xan", email: addr("xan") });
      await typeIn(gym, owner, { fullName: "Yul", email: addr("yul") });
      expect((await press(gym, owner, await previewOf(gym, owner))).statusCode).toBe(200);
      nextAnswers.push(notSent(422), unclear(503));
      const run = await runSender();
      expect(run).toMatchObject({ held: 1, retried: 1, sent: 0, failed: 0 });
      const waiting = await sql<{ not_before: Date; attempts: number; maybe_sent_at: Date | null }[]>`
        SELECT not_before, attempts, maybe_sent_at FROM gym_invite_sends WHERE gym_id = ${gym} AND state = 'queued'
        ORDER BY maybe_sent_at NULLS FIRST`;
      expect(waiting).toHaveLength(2);
      // The refused one did not go, so nothing says it may have.
      expect(waiting[0]?.maybe_sent_at).toBeNull();
      expect(waiting[1]?.maybe_sent_at).not.toBeNull();
      for (const row of waiting) expect((row.not_before.getTime() - Date.now())).toBeGreaterThan(30_000);

      // A worker died after handing one over 21 hours ago: its lease ran out, and it is
      // never handed to Resend again.
      await sql`
        UPDATE gym_invite_sends
        SET state = 'sending', lease_until = now() - interval '20 hours', maybe_sent_at = now() - interval '21 hours'
        WHERE gym_id = ${gym} AND maybe_sent_at IS NOT NULL`;
      const before = calls.length;
      await runSender();
      expect(calls.length).toBe(before);
      const rows = await sql<{ state: string; reason: string | null }[]>`
        SELECT state, reason FROM gym_invite_sends WHERE gym_id = ${gym} AND state <> 'queued'`;
      expect(rows).toEqual([{ state: "failed", reason: "send_unknown" }]);
      expect(emailsTo(addr("xan")).length + emailsTo(addr("yul")).length).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym on trial sends at most its cap in 24 hours, the whole app at most its own, and the off switch sends nothing",
    async () => {
      const owner = await makeUser("cap-owner");
      const gym = (await makeGym(owner, "Cap Gym")).org.id;
      for (const who of ["cap1", "cap2", "cap3"]) await typeIn(gym, owner, { fullName: who, email: addr(who) });
      expect((await press(gym, owner, await previewOf(gym, owner))).statusCode).toBe(200);

      expect((await runSender({ settings: { ...settings, paused: true } })).sent).toBe(0);
      expect((await runSender({ limits: { trialGymPerDay: 2 } })).sent).toBe(2);
      expect((await runSender({ limits: { trialGymPerDay: 2 } })).sent).toBe(0);
      // On a paid plan the trial's cap no longer applies.
      await subscribeGym(gym, "active");
      expect((await runSender({ limits: { trialGymPerDay: 2, gymPerDay: 3 } })).sent).toBe(1);

      const other = await makeUser("cap-other");
      const otherGym = (await makeGym(other, "Cap Other Gym")).org.id;
      await typeIn(otherGym, other, { fullName: "cap4", email: addr("cap4") });
      expect((await press(otherGym, other, await previewOf(otherGym, other))).statusCode).toBe(200);
      const sentToday = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_invite_sends WHERE state = 'sent' AND finished_at > now() - interval '24 hours'`;
      const capped = await runSender({ settings: { ...settings, perDay: sentToday[0]?.n ?? 0 } });
      expect(capped).toMatchObject({ capped: true, sent: 0 });
      expect((await runSender()).sent).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the email: fixed words, the gym's cleaned name, its postal address, one-click unsubscribe headers, and no address in the sender's logs",
    async () => {
      const owner = await makeUser("words-owner");
      const org = await makeGym(owner, "Iron House");
      const gym = org.org.id;
      await sql`UPDATE gyms SET name = ${"Iron House https://evil.example claim.now"} WHERE id = ${gym}`;
      await typeIn(gym, owner, { fullName: "Zed", email: addr("zed") });
      expect((await press(gym, owner, await previewOf(gym, owner))).statusCode).toBe(200);
      logged.length = 0;
      // A Resend outage first, so the sender has something to log.
      nextAnswers.push(unclear(503));
      expect((await runSender()).retried).toBe(1);
      expect(logged.length).toBeGreaterThan(0);
      await sql`UPDATE gym_invite_sends SET not_before = now() WHERE gym_id = ${gym} AND state = 'queued'`;
      expect((await runSender()).sent).toBe(1);
      const email = emailsTo(addr("zed"))[0];
      if (email === undefined) throw new Error("no email");
      expect(email.subject).toBe("You're a member of Iron House claim now — get the app");
      expect(email.text).not.toContain("evil");
      expect(email.text).toContain("12 High Street, Leeds LS1 1AA");
      expect(email.text).toContain(`http://localhost:5173/join/${org.org.slug}`);
      expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(email.headers["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:3000\/v1\/email\/unsubscribe\?t=[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}>$/);
      expect(email.text.match(/https?:\/\//g)).toHaveLength(2);
      expect(JSON.stringify(logged)).not.toContain("minv-t-");

      // A name that is all web address is still named, never left blank.
      await sql`UPDATE gyms SET name = 'https://ironhouse.fit' WHERE id = ${gym}`;
      const yan = await typeIn(gym, owner, { fullName: "Yan", email: addr("yan") });
      expect((await post(`${entryUrl(gym, yan.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);
      await runSender();
      const named = emailsTo(addr("yan"))[0];
      expect(named?.subject).toBe("You're a member of ironhouse fit — get the app");
      expect(named?.text.startsWith("ironhouse fit in Leeds has invited you")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE UNSUBSCRIBE LINK
  // =========================================================================

  it(
    "unsubscribe: GET shows a page and changes nothing; POST unsubscribes at once, one-click or by the page's button; a forged link is refused",
    async () => {
      const owner = await makeUser("unsub-owner");
      const gym = (await makeGym(owner, "Unsub Gym")).org.id;
      await typeIn(gym, owner, { fullName: "Ada", email: addr("ada") });
      await typeIn(gym, owner, { fullName: "Ben", email: addr("ben") });
      await typeIn(gym, owner, { fullName: "Cal", email: addr("cal") });
      expect((await press(gym, owner, await previewOf(gym, owner))).statusCode).toBe(200);
      await runSender();
      const path = (who: string) => {
        const email = emailsTo(addr(who))[0];
        if (email === undefined) throw new Error(`no email to ${who}`);
        const link = new URL((email.headers["List-Unsubscribe"] ?? "").replace(/^<|>$/g, ""));
        return `${link.pathname}${link.search}`;
      };
      const suppressed = async (who: string) =>
        (await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM email_suppressions
          WHERE gym_id = ${gym} AND email_hmac = ${emailHmac(settings.hmacKey, addr(who))}`)[0]?.n ?? 0;

      const page = await api().inject({ method: "GET", url: path("ada"), remoteAddress: nextIp() });
      expect(page.statusCode).toBe(200);
      expect(page.headers["content-type"]).toContain("text/html");
      expect(page.body).toContain("Unsubscribe");
      expect(page.body).toContain("Unsub Gym");
      expect(await suppressed("ada")).toBe(0);

      const button = await api().inject({
        method: "POST",
        url: path("ada"),
        remoteAddress: nextIp(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "",
      });
      expect(button.statusCode).toBe(200);
      expect(button.body).toContain("You're unsubscribed");
      expect(await suppressed("ada")).toBe(1);

      const boundary = "----minv";
      const multipart = await api().inject({
        method: "POST",
        url: path("ben"),
        remoteAddress: nextIp(),
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: `--${boundary}\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--${boundary}--\r\n`,
      });
      expect(multipart.statusCode).toBe(200);
      expect(multipart.body).toBe("");
      expect(await suppressed("ben")).toBe(1);
      // Twice is once.
      const twice = await api().inject({
        method: "POST",
        url: path("ben"),
        remoteAddress: nextIp(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "List-Unsubscribe=One-Click",
      });
      expect(twice.statusCode).toBe(200);
      expect(await suppressed("ben")).toBe(1);

      // A parameter a mail program adds never stops an unsubscribe.
      const extra = await api().inject({
        method: "POST",
        url: `${path("cal")}&utm_source=mailer`,
        remoteAddress: nextIp(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "List-Unsubscribe=One-Click",
      });
      expect(extra.statusCode).toBe(200);
      expect(await suppressed("cal")).toBe(1);
      await sql`DELETE FROM email_suppressions WHERE gym_id = ${gym} AND email_hmac = ${emailHmac(settings.hmacKey, addr("cal"))}`;

      const cal = path("cal");
      const forged = cal.slice(0, -3) + (cal.endsWith("AAA") ? "BBB" : "AAA");
      for (const bad of [forged, "/v1/email/unsubscribe?t=nonsense", "/v1/email/unsubscribe", `/v1/email/unsubscribe?t=${"A".repeat(22)}.${"A".repeat(22)}`]) {
        expect((await api().inject({ method: "GET", url: bad, remoteAddress: nextIp() })).statusCode, bad).toBe(404);
        const post404 = await api().inject({
          method: "POST",
          url: bad,
          remoteAddress: nextIp(),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          payload: "List-Unsubscribe=One-Click",
        });
        expect(post404.statusCode, bad).toBe(404);
      }
      expect(await suppressed("cal")).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE GYM'S POSTAL ADDRESS
  // =========================================================================

  it(
    "the postal address is tidied as every invitation prints it, capped, cleared by null, and shown to staff only",
    async () => {
      const owner = await makeUser("postal-owner");
      const org = await makeGym(owner, "Postal Gym");
      const gym = org.org.id;
      const set = await patch(`/v1/orgs/${gym}`, { postalAddress: "  Unit 4\nMill Lane www.evil.example\r\nLeeds LS2 7AB  " }, owner.cookies);
      expect(set.statusCode, set.body).toBe(200);
      expect((JSON.parse(set.body) as { postalAddress: string | null }).postalAddress).toBe("Unit 4, Mill Lane, Leeds LS2 7AB");
      const long = await patch(`/v1/orgs/${gym}`, { postalAddress: "x".repeat(201) }, owner.cookies);
      expect(long.statusCode).toBe(400);
      expect(errorOf(long).error).toBe("postal_address_too_long");

      const mine = async (who: User) => {
        const res = await get("/v1/orgs/mine", who.cookies);
        const orgs = (JSON.parse(res.body) as { orgs: { id: string; postalAddress: string | null }[] }).orgs;
        return orgs.find((row) => row.id === gym)?.postalAddress;
      };
      expect(await mine(owner)).toBe("Unit 4, Mill Lane, Leeds LS2 7AB");
      const member = await makeUser("postal-member");
      await verify(member.email);
      await join(member, org, owner);
      expect(await mine(member)).toBeNull();

      const stranger = await makeUser("postal-stranger");
      expect((await patch(`/v1/orgs/${gym}`, { postalAddress: "1 Evil Road" }, stranger.cookies)).statusCode).toBe(404);
      expect((await patch(`/v1/orgs/${gym}`, { postalAddress: null }, owner.cookies)).statusCode).toBe(200);
      expect(await mine(owner)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE TABLES' OWN RULES
  // =========================================================================

  it("the database refuses a second first email, an address kept after sending, and a bounce kept for one gym", async () => {
    const owner = await makeUser("check-owner");
    const gym = (await makeGym(owner, "Check Gym")).org.id;
    const hmac = emailHmac(settings.hmacKey, addr("check"));
    const invite = (await sql<{ id: string }[]>`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym}, ${hmac}) RETURNING id`)[0];
    if (invite === undefined) throw new Error("no invite");
    const insertFirst = () => sql`
      INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at)
      VALUES (${gym}, ${invite.id}, 'first', ${addr("check")}, now(), now())`;
    await insertFirst();
    await expect(insertFirst()).rejects.toMatchObject({ code: "23505" });
    await expect(sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym}, ${hmac})`).rejects.toMatchObject({ code: "23505" });
    await expect(sql`
      UPDATE gym_invite_sends SET state = 'sent', finished_at = now() WHERE invite_id = ${invite.id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`
      INSERT INTO email_suppressions (email_hmac, gym_id, reason) VALUES (${hmac}, ${gym}, 'bounced')`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`
      INSERT INTO email_suppressions (email_hmac, gym_id, reason) VALUES (${hmac}, NULL, 'unsubscribed')`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym}, ${"ann@example.com"})`).rejects.toMatchObject({ code: "23514" });
  });

  // =========================================================================
  // WHAT COMES BACK (3b-i-b): THE FIRST 50 WAIT FOR THEIR RESULTS
  // =========================================================================

  it("a gym's 51st email waits until its first 50 have come back, then goes; a stopped gym sends nothing", async () => {
    const owner = await makeUser("gate-owner");
    const gym = (await makeGym(owner, "Gate Gym")).org.id;
    const went = new Date(Date.now() - 5 * 60_000);
    for (let i = 0; i < 50; i++) {
      const hmac = emailHmac(settings.hmacKey, addr(`gate-${String(i)}`));
      const at = new Date(went.getTime() + i * 1000);
      await sql`INSERT INTO gym_invites (gym_id, email_hmac, created_at) VALUES (${gym}, ${hmac}, ${at})`;
      await sql`
        INSERT INTO gym_invite_sends (gym_id, invite_id, kind, state, not_before, created_at, finished_at, provider_id)
        VALUES (${gym}, (SELECT id FROM gym_invites WHERE gym_id = ${gym} AND email_hmac = ${hmac}),
                'first', 'sent', ${at}, ${at}, ${at}, ${`re_gate_${String(i)}`})`;
    }
    const next = await typeIn(gym, owner, { fullName: "Fifty One", email: addr("gate-next") });
    expect((await post(`${entryUrl(gym, next.entry.entryId)}/invite`, {}, owner.cookies)).statusCode).toBe(200);

    await runSender();
    expect(emailsTo(addr("gate-next"))).toHaveLength(0);
    // 49 back is not enough.
    await sql`
      UPDATE gym_invite_sends SET result = 'delivered', result_at = now()
      WHERE gym_id = ${gym} AND provider_id <> 're_gate_49' AND state = 'sent'`;
    await runSender();
    expect(emailsTo(addr("gate-next"))).toHaveLength(0);
    // Stopped, it stays put even with all 50 back.
    await sql`UPDATE gym_invite_sends SET result = 'delivered', result_at = now() WHERE gym_id = ${gym} AND provider_id = 're_gate_49'`;
    await sql`UPDATE gyms SET invites_stopped_at = now(), invites_stopped_reason = 'bounces' WHERE id = ${gym}`;
    await runSender();
    expect(emailsTo(addr("gate-next"))).toHaveLength(0);
    await sql`UPDATE gyms SET invites_stopped_at = NULL, invites_stopped_reason = NULL WHERE id = ${gym}`;
    await runSender();
    expect(emailsTo(addr("gate-next"))).toHaveLength(1);
    // It carries the tag that lets a report find its row before Resend's id is known.
    const nextRow = (await sql<{ id: string }[]>`
      SELECT s.id FROM gym_invite_sends s JOIN gym_invites i ON i.id = s.invite_id
      WHERE s.gym_id = ${gym} AND i.email_hmac = ${emailHmac(settings.hmacKey, addr("gate-next"))}`)[0];
    expect(emailsTo(addr("gate-next"))[0]?.tags).toEqual([{ name: "invite_send", value: nextRow?.id }]);
    // A result belongs only to an email that went.
    await expect(sql`
      UPDATE gym_invite_sends SET state = 'queued', finished_at = NULL, provider_id = NULL
      WHERE gym_id = ${gym} AND provider_id = 're_gate_0'`).rejects.toMatchObject({ code: "23514" });
  }, TEST_TIMEOUT_MS);
});