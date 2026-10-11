// THE MESSAGE RULE (spec Part 3 §16.2; ROADMAP 20a): every kind of message against every
// reason NOT to send it. The worst thing it could do: a message to somebody the gym
// removed, or the same message twice.
import { describe, expect, it } from "vitest";
import {
  GYM_MESSAGE_HELD_REASONS,
  GYM_MESSAGE_KINDS,
  GYM_MESSAGE_STARTING_NUMBERS,
  GYM_MESSAGE_STARTING_ON,
  automaticMessage,
  dayInWords,
  greetingName,
  gymInboxResponseSchema,
  gymMessageDue,
  gymMessageOccasions,
  markGymInboxReadRequestSchema,
  welcomeMessage,
  type GymMessageFacts,
  type GymMessageHeldReason,
  type GymMessageKind,
} from "../src/gymMessages.js";

const TODAY = "2026-10-09";

type Person = GymMessageFacts["person"];
const nobody: Person = {
  member: true,
  former: false,
  staff: false,
  off: [],
  joinedOn: "2026-01-05",
  joinedUtcOn: "2026-01-05",
  trial: null,
  ending: null,
  bills: [],
  birthday: null,
  visits: 12,
  recentVisitDays: 0,
  lastVisitOn: "2026-10-07",
  lastSeenOn: "2026-10-07",
};
/** A gym that checked somebody in on every one of the last 400 days. */
const EVERY_DAY = Array.from({ length: 400 }, (_, back) => new Date(Date.UTC(2026, 9, 9) - back * 86_400_000).toISOString().slice(0, 10));
const facts = (person: Partial<Person> = {}, over: { gym?: Partial<GymMessageFacts["gym"]>; sent?: GymMessageFacts["sent"] } = {}): GymMessageFacts => ({
  gym: { open: true, live: true, today: TODAY, hour: 12, on: GYM_MESSAGE_STARTING_ON, numbers: GYM_MESSAGE_STARTING_NUMBERS, visitDays: EVERY_DAY, billsOverdueAfterDays: 0, takesPayments: true, ...over.gym },
  person: { ...nobody, ...person },
  sent: over.sent ?? [],
});

/** One person for each kind, for whom that kind and no other has its occasion today. */
const DUE: Record<GymMessageKind, { person: Partial<Person>; occasion: string; endsOn?: string }> = {
  payment_overdue: { person: { bills: [{ id: "b1", dueOn: "2026-10-06", paid: false }] }, occasion: "bill:b1" },
  membership_ending: { person: { ending: { id: "m1", startsOn: "2026-07-17", endsOn: "2026-10-16" } }, occasion: "ends:m1", endsOn: "2026-10-16" },
  trial_ending: { person: { trial: { id: "t1", startsOn: "2026-09-28", endsOn: "2026-10-11", next: false } }, occasion: "trial:t1", endsOn: "2026-10-11" },
  trial_check_in: { person: { trial: { id: "t2", startsOn: "2026-10-08", endsOn: "2026-10-21", next: false } }, occasion: "trial:t2" },
  // Joined late on the 8th in UTC, which is the 9th on this gym's calendar.
  welcome: { person: { joinedOn: "2026-10-09", joinedUtcOn: "2026-10-08" }, occasion: "joined:2026-10-08" },
  birthday: { person: { birthday: "10-09" }, occasion: "birthday:2026" },
  milestone: { person: { visits: 50, recentVisitDays: 1, lastVisitOn: TODAY }, occasion: "visits:50" },
  miss_you: { person: { lastVisitOn: "2026-09-29", lastSeenOn: "2026-09-29" }, occasion: "absent:2026-09-29" },
};

/** The occasion the rule answers for a kind's own person. */
const occasionOf = (kind: GymMessageKind) => {
  const { occasion, endsOn } = DUE[kind];
  return endsOn === undefined ? { kind, occasion } : { kind, occasion, endsOn };
};

