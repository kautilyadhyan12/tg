// The emails about a smaller size (ROADMAP Stage 3 item 1c-iii; Kd, RULINGS 2026-09-25): three
// days before it is due, when the gym still has more members than it holds, with its three
// choices; and on the day, when a bigger size the members fit was made instead, or none was. Plain text first, a small HTML twin; both links are to our
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

/** "1 member", "250 members", in the organisation's own words. */
const countOf = (n: number, words: { person: string; people: string }): string =>
  `${n.toLocaleString("en-US")} ${n === 1 ? words.person : words.people}`;

const size = (cap: number | null, words: { person: string; people: string }): string =>
  cap === null ? `no ${words.person} limit` : `up to ${countOf(cap, words)}`;

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
  /** Where the gym moves if it does not choose: the smallest size its members fit, or null
   *  when nothing smaller than its size does (it stays). */
  fallback: { seatCap: number; priceLabel: string } | null;
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
  const otherwise =
    w.fallback === null
      ? `${gym} will stay on ${size(w.currentSeatCap, words)} at ${w.currentPriceLabel} a month`
      : `${gym} will move to ${size(w.fallback.seatCap, words)} (${w.fallback.priceLabel} a month), the smallest size that fits`;
  const lines = [
    `You chose to move ${gym} to ${size(w.targetSeatCap, words)} (${w.targetPriceLabel} a month) from ${w.due}.`,
    `${gym} has ${countOf(w.members, words)} now. If you do nothing, on ${w.due} ${otherwise}.`,
    `To move to ${w.targetSeatCap.toLocaleString("en-US")}, remove ${countOf(remove, words)} before ${w.decideBy}:`,
    `Or choose another size, or stay on the one you have, from your plan:`,
  ];
  return message(w.to, `${gym}: you have more ${words.people} than your new size allows`, lines, { 2: w.membersLink, 3: w.planLink });
}

export interface SizeFittedWords {
  to: string;
  gymName: string;
  orgType: string;
  members: number;
  askedSeatCap: number;
  /** The size made instead, and its price. */
  seatCap: number | null;
  priceLabel: string;
  planLink: string;
}

export function sizeFittedEmail(w: SizeFittedWords): EmailMessage {
  const words = orgWords(w.orgType);
  const gym = oneLine(w.gymName) || `Your ${words.it}`;
  const lines = [
    `${gym} had ${w.members.toLocaleString("en-US")} ${words.people} when its smaller size was due, more than the ${w.askedSeatCap.toLocaleString("en-US")} it allows. So ${gym} moved to ${size(w.seatCap, words)} at ${w.priceLabel} a month, the smallest size that fits. Nobody was removed.`,
    `You can change size again whenever you like:`,
  ];
  return message(w.to, `${gym} moved to ${size(w.seatCap, words)}`, lines, { 1: w.planLink });
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
  /** In a paid trial: nothing is charged, and the size starts with the first payment. */
  trialing: boolean;
  planLink: string;
}

export function sizeKeptEmail(w: SizeKeptWords): EmailMessage {
  const words = orgWords(w.orgType);
  const gym = oneLine(w.gymName) || `Your ${words.it}`;
  const lines = [
    `${gym} had ${w.members.toLocaleString("en-US")} ${words.people} when its smaller size was due, more than the ${w.targetSeatCap.toLocaleString("en-US")} it allows. So ${gym} stays on ${size(w.currentSeatCap, words)}${w.trialing ? `, and ${w.currentPriceLabel} a month from its first payment` : ` at ${w.currentPriceLabel} a month`}. Nobody was removed.`,
    `You can choose a smaller size again whenever ${gym} has ${w.targetSeatCap.toLocaleString("en-US")} ${words.people} or fewer:`,
  ];
  return message(w.to, `${gym} stays on ${size(w.currentSeatCap, words)}`, lines, { 1: w.planLink });
}
