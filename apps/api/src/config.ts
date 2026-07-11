// Env → typed config, parsed ONCE at boot (R2.3). process.env is read only here
// (and in drizzle.config.ts, a build-time tool). Fail-fast: bad env = no boot.
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(), // exact origin for CORS-with-credentials (Part IV #6)
  SENTRY_DSN: z.string().url().optional(),
  POSTHOG_API_KEY: z.string().min(1).optional(),
  POSTHOG_HOST: z.string().url().default("https://app.posthog.com"),
  // P1.10d auth seam (DECISIONS 2026-07-10): when set (dev/test ONLY), sync
  // requests authenticate as this user; unset = the route answers 401 and
  // stays dark until P2.1 wires real cookie authn.
  SYNC_DEV_USER_ID: z.string().uuid().optional(),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  // Seam gate checks the RAW env, not the parsed value: NODE_ENV defaults to
  // "development" when omitted, so a prod box that forgot to set it must NOT
  // silently honor the seam — allowed only when dev/test is EXPLICIT
  // (P1.10d T3 finding; R3.3).
  if (
    parsed.data.SYNC_DEV_USER_ID !== undefined &&
    env["NODE_ENV"] !== "development" &&
    env["NODE_ENV"] !== "test"
  ) {
    throw new Error(
      "Invalid environment: SYNC_DEV_USER_ID requires an EXPLICIT NODE_ENV of development or test (R3.3)",
    );
  }
  return Object.freeze(parsed.data);
}
