// A place's personal training, in words: the browser's rules (apps/web/src/components/gym/personalTrainingView.js),
// on the place's own clock. Pure, so tested alone. A day and a clock time arrive as the gym's own and are printed as
// they are, never moved to the phone's zone.
import {
  MEMBER_FEE_WORDS,
  PT_RECORD_SHARED_WORDS,
  addDays,
  bookingPeriod,
  formatMinor,
  orgWords,
  ptMemberWords,
  ptNotOnListWords,
  reminderClock,
  type GymClockFormat,
  type MemberPtResponse,
  type MemberPtSession,
} from "@app/shared";
import { CLOCK_MARGIN_MS, dayHeading, instantText, shortDay } from "./classesView";

type Day = MemberPtResponse["days"][number];
type Fees = NonNullable<Day["fees"]>;
type Limit = NonNullable<Day["limit"]>;

/** "10:00 AM – 11:00 AM" or "10:00 – 11:00": a whole session, on the gym's clock. */
export function sessionSpan(startMinute: number, minutes: number, clock: GymClockFormat): string {
  return `${reminderClock(startMinute, clock) ?? ""} – ${reminderClock((startMinute + minutes) % 1440, clock) ?? ""}`;
}

/** "Sam Trainer", or "a member of staff" for one who has typed no name. */
export const trainerText = (name: string | null): string => name ?? "a member of staff";

/** "this week" where the day is in the week or the month today is in, else "that week". */
function periodWords(period: Limit["period"], day: string, today: string): string {
  const within = bookingPeriod(day, period);
  return `${today >= within.from && today <= within.to ? "this" : "that"} ${period}`;
}

/** A membership's sessions for a week or a month are used: how many it includes, and the day the next week or
 *  month starts. */
function limitUsedText(limit: Limit, day: string, today: string): string {
  const again = addDays(bookingPeriod(day, limit.period).to, 1);
  const all = limit.limit === 1 ? "the 1 personal training session" : `all ${String(limit.limit)} personal training sessions`;
  return `You’ve used ${all} ${limit.membership} includes ${periodWords(limit.period, day, today)}. A new ${limit.period} starts on ${shortDay(again)}.`;
}

export interface Pay {
  text: string;
  can: boolean;
}

/** What a booking on a day would use, or why it cannot be made; null where the gym sells no memberships and there
 *  is nothing to say. */
export function payText(view: MemberPtResponse, day: Day, orgType: unknown): Pay | null {
  if (view.record === "shared") return { text: PT_RECORD_SHARED_WORDS, can: false };
  if (view.record !== "own") return { text: ptNotOnListWords(orgType), can: false };
  const words = ptMemberWords(orgType);
  const limit = day.limit;
  if ((day.why === "limit_week" || day.why === "limit_month") && limit !== null) {
    return { text: limitUsedText(limit, day.localDate, view.today), can: false };
  }
  if (day.why !== null) return { text: words[day.why], can: false };
  const pays = day.pays;
  if (pays === null) return { text: words.no_membership, can: false };
  if (pays.membership === null) return null;
  if (pays.sessionsLeft === null && limit !== null) {
    const of = `${String(limit.left)} of ${String(limit.limit)} ${limit.limit === 1 ? "session" : "sessions"}`;
    return { text: `You have ${pays.membership}: ${of} left ${periodWords(limit.period, day.localDate, view.today)}.`, can: true };
  }
  if (pays.sessionsLeft === null) return { text: `Personal training is included in your membership: ${pays.membership}.`, can: true };
  const left = pays.sessionsLeft === 1 ? "1 session left" : `${String(pays.sessionsLeft)} sessions left`;
  // The pack pays because the membership's own sessions for that week or month are used.
  const why =
    limit === null ? "" : ` ${limit.membership}’s sessions for ${periodWords(limit.period, day.localDate, view.today)} are used, so a booking uses your pack.`;
  return { text: `You have ${pays.membership}: ${left}. Each booking uses 1 session.${why}`, can: true };
}

export interface PtDayChip {
  localDate: string;
  label: string;
  hasTimes: boolean;
}

/** The seven days as the row of days to pick from, and which one opens first: the first with a time anybody
 *  offers, else the first. */
export function ptDays(view: MemberPtResponse): { days: PtDayChip[]; first: string | null } {
  const withTimes = new Set(view.trainers.flatMap((t) => t.days.filter((d) => d.free.length > 0).map((d) => d.localDate)));
  const days = view.days.map((d) => ({
    localDate: d.localDate,
    label: dayHeading(d.localDate, view.from === view.today ? view.today : null),
    hasTimes: withTimes.has(d.localDate),
  }));
  return { days, first: (days.find((d) => d.hasTimes) ?? days[0])?.localDate ?? null };
}

