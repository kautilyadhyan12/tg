// Inviting the people on a gym's list to the app (Part 3 §9.12, §10.2, §11.5;
// ROADMAP 3b-i-a). Staff ask who an Invite would reach, press it, invite one person,
// or send one person's invitation again when that person asks. The worker sends each
// email and checks it again just before it goes.
//
// The filters an Invite takes are the list's own, so the preview and the press are in
// memberList.ts beside them; this file imports nothing from it.
import { z } from "zod";

/** The longest postal address a gym may keep for its invitations' footer. */
export const GYM_POSTAL_ADDRESS_MAX_CHARS = 200;

/** Where an invitation stands (§10.2). Only `pending` is written by this job;
 *  `accepted`, `declined` and `withdrawn` (a person taken off or removed) are 3b-ii's. */
export const memberInviteStateSchema = z.enum(["pending", "accepted", "declined", "withdrawn"]);
export type MemberInviteState = z.infer<typeof memberInviteStateSchema>;

/** Where one invitation email stands. */
export const memberInviteEmailStateSchema = z.enum(["queued", "sending", "sent", "skipped", "failed"]);
export type MemberInviteEmailState = z.infer<typeof memberInviteEmailStateSchema>;

/** Why an email was not sent, decided just before it would have gone. */
export const memberInviteEmailReasonSchema = z.enum([
  "not_on_list",
  "in_app",
  "unsubscribed",
  "complained",
  "bounced",
  "refused",
  "shared_address",
  "bad_address",
  "no_mail_domain",
  "invitation_closed",
  "gym_not_active",
  "no_postal_address",
  "gym_name",
  "send_unknown",
  "provider_refused",
  "provider_unavailable",
  "dns_unavailable",
  "sending_stopped",
]);
export type MemberInviteEmailReason = z.infer<typeof memberInviteEmailReasonSchema>;

/** The sentence staff read beside an email that did not go. */
export const MEMBER_INVITE_EMAIL_REASON_WORDS: Readonly<Record<MemberInviteEmailReason, string>> = {
  not_on_list: "Not sent: this address was no longer on your list when it was due to go.",
  in_app: "Not sent: this person is already a member in the app.",
  unsubscribed: "Not sent: this person unsubscribed from your emails.",
  complained: "Not sent: this person marked an earlier email from you as spam.",
  bounced: "Not sent: emails to this address bounce.",
  refused: "Not sent: our email service won't deliver to this address. Ask the person for another one.",
  shared_address: "Not sent: this is a shared address such as info@ or support@. Ask the person for their own.",
  bad_address: "Not sent: this email address isn't valid.",
  no_mail_domain: "Not sent: this email address can't receive email. Check it with the person.",
  invitation_closed: "Not sent: this person has already answered the invitation.",
  gym_not_active: "Not sent: your gym had no active plan when it was due to go.",
  no_postal_address: "Not sent: your gym had no postal address when it was due to go.",
  gym_name: "Not sent: your gym's name can't be shown in an email. Change it in Settings.",
  send_unknown: "We couldn't confirm this email went. Only send it again if the person says they didn't get it.",
  provider_refused: "Not sent: the email service would not take it for a week. Invite them again.",
  provider_unavailable: "Not sent: the email service could not be reached for a week. Invite them again.",
  dns_unavailable: "Not sent: we could not check this address's email service for a week. Invite them again.",
  sending_stopped: "Not sent: your gym's invitations were stopped because too many bounced or one was marked as spam.",
};

/** What the email service reported about an email that went (§9.12), once its own
 *  record agreed. Null until a report arrives. */
export const memberInviteEmailResultSchema = z.enum(["delivered", "bounced", "complained", "failed", "refused"]);
export type MemberInviteEmailResult = z.infer<typeof memberInviteEmailResultSchema>;

/** The sentence staff read beside an email that went but did not arrive, or was marked
 *  as spam. A delivered email needs none. */
export const MEMBER_INVITE_EMAIL_RESULT_WORDS: Readonly<Record<Exclude<MemberInviteEmailResult, "delivered">, string>> = {
  bounced: "This email bounced: the address doesn't take email. Check it with the person.",
  complained: "This person marked the invitation as spam. Your gym won't email them again.",
  failed: "This email didn't arrive. Check the address with the person.",
  refused: "Not delivered: our email service won't deliver to this address. Ask the person for another one.",
};

/** Why somebody in the chosen group is not invited by a press. */
export const memberInviteSkipReasonSchema = z.enum(["no_email", "in_app", "already_invited", "unsubscribed", "bounced", "refused", "shared_address"]);
export type MemberInviteSkipReason = z.infer<typeof memberInviteSkipReasonSchema>;

