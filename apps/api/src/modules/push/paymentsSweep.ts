// PAYMENT RECEIVED, TOLD TO THE PHONE (ROADMAP Stage 5 item 20h; Kd, 2026-11-12, `rulings/2026-11-12-20g.md`). A payment or
// purchase in the app that Square confirmed while nobody was waiting on the answer (the worker's minute, or staff's Close
// payment page) owes the member who pressed Pay one notification; one their own phone read as paid owes none, as the
// screen said it. Every minute the worker sends what is owed: each is claimed on its page's row before anything is sent,
// so a second run sends nothing twice, and comes off only once a phone has it (or there was nothing to send: switched off,
// no phone signed in, a day old), so a run that stops halfway loses nothing. Only a page Square said was paid, and that was
// recorded as paid, can owe one (the table's CHECK). It goes at any hour: it follows the person's own payment by minutes.
import { GYM_PAYMENTS_CHANNEL, PUSH_WITHIN_HOURS, paymentNotification } from "@app/shared";
import type { Sql } from "postgres";
import type { PushSender } from "./fcm.adapter.js";
import * as payments from "./paymentsRepo.js";
import * as repo from "./repo.js";
import type { PushSweepResult } from "./sweep.js";

const BATCH = 500;
const PAGE = 500;
const MAX_PAGES = 40;
const AT_ONCE = 10;

export async function sendPaymentNotifications(deps: {
  sql: Sql;
  sender: PushSender;
  now: () => Date;
  /** For tests on a shared database. */
  gymIds?: readonly string[];
  sizes?: { batch: number; page: number };
  /** Told of a failure the run carried on past: the worker logs it. */
  onError?: (err: unknown) => void;
}): Promise<PushSweepResult> {
  const { sql, sender } = deps;
  const batch = deps.sizes?.batch ?? BATCH;
  const page = deps.sizes?.page ?? PAGE;
  const now = deps.now();
  const since = new Date(now.getTime() - PUSH_WITHIN_HOURS * 3_600_000);
  const claimedBefore = new Date(now.getTime() - repo.PUSH_CLAIM_MINUTES * 60_000);
  const result: PushSweepResult = { sent: 0, skipped: 0, waiting: 0, failed: 0 };
  const onError = deps.onError ?? (() => undefined);

  // `reached`: some phone has it, so it is never put back to be sent again. `again`: Firebase did not answer for any
  // phone, so the next run tries again.
  const tell = async (due: payments.DuePayment, state: { reached: boolean; again: boolean }): Promise<void> => {
    const userId = due.userId;
    const tokens = due.stale || userId === null || due.paidFor === null ? [] : await repo.liveTokens(sql, userId, now, "payments");
    if (userId === null || due.paidFor === null || tokens.length === 0) {
      result.skipped += 1;
      return;
    }
    const { title, body } = paymentNotification({ gymName: due.gymName, amountMinor: due.amountMinor, currency: due.currency, paidFor: due.paidFor });
    let failed = false;
    for (const token of tokens) {
      const sent = await sender.send({
        token,
        userId,
        title,
        body,
        // Each payment its own: a second one never replaces the first.
        tag: `payment:${due.id}`,
        channelId: GYM_PAYMENTS_CHANNEL.id,
        data: { kind: "gym_payment", gymId: due.gymId, paymentId: due.id },
      });
      if (sent === "sent") {
        result.sent += 1;
        state.reached = true;
      } else if (sent === "gone") {
        await repo.forgetToken(sql, userId, token);
      } else {
        result.failed += 1;
        failed = true;
      }
    }
    state.again = failed && !state.reached;
    if (state.reached) await repo.noteReached(sql, userId, now).catch(onError);
  };

  const handle = async (due: payments.DuePayment): Promise<void> => {
    const claimedAt = deps.now();
    if (!(await payments.claimPayment(sql, due, { claimedAt, claimedBefore }))) return;
    const state = { reached: false, again: false };
    try {
      await tell(due, state);
    } catch (err) {
      // A failure after the claim (a dropped connection): told to the worker, put back for the next run unless a phone
      // already has it, and the rest of this run goes on.
      onError(err);
      result.failed += 1;
      state.again = !state.reached;
    }
    if (state.again) await payments.unclaimPayment(sql, due, claimedAt).catch(onError);
    else await payments.settlePayment(sql, due, claimedAt).catch(onError);
  };

  let after: payments.DuePaymentMark | null = null;
  let taken = 0;
  for (let pages = 0; pages < MAX_PAGES && taken < batch; pages += 1) {
    const rows = await payments.duePayments(sql, { since, claimedBefore, limit: page, after, gymIds: deps.gymIds });
    const due = rows.slice(0, batch - taken);
    taken += due.length;
    for (let i = 0; i < due.length; i += AT_ONCE) await Promise.all(due.slice(i, i + AT_ONCE).map(handle));
    const last = rows.at(-1);
    if (last === undefined || rows.length < page) break;
    after = { at: last.dueAt, id: last.id };
  }
  return result;
}
