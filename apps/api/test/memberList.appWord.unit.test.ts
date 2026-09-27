// THE APP WORD, as a table (spec Part 3 §18.4; ROADMAP 5b-v-a-i). `appWord` decides what
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
import { appWord, type AppWordInput } from "../src/modules/orgs/memberList/appWord.js";

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

const word = (over: Partial<AppWordInput>) => appWord({ ...base, ...over });

describe("the spec's table, one case a row (§18.4)", () => {
  const cases: [string, Partial<AppWordInput>, ReturnType<typeof appWord>][] = [
    ["1 in the app, same name", { inApp: [{ name: "Emma Hart", madeFromAddress: null }] }, { word: "in_app", tone: "green", at: null, line: null, lineTone: "plain" }],
    [
      "1 in the app, another name",
      { fullName: "Daniel Wu", inApp: [{ name: "Dan Wu", madeFromAddress: null }] },
      { word: "in_app", tone: "green", at: null, line: "Signed up in the app as Dan Wu. Check this is them.", lineTone: "amber" },
    ],
    [
      "1 two people in the app on one record",
      { fullName: "Maria Park", inApp: [{ name: "Maria Park", madeFromAddress: null }, { name: "Leo Park", madeFromAddress: null }] },
      { word: "in_app", tone: "green", at: null, line: "Maria Park and Leo Park use the app with these details.", lineTone: "amber" },
    ],
    [
      "1b a past member still in the app",
      { fullName: "Grace Hall", former: true, inApp: [{ name: "Grace Hall", madeFromAddress: null }] },
      { word: "in_app", tone: "amber", at: null, line: "Grace still uses the app through your gym. Remove them from the app if they've left.", lineTone: "amber" },
    ],
    [
      "2 wrong email",
      { invitation: invitation({ state: "declined", notMeAt: AT }) },
      { word: "wrong_email", tone: "red", at: null, line: "Whoever gets email at emma@example.com says they aren't Emma. Check the address with Emma.", lineTone: "red" },
    ],
    [
      "3 waiting for a place",
      { invitation: invitation({ waitingSince: AT }) },
      { word: "waiting", tone: "amber", at: null, line: "Emma tapped Join, but all 500 places in your plan are taken.", lineTone: "amber" },
    ],
    ["4 removed from app", { invitation: invitation({ state: "withdrawn", removedAt: REMOVED }) }, { word: "removed", tone: "grey", at: REMOVED, line: null, lineTone: "plain" }],
    ["5 left the app", { invitation: invitation({ state: "accepted" }) }, { word: "left", tone: "grey", at: null, line: null, lineTone: "plain" }],
    ["6 unsubscribed", { invitation: invitation({ email: email() }), optedOut: "unsubscribed" }, { word: "unsubscribed", tone: "grey", at: null, line: null, lineTone: "plain" }],
    [
      "6 marked as spam",
      { invitation: invitation({ email: email({ result: "complained" }) }) },
      { word: "unsubscribed", tone: "grey", at: null, line: "Marked your invitation as spam.", lineTone: "plain" },
    ],
    ["7 declined", { invitation: invitation({ state: "declined" }) }, { word: "declined", tone: "grey", at: null, line: null, lineTone: "plain" }],
    [
      "8 bounced after it went",
      { invitation: invitation({ email: email({ result: "bounced" }) }) },
      { word: "not_arrived", tone: "amber", at: null, line: "This email bounced: the address doesn't take email. Check it with the person.", lineTone: "amber" },
    ],
    [
      "8 not sent: bad address",
      { invitation: invitation({ email: email({ state: "skipped", reason: "bad_address" }) }) },
      { word: "not_arrived", tone: "amber", at: null, line: MEMBER_INVITE_EMAIL_REASON_WORDS.bad_address, lineTone: "amber" },
    ],
    ["9 invited, the email went", { invitation: invitation({ email: email({ result: "delivered" }) }) }, { word: "invited", tone: "grey", at: AT, line: null, lineTone: "plain" }],
    ["9 invited, still queued", { invitation: invitation({ email: email({ state: "queued" }) }) }, { word: "invited", tone: "grey", at: AT, line: null, lineTone: "plain" }],
    [
      "9 not known whether it went",
      { invitation: invitation({ email: email({ state: "skipped", reason: "send_unknown" }) }) },
      { word: "invited", tone: "grey", at: AT, line: MEMBER_INVITE_EMAIL_REASON_WORDS.send_unknown, lineTone: "plain" },
    ],
    ["10 never invited", {}, { word: "not_invited", tone: "grey", at: null, line: null, lineTone: "plain" }],
    ["10 no email address", { email: null }, { word: "not_invited", tone: "grey", at: null, line: "No email address", lineTone: "plain" }],
    ["10 under 18 by the gym's day", { dateOfBirth: "2008-09-28" }, { word: "not_invited", tone: "grey", at: null, line: "Under 18", lineTone: "plain" }],
    ["10 eighteen today", { dateOfBirth: "2008-09-27" }, { word: "not_invited", tone: "grey", at: null, line: null, lineTone: "plain" }],
    [
      "10 invitation cancelled when moved to past members",
      { former: true, invitation: invitation({ state: "withdrawn" }) },
      { word: "not_invited", tone: "grey", at: null, line: "Invitation cancelled", lineTone: "plain" },
    ],
  ];
  it.each(cases)("%s", (_name, over, expected) => {
    expect(word(over)).toEqual(expected);
  });
});

