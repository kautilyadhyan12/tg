// Staff invited by email (Part 3 §10.3; ROADMAP 4a-i). The owner types an address and a
// role; the app emails fixed words with no token in the link; the person signs in with
// that address and taps Accept, and the console opens with that role and no membership.
import { z } from "zod";
import { authEmailSchema } from "./auth.js";
import { orgRoleSchema, orgStaffSchema, orgTypeSchema, staffAssignableRoleSchema } from "./orgs.js";
import { orgWords } from "./orgWords.js";

/** An invitation nobody accepts stops working after this many days. */
export const STAFF_INVITE_DAYS = 7;
/** Invitations a gym may have waiting at once. */
export const STAFF_INVITES_OPEN_MAX = 20;
/** Staff invitation emails a gym may send in any 24 hours. */
export const STAFF_INVITE_EMAILS_PER_DAY = 20;
/** Staff invitation emails one gym may send one address in any 7 days. */
export const STAFF_INVITE_EMAILS_PER_ADDRESS_WEEK = 3;

/** The Resend tag naming a staff invitation's send row. */
export const STAFF_INVITE_SEND_TAG = "staff_invite_send";

export const createStaffInviteRequestSchema = z
  .object({
    email: authEmailSchema,
    role: staffAssignableRoleSchema,
  })
  .strict();
export type CreateStaffInviteRequest = z.infer<typeof createStaffInviteRequestSchema>;

export const staffInviteParamsSchema = z.object({ gymId: z.string().uuid(), inviteId: z.string().uuid() }).strict();

/** Why a staff invitation's email did not go. */
export const staffInviteEmailReasonSchema = z.enum([
  "invitation_closed",
  "gym_not_active",
  "gym_name",
  "sending_stopped",
  "unsubscribed",
  "complained",
  "bounced",
  "refused",
  "bad_address",
  "no_mail_domain",
  "send_unknown",
  "provider_refused",
  "provider_unavailable",
  "dns_unavailable",
]);
export type StaffInviteEmailReason = z.infer<typeof staffInviteEmailReasonSchema>;

/** The sentence the owner reads beside an invitation whose email did not go. */
export const STAFF_INVITE_EMAIL_REASON_WORDS: Readonly<Record<StaffInviteEmailReason, string>> = {
  invitation_closed: "Email not sent: the invitation was cancelled or answered before it went.",
  gym_not_active: "Email not sent: you didn't have an active plan.",
  gym_name: "Email not sent: your business name can't be used in an email. Update it in Settings.",
  sending_stopped: "Email not sent: your emails are paused because too many bounced or were marked as spam.",
  unsubscribed: "Email not sent: this person unsubscribed from your emails.",
  complained: "Email not sent: this person marked an earlier email from you as spam.",
  bounced: "Email not sent: emails to this address bounce. Check the address with them.",
  refused: "Email not sent: our email provider won't deliver to this address. Ask them for another one.",
  bad_address: "Email not sent: this email address isn't valid.",
  no_mail_domain: "Email not sent: this email address can't receive email. Check it with them.",
  send_unknown: "We couldn't confirm the email was delivered. Ask them to check their inbox and spam folder.",
  provider_refused: "Email not sent: our email provider declined it for a week. Cancel it and invite them again.",
  provider_unavailable: "Email not sent: our email provider was unavailable for a week. Cancel it and invite them again.",
  dns_unavailable: "Email not sent: we couldn't check this address's email service for a week. Cancel it and invite them again.",
};

/** One invitation as the owner sees it on Settings → Staff. `waiting`: open and not yet
 *  answered; `ended`: 7 days passed with no answer; `declined`: they said No thanks. */
export const staffInviteSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string(),
    role: staffAssignableRoleSchema,
    invitedAt: z.string(),
    expiresAt: z.string(),
    state: z.enum(["waiting", "ended", "declined"]),
    /** When they said No thanks; null otherwise. */
    declinedAt: z.string().nullable(),
    /** The email: being sent, sent, or not sent (with `emailReason`). */
    emailStatus: z.enum(["sending", "sent", "not_sent"]),
    emailReason: staffInviteEmailReasonSchema.nullable(),
  })
  .strict();
