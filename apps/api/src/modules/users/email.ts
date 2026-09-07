// The users module's email seam — the same three implementations as
// auth/email.ts (log-only · dev · resend), for the same reasons.
//
// THE LOG-ONLY SENDER DELIVERS NOTHING AND SAYS SO: every method whose caller
// reports "we emailed you" REJECTS, so the API can never claim a send that did
// not happen. It is the base the other two spread over, not a sender anyone
// runs on purpose.
import type { FastifyBaseLogger } from "fastify";
import { SIGN_IN_CODE_RULES } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { EmailTransport } from "../../email/resend.js";
import { accountDeletionEmail, deleteAccountCodeEmail } from "../../email/templates.js";
import { DPDP_RETENTION_DAYS } from "../../retention.js";

export interface UsersEmailSender {
  /** rawToken goes in the emailed undo link (Part 4 §5.2 "14-day undo email");
   *  it must never be logged or stored raw. */
  sendAccountDeletionEmail(email: string, displayName: string, rawToken: string): Promise<void>;
  /** The 6-digit code Settings asks for before deleting the account. */
  sendAccountDeleteCodeEmail(email: string, code: string): Promise<void>;
}

const notDelivered = (what: string) =>
  Promise.reject(new Error(`log-only email sender: the ${what} was NOT sent`));

export function createLogOnlyUsersEmailSender(log: FastifyBaseLogger): UsersEmailSender {
  return {
    sendAccountDeletionEmail: () => {
      log.info({ event: "email.account_deletion.not_sent" }, "log-only sender delivers nothing");
      return notDelivered("account-deletion undo email");
    },
    sendAccountDeleteCodeEmail: () => {
      log.info({ event: "email.account_delete_code.not_sent" }, "log-only sender delivers nothing");
      return notDelivered("account-deletion code");
    },
  };
}

/** The undo link the email carries: our own origin, the restore page, the
 *  token in the query. One place, so the page and the email cannot drift. */
export const restoreLink = (webOrigin: string, rawToken: string): string =>
  `${webOrigin}/restore-account?token=${encodeURIComponent(rawToken)}`;

/** DEV ONLY — prints what the email would carry (the code, the undo link)
 *  so a person testing on their own machine can walk the whole flow. It
 *  throws if built in production (second lock behind `loadConfig`'s refusal
 *  to boot production without a Resend key). Printing a restore token is
 *  acceptable HERE and nowhere else, for the same reason the code is. */
export function createDevUsersEmailSender(log: FastifyBaseLogger, config: AppConfig): UsersEmailSender {
  if (config.NODE_ENV === "production") {
    throw new Error("the dev email sender must never be constructed in production");
  }
  return {
    sendAccountDeletionEmail: (email, _displayName, rawToken) => {
      log.info(
        { event: "email.account_deletion.dev", email, restoreLink: restoreLink(config.WEB_ORIGIN, rawToken) },
        "DEV ONLY — account-deletion undo link (no RESEND_API_KEY set)",
      );
      return Promise.resolve();
    },
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
  webOrigin: string,
): UsersEmailSender {
  return {
    sendAccountDeletionEmail: async (email, displayName, rawToken) => {
      await transport.send(
        accountDeletionEmail(email, displayName, restoreLink(webOrigin, rawToken), DPDP_RETENTION_DAYS),
      );
      log.info({ event: "email.account_deletion.sent" }, "account-deletion undo email sent");
    },
    sendAccountDeleteCodeEmail: async (email, code) => {
      await transport.send(deleteAccountCodeEmail(email, code, CODE_MINUTES));
      log.info({ event: "email.account_delete_code.sent" }, "account-deletion code sent");
    },
  };
}
