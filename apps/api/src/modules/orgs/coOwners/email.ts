// The co-owner request's email seam (ROADMAP 4b-i): the same three shapes as
// `users/email.ts` (log-only · dev · resend), for the same reasons. The log-only sender
// rejects, so the console never says "we emailed them" about an email that did not go.
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../../../config.js";
import type { EmailTransport } from "../../../email/resend.js";
import { coOwnerRequestEmail } from "../../../email/templates.js";

export interface CoOwnerRequestLetter {
  to: string;
  ownerName: string;
  gymName: string;
  days: number;
  consoleLink: string;
}

export interface CoOwnerEmailSender {
  sendCoOwnerRequest(letter: CoOwnerRequestLetter): Promise<void>;
}

export function createLogOnlyCoOwnerEmailSender(log: FastifyBaseLogger): CoOwnerEmailSender {
  return {
    sendCoOwnerRequest: () => {
      log.info({ event: "email.co_owner_request.not_sent" }, "log-only sender delivers nothing");
      return Promise.reject(new Error("log-only email sender: the co-owner request was NOT sent"));
    },
  };
}

/** DEV ONLY: prints the link the email would carry. Refuses to exist in production. */
export function createDevCoOwnerEmailSender(log: FastifyBaseLogger, config: AppConfig): CoOwnerEmailSender {
  if (config.NODE_ENV === "production") throw new Error("the dev email sender must never be constructed in production");
  return {
    sendCoOwnerRequest: (letter) => {
      log.info({ event: "email.co_owner_request.dev", consoleLink: letter.consoleLink }, "DEV ONLY — co-owner request (no RESEND_API_KEY set)");
      return Promise.resolve();
    },
  };
}

export function createResendCoOwnerEmailSender(transport: EmailTransport, log: FastifyBaseLogger): CoOwnerEmailSender {
  return {
    sendCoOwnerRequest: async (letter) => {
      await transport.send(coOwnerRequestEmail(letter));
      log.info({ event: "email.co_owner_request.sent" }, "co-owner request email sent");
    },
  };
}
