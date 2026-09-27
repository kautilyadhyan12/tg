// THE APP WORD, as a table (spec Part 3 §18.4; ROADMAP 5b-v-a-i). `appReason` decides WHY a
// person is where they are and `appWord` shows it as one of three words; they decide what
// a gym's staff read about a person, so every row of the spec's table is a case, the
// invitation histories found in the local databases on 2026-09-27 are cases, and every
// combination of invitation facts the types allow is swept for a word that is never
// false about the facts it was given.
import { describe, expect, it } from "vitest";
import {
  MEMBER_INVITE_EMAIL_REASON_WORDS,
  memberInviteEmailReasonSchema,
  memberInviteEmailResultSchema,
  memberInviteEmailStateSchema,
  memberInviteStateSchema,
  type MemberListInvitation,
} from "@app/shared";
import { appReason, appWord, type AppReasonKind, type AppWordInput } from "../src/modules/orgs/memberList/appWord.js";

const AT = "2026-09-22T10:00:00.000Z";
const REMOVED = "2026-09-26T09:30:00.000Z";

const base: AppWordInput = {
  fullName: "Emma Hart",
  email: "emma@example.com",
  dateOfBirth: null,
  former: false,
  inApp: [],
  sharedWith: null,
  invitation: null,
  optedOut: null,
  cap: 500,
  today: "2026-09-27",
};

const invitation = (over: Partial<MemberListInvitation> = {}): MemberListInvitation => ({
  state: "pending",
  invitedAt: AT,
  email: null,
  sentAgain: 0,
  waitingSince: null,
  notMeAt: null,
  removedAt: null,
  ...over,
});
type Email = NonNullable<MemberListInvitation["email"]>;
const email = (over: Partial<Email> = {}): Email => ({ state: "sent", reason: null, at: AT, result: null, ...over });

const reason = (over: Partial<AppWordInput>) => appReason({ ...base, ...over });
const word = (over: Partial<AppWordInput>) => appWord({ ...base, ...over });