/** Under a trainer whose later times on the day are not open to members yet. */
export function opensLaterText(opensDays: number, some: boolean): string {
  const when = Number.isInteger(opensDays) ? `${String(opensDays)} ${opensDays === 1 ? "day" : "days"} before it starts` : "closer to the day";
  return some ? `More times on this day open later: each one opens ${when}.` : `Times on this day aren’t open yet: each one opens ${when}.`;
}

export interface PtTime {
  minute: number;
  text: string;
}

export interface PtTrainer {
  trainerId: string;
  name: string;
  lengthText: string;
  sessionMinutes: number;
  times: PtTime[];
  later: string | null;
}

export interface PtDay {
  pay: Pay | null;
  fees: string | null;
  notOpen: string | null;
  can: boolean;
  trainers: PtTrainer[];
}

/** The gym's own fees for a session booked on a day: "Iron House’s fees: ₹200.00 for each late cancel, ₹300.00 for
 *  each no-show."; null for none. */
export function ptFeesLine(fees: Fees, gym: string): string | null {
  const parts = [
    fees.lateCancelMinor > 0 ? `${formatMinor(fees.lateCancelMinor, fees.currency)} for each late cancel` : null,
    fees.noShowMinor > 0 ? `${formatMinor(fees.noShowMinor, fees.currency)} for each no-show` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : `${gym}’s fees: ${parts.join(", ")}.`;
}

/** One day of the page: what a booking on it would use, and each trainer's times on it. */
export function ptDay(view: MemberPtResponse, localDate: string, orgType: unknown, clock: GymClockFormat, gym: string): PtDay {
  const day = view.days.find((d) => d.localDate === localDate);
  const pay = day === undefined ? null : payText(view, day, orgType);
  return {
    pay,
    // What a session booked on this day would cost if cancelled late or missed.
    fees: day === undefined || day.fees === null || (pay !== null && !pay.can) ? null : ptFeesLine(day.fees, gym),
    // A day past the last one the gym has opened has no time to press, and says why.
    notOpen: localDate > view.lastDay ? `Booking for this day isn’t open yet. You can book up to ${shortDay(view.lastDay)}.` : null,
    // A day nothing pays for shows its times, and none of them is a button.
    can: pay === null || pay.can,
    trainers: view.trainers.map((t) => {
      const on = t.days.find((d) => d.localDate === localDate);
      const free = on?.free ?? [];
      return {
        trainerId: t.trainerId,
        name: trainerText(t.name),
        lengthText: `${String(t.sessionMinutes)} min sessions`,
        sessionMinutes: t.sessionMinutes,
        times: free.map((minute) => ({ minute, text: sessionSpan(minute, t.sessionMinutes, clock) })),
        // The last open day: its later times are not open yet, which is not "none".
        later: on?.opensLater === true ? opensLaterText(view.opensDays, free.length > 0) : null,
      };
    }),
  };
}

/** The line where a week holds no time anybody can press, or null. */
export function emptyText(view: MemberPtResponse, gymName: string, orgType: unknown): string | null {
  if (view.trainers.length === 0) return `${gymName} has no ${orgWords(orgType).coaches} taking personal training sessions yet.`;
  if (view.from > view.lastDay) return `Booking for these days isn’t open yet. You can book up to ${shortDay(view.lastDay)}.`;
  return null;
}

/** "Fri 9 Oct · 10:00 AM – 11:00 AM · with Sam Trainer" */
export function sessionText(s: MemberPtSession, clock: GymClockFormat): string {
  return `${shortDay(s.localDate)} · ${sessionSpan(s.localStartMinute, s.minutes, clock)} · with ${trainerText(s.trainerName)}`;
}

/** The late cancel fee a session costs this person; 0 for none. */
export const lateFee = (s: Pick<MemberPtSession, "fees">): number => (s.fees !== null && s.fees.lateCancelMinor > 0 ? s.fees.lateCancelMinor : 0);

export interface Ask {
  title: string;
  lines: string[];
  yes: string;
  no: string;
}

/** What the box asks before a session is cancelled. Every fee in it is the one the request then says yes to. */
export function ptCancelAsk(s: MemberPtSession, timezone: string, clock: GymClockFormat, gym: string): Ask {
  const what = sessionText(s, clock);
  const fee = lateFee(s);
  const money = s.fees === null ? "" : formatMinor(fee, s.fees.currency);
  if (s.cancel === "late") {
    const tooLate = "It’s too late to cancel for free. Cancelling now counts as a late cancel";
    const counts = s.usesLimit ? " It still counts as one of the sessions your membership includes." : "";
    return {
      title: "Cancel late?",
      lines: [
        what,
        fee > 0 && s.fees !== null
          ? `${tooLate}, and ${gym} adds a one-time late cancel fee of ${money} to your bill.${counts}`
          : s.packCharged
            ? `${tooLate}, and the session stays used on your pack.`
            : s.usesLimit
              ? `${tooLate}, and it still counts as one of the sessions your membership includes.`
              : // Nothing follows that costs: never "for free".
                "Cancelling this close to the start counts as a late cancel. There’s no fee.",
      ],
      yes: "Cancel session",
      no: "Keep it",
    };
  }
  // "Free" is said only where something follows that is not: a fee, a pack's session, a membership's.
  const gives = s.packCharged
    ? " Cancel now and your pack gets the session back."
    : s.usesLimit
      ? " Cancel now and it won’t count as one of the sessions your membership includes."
      : "";
  const after = fee > 0 ? ` After that, ${gym} charges a one-time late cancel fee of ${money}.` : "";
  if (gives === "" && after === "") return { title: "Cancel your session?", lines: [what], yes: "Cancel session", no: "Keep it" };
  const at = instantText(s.freeCancelUntil, timezone, clock);
  const free = at === "" ? "Free to cancel now." : `Free to cancel until ${at}.`;
  return { title: "Cancel your session?", lines: [what, `${free}${after}${gives}`], yes: "Cancel session", no: "Keep it" };
}

const noShowLine = (fees: Fees, gym: string): string[] =>
  fees.noShowMinor > 0 ? [`If you don’t come, ${gym} adds a one-time no-show fee of ${formatMinor(fees.noShowMinor, fees.currency)} to your bill.`] : [];

/** What a coming session's fees mean for this person, under it: when free cancelling ends and what a late cancel
 *  costs after it, and what not coming costs. Empty where neither costs anything, or it can no longer be cancelled. */
export function sessionFeeLines(s: MemberPtSession, timezone: string, clock: GymClockFormat, gym: string): string[] {
  if (s.fees === null || s.cancel === null) return [];
  const lines: string[] = [];
  const fee = lateFee(s);
  if (fee > 0) {
    const money = formatMinor(fee, s.fees.currency);
    const until = instantText(s.freeCancelUntil, timezone, clock);
    if (s.cancel === "free" && until !== "") lines.push(`Free to cancel until ${until}. After that, ${gym} charges a one-time late cancel fee of ${money}.`);
    else lines.push(`If you cancel now, ${gym} adds a one-time late cancel fee of ${money} to your bill.`);
  }
  return [...lines, ...noShowLine(s.fees, gym)];
}

const offsetAt = (ms: number, zone: string): number | null => {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const shown = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
    return Number.isNaN(shown) ? null : shown - Math.floor(ms / 60_000) * 60_000;
  } catch {
    return null;
  }
};

