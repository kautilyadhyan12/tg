// The copy of a signed membership agreement (ROADMAP 18u-i) and the link to sign one from afar
// (18u-ii-b): the same three shapes as the co-owner request's seam (log-only · dev · resend). The
// log-only sender rejects, so the desk never says an email went that did not.
import type { FastifyBaseLogger } from "fastify";
import type { AgreementFact } from "@app/shared";
import type { AppConfig } from "../../../config.js";
import type { EmailTransport } from "../../../email/resend.js";
import { agreementLinkEmail, membershipAgreementEmail } from "../../../email/templates.js";

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
  /** The name of the business's other agreement it was signed with; null for the main one. */
  agreementName: string | null;
}

export interface AgreementLinkLetter {
  to: string;
  gymName: string;
  membershipName: string;
  /** "7 Nov 2026", in the business's own calendar. */
  worksUntil: string;
  /** The page on our website, with the token after "#". */
  signLink: string;
}

export interface AgreementEmailSender {
  sendAgreementCopy(letter: AgreementCopyLetter): Promise<void>;
  sendAgreementLink(letter: AgreementLinkLetter): Promise<void>;
}

export function createLogOnlyAgreementEmailSender(log: FastifyBaseLogger): AgreementEmailSender {
  return {
    sendAgreementCopy: () => {
      log.info({ event: "email.agreement_copy.not_sent" }, "log-only sender delivers nothing");
      return Promise.reject(new Error("log-only email sender: the agreement copy was NOT sent"));
    },
    sendAgreementLink: () => {
      log.info({ event: "email.agreement_link.not_sent" }, "log-only sender delivers nothing");
      return Promise.reject(new Error("log-only email sender: the agreement link was NOT sent"));
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
    // The link is the person's to sign with, so it is written to the dev log, as a dev sign-in
    // code is: a local walk opens it from there. Never in production (above).
    sendAgreementLink: (letter) => {
      log.info({ event: "email.agreement_link.dev", signLink: letter.signLink }, "DEV ONLY — agreement link (no RESEND_API_KEY set)");
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
    sendAgreementLink: async (letter) => {
      await transport.send(agreementLinkEmail(letter));
      log.info({ event: "email.agreement_link.sent" }, "agreement link email sent");
    },
  };
}
