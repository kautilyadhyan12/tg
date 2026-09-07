// The users module's email seam — same three implementations as auth/email.ts
// (log-only · dev · resend), same reasons. The deletion-undo email stays
// log-only in every one of them: the web has no page for its restore link yet
// (ROADMAP Stage 1 item 8), and emailing a link to a page that does not exist
// is a thing a user can see that is false. Tests inject a capturing sender.
import type { FastifyBaseLogger } from "fastify";
import { SIGN_IN_CODE_RULES } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { EmailTransport } from "../../email/resend.js";
import { deleteAccountCodeEmail } from "../../email/templates.js";

export interface UsersEmailSender {
  /** rawToken goes in the emailed undo link (Part 4 §5.2 "14-day undo email");
   *  it must never be logged or stored raw. */
  sendAccountDeletionEmail(email: string, displayName: string, rawToken: string): Promise<void>;
  /** The 6-digit code Settings asks for before deleting the account. */
  sendAccountDeleteCodeEmail(email: string, code: string): Promise<void>;
}

export function createLogOnlyUsersEmailSender(log: FastifyBaseLogger): UsersEmailSender {
  return {
    sendAccountDeletionEmail: () => {
      log.info({ event: "email.account_deletion.queued" }, "email queued (log-only sender)");
      return Promise.resolve();
    },
    sendAccountDeleteCodeEmail: () => {
      log.info({ event: "email.account_delete_code.queued" }, "email queued (log-only sender)");
      return Promise.resolve();
    },
  };
}

/** DEV ONLY — prints the code; throws if built in production (second lock
 *  behind `loadConfig`'s refusal to boot production without a Resend key). */
export function createDevUsersEmailSender(log: FastifyBaseLogger, config: AppConfig): UsersEmailSender {
  if (config.NODE_ENV === "production") {
    throw new Error("the dev email sender must never be constructed in production");
  }
  return {
    ...createLogOnlyUsersEmailSender(log),
    sendAccountDeleteCodeEmail: (email, code) => {
      log.info(
        { event: "email.account_delete_code.dev", email, code },
        "DEV ONLY — account-deletion code (no RESEND_API_KEY set)",
      );
      return Promise.resolve();
    },
  };
}

const CODE_MINUTES = Math.round(SIGN_IN_CODE_RULES.ttlSeconds / 60);

export function createResendUsersEmailSender(
  transport: EmailTransport,
  log: FastifyBaseLogger,
): UsersEmailSender {
  return {
    // REJECTS rather than quietly logging: the service reports `emailSent`
    // from this promise, and the route's message then promises an undo link.
    // With no restore page to link to, a resolved promise here would make the
    // API tell a real user an email was sent that was not. The service logs
    // the failure class and answers with the truthful "removed after N days".
    sendAccountDeletionEmail: () =>
      Promise.reject(new Error("account-deletion undo email is not sent: the web has no restore page yet")),
    sendAccountDeleteCodeEmail: async (email, code) => {
      await transport.send(deleteAccountCodeEmail(email, code, CODE_MINUTES));
      log.info({ event: "email.account_delete_code.sent" }, "account-deletion code sent");
    },
  };
}
