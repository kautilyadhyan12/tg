// Stops one gym's Square connection, or every gym's, from our side (ROADMAP 18d-ii;
// RUNBOOK/stop-square.md). Takes back only our app's permission at the gym's Square account;
// the account and its money stay the gym's. Without --yes it only says what it would stop.
//
//   cd apps/api
//   $env:DATABASE_URL='<the environment's database>'
//   corepack pnpm exec node --env-file=<Square's keys> --import tsx tools/square-stop.ts --gym <gymId> [--yes]
//   corepack pnpm exec node --env-file=<Square's keys> --import tsx tools/square-stop.ts --all [--yes]
//
// Prints each Square account and the gyms holding it, never a token or secret.
import postgres from "postgres";
import { z } from "zod";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { stopSquare } from "../src/modules/orgs/payments/stop.js";

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    // Named, never assumed: run against production with it unset, a default would stop nothing.
    SQUARE_ENV: z.enum(["sandbox", "production"]),
    SQUARE_APPLICATION_ID: z.string().regex(/^(sandbox-)?sq0id[bp]-[A-Za-z0-9_-]{10,60}$/),
    SQUARE_APPLICATION_SECRET: z.string().regex(/^(sandbox-)?sq0cs[bp]-[A-Za-z0-9_-]{10,100}$/),
    PAYMENT_TOKENS_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .refine((e) => e.SQUARE_APPLICATION_ID.startsWith("sandbox-") === (e.SQUARE_ENV === "sandbox"), { message: "SQUARE_ENV is not the environment of the application id" })
  .safeParse(process.env);
if (!env.success) {
  console.error("Needs DATABASE_URL, SQUARE_ENV (sandbox or production, matching the application id), SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET and PAYMENT_TOKENS_KEY. Secrets are never printed.");
  process.exit(1);
}

const args = process.argv.slice(2);
const gymAt = args.indexOf("--gym");
const gymId = gymAt === -1 ? null : (args[gymAt + 1] ?? "");
const all = args.includes("--all");
const apply = args.includes("--yes");
if ((gymId === null) === !all || (gymId !== null && !z.string().uuid().safeParse(gymId).success)) {
  console.error("Name one gym (--gym <gymId>) or every gym (--all). Add --yes to stop; without it nothing changes.");
  process.exit(1);
}

const square = squareSettings({ ...env.data, SQUARE_WEBHOOK_SIGNATURE_KEY: undefined, SQUARE_WEBHOOK_URL: undefined });
if (square === null) throw new Error("Square settings did not load");
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });
const log = {
  info: () => undefined,
  warn: () => undefined,
  error: (obj: object, msg: string) => {
    console.error(msg, JSON.stringify(obj));
  },
};
try {
  const report = await stopSquare({ sql, square, log, now: () => new Date() }, square, gymId, apply);
  if (report.length === 0) console.log(`No connected Square account ${gymId === null ? `in ${square.environment}` : "for that gym"}.`);
  for (const account of report) {
    console.log(`${account.outcome.padEnd(11)} Square account ${account.accountId} (${square.environment})`);
    for (const g of account.gyms) console.log(`            ${g.gymId}  ${g.name}`);
  }
  if (!apply && report.length > 0) console.log("Nothing was changed. Run again with --yes to stop these.");
  process.exitCode = report.some((a) => a.outcome === "refused" || a.outcome === "unavailable") ? 1 : 0;
} finally {
  await sql.end();
}