/** Each reason not to send, as a change to the facts of a person who would be sent `kind`. */
const HELD: Record<GymMessageHeldReason, (kind: GymMessageKind, occasion: string) => { person?: Partial<Person>; gym?: Partial<GymMessageFacts["gym"]>; sent?: GymMessageFacts["sent"] }> = {
  gym_lapsed: () => ({ gym: { live: false } }),
  removed: () => ({ person: { member: false } }),
  former: () => ({ person: { former: true } }),
  gym_off: (kind) => ({ gym: { on: { ...GYM_MESSAGE_STARTING_ON, [kind]: false } } }),
  person_off: (kind) => ({ person: { off: [kind] } }),
  already_sent: (kind, occasion) => ({ sent: [{ kind, occasion, day: "2026-10-01" }] }),
  another_today: (kind) => ({ sent: [{ kind: kind === "birthday" ? "welcome" : "birthday", occasion: "something-else", day: TODAY }] }),
  night: () => ({ gym: { hour: 23 } }),
};

describe("the message rule", () => {
  it("each kind has its occasion, and is sent, for its own person and for nobody else's", () => {
    expect(gymMessageDue(facts())).toEqual({ send: null, held: [] });
    for (const kind of GYM_MESSAGE_KINDS) {
      const due = gymMessageDue(facts(DUE[kind].person));
      expect(due, kind).toEqual({ send: occasionOf(kind), held: [] });
    }
  });

  describe.each(GYM_MESSAGE_KINDS)("%s", (kind) => {
    it.each(GYM_MESSAGE_HELD_REASONS)("is not sent: %s", (reason) => {
      const change = HELD[reason](kind, DUE[kind].occasion);
      const due = gymMessageDue(facts({ ...DUE[kind].person, ...change.person }, { ...(change.gym === undefined ? {} : { gym: change.gym }), ...(change.sent === undefined ? {} : { sent: change.sent }) }));
      // A payment notice is the one kind a person cannot switch off.
      if (kind === "payment_overdue" && reason === "person_off") {
        expect(due.send).toEqual(occasionOf(kind));
        return;
      }
      expect(due.send).toBeNull();
      expect(due.held).toEqual([{ ...occasionOf(kind), reason }]);
    });
  });

  it("a closed gym sends nothing, as a gym on no plan does", () => {
    for (const kind of GYM_MESSAGE_KINDS) expect(gymMessageDue(facts(DUE[kind].person, { gym: { open: false } })).send, kind).toBeNull();
  });

  it("run again with what it sent, it sends nothing", () => {
    for (const kind of GYM_MESSAGE_KINDS) {
      const first = gymMessageDue(facts(DUE[kind].person));
      if (first.send === null) throw new Error(`${kind} was not sent`);
      const again = gymMessageDue(facts(DUE[kind].person, { sent: [{ ...first.send, day: TODAY }] }));
      expect(again.send, kind).toBeNull();
    }
  });

  it("one message a day: with several due, the first in the order goes and the rest wait", () => {
    const person = { ...DUE.payment_overdue.person, ...DUE.birthday.person, ...DUE.welcome.person };
    const due = gymMessageDue(facts(person));
    expect(due.send).toEqual({ kind: "payment_overdue", occasion: "bill:b1" });
    expect(due.held).toEqual([
      { kind: "welcome", occasion: "joined:2026-10-08", reason: "another_today" },
      { kind: "birthday", occasion: "birthday:2026", reason: "another_today" },
    ]);
    // The next day the bill's notice is not sent again, and Welcome goes.
    const next = gymMessageDue(facts({ ...person, birthday: null }, { gym: { today: "2026-10-10" }, sent: [{ kind: "payment_overdue", occasion: "bill:b1", day: TODAY }] }));
    expect(next.send).toEqual({ kind: "welcome", occasion: "joined:2026-10-08" });
  });

  it("the hours: nothing before 08:00 or from 21:00 on the gym's clock", () => {
    const sentAt = (hour: number) => gymMessageDue(facts(DUE.welcome.person, { gym: { hour } })).send !== null;
    expect([0, 7, 8, 12, 20, 21, 23].map(sentAt)).toEqual([false, false, true, true, true, false, false]);
    expect(sentAt(Number.NaN)).toBe(false);
    expect(sentAt(12.5)).toBe(false);
  });
});

