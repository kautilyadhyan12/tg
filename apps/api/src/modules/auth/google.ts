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
  nonce: z.string().optional(),
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

// ── the phone (ROADMAP Stage 5 item 12d) ─────────────────────────────────────
// The phone asks Google itself (Android's Credential Manager) and sends us Google's signed
// answer. Only the answer's signature, issuer, audience and time are trusted, all checked
// here; the phone's word for anything is not.

/** A phone's answer from Google, with the one-time word the server gave it to ask with. */
export interface GooglePhoneIdentity extends GoogleIdentity {
  nonce: string;
}

export interface GooglePhoneVerifier {
  /** Throws on any answer that is not Google's, not made for this app, out of date, or
   *  carries no confirmed email or no one-time word. */
  verify(idToken: string): Promise<GooglePhoneIdentity>;
}

/** Google's public keys by key id, as PEM. The real ones are Google's own, fetched and
 *  cached by the SDK; tests hand in their own so the SDK's own check runs on them. */
export type GoogleKeys = () => Promise<Record<string, string>>;

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

/** The phone's verifier, or null when Google isn't configured. The audience is the same
 *  client id the browser's sign-in uses: the phone asks Google with it as its server id. */
export function createGooglePhoneVerifier(
  config: Pick<AppConfig, "GOOGLE_CLIENT_ID">,
  keys?: GoogleKeys,
): GooglePhoneVerifier | null {
  const clientId = config.GOOGLE_CLIENT_ID;
  if (clientId === undefined) return null;
  const client = new OAuth2Client({ clientId });
  const googleKeys: GoogleKeys =
    keys ??
    (async () => {
      const { certs } = await client.getFederatedSignonCertsAsync();
      return Object.fromEntries(
        Object.entries(certs).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    });
  return {
    async verify(idToken) {
      const ticket = await client.verifySignedJwtWithCertsAsync(idToken, await googleKeys(), clientId, GOOGLE_ISSUERS);
      return phoneIdentityFromClaims(ticket.getPayload());
    },
  };
}

/** identityFromClaims, and the answer must carry the one-time word it was asked with. */
export function phoneIdentityFromClaims(raw: unknown): GooglePhoneIdentity {
  const identity = identityFromClaims(raw);
  const { nonce } = googleIdTokenClaimsSchema.parse(raw);
  if (nonce === undefined || nonce === "") {
    throw new Error("Google id_token carried no nonce");
  }
  return { ...identity, nonce };
}

/** A LOG-SAFE one-line summary of an error — never the whole object. A
 *  google-auth-library/gaxios failure carries the token-endpoint request on
 *  `.config` (client_secret + the auth code) and pino's redact paths
 *  (app.ts) do not cover it (R3.10), so logging `{ err }` would leak the
 *  secret. The message alone ("invalid_grant", "Bad Request") is safe. */
export function errorSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
