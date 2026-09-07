// The words in the emails. Plain text first (every client shows it), a small
// HTML twin for the ones that render it. The two CODE emails carry no link at
// all: a code is typed, never clicked, so there is nothing there to phish
// with. The deletion-undo email carries exactly one link, to our own origin.
import type { EmailMessage } from "./resend.js";

const APP_NAME = "AI Home Gym";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function codeMessage(to: string, subject: string, lead: string, code: string, minutes: number): EmailMessage {
  const text =
    `${lead}\n\n` +
    `${code}\n\n` +
    `It works for ${String(minutes)} minutes and only once. ` +
    `If you did not ask for it, you can ignore this email.\n\n— ${APP_NAME}`;
  const html =
    `<p>${escapeHtml(lead)}</p>` +
    `<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${escapeHtml(code)}</p>` +
    `<p>It works for ${String(minutes)} minutes and only once. If you did not ask for it, you can ignore this email.</p>` +
    `<p>— ${APP_NAME}</p>`;
  return { to, subject, text, html };
}

export function signInCodeEmail(to: string, code: string, minutes: number): EmailMessage {
  return codeMessage(to, `${code} is your ${APP_NAME} code`, "Your sign-in code:", code, minutes);
}

export function deleteAccountCodeEmail(to: string, code: string, minutes: number): EmailMessage {
  return codeMessage(
    to,
    `${code} is your ${APP_NAME} account-deletion code`,
    "Someone asked to delete your account. Type this code to confirm it was you:",
    code,
    minutes,
  );
}

/** Part 4 §5.2's Day-0 undo email: the one link, to our own restore page,
 *  and the number of days it stays good for — interpolated from the caller,
 *  never restated here, so the email can never promise a window the code
 *  does not keep. */
export function accountDeletionEmail(
  to: string,
  displayName: string,
  restoreLink: string,
  days: number,
): EmailMessage {
  const lead = `${displayName}, your ${APP_NAME} account is scheduled for deletion.`;
  const body =
    `If this was you, there is nothing to do: your data will be permanently removed after ${String(days)} days.\n\n` +
    `If you change your mind, open this link within ${String(days)} days to get your account back:\n\n` +
    `${restoreLink}\n\n` +
    `If you did not ask for this, use the link to keep your account, then sign in and check your settings.`;
  const text = `${lead}\n\n${body}\n\n— ${APP_NAME}`;
  const html =
    `<p>${escapeHtml(lead)}</p>` +
    `<p>If this was you, there is nothing to do: your data will be permanently removed after ${String(days)} days.</p>` +
    `<p>If you change your mind, open this link within ${String(days)} days to get your account back:</p>` +
    `<p><a href="${escapeHtml(restoreLink)}">${escapeHtml(restoreLink)}</a></p>` +
    `<p>If you did not ask for this, use the link to keep your account, then sign in and check your settings.</p>` +
    `<p>— ${APP_NAME}</p>`;
  return { to, subject: `Your ${APP_NAME} account will be deleted in ${String(days)} days`, text, html };
}
