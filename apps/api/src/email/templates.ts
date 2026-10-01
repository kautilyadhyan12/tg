// The words in the emails. Plain text first (every client shows it), a small
// HTML twin for the ones that render it. The two CODE emails carry no link at
// all: a code is typed, never clicked, so there is nothing there to phish
// with. The deletion-undo email carries exactly one link, to our own origin.
import { leadFollowUpLetter, leadGreeting, withArticle } from "@app/shared";
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

/** An invitation's From line: the gym named, on our invitations' own mailbox (CAN-SPAM
 *  names the gym as the sender). `configured` is INVITE_EMAIL_FROM. The characters RFC
 *  5322 treats as special are left out of the display name, so it needs no quoting. */
export function memberInviteFrom(configured: string, gymName: string): string {
  const open = configured.lastIndexOf("<");
  const box = open >= 0 ? configured.slice(open + 1, configured.lastIndexOf(">")) : configured;
  const name = `${gymName} via ${APP_NAME}`.replace(/[()<>[\]:;@\\,."]/g, "").replace(/\s+/g, " ").trim();
  return `${name} <${box}>`;
}

/** A gym's invitation to a person on its list (Part 3 §9.12). The words are fixed;
 *  the gym's name, city and postal address arrive already cleaned (`cleanGymText`),
 *  and both links are to our own origins. The join link carries no token: joining
 *  needs a sign-in with this same address. */
export function memberInviteEmail(words: {
  to: string;
  gymName: string;
  gymCity: string | null;
  postalAddress: string;
  joinLink: string;
  /** "Not me": a page that tells the gym this address is not its member's. */
  notMeLink: string;
  unsubscribeLink: string;
}): EmailMessage {
  const gym = words.gymName;
  const where = words.gymCity === null || words.gymCity === "" ? gym : `${gym} in ${words.gymCity}`;
  const lines = {
    lead: `${where} has invited you to ${APP_NAME}, the app its members use.`,
    how: `To join ${gym} in the app, sign in with this email address, ${words.to}:`,
    only: "The invitation works only for someone who signs in with this address.",
    notMe: `Not a member of ${gym}? Tell them it's not you:`,
    why: `You are getting this email because ${gym} has you on its member list and asked us to invite you. We won't send you another unless you ask ${gym} for one.`,
    footer: `Sent by ${APP_NAME} on behalf of ${gym}, ${words.postalAddress}.`,
    stop: `Stop emails from ${gym} through ${APP_NAME}:`,
  };
  const text =
    `${lines.lead}\n\n${lines.how}\n${words.joinLink}\n\n${lines.only}\n\n${lines.notMe}\n${words.notMeLink}\n\n${lines.why}\n\n` +
    `${lines.footer}\n${lines.stop} ${words.unsubscribeLink}\n`;
  const link = (href: string) => `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`;
  const html =
    `<p>${escapeHtml(lines.lead)}</p>` +
    `<p>${escapeHtml(lines.how)}<br>${link(words.joinLink)}</p>` +
    `<p>${escapeHtml(lines.only)}</p>` +
    `<p>${escapeHtml(lines.notMe)}<br>${link(words.notMeLink)}</p>` +
    `<p>${escapeHtml(lines.why)}</p>` +
    `<p style="color:#666;font-size:12px">${escapeHtml(lines.footer)}<br>${escapeHtml(lines.stop)} ${link(words.unsubscribeLink)}</p>`;
  return { to: words.to, subject: `You're a member of ${gym} — get the app`, text, html };
}

/** A gym's invitation to help run it (Part 3 §10.3; ROADMAP 4a-i). Fixed words; the
 *  inviter's name, the gym's name and the role arrive already cleaned (`cleanGymText`),
 *  and the one link is to our own sign-in page. It carries no token: accepting needs a
 *  sign-in with this same address. */
export function staffInviteEmail(words: {
  to: string;
  inviterName: string;
  gymName: string;
  role: string;
  days: number;
  signInLink: string;
}): EmailMessage {
  const gym = words.gymName;
  const who = words.inviterName === "" ? gym : words.inviterName;
  const lines = {
    lead: `${who} invited you to help run ${gym} as ${withArticle(words.role)}.`,
    how: `Sign in with this email address, ${words.to}, and press Accept:`,
    only: `The invitation works for ${String(words.days)} days, and only for someone who signs in with this address.`,
    ignore: "If you weren't expecting it, you can ignore this email.",
    footer: `Sent by ${APP_NAME} on behalf of ${gym}.`,
  };
  const text = `${lines.lead}\n\n${lines.how}\n${words.signInLink}\n\n${lines.only}\n\n${lines.ignore}\n\n${lines.footer}\n`;
  const link = (href: string) => `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`;
  const html =
    `<p>${escapeHtml(lines.lead)}</p>` +
    `<p>${escapeHtml(lines.how)}<br>${link(words.signInLink)}</p>` +
    `<p>${escapeHtml(lines.only)}</p>` +
    `<p>${escapeHtml(lines.ignore)}</p>` +
    `<p style="color:#666;font-size:12px">${escapeHtml(lines.footer)}</p>`;
  return { to: words.to, subject: `Help run ${gym} on ${APP_NAME}`, text, html };
}

/** A lead's follow-up email `step`, sent by the app for the gym (Part 3 §16.3; ROADMAP
 *  20c-v): the letter the lead's panel writes (`leadFollowUpLetter`), signed by the
 *  gym, then who sent it, the gym's postal address and the Stop link. The name, gym
 *  name and address arrive already cleaned (`cleanGymText`), so none can carry a link.
 *  Null for a step that has no letter. */
export function leadFollowUpEmail(words: {
  to: string;
  step: number;
  firstName: string;
  gymName: string;
  postalAddress: string;
  unsubscribeLink: string;
}): EmailMessage | null {
  const letter = leadFollowUpLetter(words.step, words.gymName);
  if (letter === null) return null;
  const gym = words.gymName;
  const lines = {
    why: `You're getting this because you asked ${gym} about joining and said they could email you.`,
    footer: `Sent by ${APP_NAME} on behalf of ${gym}, ${words.postalAddress}.`,
    stop: `Stop emails from ${gym} through ${APP_NAME}:`,
  };
  const body = [leadGreeting(words.firstName), ...letter.lines];
  const text =
    `${body.join("\n\n")}\n\n${gym}\n${words.postalAddress}\n\n` +
    `${lines.why}\n${lines.footer}\n${lines.stop} ${words.unsubscribeLink}\n`;
  const link = (href: string) => `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`;
  const html =
    body.map((line) => `<p>${escapeHtml(line)}</p>`).join("") +
    `<p>${escapeHtml(gym)}<br>${escapeHtml(words.postalAddress)}</p>` +
    `<p style="color:#666;font-size:12px">${escapeHtml(lines.why)}<br>${escapeHtml(lines.footer)}<br>${escapeHtml(lines.stop)} ${link(words.unsubscribeLink)}</p>`;
  return { to: words.to, subject: letter.subject, text, html };
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
