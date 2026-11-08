// THE WEBSITE'S "DELETE YOUR ACCOUNT" PAGE (ROADMAP Stage 5 item 21b-ii), the web address Google Play
// asks for. It shows the steps in the app, and, for somebody without the app, deletes the account with
// a 6-digit code emailed to the address typed: one code, the account's own deletion, its 14 days to undo.
// The words live here once; the api answers with the same ones.
import { z } from "zod";
import { authEmailSchema, signInCodeSchema } from "./auth.js";
import { ACCOUNT_UNDO_DAYS } from "./privacy.js";

/** The page's Delete: the address typed and the code emailed to it. */
export const deleteByEmailRequestSchema = z.object({ email: authEmailSchema, code: signInCodeSchema }).strict();
export type DeleteByEmailRequest = z.infer<typeof deleteByEmailRequestSchema>;

const days = String(ACCOUNT_UNDO_DAYS);

export const DELETE_PAGE_WORDS = {
  title: "Delete your KWAZO account",
  lead: "You can delete your account in the KWAZO app, or here on our website.",
  inAppHeading: "In the app",
  inAppSteps: [
    "Open KWAZO and go to Settings.",
    "Press Delete account, then Email me a code.",
    "Type the 6-digit code we email you, then press Delete.",
  ],
  webHeading: "On this website",
  webLead: "No app? Type the email address you use with KWAZO and we'll email you a 6-digit code.",
  emailLabel: "Email address",
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
  whatHappensHeading: "What happens when you delete",
  whatHappens: [
    "You're signed out of KWAZO on every device.",
    "You leave every gym or studio you're a member of.",
    `For ${days} days you can change your mind: the email we send has an Undo link.`,
    `After ${days} days, your profile, workouts, meals, goals, runs and progress are deleted for good.`,
  ],
  keptHeading: "What we keep",
  keptLead: "A few records are kept after your account is deleted, and only for as long as shown:",
  keptMore: "Read more in our Privacy Policy",
  ownerHeading: "Run a gym or studio on KWAZO?",
  ownerLine: "Before you delete your account, make someone else its owner: sign in and press Make owner beside them in your staff list.",
} as const;
