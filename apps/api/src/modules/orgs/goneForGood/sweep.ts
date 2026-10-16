// A GYM GONE FOR GOOD (ROADMAP Stage 4 item 14; Kd, RULINGS 2026-10-02): a gym with no
// paid plan and no sign-in from any of its staff for six months has its member list,
// leads and staff invitations deleted. Its billing staff are emailed a month before and a
// week before, each email naming the day. Members' own accounts and history are never
// touched (`deleteListForGym` lets an app member's visits go of the record and keeps
// them). A sign-in or a plan starts the six months again, and the emails with them.
//
// Never earlier than promised: the first email names a day at least 30 days on, the
// second at least 7 days on, and the list goes only once that day has come and the
// second email went a week before. An email that could not go is tried again by the next
// run, and the day moves with it. A gym with nobody who can be emailed is never emptied:
// its first email waits, and is tried again every night.
//
// Each gym is decided under its own row's lock, the lock a payment takes (`billing/repo.ts`)
// and a member-list write takes, so a plan starting at that instant is either seen or
// waits. A sign-in takes no gym lock: one in the same instant as the deletion, a week
// after the last email, is not seen. The email goes after that transaction, so no lock is held over the network; a
// claim made first stops a second run sending it again, and a claim an hour old with
// nothing marked sent is tried once more (a second email over none). Claims are stamped
// and timed by the database's clock, never the night's: a run that started long ago does
// not make another run's claim look old.
//
// Only a proved address is emailed (`repo.staffWithEmail`), and one address gets one of
// these emails a night (`repo.toldElsewhereTonight`, kept in the database so a retry of the
// night sees it): a person with several gyms gone dark hears of one a night, and the others
// wait, their days moving with them. The worker sends them from the invitations'
// sender, never the sign-in codes' (`worker.ts`).
//
// The worker runs it nightly (`worker.ts`); `nextStep` is the rule, pure, table-tested.
import type { Sql } from "postgres";
import type { EmailTransport } from "../../../email/resend.js";
import { deleteLeadsForGym } from "../leads/repo.js";
import { deleteListForGym } from "../memberList/repo.js";
import { insertAudit, lockOrgRow } from "../repo.js";
import { holdsPrivilege } from "../service.js";
import { deleteStaffInvitesForGym } from "../staffInvites/repo.js";
import { goneForGoodEmail } from "./emails.js";
import * as repo from "./repo.js";

export { FIRST_NOTICE_DAYS, GONE_AFTER_MONTHS } from "./repo.js";

/** The second email goes this many days before the day it names. */
export const LAST_NOTICE_DAYS = 7;
/** A claim this old with nothing marked sent is taken again. */
export const CLAIM_STALE_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Step =
  | { kind: "wait" }
  | { kind: "month"; deletesAt: Date }
  | { kind: "week"; deletesAt: Date }
  | { kind: "delete" };

const later = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);
const plusDays = (at: Date, days: number): Date => new Date(at.getTime() + days * DAY_MS);
const fresh = (claimedAt: Date | null, now: Date): boolean => claimedAt !== null && now.getTime() - claimedAt.getTime() < CLAIM_STALE_MS;

/** What this gym's round does now. `dueAt` is six months from `round.countedFrom`;
 *  `claimNow` is the clock claims are stamped with (`repo.claimClock`), `now` the night's. */
export function nextStep(round: repo.Round, dueAt: Date, now: Date, claimNow: Date = now): Step {
  if (round.monthSentAt === null) {
    if (now.getTime() < plusDays(dueAt, -repo.FIRST_NOTICE_DAYS).getTime()) return { kind: "wait" };
    if (fresh(round.monthClaimedAt, claimNow)) return { kind: "wait" };
    return { kind: "month", deletesAt: later(dueAt, plusDays(now, repo.FIRST_NOTICE_DAYS)) };
  }
  // The month email names a day; it is set whenever that email is.
  const named = round.deletesAt ?? plusDays(round.monthSentAt, repo.FIRST_NOTICE_DAYS);
  if (round.weekSentAt === null) {
    if (now.getTime() < plusDays(named, -LAST_NOTICE_DAYS).getTime()) return { kind: "wait" };
    if (fresh(round.weekClaimedAt, claimNow)) return { kind: "wait" };
    return { kind: "week", deletesAt: later(named, plusDays(now, LAST_NOTICE_DAYS)) };
  }
  if (now.getTime() >= named.getTime() && now.getTime() >= plusDays(round.weekSentAt, LAST_NOTICE_DAYS).getTime()) {
    return { kind: "delete" };
  }
  return { kind: "wait" };
}

