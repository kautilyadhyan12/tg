// Runs our calls to Square against Square's real test area (ROADMAP 18d-i; CLAUDE.md §6:
// "reviewed by RUNNING the company's real sandbox"). Prints what Square answered, never a
// token, code or secret.
//
// With no gym named it checks the doors: a code Square never issued, a token it never
// issued and a revoke of one are each refused, in the shapes the adapter reads. Naming a
// gym whose owner pressed Allow in the console, it asks Square about that gym's connection
// (the token works, for that account; the business; its locations), then renews it through
// the worker's own path, as the worker would six days on, and checks the new token works.
//
//   cd apps/api
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm exec node --env-file=.env.square.local --import tsx tools/square-sandbox-check.ts [gymId]
import postgres from "postgres";
import { z } from "zod";
import * as repo from "../src/modules/orgs/payments/repo.js";
import { accessContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    SQUARE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    SQUARE_APPLICATION_ID: z.string().regex(/^sandbox-sq0idb-[A-Za-z0-9_-]{10,60}$/),
    SQUARE_APPLICATION_SECRET: z.string().regex(/^sandbox-sq0csb-[A-Za-z0-9_-]{10,100}$/),
    PAYMENT_TOKENS_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .refine((e) => e.SQUARE_ENV === "sandbox", { message: "the test area only" })
  .safeParse(process.env);
if (!env.success) {
  console.error("Needs DATABASE_URL, and Square's test-area SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET and PAYMENT_TOKENS_KEY (.env.square.local). Secrets are never printed.");
  process.exit(1);
}

const square = squareSettings({ ...env.data, SQUARE_WEBHOOK_SIGNATURE_KEY: undefined, SQUARE_WEBHOOK_URL: undefined });
if (square === null) throw new Error("Square settings did not load");
const gymId = process.argv[2];
let problems = 0;
const check = (ok: boolean, line: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) problems += 1;
};

const neverIssued = "EAAAnever-issued-0000000000000000000000000000000000000000000000";
const code = await square.api.exchangeCode("sq0cgb-never-issued-000000000000");
check(code.kind === "refused", `a code Square never issued: ${code.kind}${code.kind === "refused" ? ` ${String(code.status)} ${code.code}` : ""}`);
const status = await square.api.tokenStatus(neverIssued);
check(status.kind === "refused" && status.status === 401, `a token Square never issued: ${status.kind}${status.kind === "refused" ? ` ${String(status.status)} ${status.code}` : ""}`);
const revoke = await square.api.revoke(neverIssued, false);
check(revoke.kind === "refused", `a revoke of it: ${revoke.kind}${revoke.kind === "refused" ? ` ${String(revoke.status)} ${revoke.code}` : ""}`);
const page = new URL(square.api.authorizeUrl("x"));
check(page.origin === "https://connect.squareupsandbox.com", `Square's own page: ${page.origin}${page.pathname}`);

if (gymId !== undefined) {
  const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });
  try {
    const row = await repo.readConnection(sql, gymId, "sandbox");
    if (row === null || row.state !== "connected" || row.accessToken === null) {
      check(false, "that gym has no Square connection here");
    } else {
      const token = square.tokens.open(row.accessToken, accessContext(gymId));
      check(token !== null, "its token opens under its own gym");
      if (token !== null) {
        const works = await square.api.tokenStatus(token);
        check(works.kind === "ok" && works.value.merchant_id === row.accountId, `its token works, for the account it was kept with: ${works.kind}`);
        const merchant = await square.api.merchant(token);
        check(merchant.kind === "ok", merchant.kind === "ok" ? `the business: ${merchant.value.country}, ${merchant.value.currency}, named ${merchant.value.business_name === undefined ? "nothing" : "as kept"}` : `the business: ${merchant.kind}`);
        const locations = await square.api.locations(token);
        check(locations.kind === "ok", locations.kind === "ok" ? `its locations: ${String(locations.value.length)}, ${String(locations.value.filter((l) => (l.capabilities ?? []).includes("CREDIT_CARD_PROCESSING")).length)} taking cards` : `its locations: ${locations.kind}`);
      }
      // Renewed through the worker's own path, as six days on.
      await sql`UPDATE gym_payment_connections SET refresh_due_at = now() - interval '1 second' WHERE gym_id = ${gymId} AND provider = 'square'`;
      const run = await processSquareWork({ sql, square, log: { info: () => undefined, warn: () => undefined, error: (o, m) => {
        console.error(m, o);
      } }, now: () => new Date() });
      const after = await repo.readConnection(sql, gymId, "sandbox");
      check(run.renewed >= 1 && after?.accessToken !== row.accessToken, `renewed by the worker: ${String(run.renewed)} renewed, ${String(run.renewalsWaiting)} waiting, ${String(run.removed)} removed`);
      const renewed = after?.accessToken === null || after === null ? null : square.tokens.open(after.accessToken, accessContext(gymId));
      if (renewed !== null) {
        const works = await square.api.tokenStatus(renewed);
        check(works.kind === "ok", `the renewed token works: ${works.kind}`);
      }
    }
  } finally {
    await sql.end();
  }
}

console.log(problems === 0 ? "All checks passed." : `${String(problems)} checks failed.`);
process.exit(problems === 0 ? 0 : 1);
