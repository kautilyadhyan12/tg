// Invite a friend (ROADMAP Stage 5 item 20a; spec Part 3 §16.3): the member's own link to a
// business and the offer it set, read from `GET /v1/orgs/{gym}/referral`. The offer's words are
// the server's (`referralTickets`, in packages/shared); this file holds the page's own few.
import type { MemberReferralResponse } from "@app/shared";

export type InviteOn = Extract<MemberReferralResponse, { status: "on" }>;

/** What one business's link reads as, for the line on its card and for its page. */
export type InviteHeld =
  | { kind: "loading" }
  | { kind: "failed"; status: number | null }
  | { kind: "off" }
  | { kind: "on"; invite: InviteOn; link: string };

export const invitePath = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}/referral`;

/** The address the member shares: the copy's website and their own `/invite/<code>`. */
export const inviteLink = (webUrl: string, path: string) => `${webUrl}${path}`;

export const INVITE_NOT_READ = "Couldn’t load your invite link.";
export const SHARE_NOT_OPENED = "Couldn’t open sharing. Try again.";

export function inviteNotRead(status: number | null, gymName: string): string {
  return status === 404 ? `${gymName} isn’t showing your invite link right now.` : INVITE_NOT_READ;
}

export const inviteOff = (gymName: string) => `${gymName} has switched off Invite a friend.`;
