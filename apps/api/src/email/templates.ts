// The words in the two code emails. Plain text first (every client shows it),
// a small HTML twin for the ones that render it. No links: a code is typed,
// never clicked, so there is nothing here to phish with.
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