export interface GoneForGoodMail {
  transport: EmailTransport;
  webOrigin: string;
}

export interface GoneForGoodDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  mail: GoneForGoodMail;
}

export interface GoneForGoodOptions {
  now?: Date;
  /** Bound the run to named gyms (tests: the sweep is table-wide). Omitted = every gym. */
  gymIds?: readonly string[];
}

export interface GoneForGoodResult {
  due: number;
  monthSent: number;
  weekSent: number;
  /** An email that could not go to anybody it was meant for; tried again next run. */
  notSent: number;
  /** Waiting a night: one of its addresses was emailed about another gym tonight. */
  held: number;
  deleted: number;
  /** Gyms whose step raised; the worker fails the run so it is seen, and it is retried. */
  failed: number;
}

type Decided =
  | { kind: "none" }
  | { kind: "deleted" }
  | { kind: "send"; notice: repo.Notice; countedFrom: Date; deletesAt: Date; claimedAt: Date };

type Sent = { kind: "sent"; count: number } | { kind: "none" } | { kind: "held" };

/** Everyone at the gym who may both pay for its plan and download its list, the two things
 *  the email offers: the owner, and staff given both ticks. Those who may also record
 *  payments are told to download them too (18n). */
async function recipients(deps: GoneForGoodDeps, gymId: string): Promise<{ userId: string; email: string; payments: boolean }[]> {
  const out: { userId: string; email: string; payments: boolean }[] = [];
  for (const staff of await repo.staffWithEmail(deps.sql, gymId)) {
    if (
      (await holdsPrivilege(deps, gymId, staff.userId, "billing.manage")) &&
      (await holdsPrivilege(deps, gymId, staff.userId, "members.confirm"))
    ) {
      out.push({ ...staff, payments: await holdsPrivilege(deps, gymId, staff.userId, "billing.members") });
    }
  }
  return out;
}

async function decide(deps: GoneForGoodDeps, gymId: string, now: Date): Promise<Decided> {
  return await deps.sql.begin(async (tx): Promise<Decided> => {
    await lockOrgRow(tx, gymId);
    // Asked again under the lock: a payment, or a sign-in committed, since the list was read wins.
    const [fact] = await repo.dueGyms(tx, now, [gymId]);
    if (fact === undefined) return { kind: "none" };
    const round = await repo.roundFor(tx, gymId, fact.countedFrom);
    const clock = await repo.claimClock(tx);
    const step = nextStep(round, fact.dueAt, now, clock);
    switch (step.kind) {
      case "wait":
        return { kind: "none" };
      case "month":
      case "week":
        await repo.claimNotice(tx, gymId, step.kind, clock, step.deletesAt);
        return { kind: "send", notice: step.kind, countedFrom: fact.countedFrom, deletesAt: step.deletesAt, claimedAt: clock };
      case "delete":
        await deleteLeadsForGym(tx, gymId);
        await deleteStaffInvitesForGym(tx, gymId);
        await deleteListForGym(tx, gymId, now);
        await repo.markListDeleted(tx, gymId, now);
        // No actor: nobody chose it. The record of why, for whoever asks.
        await insertAudit(tx, {
          actorUserId: null,
          gymId,
          action: "org.member_list_deleted",
          targetType: "gym",
          targetId: gymId,
          meta: { via: "gone_for_good", countedFrom: fact.countedFrom.toISOString() },
        });
        return { kind: "deleted" };
    }
  });
}

/** Sends one email to each recipient: how many went; none, nobody can be emailed included;
 *  or held, when one of them was emailed tonight already. A failure for some of them counts
 *  as sent: the others were told. */
