// "Send them for me", the pure parts (ROADMAP 20c-v-a; Part 3 §16.3): the rule that
// decides whether a lead's follow-up may go, who sends a due one, the email itself and
// its Stop token. No database.
import { describe, expect, it } from "vitest";
import { LEAD_EMAIL_NOT_SENT, leadFollowUpLetter } from "@app/shared";
import { leadFollowUpEmail } from "../src/email/templates.js";
import { inviteLinkToken, readInviteLinkToken, readUnsubscribeToken } from "../src/modules/orgs/invites/token.js";
import type { LeadSendState } from "../src/modules/orgs/leads/emailsRepo.js";
import { decideLeadSend, type LeadSendFacts } from "../src/modules/orgs/leads/sendRule.js";
import { appSending, appWhen, whoSends } from "../src/modules/orgs/leads/service.js";
import type { GymSendingFacts } from "../src/modules/orgs/leads/emailsRepo.js";

// =========================================================================
// THE RULE: MAY THIS FOLLOW-UP GO NOW?
// =========================================================================

const allowed: LeadSendFacts = {
  gym: { active: true, onPlan: true, switchedOn: true, stopped: false, hasPostalAddress: true, named: true },
  lead: { isNew: true, sameTick: true, sameAddress: true, nextStep: true, due: true },
  suppression: null,
  onMemberList: false,
  addressValid: true,
  shared: false,
  mail: "accepts",
};

const gym = (change: Partial<NonNullable<LeadSendFacts["gym"]>>): Partial<LeadSendFacts> => ({
  gym: { ...(allowed.gym as NonNullable<LeadSendFacts["gym"]>), ...change },
});
const lead = (change: Partial<NonNullable<LeadSendFacts["lead"]>>): Partial<LeadSendFacts> => ({
  lead: { ...(allowed.lead as NonNullable<LeadSendFacts["lead"]>), ...change },
});

describe("decideLeadSend — every class of case", () => {
  const cases: [string, Partial<LeadSendFacts>, ReturnType<typeof decideLeadSend>][] = [
    ["everything allows it", {}, { kind: "send" }],
    // The gym: not due for anybody now, so forgotten, and the gym passed over this run.
    ["the gym is gone", { gym: null }, { kind: "drop", reason: "gym_not_active", of: "gym" }],
    ["the gym is closed", gym({ active: false }), { kind: "drop", reason: "gym_not_active", of: "gym" }],
    ["the gym has no plan", gym({ onPlan: false }), { kind: "drop", reason: "gym_not_active", of: "gym" }],
    ["the switch was turned off", gym({ switchedOn: false }), { kind: "drop", reason: "switched_off", of: "gym" }],
    ["the gym's sending was stopped", gym({ stopped: true }), { kind: "drop", reason: "sending_stopped", of: "gym" }],
    ["the postal address was cleared", gym({ hasPostalAddress: false }), { kind: "drop", reason: "no_postal_address", of: "gym" }],
    ["the gym's name cannot be shown", gym({ named: false }), { kind: "drop", reason: "gym_name", of: "gym" }],
    // The lead moved on: said stop, or staff did something first.
    ["the lead was deleted", { lead: null }, { kind: "drop", reason: "lead_gone", of: "lead" }],
    ["the lead is no longer New", lead({ isNew: false }), { kind: "drop", reason: "not_new", of: "lead" }],
    ["the tick came off (or off and on again)", lead({ sameTick: false }), { kind: "drop", reason: "tick_changed", of: "lead" }],
    ["the lead has a new address", lead({ sameAddress: false }), { kind: "drop", reason: "address_changed", of: "lead" }],
    ["staff marked this one sent", lead({ nextStep: false }), { kind: "drop", reason: "already_sent", of: "lead" }],
    ["its day has not come", lead({ due: false }), { kind: "drop", reason: "not_due", of: "lead" }],
    // The address: the app will not send to it, and says why; staff may.
    ["they pressed Stop", { suppression: "unsubscribed" }, { kind: "skip", reason: "unsubscribed" }],
    ["they marked one as spam", { suppression: "complained" }, { kind: "skip", reason: "complained" }],
    ["the address bounced", { suppression: "bounced" }, { kind: "skip", reason: "bounced" }],
    ["Resend refuses the address", { suppression: "refused" }, { kind: "skip", reason: "refused" }],
    ["the address is on the member list", { onMemberList: true }, { kind: "skip", reason: "on_member_list" }],
    ["the address fails sign-in's own rule", { addressValid: false }, { kind: "skip", reason: "bad_address" }],
    ["a shared mailbox", { shared: true }, { kind: "skip", reason: "shared_address" }],
    ["the domain takes no mail", { mail: "no_mail" }, { kind: "skip", reason: "no_mail_domain" }],
    // Not known yet.
    ["the domain has not been asked", { mail: null }, { kind: "check_mail" }],
    ["the domain could not be asked", { mail: "unknown" }, { kind: "retry" }],
  ];
  for (const [name, change, expected] of cases) {
    it(name, () => {
      expect(decideLeadSend({ ...allowed, ...change })).toEqual(expected);
    });
  }

  it("each reason on its own stops the send; the gym is asked before the lead, the lead before the address", () => {
    expect(decideLeadSend({ ...allowed, ...gym({ switchedOn: false }), ...lead({ isNew: false }), suppression: "unsubscribed" })).toMatchObject({
      reason: "switched_off",
    });
    expect(decideLeadSend({ ...allowed, ...lead({ sameTick: false }), suppression: "unsubscribed", onMemberList: true })).toMatchObject({
      reason: "tick_changed",
    });
    expect(decideLeadSend({ ...allowed, suppression: "bounced", onMemberList: true, shared: true })).toMatchObject({ reason: "bounced" });
    // A suppression is a skip even before the domain is asked: no DNS for an address that asked to stop.
    expect(decideLeadSend({ ...allowed, suppression: "unsubscribed", mail: null })).toEqual({ kind: "skip", reason: "unsubscribed" });
  });

  it("every skip is one of the reasons staff are told", () => {
    const reasons = cases.flatMap(([, , expected]) => (expected.kind === "skip" ? [expected.reason] : []));
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) expect(LEAD_EMAIL_NOT_SENT).toContain(reason);
  });
});

