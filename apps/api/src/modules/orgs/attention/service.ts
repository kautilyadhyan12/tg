// What waits for the business's staff (ROADMAP V1-d; spec Part 3 §17.11): the menu's counts
// and the bell's "Needs attention", in one read. Counts only. Each part is its own page's or
// box's figure, read by that page's own count, and is sent only to somebody holding the
// ticks that page's own route asks for:
//
//   chargebacks     Overview's box        `billing.members`
//   failedPayments  Failed payments       `members.confirm` and `billing.members`
//   paymentDue      Last 7 days, Members  `members.confirm`
//   refunds         Overview's box        `billing.members`
//   appPayments     Overview's box        `billing.members` and `members.confirm`
//   appCancels      Overview's box        `members.confirm`
//   newLeads        Leads                 `members.confirm`
//   atRisk          At risk               `members.read`
//   reported        Updates               `posts.manage`
import type { Sql } from "postgres";
import { attentionResponseSchema, type Attention, type AttentionResponse, type OrgPrivilege } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { countAtRisk } from "../atRisk/service.js";
import { countNewLeads } from "../leads/repo.js";
import { readAppPaymentChecks } from "../memberships/appChecks.js";
import { heldAndOverIn } from "../memberships/over.js";
import { recentCancels } from "../myMembership/cancelRepo.js";
import { chargebacksToAnswer } from "../payments/chargebacksRepo.js";
import { failedTotals } from "../payments/failedPaymentsRepo.js";
import { refundsToReview } from "../payments/refundsToReviewRepo.js";
import { countReported } from "../posts/repo.js";
import { reportedComments } from "../posts/commentsRepo.js";
import { requireStaff } from "../service.js";
import { paymentDueIn } from "../week/service.js";

export interface AttentionDeps {
  sql: Sql;
  now: () => Date;
}

export interface AttentionReader {
  timezone: string;
  privileges: readonly OrgPrivilege[];
}

/** Anybody on this business's staff, with the ticks they hold; anybody else is refused (404). */
export async function requireAttentionReader(deps: AttentionDeps, userId: string, gymId: string): Promise<AttentionReader> {
  const { org, privileges } = await requireStaff(deps, gymId, userId);
  return { timezone: org.timezone, privileges };
}

/** The counts, for a business whose reader has been checked. */
export async function getAttention(deps: AttentionDeps, gymId: string, userId: string, reader: AttentionReader): Promise<AttentionResponse> {
  const now = deps.now();
  const today = dayInTz(now, reader.timezone);
  const may = (...ticks: OrgPrivilege[]): boolean => ticks.every((t) => reader.privileges.includes(t));
  const members = may("members.confirm");

  const [chargebacks, failedPayments, paymentDue, refunds, appPayments, appCancels, newLeads, atRisk, reported] = await Promise.all([
    may("billing.members") ? chargebacksToAnswer(deps.sql, gymId, members, now, 0, 1).then(({ count }) => ({ count })) : null,
    may("members.confirm", "billing.members") ? failedTotals(deps.sql, gymId) : null,
    members
      ? deps.sql.begin("isolation level repeatable read read only", async (tx) => {
          const { held } = await heldAndOverIn(tx, gymId, today, null);
          return paymentDueIn(tx, gymId, today, held);
        })
      : null,
    may("billing.members") ? refundsToReview(deps.sql, gymId, members, now, 0, 1).then(({ count }) => ({ count })) : null,
    may("billing.members", "members.confirm")
      ? readAppPaymentChecks(deps, userId, gymId).then(({ rows, more }) => ({ count: rows.length, more }))
      : null,
    members ? recentCancels(deps.sql, gymId, now).then(({ count }) => ({ count })) : null,
    members ? countNewLeads(deps.sql, gymId).then((count) => ({ count })) : null,
    may("members.read") ? countAtRisk(deps.sql, gymId, now).then((count) => (count === null ? null : { count })) : null,
    may("posts.manage")
      ? Promise.all([countReported(deps.sql, gymId), reportedComments(deps.sql, gymId, 1)]).then(([posts, rows]) => ({ posts, comments: rows[0]?.total ?? 0 }))
      : null,
  ]);

  const attention: Attention = { chargebacks, failedPayments, paymentDue, refunds, appPayments, appCancels, newLeads, atRisk, reported };
  return attentionResponseSchema.parse({ attention });
}
