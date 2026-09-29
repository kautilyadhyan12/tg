// What Resend's reports on lead follow-ups cost at the biggest size (ROADMAP 20c-v-b;
// CLAUDE.md §4, cost at full size): a gym that has sent 10,000 invitations and a year of
// lead follow-ups (3,600: 300 a month). For the webhook that keeps a report, and for the
// worker acting on one — which reads the gym's counts over all of those under the gym's
// lock — how long it takes and how long the server answers NOBODY meanwhile (the event
// loop's longest stall). Against a LOCAL database only:
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/measure-lead-reports-cost.ts
//
// INVITES=200 LEAD_SENDS=300 in the environment measures a smaller gym (the launch shape).
//
// It makes its own owner and gym (`rcost-*`) and deletes them after.
import { createHmac, randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import postgres from "postgres";
import { LEAD_SEND_TAG } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailRecordReader } from "../src/email/resend.js";
import { gymCounts } from "../src/modules/orgs/invites/repo.js";
import { processInviteResults } from "../src/modules/orgs/invites/results.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { RESEND_WEBHOOK_PATH } from "../src/modules/webhooks/resendRoutes.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("a LOCAL database only");
const RUNS = 3;
const INVITES = Number(process.env["INVITES"] ?? 10_000);
const LEAD_SENDS = Number(process.env["LEAD_SENDS"] ?? 3_600);

const SECRET = "whsec_" + Buffer.from("lead-reports-cost-signing-key-00").toString("base64"); // dummy local value, gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url,
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "report-cost-secret-0123456789abcdef", // dummy local value, gitleaks:allow
  LOG_LEVEL: "error",
  RESEND_WEBHOOK_SECRET: SECRET,
};
const sql = postgres(url, { prepare: false, max: 4 });
const app = await buildApp(loadConfig(env), {
  emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
});
await app.ready();
const settings = inviteSettings(loadConfig(env));
if (settings === null) throw new Error("invitations are off in this config");

const eventIds: string[] = [];
const cleanup = async () => {
  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rcost-%@example.com')`;
  await sql`DELETE FROM webhook_events WHERE provider = 'resend' AND event_id LIKE 'msg_rcost_%'`;
  await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_lead_sends WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gyms WHERE id IN (${mine})`;
  await sql`DELETE FROM users WHERE email LIKE 'rcost-%@example.com'`;
};

const inject = (method: "POST", path: string, payload: unknown, cookies: Record<string, string> = {}) =>
  app.inject({ method, url: path, remoteAddress: "10.97.0.1", cookies, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });

/** Time `work` and the event loop's longest stall while it runs, in milliseconds. */
async function measure(work: () => Promise<unknown>): Promise<{ ms: number; stall: number }> {
  const loop = monitorEventLoopDelay({ resolution: 1 });
  loop.enable();
  const started = performance.now();
  await work();
  const ms = performance.now() - started;
  loop.disable();
  return { ms, stall: loop.max / 1e6 };
}

await cleanup();
try {
  const email = "rcost-owner@example.com";
  if ((await inject("POST", "/v1/auth/register", { email, password: "a-Perfectly-fine-pw-1", displayName: "Cost" })).statusCode !== 201) throw new Error("register"); // gitleaks:allow
  const login = await inject("POST", "/v1/auth/login", { email, password: "a-Perfectly-fine-pw-1" }); // gitleaks:allow
  const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
  const made = await inject("POST", "/v1/orgs", { name: "Report Cost Gym", city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
  const gymId = (JSON.parse(made.body) as { org: { id: string } }).org.id;

  // Everything the gym has sent, as the senders leave it, spread over the last year.
  await sql`
    INSERT INTO gym_invites (gym_id, email_hmac, created_at)
    SELECT ${gymId}, encode(sha256(convert_to('i' || g::text || ${gymId}, 'UTF8')), 'hex'), now() - make_interval(secs => g * 3000)
    FROM generate_series(1, ${INVITES}) g`;
  await sql`
    INSERT INTO gym_invite_sends (gym_id, invite_id, kind, state, not_before, created_at, finished_at, provider_id, result, result_at)
    SELECT ${gymId}, i.id, 'first', 'sent', i.created_at, i.created_at, i.created_at, 're_i_' || i.id::text, 'delivered', i.created_at
    FROM gym_invites i WHERE i.gym_id = ${gymId}`;
  await sql`
    INSERT INTO gym_lead_sends (gym_id, lead_id, ok_at, step, month, counted, email_hmac, state, attempts,
                                not_before, created_at, finished_at, provider_id)
    SELECT ${gymId}, NULL, now() - make_interval(secs => g * 8000), 1, to_char(now(), 'YYYY-MM'), false,
           encode(sha256(convert_to('l' || g::text || ${gymId}, 'UTF8')), 'hex'), 'sent', 1,
           now() - make_interval(secs => g * 8000), now() - make_interval(secs => g * 8000), now() - make_interval(secs => g * 8000),
           're_l_' || g::text || '_' || ${gymId}
    FROM generate_series(1, ${LEAD_SENDS}) g`;
  await sql`ANALYZE gym_invite_sends`;
  await sql`ANALYZE gym_lead_sends`;
  const sends = await sql<{ id: string; provider_id: string }[]>`
    SELECT id, provider_id FROM gym_lead_sends WHERE gym_id = ${gymId} ORDER BY finished_at DESC LIMIT ${RUNS}`;

  const lastEvent = new Map<string, string>();
  const reader: EmailRecordReader = {
    read: (emailId) => {
      const send = sends.find((row) => row.provider_id === emailId);
      return Promise.resolve({
        kind: "found",
        lastEvent: lastEvent.get(emailId) ?? "delivered",
        tags: send === undefined ? [] : [{ name: LEAD_SEND_TAG, value: send.id }],
      });
    },
  };

  console.log(`gym: ${String(INVITES)} invitations and ${String(LEAD_SENDS)} lead follow-ups sent`);
  for (const [i, send] of sends.entries()) {
    const id = `msg_rcost_${randomUUID()}`;
    eventIds.push(id);
    const at = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: send.provider_id, tags: { [LEAD_SEND_TAG]: send.id } } });
    const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
    const signature = "v1," + createHmac("sha256", key).update(`${id}.${String(at)}.${body}`).digest("base64");
    const hook = await measure(async () => {
      const res = await app.inject({
        method: "POST",
        url: RESEND_WEBHOOK_PATH,
        remoteAddress: "44.228.126.217",
        headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(at), "svix-signature": signature },
        payload: body,
      });
      if (res.statusCode !== 200) throw new Error(`webhook ${String(res.statusCode)}`);
    });
    const worker = await measure(async () => {
      const run = await processInviteResults({
        sql,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
        reader,
        hmacKey: settings.hmacKey,
        tellOperator: () => Promise.resolve(),
        now: () => new Date(Date.now() + 1),
        sleep: () => Promise.resolve(),
        eventIds,
      });
      if (run.applied !== 1) throw new Error(`the report was not applied: ${JSON.stringify(run)}`);
    });
    const counts = await measure(async () => await gymCounts(sql, gymId));
    const f = (m: { ms: number; stall: number }) => `${m.ms.toFixed(1)} ms (answering nobody ≤ ${m.stall.toFixed(1)} ms)`;
    console.log(`run ${String(i + 1)}: webhook ${f(hook)} · worker, one report ${f(worker)} · the gym's counts ${f(counts)}`);
  }
} finally {
  await cleanup();
  await app.close();
  await sql.end({ timeout: 5 });
}
