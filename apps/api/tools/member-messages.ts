// Sends every automatic message that is due, now, instead of waiting for the worker's next
// run (every fifteen minutes). A second run writes nothing.
//
//   corepack pnpm --filter api exec tsx tools/member-messages.ts
import pino from "pino";
import postgres from "postgres";
import { z } from "zod";
import { sendDueMessages } from "../src/modules/orgs/messages/send.js";

const env = z.object({ DATABASE_URL: z.string().url(), LOG_LEVEL: z.string().optional() }).safeParse(process.env);
if (!env.success) {
  console.error("Missing env: DATABASE_URL. (secrets never printed)");
  process.exit(1);
}

const log = pino({ level: env.data.LOG_LEVEL ?? "info" });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });

try {
  const result = await sendDueMessages({ sql, log });
  log.info(result, "member messages finished");
  await sql.end();
  process.exit(0);
} catch (err) {
  log.fatal({ errName: err instanceof Error ? err.name : typeof err }, "member messages run failed");
  await sql.end();
  process.exit(1);
}
