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
// nothing marked sent is tried once more (a second email over none).
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

/** What this gym's round does now. `dueAt` is six months from `round.countedFrom`. */
export function nextStep(round: repo.Round, dueAt: Date, now: Date): Step {
  if (round.monthSentAt === null) {
    if (now.getTime() < plusDays(dueAt, -repo.FIRST_NOTICE_DAYS).getTime()) return { kind: "wait" };
    if (fresh(round.monthClaimedAt, now)) return { kind: "wait" };
    return { kind: "month", deletesAt: later(dueAt, plusDays(now, repo.FIRST_NOTICE_DAYS)) };
  }
  // The month email names a day; it is set whenever that email is.
  const named = round.deletesAt ?? plusDays(round.monthSentAt, repo.FIRST_NOTICE_DAYS);
  if (round.weekSentAt === null) {
    if (now.getTime() < plusDays(named, -LAST_NOTICE_DAYS).getTime()) return { kind: "wait" };
    if (fresh(round.weekClaimedAt, now)) return { kind: "wait" };
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
  deleted: number;
  /** Gyms whose step raised; the worker fails the run so it is seen, and it is retried. */
  failed: number;
}

type Decided =
  | { kind: "none" }
  | { kind: "deleted" }
  | { kind: "send"; notice: repo.Notice; countedFrom: Date; deletesAt: Date };

/** Everyone at the gym who may both pay for its plan and download its list, the two things
 *  the email offers: the owner, and staff given both ticks. */
async function recipients(deps: GoneForGoodDeps, gymId: string): Promise<string[]> {
  const out: string[] = [];
  for (const staff of await repo.staffWithEmail(deps.sql, gymId)) {
    if (
      (await holdsPrivilege(deps, gymId, staff.userId, "billing.manage")) &&
      (await holdsPrivilege(deps, gymId, staff.userId, "members.confirm"))
    ) {
      out.push(staff.email);
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
    const step = nextStep(round, fact.dueAt, now);
    switch (step.kind) {
      case "wait":
        return { kind: "none" };
      case "month":
      case "week":
        await repo.claimNotice(tx, gymId, step.kind, now, step.deletesAt);
        return { kind: "send", notice: step.kind, countedFrom: fact.countedFrom, deletesAt: step.deletesAt };
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

/** Sends one email to each recipient: how many went, or null when none went, nobody can be
 *  emailed included. A failure for some of them counts as sent: the others were told. */
async function send(deps: GoneForGoodDeps, gymId: string, decided: Extract<Decided, { kind: "send" }>): Promise<number | null> {
  const gym = await repo.noticeGym(deps.sql, gymId);
  if (gym === null) return null;
  const to = await recipients(deps, gymId);
  if (to.length === 0) {
    deps.log.info({ event: "orgs.gone_for_good.nobody_to_email", gymId, notice: decided.notice }, "a gym gone for good has nobody to email, so it is kept");
    return null;
  }
  const membersLink = `${deps.mail.webOrigin}/console/${encodeURIComponent(gym.slug)}/members`;
  let sent = 0;
  for (const address of to) {
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
  return sent > 0 ? sent : null;
}

export async function sweepGoneForGood(deps: GoneForGoodDeps, opts: GoneForGoodOptions = {}): Promise<GoneForGoodResult> {
  const now = opts.now ?? new Date();
  const result: GoneForGoodResult = { due: 0, monthSent: 0, weekSent: 0, notSent: 0, deleted: 0, failed: 0 };
  const due = await repo.dueGyms(deps.sql, now, opts.gymIds ?? null);
  result.due = due.length;
  for (const { gymId } of due) {
    let decided: Decided;
    try {
      decided = await decide(deps, gymId, now);
    } catch (err) {
      // One gym's fault never stops the rest; it is tried again on the next run.
      result.failed += 1;
      deps.log.error({ event: "orgs.gone_for_good.gym_failed", gymId, errName: err instanceof Error ? err.name : typeof err }, "a gym gone for good could not be decided");
      continue;
    }
    if (decided.kind === "deleted") {
      result.deleted += 1;
      deps.log.info({ event: "orgs.gone_for_good.list_deleted", gymId }, "a gym gone for good had its list deleted");
      continue;
    }
    if (decided.kind !== "send") continue;
    const claim = { gymId, notice: decided.notice, countedFrom: decided.countedFrom, claimedAt: now };
    const sent = await send(deps, gymId, decided);
    if (sent === null) {
      await repo.releaseClaim(deps.sql, claim);
      result.notSent += 1;
      continue;
    }
    await repo.markSent(deps.sql, { ...claim, recipients: sent, at: now });
    if (decided.notice === "month") result.monthSent += 1;
    else result.weekSent += 1;
  }
  deps.log.info({ ...result, event: "orgs.gone_for_good.finished" }, "gone-for-good sweep finished");
  return result;
}