/** The instant a gym's day and minute is, in its zone; null where the zone or the day cannot be read. In an hour
 *  the clocks skip it is the moment after the skip. */
export function gymInstant(localDate: string, minute: number, zone: string): number | null {
  const [y, m, d] = localDate.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return null;
  const wall = Date.UTC(y, m - 1, d, 0, minute);
  if (Number.isNaN(wall)) return null;
  const first = offsetAt(wall, zone);
  if (first === null) return null;
  const second = offsetAt(wall - first, zone);
  return second === null ? null : wall - second;
}

export interface BookTime {
  trainerName: string;
  localDate: string;
  dayLabel: string;
  minute: number;
  timeText: string;
}

/** The box before a booking: a pressed time books nothing until the member says so. It names the session, what it
 *  uses, and what a late cancel and a no-show would cost; inside the gym's free-cancel time, that it can't be
 *  cancelled for free. `now` is the phone's clock. */
export function ptBookAsk(view: MemberPtResponse, time: BookTime, pay: Pay | null, clock: GymClockFormat, now: number, gym: string): Ask {
  const fees = view.days.find((d) => d.localDate === time.localDate)?.fees ?? null;
  const lines = [`${time.dayLabel} · ${time.timeText} · with ${time.trainerName}`, ...(pay === null ? [] : [pay.text])];
  if (fees !== null && fees.lateCancelMinor > 0) {
    const money = formatMinor(fees.lateCancelMinor, fees.currency);
    const starts = gymInstant(time.localDate, time.minute, view.timezone);
    const untilMs = starts === null ? null : starts - view.freeCancelMinutes * 60_000;
    const until = untilMs === null ? "" : instantText(new Date(untilMs).toISOString(), view.timezone, clock);
    if (untilMs === null || until === "") lines.push(`If you book and then cancel late, ${gym} adds a one-time late cancel fee of ${money} to your bill.`);
    else if (untilMs - now > CLOCK_MARGIN_MS) lines.push(`Free to cancel until ${until}. After that, ${gym} charges a one-time late cancel fee of ${money}.`);
    else if (untilMs > now)
      lines.push(`Free cancelling ends at ${until}. If you cancel after that, ${gym} adds a one-time late cancel fee of ${money} to your bill.`);
    else lines.push(`This session starts soon, so it can’t be cancelled for free. If you book and then cancel, ${gym} adds a one-time late cancel fee of ${money} to your bill.`);
  }
  return { title: "Book this session?", lines: fees === null ? lines : [...lines, ...noShowLine(fees, gym)], yes: "Book session", no: "Not now" };
}

