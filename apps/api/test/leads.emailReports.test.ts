// What comes back from a lead's follow-up the app sent (20c-v-b; spec Part 3 §16.3):
// Resend's webhook and the worker that acts on it, against real Postgres
// (DATABASE_URL-gated). The emails are sent by the real sender with a recording
// transport; Resend's own record of each email is answered by the test.
//
// The first block is the worst thing this job could do to a real person: a lead who
// marked a gym's email as spam gets another from that gym — or a report about one gym's
// email unticks, blocks or stops somebody at another gym.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailRecordLookup, EmailRecordReader, InviteEmail, InviteTransport } from "../src/email/resend.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { gymCounts, resumeGym } from "../src/modules/orgs/invites/repo.js";
import { INVITE_RESULTS, processInviteResults, type StoppedGym } from "../src/modules/orgs/invites/results.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { sendDueLeadEmails, type LeadSendRun } from "../src/modules/orgs/leads/sender.js";
import { RESEND_WEBHOOK_PATH } from "../src/modules/webhooks/resendRoutes.js";
import { LEAD_SEND_TAG, type Lead } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
/** A test signing secret in Resend's shape: `whsec_` and base64. */
const SECRET = "whsec_" + Buffer.from("lead-email-reports-test-key-000!").toString("base64"); // gitleaks:allow
const OTHER_SECRET = "whsec_" + Buffer.from("not-resend-at-all-signing-key-0!").toString("base64"); // gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "lead-email-reports-secret-012345678", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  RESEND_WEBHOOK_SECRET: SECRET,
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TIMEOUT_MS = 120_000;
const LIVE_PLAN = "zz_lead_email_reports";
const ZONE = "Europe/London";
const USERS = "leadrep-%@example.com";
/** Every address this suite emails, so its every-gym suppressions can be cleared. */
const PEOPLE = ["priya", "kit", "ana", "bo", "cy", "dee", "eli", "fay", "gus", "hal", "ivy", "jon", "kay", "liv"];
const personAddr = (name: string) => `${name}.leadrep@example.com`;

let ipCounter = 0;
const nextIp = () => `10.66.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** Sign a body as Svix does: `${id}.${timestamp}.${body}` under the secret's key. */
function sign(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${String(timestamp)}.${body}`).digest("base64");
}

