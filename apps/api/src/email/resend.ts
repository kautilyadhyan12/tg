// RESEND, the app's email service (Kd 2026-09-07: sign-in codes go out through
// it). One HTTPS call to their REST API, so no SDK is added — the dependency is
// the SERVICE (an account, an API key, a verified sending domain), not a
// package.
//
// THE KEY NEVER LEAVES THIS FILE and is never logged: a failed call throws an
// Error carrying the HTTP status only — never the response body, which can
// echo the recipient address, and never the request, which carries the key.
import { z } from "zod";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

/** Resend answers `{ id }` on success. Parsed, not trusted (R2.3). */
const resendOkSchema = z.object({ id: z.string().min(1) });

export class EmailTransportError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "EmailTransportError";
    this.status = status;
  }
}

/** An invitation email (Part 3 §9.12): its own sender on the invitations' sub-domain,
 *  its unsubscribe headers, and the idempotency key that makes a retry of the same
 *  send a no-op at Resend for 24 hours. */
export interface InviteEmail extends EmailMessage {
  from: string;
  headers: Record<string, string>;
  idempotencyKey: string;
}

/** What became of one invitation email. `sent` with a null id is a retry Resend
 *  recognised as already sent under this key with a different body. */
export type InviteSendResult =
  | { kind: "sent"; id: string | null }
  /** Resend refused it for good (an address it will not take). */
  | { kind: "refused"; status: number }
  /** Try again later: a timeout, a 5xx, a 429, a key or account problem. */
  | { kind: "retry"; status: number | null };

export interface InviteTransport {
  send(message: InviteEmail): Promise<InviteSendResult>;
}

const resendErrorSchema = z.object({ name: z.string().max(100) });

/** Resend for invitations. Never throws for an answer from Resend; the status alone
 *  says what happened, and no body or request is ever logged or returned. */
export function createResendInviteTransport(opts: { apiKey: string; fetchImpl?: typeof fetch }): InviteTransport {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async send(message) {
      let response: Response;
      try {
        response = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: message.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            headers: message.headers,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        return { kind: "retry", status: null };
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (response.ok) {
        const ok = resendOkSchema.safeParse(body);
        return { kind: "sent", id: ok.success ? ok.data.id.slice(0, 100) : null };
      }
      if (response.status === 409) {
        // Resend's idempotency answers: the key was already used with a different body
        // (the first send went), or its first request is still running (ask again).
        const error = resendErrorSchema.safeParse(body);
        if (error.success && error.data.name === "invalid_idempotent_request") return { kind: "sent", id: null };
        return { kind: "retry", status: 409 };
      }
      // 401 and 403 are our key or account, not the address: never burn an invitation
      // on them.
      if (response.status === 400 || response.status === 422) return { kind: "refused", status: response.status };
      return { kind: "retry", status: response.status };
    },
  };
}

export function createResendTransport(opts: {
  apiKey: string;
  from: string;
  /** Injectable for tests; production uses the platform fetch. */
  fetchImpl?: typeof fetch;
}): EmailTransport {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async send(message) {
      let response: Response;
      try {
        response = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: opts.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch (err) {
        // Network failure or timeout. The cause's message can name the host
        // and nothing more; it is dropped anyway — callers log the class.
        throw new EmailTransportError(
          err instanceof Error && err.name === "TimeoutError" ? "email send timed out" : "email send failed",
          null,
        );
      }
      if (!response.ok) {
        throw new EmailTransportError(`email service answered ${String(response.status)}`, response.status);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new EmailTransportError("email service answered with a body that was not JSON", response.status);
      }
      if (!resendOkSchema.safeParse(body).success) {
        throw new EmailTransportError("email service answered without a message id", response.status);
      }
    },
  };
}