// =========================================================================
// WHO SENDS A DUE ONE: THE APP, OR STAFF
// =========================================================================

describe("whoSends — every class of case", () => {
  const on = { on: true, roomLeft: true, pageStopped: false };
  const full = { on: true, roomLeft: false, pageStopped: false };
  const off = { on: false, roomLeft: true, pageStopped: false };
  const pagePaused = { on: true, roomLeft: true, pageStopped: true };
  const state = (continuing: boolean, next: LeadSendState["next"] = null, open = false): LeadSendState => ({ continuing, next, open });
  const cases: [string, string | null, { on: boolean; roomLeft: boolean; pageStopped: boolean }, LeadSendState | undefined, boolean, ReturnType<typeof whoSends>][] = [
    ["nothing due", null, on, undefined, false, { by: null, notSent: null }],
    ["nothing due, even with a skipped try", null, on, state(false, { state: "skipped", reason: "bounced" }), false, { by: null, notSent: null }],
    ["switch off", "2026-10-01", off, undefined, false, { by: "you", notSent: null }],
    ["switch on, room in the month", "2026-10-01", on, undefined, false, { by: "app", notSent: null }],
    ["switch on, month full, a new lead", "2026-10-01", full, state(false), false, { by: "you", notSent: null }],
    ["switch on, month full, a lead the app already emails", "2026-10-01", full, state(true), false, { by: "app", notSent: null }],
    ["being sent now", "2026-10-01", full, state(true, { state: "sending", reason: null }, true), false, { by: "app", notSent: null }],
    ["may have gone", "2026-10-01", on, state(true, { state: "failed", reason: "send_unknown" }), false, { by: "app", notSent: null }],
    ["skipped: they pressed Stop", "2026-10-01", on, state(true, { state: "skipped", reason: "unsubscribed" }), false, { by: "you", notSent: "unsubscribed" }],
    ["skipped: on the member list", "2026-10-01", on, state(false, { state: "skipped", reason: "on_member_list" }), false, { by: "you", notSent: "on_member_list" }],
    ["gave up after a week", "2026-10-01", on, state(false, { state: "failed", reason: "provider_refused" }), false, { by: "you", notSent: "could_not_send" }],
    ["a reason no longer known", "2026-10-01", on, state(false, { state: "skipped", reason: "something_new" }), false, { by: "you", notSent: "could_not_send" }],
    ["switch off after a skip still says why", "2026-10-01", off, state(false, { state: "skipped", reason: "bounced" }), false, { by: "you", notSent: "bounced" }],
    // The two passes over 20c (2026-09-30).
    ["a try in flight, switch turned off since: still the app's", "2026-10-01", off, state(false, { state: "queued", reason: null }, true), false, { by: "app", notSent: null }],
    ["a try in flight under an earlier tick: the app's", "2026-10-01", on, state(false, null, true), false, { by: "app", notSent: null }],
    ["a try in flight, sending paused (the operator): the app's", "2026-10-01", { on: false, roomLeft: false, pageStopped: false }, state(false, null, true), false, { by: "app", notSent: null }],
    ["ticked on the page, page emails paused: staff's, and why", "2026-10-01", pagePaused, undefined, true, { by: "you", notSent: "page_emails_stopped" }],
    ["ticked on the page, page emails going: the app's", "2026-10-01", on, undefined, true, { by: "app", notSent: null }],
    ["ticked by staff, page emails paused: the app's", "2026-10-01", pagePaused, undefined, false, { by: "app", notSent: null }],
    ["ticked on the page, paused, a try already in flight: the app's", "2026-10-01", pagePaused, state(false, null, true), true, { by: "app", notSent: null }],
  ];
  for (const [name, dueOn, app, sendState, byPage, expected] of cases) {
    it(name, () => {
      expect(whoSends(dueOn, app, sendState, byPage)).toEqual(expected);
    });
  }
});

