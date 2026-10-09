// Posts the result of every challenge that has ended and has no post yet, now, instead of
// waiting for the worker's next run (every fifteen minutes). A second run writes nothing.
//
//   corepack pnpm --filter api exec tsx tools/challenge-results.ts
import pino from "pino";
import postgres from "postgres";
import { z } from "zod";
import { postChallengeResults } from "../src/modules/orgs/challenges/resultPosts.js";

const env = z.object({ DATABASE_URL: z.string().url(), LOG_LEVEL: z.string().optional() }).safeParse(process.env);
if (!env.success) {
  console.error("Missing env: DATABASE_URL. (secrets never printed)");
  process.exit(1);
}

const log = pino({ level: env.data.LOG_LEVEL ?? "info" });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });

try {
  const result = await postChallengeResults({ sql, log });
  log.info(result, "challenge results finished");
  await sql.end();
  process.exit(0);
} catch (err) {
  log.fatal({ errName: err instanceof Error ? err.name : typeof err }, "challenge results run failed");
  await sql.end();
  process.exit(1);
}
