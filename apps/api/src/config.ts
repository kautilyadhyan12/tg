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
  // P2.1 auth. An unset secret must never silently sign tokens (ported
  // jwtHelper.js fail-loud); 32+ chars so HS256 isn't brute-forceable.
  JWT_SECRET: z.string().min(32),
  // v1 §6.1: "JWT access (15 min) + rotating refresh tokens"; the 30-day
  // refresh lifetime ports the audited backend-auth's JWT_REFRESH_EXPIRES_IN
  // default ('30d', jwtHelper.js:26). Part 0 rule 4: values quoted, not recalled.
  ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // P2.4: quota counters + entitlement cache (v1 §7.2). Optional in dev/test
  // (in-memory adapter); REQUIRED in production — refinement below.
  REDIS_URL: z.string().url().optional(),
  // P2.5b: coach LLM gateway (v1 §6.1 "Groq primary → OpenRouter fallback").
  // GROQ_API_KEY unset = coach feature 503s cleanly, rest of the app runs;
  // OPENROUTER_API_KEY unset = fallback simply not attempted.
  GROQ_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  COACH_MODEL: z.string().min(1).default("llama-3.1-8b-instant"), // salvage default (GAP-2)
  // P2.6a ruled default; swap lever for Scout's announced 2026-07-17 deprecation.
  MEAL_VISION_MODEL: z.string().min(1).default("meta-llama/llama-4-scout-17b-16e-instruct"),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema
    .refine((c) => c.NODE_ENV !== "production" || c.REDIS_URL !== undefined, {
      path: ["REDIS_URL"],
      message: "REDIS_URL is required in production (quotas/entitlement cache)",
    })
    .safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return Object.freeze(parsed.data);
}
