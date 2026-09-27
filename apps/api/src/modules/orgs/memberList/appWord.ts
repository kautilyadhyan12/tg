// WHERE A PERSON ON THE LIST STANDS WITH THE APP, IN ONE WORD (spec Part 3 §18.4). Pure.
//
// Every member row, a person's page, the Filter's App choices and their counts read
// this function, so no two screens can say different things about one person. First
// match wins. It decides something about a person, so it answers every combination of
// facts with a word and never throws: a state it has not seen falls through to the
// plainest true word, never to a confident false one.
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
import { checkName } from "../invites/nameCheck.js";

/** Someone in the app whom this record reaches. */
export interface AppPerson {
  /** The name they signed up with. */
  name: string;
  /** The name their account was given from its own address, if any: that is no name. */
  madeFromAddress: string | null;
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

const view = (
  word: MemberAppView["word"],
  tone: MemberAppView["tone"],
  line: string | null = null,
  lineTone: MemberAppView["lineTone"] = "plain",
  at: string | null = null,
): MemberAppView => ({ word, tone, at, line, lineTone });

/** Reasons an email was not sent that are the person's own choice. */
const OPT_OUT_REASONS = new Set(["unsubscribed", "complained"]);

export function appWord(input: AppWordInput): MemberAppView {
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
    const [person] = input.inApp;
    if (person !== undefined && checkName(input.fullName, person.name, person.madeFromAddress) === "differs") {
      return view("in_app", "green", `Signed up in the app as ${person.name}. Check this is them.`, "amber");
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
      return view("waiting", "amber", `${first} tapped Join, but ${full}.`, "amber");
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
          return view("not_arrived", "amber", said ?? "This email didn't arrive. Check the address with the person.", "amber");
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