describe("the occasions", () => {
  const kinds = (person: Partial<Person>, today = TODAY) => gymMessageOccasions(facts(person, { gym: { today } })).map((o) => o.kind);

  it("payment overdue: the day after the gym's grace period, for 30 days, never for a paid bill or a gym that records no payments", () => {
    const bill = (dueOn: string, paid = false) => ({ id: "b1", dueOn, paid });
    const due = (dueOn: string, gym: Partial<GymMessageFacts["gym"]> = {}, paid = false) =>
      gymMessageOccasions(facts({ bills: [bill(dueOn, paid)] }, { gym })).map((o) => o.kind);
    // No grace: due today is not overdue, due yesterday is.
    expect(due(TODAY)).toEqual([]);
    expect(due("2026-10-08")).toEqual(["payment_overdue"]);
    expect(due("2026-09-01", {}, true)).toEqual([]);
    // Seven days' grace: overdue from the eighth day, as the person's page reads it.
    expect(due("2026-10-02", { billsOverdueAfterDays: 7 })).toEqual([]);
    expect(due("2026-10-01", { billsOverdueAfterDays: 7 })).toEqual(["payment_overdue"]);
    // Overdue for 30 days at most: an old bill is not news on the first day a gym uses this.
    expect(due("2026-09-09")).toEqual(["payment_overdue"]);
    expect(due("2026-09-08")).toEqual([]);
    expect(due("2026-09-02", { billsOverdueAfterDays: 7 })).toEqual(["payment_overdue"]);
    expect(due("2026-09-01", { billsOverdueAfterDays: 7 })).toEqual([]);
    // A gym that records no payments in the app tells nobody they owe it.
    expect(due("2026-10-08", { takesPayments: false })).toEqual([]);
    // A grace period that is no number is no decision.
    expect(due("2026-10-01", { billsOverdueAfterDays: Number.NaN })).toEqual([]);
    expect(due("2026-10-01", { billsOverdueAfterDays: -1 })).toEqual([]);
    expect(due("2026-10-01", { billsOverdueAfterDays: 1.5 })).toEqual([]);
    // Each bill is its own occasion.
    expect(gymMessageOccasions(facts({ bills: [{ id: "b1", dueOn: "2026-10-01", paid: false }, { id: "b2", dueOn: "2026-10-02", paid: false }] })).map((o) => o.occasion)).toEqual(["bill:b1", "bill:b2"]);
  });

  it("membership ending: within the gym's days of the last day, not after it, and only for one twice as long as the notice", () => {
    const ending = (startsOn: string, endsOn: string, today = TODAY) => kinds({ ending: { id: "m1", startsOn, endsOn } }, today);
    expect(ending("2026-01-01", "2026-10-17")).toEqual([]);
    expect(ending("2026-01-01", "2026-10-16")).toEqual(["membership_ending"]);
    expect(ending("2026-01-01", TODAY)).toEqual(["membership_ending"]);
    expect(ending("2026-01-01", "2026-10-08")).toEqual([]);
    // A week's pass with a week's notice would be told on the day it began: 13 days is too
    // short, 14 is not.
    expect(ending("2026-10-04", "2026-10-16")).toEqual([]);
    expect(ending("2026-10-03", "2026-10-16")).toEqual(["membership_ending"]);
    // A day pass is never "ending".
    expect(ending(TODAY, TODAY)).toEqual([]);
    // Named by its row: a freeze that moves the last day makes no second occasion.
    expect(gymMessageOccasions(facts({ ending: { id: "m1", startsOn: "2026-01-01", endsOn: "2026-10-12" } }))).toEqual([{ kind: "membership_ending", occasion: "ends:m1", endsOn: "2026-10-12" }]);
  });

  it("a trial: the check-in on day 2 or a day late, the ending in its last days, neither outside it", () => {
    const trial = (startsOn: string, endsOn: string, next = false) => kinds({ trial: { id: "t1", startsOn, endsOn, next } });
    expect(trial(TODAY, "2026-10-22")).toEqual([]);
    expect(trial("2026-10-08", "2026-10-21")).toEqual(["trial_check_in"]);
    expect(trial("2026-10-07", "2026-10-20")).toEqual(["trial_check_in"]);
    expect(trial("2026-10-06", "2026-10-19")).toEqual([]);
    expect(trial("2026-09-28", "2026-10-11")).toEqual(["trial_ending"]);
    expect(trial("2026-09-28", "2026-10-12")).toEqual([]);
    expect(trial("2026-09-20", "2026-10-08")).toEqual([]);
    expect(trial("2026-10-10", "2026-10-23")).toEqual([]);
    // A three-day trial is shorter than twice the notice: the check-in on day 2, no ending.
    expect(trial("2026-10-08", "2026-10-10")).toEqual(["trial_check_in"]);
    // A four-day trial: both are due on day 3, and the ending is first.
    expect(trial("2026-10-07", "2026-10-10")).toEqual(["trial_ending", "trial_check_in"]);
    // Another membership is already theirs: the trial's end is no news, the check-in still goes.
    expect(trial("2026-09-28", "2026-10-11", true)).toEqual([]);
    expect(trial("2026-10-08", "2026-10-21", true)).toEqual(["trial_check_in"]);
    // Both are named by the trial's own row.
    expect(gymMessageOccasions(facts({ trial: { id: "t9", startsOn: "2026-10-07", endsOn: "2026-10-10", next: false } }))).toEqual([
      { kind: "trial_ending", occasion: "trial:t9", endsOn: "2026-10-10" },
      { kind: "trial_check_in", occasion: "trial:t9" },
    ]);
  });

  it("welcome: for three days from joining, never for the gym's own staff", () => {
    expect(kinds({ joinedOn: "2026-10-07" })).toEqual(["welcome"]);
    expect(kinds({ joinedOn: "2026-10-06" })).toEqual([]);
    expect(kinds({ joinedOn: "2026-10-10" })).toEqual([]);
    expect(kinds({ joinedOn: TODAY, staff: true })).toEqual([]);
    expect(kinds({ joinedOn: null })).toEqual([]);
    expect(kinds({ joinedOn: TODAY, joinedUtcOn: null })).toEqual([]);
  });

  it("welcome: the gym changing its time zone does not make one join a second occasion", () => {
    // Joined 19:00 UTC on the 9th: the 10th in Kolkata, the 9th in London.
    const inKolkata = facts({ joinedOn: "2026-10-10", joinedUtcOn: "2026-10-09" }, { gym: { today: "2026-10-10" } });
    const first = gymMessageDue(inKolkata).send;
    expect(first).toEqual({ kind: "welcome", occasion: "joined:2026-10-09" });
    if (first === null) throw new Error("not sent");
    const inLondon = facts({ joinedOn: "2026-10-09", joinedUtcOn: "2026-10-09" }, { gym: { today: "2026-10-11" }, sent: [{ ...first, day: "2026-10-10" }] });
    expect(gymMessageDue(inLondon)).toEqual({ send: null, held: [{ kind: "welcome", occasion: "joined:2026-10-09", reason: "already_sent" }] });
  });

  it("birthday: on the day, once a year; 29 February is kept on the 28th in a short year", () => {
    expect(kinds({ birthday: "10-10" })).toEqual([]);
    expect(gymMessageOccasions(facts({ birthday: "10-09" }))).toEqual([{ kind: "birthday", occasion: "birthday:2026" }]);
    expect(kinds({ birthday: "02-29", lastVisitOn: null, lastSeenOn: null }, "2027-02-28")).toEqual(["birthday"]);
    expect(kinds({ birthday: "02-29", lastVisitOn: null, lastSeenOn: null }, "2028-02-28")).toEqual([]);
    expect(kinds({ birthday: "02-29", lastVisitOn: null, lastSeenOn: null }, "2028-02-29")).toEqual(["birthday"]);
  });

  it("milestone: on the visit itself, today or yesterday; we miss you: once the gym's days have passed", () => {
    expect(kinds({ visits: 50, recentVisitDays: 1, lastVisitOn: "2026-10-08" })).toEqual(["milestone"]);
    expect(kinds({ visits: 50, recentVisitDays: 0, lastVisitOn: "2026-10-07" })).toEqual([]);
    expect(kinds({ visits: 51, recentVisitDays: 1, lastVisitOn: TODAY })).toEqual([]);
    expect(kinds({ visits: 100, recentVisitDays: 1, lastVisitOn: TODAY })).toEqual(["milestone"]);
    expect(kinds({ lastSeenOn: "2026-09-30" })).toEqual([]);
    expect(kinds({ lastSeenOn: "2026-09-29" })).toEqual(["miss_you"]);
    // Somebody who never came is not missed: there is no absence to count from.
    expect(kinds({ visits: 0, lastVisitOn: null, lastSeenOn: null })).toEqual([]);
    // One absence is one occasion, named by the day they were last seen.
    expect(gymMessageOccasions(facts({ lastSeenOn: "2026-09-10" }))).toEqual([{ kind: "miss_you", occasion: "absent:2026-09-10" }]);
  });

  it("a day that is not a day gives no occasion, never a wrong one", () => {
    expect(
      kinds({
        joinedOn: "2026-13-45",
        ending: { id: "m", startsOn: "2026-01-01", endsOn: "soon" },
        lastVisitOn: "2026-02-30",
        lastSeenOn: "2026-02-30",
        trial: { id: "t", startsOn: "x", endsOn: "y", next: false },
        bills: [{ id: "b", dueOn: "", paid: false }],
      }),
    ).toEqual([]);
    expect(kinds({ ending: { id: "m", startsOn: "2026-02-30", endsOn: "2026-10-12" } })).toEqual([]);
    expect(kinds(DUE.welcome.person, "not-a-day")).toEqual([]);
  });
});

