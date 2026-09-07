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
