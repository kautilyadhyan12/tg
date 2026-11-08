// THE WEBSITE'S ACCOUNT DELETION PAGE (ROADMAP Stage 5 item 21b-ii), the web address Google Play asks
// for. It shows the steps in the app, and, for somebody without the app, deletes the account with a
// 6-digit code emailed to the address typed: one code, the account's own deletion, its 14 days to undo.
// The page's text is Kd's own (2026-11-08); the api answers with the same words.
import { z } from "zod";
import { authEmailSchema, signInCodeSchema } from "./auth.js";
import type { KeptAfterDeletionId } from "./legal.js";
import { ACCOUNT_UNDO_DAYS } from "./privacy.js";

/** The page's Delete: the address typed and the code emailed to it. */
export const deleteByEmailRequestSchema = z.object({ email: authEmailSchema, code: signInCodeSchema }).strict();
export type DeleteByEmailRequest = z.infer<typeof deleteByEmailRequestSchema>;

const days = String(ACCOUNT_UNDO_DAYS);

/** The page's own table of what is kept, one row for each kind the purge keeps (KEPT_AFTER_DELETION's
 *  ids, so a new kind kept cannot be missing here). */
export const DELETE_PAGE_KEPT: Record<KeptAfterDeletionId, readonly [what: string, howLong: string]> = {
  tombstone: [
    "Account existence record without the user's name or email address",
    "Retained to maintain references and associations required by the remaining records described below.",
  ],
  consent: [
    "Records of acknowledged notices and agreements, including the accepted text and time of acknowledgment",
    "Retained for six years following account deletion as evidence of the user's acknowledgment or agreement.",
  ],
  signed_papers: [
    "Waivers and agreements signed with a participating business, including the name entered by the user",
    "Retained for up to six years on behalf of the business as evidence of the relevant agreement.",
  ],
  business_records: [
    "Business-controlled records, including memberships, visits, bookings, payments, bills, notes, and the last four digits of a payment card",
    "Retained until the participating business deletes the information or the records are removed through KWAZO's cleanup process for businesses that have discontinued use of the Services.",
  ],
  business_content: [
    "Information created or configured while acting as business staff, including posts, events, classes, challenges, and meal plans",
    "Retained for as long as the participating business continues to maintain the relevant information.",
  ],
  money_records: [
    "Invoices and billing records relating to a participating business's KWAZO subscription",
    "Retained for the period required under applicable tax laws.",
  ],
  change_log: [
    "Application change logs recording the identity of the individual making a change, the change performed, and the time of the change",
    "Retained for service security and dispute-resolution purposes. Following account deletion, the individual's identity is displayed as a deleted user.",
  ],
  totals: [
    "Aggregated information without personal names, including daily business statistics, KWAZO's operating costs, and leaderboards with names removed",
    "Retained in a form that does not identify the individual and is therefore no longer associated with that person's identity.",
  ],
};

export const DELETE_PAGE_WORDS = {
  title: "Account Deletion",
  lead: [
    "KWAZO provides users with the ability to request the deletion of their accounts either through the KWAZO mobile application or through the official KWAZO website.",
    "The following sections explain the account deletion procedures, the consequences of deletion, applicable data retention periods, and additional requirements for business account owners.",
  ],
  inAppHeading: "1. Account Deletion Through the Mobile Application",
  inAppLead: "To request account deletion through the KWAZO mobile application, follow these steps:",
  inAppSteps: [
    "Open the KWAZO application and navigate to Settings.",
    "Select Delete account, followed by Email me a code.",
    "Enter the 6-digit verification code sent to your registered email address.",
    "Select Delete to confirm your account deletion request.",
  ],
  webHeading: "2. Account Deletion Through the Website",
  webLead: [
    "Users who do not have access to the KWAZO mobile application may initiate an account deletion request through the official KWAZO website.",
    "To proceed, enter the email address associated with your KWAZO account and select Email me a code.",
    "A 6-digit verification code will be sent to your registered email address for the account deletion process.",
  ],
  emailLabel: "Email Address",
  emailPlaceholder: "Enter your registered email address",
  sendButton: "Email me a code",
  sent: (email: string) => `If ${email} has a KWAZO account, we've emailed it a 6-digit code.`,
  codeLabel: "6-digit code",
  deleteButton: "Delete my account",
  resend: "Email me a new code",
  resendIn: (seconds: number) => `New code in ${String(seconds)} s`,
  resent: "We emailed you a new code.",
  otherEmail: "Use a different email",
  doneTitle: "Your account is being deleted",
  doneUndo: `You're signed out everywhere. To keep your account, open the email we sent you and press Undo within ${days} days.`,
  doneNoEmail: `You're signed out everywhere. Your account will be deleted for good in ${days} days.`,
  noAccount: "There's no KWAZO account with this email address, so there's nothing to delete.",
  alreadyDeleting: `This account is already being deleted. To keep it, open the email we sent when it was deleted and press Undo within ${days} days.`,
  ownerNext: "Sign in to manage your gym",
  failed: "Something went wrong. Please try again.",
  whatHappensHeading: "3. Consequences of Account Deletion",
  whatHappensLead: "Upon submitting and confirming an account deletion request, the following actions and conditions apply:",
  whatHappens: [
    { heading: "3.1. Account Access", paras: ["You will be signed out of KWAZO on all devices associated with your account."] },
    {
      heading: "3.2. Business Memberships",
      paras: ["Your membership associations with all gyms, fitness studios, and other participating fitness businesses within KWAZO will be terminated."],
    },
    {
      heading: "3.3. Account Recovery Period",
      paras: [
        `Following a confirmed deletion request, your account will remain recoverable for a period of ${days} days.`,
        "During this period, you may cancel the deletion request and restore your account by using the Undo link provided in the confirmation email sent to your registered email address.",
      ],
    },
    {
      heading: "3.4. Permanent Account Deletion",
      paras: [`Upon expiration of the ${days}-day recovery period, your account will be permanently deleted.`, "The deleted information includes:"],
    },
  ],
  deletedItems: [
    "Your account profile.",
    "Workout and exercise records.",
    "Logged meals and nutritional information.",
    "Personal fitness and nutrition goals.",
    "Running activities and related records.",
    "Recorded fitness progress.",
  ],
  deletedAfter: `Once the ${days}-day recovery period has expired, this information will be permanently deleted, subject to the limited data retention provisions described in Section 4.`,
  keptHeading: "4. Information Retained Following Account Deletion",
  keptLead: [
    "Certain categories of information may be retained following permanent account deletion for recordkeeping, legal compliance, business administration, security, and dispute-resolution purposes.",
    "Such information is retained only in accordance with the periods and conditions specified below.",
  ],
  keptHead: ["Category of Retained Information", "Retention Period or Condition"],
  keptMoreBefore: "For additional information regarding the collection, processing, retention, and deletion of personal information, please refer to the ",
  keptMore: "KWAZO Privacy Policy",
  keptMoreAfter: ".",
  ownerHeading: "5. Additional Requirements for Business Account Owners",
  ownerLine: "Individuals who own or administer a gym, fitness studio, or another participating fitness business through KWAZO must transfer business ownership to another authorized staff member before deleting their account.",
  ownerStepsLead: "To transfer ownership:",
  ownerSteps: [
    "Sign in to your KWAZO business account.",
    "Navigate to the business's staff management list.",
    "Locate the staff member to whom you intend to transfer ownership.",
    "Select Make owner next to the relevant staff member to transfer ownership.",
  ],
  ownerAfter: "Business owners should complete this ownership transfer before proceeding with account deletion.",
} as const;
