// The two emails about a smaller size (ROADMAP Stage 3 item 1c-iii; Kd, RULINGS 2026-09-25):
// three days before it is due, when the gym still has more members than it holds, and when
// it was not made for that reason. Plain text first, a small HTML twin; both links are to our
// own console. Money arrives formatted by the server; dates are the gym's own time zone.
import { orgWords } from "@app/shared";
import type { EmailMessage } from "../../email/resend.js";

const APP_NAME = "AI Home Gym";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The gym's name as an email prints it: one line, no control characters. */
const oneLine = (s: string): string => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").trim().slice(0, 120);

function inZone(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
  }
}

/** "25 Oct" in the gym's time zone. */
export function dayLabel(at: Date, timeZone: string): string {
  return inZone(timeZone, { day: "numeric", month: "short" }).format(at);
}

/** "24 Oct, 10:07 pm" in the gym's time zone. */
export function momentLabel(at: Date, timeZone: string): string {
  const day = dayLabel(at, timeZone);
  const time = inZone(timeZone, { hour: "numeric", minute: "2-digit", hour12: true }).format(at);
  return `${day}, ${time}`;
}

function message(to: string, subject: string, lines: string[], links: Record<number, string>): EmailMessage {
  const text = `${lines.map((line, i) => (links[i] === undefined ? line : `${line}\n${links[i]}`)).join("\n\n")}\n\n— ${APP_NAME}`;
  const html =
    lines
      .map((line, i) => {
        const href = links[i];
        return href === undefined ? `<p>${escapeHtml(line)}</p>` : `<p>${escapeHtml(line)}<br><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>`;
      })
      .join("") + `<p>— ${APP_NAME}</p>`;
  return { to, subject, text, html };
}

const size = (cap: number | null, people: string): string => (cap === null ? `no ${people} limit` : `up to ${cap.toLocaleString("en-US")} ${people}`);

export interface SizeWarningWords {
  to: string;
  gymName: string;
  /** The organisation's type: "members" for a gym, "clients" for a studio. */
  orgType: string;
  members: number;
  currentSeatCap: number | null;
  currentPriceLabel: string;
  targetSeatCap: number;
  targetPriceLabel: string;
  /** When the smaller size starts, and when the members are counted, already worded. */
  due: string;
  decideBy: string;
  membersLink: string;
  planLink: string;
}

export function sizeWarningEmail(w: SizeWarningWords): EmailMessage {
  const words = orgWords(w.orgType);
  const gym = oneLine(w.gymName) || `Your ${words.it}`;
  const remove = w.members - w.targetSeatCap;
  const lines = [
    `You chose to move ${gym} to ${size(w.targetSeatCap, words.people)} (${w.targetPriceLabel} a month) from ${w.due}.`,
    `${gym} has ${w.members.toLocaleString("en-US")} ${words.people} now. Remove ${remove.toLocaleString("en-US")} of them before ${w.decideBy}, or ${gym} will stay on ${size(w.currentSeatCap, words.people)} at ${w.currentPriceLabel} a month.`,
    `Your ${words.people}:`,
    `Changed your mind? Open your plan and press Cancel this change:`,
  ];
  return message(w.to, `${gym}: remove ${remove.toLocaleString("en-US")} ${words.people} to move to the smaller size`, lines, { 2: w.membersLink, 3: w.planLink });
}

export interface SizeKeptWords {
  to: string;
  gymName: string;
  /** The organisation's type: "members" for a gym, "clients" for a studio. */
  orgType: string;
  members: number;
  currentSeatCap: number | null;
  currentPriceLabel: string;
  targetSeatCap: number;
  planLink: string;
}

export function sizeKeptEmail(w: SizeKeptWords): EmailMessage {
  const words = orgWords(w.orgType);
  const gym = oneLine(w.gymName) || `Your ${words.it}`;
  const lines = [
    `${gym} had ${w.members.toLocaleString("en-US")} ${words.people} when its smaller size was due, more than the ${w.targetSeatCap.toLocaleString("en-US")} it allows. So ${gym} stays on ${size(w.currentSeatCap, words.people)} at ${w.currentPriceLabel} a month. Nobody was removed.`,
    `You can choose a smaller size again whenever ${gym} has ${w.targetSeatCap.toLocaleString("en-US")} ${words.people} or fewer:`,
  ];
  return message(w.to, `${gym} stays on ${size(w.currentSeatCap, words.people)}`, lines, { 1: w.planLink });
}