describe("the spec's table, one case a row (§18.4)", () => {
  const cases: [string, Partial<AppWordInput>, ReturnType<typeof appReason>][] = [
    ["1 in the app, same name", { inApp: [{ name: "Emma Hart" }] }, { reason: "in_app", tone: "green", at: null, line: null, lineTone: "plain" }],
    [
      // The email on the list is the link; a name proves nothing (RULINGS 2026-09-28).
      "1 in the app under another name, read plainly",
      { fullName: "Daniel Wu", inApp: [{ name: "du" }] },
      { reason: "in_app", tone: "green", at: null, line: null, lineTone: "plain" },
    ],
    [
      "1 two people in the app on one record",
      { fullName: "Maria Park", inApp: [{ name: "Maria Park" }, { name: "Leo Park" }] },
      { reason: "in_app", tone: "green", at: null, line: "Maria Park and Leo Park use the app with these details.", lineTone: "amber" },
    ],
    [
      "1b a past member still in the app",
      { fullName: "Grace Hall", former: true, inApp: [{ name: "Grace Hall" }] },
      { reason: "in_app", tone: "amber", at: null, line: "Grace is a past member but still uses the app. Remove them if they've left.", lineTone: "amber" },
    ],
    [
      "2 wrong email",
      { invitation: invitation({ state: "declined", notMeAt: AT }) },
      { reason: "wrong_email", tone: "red", at: null, line: "The recipient at emma@example.com says they aren't Emma. Confirm Emma's email address.", lineTone: "red" },
    ],
    [
      "3 waiting for a place",
      { invitation: invitation({ waitingSince: AT }) },
      { reason: "waiting", tone: "amber", at: null, line: "Emma tried to join, but all 500 places on your plan are in use. Upgrade your plan or remove a member who has left, then ask Emma to try again.", lineTone: "amber" },
    ],
    ["4 removed from app", { invitation: invitation({ state: "withdrawn", removedAt: REMOVED }) }, { reason: "removed", tone: "grey", at: REMOVED, line: null, lineTone: "plain" }],
    ["5 left the app", { invitation: invitation({ state: "accepted" }) }, { reason: "left", tone: "grey", at: null, line: null, lineTone: "plain" }],
    ["6 unsubscribed", { invitation: invitation({ email: email() }), optedOut: "unsubscribed" }, { reason: "unsubscribed", tone: "grey", at: null, line: null, lineTone: "plain" }],
    [
      "6 marked as spam",
      { invitation: invitation({ email: email({ result: "complained" }) }) },
      { reason: "unsubscribed", tone: "grey", at: null, line: "Marked your invitation as spam.", lineTone: "plain" },
    ],
    ["7 declined", { invitation: invitation({ state: "declined" }) }, { reason: "declined", tone: "grey", at: null, line: null, lineTone: "plain" }],
    [
      "8 bounced after it went",
      { invitation: invitation({ email: email({ result: "bounced" }) }) },
      { reason: "not_arrived", tone: "amber", at: null, line: "Invitation bounced: this address doesn't accept email. Confirm it with the member.", lineTone: "amber" },
    ],
    [
      // Never emailed, so not "Invited" (Kd, 2026-09-27: "Invited · Not sent" said two things).
      "8 not sent: bad address",
      { invitation: invitation({ email: email({ state: "skipped", reason: "bad_address" }) }) },
      { reason: "not_sent", tone: "grey", at: null, line: MEMBER_INVITE_EMAIL_REASON_WORDS.bad_address, lineTone: "amber" },
    ],
    [
      "8 not sent: not on the list when it was due",
      { invitation: invitation({ email: email({ state: "skipped", reason: "not_on_list" }) }) },
      { reason: "not_sent", tone: "grey", at: null, line: MEMBER_INVITE_EMAIL_REASON_WORDS.not_on_list, lineTone: "amber" },
    ],
    [
      "8 not sent: the email service refused it for a week",
      { invitation: invitation({ email: email({ state: "failed", reason: "provider_refused" }) }) },
      { reason: "not_sent", tone: "grey", at: null, line: MEMBER_INVITE_EMAIL_REASON_WORDS.provider_refused, lineTone: "amber" },
    ],
    ["9 invited, the email went", { invitation: invitation({ email: email({ result: "delivered" }) }) }, { reason: "invited", tone: "grey", at: AT, line: null, lineTone: "plain" }],
    ["9 invited, still queued", { invitation: invitation({ email: email({ state: "queued" }) }) }, { reason: "invited", tone: "grey", at: AT, line: null, lineTone: "plain" }],
    [
      "9 not known whether it went",
      { invitation: invitation({ email: email({ state: "skipped", reason: "send_unknown" }) }) },
      { reason: "invited", tone: "grey", at: AT, line: MEMBER_INVITE_EMAIL_REASON_WORDS.send_unknown, lineTone: "plain" },
    ],
    ["10 never invited", {}, { reason: "not_invited", tone: "grey", at: null, line: null, lineTone: "plain" }],
    ["10 no email address", { email: null }, { reason: "not_invited", tone: "grey", at: null, line: "No email address", lineTone: "plain" }],
    ["10 under 18 by the gym's day", { dateOfBirth: "2008-09-28" }, { reason: "not_invited", tone: "grey", at: null, line: "Under 18", lineTone: "plain" }],
    ["10 eighteen today", { dateOfBirth: "2008-09-27" }, { reason: "not_invited", tone: "grey", at: null, line: null, lineTone: "plain" }],
    [
      "10 invitation cancelled when moved to past members",
      { former: true, invitation: invitation({ state: "withdrawn" }) },
      { reason: "not_invited", tone: "grey", at: null, line: "Invitation cancelled", lineTone: "plain" },
    ],
  ];
  it.each(cases)("%s", (_name, over, expected) => {
    expect(reason(over)).toEqual(expected);
  });
});

describe("a household: two records on one email, the person in the app matched to the other", () => {
  it("the other record says who uses the email, never their 'Left the app' or 'Invited'", () => {
    for (const state of memberInviteStateSchema.options) {
      const out = reason({ fullName: "Leo Park", sharedWith: "Maria Park", invitation: invitation({ state }) });
      expect(out, state).toEqual({ reason: "not_invited", tone: "grey", at: null, line: "Maria Park uses the app with this email address.", lineTone: "plain" });
    }
  });
  it("a record that reaches someone itself still reads 'In the app'", () => {
    expect(reason({ sharedWith: "Maria Park", inApp: [{ name: "Emma Hart" }] }).reason).toBe("in_app");
  });
});

describe("someone the list says is under 18", () => {
  const child = { fullName: "Leo Park", dateOfBirth: "2012-05-01" };
  it("reads 'Not invited · Under 18' whatever their address's invitation says: it was a parent's, or came before the date was corrected", () => {
    for (const state of memberInviteStateSchema.options) {
      for (const over of [{}, { notMeAt: AT }, { waitingSince: AT }, { removedAt: REMOVED }, { email: email() }]) {
        expect(reason({ ...child, invitation: invitation({ state, ...over }) }), `${state} ${JSON.stringify(over)}`).toEqual({
          reason: "not_invited",
          tone: "grey",
          at: null,
          line: "Under 18",
          lineTone: "plain",
        });
      }
    }
  });
  it("still reads 'In the app' when they are, and a past member's day of birth is not judged", () => {
    expect(reason({ ...child, inApp: [{ name: "Leo Park" }] }).reason).toBe("in_app");
    expect(reason({ ...child, former: true, invitation: invitation({ state: "accepted" }) }).reason).toBe("left");
  });
});

