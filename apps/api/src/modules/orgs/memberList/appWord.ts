// WHERE A PERSON ON THE LIST STANDS WITH THE APP (spec Part 3 §18.4). Pure.
//
// Every member row, a person's page, the Filter's App choices and their counts read
// this, so no two screens can say different things about one person. `appReason` finds
// WHY — first match wins, one of eleven reasons — and `appWord` shows it as one of three
// words (In the app · Invited · Not in the app) with the reason as the line under it
// (Kd, 2026-09-27: the list showed too much). It decides something about a person, so it
// answers every combination of facts and never throws: a state it has not seen falls
// through to the plainest true reason, never to a confident false one.
//
// It never compares the name somebody gave the app with the list's (RULINGS 2026-09-28):
// the email on the list is the link, and a name proves nothing.
//
// An invitation belongs to an ADDRESS, not a person. Where two people on the list share
// one email and the person in the app is matched to the other record, this record's
// invitation facts are that person's, not this one's: it says who uses the app with its
// email instead of borrowing their "Left the app" or "Invited".
import {
  MEMBER_INVITE_EMAIL_REASON_WORDS,
  MEMBER_INVITE_EMAIL_RESULT_WORDS,
  underAgeOn,
  type MemberAppView,
  type MemberListInvitation,
} from "@app/shared";

/** Someone in the app whom this record reaches. */
export interface AppPerson {
  /** The name they gave the app, only ever shown beside the list's. */
  name: string;
}

export interface AppWordInput {
  fullName: string;
  email: string | null;
  dateOfBirth: string | null;
  /** A past member (taken off the list). */
  former: boolean;
  /** The people in the app this record reaches by §9.7's one-record-per-person match. */
  inApp: readonly AppPerson[];
  /** The list's name for another record whose person is in the app with this record's
   *  email, when this record reaches nobody itself; else null. */
  sharedWith: string | null;
  invitation: MemberListInvitation | null;
  /** This gym's unsubscribe or spam mark on the address, if any. */
  optedOut: "unsubscribed" | "complained" | null;
  /** The plan's paid places, or null when nothing caps them. */
  cap: number | null;
  /** The gym's own calendar day, 'YYYY-MM-DD'. */
  today: string;
}

const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] || "this person";

/** "Maria Park and Leo Park", "A, B and C". */
const names = (list: readonly string[]): string =>
  list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1] ?? ""}`;

/** Why a person is where they are with the app. */
export type AppReasonKind =
  | "in_app"
  | "wrong_email"
  | "waiting"
  | "removed"
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
  waiting: { word: "invited", line: null },
  not_arrived: { word: "invited", line: null },
  // Never emailed at all, so not "Invited" (Kd, 2026-09-27: "Invited · Not sent" read as
  // two opposite things); their page offers Invite.
  not_sent: { word: "not_in_app", line: null },
  invited: { word: "invited", line: "Invitation sent" },
  wrong_email: { word: "not_in_app", line: null },
  removed: { word: "not_in_app", line: "Removed from app" },
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
      return view("in_app", "amber", `${first} still uses the app through your gym. Remove them from the app if they've left.`, "amber");
    }
    if (input.inApp.length > 1) {
      return view("in_app", "green", `${names(input.inApp.map((p) => p.name))} use the app with these details.`, "amber");
    }
    return view("in_app", "green");
  }

  // The address's invitation was used by the person on another record.
  if (input.sharedWith !== null) {
    return view("not_invited", "grey", `${input.sharedWith} uses the app with this email.`);
  }

  // Invite never reaches someone the list says is under 18 (RULINGS 2026-09-24), so an
  // invitation at their address was a parent's, or came before the date was corrected.
  if (!input.former && input.email !== null && underAgeOn(input.dateOfBirth, input.today)) {
    return view("not_invited", "grey", "Under 18");
  }

  if (inv !== null) {
    // 2
    if (inv.state === "declined" && inv.notMeAt !== null) {
      const email = input.email ?? "this address";
      return view("wrong_email", "red", `Whoever gets email at ${email} says they aren't ${first}. Check the address with ${first}.`, "red");
    }
    // 3
    if (inv.state === "pending" && inv.waitingSince !== null) {
      const full = input.cap === null ? "your plan has no free places" : `all ${String(input.cap)} places in your plan are taken`;
      return view(
        "waiting",
        "amber",
        `${first} tapped Join, but ${full}. Free a place — a bigger plan, or remove someone who has left — then ask ${first} to tap Join again.`,
        "amber",
      );
    }
    // 4
    if (inv.state === "withdrawn" && inv.removedAt !== null) return view("removed", "grey", null, "plain", inv.removedAt);
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
          return view("not_sent", "grey", said ?? "The invitation email wasn't sent. Press Invite to send it.", "amber");
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
