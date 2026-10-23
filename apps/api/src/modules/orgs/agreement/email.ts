// The copy of a signed membership agreement (ROADMAP 18u-i): the same three shapes as the
// co-owner request's seam (log-only · dev · resend). The log-only sender rejects, so the desk
// never says "a copy was emailed" about an email that did not go.
import type { FastifyBaseLogger } from "fastify";
import type { AgreementFact } from "@app/shared";
import type { AppConfig } from "../../../config.js";
import type { EmailTransport } from "../../../email/resend.js";
import { membershipAgreementEmail } from "../../../email/templates.js";

export interface AgreementCopyLetter {
  to: string;
  gymName: string;
  signedName: string;
  /** A parent or guardian signed for the person. */
  byGuardian: boolean;
  /** The day it was signed, in the business's own calendar: "23 Oct 2026". */
  signedOn: string;
  facts: readonly AgreementFact[];
  text: string;
}

export interface AgreementEmailSender {
  sendAgreementCopy(letter: AgreementCopyLetter): Promise<void>;
}

export function createLogOnlyAgreementEmailSender(log: FastifyBaseLogger): AgreementEmailSender {
  return {
    sendAgreementCopy: () => {
      log.info({ event: "email.agreement_copy.not_sent" }, "log-only sender delivers nothing");
      return Promise.reject(new Error("log-only email sender: the agreement copy was NOT sent"));
    },
  };
}

/** DEV ONLY: says a copy would go. Refuses to exist in production. */
export function createDevAgreementEmailSender(log: FastifyBaseLogger, config: AppConfig): AgreementEmailSender {
  if (config.NODE_ENV === "production") throw new Error("the dev email sender must never be constructed in production");
  return {
    sendAgreementCopy: () => {
      log.info({ event: "email.agreement_copy.dev" }, "DEV ONLY — agreement copy (no RESEND_API_KEY set)");
      return Promise.resolve();
    },
  };
}

export function createResendAgreementEmailSender(transport: EmailTransport, log: FastifyBaseLogger): AgreementEmailSender {
  return {
    sendAgreementCopy: async (letter) => {
      await transport.send(membershipAgreementEmail(letter));
      log.info({ event: "email.agreement_copy.sent" }, "agreement copy email sent");
    },
  };
}