describe("the names people really give the app never make a line (RULINGS 2026-09-28: the email is the link)", () => {
  // list name, the name given to the app: the ways people write their own name (W3C's
  // "Personal names around the world"), a short form, an initial, a name made from the
  // address, another script, a word that is no name at all (Kd's "du").
  const cases: [string, string][] = [
    ["Priya Shah", "Shah, Priya"],
    ["Seán O'Neill", "Sean ONeill"],
    ["Daniel Wu", "Dan Wu"],
    ["Daniel Wu", "du"],
    ["Robert Reedman", "Rob Reed"],
    ["Mary Smith", "mary.smith"],
    ["Anil Kumar Velikkakathu", "Anil V."],
    ["Jo Jimenez", "Jo J."],
    ["Zhang Wei", "张伟"],
    ["Leo Park", "Mum"],
  ];
  it.each(cases)("%s in the app as %s", (list, given) => {
    expect(reason({ fullName: list, inApp: [{ name: given }] })).toEqual({ reason: "in_app", tone: "green", at: null, line: null, lineTone: "plain" });
  });
});

describe("the invitation histories found in the local databases, 2026-09-27", () => {
  // Each: the invitation's state, its newest email's state, reason and result, as queried.
  const found: [MemberListInvitation["state"], Email["state"] | null, Email["reason"], Email["result"], string][] = [
    ["withdrawn", null, null, null, "not_invited"],
    ["accepted", null, null, null, "left"],
    ["accepted", "skipped", "invitation_closed", null, "left"],
    ["declined", null, null, null, "declined"],
    ["pending", "skipped", "gym_not_active", null, "not_sent"],
    ["declined", "skipped", "invitation_closed", null, "declined"],
    ["declined", "skipped", "gym_not_active", null, "declined"],
    ["accepted", "skipped", "not_on_list", null, "left"],
  ];
  it.each(found)("%s, newest email %s %s %s → %s", (state, emailState, why, result, expected) => {
    const inv = invitation({ state, email: emailState === null ? null : email({ state: emailState, reason: why, result }) });
    expect(reason({ invitation: inv }).reason).toBe(expected);
  });
  it("the gym-reason email says why in the gym's words", () => {
    const inv = invitation({ email: email({ state: "skipped", reason: "gym_not_active" }) });
    expect(reason({ invitation: inv }).line).toBe(MEMBER_INVITE_EMAIL_REASON_WORDS.gym_not_active);
  });
});

describe("every combination of invitation facts the types allow: a word, and never a false one", () => {
  const emails: (Email | null)[] = [null];
  for (const state of memberInviteEmailStateSchema.options) {
    for (const reason of [null, ...memberInviteEmailReasonSchema.options]) {
      for (const result of [null, ...memberInviteEmailResultSchema.options]) emails.push(email({ state, reason, result }));
    }
  }
  const invitations: (MemberListInvitation | null)[] = [null];
  for (const state of memberInviteStateSchema.options) {
    for (const waitingSince of [null, AT]) {
      for (const notMeAt of [null, AT]) {
        for (const removedAt of [null, REMOVED]) {
          for (const mail of emails) invitations.push(invitation({ state, waitingSince, notMeAt, removedAt, email: mail }));
        }
      }
    }
  }

  it(`${String(invitations.length * 3 * 2)} combinations`, () => {
    let checked = 0;
    for (const inv of invitations) {
      for (const optedOut of [null, "unsubscribed", "complained"] as const) {
        for (const former of [false, true]) {
          const out = reason({ invitation: inv, optedOut, former });
          const where = JSON.stringify({ inv, optedOut, former });
          expect(out.reason, where).not.toBe("in_app");
          if (out.reason === "removed") expect(inv?.state === "withdrawn" && inv.removedAt !== null, where).toBe(true);
          if (out.reason === "left") expect(inv?.state, where).toBe("accepted");
          if (out.reason === "wrong_email") expect(inv?.state === "declined" && inv.notMeAt !== null, where).toBe(true);
          if (out.reason === "waiting") expect(inv?.state === "pending" && inv.waitingSince !== null, where).toBe(true);
          if (out.reason === "declined") expect(inv?.state, where).toBe("declined");
          if (out.reason === "invited" || out.reason === "not_arrived" || out.reason === "not_sent") expect(inv?.state, where).toBe("pending");
          // "Invited" only once an email went, may have gone, or is on its way.
          if (out.reason === "not_sent") expect(inv?.email?.state === "skipped" || inv?.email?.state === "failed", where).toBe(true);
          if (inv === null) expect(["not_invited", "unsubscribed"], where).toContain(out.reason);
          checked += 1;
          // Someone in the app on the record is always "In the app", whatever the invitation says.
          expect(reason({ invitation: inv, optedOut, former, inApp: [{ name: "Emma Hart" }] }).reason, where).toBe("in_app");
        }
      }
    }
    expect(checked).toBe(invitations.length * 6);
  });
});

