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

/** `uploadsOf` keeps the staged-uploads part to those gyms: for a test, which shares its
 *  database with other files' staged uploads. The worker passes none. */
export async function hourlyTidyUp(deps: MemberListExpiryDeps, now: Date = new Date(), uploadsOf?: readonly string[]): Promise<HourlyTidyUpResult> {
  const gone = await expireStagedMemberListUploads(deps, uploadsOf === undefined ? { now } : { now, gymIds: [...uploadsOf] });
  const staffInvitesForgotten = await forgetOldStaffInvites(deps.sql, now);
  const groupMessages = await forgetOldGroupMessages(deps.sql, now);
  return { ...gone, staffInvitesForgotten, groupMessagesForgotten: groupMessages.messages };
}
