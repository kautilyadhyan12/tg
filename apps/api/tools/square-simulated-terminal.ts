// Adds one of Square's simulated Terminals to a test gym (ROADMAP 18d-ii-b-i), in Square's sandbox
// only: no real Terminal can sign in there, and the console's Payments box is the same as a real
// gym's (Kd, 2026-10-21), so a tester's simulated Terminal is added here, never from a screen. It
// then shows in the gym's list, and the owner removes it there like any Terminal. Prints no token.
//
//   cd apps/api
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm exec node --env-file=.env.square.local --import tsx tools/square-simulated-terminal.ts <gymId> <saves|declines|cancels|times_out|offline>
import postgres from "postgres";
import { z } from "zod";
import { squarePracticeTerminalSchema } from "@app/shared";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { addSimulatedTerminal } from "../src/modules/orgs/payments/terminals.js";

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    SQUARE_ENV: z.literal("sandbox"),
    SQUARE_APPLICATION_ID: z.string().regex(/^sandbox-sq0idb-[A-Za-z0-9_-]{10,60}$/),
    SQUARE_APPLICATION_SECRET: z.string().regex(/^sandbox-sq0csb-[A-Za-z0-9_-]{10,100}$/),
    PAYMENT_TOKENS_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .safeParse(process.env);
if (!env.success) {
  console.error("Needs DATABASE_URL, and Square's sandbox SQUARE_ENV, SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET and PAYMENT_TOKENS_KEY (.env.square.local). Secrets are never printed.");
  process.exit(1);
}
const args = z.tuple([z.string().uuid(), squarePracticeTerminalSchema]).safeParse(process.argv.slice(2));
if (!args.success) {
  console.error("Usage: square-simulated-terminal.ts <gymId> <saves|declines|cancels|times_out|offline>");
  process.exit(2);
}
const [gymId, kind] = args.data;

const square = squareSettings({ ...env.data, SQUARE_WEBHOOK_SIGNATURE_KEY: undefined, SQUARE_WEBHOOK_URL: undefined });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 1 });
const log = {
  info: () => undefined,
  warn: () => undefined,
  error: (o: object, m: string) => {
    console.error(m, o);
  },
};
try {
  const added = await addSimulatedTerminal({ sql, square, log, now: () => new Date() }, gymId, kind);
  console.log(added ? `Added the simulated Terminal "${kind}".` : `That gym has the simulated Terminal "${kind}" already.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : "failed");
  process.exitCode = 1;
} finally {
  await sql.end();
}