d("what comes back from a lead's follow-up (real Postgres)", () => {
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
  const hmacOf = (email: string) => emailHmac(settings.hmacKey, email);
  const eventIds: string[] = [];

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${USERS})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'resend' AND event_id LIKE 'msg_leadrep_%'`;
    await sql`DELETE FROM gym_lead_sends WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_lead_email_settings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE ${USERS}`;
    const everyGym = PEOPLE.flatMap((name) => [hmacOf(personAddr(name)), hmacOf(`new.${personAddr(name)}`)]);
    await sql`DELETE FROM email_suppressions WHERE gym_id IS NULL AND email_hmac = ANY(${everyGym}::text[])`;
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

  const makeOwner = async (local: string) => {
    const email = `leadrep-${local}@example.com`;
    const reg = await send("POST", "/v1/auth/register", { email, password: PASSWORD, displayName: `Owner ${local}` }, {});
    expect(reg.statusCode).toBe(201);
    const login = await send("POST", "/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return cookieMap(login);
  };

  /** A gym on a plan, with its postal address, and "Send them for me" switched on. */
  const makeGym = async (cookies: Record<string, string>, name: string): Promise<string> => {
    const res = await send("POST", "/v1/orgs", { name, city: "Leeds", country: "GB", timezone: ZONE }, cookies);
    expect(res.statusCode).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await send("PATCH", `/v1/orgs/${gymId}`, { postalAddress: "12 Kirkgate, Leeds LS1 6BY" }, cookies)).statusCode).toBe(200);
    const on = await send("PUT", `/v1/orgs/${gymId}/leads/email-settings`, { sendForMe: true, replyTo: "desk@ironhouse.example.com" }, cookies);
    expect(on.statusCode, on.body).toBe(200);
    return gymId;
  };

  const addLead = async (gymId: string, cookies: Record<string, string>, name: string): Promise<Lead> => {
    const res = await send("POST", `/v1/orgs/${gymId}/leads`, { fullName: `${name} Test`, email: personAddr(name), source: "walk_in", mayEmail: true }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { lead: Lead }).lead;
  };
  const readLead = async (gymId: string, leadId: string, cookies: Record<string, string>): Promise<Lead> => {
    const res = await send("GET", `/v1/orgs/${gymId}/leads/${leadId}`, undefined, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { lead: Lead }).lead;
  };
  const storedLead = async (leadId: string) =>
    (await sql<{ sent: number; ok: Date | null }[]>`SELECT follow_ups_sent AS sent, email_ok_at AS ok FROM gym_leads WHERE id = ${leadId}`)[0];
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

  // ── The sender, with every email it hands to "Resend" recorded ──

  const outbox: { message: InviteEmail; providerId: string }[] = [];
  const transport: InviteTransport = {
    send: (message) => {
      const providerId = `re_${randomUUID()}`;
      outbox.push({ message, providerId });
      // Resend's record of it, until a test says otherwise: sent, with its tags.
      resendRecords.set(providerId, "sent");
      resendTags.set(providerId, message.tags);
      return Promise.resolve({ kind: "sent", id: providerId });
    },
  };
  const emailsTo = (name: string) => outbox.filter((sent) => sent.message.to === personAddr(name));
  const lastTo = (name: string) => {
    const found = emailsTo(name).at(-1);
    if (found === undefined) throw new Error(`nothing was sent to ${name}`);
    return found;
  };
  const tagOf = (sent: { message: InviteEmail }) => sent.message.tags.find((tag) => tag.name === LEAD_SEND_TAG)?.value ?? null;
  const ourGyms: string[] = [];
  const midday = () => new Date(`${dayInTz(new Date(), ZONE)}T12:00:00Z`);
  const runSender = async (): Promise<LeadSendRun> =>
    await sendDueLeadEmails({
      gymIds: ourGyms,
      sql,
      log: { info: () => undefined, warn: () => undefined },
      settings,
      sender,
      transport,
      mailDomain: () => Promise.resolve("accepts"),
      now: midday,
      sleep: () => Promise.resolve(),
    });

  // ── The webhook, signed as Resend signs it ──

  const report = (
    type: string,
    emailId: string,
    opts: { tag?: string | null; tagName?: string; secret?: string; id?: string; bounceType?: string; bounceSubType?: string } = {},
  ) => {
    const id = opts.id ?? `msg_leadrep_${randomUUID()}`;
    eventIds.push(id);
    const at = Math.floor(Date.now() / 1000);
    const tag = opts.tag ?? null;
    const body = JSON.stringify({
      type,
      created_at: new Date(at * 1000).toISOString(),
      data: {
        email_id: emailId,
        from: "Gym via AI Home Gym <invites@example.com>",
        to: ["somebody@example.com"],
        subject: "Thanks for asking",
        ...(opts.bounceType === undefined ? {} : { bounce: { type: opts.bounceType, subType: opts.bounceSubType ?? "General", message: "x" } }),
        tags: tag === null ? { category: "lead" } : { category: "lead", [opts.tagName ?? LEAD_SEND_TAG]: tag },
      },
    });
    return api().inject({
      method: "POST",
      url: RESEND_WEBHOOK_PATH,
      remoteAddress: "44.228.126.217",
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": String(at),
        "svix-signature": sign(opts.secret ?? SECRET, id, at, body),
      },
      payload: body,
    });
  };
  /** Resend reports on an email the sender handed over, tagged as it tags it. */
  const reportOn = async (sent: { message: InviteEmail; providerId: string }, type: string, lastEvent: string, bounce?: string) => {
    resendRecords.set(sent.providerId, lastEvent);
    const res = await report(type, sent.providerId, { tag: tagOf(sent), ...(bounce === undefined ? {} : { bounceType: bounce }) });
    expect(res.statusCode).toBe(200);
  };

  // ── The worker, with Resend's own record answered by the test ──

  const resendRecords = new Map<string, string>();
  const resendTags = new Map<string, { name: string; value: string }[]>();
  const reader: EmailRecordReader = {
    read: (emailId) => {
      const last = resendRecords.get(emailId);
      const answer: EmailRecordLookup =
        last === undefined ? { kind: "missing" } : { kind: "found", lastEvent: last, tags: resendTags.get(emailId) ?? [] };
      return Promise.resolve(answer);
    },
  };
  const toldOperator: StoppedGym[] = [];
  let clock = new Date(Date.now() + 1);
  /** Run the worker until no report is due, moving the clock past each retry. */
  const processAll = async (): Promise<void> => {
    for (let i = 0; i < INVITE_RESULTS.maxTries + 2; i++) {
      await processInviteResults({
        sql,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
        reader,
        hmacKey: settings.hmacKey,
        eventIds,
        tellOperator: (stopped) => {
          toldOperator.push(stopped);
          return Promise.resolve();
        },
        now: () => clock,
        sleep: () => Promise.resolve(),
      });
      clock = new Date(clock.getTime() + 4 * 60 * 60 * 1000);
    }
    clock = new Date(Date.now() + 1);
  };

  const suppressionsOf = async (name: string) =>
    await sql<{ gym_id: string | null; reason: string }[]>`
      SELECT gym_id, reason FROM email_suppressions WHERE email_hmac = ${hmacOf(personAddr(name))} ORDER BY reason, gym_id`;
  const resultOf = async (providerId: string) =>
    (await sql<{ result: string | null }[]>`SELECT result FROM gym_lead_sends WHERE provider_id = ${providerId}`)[0]?.result ?? null;
  const stoppedReason = async (gymId: string) =>
    (await sql<{ reason: string | null }[]>`SELECT invites_stopped_reason AS reason FROM gyms WHERE id = ${gymId}`)[0]?.reason ?? null;

  /** An invitation email of this gym that went, as the invitations' sender leaves it. */
  const seedInvitationSent = async (gymId: string, name: string): Promise<string> => {
    const providerId = `re_${randomUUID()}`;
    const hmac = hmacOf(personAddr(name));
    await sql`INSERT INTO gym_invites (gym_id, email_hmac, created_at) VALUES (${gymId}, ${hmac}, now()) ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_invite_sends (gym_id, invite_id, kind, state, not_before, created_at, finished_at, provider_id)
      VALUES (${gymId}, (SELECT id FROM gym_invites WHERE gym_id = ${gymId} AND email_hmac = ${hmac}),
              'first', 'sent', now(), now(), now(), ${providerId})
      RETURNING id`;
    const sendId = rows[0]?.id;
    if (sendId === undefined) throw new Error("the invitation send was not written");
    resendRecords.set(providerId, "sent");
    resendTags.set(providerId, [{ name: "invite_send", value: sendId }]);
    return providerId;
  };

  let ownerA: Record<string, string>;
  let ownerB: Record<string, string>;

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
    ownerA = await makeOwner("a");
    ownerB = await makeOwner("b");
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  // ── THE WORST THING: ANOTHER EMAIL AFTER "SPAM", OR ONE GYM'S REPORT ACTING ON ANOTHER ──

  it(
    "a lead who marks gym A's email as spam gets nothing more from gym A — even once A is started again — while the same person at gym B is untouched",
    async () => {
      const gymA = await makeGym(ownerA, "Spam Report Gym A");
      const gymB = await makeGym(ownerB, "Spam Report Gym B");
      ourGyms.push(gymA, gymB);
      const priyaA = await addLead(gymA, ownerA, "priya");
      const kitA = await addLead(gymA, ownerA, "kit");
      const priyaB = await addLead(gymB, ownerB, "priya");

      await runSender();
      expect(emailsTo("priya")).toHaveLength(2);
      expect(emailsTo("kit")).toHaveLength(1);
      const toPriyaA = outbox.find((sent) => sent.message.to === personAddr("priya") && sent.message.subject.includes("Gym A"));
      if (toPriyaA === undefined) throw new Error("gym A's email to Priya did not go");

      // Priya marks gym A's email as spam.
      await reportOn(toPriyaA, "email.complained", "complained");
      await processAll();

      expect(await resultOf(toPriyaA.providerId)).toBe("complained");
      expect(await suppressionsOf("priya")).toEqual([{ gym_id: gymA, reason: "complained" }]);
      // Her tick at gym A comes off, and the panel says she asked to stop.
      expect((await storedLead(priyaA.id))?.ok).toBeNull();
      const panel = (await readLead(gymA, priyaA.id, ownerA)).followUp;
      expect(panel.optedOutAt).not.toBeNull();
      // A complaint in a gym's first 100 stops it, and the operator is told which gym.
      expect(await stoppedReason(gymA)).toBe("complaint");
      expect(toldOperator.map((stopped) => stopped.gymId)).toEqual([gymA]);
      // Gym B: nothing changed, not the lead, not its standing.
      expect((await storedLead(priyaB.id))?.ok).not.toBeNull();
      expect(await stoppedReason(gymB)).toBeNull();
      expect(await gymCounts(sql, gymB)).toEqual({ sent: 1, bounced: 0, complainedEarly: false });

      // Days pass and gym A is started again after a look; staff tick Priya again at the
      // desk. Kit's next email goes; Priya's never does, from gym A. Gym B's does.
      expect(await resumeGym(sql, gymA, new Date())).toBe(true);
      expect((await send("PATCH", `/v1/orgs/${gymA}/leads/${priyaA.id}`, { mayEmail: true }, ownerA)).statusCode).toBe(200);
      for (const lead of [priyaA.id, kitA.id, priyaB.id]) await daysPass(lead, 3);
      const before = outbox.length;
      await runSender();
      await runSender();
      const after = outbox.slice(before).map((sent) => `${sent.message.to} ${sent.message.subject}`);
      expect(after.filter((line) => line.startsWith(personAddr("kit")))).toHaveLength(1);
      expect(after.filter((line) => line.startsWith(personAddr("priya")))).toEqual([
        `${personAddr("priya")} ${lastTo("priya").message.subject}`,
      ]);
      expect(lastTo("priya").message.subject).toContain("Gym B");
      expect((await readLead(gymA, priyaA.id, ownerA)).followUp).toMatchObject({ by: "you", notSent: "complained" });
    },
    TIMEOUT_MS,
  );

  it(
    "a hard bounce on a lead's email keeps that address from every gym and counts toward the gym's stop together with its invitations",
    async () => {
      const gymA = await makeGym(ownerA, "Bounce Gym A");
      const gymB = await makeGym(ownerB, "Bounce Gym B");
      ourGyms.push(gymA, gymB);
      const anaA = await addLead(gymA, ownerA, "ana");
      const anaB = await addLead(gymB, ownerB, "ana");
      await addLead(gymA, ownerA, "bo");
      const before = outbox.length;
      await runSender();
      const toAnaA = outbox.slice(before).find((sent) => sent.message.to === personAddr("ana") && sent.message.subject.includes("Gym A"));
      if (toAnaA === undefined) throw new Error("gym A's email to Ana did not go");

      await reportOn(toAnaA, "email.bounced", "bounced", "Permanent");
      await processAll();

      expect(await resultOf(toAnaA.providerId)).toBe("bounced");
      expect(await suppressionsOf("ana")).toEqual([{ gym_id: null, reason: "bounced" }]);
      // A dead address is not a "stop": the tick stays, the panel says it bounces.
      expect((await storedLead(anaA.id))?.ok).not.toBeNull();
      expect((await readLead(gymA, anaA.id, ownerA)).followUp).toMatchObject({ by: "you", notSent: "bounced" });
      expect((await readLead(gymB, anaB.id, ownerB)).followUp).toMatchObject({ by: "you", notSent: "bounced" });
      // One bounce in gym A's first 50 does not stop it; gym B sent the other one and has none.
      expect(await gymCounts(sql, gymA)).toEqual({ sent: 2, bounced: 1, complainedEarly: false });
      expect(await stoppedReason(gymA)).toBeNull();
      expect(await gymCounts(sql, gymB)).toEqual({ sent: 1, bounced: 0, complainedEarly: false });

      // A second bounce, this time an invitation of the same gym: the two count together.
      const invitation = await seedInvitationSent(gymA, "cy");
      resendRecords.set(invitation, "bounced");
      expect((await report("email.bounced", invitation, { tag: resendTags.get(invitation)?.[0]?.value ?? null, tagName: "invite_send", bounceType: "Permanent" })).statusCode).toBe(200);
      await processAll();
      expect(await gymCounts(sql, gymA)).toEqual({ sent: 3, bounced: 2, complainedEarly: false });
      expect(await stoppedReason(gymA)).toBe("bounces");
      expect(await stoppedReason(gymB)).toBeNull();
    },
    TIMEOUT_MS,
  );

  it(
    "a report nobody at Resend sent, or that Resend's record does not bear out, or that names another email, changes nothing",
    async () => {
      const gym = await makeGym(ownerA, "Forged Report Gym");
      ourGyms.push(gym);
      const dee = await addLead(gym, ownerA, "dee");
      await addLead(gym, ownerA, "eli");
      await runSender();
      const toDee = lastTo("dee");
      const toEli = lastTo("eli");

      // Signed with somebody else's key: refused, nothing kept.
      const forged = await report("email.complained", toDee.providerId, { tag: tagOf(toDee), secret: OTHER_SECRET });
      expect(forged.statusCode).toBe(401);
      // Signed, but Resend's own record says it was delivered and nothing more.
      resendRecords.set(toDee.providerId, "delivered");
      expect((await report("email.complained", toDee.providerId, { tag: tagOf(toDee) })).statusCode).toBe(200);
      // Signed, Resend's record says complained, but the tag names Eli's email while the id is Dee's.
      resendRecords.set(toDee.providerId, "complained");
      resendTags.set(toDee.providerId, toDee.message.tags);
      expect((await report("email.complained", toDee.providerId, { tag: tagOf(toEli) })).statusCode).toBe(200);
      resendRecords.set(toDee.providerId, "delivered");
      await processAll();

      expect((await storedLead(dee.id))?.ok).not.toBeNull();
      expect(await suppressionsOf("dee")).toEqual([]);
      expect(await suppressionsOf("eli")).toEqual([]);
      expect(await resultOf(toEli.providerId)).toBeNull();
      expect(await stoppedReason(gym)).toBeNull();
      expect(await gymCounts(sql, gym)).toEqual({ sent: 2, bounced: 0, complainedEarly: false });
    },
    TIMEOUT_MS,
  );

  it(
    "the same report twice, and the same event under two deliveries, is acted on once; a report with no tag is found by Resend's id",
    async () => {
      const gym = await makeGym(ownerA, "Twice Report Gym");
      ourGyms.push(gym);
      await addLead(gym, ownerA, "fay");
      await addLead(gym, ownerA, "gus");
      await runSender();
      const toFay = lastTo("fay");
      const toGus = lastTo("gus");

      resendRecords.set(toFay.providerId, "bounced");
      const id = `msg_leadrep_${randomUUID()}`;
      expect((await report("email.bounced", toFay.providerId, { tag: tagOf(toFay), id, bounceType: "Permanent" })).statusCode).toBe(200);
      expect((await report("email.bounced", toFay.providerId, { tag: tagOf(toFay), id, bounceType: "Permanent" })).statusCode).toBe(200);
      expect((await report("email.bounced", toFay.providerId, { tag: tagOf(toFay), bounceType: "Permanent" })).statusCode).toBe(200);
      // Gus's report carries no tag at all.
      resendRecords.set(toGus.providerId, "delivered");
      expect((await report("email.delivered", toGus.providerId, { tag: null })).statusCode).toBe(200);
      await Promise.all([processAll(), processAll()]);

      expect(await resultOf(toFay.providerId)).toBe("bounced");
      expect(await resultOf(toGus.providerId)).toBe("delivered");
      expect(await suppressionsOf("fay")).toEqual([{ gym_id: null, reason: "bounced" }]);
      expect(await gymCounts(sql, gym)).toEqual({ sent: 2, bounced: 1, complainedEarly: false });
      expect(toldOperator.filter((stopped) => stopped.gymId === gym)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "a complaint that arrives after staff changed the lead's address and ticked it again stops the old address only, and leaves the new tick alone",
    async () => {
      const gym = await makeGym(ownerA, "Moved Address Gym");
      ourGyms.push(gym);
      const hal = await addLead(gym, ownerA, "hal");
      await runSender();
      const toHal = lastTo("hal");
      expect((await send("PATCH", `/v1/orgs/${gym}/leads/${hal.id}`, { email: `new.${personAddr("hal")}`, mayEmail: true }, ownerA)).statusCode).toBe(200);

      await reportOn(toHal, "email.complained", "complained");
      await processAll();

      expect(await suppressionsOf("hal")).toEqual([{ gym_id: gym, reason: "complained" }]);
      expect((await storedLead(hal.id))?.ok).not.toBeNull();
    },
    TIMEOUT_MS,
  );

  it(
    "a report on an email the sender could not confirm, which Resend shows went, makes it sent and acts on it",
    async () => {
      const gym = await makeGym(ownerA, "Went After All Gym");
      ourGyms.push(gym);
      await addLead(gym, ownerA, "ivy");
      await runSender();
      const toIvy = lastTo("ivy");
      // As the sender leaves an email whose answer never came: "couldn't confirm", no id.
      await sql`
        UPDATE gym_lead_sends SET state = 'failed', reason = 'send_unknown', provider_id = NULL
        WHERE provider_id = ${toIvy.providerId}`;
      await reportOn(toIvy, "email.bounced", "bounced", "Permanent");
      await processAll();

      const row = (await sql<{ state: string; provider_id: string | null; result: string | null }[]>`
        SELECT state, provider_id, result FROM gym_lead_sends WHERE provider_id = ${toIvy.providerId}`)[0];
      expect(row).toEqual({ state: "sent", provider_id: toIvy.providerId, result: "bounced" });
      expect(await suppressionsOf("ivy")).toEqual([{ gym_id: null, reason: "bounced" }]);
    },
    TIMEOUT_MS,
  );

  it(
    "the webhook keeps a lead report's tag and never the address or subject",
    async () => {
      const gym = await makeGym(ownerA, "Kept Report Gym");
      ourGyms.push(gym);
      await addLead(gym, ownerA, "jon");
      await runSender();
      const toJon = lastTo("jon");
      const id = `msg_leadrep_${randomUUID()}`;
      expect((await report("email.delivered", toJon.providerId, { tag: tagOf(toJon), id })).statusCode).toBe(200);
      const kept = (await sql<{ payload: unknown }[]>`SELECT payload FROM webhook_events WHERE provider = 'resend' AND event_id = ${id}`)[0];
      expect(kept?.payload).toEqual({
        type: "email.delivered",
        emailId: toJon.providerId,
        sendId: null,
        leadSendId: tagOf(toJon),
        bounceType: null,
        bounceSubType: null,
      });
      expect(JSON.stringify(kept?.payload)).not.toContain("example.com");
    },
    TIMEOUT_MS,
  );
});
