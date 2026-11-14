// The confirmation of a membership cancelled in the app (ROADMAP 18l), and of one kept there afterwards (18l-ii-a): the
// same three shapes as the agreement copy's seam (log-only · dev · resend). The log-only sender rejects, so the app
// never says an email went that did not.
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../../../config.js";
import type { EmailTransport } from "../../../email/resend.js";
import { memberInviteFrom, membershipCancelledEmail, membershipKeptEmail } from "../../../email/templates.js";

export interface CancelLetter {
  to: string;
  gymName: string;
  membershipName: string;
  cancelledAt: string;
  done: string;
  lines: readonly string[];
  notes: readonly string[];
}

export interface KeepLetter {
  to: string;
  gymName: string;
  membershipName: string;
  keptAt: string;
  done: string;
  lines: readonly string[];
}

export interface CancelEmailSender {
  sendCancelConfirmation(letter: CancelLetter): Promise<void>;
  sendKeepConfirmation(letter: KeepLetter): Promise<void>;
}

export function createLogOnlyCancelEmailSender(log: FastifyBaseLogger): CancelEmailSender {
  return {
    sendCancelConfirmation: () => {
      log.info({ event: "email.cancel_confirmation.not_sent" }, "log-only sender delivers nothing");
      return Promise.reject(new Error("log-only email sender: the cancel confirmation was NOT sent"));
    },
    sendKeepConfirmation: () => {
      log.info({ event: "email.keep_confirmation.not_sent" }, "log-only sender delivers nothing");
      return Promise.reject(new Error("log-only email sender: the keep confirmation was NOT sent"));
    },
  };
}

/** DEV ONLY: says a confirmation would go. Refuses to exist in production. */
export function createDevCancelEmailSender(log: FastifyBaseLogger, config: AppConfig): CancelEmailSender {
  if (config.NODE_ENV === "production") throw new Error("the dev email sender must never be constructed in production");
  return {
    sendCancelConfirmation: () => {
      log.info({ event: "email.cancel_confirmation.dev" }, "DEV ONLY — cancel confirmation (no RESEND_API_KEY set)");
      return Promise.resolve();
    },
    sendKeepConfirmation: () => {
      log.info({ event: "email.keep_confirmation.dev" }, "DEV ONLY — keep confirmation (no RESEND_API_KEY set)");
      return Promise.resolve();
    },
  };
}

/** `mailbox` is the configured sender the gym's name is put on: "Iron House via KWAZO <box>", as every member email. */
export function createResendCancelEmailSender(transport: EmailTransport, log: FastifyBaseLogger, mailbox: string): CancelEmailSender {
  return {
    sendCancelConfirmation: async (letter) => {
      await transport.send({ ...membershipCancelledEmail(letter), from: memberInviteFrom(mailbox, letter.gymName) });
      log.info({ event: "email.cancel_confirmation.sent" }, "cancel confirmation email sent");
    },
    sendKeepConfirmation: async (letter) => {
      await transport.send({ ...membershipKeptEmail(letter), from: memberInviteFrom(mailbox, letter.gymName) });
      log.info({ event: "email.keep_confirmation.sent" }, "keep confirmation email sent");
    },
  };
}
