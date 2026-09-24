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
  // The meal scanner on Gemini (RULINGS 2026-08-24). Its 2.5 Flash-Lite
  // answers "no longer available to new users" (HTTP 404, 2026-09-15), so it
  // runs on 3.5 Flash-Lite, with Groq's qwen3.6-27b kept as the spare. A
  // closed list, because each model is priced in vision.adapter.ts. The chosen
  // model's key unset = scanning 503s cleanly, the rest of the app runs (the
  // GROQ_API_KEY precedent).
  GEMINI_API_KEY: z.string().min(1).optional(),
  MEAL_VISION_MODEL: z.enum(["gemini-3.5-flash-lite", "qwen/qwen3.6-27b"]).default("gemini-3.5-flash-lite"),
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
  // Sign-in by email code (Kd 2026-09-07): codes go out through Resend. Both
  // unset in dev/test = the DEV sender prints the code in the server log;
  // REQUIRED in production (refinement below) — a production box with no way
  // to send a code is a product nobody can sign in to. EMAIL_FROM is the
  // sender line Resend expects, e.g. `AI Home Gym <hello@your-domain>`, on a
  // domain verified in the Resend dashboard.
  RESEND_API_KEY: z.string().min(1).optional(),
  // Checked for SHAPE at boot ("Name <box@domain>" or "box@domain"), so a
  // malformed sender line fails the deploy rather than every code send.
  EMAIL_FROM: z
    .string()
    .trim()
    .max(254)
    .regex(
      /^(?:[^<>@\r\n]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/,
      "EMAIL_FROM must look like `Name <box@domain>` or `box@domain`",
    )
    .optional(),
  // The one ceiling on code emails a day across EVERYONE — the stop against
  // a client that varies the address, which no per-address rule can see.
  // Sized for launch (Resend Pro has no daily cap); raise it as users grow.
  CODE_EMAILS_PER_DAY: z.coerce.number().int().positive().default(5000),
  // Member invitations (Part 3 §9.12). In production all three below must be set or
  // invitations are switched off (Invite answers 503); outside production the api's
  // own address, a secret derived from JWT_SECRET and the logging sender stand in.
  // The public address of THIS api, for the unsubscribe links an invitation carries.
  API_ORIGIN: z.string().url().optional(),
  // The invitations' own sender, on a sub-domain of its own, so a stale member list
  // can never get sign-in codes blocked. Same shape rule as EMAIL_FROM.
  INVITE_EMAIL_FROM: z
    .string()
    .trim()
    .max(254)
    .regex(
      /^(?:[^<>@\r\n]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/,
      "INVITE_EMAIL_FROM must look like `Name <box@domain>` or `box@domain`",
    )
    .optional(),
  // Keys the HMAC every invitation and suppression is stored under. NEVER CHANGE IT
  // once set: every stored key would stop matching, and people already invited could
  // be invited again.
  INVITE_HMAC_SECRET: z.string().min(32).optional(),
  // The most invitation emails the whole app sends in any 24 hours.
  INVITE_EMAILS_PER_DAY: z.coerce.number().int().positive().default(2000),
  // The off switch: while "true" the worker sends no invitation; they wait.
  INVITES_PAUSED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // The signing secret of the Resend webhook that reports bounces and complaints
  // (`whsec_` and base64, from Resend's dashboard). Unset: the webhook answers 503.
  RESEND_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_[A-Za-z0-9+/]+={0,2}$/, "RESEND_WEBHOOK_SECRET must be Resend's `whsec_…` signing secret")
    .optional(),
  // Where the app tells its operator that a gym's invitations were stopped (the "have
  // a look" list, until the admin panel). Unset: the log alone says so.
  OPERATOR_EMAIL: z.string().trim().email().max(254).optional(),
  // Paddle sells our plans (ROADMAP Stage 3 item 1a). Sandbox until Kd's live account is
  // approved; each key is checked against the environment below at boot. All unset:
  // paying online answers 503 and the webhook answers 503; the rest of the app runs.
  PADDLE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  PADDLE_API_KEY: z.string().regex(/^pdl_(live|sdbx)_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/, "PADDLE_API_KEY must be a Paddle API key (Paddle's own pattern)").optional(),
  // Public: sent to the browser to open Paddle's checkout.
  PADDLE_CLIENT_TOKEN: z.string().regex(/^(test|live)_[a-zA-Z\d]{27}$/, "PADDLE_CLIENT_TOKEN must be a Paddle client-side token").optional(),
  PADDLE_WEBHOOK_SECRET: z.string().regex(/^pdl_ntfset_[A-Za-z0-9_+/=-]{10,200}$/, "PADDLE_WEBHOOK_SECRET must be a Paddle notification secret").optional(),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema
    .refine((c) => c.NODE_ENV !== "production" || c.REDIS_URL !== undefined, {
      path: ["REDIS_URL"],
      message: "REDIS_URL is required in production (quotas/entitlement cache)",
    })
    .refine((c) => c.NODE_ENV !== "production" || c.RESEND_API_KEY !== undefined, {
      path: ["RESEND_API_KEY"],
      message: "RESEND_API_KEY is required in production (sign-in codes are emailed)",
    })
    .refine((c) => c.RESEND_API_KEY === undefined || c.EMAIL_FROM !== undefined, {
      path: ["EMAIL_FROM"],
      message: "EMAIL_FROM is required when RESEND_API_KEY is set",
    })
    .refine((c) => c.INVITE_EMAIL_FROM === undefined || c.RESEND_API_KEY !== undefined, {
      path: ["RESEND_API_KEY"],
      message: "RESEND_API_KEY is required when INVITE_EMAIL_FROM is set",
    })
    .refine((c) => (c.PADDLE_API_KEY === undefined) === (c.PADDLE_CLIENT_TOKEN === undefined), {
      path: ["PADDLE_CLIENT_TOKEN"],
      message: "PADDLE_API_KEY and PADDLE_CLIENT_TOKEN are set together",
    })
    .refine(
      (c) =>
        c.PADDLE_API_KEY === undefined ||
        c.PADDLE_API_KEY.startsWith(c.PADDLE_ENV === "sandbox" ? "pdl_sdbx_" : "pdl_live_"),
      { path: ["PADDLE_API_KEY"], message: "PADDLE_API_KEY belongs to the other Paddle environment" },
    )
    .refine(
      (c) =>
        c.PADDLE_CLIENT_TOKEN === undefined ||
        c.PADDLE_CLIENT_TOKEN.startsWith(c.PADDLE_ENV === "sandbox" ? "test_" : "live_"),
      { path: ["PADDLE_CLIENT_TOKEN"], message: "PADDLE_CLIENT_TOKEN belongs to the other Paddle environment" },
    )
    .safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return Object.freeze(parsed.data);
}
