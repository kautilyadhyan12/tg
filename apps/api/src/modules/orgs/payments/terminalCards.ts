// SAVE CARD ON TERMINAL (ROADMAP 18d-ii-b-ii; spec Part 3 §14.5; rulings/2026-10-21-18d-ii-b.md).
//
// Staff holding the payments tick press Save card on Terminal on a person's page. The gym's
// Square Terminal shows the gym's agreement, word for word as on the typed form (Square's
// CONFIRMATION action); the person taps I agree, then inserts or swipes their card there and
// Square saves it on their own customer in the gym's Square account (SAVE_CARD). The console asks
// every few seconds; a page closed meanwhile is finished by the worker, so a card saved at the
// Terminal still lands on the person, and a Terminal that never shows it is cancelled.
//
// THE WORST THING here is somebody else's card saved on the person, or their card saved without
// their own I agree. So a press names the record, read in the path's gym by its payments staff;
// SAVE_CARD is sent only after Square says that Terminal's person agreed to these very words,
// and only on the record's own customer; the card Square answers is read back and kept only
// when it is on that customer, in the account the press began with, through the same step as a
// typed card (`cards.keepCard`). Anything else is stopped at Square and never shown. One save
// waits on a Terminal at a time, and one for a person.
//
// Square answers with no clear answer (no connection, a 5xx) are asked again: a save is ended
// only on Square's own answer, staff's Cancel, the gym leaving that Square account, or a day
// without an answer.
import { randomUUID } from "node:crypto";
import {
  GYM_PAYMENTS_WORDS,
  MEMBER_CARD_WORDS,
  TERMINAL_AGREEMENT,
  cardAgreementWords,
  terminalSaveResponseSchema,
  type SquareTerminalAction,
  type TerminalSaveOutcome,
  type TerminalSaveRequest,
  type TerminalSaveResponse,
} from "@app/shared";
import { lockGym } from "../memberList/repo.js";
import { payerOf } from "../payers/repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import {
  BILLING,
  connectionRefused,
  customerFor,
  entryNotFound,
  keepCard,
  letGoOfCard,
  orgNotFound,
  paidBy,
  readyOrThrow,
  sendOwedCardDisables,
  staffView,
  terminalSaveView,
  unavailable,
  usableCard,
} from "./cards.js";
import * as cards from "./cardsRepo.js";
import * as repo from "./repo.js";
import { accessContext, missingScopes, terminalsOffered, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import type { SquareResult } from "./square.js";
import * as saves from "./terminalCardsRepo.js";
import * as terminalsRepo from "./terminalsRepo.js";

export const TERMINAL_SAVE = {
  /** Square cancels each action after this, at most five minutes ("TerminalAction"). */
  deadline: "PT5M",
  deadlineMs: 5 * 60_000,
  /** After I agree the Terminal shows Square's waiting screen this long for the card step: long
   *  enough for the worker's minute when nobody is on the page. */
  awaitNext: "PT3M",
  /** Still not done this long past Square's own time: Square is asked to cancel it. An offline
   *  Terminal stays PENDING until cancelled (Square's sandbox, measured 2026-10-21). */
  graceMs: 60_000,
  /** One request asks Square about a save at a time, for at most this long. */
  leaseMs: 20_000,
  /** Nobody has asked for this long: the worker asks. */
  idleMs: 20_000,
  /** Square giving no answer at all for a day: given up. */
  giveUpMs: 24 * 60 * 60_000,
  /** A done save is kept this long, for the page that asks how it ended. */
  keepMs: 24 * 60 * 60_000,
  perRun: 50,
} as const;

const saveGone = (): OrgsError => new OrgsError(404, "terminal_save_gone", MEMBER_CARD_WORDS.terminal_save_gone);
const terminalGone = (): OrgsError => new OrgsError(404, "terminal_gone", MEMBER_CARD_WORDS.terminal_gone);
const terminalBusy = (): OrgsError => new OrgsError(409, "terminal_busy", MEMBER_CARD_WORDS.terminal_busy);

/** Why Square's answer ended a save, from its cancel reason. */
function cancelledAs(action: SquareTerminalAction, pickedUp: boolean): TerminalSaveOutcome {
  if (action.cancel_reason === "BUYER_CANCELED") return "cancelled_on_terminal";
  if (action.cancel_reason === "TIMED_OUT") return pickedUp ? "timed_out" : "no_answer";
  return "cancelled";
}

/** Square's own time for an answer, held between the press and now. */
function squareTime(action: SquareTerminalAction, earliest: Date, now: Date): Date {
  const said = action.updated_at == null ? Number.NaN : Date.parse(action.updated_at);
  return Number.isNaN(said) || said < earliest.getTime() || said > now.getTime() ? now : new Date(said);
}

/** How the save ended, or null while it waits; said once for the request that pressed. */
type Step = { done: TerminalSaveOutcome; refusal?: SquareResult<unknown> } | null;

interface Asking {
  deps: PaymentsDeps;
  square: SquareSettings;
  token: string;
  /** The gym's connection to the account the press began with, as read for this look. */
  connectedAt: Date;
  save: saves.SaveRow;
  now: Date;
}

const ended = async (a: Asking, outcome: TerminalSaveOutcome, refusal?: SquareResult<unknown>): Promise<Step> => {
  await saves.finish(a.deps.sql, a.save.id, a.save.state === "saving" ? "saving" : "agreeing", outcome, a.now);
  return refusal === undefined ? { done: outcome } : { done: outcome, refusal };
};

/** The action this step is on: read from Square, or made with the step's own key (asked again,
 *  Square gives back the same action). Null while Square gives no clear answer. */
async function actionOf(a: Asking): Promise<SquareResult<SquareTerminalAction>> {
  const { save, square, token } = a;
  const known = save.state === "agreeing" ? save.confirmActionId : save.saveActionId;
  if (known !== null) return await square.api.getTerminalAction(token, known);
  const made =
    save.state === "agreeing"
      ? await square.api.createTerminalAction(token, {
          idempotencyKey: save.confirmKey,
          deviceId: save.deviceId,
          deadline: TERMINAL_SAVE.deadline,
          type: "CONFIRMATION",
          title: TERMINAL_AGREEMENT.title,
          body: save.words,
          agree: TERMINAL_AGREEMENT.agree,
          disagree: TERMINAL_AGREEMENT.disagree,
          awaitNext: TERMINAL_SAVE.awaitNext,
        })
      : await square.api.createTerminalAction(token, {
          idempotencyKey: save.saveKey,
          deviceId: save.deviceId,
          deadline: TERMINAL_SAVE.deadline,
          type: "SAVE_CARD",
          customerId: save.customerId,
          // Square's own field for the app's record of it: the press, never the person.
          referenceId: save.id,
        });
  if (made.kind !== "ok") return made;
  const kept = save.state === "agreeing" ? await saves.setConfirmAction(a.deps.sql, save.id, made.value.id) : await saves.setSaveAction(a.deps.sql, save.id, made.value.id);
  if (!kept) {
    // The save moved on meanwhile (staff's Cancel): what was just made is stopped.
    await square.api.cancelTerminalAction(token, made.value.id);
    return { kind: "refused", status: 409, code: "SAVE_MOVED_ON" };
  }
  if (save.state === "agreeing") save.confirmActionId = made.value.id;
  else save.saveActionId = made.value.id;
  return made;
}

/** The action is the one this step asked for: this Terminal, this kind, this person. */
function isOurs(a: Asking, action: SquareTerminalAction): boolean {
  const { save } = a;
  const id = save.state === "agreeing" ? save.confirmActionId : save.saveActionId;
  if (action.id !== id) return false;
  if (action.device_id !== undefined && action.device_id !== save.deviceId) return false;
  if (save.state === "agreeing") return action.type === undefined || action.type === "CONFIRMATION";
  if (action.type !== undefined && action.type !== "SAVE_CARD") return false;
  const customer = action.save_card_options?.customer_id;
  return customer == null || customer === save.customerId;
}

/** Past Square's own time with no end from it: Square is asked to cancel. */
async function overdue(a: Asking, action: SquareTerminalAction, since: Date): Promise<Step> {
  if (a.now.getTime() <= since.getTime() + TERMINAL_SAVE.deadlineMs + TERMINAL_SAVE.graceMs) return null;
  const cancel = await a.square.api.cancelTerminalAction(a.token, action.id);
  if (cancel.kind === "ok" && cancel.value.status === "CANCELED") return await ended(a, a.save.pickedUp ? "timed_out" : "no_answer");
  // Asked: its next answer ends it.
  return null;
}

/** Waiting for I agree. */
async function agreeing(a: Asking, action: SquareTerminalAction): Promise<Step> {
  const { save } = a;
  if (save.entryId === null) {
    // The record went meanwhile: nothing is asked of the person.
    if (action.status !== "COMPLETED" && action.status !== "CANCELED") await a.square.api.cancelTerminalAction(a.token, action.id);
    return await ended(a, "gone");
  }
  if (action.status === "CANCELED") return await ended(a, cancelledAs(action, save.pickedUp));
  if (action.status === "COMPLETED") {
    // Agreed to these very words, word for word, or nothing.
    if (action.confirmation_options?.body !== save.words) {
      a.deps.log.error({ event: "square.terminal_words_changed", gymId: save.gymId }, "the Terminal answered for other words than the gym's agreement");
      return await ended(a, "refused");
    }
    const agreed = action.confirmation_options.decision?.has_agreed;
    if (agreed === false) return await ended(a, "not_agreed");
    if (agreed !== true) {
      a.deps.log.error({ event: "square.terminal_no_decision", gymId: save.gymId }, "the Terminal finished the agreement without an answer");
      return await ended(a, "refused");
    }
    if (!(await saves.toSaving(a.deps.sql, save.id, squareTime(action, save.startedAt, a.now)))) return null;
    save.state = "saving";
    save.agreedAt = squareTime(action, save.startedAt, a.now);
    save.pickedUp = true;
    return await step(a);
  }
  return await overdue(a, action, save.startedAt);
}

/** Waiting for the card. */
async function saving(a: Asking, action: SquareTerminalAction): Promise<Step> {
  const { deps, square, token, save } = a;
  if (action.status === "CANCELED") return await ended(a, cancelledAs(action, true));
  if (action.status !== "COMPLETED") {
    if (save.entryId === null) {
      // The record went meanwhile: stopped while Square still lets it be.
      const cancel = await square.api.cancelTerminalAction(token, action.id);
      if (cancel.kind === "ok" && cancel.value.status === "CANCELED") return await ended(a, "gone");
    }
    return await overdue(a, action, save.agreedAt ?? save.startedAt);
  }
  const cardId = action.save_card_options?.card_id;
  if (cardId == null) {
    deps.log.error({ event: "square.terminal_no_card", gymId: save.gymId }, "the Terminal finished saving a card without one");
    return await ended(a, "refused");
  }
  const read = await square.api.retrieveCard(token, cardId);
  if (read.kind === "unavailable") return null;
  if (read.kind === "refused") {
    deps.log.error({ event: "square.terminal_card_unreadable", gymId: save.gymId, status: read.status, code: read.code }, "Square refused the card a Terminal saved");
    return await ended(a, "refused", read);
  }
  const usable = usableCard(read.value, save.customerId, save.accountId);
  if (usable === null || usable.cardId !== cardId) {
    deps.log.error({ event: "square.card_unexpected", gymId: save.gymId }, "the Terminal saved a card that is not the one asked for");
    await letGoOfCard(deps, square, { gymId: save.gymId, environment: save.environment, accountId: save.accountId, cardId });
    return await ended(a, "refused");
  }
  const at = deps.now();
  const kept = await deps.sql.begin(async (tx) => {
    await lockGym(tx, save.gymId);
    const still = await saves.lockSaving(tx, save.id);
    // Already ended by another request: whatever it decided stands.
    if (still === null) return { outcome: null, owed: [] as string[] };
    const owe = async () => [await cards.oweDisable(tx, { gymId: save.gymId, environment: save.environment, accountId: save.accountId, cardId, notBefore: at })];
    if (still.entryId === null || still.agreedAt === null) {
      const owed = await owe();
      await saves.finish(tx, save.id, "saving", "gone", at);
      return { outcome: "gone" as const, owed };
    }
    const done = await keepCard(tx, {
      gymId: save.gymId,
      entryId: still.entryId,
      environment: save.environment,
      accountId: save.accountId,
      connectedAt: a.connectedAt,
      customerId: save.customerId,
      card: usable,
      words: save.words,
      screen: "terminal",
      userId: save.startedBy,
      deviceId: save.deviceId,
      agreedAt: still.agreedAt,
      at,
    });
    const outcome = done.kind === "saved" ? ("saved" as const) : ("gone" as const);
    await saves.finish(tx, save.id, "saving", outcome, at, outcome === "saved" ? cardId : null);
    return { outcome, owed: done.owed };
  });
  if (kept.owed.length > 0) await sendOwedCardDisables(deps, square, kept.owed);
  return kept.outcome === null ? null : { done: kept.outcome };
}

/** One look at Square for the save's step, and whatever follows from Square's answer. */
async function step(a: Asking): Promise<Step> {
  const { deps, save } = a;
  const got = await actionOf(a);
  if (got.kind === "unavailable") {
    if (a.now.getTime() > save.startedAt.getTime() + TERMINAL_SAVE.giveUpMs) {
      deps.log.error({ event: "square.terminal_save_given_up", gymId: save.gymId }, "Square gave no answer about a Terminal save for a day");
      return await ended(a, "no_answer");
    }
    return null;
  }
  if (got.kind === "refused") {
    if (got.code === "SAVE_MOVED_ON") return null;
    deps.log.warn({ event: "square.terminal_action_refused", gymId: save.gymId, status: got.status, code: got.code }, "Square refused a Terminal action");
    return await ended(a, "refused", got);
  }
  const action = got.value;
  if (!isOurs(a, action)) {
    deps.log.error({ event: "square.terminal_action_unexpected", gymId: save.gymId }, "Square answered about another Terminal action");
    return await ended(a, "refused");
  }
  // On the Terminal's screen: Square reads it in progress, or it was answered there.
  if (!save.pickedUp && (action.status === "IN_PROGRESS" || action.status === "COMPLETED")) {
    await saves.setPickedUp(deps.sql, save.id);
    save.pickedUp = true;
  }
  return save.state === "agreeing" ? await agreeing(a, action) : await saving(a, action);
}

/** The gym's token for the Square account the press began with, while it is connected to it;
 *  null once it is not: nothing can be asked or kept there. */
async function tokenFor(deps: PaymentsDeps, square: SquareSettings, save: saves.SaveRow): Promise<{ token: string; connectedAt: Date } | null> {
  const row = await repo.readConnection(deps.sql, save.gymId, square.environment);
  if (row?.state !== "connected" || row.accountId !== save.accountId || row.accessToken === null) return null;
  const token = square.tokens.open(row.accessToken, accessContext(save.gymId));
  return token === null ? null : { token, connectedAt: row.connectedAt };
}

/** Ask Square about a save this request holds, then let it go. */
async function advance(deps: PaymentsDeps, square: SquareSettings, save: saves.SaveRow): Promise<Step> {
  try {
    const now = deps.now();
    const held = await tokenFor(deps, square, save);
    if (held === null) return await ended({ deps, square, token: "", connectedAt: now, save, now }, "gone");
    return await step({ deps, square, ...held, save, now });
  } finally {
    await saves.release(deps.sql, save.id);
  }
}

/** The answer for the page: where the save stands, and Card on file as it is now. */
async function answer(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, saveId: string): Promise<TerminalSaveResponse> {
  const { org } = await requirePrivilege(deps, gymId, userId, BILLING);
  const [save, gym] = await Promise.all([saves.readSave(deps.sql, gymId, entryId, saveId), repo.readGym(deps.sql, gymId)]);
  if (save === null || gym === null) throw saveGone();
  const { cardOnFile } = await staffView(deps, org, userId, entryId);
  return terminalSaveResponseSchema.parse({ save: terminalSaveView(save, gym.country, await pairedTerminals(deps, gymId, save.environment, save.accountId)), cardOnFile });
}

async function pairedTerminals(deps: PaymentsDeps, gymId: string, environment: saves.SaveRow["environment"], accountId: string) {
  return (await terminalsRepo.readTerminals(deps.sql, gymId, environment, accountId)).flatMap((t) =>
    t.state === "paired" && t.deviceId !== null ? [{ id: t.id, serial: t.practice === null ? t.deviceId : null, practice: t.practice, deviceId: t.deviceId }] : [],
  );
}

/** Square's refusal of the first step, in the words the press is answered with. */
function startRefused(refusal: SquareResult<unknown> | undefined): OrgsError {
  if (refusal?.kind === "refused" && refusal.status === 401) return connectionRefused();
  if (refusal?.kind === "refused" && refusal.status === 403) return new OrgsError(409, "terminals_need_allow", GYM_PAYMENTS_WORDS.terminals_need_allow);
  return new OrgsError(409, "terminal_refused", MEMBER_CARD_WORDS.terminal_refused);
}

/** Save card on Terminal: the agreement goes to the chosen Terminal. The same press sent twice
 *  is one save; a save already waiting for the person is answered instead of a second. */
export async function startTerminalSave(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, body: TerminalSaveRequest): Promise<TerminalSaveResponse> {
  await requireWritablePrivilege(deps, gymId, userId, BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  const person = await cards.readPerson(deps.sql, gymId, entryId);
  if (person === null) throw entryNotFound();
  const ready = await readyOrThrow(deps, gymId, gym);
  if (!terminalsOffered(ready.row)) throw new OrgsError(409, "terminals_not_offered", GYM_PAYMENTS_WORDS.terminals_not_offered);
  if (missingScopes(ready.row)) throw new OrgsError(409, "terminals_need_allow", GYM_PAYMENTS_WORDS.terminals_need_allow);
  const payer = await payerOf(deps.sql, gymId, entryId);
  if (payer !== null) throw paidBy(payer.name, person.fullName);
  const terminal = await terminalsRepo.readTerminal(deps.sql, gymId, ready.square.environment, body.terminalId);
  if (terminal?.state !== "paired" || terminal.deviceId === null || terminal.accountId !== ready.row.accountId) throw terminalGone();
  const waiting = await saves.readOpenSaveOf(deps.sql, gymId, entryId, ready.square.environment);
  if (waiting !== null) return await answer(deps, userId, gymId, entryId, waiting.id);

  const customerId = await customerFor(deps, ready, gymId, person);
  const now = deps.now();
  const written = await saves.insertSave(deps.sql, {
    gymId,
    entryId,
    environment: ready.square.environment,
    accountId: ready.row.accountId,
    deviceId: terminal.deviceId,
    customerId,
    requestKey: body.requestKey,
    words: cardAgreementWords(gym.name),
    confirmKey: randomUUID(),
    saveKey: randomUUID(),
    startedBy: userId,
    now,
    checkingUntil: new Date(now.getTime() + TERMINAL_SAVE.leaseMs),
  });
  if (written.kind === "terminal_busy") throw terminalBusy();
  if (written.kind === "key_reused") throw saveGone();
  if (written.kind === "new") {
    const first = await advance(deps, ready.square, written.save);
    if (first?.refusal !== undefined && first.done === "refused") throw startRefused(first.refusal);
  }
  return await answer(deps, userId, gymId, entryId, written.save.id);
}

/** Where the save stands: Square is asked, unless another request is asking right now. */
export async function checkTerminalSave(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, saveId: string): Promise<TerminalSaveResponse> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const square = deps.square;
  if (square === null) throw saveGone();
  const now = deps.now();
  const held = await saves.claimCheck(deps.sql, gymId, entryId, saveId, now, new Date(now.getTime() + TERMINAL_SAVE.leaseMs));
  if (held !== null) await advance(deps, square, held);
  return await answer(deps, userId, gymId, entryId, saveId);
}

/** Cancel: Square is asked to stop the step on the Terminal. Square stops a card save only until
 *  the person confirms their email there; after that the save finishes, and is kept. */
export async function cancelTerminalSave(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, saveId: string): Promise<TerminalSaveResponse> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const square = deps.square;
  if (square === null) throw saveGone();
  if ((await saves.readSave(deps.sql, gymId, entryId, saveId)) === null) throw saveGone();
  const now = deps.now();
  const held = await saves.claimCheck(deps.sql, gymId, entryId, saveId, now, new Date(now.getTime() + TERMINAL_SAVE.leaseMs));
  // Done already, or another request is asking Square this second: the answer says which.
  if (held === null) return await answer(deps, userId, gymId, entryId, saveId);
  const from = held.state === "saving" ? "saving" : "agreeing";
  try {
    const conn = await tokenFor(deps, square, held);
    if (conn === null) {
      await saves.finish(deps.sql, held.id, from, "gone", now);
    } else {
      const a = { deps, square, ...conn, save: held, now };
      const got = await actionOf(a);
      if (got.kind === "unavailable") throw unavailable();
      // Square has no such action to stop: nothing is on the Terminal.
      if (got.kind === "refused" && got.code !== "SAVE_MOVED_ON") await saves.finish(deps.sql, held.id, from, "cancelled", now);
      if (got.kind === "ok" && isOurs(a, got.value)) {
        const stopped = async (action: SquareTerminalAction): Promise<boolean> => {
          if (action.status === "CANCELED") await saves.finish(deps.sql, held.id, from, cancelledAs(action, held.pickedUp), now);
          // The agreement already answered: no card is asked for.
          else if (action.status === "COMPLETED" && from === "agreeing") await saves.finish(deps.sql, held.id, from, "cancelled", now);
          // The card already saved: kept, as Square saved it.
          else if (action.status === "COMPLETED") await step(a);
          else return false;
          return true;
        };
        if (!(await stopped(got.value))) {
          const cancel = await square.api.cancelTerminalAction(conn.token, got.value.id);
          if (cancel.kind === "unavailable") throw unavailable();
          if (cancel.kind === "ok" && isOurs(a, cancel.value)) await stopped(cancel.value);
          // Asked (CANCEL_REQUESTED), or refused as too late (the person confirmed their email on
          // the Terminal): Square's next answer ends it.
        }
      }
    }
  } finally {
    await saves.release(deps.sql, held.id);
  }
  return await answer(deps, userId, gymId, entryId, saveId);
}

/** The worker's minute: saves nobody has asked about since a page closed, and done ones to forget.
 *  `gymIds`: only these gyms, for a test sharing its database; production passes null. */
export async function processTerminalSaves(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null = null): Promise<{ asked: number; forgotten: number }> {
  const now = deps.now();
  const idle = await saves.claimIdle(deps.sql, square.environment, now, TERMINAL_SAVE.idleMs, new Date(now.getTime() + TERMINAL_SAVE.leaseMs), TERMINAL_SAVE.perRun, gymIds);
  for (const save of idle) await advance(deps, square, save);
  const forgotten = await saves.forgetDone(deps.sql, new Date(now.getTime() - TERMINAL_SAVE.keepMs), gymIds);
  return { asked: idle.length, forgotten };
}
