// The auth module's email seam. Three implementations:
//   · log-only   — event names only, never a token, code or address (R3.10).
//                  It delivers NOTHING: the sign-in code method REJECTS so the
//                  API can never say "we emailed you" over a send that did not
//                  happen. The two password-era methods resolve quietly — their
//                  routes are switched off on every screen and no caller
//                  reports their delivery to a person.
//   · dev        — logs the CODE and the ADDRESS, and refuses to exist in
//                  production. This is how the app is tested on a laptop with
//                  no Resend key (Kd's plan, 2026-09-07).
//   · resend     — the real one (Kd's ruling: sign-in codes go out through
//                  Resend). The password-era emails stay log-only in it too:
//                  the web has no page for their links since the password was
//                  switched off, and an email pointing at a page that does not
//                  exist is a thing a user can see that is false.
// Tests inject a capturing sender via buildApp's overrides.
import type { FastifyBaseLogger } from "fastify";
import { SIGN_IN_CODE_RULES } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { EmailTransport } from "../../email/resend.js";
import { signInCodeEmail } from "../../email/templates.js";

export interface EmailSender {
  /** rawToken goes in the emailed link; it must never be logged or stored raw. */
  sendVerificationEmail(email: string, displayName: string, rawToken: string): Promise<void>;
  sendPasswordResetEmail(email: string, displayName: string, rawToken: string): Promise<void>;
  /** The 6-digit sign-in code. Never logged outside the dev sender. */
  sendSignInCodeEmail(email: string, code: string): Promise<void>;
}

export function createLogOnlyEmailSender(log: FastifyBaseLogger): EmailSender {
  return {
    sendVerificationEmail: () => {
      log.info({ event: "email.verification.queued" }, "email queued (log-only sender)");
      return Promise.resolve();
    },
    sendPasswordResetEmail: () => {
      log.info({ event: "email.password_reset.queued" }, "email queued (log-only sender)");
      return Promise.resolve();
    },
    sendSignInCodeEmail: () => {
      log.info({ event: "email.sign_in_code.not_sent" }, "log-only sender delivers nothing");
      return Promise.reject(new Error("log-only email sender: the sign-in code was NOT sent"));
    },
  };
}

/** DEV ONLY. Prints the code so a person testing on their own machine can
 *  sign in without an email service. Constructing it in production is a
 *  programming error and throws — `loadConfig` already refuses to boot
 *  production without a Resend key, so this is the second lock. */
export function createDevEmailSender(log: FastifyBaseLogger, config: AppConfig): EmailSender {
  if (config.NODE_ENV === "production") {
    throw new Error("the dev email sender must never be constructed in production");
  }
  return {
    ...createLogOnlyEmailSender(log),
    sendSignInCodeEmail: (email, code) => {
      log.info({ event: "email.sign_in_code.dev", email, code }, "DEV ONLY — sign-in code (no RESEND_API_KEY set)");
      return Promise.resolve();
    },
  };
}

const CODE_MINUTES = Math.round(SIGN_IN_CODE_RULES.ttlSeconds / 60);

export function createResendEmailSender(transport: EmailTransport, log: FastifyBaseLogger): EmailSender {
  return {
    ...createLogOnlyEmailSender(log),
    sendSignInCodeEmail: async (email, code) => {
      await transport.send(signInCodeEmail(email, code, CODE_MINUTES));
      log.info({ event: "email.sign_in_code.sent" }, "sign-in code sent");
    },
  };
}