/** How many of the group each reason leaves out. They partition the group with
 *  `reach`: each person is counted once, under the first reason in this order. */
export const memberInviteSkippedSchema = z
  .object({
    noEmail: z.number().int().min(0),
    inApp: z.number().int().min(0),
    alreadyInvited: z.number().int().min(0),
    unsubscribed: z.number().int().min(0),
    bounced: z.number().int().min(0),
    /** Addresses our email service won't deliver to (its own list). */
    refused: z.number().int().min(0),
    sharedAddress: z.number().int().min(0),
  })
  .strict();
export type MemberInviteSkipped = z.infer<typeof memberInviteSkippedSchema>;

/** Why a gym cannot send invitations at all right now. */
export const memberInviteBlockedSchema = z.enum(["no_postal_address", "gym_not_on_plan", "gym_archived", "invites_off", "sending_stopped"]);
export type MemberInviteBlocked = z.infer<typeof memberInviteBlockedSchema>;

/** One person's invitation, as their page and the list show it. */
export const memberListInvitationSchema = z
  .object({
    state: memberInviteStateSchema,
    invitedAt: z.string(),
    /** The newest email for it, or null if none was ever queued. */
    email: z
      .object({
        state: memberInviteEmailStateSchema,
        reason: memberInviteEmailReasonSchema.nullable(),
        at: z.string(),
        /** What the email service reported, for an email that went. */
        result: memberInviteEmailResultSchema.nullable(),
      })
      .strict()
      .nullable(),
    /** How many times it was sent again at the person's request and went. */
    sentAgain: z.number().int().min(0),
  })
  .strict();
export type MemberListInvitation = z.infer<typeof memberListInvitationSchema>;

/** The list page's filter by invitation (§11.5). */
export const memberListInvitationFilterSchema = z.enum(["not_invited", "pending", "accepted", "declined", "withdrawn"]);
export type MemberListInvitationFilter = z.infer<typeof memberListInvitationFilterSchema>;

/** What inviting one person did. */
export const memberInviteOneOutcomeSchema = z.enum(["queued", "already_invited", "already_queued"]);
export type MemberInviteOneOutcome = z.infer<typeof memberInviteOneOutcomeSchema>;

export const memberInviteOneSchema = z
  .object({ outcome: memberInviteOneOutcomeSchema, invitation: memberListInvitationSchema })
  .strict();
export type MemberInviteOne = z.infer<typeof memberInviteOneSchema>;

export const memberInviteOneResponseSchema = z.object({ invite: memberInviteOneSchema });

/** "Send again" is for one person who asked, never in bulk and never on a timer. */
export const MEMBER_INVITE_AGAIN_PER_PERSON = 3;
export const MEMBER_INVITE_AGAIN_PERSON_DAYS = 30;
export const MEMBER_INVITE_AGAIN_PER_GYM_DAY = 20;

/** The server's sentences for invitations, printed as sent. */
export const MEMBER_INVITE_WORDS = {
  invite_changed: "Your list changed while you were looking, so nobody was invited. Check the number again.",
  no_postal_address: "Add your gym's postal address in Settings first. Every invitation shows it, as the law requires.",
  invites_off: "Invitations can't be sent yet.",
  sending_stopped:
    "Your gym's invitations are stopped because too many bounced or one was marked as spam. Contact us to start them again.",
  no_email: "This person has no email address. Add one to invite them.",
  not_on_list: "This person has been taken off your list.",
  in_app: "This person is already a member in the app.",
  unsubscribed: "This person asked not to get your emails, so they can't be invited again.",
  bounced: "Emails to this address bounce. Check it with the person.",
  refused: "Our email service won't deliver to this address. Ask the person for another one.",
  shared_address: "This is a shared address such as info@ or support@. Ask the person for their own.",
  not_invited: "This person hasn't been invited yet. Invite them first.",
  already_joined: "This person has already joined.",
  again_person_limit: `An invitation can be sent again ${String(MEMBER_INVITE_AGAIN_PER_PERSON)} times in ${String(MEMBER_INVITE_AGAIN_PERSON_DAYS)} days. Try again later.`,
  again_gym_limit: `Your gym can send ${String(MEMBER_INVITE_AGAIN_PER_GYM_DAY)} invitations again a day. Try again tomorrow.`,
} as const;
export type MemberInviteRefusal = keyof typeof MEMBER_INVITE_WORDS;

/** The unsubscribe token in an invitation's links: the invitation's id and a MAC. */
export const MEMBER_INVITE_UNSUBSCRIBE_TOKEN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/;