describe("the words and the shapes", () => {
  it("welcome greets by first name, and by none where the account's name is not one", () => {
    expect(welcomeMessage("Iron House", "Maya Rao")).toBe("Welcome to Iron House, Maya. We're glad you joined. Messages from us will show up here.");
    expect(welcomeMessage(" Iron House ", "maya@example.com")).toBe("Welcome to Iron House. We're glad you joined. Messages from us will show up here.");
    expect([greetingName(null), greetingName("  "), greetingName("12345"), greetingName("x".repeat(41)), greetingName("Zoë  Quinn")]).toEqual([null, null, null, null, "Zoë"]);
  });

  it("the four membership messages: fixed words, the last day in words, and nothing where the day is missing", () => {
    const say = (send: Parameters<typeof automaticMessage>[0], name: string | null = "Maya Rao", line: string | null = null) => automaticMessage(send, " Iron House ", name, line);
    expect(say({ kind: "trial_check_in", occasion: "trial:t1" })).toBe("Hi Maya, how's your trial at Iron House going? If you need anything, just let us know.");
    expect(say({ kind: "trial_check_in", occasion: "trial:t1" }, "maya@example.com")).toBe("How's your trial at Iron House going? If you need anything, just let us know.");
    expect(say({ kind: "trial_ending", occasion: "trial:t1", endsOn: "2026-10-11" })).toBe("Hi Maya, your trial at Iron House ends on 11 October. Want to keep coming? Talk to us about a membership.");
    expect(say({ kind: "membership_ending", occasion: "ends:m1", endsOn: "2026-11-05" }, null)).toBe("Your membership at Iron House ends on 5 November. We'd love to keep you with us. Just let us know if you'd like to renew.");
    expect(say({ kind: "payment_overdue", occasion: "bill:b1" }, "Maya Rao", "Call 555 0100.")).toBe("Hi Maya, your payment to Iron House is overdue. Please get in touch so we can sort it out.\nCall 555 0100.");
    // No amount is ever in the words.
    expect(say({ kind: "payment_overdue", occasion: "bill:b1" })).not.toMatch(/[0-9$£€₹]/);
    // An ending with no day, or a day that is not one, has no words and is not sent.
    expect(say({ kind: "trial_ending", occasion: "trial:t1" })).toBeNull();
    expect(say({ kind: "membership_ending", occasion: "ends:m1", endsOn: "2026-02-30" })).toBeNull();
    expect([dayInWords("2026-01-01"), dayInWords("2028-02-29"), dayInWords("2026-12-31"), dayInWords("2026-13-01"), dayInWords(null)]).toEqual(["1 January", "29 February", "31 December", null, null]);
  });

  it("the inbox reply and the read mark hold their shapes", () => {
    const message = { id: "11111111-1111-4111-8111-111111111111", kind: "welcome", body: "Welcome to Iron House.", sentAt: "2026-10-09T06:30:00.000Z", read: false };
    const reply = { gymId: message.id, gymName: "Iron House", status: "shown", messages: [message], unread: 1, asOf: "2026-10-09T06:31:00.000Z" };
    expect(gymInboxResponseSchema.safeParse(reply).success).toBe(true);
    expect(gymInboxResponseSchema.safeParse({ ...reply, messages: [{ ...message, kind: "advert" }] }).success).toBe(false);
    expect(gymInboxResponseSchema.safeParse({ ...reply, messages: [{ ...message, body: "" }] }).success).toBe(false);
    expect(markGymInboxReadRequestSchema.safeParse({ upTo: reply.asOf }).success).toBe(true);
    expect(markGymInboxReadRequestSchema.safeParse({ upTo: reply.asOf, userId: message.id }).success).toBe(false);
    expect(markGymInboxReadRequestSchema.safeParse({ upTo: "yesterday" }).success).toBe(false);
  });
});
