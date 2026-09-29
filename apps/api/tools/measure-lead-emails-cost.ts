// What "Send them for me" costs the server at the biggest size (ROADMAP 20c-v-a;
// CLAUDE.md §4, cost at full size): a gym with 10,000 leads, every one ticked and due.
// For each thing staff do — open Leads, open "Email due", open a lead, save the switch —
// and for the worker's run, how long it takes and how long the server answers NOBODY
// meanwhile (the event loop's longest stall). Against a LOCAL database only:
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/measure-lead-emails-cost.ts
//
// LEADS=200 in the environment measures a smaller gym (the launch shape).
//
// It makes its own owner and gym (`lcost-*`) and deletes them after.
import { monitorEventLoopDelay } from "node:perf_hooks";
import postgres from "postgres";
import { LEADS_MAX_PER_GYM } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { InviteTransport } from "../src/email/resend.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { sendDueLeadEmails } from "../src/modules/orgs/leads/sender.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("a LOCAL database only");
const RUNS = 3;
const LEADS = Number(process.env["LEADS"] ?? LEADS_MAX_PER_GYM);
if (!Number.isInteger(LEADS) || LEADS < 1 || LEADS > LEADS_MAX_PER_GYM) throw new Error(`LEADS must be 1 to ${String(LEADS_MAX_PER_GYM)}`);

const env = { NODE_ENV: "test", DATABASE_URL: url, WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "lead-cost-secret-0123456789abcdefgh", LOG_LEVEL: "error" }; // dummy local value, gitleaks:allow
const sql = postgres(url, { prepare: false, max: 4 });
const app = await buildApp(loadConfig(env), {
  emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
});
await app.ready();
const settings = inviteSettings(loadConfig(env));
if (settings?.sender == null) throw new Error("invitations are off in this config");
const sender = settings.sender;

const cleanup = async () => {
  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'lcost-%@example.com')`;
  await sql`DELETE FROM gym_lead_sends WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_lead_email_settings WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gyms WHERE id IN (${mine})`;
  await sql`DELETE FROM users WHERE email LIKE 'lcost-%@example.com'`;
};

let ip = 0;
const inject = (method: "GET" | "POST" | "PUT" | "PATCH", path: string, payload?: unknown, cookies: Record<string, string> = {}) =>
  app.inject({
    method,
    url: path,
    remoteAddress: `10.98.0.${String((ip++ % 250) + 1)}`,
    cookies,
    ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
  });

/** Runs `work`, returning its time and the event loop's longest stall meanwhile. */
async function measure<T>(work: () => Promise<T>): Promise<{ ms: number; stallMs: number; value: T }> {
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  const start = process.hrtime.bigint();
  const value = await work();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  h.disable();
  return { ms, stallMs: h.max / 1e6, value };
}

const range = (xs: number[]) => `${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)} ms`;
async function report(label: string, work: () => Promise<unknown>): Promise<void> {
  const times: number[] = [];
  const stalls: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const { ms, stallMs } = await measure(work);
    times.push(ms);
    stalls.push(stallMs);
  }
  console.log(`${label}: ${range(times)}, answering nobody at most ${Math.max(...stalls).toFixed(0)} ms`);
}

const transport: InviteTransport = { send: () => Promise.resolve({ kind: "sent", id: null }) };

try {
  await cleanup();
  const email = `lcost-${Date.now().toString(36)}@example.com`;
  await inject("POST", "/v1/auth/register", { email, password: "a-Perfectly-fine-pw-1", displayName: "Cost" }); // gitleaks:allow
  const login = await inject("POST", "/v1/auth/login", { email, password: "a-Perfectly-fine-pw-1" }); // gitleaks:allow
  const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
  const created = JSON.parse((await inject("POST", "/v1/orgs", { name: "Lead Cost Gym", city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies)).body) as {
    org: { id: string };
  };
  const gymId = created.org.id;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE audience = 'org' ORDER BY rank LIMIT 1), 'trialing', 'pilot')`;
  await inject("PATCH", `/v1/orgs/${gymId}`, { postalAddress: "12 Kirkgate, Leeds" }, cookies);
  await inject("PUT", `/v1/orgs/${gymId}/leads/email-settings`, { sendForMe: true, replyTo: "desk@example.com" }, cookies);
  // The most leads a gym may keep, every one New, ticked and due today.
  await sql`
    INSERT INTO gym_leads (gym_id, full_name, email, source, email_ok_at, follow_up_due_on)
    SELECT ${gymId}, 'Lead ' || n, 'lcost-lead-' || n || '@example.com', 'website', now(), (now() AT TIME ZONE 'Europe/London')::date
    FROM generate_series(1, ${LEADS}) AS n`;
  await sql`ANALYZE gym_leads`;
  const leadId = (await sql<{ id: string }[]>`SELECT id FROM gym_leads WHERE gym_id = ${gymId} LIMIT 1`)[0]?.id ?? "";
  const midday = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const run = (perRun: number) =>
    sendDueLeadEmails({
      sql,
      log: { info: () => undefined, warn: () => undefined },
      settings,
      sender,
      transport,
      mailDomain: () => Promise.resolve("accepts"),
      now: () => midday,
      sleep: () => Promise.resolve(),
      limits: { perRun },
      gymIds: [gymId],
    });

  console.log(`${String(LEADS)} leads, all due, switch on:`);
  await report("  open Leads (a page of 100), the month with room", () => inject("GET", `/v1/orgs/${gymId}/leads`, undefined, cookies));
  await report("  open Email due, the month with room (none are staff's)", () => inject("GET", `/v1/orgs/${gymId}/leads?followUp=due`, undefined, cookies));
  await report("  open one lead", () => inject("GET", `/v1/orgs/${gymId}/leads/${leadId}`, undefined, cookies));
  await report("  Settings: read the switch", () => inject("GET", `/v1/orgs/${gymId}/leads/email-settings`, undefined, cookies));
  await report("  Settings: save the switch", () => inject("PUT", `/v1/orgs/${gymId}/leads/email-settings`, { sendForMe: true, replyTo: "desk@example.com" }, cookies));

  // The worker: one run of the month's 100 first emails, then the month full.
  const first = await measure(() => run(120));
  console.log(`  worker: a run sending the month's ${String(first.value.sent)} emails: ${first.ms.toFixed(0)} ms, the worker answering nobody at most ${first.stallMs.toFixed(0)} ms`);
  await report("  worker: a run with the month full (every due lead looked at, none taken)", () => run(120));
  await report("  open Leads, the month full", () => inject("GET", `/v1/orgs/${gymId}/leads`, undefined, cookies));
  await report(`  open Email due, the month full (${String(Math.max(LEADS - 100, 0))} are staff's)`, () => inject("GET", `/v1/orgs/${gymId}/leads?followUp=due`, undefined, cookies));
} finally {
  await cleanup();
  await app.close();
  await sql.end({ timeout: 5 });
}
