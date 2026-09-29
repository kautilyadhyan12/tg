// Run "Send them for me" once against a LOCAL database, printing each email the app
// would send instead of sending it (ROADMAP 20c-v-a) — for a click-through, where the
// dev servers have no email account and no worker. The clock is now; the gym's sending
// hours apply.
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/lead-emails-once.ts
//
// The printed Stop link points at API_ORIGIN (default http://127.0.0.1:3001, Folder B's api).
import postgres from "postgres";
import { loadConfig } from "../src/config.js";
import type { InviteTransport } from "../src/email/resend.js";
import { cachedMailDomainCheck, systemResolver } from "../src/modules/orgs/invites/mailDomain.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { sendDueLeadEmails } from "../src/modules/orgs/leads/sender.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("a LOCAL database only");
const apiOrigin = process.env["API_ORIGIN"] ?? "http://127.0.0.1:3001";

const config = loadConfig({
  NODE_ENV: "development",
  DATABASE_URL: url,
  WEB_ORIGIN: process.env["WEB_ORIGIN"] ?? "http://127.0.0.1:5174",
  JWT_SECRET: process.env["JWT_SECRET"] ?? "dev-smoke-secret-not-a-real-one-32chars", // dummy local value, gitleaks:allow
  API_ORIGIN: apiOrigin,
  LOG_LEVEL: "error",
});
const settings = inviteSettings(config);
if (settings?.sender == null) throw new Error("invitations are off in this config");

const sql = postgres(url, { prepare: false, max: 2 });
const transport: InviteTransport = {
  send: (message) => {
    console.log("─".repeat(72));
    console.log(`To:       ${message.to}`);
    console.log(`From:     ${message.from === "" ? "{gym} via AI Home Gym <the invitations' mailbox>" : message.from}`);
    console.log(`Reply-To: ${message.replyTo ?? "(none)"}`);
    console.log(`Subject:  ${message.subject}`);
    console.log("");
    console.log(message.text);
    return Promise.resolve({ kind: "sent", id: null });
  },
};

try {
  const run = await sendDueLeadEmails({
    sql,
    log: {
      info: () => undefined,
      warn: (obj, msg) => {
        console.warn(msg, obj);
      },
    },
    settings,
    sender: settings.sender,
    transport,
    mailDomain: cachedMailDomainCheck(systemResolver, () => Date.now()),
    now: () => new Date(),
    sleep: () => Promise.resolve(),
  });
  console.log("─".repeat(72));
  console.log(JSON.stringify(run));
} finally {
  await sql.end({ timeout: 5 });
}
