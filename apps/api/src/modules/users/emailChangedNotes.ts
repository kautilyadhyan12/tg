// The note to an account's old address after Change email (ROADMAP Stage 5 19c), with its Undo this
// change link, sent until the provider takes it (item 19's two extra passes). The move keeps the change in
// its own step; the request sends the note at once, and this, from the worker, sends what it could not.
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import type { AppConfig } from "../../config.js";
import { emailChangeUndoToken } from "../auth/service.js";
import type { ChangeEmailSender } from "./changeEmailSender.js";
import * as repo from "./repo.js";

/** Tries before a note is given up on: about a day of them (5 minutes, doubling, at most 6 hours). */
export const EMAIL_CHANGED_NOTE_TRIES = 10;
/** Notes a run takes. */
const PER_RUN = 50;

export interface NotesDeps {
  sql: Sql;
  sender: ChangeEmailSender;
  log: FastifyBaseLogger;
  config: Pick<AppConfig, "JWT_SECRET" | "WEB_ORIGIN">;
}

/** The page the note's Undo this change opens; the token after "#" never reaches a server's log. */
export function emailChangeUndoLink(config: Pick<AppConfig, "JWT_SECRET" | "WEB_ORIGIN">, changeId: string): string {
  return `${config.WEB_ORIGIN}/undo-email-change#${emailChangeUndoToken(config, changeId)}`;
}

export interface EmailChangedNotesRun {
  sent: number;
  failed: number;
  gaveUp: number;
  /** Changes whose 14 days were over, deleted. */
  ended: number;
}

const errName = (err: unknown) => (err instanceof Error ? err.name : typeof err);

export async function sendDueEmailChangedNotes(deps: NotesDeps): Promise<EmailChangedNotesRun> {
  const run: EmailChangedNotesRun = { sent: 0, failed: 0, gaveUp: 0, ended: await repo.dropEndedEmailChanges(deps.sql) };
  for (const note of await repo.takeDueEmailChangedNotes(deps.sql, PER_RUN)) {
    try {
      await deps.sender.sendChanged(note.oldEmail, note.newEmail, emailChangeUndoLink(deps.config, note.id));
      await repo.emailChangedNoteDone(deps.sql, note.id);
      run.sent += 1;
    } catch (err) {
      // Error class only; a provider's errors echo addresses.
      if (note.tries >= EMAIL_CHANGED_NOTE_TRIES) {
        await repo.emailChangedNoteDone(deps.sql, note.id);
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

/** The request's own first try, straight after the move: sent, no more tries; not sent, the worker's. */
export async function sendEmailChangedNoteNow(deps: NotesDeps, note: { id: string; oldEmail: string; newEmail: string }): Promise<void> {
  try {
    await deps.sender.sendChanged(note.oldEmail, note.newEmail, emailChangeUndoLink(deps.config, note.id));
  } catch (err) {
    deps.log.warn({ errName: errName(err), event: "email.email_changed.send_failed" }, "email-changed note send failed; the worker tries again");
    return;
  }
  await repo.emailChangedNoteDone(deps.sql, note.id);
}