// =========================================================================
// WHEN THE APP SENDS ONE IT TAKES, AND WHETHER IT IS SENDING AT ALL
// =========================================================================

describe("appWhen — every class of case", () => {
  const today = "2026-10-01";
  const held: LeadSendState = { continuing: true, next: { state: "queued", reason: null }, open: true };
  const cases: [string, string | null, number, LeadSendState | undefined, ReturnType<typeof appWhen>][] = [
    ["nothing due", null, 12, undefined, null],
    ["due another day: its day is said instead", "2026-10-03", 12, undefined, null],
    ["due today, before 8", today, 7, undefined, "today"],
    ["due today, at 8", today, 8, undefined, "today"],
    ["due today, at 19", today, 19, undefined, "today"],
    ["due today, at 20: tomorrow morning", today, 20, undefined, "tomorrow"],
    ["due today, at 23", today, 23, undefined, "tomorrow"],
    ["due yesterday, before 8 (last night's form)", "2026-09-30", 7, undefined, "today"],
    ["due yesterday, in the hours: the app is behind", "2026-09-30", 9, undefined, "waiting"],
    ["due yesterday, after 20", "2026-09-30", 21, undefined, "tomorrow"],
    ["held for another try, in the hours", today, 10, held, "waiting"],
    ["held for another try, at night", today, 22, held, "waiting"],
    ["being sent now", today, 10, { continuing: true, next: { state: "sending", reason: null }, open: false }, "today"],
    ["a try in flight under an earlier tick, in the hours", today, 10, { continuing: false, next: null, open: true }, "waiting"],
  ];
  for (const [name, dueOn, hour, state, expected] of cases) {
    it(name, () => {
      expect(appWhen(dueOn, today, hour, state)).toBe(expected);
    });
  }
});

