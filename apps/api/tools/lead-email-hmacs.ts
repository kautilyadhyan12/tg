// Fill `gym_leads.email_hmac` for leads written before it existed (ROADMAP 20c-v-b;
// migration 0052): the Leads list finds a lead's email problems by it. The app writes it
// with every address from then on; this is run once per database that already holds
// leads, with the same invitation key the api uses. Safe to run again: it fills only
// the empty ones, a thousand at a time.
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/lead-email-hmacs.ts
//
// The key comes from INVITE_HMAC_SECRET, as `loadConfig` gives it to the api. Without it
// the development key is used, which a live server does not, so the tool refuses to run
// on any database but a local one; it fills only empty keys, so a wrong fill would stay.
// The deploy step is `RUNBOOK/fill-lead-email-keys.md`.
import postgres from "postgres";
import { loadConfig } from "../src/config.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { fillLeadEmailHmacs } from "../src/modules/orgs/leads/repo.js";

const url = process.env["DATABASE_URL"] ?? "";
if (url === "") throw new Error("DATABASE_URL is required");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
if (!local && (process.env["INVITE_HMAC_SECRET"] ?? "") === "") {
  throw new Error("INVITE_HMAC_SECRET must be set, the same as the api's, for any database that is not local");
}

const config = loadConfig({
  ...process.env,
  NODE_ENV: process.env["NODE_ENV"] ?? "development",
  DATABASE_URL: url,
  WEB_ORIGIN: process.env["WEB_ORIGIN"] ?? "http://127.0.0.1:5174",
  JWT_SECRET: process.env["JWT_SECRET"] ?? "dev-smoke-secret-not-a-real-one-32chars", // dummy local value, gitleaks:allow
  LOG_LEVEL: "error",
});
const settings = inviteSettings(config);
if (settings === null) throw new Error("invitations are off in this config: there is no key to write");

const sql = postgres(url, { prepare: false, max: 2 });
try {
  let filled = 0;
  for (;;) {
    const batch = await fillLeadEmailHmacs(sql, settings.hmacKey);
    if (batch.read === 0) break;
    filled += batch.filled;
  }
  console.log(`Leads given their address key: ${String(filled)}`);
} finally {
  await sql.end({ timeout: 5 });
}
