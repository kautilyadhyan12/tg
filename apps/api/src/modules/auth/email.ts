// P2.1 GAP-5 (DECISIONS 2026-07-11): email delivery is the notifications
// module's card. Until then this interface is the seam; the default impl logs
// event names ONLY — never the token, never the address (R3.10). Tests inject
// a capturing sender via buildApp's test overrides.
import type { FastifyBaseLogger } from "fastify";

export interface EmailSender {
  /** rawToken goes in the emailed link; it must never be logged or stored raw. */
  sendVerificationEmail(email: string, displayName: string, rawToken: string): Promise<void>;
  sendPasswordResetEmail(email: string, displayName: string, rawToken: string): Promise<void>;
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
  };
}
