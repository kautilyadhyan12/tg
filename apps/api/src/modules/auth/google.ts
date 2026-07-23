// google-login card: the Google OAuth adapter (v1 §6.1). Re-expresses the old
// passport.js/googleAuth.routes.js logic on Fastify with NO passport/Express —
// the SDK types never leak past this file (R7.1). Injectable behind an
// interface so route tests drive the full sign-in flow with a fake and never
// call Google (the emailSender test-seam precedent, DECISIONS 2026-07-11).
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import type { AppConfig } from "../../config.js";

/** The verified facts we take from Google — nothing more crosses into the app. */
export interface GoogleIdentity {
  /** Google's stable, opaque user id (the id_token `sub`). Keyed in auth_identities. */
  subject: string;
  email: string;
  /** Profile display name, may be absent — the service supplies a fallback. */
  name: string | null;
}

export interface GoogleVerifier {
  /** The consent URL to redirect the browser to; `state` is our CSRF token. */
  authUrl(state: string): string;
  /** Exchange the callback `code` for a verified identity. Throws on any
   *  failure (bad code, unverified/absent email) — the route maps that to a
   *  clean login redirect, never a 500. */
  exchange(code: string): Promise<GoogleIdentity>;
}

/** Real verifier, or null when Google isn't configured (the app still boots and
 *  password auth works — ported `googleConfigured` guard, passport.js:8-12). */
export function createGoogleVerifier(config: AppConfig): GoogleVerifier | null {
  const clientId = config.GOOGLE_CLIENT_ID;
  const clientSecret = config.GOOGLE_CLIENT_SECRET;
  const redirectUri = config.GOOGLE_CALLBACK_URL;
  if (clientId === undefined || clientSecret === undefined || redirectUri === undefined) {
    return null;
  }
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
  return {
    authUrl(state) {
      return client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state,
        access_type: "online", // no refresh token needed — we mint our own session
        prompt: "select_account",
      });
    },
    async exchange(code) {
      const { tokens } = await client.getToken(code);
      const idToken = tokens.id_token;
      if (idToken === undefined || idToken === null) {
        throw new Error("Google token response carried no id_token");
      }
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      return identityFromClaims(ticket.getPayload());
    },
  };
}

// The id_token claims we consume. z.object strips the rest; the SIGNATURE is
// already verified by verifyIdToken — this parse is the R2.3 boundary for the
// claim VALUES (trap #12: external input crosses via schema.parse, not ad-hoc
// guards). An undefined payload (no object) fails the parse and throws.
const googleIdTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1).optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
});

/** Parse verified id_token claims into a GoogleIdentity. email_verified must be
 *  EXACTLY true (R3.1/R3.7): an absent claim is NOT trusted — this fact
 *  auto-links a Google login into an existing password account (service.ts step
 *  2), so a missing/false claim treated as verified would be an account-takeover
 *  surface. Exported for unit tests (the SDK path can't be driven in-process). */
export function identityFromClaims(raw: unknown): GoogleIdentity {
  const claims = googleIdTokenClaimsSchema.parse(raw);
  if (claims.email === undefined) {
    throw new Error("Google id_token carried no email");
  }
  if (claims.email_verified !== true) {
    throw new Error("Google id_token email is not verified");
  }
  return { subject: claims.sub, email: claims.email, name: claims.name ?? null };
}

/** A LOG-SAFE one-line summary of an error — never the whole object. A
 *  google-auth-library/gaxios failure carries the token-endpoint request on
 *  `.config` (client_secret + the auth code) and pino's redact paths
 *  (app.ts) do not cover it (R3.10), so logging `{ err }` would leak the
 *  secret. The message alone ("invalid_grant", "Bad Request") is safe. */
export function errorSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