describe("a household: two records on one email, the person in the app matched to the other", () => {
  it("the other record says who uses the email, never their 'Left the app' or 'Invited'", () => {
    for (const state of memberInviteStateSchema.options) {
      const out = word({ fullName: "Leo Park", sharedWith: "Maria Park", invitation: invitation({ state }) });
      expect(out, state).toEqual({ word: "not_invited", tone: "grey", at: null, line: "Maria Park uses the app with this email.", lineTone: "plain" });
    }
  });
  it("a record that reaches someone itself still reads 'In the app'", () => {
    expect(word({ sharedWith: "Maria Park", inApp: [{ name: "Emma Hart", madeFromAddress: null }] }).word).toBe("in_app");
  });
});

describe("someone the list says is under 18", () => {
  const child = { fullName: "Leo Park", dateOfBirth: "2012-05-01" };
  it("reads 'Not invited · Under 18' whatever their address's invitation says: it was a parent's, or came before the date was corrected", () => {
    for (const state of memberInviteStateSchema.options) {
      for (const over of [{}, { notMeAt: AT }, { waitingSince: AT }, { removedAt: REMOVED }, { email: email() }]) {
        expect(word({ ...child, invitation: invitation({ state, ...over }) }), `${state} ${JSON.stringify(over)}`).toEqual({
          word: "not_invited",
          tone: "grey",
          at: null,
          line: "Under 18",
          lineTone: "plain",
        });
      }
    }
  });
  it("still reads 'In the app' when they are, and a past member's day of birth is not judged", () => {
    expect(word({ ...child, inApp: [{ name: "Leo Park", madeFromAddress: null }] }).word).toBe("in_app");
    expect(word({ ...child, former: true, invitation: invitation({ state: "accepted" }) }).word).toBe("left");
  });
});

describe("names the way people really sign up (the rule is nameCheck's, 3b-ii-b)", () => {
  const cases: [string, string, string | null, boolean][] = [
    // list name, signed-up name, the address it was made from, asks staff to check
    ["Priya Shah", "Shah, Priya", null, false],
    ["Seán O'Neill", "Sean ONeill", null, false],
    ["Daniel Wu", "Dan Wu", null, true],
    ["Robert Reedman", "Rob Reed", null, true],
    ["Mary Smith", "mary.smith", "mary.smith", true],
    ["Anil Kumar Velikkakathu", "Anil V.", null, true],
    ["Jo Jimenez", "Jo J.", null, true],
    ["Zhang Wei", "张伟", null, true],
    ["Leo Park", "Mum", null, true],
  ];
  it.each(cases)("%s signed up as %s", (list, signed, made, asks) => {
    const out = word({ fullName: list, inApp: [{ name: signed, madeFromAddress: made }] });
    expect(out.word).toBe("in_app");
    expect(out.line === null ? false : out.line.startsWith("Signed up in the app as")).toBe(asks);
  });
});

describe("the invitation histories found in the local databases, 2026-09-27", () => {
  // Each: the invitation's state, its newest email's state, reason and result, as queried.
  const found: [MemberListInvitation["state"], Email["state"] | null, Email["reason"], Email["result"], string][] = [
    ["withdrawn", null, null, null, "not_invited"],
    ["accepted", null, null, null, "left"],
    ["accepted", "skipped", "invitation_closed", null, "left"],
    ["declined", null, null, null, "declined"],
    ["pending", "skipped", "gym_not_active", null, "not_arrived"],
    ["declined", "skipped", "invitation_closed", null, "declined"],
    ["declined", "skipped", "gym_not_active", null, "declined"],
    ["accepted", "skipped", "not_on_list", null, "left"],
  ];
  it.each(found)("%s, newest email %s %s %s → %s", (state, emailState, reason, result, expected) => {
    const inv = invitation({ state, email: emailState === null ? null : email({ state: emailState, reason, result }) });
    expect(word({ invitation: inv }).word).toBe(expected);
  });
  it("the gym-reason email says why in the gym's words", () => {
    const inv = invitation({ email: email({ state: "skipped", reason: "gym_not_active" }) });
    expect(word({ invitation: inv }).line).toBe(MEMBER_INVITE_EMAIL_REASON_WORDS.gym_not_active);
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
          const out = word({ invitation: inv, optedOut, former });
          const where = JSON.stringify({ inv, optedOut, former });
          expect(out.word, where).not.toBe("in_app");
          if (out.word === "removed") expect(inv?.state === "withdrawn" && inv.removedAt !== null, where).toBe(true);
          if (out.word === "left") expect(inv?.state, where).toBe("accepted");
          if (out.word === "wrong_email") expect(inv?.state === "declined" && inv.notMeAt !== null, where).toBe(true);
          if (out.word === "waiting") expect(inv?.state === "pending" && inv.waitingSince !== null, where).toBe(true);
          if (out.word === "declined") expect(inv?.state, where).toBe("declined");
          if (out.word === "invited" || out.word === "not_arrived") expect(inv?.state, where).toBe("pending");
          if (inv === null) expect(["not_invited", "unsubscribed"], where).toContain(out.word);
          checked += 1;
          // Someone in the app on the record is always "In the app", whatever the invitation says.
          expect(word({ invitation: inv, optedOut, former, inApp: [{ name: "Emma Hart", madeFromAddress: null }] }).word, where).toBe("in_app");
        }
      }
    }
    expect(checked).toBe(invitations.length * 6);
  });
});
