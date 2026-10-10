// THE HOURLY TIDY-UP: what the worker's `orgs.member_list_expiry` job removes on each run.
// One function, so that a test runs exactly what the worker runs.
import { expireStagedMemberListUploads, type MemberListExpiryDeps } from "./memberList/expiry.js";
import { forgetOldGroupMessages } from "./messages/group.js";
import { forgetOldStaffInvites } from "./staffInvites/repo.js";

export interface HourlyTidyUpResult {
  /** Staged member-list uploads past their time. */
  expired: number;
  /** Staff invitations past their keeping (4a-i). */
  staffInvitesForgotten: number;
  /** Messages to groups past their year (20f-ii), each removed with every copy. */
  groupMessagesForgotten: number;
}

export async function hourlyTidyUp(deps: MemberListExpiryDeps, now: Date = new Date()): Promise<HourlyTidyUpResult> {
  const gone = await expireStagedMemberListUploads(deps, { now });
  const staffInvitesForgotten = await forgetOldStaffInvites(deps.sql, now);
  const groupMessages = await forgetOldGroupMessages(deps.sql, now);
  return { ...gone, staffInvitesForgotten, groupMessagesForgotten: groupMessages.messages };
}
