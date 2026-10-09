// THE MESSAGE RULE (spec Part 3 §16.2; ROADMAP 20a): every kind of message against every
// reason NOT to send it. The worst thing it could do: a message to somebody the gym
// removed, or the same message twice.
import { describe, expect, it } from "vitest";
import {
  GYM_MESSAGE_HELD_REASONS,
  GYM_MESSAGE_KINDS,
  GYM_MESSAGE_STARTING_NUMBERS,
  GYM_MESSAGE_STARTING_ON,
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
  membershipEndsOn: null,
  bills: [],
  birthday: null,
  visits: 12,
  lastVisitOn: "2026-10-07",
};
const facts = (person: Partial<Person> = {}, over: { gym?: Partial<GymMessageFacts["gym"]>; sent?: GymMessageFacts["sent"] } = {}): GymMessageFacts => ({
  gym: { open: true, live: true, today: TODAY, hour: 12, on: GYM_MESSAGE_STARTING_ON, numbers: GYM_MESSAGE_STARTING_NUMBERS, ...over.gym },
  person: { ...nobody, ...person },
  sent: over.sent ?? [],
});

/** One person for each kind, for whom that kind and no other has its occasion today. */
const DUE: Record<GymMessageKind, { person: Partial<Person>; occasion: string }> = {
  payment_overdue: { person: { bills: [{ id: "b1", dueOn: "2026-10-06", paid: false }] }, occasion: "bill:b1" },
  membership_ending: { person: { membershipEndsOn: "2026-10-16" }, occasion: "ends:2026-10-16" },
  trial_ending: { person: { trial: { startsOn: "2026-09-28", endsOn: "2026-10-11" } }, occasion: "trial:2026-09-28" },
  trial_check_in: { person: { trial: { startsOn: "2026-10-08", endsOn: "2026-10-21" } }, occasion: "trial:2026-10-08" },
  // Joined late on the 8th in UTC, which is the 9th on this gym's calendar.
  welcome: { person: { joinedOn: "2026-10-09", joinedUtcOn: "2026-10-08" }, occasion: "joined:2026-10-08" },
  birthday: { person: { birthday: "10-09" }, occasion: "birthday:2026" },
  milestone: { person: { visits: 50, lastVisitOn: TODAY }, occasion: "visits:50" },
  miss_you: { person: { lastVisitOn: "2026-09-29" }, occasion: "absent:2026-09-29" },
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
      expect(due, kind).toEqual({ send: { kind, occasion: DUE[kind].occasion }, held: [] });
    }
  });

  describe.each(GYM_MESSAGE_KINDS)("%s", (kind) => {
    it.each(GYM_MESSAGE_HELD_REASONS)("is not sent: %s", (reason) => {
      const change = HELD[reason](kind, DUE[kind].occasion);
      const due = gymMessageDue(facts({ ...DUE[kind].person, ...change.person }, { ...(change.gym === undefined ? {} : { gym: change.gym }), ...(change.sent === undefined ? {} : { sent: change.sent }) }));
      // A payment notice is the one kind a person cannot switch off.
      if (kind === "payment_overdue" && reason === "person_off") {
        expect(due.send).toEqual({ kind, occasion: DUE[kind].occasion });
        return;
      }
      expect(due.send).toBeNull();
      expect(due.held).toEqual([{ kind, occasion: DUE[kind].occasion, reason }]);
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

  it("payment overdue: never for a paid bill, and not before the gym's days are up", () => {
    expect(kinds({ bills: [{ id: "b1", dueOn: "2026-09-01", paid: true }] })).toEqual([]);
    expect(kinds({ bills: [{ id: "b1", dueOn: "2026-10-07", paid: false }] })).toEqual([]);
    expect(kinds({ bills: [{ id: "b1", dueOn: "2026-10-06", paid: false }] })).toEqual(["payment_overdue"]);
    // Each bill is its own occasion.
    expect(gymMessageOccasions(facts({ bills: [{ id: "b1", dueOn: "2026-10-01", paid: false }, { id: "b2", dueOn: "2026-10-02", paid: false }] })).map((o) => o.occasion)).toEqual(["bill:b1", "bill:b2"]);
  });

  it("membership ending: within the gym's days of the last day, and not after it", () => {
    expect(kinds({ membershipEndsOn: "2026-10-17" })).toEqual([]);
    expect(kinds({ membershipEndsOn: "2026-10-16" })).toEqual(["membership_ending"]);
    expect(kinds({ membershipEndsOn: TODAY })).toEqual(["membership_ending"]);
    expect(kinds({ membershipEndsOn: "2026-10-08" })).toEqual([]);
  });

  it("a trial: the check-in on day 2 or a day late, the ending in its last days, neither outside it", () => {
    const trial = (startsOn: string, endsOn: string) => kinds({ trial: { startsOn, endsOn } });
    expect(trial(TODAY, "2026-10-22")).toEqual([]);
    expect(trial("2026-10-08", "2026-10-21")).toEqual(["trial_check_in"]);
    expect(trial("2026-10-07", "2026-10-20")).toEqual(["trial_check_in"]);
    expect(trial("2026-10-06", "2026-10-19")).toEqual([]);
    expect(trial("2026-09-28", "2026-10-11")).toEqual(["trial_ending"]);
    expect(trial("2026-09-28", "2026-10-12")).toEqual([]);
    expect(trial("2026-09-20", "2026-10-08")).toEqual([]);
    expect(trial("2026-10-10", "2026-10-23")).toEqual([]);
    // A three-day trial: both are due on day 2, and the ending is first.
    expect(trial("2026-10-08", "2026-10-10")).toEqual(["trial_ending", "trial_check_in"]);
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
    expect(kinds({ birthday: "02-29", lastVisitOn: null }, "2027-02-28")).toEqual(["birthday"]);
    expect(kinds({ birthday: "02-29", lastVisitOn: null }, "2028-02-28")).toEqual([]);
    expect(kinds({ birthday: "02-29", lastVisitOn: null }, "2028-02-29")).toEqual(["birthday"]);
  });

  it("milestone: on the visit itself, today or yesterday; we miss you: once the gym's days have passed", () => {
    expect(kinds({ visits: 50, lastVisitOn: "2026-10-08" })).toEqual(["milestone"]);
    expect(kinds({ visits: 50, lastVisitOn: "2026-10-07" })).toEqual([]);
    expect(kinds({ visits: 51, lastVisitOn: TODAY })).toEqual([]);
    expect(kinds({ visits: 100, lastVisitOn: TODAY })).toEqual(["milestone"]);
    expect(kinds({ lastVisitOn: "2026-09-30" })).toEqual([]);
    expect(kinds({ lastVisitOn: "2026-09-29" })).toEqual(["miss_you"]);
    // Somebody who never came is not missed: there is no absence to count from.
    expect(kinds({ visits: 0, lastVisitOn: null })).toEqual([]);
    // One absence is one occasion, however long it lasts.
    expect(gymMessageOccasions(facts({ lastVisitOn: "2026-06-01" }))).toEqual([{ kind: "miss_you", occasion: "absent:2026-06-01" }]);
  });

  it("a day that is not a day gives no occasion, never a wrong one", () => {
    expect(kinds({ joinedOn: "2026-13-45", membershipEndsOn: "soon", lastVisitOn: "2026-02-30", trial: { startsOn: "x", endsOn: "y" }, bills: [{ id: "b", dueOn: "", paid: false }] })).toEqual([]);
    expect(kinds(DUE.welcome.person, "not-a-day")).toEqual([]);
  });
});

describe("the words and the shapes", () => {
  it("welcome greets by first name, and by none where the account's name is not one", () => {
    expect(welcomeMessage("Iron House", "Maya Rao")).toBe("Welcome to Iron House, Maya. We're glad you joined. Messages from us will show up here.");
    expect(welcomeMessage(" Iron House ", "maya@example.com")).toBe("Welcome to Iron House. We're glad you joined. Messages from us will show up here.");
    expect([greetingName(null), greetingName("  "), greetingName("12345"), greetingName("x".repeat(41)), greetingName("Zoë  Quinn")]).toEqual([null, null, null, null, "Zoë"]);
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
