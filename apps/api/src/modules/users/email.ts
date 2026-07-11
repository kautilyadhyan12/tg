// P2.2 — deletion-undo email seam, same GAP-5 posture as auth/email.ts:
// real delivery is the notifications module's card; the default impl logs
// event names ONLY (R3.10). Tests inject a capturing sender via buildApp.
import type { FastifyBaseLogger } from "fastify";

export interface UsersEmailSender {
  /** rawToken goes in the emailed undo link (Part 4 §5.2 "14-day undo email");
   *  it must never be logged or stored raw. */
  sendAccountDeletionEmail(email: string, displayName: string, rawToken: string): Promise<void>;
}

export function createLogOnlyUsersEmailSender(log: FastifyBaseLogger): UsersEmailSender {
  return {
    sendAccountDeletionEmail: () => {
      log.info({ event: "email.account_deletion.queued" }, "email queued (log-only sender)");
      return Promise.resolve();
    },
  };
}
