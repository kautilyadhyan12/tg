// Change email's three emails (ROADMAP Stage 5 19c), the same three implementations as
// `email.ts` (log-only · dev · resend), for the same reasons. The log-only sender rejects, so the
// screen never says "we emailed" for a code that did not go.
import type { FastifyBaseLogger } from "fastify";
import { SIGN_IN_CODE_RULES } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { EmailTransport } from "../../email/resend.js";
import { changeEmailCodeEmail, emailChangedEmail, emailInUseEmail } from "../../email/templates.js";

export interface ChangeEmailSender {
  /** The code, to the NEW address. */
  sendCode(email: string, code: string): Promise<void>;
  /** In place of that code, when the new address already has an account. */
  sendInUse(email: string): Promise<void>;
  /** To the OLD address once the account has moved. */
  sendChanged(oldEmail: string, newEmail: string): Promise<void>;
}

const notDelivered = (what: string) => Promise.reject(new Error(`log-only email sender: the ${what} was NOT sent`));

export function createLogOnlyChangeEmailSender(log: FastifyBaseLogger): ChangeEmailSender {
  return {
    sendCode: () => {
      log.info({ event: "email.change_email_code.not_sent" }, "log-only sender delivers nothing");
      return notDelivered("change-email code");
    },
    sendInUse: () => {
      log.info({ event: "email.email_in_use.not_sent" }, "log-only sender delivers nothing");
      return notDelivered("address-in-use note");
    },
    sendChanged: () => {
      log.info({ event: "email.email_changed.not_sent" }, "log-only sender delivers nothing");
      return notDelivered("email-changed note");
    },
  };
}

/** DEV ONLY — prints the code, so a person testing on their own machine can walk the change. */
export function createDevChangeEmailSender(log: FastifyBaseLogger, config: AppConfig): ChangeEmailSender {
  if (config.NODE_ENV === "production") {
    throw new Error("the dev email sender must never be constructed in production");
  }
  return {
    sendCode: (email, code) => {
      log.info({ event: "email.change_email_code.dev", email, code }, "DEV ONLY — change-email code (no RESEND_API_KEY set)");
      return Promise.resolve();
    },
    sendInUse: (email) => {
      log.info({ event: "email.email_in_use.dev", email }, "DEV ONLY — the address already has an account (no RESEND_API_KEY set)");
      return Promise.resolve();
    },
    sendChanged: (oldEmail) => {
      log.info({ event: "email.email_changed.dev", email: oldEmail }, "DEV ONLY — email-changed note (no RESEND_API_KEY set)");
      return Promise.resolve();
    },
  };
}

/** The app's own: Resend's, with the address members write to for help, when there is a transport;
 *  the dev one otherwise. */
export function changeEmailSenderFor(config: AppConfig, transport: EmailTransport | null, log: FastifyBaseLogger): ChangeEmailSender {
  return transport === null ? createDevChangeEmailSender(log, config) : createResendChangeEmailSender(transport, log, config.SUPPORT_EMAIL ?? null);
}

const CODE_MINUTES = Math.round(SIGN_IN_CODE_RULES.ttlSeconds / 60);

export function createResendChangeEmailSender(
  transport: EmailTransport,
  log: FastifyBaseLogger,
  supportEmail: string | null,
): ChangeEmailSender {
  return {
    sendCode: async (email, code) => {
      await transport.send(changeEmailCodeEmail(email, code, CODE_MINUTES));
      log.info({ event: "email.change_email_code.sent" }, "change-email code sent");
    },
    sendInUse: async (email) => {
      await transport.send(emailInUseEmail(email));
      log.info({ event: "email.email_in_use.sent" }, "address-in-use note sent");
    },
    sendChanged: async (oldEmail, newEmail) => {
      await transport.send(emailChangedEmail({ to: oldEmail, newAddress: newEmail, supportEmail }));
      log.info({ event: "email.email_changed.sent" }, "email-changed note sent");
    },
  };
}