async function send(
  deps: GoneForGoodDeps,
  gymId: string,
  decided: Extract<Decided, { kind: "send" }>,
  now: Date,
): Promise<Sent> {
  const gym = await repo.noticeGym(deps.sql, gymId);
  if (gym === null) return { kind: "none" };
  const to = await recipients(deps, gymId);
  if (to.length === 0) {
    deps.log.info({ event: "orgs.gone_for_good.nobody_to_email", gymId, notice: decided.notice }, "a gym gone for good has nobody to email, so it is kept");
    return { kind: "none" };
  }
  if (await repo.toldElsewhereTonight(deps.sql, gymId, to.map((staff) => staff.userId), now)) return { kind: "held" };
  const membersLink = `${deps.mail.webOrigin}/console/${encodeURIComponent(gym.slug)}/members`;
  let sent = 0;
  for (const { email: address, payments } of to) {
    try {
      await deps.mail.transport.send(
        goneForGoodEmail({
          to: address,
          notice: decided.notice,
          gymName: gym.name,
          orgType: gym.orgType,
          timezone: gym.timezone,
          countedFrom: decided.countedFrom,
          deletesAt: decided.deletesAt,
          membersLink,
          payments,
        }),
      );
      sent += 1;
    } catch (err) {
      // Never the address.
      deps.log.error(
        { event: "orgs.gone_for_good.email_failed", gymId, notice: decided.notice, errName: err instanceof Error ? err.name : typeof err },
        "a gone-for-good email could not be sent",
      );
    }
  }
  return sent > 0 ? { kind: "sent", count: sent } : { kind: "none" };
}

/** One gym's night: decided under its lock, then its email, if one is due. */
async function gymNight(deps: GoneForGoodDeps, gymId: string, now: Date, result: GoneForGoodResult): Promise<void> {
  const decided = await decide(deps, gymId, now);
  if (decided.kind === "deleted") {
    result.deleted += 1;
    deps.log.info({ event: "orgs.gone_for_good.list_deleted", gymId }, "a gym gone for good had its list deleted");
    return;
  }
  if (decided.kind !== "send") return;
  const claim = { gymId, notice: decided.notice, countedFrom: decided.countedFrom, claimedAt: decided.claimedAt };
  const sent = await send(deps, gymId, decided, now);
  if (sent.kind !== "sent") {
    await repo.releaseClaim(deps.sql, claim);
    if (sent.kind === "held") result.held += 1;
    else result.notSent += 1;
    return;
  }
  if (!(await repo.markSent(deps.sql, { ...claim, recipients: sent.count, at: now }))) {
    // Another run took the claim over, or the round started again, while this one sent.
    deps.log.info({ event: "orgs.gone_for_good.sent_not_marked", gymId, notice: decided.notice }, "a gone-for-good email went under a claim no longer held");
    return;
  }
  if (decided.notice === "month") result.monthSent += 1;
  else result.weekSent += 1;
}

export async function sweepGoneForGood(deps: GoneForGoodDeps, opts: GoneForGoodOptions = {}): Promise<GoneForGoodResult> {
  const now = opts.now ?? new Date();
  const result: GoneForGoodResult = { due: 0, monthSent: 0, weekSent: 0, notSent: 0, held: 0, deleted: 0, failed: 0 };
  const due = await repo.dueGyms(deps.sql, now, opts.gymIds ?? null);
  result.due = due.length;
  for (const { gymId } of due) {
    try {
      await gymNight(deps, gymId, now, result);
    } catch (err) {
      // One gym's fault never stops the rest; it is tried again on the next run. A claim
      // left behind is taken again once it is an hour old.
      result.failed += 1;
      deps.log.error({ event: "orgs.gone_for_good.gym_failed", gymId, errName: err instanceof Error ? err.name : typeof err }, "a gym gone for good could not be decided");
    }
  }
  deps.log.info({ ...result, event: "orgs.gone_for_good.finished" }, "gone-for-good sweep finished");
  return result;
}