describe("the three words a screen shows (Kd, 2026-09-27: the list showed too much)", () => {
  const shown: [string, Partial<AppWordInput>, ReturnType<typeof appWord>][] = [
    ["in the app", { inApp: [{ name: "Emma Hart" }] }, { word: "in_app", tone: "green", at: null, line: null, lineTone: "plain" }],
    [
      "in the app under another name, plainly",
      { fullName: "Daniel Wu", inApp: [{ name: "Dan Wu" }] },
      { word: "in_app", tone: "green", at: null, line: null, lineTone: "plain" },
    ],
    ["invited, the day on their page", { invitation: invitation({ email: email({ result: "delivered" }) }) }, { word: "invited", tone: "grey", at: AT, line: "Invitation sent", lineTone: "plain" }],
    [
      "invited, the email bounced: a line to check",
      { invitation: invitation({ email: email({ result: "bounced" }) }) },
      { word: "invited", tone: "grey", at: null, line: "Invitation bounced: this address doesn't accept email. Confirm it with the member.", lineTone: "amber" },
    ],
    [
      "invited, waiting for a place: a line to check",
      { invitation: invitation({ waitingSince: AT }) },
      { word: "invited", tone: "grey", at: null, line: "Emma tried to join, but all 500 places on your plan are in use. Upgrade your plan or remove a member who has left, then ask Emma to try again.", lineTone: "amber" },
    ],
    [
      "wrong email: not in the app, a red line to check",
      { invitation: invitation({ state: "declined", notMeAt: AT }) },
      { word: "not_in_app", tone: "grey", at: null, line: "The recipient at emma@example.com says they aren't Emma. Confirm Emma's email address.", lineTone: "red" },
    ],
    ["removed from the app, with its day", { invitation: invitation({ state: "withdrawn", removedAt: REMOVED }) }, { word: "not_in_app", tone: "grey", at: REMOVED, line: "Removed from app", lineTone: "plain" }],
    ["left the app", { invitation: invitation({ state: "accepted" }) }, { word: "not_in_app", tone: "grey", at: null, line: "Left the app", lineTone: "plain" }],
    ["declined", { invitation: invitation({ state: "declined" }) }, { word: "not_in_app", tone: "grey", at: null, line: "Declined the invitation", lineTone: "plain" }],
    ["unsubscribed", { optedOut: "unsubscribed" }, { word: "not_in_app", tone: "grey", at: null, line: "Unsubscribed from your emails", lineTone: "plain" }],
    ["never invited", {}, { word: "not_in_app", tone: "grey", at: null, line: "Not invited yet", lineTone: "plain" }],
    ["no email address", { email: null }, { word: "not_in_app", tone: "grey", at: null, line: "No email address", lineTone: "plain" }],
    [
      "the son on his mother's email",
      { fullName: "Leo Park", sharedWith: "Maria Park", invitation: invitation({ state: "accepted" }) },
      { word: "not_in_app", tone: "grey", at: null, line: "Maria Park uses the app with this email address.", lineTone: "plain" },
    ],
  ];
  it.each(shown)("%s", (_name, over, expected) => {
    expect(word(over)).toEqual(expected);
  });

  it("every reason lands on exactly one of the three words, and only someone in the app reads In the app", () => {
    const where: Record<AppReasonKind, string> = {
      in_app: "in_app",
      waiting: "invited",
      not_arrived: "invited",
      not_sent: "not_in_app",
      invited: "invited",
      wrong_email: "not_in_app",
      removed: "not_in_app",
      left: "not_in_app",
      unsubscribed: "not_in_app",
      declined: "not_in_app",
      not_invited: "not_in_app",
    };
    const states = [null, ...memberInviteStateSchema.options];
    for (const state of states) {
      for (const over of [{}, { notMeAt: AT }, { waitingSince: AT }, { removedAt: REMOVED }, { email: email({ result: "bounced" }) }]) {
        for (const inApp of [[], [{ name: "Emma Hart" }]]) {
          const input = { invitation: state === null ? null : invitation({ state, ...over }), inApp };
          const found = reason(input);
          const out = word(input);
          expect(out.word, JSON.stringify(input)).toBe(where[found.reason]);
          expect(out.word === "in_app", JSON.stringify(input)).toBe(inApp.length > 0);
          // Never a word with nothing to say why, except In the app.
          if (out.word !== "in_app") expect(out.line, JSON.stringify(input)).not.toBeNull();
        }
      }
    }
  });
});
