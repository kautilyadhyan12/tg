// UNDO CANCELLATION, FOR STAFF (ROADMAP 18l-ii-b; Kd, rulings/2026-11-11-18l.md; spec Part 3 §14.8, "Cancelling").
//
// A membership the front desk cancelled to end on a later day is put back as it was, until that day: every way staff
// cancelled it (`gym_desk_cancels`), by the one transition's `undo_cancel`, run by the desk's own step (`moveHeldIn`).
//
// THE WORST THING here is payments started again that a member stopped themselves in the app, or on a membership that is
// not this gym's or this person's. So a membership with a cancel in the app that stands is refused whoever cancelled
// last; the membership is read with its gym and its record in the WHERE; and the press is refused unless the box, worked
// out again under the locks, has the key the press sent back.
import type { TransactionSql } from "postgres";
import {
  UNDO_CANCEL_BUTTON,
  UNDO_CANCEL_WORDS,
  undoCancelAskSchema,
  undoCancelLines,
  undoCancelQuestion,
  undoCancelReplacedNote,
  type HeldMembershipsResponse,
  type UndoCancelAsk,
  type UndoCancelFacts,
  type UndoCancelRequest,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { keyOf } from "../myMembership/cancel.js";
import * as cancels from "../myMembership/cancelRepo.js";
import { keepMoney } from "../myMembership/keep.js";
import { OrgsError, requireWritablePrivilege } from "../service.js";
import { deskCancelOfUndoRequest, markUndone, openDeskCancelsOf, type DeskCancelRow } from "./deskCancelsRepo.js";
import { heldRowsOf, lockedEntry, moveHeldIn } from "./heldRepo.js";
import { CANCEL_BOOKINGS, readOr404, throwOnFailure, type HeldDeps } from "./heldService.js";

export interface UndoWorked {
  ask: UndoCancelAsk;
  /** The desk cancel the box would undo; null where there is nothing to press. */
  cancel: DeskCancelRow | null;
}

/** THE BOX, worked out from the cancels, the membership and its bills as they stand: the same read for the box and,
 *  under the locks, for the press. Null where the gym has no such membership on this record. */
export async function workOutUndo(tx: TransactionSql, gymId: string, entryId: string, membershipId: string, today: string): Promise<UndoWorked | null> {
  if ((await cancels.recordOfMembership(tx, gymId, membershipId)) !== entryId) return null;
  const row = (await heldRowsOf(tx, gymId, [membershipId])).get(membershipId);
  if (row === undefined) return null;
  const name = (await cancels.nameOfRecord(tx, gymId, entryId)) ?? "This person";
  const base = { membership: { id: row.id, name: row.typeName }, currency: row.currency, question: undoCancelQuestion(name, row.typeName) };
  const nothing = (note: string): UndoWorked => ({ ask: undoCancelAskSchema.parse({ ...base, choice: null, notes: [note] }), cancel: null });
  // The member stopped these charges, so only the member starts them again (Kd, 2026-11-11).
  if ((await cancels.cancelsOf(tx, gymId, [row.id])).has(row.id)) return nothing(UNDO_CANCEL_WORDS.inApp);
  const cancel = (await openDeskCancelsOf(tx, gymId, [row.id])).get(row.id);
  if (cancel === undefined) return nothing(UNDO_CANCEL_WORDS.over);
  const money = await keepMoney(tx, gymId, entryId, row, { type: "undo_cancel", ways: cancel.ways }, cancel.endsOn, today);
  if (money.kind === "over") return nothing(UNDO_CANCEL_WORDS.over);
  if (money.kind === "frozen") return nothing(UNDO_CANCEL_WORDS.frozen);
  if (money.kind === "followed") return nothing(undoCancelReplacedNote(name, money.follower.name, money.follower.startsOn, money.follower.replaces));
  if (money.kind === "fee_paid") return nothing(UNDO_CANCEL_WORDS.feePaid);
  const facts: UndoCancelFacts = { name, membershipName: row.typeName, currency: row.currency, next: money.next, card: money.card, feeOffMinor: money.feeOffMinor, ended: cancel.ended };
  const choice = { lines: undoCancelLines(facts), next: money.next, feeOffMinor: money.feeOffMinor };
  const full = { ...choice, button: UNDO_CANCEL_BUTTON, key: keyOf(row.id, { undo: cancel.id, ways: cancel.ways, ...choice }) };
  return { ask: undoCancelAskSchema.parse({ ...base, choice: full, notes: [] }), cancel };
}

const BILLING = "billing.members";
const notFound = (): OrgsError => new OrgsError(404, "held_membership_not_found", "That membership was not found.");
const changed = (): OrgsError => new OrgsError(409, "undo_cancel_changed", UNDO_CANCEL_WORDS.changed);

/** The box under Undo cancellation, for staff who may change memberships (`members.confirm`, as Cancel asks). */
export async function readUndoCancel(deps: HeldDeps, userId: string, gymId: string, entryId: string, membershipId: string): Promise<UndoCancelAsk> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const today = dayInTz(deps.now(), org.timezone);
  const worked = await deps.sql.begin("isolation level repeatable read read only", (tx) => workOutUndo(tx, gymId, entryId, membershipId, today));
  if (worked === null) throw notFound();
  return worked.ask;
}

/** UNDO: exactly what the box said, or nothing. The same press sent twice is one undo. Answers the person's memberships. */
export async function undoCancel(deps: HeldDeps, userId: string, gymId: string, entryId: string, membershipId: string, body: UndoCancelRequest): Promise<HeldMembershipsResponse> {
  const { org, privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const now = deps.now();
  const today = dayInTz(now, org.timezone);
  await deps.sql.begin(async (tx) => {
    // The gym's lock first: the same press sent twice at once waits here, then finds the first one's undo.
    const entry = await lockedEntry(tx, gymId, entryId);
    if (entry === null) throw notFound();
    const again = await deskCancelOfUndoRequest(tx, gymId, body.requestKey);
    if (again !== null) {
      if (again.heldMembershipId !== membershipId) throw new OrgsError(409, "request_reused", UNDO_CANCEL_WORDS.requestReused);
      return;
    }
    const worked = await workOutUndo(tx, gymId, entryId, membershipId, today);
    if (worked === null) throw notFound();
    const choice = worked.ask.choice;
    if (choice === null || worked.cancel === null) throw new OrgsError(409, "undo_cancel_refused", worked.ask.notes[0] ?? UNDO_CANCEL_WORDS.changed);
    if (choice.key !== body.key) throw changed();
    const outcome = await moveHeldIn(tx, CANCEL_BOOKINGS, {
      gymId,
      entryId,
      membershipId,
      event: { type: "undo_cancel", ways: worked.cancel.ways },
      ...(worked.cancel.endsOn === null ? {} : { keepFrom: worked.cancel.endsOn }),
      today,
      confirmBookings: null,
      actorUserId: userId,
      now,
    });
    if (outcome.kind === "has_bookings") throw changed();
    throwOnFailure(outcome);
    if (!(await markUndone(tx, { gymId, id: worked.cancel.id, userId, requestKey: body.requestKey, today, now }))) throw changed();
  });
  return await readOr404(deps, gymId, entryId, today, privileges.includes(BILLING));
}
