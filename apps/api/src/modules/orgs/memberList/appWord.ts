// WHERE A PERSON ON THE LIST STANDS WITH THE APP (spec Part 3 §18.4). Pure.
//
// Every member row, a person's page, the Filter's App choices and their counts read
// this, so no two screens can say different things about one person. `appReason` finds
// WHY — first match wins, one of fifteen reasons — and `appWord` shows it as one of three
// words (In the app · Invited · Not in the app) with the reason as the line under it
// (Kd, 2026-09-27: the list showed too much). It decides something about a person, so it
// answers every combination of facts and never throws: a state it has not seen falls
// through to the plainest true reason, never to a confident false one.
//
// It never compares the name somebody gave the app with the list's (RULINGS 2026-09-28):
// the email on the list is the link, and a name proves nothing. Where one email is on
// several records and the list cannot say whose the person in the app is, every one of
// those records says so, in amber, and none claims them.
//
// An invitation belongs to an ADDRESS, not a person. Where two people on the list share
// one email and the person in the app is matched to the other record, this record's
// invitation facts are that person's, not this one's: it says who uses the app with its
// email instead of borrowing their "Left the app" or "Invited". A removal is this record's
// only when staff removed its own person with it (`removedAt`); a removal of somebody else
// who used the address is said of the address (`addressRemovedAt`).
import {
  MEMBER_INVITE_EMAIL_REASON_WORDS,
  MEMBER_INVITE_EMAIL_RESULT_WORDS,
  underAgeOn,
  type MemberAppView,
  type MemberListInvitation,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";

/** Someone in the app whom this record reaches. */
export interface AppPerson {
  /** The name they gave the app, only ever shown beside the list's. */
  name: string;
}

/** Someone in the app with an email (or phone) this record shares with other records,
 *  when the list cannot say which of them is theirs. */
export interface AppUnsure {
  /** The name they gave the app. */
  name: string;
  by: "email" | "phone";
  /** The list's names of every record holding it, this one included. */
  records: readonly string[];
}

export interface AppWordInput {
  fullName: string;
  email: string | null;
  dateOfBirth: string | null;
  /** A past member (taken off the list). */
  former: boolean;
  /** The people in the app this record reaches by §9.7's one-record-per-person match. */
  inApp: readonly AppPerson[];
  /** The people in the app whose email this record shares with other records, when the
   *  list cannot say which record is theirs. */
  unsure: readonly AppUnsure[];
  /** Who else is in the app with this record's email, when this record reaches nobody
   *  itself: the list's name for their record, else the name they gave the app. */
  sharedWith: string | null;
  invitation: MemberListInvitation | null;
  /** This gym's unsubscribe or spam mark on the address, if any. */
  optedOut: "unsubscribed" | "complained" | null;
  /** The plan's paid places now: whether the gym has a live plan, its cap (null when
   *  nothing caps it) and how many are in use. */
  places: { live: boolean; cap: number | null; used: number };
  /** The gym's own calendar day, 'YYYY-MM-DD', and its time zone. */
  today: string;
  timeZone: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "27 Sep", or "27 Sep 2025" in another year than `today`. */
export function shortDay(day: string, today: string): string {
  const [year, month, date] = day.split("-");
  const words = `${String(Number(date))} ${MONTHS[Number(month) - 1] ?? ""}`;
  return year === today.slice(0, 4) ? words : `${words} ${year ?? ""}`;
}

/** A person who tried to join when the plan was full: when, and whether they can now
 *  (Kd, 2026-09-28: never a stale "all 500 places are in use"). */
function fullPlanLine(first: string, since: string, input: AppWordInput): string {
  const when = `${first} tried to join on ${shortDay(dayInTz(new Date(since), input.timeZone), input.today)}, when your plan was full.`;
  const { live, cap, used } = input.places;
  if (!live) return `${when} You have no active plan now, so nobody can join until you choose one.`;
  if (cap === null) return `${when} Your plan has free places now, so ask ${first} to try again.`;
  if (used < cap) {
    const free = cap - used;
    return `${when} ${String(free)} ${free === 1 ? "place is" : "places are"} free now, so ask ${first} to try again.`;
  }
  return `${when} It's still full: upgrade your plan or remove a member who has left, then ask ${first} to try again.`;
}

const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] || "this person";

/** "Maria Park and Leo Park", "A, B and C". */
const names = (list: readonly string[]): string =>
  list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1] ?? ""}`;

/** Why a person is where they are with the app. */
export type AppReasonKind =
  | "in_app"
  | "in_app_unsure"
  | "shares_email"
  | "under_age"
  | "wrong_email"
  | "waiting"
  | "removed"
  | "address_removed"
  | "left"
  | "unsubscribed"
  | "declined"
  | "not_arrived"
  | "not_sent"
  | "invited"
  | "not_invited";

export interface AppReason {
  reason: AppReasonKind;
  /** Amber when a past member is still in the app. */
  tone: MemberAppView["tone"];
  line: string | null;
  lineTone: MemberAppView["lineTone"];
  at: string | null;
}

const view = (
  reason: AppReasonKind,
  tone: MemberAppView["tone"],
  line: string | null = null,
  lineTone: MemberAppView["lineTone"] = "plain",
  at: string | null = null,
): AppReason => ({ reason, tone, line, lineTone, at });

/** Reasons an email was not sent that are the person's own choice. */
const OPT_OUT_REASONS = new Set(["unsubscribed", "complained"]);

/** Where each reason puts a person, and the line a reason with no sentence of its own
 *  shows on their page. */
const SHOWN: Readonly<Record<AppReasonKind, { word: MemberAppView["word"]; line: string | null }>> = {
  in_app: { word: "in_app", line: null },
  // The email is in the app; whose record it is, the list can't say.
  in_app_unsure: { word: "in_app", line: null },
  shares_email: { word: "not_in_app", line: null },
  under_age: { word: "not_in_app", line: "Under 18" },
  waiting: { word: "invited", line: null },
  not_arrived: { word: "invited", line: null },
  // Never emailed at all, so not "Invited" (Kd, 2026-09-27: "Invited · Not sent" read as
  // two opposite things); their page offers Invite.
  not_sent: { word: "not_in_app", line: null },
  invited: { word: "invited", line: "Invitation sent" },
  wrong_email: { word: "not_in_app", line: null },
  removed: { word: "not_in_app", line: "Removed from app" },
  address_removed: { word: "not_in_app", line: "Someone using this email address was removed from the app" },
  left: { word: "not_in_app", line: "Left the app" },
  unsubscribed: { word: "not_in_app", line: "Unsubscribed from your emails" },
  declined: { word: "not_in_app", line: "Declined the invitation" },
  not_invited: { word: "not_in_app", line: "Not invited yet" },
};

/** The word, its colour and the one line a screen shows for a person (§18.4). */
export function appWord(input: AppWordInput): MemberAppView {
  return appFact(input).view;
}

/** What a screen shows, and the reason behind it, which the Filter's "Not invited yet" and
 *  "Removed from app" choices read. */
export function appFact(input: AppWordInput): { view: MemberAppView; reason: AppReasonKind } {
  const found = appReason(input);
  const shown = SHOWN[found.reason];
  const tone = shown.word === "in_app" ? found.tone : "grey";
  return { view: { word: shown.word, tone, at: found.at, line: found.line ?? shown.line, lineTone: found.lineTone }, reason: found.reason };
}

/** WHY a person is where they are with the app: first match wins. */
export function appReason(input: AppWordInput): AppReason {
  const first = firstName(input.fullName);
  const inv = input.invitation;

  // 1 and 1b: this record reaches someone in the app.
  if (input.inApp.length > 0) {
    if (input.former) {
      return view("in_app", "amber", `${first} is a past member but still uses the app. Remove them if they've left.`, "amber");
    }
    if (input.inApp.length > 1) {
      return view("in_app", "green", `${names(input.inApp.map((p) => p.name))} use the app with these details.`, "amber");
    }
    return view("in_app", "green");
  }

  // 1e: the email is in the app, on several records, and the list can't say whose.
  if (input.unsure.length > 0) {
    const said = input.unsure.map(
      (person) =>
        `${person.name} uses the app with the ${person.by === "email" ? "email address" : "phone number"} ${names(person.records)} share, so we can't tell which of them it is.`,
    );
    return view("in_app_unsure", "amber", `${said.join(" ")} Give each of them their own email address.`, "amber");
  }

  // 1c: the address's invitation was used by the person on another record.
  if (input.sharedWith !== null) {
    return view("shares_email", "grey", `${input.sharedWith} uses the app with this email address.`);
  }

  // 1d: Invite never reaches someone the list says is under 18 (RULINGS 2026-09-24), so an
  // invitation at their address was a parent's, or came before the date was corrected.
  if (!input.former && input.email !== null && underAgeOn(input.dateOfBirth, input.today)) {
    return view("under_age", "grey");
  }

  if (inv !== null) {
    // 2: whoever the address reaches is somebody else — they said so, or staff did.
    const email = input.email ?? "this address";
    if (inv.state === "declined" && inv.notMeAt !== null) {
      return view("wrong_email", "red", `The recipient at ${email} says they aren't ${first}. Confirm ${first}'s email address.`, "red");
    }
    if (inv.state === "withdrawn" && inv.wrongPersonAt !== null) {
      return view("wrong_email", "red", `Someone else uses ${email}. Confirm ${first}'s email address.`, "red");
    }
    // 3
    if (inv.state === "pending" && inv.waitingSince !== null) {
      return view("waiting", "amber", fullPlanLine(first, inv.waitingSince, input), "amber");
    }
    // 4: staff removed this record's own person; 4b: somebody else who used the address.
    if (inv.state === "withdrawn" && inv.removedAt !== null) return view("removed", "grey", null, "plain", inv.removedAt);
    if (inv.state === "withdrawn" && inv.addressRemovedAt !== null) {
      return view("address_removed", "grey", null, "plain", inv.addressRemovedAt);
    }
    // 5
    if (inv.state === "accepted") return view("left", "grey");
  }

  // 6
  const spam = input.optedOut === "complained" || inv?.email?.result === "complained" || inv?.email?.reason === "complained";
  if (spam) return view("unsubscribed", "grey", "Marked your invitation as spam.");
  if (input.optedOut === "unsubscribed" || inv?.email?.reason === "unsubscribed") return view("unsubscribed", "grey");

  if (inv !== null) {
    // 7
    if (inv.state === "declined") return view("declined", "grey");
    if (inv.state === "pending") {
      const email = inv.email;
      // 8
      if (email !== null) {
        const result = email.result;
        // A spam mark was answered above, as "Unsubscribed".
        if (result === "bounced" || result === "failed" || result === "refused") {
          return view("not_arrived", "amber", MEMBER_INVITE_EMAIL_RESULT_WORDS[result], "amber");
        }
        const reason = email.reason;
        if ((email.state === "skipped" || email.state === "failed") && reason !== "send_unknown") {
          const said = reason !== null && !OPT_OUT_REASONS.has(reason) ? MEMBER_INVITE_EMAIL_REASON_WORDS[reason] : null;
          return view("not_sent", "grey", said ?? "Invitation not sent. Invite them again.", "amber");
        }
        // 9, not known
        if (reason === "send_unknown") return view("invited", "grey", MEMBER_INVITE_EMAIL_REASON_WORDS.send_unknown, "plain", email.at);
      }
      // 9
      return view("invited", "grey", null, "plain", email?.at ?? inv.invitedAt);
    }
  }

  // 10
  if (input.email === null) return view("not_invited", "grey", "No email address");
  if (inv?.state === "withdrawn") return view("not_invited", "grey", "Invitation cancelled");
  return view("not_invited", "grey");
}
