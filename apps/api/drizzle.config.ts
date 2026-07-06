// Drizzle Kit config (build-time tool; env parsed here per R2.3 — the API's
// boot-time config object arrives with P0.4 and this stays tool-only).
import { defineConfig } from "drizzle-kit";
import { z } from "zod";

const env = z
  .object({ DATABASE_URL: z.string().url() })
  // generate/check don't need a DB; migrate does and fails loudly without it.
  .partial()
  .parse(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
