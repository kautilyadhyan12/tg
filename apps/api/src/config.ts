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
  // Coach-model migration 2026-07-22 (supersedes the P2.5b GAP-2 salvage
  // default): Groq deprecated llama-3.1-8b-instant and DECOMMISSIONS it
  // 2026-08-16 — after that date requests to it are not served and the coach
  // goes dark. openai/gpt-oss-20b is Groq's own recommended replacement (per
  // the deprecation email + console.groq.com supported-models page, the exact
  // id verified 2026-07-22). Overridable via COACH_MODEL.
  COACH_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
  // Vision-swap card 2026-07-16 (supersedes the P2.6a Scout default): Groq
  // decommissions Scout 2026-07-17; qwen3.6-27b is the only vision-capable
  // replacement (console.groq.com/docs/vision, checked 2026-07-16).
  MEAL_VISION_MODEL: z.string().min(1).default("qwen/qwen3.6-27b"),
  // P2.6b: geo route generation via ORS (v1 §6.1). Unset = route generation
  // 503s cleanly (fail-closed, GROQ_API_KEY precedent); the browse/read side
  // (saved_routes, runs) works without it.
  ORS_API_KEY: z.string().min(1).optional(),
  // google-login card: v1 §6.1's Google OAuth. All three unset = Google
  // sign-in cleanly disabled (the routes redirect with ?error=google_not_
  // configured), the rest of auth runs — porting the old `googleConfigured`
  // guard (passport.js:8-12), same pattern as GROQ_API_KEY. CALLBACK_URL must
  // exactly match the redirect URI registered in the Google Cloud console.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
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
