// The note to an account's old address after Change email (ROADMAP Stage 5 19c), sent until the
// provider takes it (item 19's data-integrity pass, L3). The move keeps the note in its own step; the
// request sends it at once, and this, from the worker, sends what the request could not.
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import type { ChangeEmailSender } from "./changeEmailSender.js";
import * as repo from "./repo.js";

/** Tries before a note is given up on: about a day of them (5 minutes, doubling, at most 6 hours). */
export const EMAIL_CHANGED_NOTE_TRIES = 10;
/** Notes a run takes. */
const PER_RUN = 50;

export interface EmailChangedNotesRun {
  sent: number;
  failed: number;
  gaveUp: number;
}

const errName = (err: unknown) => (err instanceof Error ? err.name : typeof err);

export async function sendDueEmailChangedNotes(deps: { sql: Sql; sender: ChangeEmailSender; log: FastifyBaseLogger }): Promise<EmailChangedNotesRun> {
  const run: EmailChangedNotesRun = { sent: 0, failed: 0, gaveUp: 0 };
  for (const note of await repo.takeDueEmailChangedNotes(deps.sql, PER_RUN)) {
    try {
      await deps.sender.sendChanged(note.oldEmail, note.newEmail);
      await repo.dropEmailChangedNote(deps.sql, note.id);
      run.sent += 1;
    } catch (err) {
      // Error class only; a provider's errors echo addresses.
      if (note.tries >= EMAIL_CHANGED_NOTE_TRIES) {
        await repo.dropEmailChangedNote(deps.sql, note.id);
        run.gaveUp += 1;
        deps.log.error({ errName: errName(err), tries: note.tries, event: "email.email_changed.gave_up" }, "email-changed note given up on");
      } else {
        run.failed += 1;
        deps.log.warn({ errName: errName(err), tries: note.tries, event: "email.email_changed.send_failed" }, "email-changed note send failed; tried again later");
      }
    }
  }
  return run;
}

/** The request's own first try, straight after the move: sent, the note goes; not sent, it stays for
 *  the worker. */
export async function sendEmailChangedNoteNow(
  deps: { sql: Sql; sender: ChangeEmailSender; log: FastifyBaseLogger },
  note: { id: string; oldEmail: string; newEmail: string },
): Promise<void> {
  try {
    await deps.sender.sendChanged(note.oldEmail, note.newEmail);
  } catch (err) {
    deps.log.warn({ errName: errName(err), event: "email.email_changed.send_failed" }, "email-changed note send failed; the worker tries again");
    return;
  }
  await repo.dropEmailChangedNote(deps.sql, note.id);
}
