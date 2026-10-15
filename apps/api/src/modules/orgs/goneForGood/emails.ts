// The two emails before a gym's list is deleted for being gone for good (ROADMAP Stage 4
// item 14): a month before and a week before. Plain text first, a small HTML twin; the one
// link is to our own console. Days are the gym's own time zone.
import { orgWords } from "@app/shared";
import type { EmailMessage } from "../../../email/resend.js";
import type { Notice } from "./repo.js";

const APP_NAME = "AI Home Gym";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The gym's name as an email prints it: one line, no control characters. */
const oneLine = (s: string): string => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").trim().slice(0, 120);

/** "14 Nov 2026" in the gym's time zone. */
export function fullDay(at: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(at);
  }
}

export interface GoneForGoodWords {
  to: string;
  notice: Notice;
  gymName: string;
  orgType: string;
  timezone: string;
  /** Since when the gym has had no paid plan and no sign-in. */
  countedFrom: Date;
  deletesAt: Date;
  /** The console's member list. With no plan, the plan box there has Download member list. */
  membersLink: string;
}

export function goneForGoodEmail(w: GoneForGoodWords): EmailMessage {
  const words = orgWords(w.orgType);
  const gym = oneLine(w.gymName) || `Your ${words.it}`;
  const since = fullDay(w.countedFrom, w.timezone);
  const day = fullDay(w.deletesAt, w.timezone);
  const lines = [
    `${gym} has had no paid plan, and nobody from ${gym} has signed in to ${APP_NAME}, since ${since}.`,
    `On ${day} we will delete its ${words.person} list, with the memberships, bills and payments recorded for those people, its leads and its staff invitations. ${words.peopleCap} who use the app keep their own accounts, workouts and visits.`,
    `To keep everything, sign in to your ${words.it} console before ${day}.`,
    `To keep a copy of your list, sign in and press Download ${words.person} list:`,
  ];
  const link = 3;
  const text = `${lines.map((line, i) => (i === link ? `${line}\n${w.membersLink}` : line)).join("\n\n")}\n\n— ${APP_NAME}`;
  const html =
    lines
      .map((line, i) =>
        i === link
          ? `<p>${escapeHtml(line)}<br><a href="${escapeHtml(w.membersLink)}">${escapeHtml(w.membersLink)}</a></p>`
          : `<p>${escapeHtml(line)}</p>`,
      )
      .join("") + `<p>— ${APP_NAME}</p>`;
  const subject =
    w.notice === "month"
      ? `${gym}: your ${words.person} list will be deleted on ${day}`
      : `Last reminder: ${gym}'s ${words.person} list will be deleted on ${day}`;
  return { to: w.to, subject, text, html };
}
