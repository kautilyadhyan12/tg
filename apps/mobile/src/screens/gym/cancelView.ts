// Cancel and Keep a membership on the phone (ROADMAP Stage 5 item 20j; spec Part 3 §14.8, "Cancelling"; the server is
// 18l's and 18l-ii-a's, `rulings/2026-11-11-18l.md`). The server works out every sentence the boxes say; the phone shows
// them, sends back the key of what it showed, and says what happened. Pure.
import { MY_CANCEL_REASONS, MY_CANCEL_REASON_WORDS, type MyCancelReason } from "@app/shared";

export const myCancelPath = (gymId: string, membershipId: string): string => `/v1/orgs/${gymId}/my-membership/memberships/${membershipId}/cancel`;
export const myKeepPath = (gymId: string, membershipId: string): string => `/v1/orgs/${gymId}/my-membership/memberships/${membershipId}/keep`;
export const myCancelReasonPath = (gymId: string, cancelId: string): string => `/v1/orgs/${gymId}/my-membership/cancels/${cancelId}/reason`;

export const cancelTitle = (name: string): string => `Cancel ${name}?`;
export const keepTitle = (name: string): string => `Keep ${name}?`;
export const GO_BACK = "Go back";
export const CLOSE = "Close";
export const DONE = "Done";
export const SKIP = "Skip";
export const EMAILED = "A confirmation was emailed to you.";
export const COULD_NOT_READ = "Couldn’t load this. Check your internet and try again.";
export const NO_ANSWER_PRESS = "Couldn’t connect, so we don’t know if it went through. Check your internet and press it again.";
export const REASON_NOT_SAVED = "Couldn’t send your answer. Check your internet and try again.";
export const REASON_THANKS = "Thanks for telling us.";
/** The box read again after the server said what it showed had changed: the new box is under this line. */
export const CHANGED_LINE = "This changed since you opened it. Check it again below.";
/** The server has nothing to show: it was cancelled or changed elsewhere, and the page behind reads it again on close. */
export const NOTHING_HERE = "This membership has changed. Close this to see it as it is now.";

/** "Why are you leaving?": the server's own fixed list, in its order. */
export const REASON_OPTIONS: readonly { value: MyCancelReason; label: string }[] = MY_CANCEL_REASONS.map((value) => ({ value, label: MY_CANCEL_REASON_WORDS[value] }));

/** What a refusal shows in the box. `final`: only Close is left. `reread`: the box reads what to show again, as what
 *  it showed has changed. The server's own sentence is shown where it wrote one for the member (409). */
export interface Refused {
  line: string;
  final: boolean;
  reread: boolean;
}

const STANDS = new Set(["paid_by_someone", "early_payment", "cooling_off_part_paid", "leave_fee_paid"]);
const CHANGED = new Set(["cancel_changed", "keep_changed", "request_reused"]);

export function refusedLine(status: number, error: string, message: string): Refused {
  // The box reads itself again under this line, so the server's "go back and look again" is not said.
  if (status === 409 && CHANGED.has(error)) return { line: CHANGED_LINE, final: false, reread: true };
  if (status === 409 && message.trim() !== "") return { line: message, final: STANDS.has(error), reread: false };
  if (status === 404) return { line: "This membership isn’t on your list any more.", final: true, reread: false };
  if (status === 429) return { line: "Too many tries. Please wait a few minutes and try again.", final: false, reread: false };
  return { line: "Something went wrong. Try again.", final: false, reread: false };
}
