// Play one Resend report on a lead's follow-up against a LOCAL database, and act on it
// as the worker does (ROADMAP 20c-v-b) — for a click-through, where Resend cannot reach
// the dev servers. It takes the newest follow-up the app sent to that address (run
// `tools/lead-emails-once.ts` first), keeps a report for it, and runs the report worker
// with Resend's record agreeing.
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/lead-report-once.ts <address> bounce|spam
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { LEAD_SEND_TAG } from "@app/shared";
import { loadConfig } from "../src/config.js";
import type { EmailRecordReader } from "../src/email/resend.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { processInviteResults } from "../src/modules/orgs/invites/results.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { keepEvent } from "../src/modules/webhooks/repo.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("a LOCAL database only");
const [address, kind] = process.argv.slice(2);
if (address === undefined || (kind !== "bounce" && kind !== "spam")) throw new Error("usage: lead-report-once.ts <address> bounce|spam");

const config = loadConfig({
  NODE_ENV: "development",
  DATABASE_URL: url,
  WEB_ORIGIN: process.env["WEB_ORIGIN"] ?? "http://127.0.0.1:5174",
  JWT_SECRET: process.env["JWT_SECRET"] ?? "dev-smoke-secret-not-a-real-one-32chars", // dummy local value, gitleaks:allow
  LOG_LEVEL: "error",
});
const settings = inviteSettings(config);
if (settings === null) throw new Error("invitations are off in this config");

const sql = postgres(url, { prepare: false, max: 2 });
try {
  const rows = await sql<{ id: string; provider_id: string | null }[]>`
    SELECT id, provider_id FROM gym_lead_sends
    WHERE email_hmac = ${emailHmac(settings.hmacKey, address)} AND state = 'sent'
    ORDER BY finished_at DESC, id
    LIMIT 1`;
  const send = rows[0];
  if (send === undefined) throw new Error(`the app has sent no follow-up to ${address} on this database`);
  // The one-shot sender has no Resend id to keep: give the email one, as Resend would have.
  const emailId = send.provider_id ?? `re_local_${send.id}`;
  if (send.provider_id === null) await sql`UPDATE gym_lead_sends SET provider_id = ${emailId} WHERE id = ${send.id}`;

  const eventId = `msg_local_${randomUUID()}`;
  await keepEvent(sql, {
    provider: "resend",
    eventId,
    payload: {
      type: kind === "bounce" ? "email.bounced" : "email.complained",
      emailId,
      sendId: null,
      leadSendId: send.id,
      bounceType: kind === "bounce" ? "Permanent" : null,
      bounceSubType: kind === "bounce" ? "General" : null,
    },
  });
  const reader: EmailRecordReader = {
    read: () =>
      Promise.resolve({ kind: "found", lastEvent: kind === "bounce" ? "bounced" : "complained", tags: [{ name: LEAD_SEND_TAG, value: send.id }] }),
  };
  const run = await processInviteResults({
    sql,
    log: {
      info: () => undefined,
      warn: (obj, msg) => {
        console.warn(msg, obj);
      },
      error: (obj, msg) => {
        console.error(msg, obj);
      },
    },
    reader,
    hmacKey: settings.hmacKey,
    tellOperator: (stopped) => {
      console.log(`The operator would be emailed: ${stopped.gymName}'s emails were stopped (${stopped.reason}).`);
      return Promise.resolve();
    },
    now: () => new Date(),
    sleep: () => Promise.resolve(),
    eventIds: [eventId],
  });
  console.log(`${kind === "bounce" ? "A bounce" : "A spam report"} on the newest follow-up to ${address}: ${run.applied === 1 ? "acted on" : JSON.stringify(run)}`);
} finally {
  await sql.end({ timeout: 5 });
}