describe("appSending — the app sends only when emails can go and the gym can send", () => {
  const ready: GymSendingFacts = {
    sendForMe: true,
    replyTo: "desk@gym.example.com",
    name: "Iron House",
    hasPostalAddress: true,
    stopped: false,
    pageStopped: false,
    active: true,
    onPlan: true,
    usedThisMonth: 3,
    localHour: 10,
  };
  const cases: [string, Partial<GymSendingFacts>, "on" | "paused" | "off", boolean][] = [
    ["everything ready", {}, "on", true],
    ["the kill switch on", {}, "paused", false],
    ["sending not set up", {}, "off", false],
    ["the switch off", { sendForMe: false }, "on", false],
    ["no reply address", { replyTo: null }, "on", false],
    ["no postal address", { hasPostalAddress: false }, "on", false],
    ["the gym stopped", { stopped: true }, "on", false],
    ["only its page emails paused: it still sends staff's leads' emails", { pageStopped: true }, "on", true],
    ["the gym closed", { active: false }, "on", false],
    ["no plan", { onPlan: false }, "on", false],
    ["a name no email can show", { name: "@@@" }, "on", false],
  ];
  for (const [name, change, sending, on] of cases) {
    it(name, () => {
      expect(appSending({ ...ready, ...change }, sending).on).toBe(on);
    });
  }
  it("room in the month is under 100; no gym is nothing", () => {
    expect(appSending({ ...ready, usedThisMonth: 99 }, "on").roomLeft).toBe(true);
    expect(appSending({ ...ready, usedThisMonth: 100 }, "on").roomLeft).toBe(false);
    expect(appSending(null, "on")).toMatchObject({ on: false, roomLeft: false });
  });
});

// =========================================================================
// THE EMAIL, AND ITS STOP LINK
// =========================================================================

describe("the follow-up email", () => {
  const words = {
    to: "priya@example.com",
    firstName: "Priya",
    gymName: "Iron House",
    postalAddress: "12 Kirkgate, Leeds LS1 6BY",
    unsubscribeLink: "https://api.example.com/v1/email/leads/unsubscribe?t=abc.def",
  };

  it("each of the three is the panel's letter, signed by the gym, with who sent it, the address and Stop", () => {
    for (const step of [1, 2, 3]) {
      const email = leadFollowUpEmail({ ...words, step });
      const letter = leadFollowUpLetter(step, "Iron House");
      if (email === null || letter === null) throw new Error(`no email ${String(step)}`);
      expect(email.subject).toBe(letter.subject);
      expect(email.text.startsWith(`Hi Priya,\n\n${letter.lines.join("\n\n")}\n\nIron House\n12 Kirkgate, Leeds LS1 6BY\n\n`)).toBe(true);
      expect(email.text).toContain("You're getting this because you asked Iron House about joining and said they could email you.");
      expect(email.text).toContain("Sent by AI Home Gym on behalf of Iron House, 12 Kirkgate, Leeds LS1 6BY.");
      expect(email.text).toContain(`Stop emails from Iron House through AI Home Gym: ${words.unsubscribeLink}`);
      expect(email.html).toContain(`href="${words.unsubscribeLink}"`);
    }
    expect(leadFollowUpEmail({ ...words, step: 4 })).toBeNull();
    expect(leadFollowUpEmail({ ...words, step: 0 })).toBeNull();
  });

  it("a lead with no first name is greeted 'Hi,'; the gym's words are escaped in the HTML", () => {
    const email = leadFollowUpEmail({ ...words, step: 1, firstName: "", gymName: "Tom & Jo's <Gym>" });
    expect(email?.text.startsWith("Hi,\n\n")).toBe(true);
    expect(email?.html).toContain("Tom &amp; Jo's &lt;Gym&gt;");
    expect(email?.html).not.toContain("<Gym>");
  });

  it("the Stop token names the email, and no other kind of link reads it", () => {
    const key = Buffer.from("k".repeat(32));
    const id = "0b9e8f1c-3a2d-4c5b-8e7f-1a2b3c4d5e6f";
    const token = inviteLinkToken(key, "lead_unsubscribe", id);
    expect(readInviteLinkToken(key, "lead_unsubscribe", token)).toBe(id);
    expect(readUnsubscribeToken(key, token)).toBeNull();
    expect(readInviteLinkToken(key, "not_me", token)).toBeNull();
    expect(readInviteLinkToken(Buffer.from("x".repeat(32)), "lead_unsubscribe", token)).toBeNull();
    expect(readInviteLinkToken(key, "lead_unsubscribe", inviteLinkToken(key, "unsubscribe", id))).toBeNull();
  });
});
