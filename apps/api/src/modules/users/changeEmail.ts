// Change email (ROADMAP Stage 5 19c; RULINGS 2026-09-23, E): a code goes to the NEW address, and the
// account moves to it only when that code comes back from the same account. Memberships, workouts and
// everything else stay with the account, which is keyed by its id, never its address.
//
// An address that already has an account gets a note instead of a code, and the answer on the screen
// is the same, so nobody learns from it which addresses have an account (CLAUDE.md §4, Auth). Only a
// person who has proved the address is told, at the move, that it is taken.
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import type { AppConfig } from "../../config.js";
import { emailTaken, moveAccountEmail, movedHereLately, redeemEmailCode, requestEmailCode } from "../auth/service.js";
import type { ChangeEmailSender } from "./changeEmailSender.js";
import { sendEmailChangedNoteNow } from "./emailChangedNotes.js";
import * as repo from "./repo.js";
import { UsersError } from "./service.js";

export interface ChangeEmailDeps {
  sql: Sql;
  config: AppConfig;
  log: FastifyBaseLogger;
  sender: ChangeEmailSender;
}

const sameAddress = () => new UsersError(400, "same_email", "That’s already your email address.");

/** A Confirm sent again within this long of the move, its answer lost on the way, is told it worked. */
const SENT_AGAIN_MINUTES = 15;

async function profileOf(deps: ChangeEmailDeps, userId: string): Promise<repo.ProfileRow> {
  const row = await repo.getProfile(deps.sql, userId);
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  return row;
}

/** Step 1: a code to the new address (`email`, already trimmed and lower-cased by its schema). */
export async function requestChangeEmailCode(
  deps: ChangeEmailDeps,
  userId: string,
  email: string,
): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> {
  const row = await profileOf(deps, userId);
  if (row.email?.toLowerCase() === email) throw sameAddress();
  const taken = await emailTaken(deps.sql, email);
  // A code is issued either way, so the day's limits and the replies are the same; one for a taken
  // address is never sent, and could not move anything there.
  return await requestEmailCode(
    { sql: deps.sql, config: deps.config, log: deps.log },
    { email, purpose: "change_email", boundTo: userId },
    (to, code) => (taken ? deps.sender.sendInUse(to) : deps.sender.sendCode(to, code)),
  );
}

/** Step 2: the code proves the person holds the new address; the account moves to it. */
export async function changeEmail(
  deps: ChangeEmailDeps,
  userId: string,
  input: { email: string; code: string },
): Promise<{ email: string; displayName: string }> {
  const row = await profileOf(deps, userId);
  // Already moved: by this same Confirm, sent again after its answer was lost (or sent twice at once).
  const movedAlready = async (now: repo.ProfileRow) =>
    now.email?.toLowerCase() === input.email && (await movedHereLately(deps.sql, { userId, email: input.email, minutes: SENT_AGAIN_MINUTES }));
  if (row.email?.toLowerCase() === input.email) {
    if (await movedAlready(row)) return { email: input.email, displayName: row.displayName };
    throw sameAddress();
  }
  try {
    await redeemEmailCode(
      { sql: deps.sql, config: deps.config, log: deps.log },
      { email: input.email, purpose: "change_email", code: input.code, boundTo: userId },
    );
  } catch (err) {
    const now = await profileOf(deps, userId);
    if (await movedAlready(now)) return { email: input.email, displayName: now.displayName };
    throw err;
  }
  const moved = await moveAccountEmail(deps.sql, { userId, from: row.email, to: input.email });
  if (moved.kind === "taken") {
    throw new UsersError(409, "email_in_use", "That address already has an account. Sign in with it instead, or choose another address.");
  }
  if (moved.kind === "stale") {
    throw new UsersError(409, "email_changed", "Your email address was changed on another device. Close this and check it.");
  }
  // The move stands whatever happens to the note: a note not sent now is the worker's.
  if (row.email !== null && moved.noteId !== null) {
    await sendEmailChangedNoteNow(deps, { id: moved.noteId, oldEmail: row.email, newEmail: moved.email });
  }
  return { email: moved.email, displayName: moved.displayName };
}
