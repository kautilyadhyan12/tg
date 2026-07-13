// P2.7b — migration CLI. `tsx tools/migrate-mongo/run.ts [--apply]`.
//   default (dry-run): read Mongo, transform, report counts — writes NOTHING.
//   --apply: idempotent upsert into Postgres (ON CONFLICT DO NOTHING) + verify.
// Env (parsed once, R2.3 spirit): MONGO_URI, DATABASE_URL. Standalone tool —
// its own entrypoint, not the API boot path. Secrets never printed.
import { z } from "zod";
import { connectMongo } from "./mongo.js";
import { connectPg } from "./pg.js";
import { insertUser, transformUser } from "./collections/users.js";
import { verifyBcrypt, verifyUsersCount } from "./verify.js";

const envSchema = z.object({
  MONGO_URI: z.string().min(1),
  DATABASE_URL: z.string().url(),
});

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    console.error("Missing env: MONGO_URI and/or DATABASE_URL. (secrets never printed)");
    process.exit(2);
  }
  const mongo = await connectMongo(env.data.MONGO_URI);
  const sql = connectPg(env.data.DATABASE_URL);
  try {
    let read = 0;
    let transformed = 0;
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    await mongo.each("users", async (doc) => {
      read += 1;
      const row = transformUser(doc);
      if (row === null) {
        skipped += 1;
        console.warn(`skip malformed user (mongo _id ${String(doc["_id"])})`);
        return;
      }
      transformed += 1;
      if (apply) {
        // Per-row fail-soft: a genuine unique collision (e.g. duplicate email)
        // is logged with its _id and counted, never silently dropped and never
        // aborting the whole run (T3 finding 2).
        try {
          inserted += await insertUser(sql, row);
        } catch (e) {
          errors += 1;
          console.error(`insert failed (mongo _id ${String(doc["_id"])}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    });

    console.log(`users: read=${String(read)} transformed=${String(transformed)} skipped=${String(skipped)} inserted=${String(inserted)} errors=${String(errors)} mode=${apply ? "apply" : "dry-run"}`);
    if (errors > 0) process.exitCode = 1;

    if (apply) {
      const count = await verifyUsersCount(mongo, sql);
      const bcrypt = await verifyBcrypt(mongo, sql);
      console.log(`VERIFY count: mongo=${String(count.mongo)} pg=${String(count.pg)} ok=${String(count.ok)}`);
      console.log(`VERIFY bcrypt: sampled=${String(bcrypt.sampled)} intact=${String(bcrypt.intact)} ok=${String(bcrypt.ok)}`);
      if (!count.ok || !bcrypt.ok) {
        console.error("VERIFY FAILED");
        process.exitCode = 1;
      }
    }
  } finally {
    await mongo.close();
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error("migration error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