const FEE_STATE_WORDS = { owed: "Payment due", paid: "Paid", waived: "Waived" } as const;

/** A session's own fee, under it in the list: "One-time late cancel fee ₹500.00 · Payment due"; null for none. */
export function ptFeeText(s: MemberPtSession): string | null {
  if (s.fee === null) return null;
  // The fee's own kind: staff can change a no-show to came after its fee is paid.
  const kind = MEMBER_FEE_WORDS[s.fee.kind];
  return `One-time ${kind.charAt(0).toLowerCase()}${kind.slice(1)} ${formatMinor(s.fee.amountMinor, s.fee.currency)} · ${FEE_STATE_WORDS[s.fee.state]}`;
}

/** What happened to a session that is over or was cancelled: the line under it in the list. */
export function historyText(s: MemberPtSession): string {
  switch (s.status) {
    case "cancelled":
      return "Cancelled";
    case "late_cancelled":
      return s.packCharged ? "Cancelled late · the session stays used on your pack" : s.usesLimit ? "Cancelled late · it still counts as one of your sessions" : "Cancelled late";
    case "attended":
      return "You came";
    case "no_show":
      return s.packCharged
        ? "You missed this session · it stays used on your pack"
        : s.usesLimit
          ? "You missed this session · it still counts as one of your sessions"
          : "You missed this session";
    default:
      return "Past";
  }
}

/** What is said once a cancel has gone through, from the session as the server now has it. */
export function ptCancelledText(s: MemberPtSession): string {
  if (s.status === "late_cancelled") {
    if (s.fee !== null) return `Cancelled late. A one-time late cancel fee of ${formatMinor(s.fee.amountMinor, s.fee.currency)} was added to your bill.`;
    if (s.packCharged) return "Cancelled late. The session stays used on your pack.";
    return s.usesLimit ? "Cancelled late. It still counts as one of the sessions your membership includes." : "Cancelled late.";
  }
  return "Cancelled.";
}

/** What is said once a booking has been answered: the same press answered again can find a session cancelled
 *  since, which is said as it is, never as booked. */
export function bookedText(s: MemberPtSession, clock: GymClockFormat): { text: string; bad: boolean } {
  return s.status === "booked"
    ? { text: `Booked: ${sessionText(s, clock)}.`, bad: false }
    : { text: "That session was cancelled since. It is not booked.", bad: true };
}

/** The session as a late cancel the server now asks for, with the fee it says it costs now (its 409's
 *  `packCharged`, `feeMinor` and `currency`). */
export function askedLate(s: MemberPtSession, body: unknown): MemberPtSession {
  const field = (name: string): unknown => (typeof body === "object" && body !== null && name in body ? Reflect.get(body, name) : undefined);
  const fee = field("feeMinor");
  const said = field("currency");
  const feeMinor = typeof fee === "number" && Number.isInteger(fee) && fee > 0 ? fee : 0;
  const currency = typeof said === "string" && /^[A-Z]{3}$/.test(said) ? said : null;
  return {
    ...s,
    cancel: "late",
    packCharged: field("packCharged") === true,
    fees: feeMinor > 0 && currency !== null ? { lateCancelMinor: feeMinor, noShowMinor: s.fees?.noShowMinor ?? 0, currency } : null,
  };
}

const clockIn = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at);

/** The line that says whose clock the times are on, when the phone's differs; null when they agree. */
export function ptZoneNote(timezone: string, gymName: string, phoneZone: string, now: Date): string | null {
  let differs: boolean;
  try {
    differs = clockIn(now, phoneZone) !== clockIn(now, timezone);
  } catch {
    differs = true;
  }
  return differs ? `Times are ${gymName} time (${timezone.replaceAll("_", " ")}), not this phone’s.` : null;
}

/** What the page says when its sessions can't be read: the server's 404 is for anybody who is not a member of a
 *  place on a live plan. */
export function couldNotRead(status: number | null, name: string): string {
  return status === 404 ? `${name}’s personal training isn’t available right now.` : "Couldn’t load personal training.";
}