export type StaffInvite = z.infer<typeof staffInviteSchema>;

export const staffInvitesResponseSchema = z.object({ invites: z.array(staffInviteSchema) }).strict();
export type StaffInvitesResponse = z.infer<typeof staffInvitesResponseSchema>;

/** `invited`: an email is on its way. `added`: the address belongs to somebody already
 *  in this gym, who is staff at once (RULINGS 2026-09-21: appointing a member stays). */
export const createStaffInviteResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("invited"), invite: staffInviteSchema }).strict(),
  z.object({ outcome: z.literal("added"), staff: orgStaffSchema }).strict(),
]);
export type CreateStaffInviteResponse = z.infer<typeof createStaffInviteResponseSchema>;

export const cancelStaffInviteResponseSchema = z.object({ status: z.literal("cancelled") }).strict();
export type CancelStaffInviteResponse = z.infer<typeof cancelStaffInviteResponseSchema>;

// ── The invited person's side ────────────────────────────────────────────────

export const myStaffInvitationSchema = z
  .object({
    id: z.string().uuid(),
    role: staffAssignableRoleSchema,
    gym: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        city: z.string().nullable(),
        orgType: orgTypeSchema,
      })
      .strict(),
    /** The name of the person who sent it, as their account has it. */
    invitedBy: z.string().nullable(),
    expiresAt: z.string(),
    state: z.enum(["pending", "declined"]),
  })
  .strict();
export type MyStaffInvitation = z.infer<typeof myStaffInvitationSchema>;

export const myStaffInvitationsResponseSchema = z
  .object({
    /** The address the invitations were looked up by: the account's own. */
    address: z.string(),
    /** False when this sign-in has not proved the address: nothing is looked up. */
    addressProved: z.boolean(),
    invitations: z.array(myStaffInvitationSchema),
  })
  .strict();
export type MyStaffInvitationsResponse = z.infer<typeof myStaffInvitationsResponseSchema>;

export const staffInvitationParamsSchema = z.object({ invitationId: z.string().uuid() }).strict();

export const acceptStaffInvitationResponseSchema = z
  .object({
    outcome: z.enum(["accepted", "already_staff"]),
    role: orgRoleSchema,
    gym: z
      .object({
        id: z.string().uuid(),
        slug: z.string(),
        name: z.string(),
        orgType: orgTypeSchema,
      })
      .strict(),
  })
  .strict();
export type AcceptStaffInvitationResponse = z.infer<typeof acceptStaffInvitationResponseSchema>;

export const declineStaffInvitationResponseSchema = z.object({ state: z.literal("declined") }).strict();
export type DeclineStaffInvitationResponse = z.infer<typeof declineStaffInvitationResponseSchema>;

/** The role in the words of the gym's kind: "manager", or "trainer" ("coach" at a studio). */
export function staffRoleWord(role: "manager" | "trainer", orgType: unknown): string {
  return role === "manager" ? "manager" : orgWords(orgType).coach;
}

/** The sentences a refusal is answered with. None says whether an address has an account. */
export const STAFF_INVITE_WORDS = {
  already_invited: (email: string): string =>
    `You've already invited ${email}. The invitation is waiting for them to accept.`,
  too_many_open: `You have ${String(STAFF_INVITES_OPEN_MAX)} invitations waiting. Cancel one before sending another.`,
  too_many_today: `You've sent ${String(STAFF_INVITE_EMAILS_PER_DAY)} staff invitations in the last 24 hours. Try again tomorrow.`,
  too_many_to_address: (email: string): string =>
    `You've sent ${email} ${String(STAFF_INVITE_EMAILS_PER_ADDRESS_WEEK)} invitations this week. Try again next week.`,
  sending_off: "Invitation emails aren't switched on yet, so nobody can be invited right now.",
  invite_not_found: "That invitation isn't here any more.",
  no_invitation: (address: string): string =>
    `No staff invitation for ${address}. Sign in with the email address the invitation was sent to.`,
  ended: (gymName: string): string => `This invitation from ${gymName} has ended. Ask them to send you a new one.`,
  address_not_proved: (address: string): string => `To see your invitations, sign in again with a code sent to ${address}.`,
} as const;
