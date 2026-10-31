// REFUNDS TO REVIEW (ROADMAP 18d-iv-b-iii; spec Part 3 §14.8; Kd, `rulings/2026-10-31-18d-iv-b-i.md`): money a gym may have to give
// back, on Overview. THE WORST THING is the list telling staff to refund what Square already gave back. So nothing here sends
// anything: Refund opens the box that reads Square first and refuses more than is left, and a row says only what the app knows.
import {
  REFUNDS_TO_REVIEW_PAGE,
  REFUND_REVIEW_WORDS,
  refundsToReviewResponseSchema,
  type RefundsToReviewResponse,
} from "@app/shared";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { BILLING } from "./cards.js";
import * as repo from "./refundsToReviewRepo.js";
import type { PaymentsDeps } from "./service.js";

const NO_MEMBERS = "Refunds on a member's payment need \"Keep the member list and invite\". Ask the owner to turn it on for you.";
const MEMBERS = "members.confirm";

/** A page of the list. Staff who may sell see its sales; a person's rows also need the member-list tick, as their page does. */
export async function readRefundsToReview(deps: PaymentsDeps, userId: string, gymId: string, from: number): Promise<RefundsToReviewResponse> {
  const { privileges } = await requirePrivilege(deps, gymId, userId, BILLING);
  const { count, rows } = await repo.refundsToReview(deps.sql, gymId, privileges.includes(MEMBERS), deps.now(), from, REFUNDS_TO_REVIEW_PAGE);
  const next = from + REFUNDS_TO_REVIEW_PAGE < count ? from + REFUNDS_TO_REVIEW_PAGE : null;
  return refundsToReviewResponseSchema.parse({ count, rows, next });
}

function answer(outcome: repo.ReviewOutcome): void {
  if (outcome === "done") return;
  if (outcome === "not_found") throw new OrgsError(404, "refund_review_not_found", "That was not found.");
  if (outcome === "waiting") throw new OrgsError(409, "card_refund_waiting", REFUND_REVIEW_WORDS.waiting);
  throw new OrgsError(409, "refund_review_changed", REFUND_REVIEW_WORDS.changed);
}

/** Keep the fee: a fee is always a member's. */
export async function keepFee(deps: PaymentsDeps, userId: string, gymId: string, billId: string): Promise<void> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, userId, BILLING);
  if (!privileges.includes(MEMBERS)) throw new OrgsError(403, "forbidden", NO_MEMBERS);
  answer(await repo.keepFee(deps.sql, gymId, billId, userId, deps.now()));
}

/** No refund needed, on a refund that failed or that Square never answered. */
export async function noRefundNeeded(deps: PaymentsDeps, userId: string, gymId: string, pressId: string): Promise<void> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, userId, BILLING);
  const press = await repo.pressForReview(deps.sql, gymId, pressId);
  if (press === null) answer("not_found");
  if (press?.paymentId != null && !privileges.includes(MEMBERS)) throw new OrgsError(403, "forbidden", NO_MEMBERS);
  answer(await repo.noRefundNeeded(deps.sql, gymId, pressId, userId, deps.now()));
}
