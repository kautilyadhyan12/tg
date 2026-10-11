// THE CLASS REMINDER'S RULE (spec Part 3 §16.2; ROADMAP 20b-iii). The worst thing it could
// do: remind somebody of a class they cancelled, were only waiting for, or that the gym
// cancelled, or remind them twice.
import { describe, expect, it } from "vitest";
import {
  CLASS_REMINDER_HELD_REASONS,
  GYM_MESSAGE_REMINDER_HOURS_CHOICES,
  classReminderDue,
  classReminderFrom,
  classReminderLookAheadHours,
  classReminderNotices,
  classReminderOccasion,
  reminderClock,
  reminderWhen,
  type ClassReminderFacts,
  type ClassReminderHeldReason,
} from "../src/gymClassReminders.js";
import { automaticMessage, gymMessageDue, GYM_MESSAGE_STARTING_NUMBERS, GYM_MESSAGE_STARTING_ON } from "../src/gymMessages.js";

const ID = "7b0f1c1e-58a1-4f0e-9a37-2f1f6a3b9c11";
/** Yoga at 18:00 on Wednesday 14 October, booked two days before; it is 16:15 that day and
 *  the gym reminds 2 hours before. */
const facts = (over: { gym?: Partial<ClassReminderFacts["gym"]>; person?: Partial<ClassReminderFacts["person"]>; booking?: Partial<ClassReminderFacts["booking"]>; sent?: string[] } = {}): ClassReminderFacts => ({
  gym: { open: true, live: true, on: true, hours: 2, today: "2026-10-14", minute: 16 * 60 + 15, ...over.gym },
  person: { member: true, former: false, off: false, ...over.person },
  booking: { what: "class", id: ID, status: "booked", classStatus: "scheduled", day: "2026-10-14", startMinute: 18 * 60, bookedDay: "2026-10-12", bookedMinute: 600, ...over.booking },
  sent: over.sent ?? [],
});
const OCCASION = `class:${ID}:2026-10-14:1080`;
const reasonOf = (f: ClassReminderFacts): ClassReminderHeldReason | "sent" => {
  const due = classReminderDue(f);
  return due.send ? "sent" : due.reason;
};

describe("the class reminder's rule", () => {
  it("only a booking that still holds a place in a class that is still on is reminded of, once", () => {
    expect(classReminderDue(facts())).toEqual({ send: true, occasion: OCCASION });
    // Every status the bookings table and the sessions table can hold (their CHECKs, read
    // from the schema), and words neither has.
    const statuses: [string, ClassReminderHeldReason | "sent"][] = [
      ["booked", "sent"],
      ["waitlisted", "not_booked"],
      ["cancelled", "not_booked"],
      ["late_cancelled", "not_booked"],
      ["attended", "not_booked"],
      ["no_show", "not_booked"],
      ["Booked", "not_booked"],
      ["", "not_booked"],
      ["pending", "not_booked"],
    ];
    for (const [status, want] of statuses) expect(reasonOf(facts({ booking: { status } })), `booking ${status}`).toBe(want);
    const classes: [string, ClassReminderHeldReason | "sent"][] = [
      ["scheduled", "sent"],
      ["cancelled", "class_cancelled"],
      ["postponed", "class_cancelled"],
      ["", "class_cancelled"],
    ];
    for (const [classStatus, want] of classes) expect(reasonOf(facts({ booking: { classStatus } })), `class ${classStatus}`).toBe(want);
    // Run again with what it sent, it sends nothing.
    expect(classReminderDue(facts({ sent: [OCCASION] }))).toEqual({ send: false, reason: "already_sent" });
    // A personal training session is its own occasion, by the same rule.
    expect(classReminderDue(facts({ booking: { what: "session" } }))).toEqual({ send: true, occasion: `session:${ID}:2026-10-14:1080` });
    expect(reasonOf(facts({ booking: { what: "session", status: "cancelled" } }))).toBe("not_booked");
  });

  const HELD: Record<ClassReminderHeldReason, Parameters<typeof facts>[0]> = {
    gym_lapsed: { gym: { live: false } },
    removed: { person: { member: false } },
    former: { person: { former: true } },
    gym_off: { gym: { on: false } },
    person_off: { person: { off: true } },
    not_booked: { booking: { status: "waitlisted" } },
    class_cancelled: { booking: { classStatus: "cancelled" } },
    unreadable: { booking: { bookedDay: null } },
    started: { gym: { minute: 18 * 60 } },
    too_early: { gym: { minute: 15 * 60 + 59 } },
    booked_late: { booking: { bookedDay: "2026-10-14", bookedMinute: 16 * 60 + 1 } },
    already_sent: { sent: [OCCASION] },
    // An 05:00 class the next morning, at 22:00: its time has come, and the gym is asleep.
    night: { gym: { minute: 22 * 60 }, booking: { day: "2026-10-15", startMinute: 5 * 60 } },
  };
  it.each(CLASS_REMINDER_HELD_REASONS)("is not sent: %s", (reason) => {
    expect(classReminderDue(facts(HELD[reason]))).toEqual({ send: false, reason });
  });

  it("a closed gym sends nothing, as a gym on no plan does", () => {
    expect(reasonOf(facts({ gym: { open: false } }))).toBe("gym_lapsed");
  });

  it("a fact that cannot be read sends nothing", () => {
    const bad: Parameters<typeof facts>[0][] = [
      { gym: { today: "2026-13-40" } },
      { gym: { minute: 1440 } },
      { gym: { minute: 16.5 } },
      { gym: { hours: 0 } },
      { gym: { hours: 2.5 } },
      { gym: { hours: 500 } },
      { booking: { day: "soon" } },
      { booking: { startMinute: -1 } },
      { booking: { bookedMinute: null } },
      { booking: { bookedDay: "2026-02-30" } },
    ];
    for (const over of bad) expect(reasonOf(facts(over)), JSON.stringify(over)).toBe("unreadable");
  });

  it("goes from the gym's number of hours before the start, up to the start", () => {
    // [the gym's hours, now, sent?]
    const table: [number, string, number, boolean][] = [
      [2, "2026-10-14", 15 * 60 + 59, false],
      [2, "2026-10-14", 16 * 60, true],
      [2, "2026-10-14", 17 * 60 + 59, true],
      [2, "2026-10-14", 18 * 60, false],
      [2, "2026-10-14", 18 * 60 + 1, false],
      [1, "2026-10-14", 16 * 60 + 59, false],
      [1, "2026-10-14", 17 * 60, true],
      [3, "2026-10-14", 15 * 60, true],
      // 12 hours before 18:00 is 06:00, the night: it waits for 08:00 that morning.
      [12, "2026-10-14", 7 * 60 + 59, false],
      [12, "2026-10-14", 8 * 60, true],
      [24, "2026-10-13", 17 * 60 + 59, false],
      [24, "2026-10-13", 18 * 60, true],
      [24, "2026-10-14", 9 * 60, true],
      [24, "2026-10-15", 9 * 60, false],
    ];
    for (const [hours, today, minute, sent] of table) expect(classReminderDue(facts({ gym: { hours, today, minute } })).send, `${String(hours)}h at ${today} ${String(minute)}`).toBe(sent);
  });

  it("a reminder whose time falls in the night is moved to a time somebody is awake at: 08:00 that morning, or 18:00 the evening before an early class", () => {
    // An 06:00 class on the 15th with 2 hours' notice: 04:00 is the night, and 08:00 is too late.
    const early = { day: "2026-10-15", startMinute: 6 * 60 };
    expect(classReminderFrom("2026-10-15", 6 * 60, 2)).toBe(classReminderFrom("2026-10-14", 20 * 60, 2));
    expect(reasonOf(facts({ booking: early, gym: { minute: 17 * 60 + 59 } }))).toBe("too_early");
    expect(reasonOf(facts({ booking: early, gym: { minute: 18 * 60 } }))).toBe("sent");
    expect(reasonOf(facts({ booking: early, gym: { minute: 20 * 60 + 59 } }))).toBe("sent");
    expect(reasonOf(facts({ booking: early, gym: { minute: 21 * 60 } }))).toBe("night");
    expect(reasonOf(facts({ booking: early, gym: { today: "2026-10-15", minute: 5 * 60 } }))).toBe("night");
    // An 08:59 class is the last that is told the evening before; a 09:00 class is told at 08:00.
    expect(reasonOf(facts({ booking: { day: "2026-10-15", startMinute: 8 * 60 + 59 }, gym: { minute: 18 * 60 } }))).toBe("sent");
    const nine = { day: "2026-10-15", startMinute: 9 * 60 };
    expect(reasonOf(facts({ booking: nine, gym: { minute: 18 * 60 } }))).toBe("too_early");
    expect(reasonOf(facts({ booking: nine, gym: { today: "2026-10-15", minute: 7 * 60 + 59 } }))).toBe("too_early");
    expect(reasonOf(facts({ booking: nine, gym: { today: "2026-10-15", minute: 8 * 60 } }))).toBe("sent");
    expect(reasonOf(facts({ booking: nine, gym: { today: "2026-10-15", minute: 9 * 60 } }))).toBe("started");
    // A 23:30 class with 2 hours' notice: 21:30 is the night, so from 18:00 that same evening.
    const late = { day: "2026-10-14", startMinute: 23 * 60 + 30 };
    expect(reasonOf(facts({ booking: late, gym: { minute: 17 * 60 + 45 } }))).toBe("too_early");
    expect(reasonOf(facts({ booking: late, gym: { minute: 18 * 60 } }))).toBe("sent");
    // A 10:00 class is told at 08:00, the first minute of the day.
    expect(classReminderFrom("2026-10-15", 10 * 60, 2)).toBe(classReminderFrom("2026-10-15", 9 * 60, 1));
    // 24 hours before Friday's 07:30 class is Thursday 07:30: told on Thursday at 08:00, not on Wednesday evening.
    const friday = { day: "2026-10-16", startMinute: 7 * 60 + 30 };
    expect(reasonOf(facts({ booking: friday, gym: { hours: 24, today: "2026-10-14", minute: 18 * 60 + 4 } }))).toBe("too_early");
    expect(reasonOf(facts({ booking: friday, gym: { hours: 24, today: "2026-10-15", minute: 7 * 60 + 59 } }))).toBe("too_early");
    expect(reasonOf(facts({ booking: friday, gym: { hours: 24, today: "2026-10-15", minute: 8 * 60 } }))).toBe("sent");
    // 12 hours before a 19:00 class is 07:00: told at 08:00 that day, eleven hours before.
    const evening = { day: "2026-10-15", startMinute: 19 * 60 };
    expect(reasonOf(facts({ booking: evening, gym: { hours: 12, minute: 18 * 60 } }))).toBe("too_early");
    expect(reasonOf(facts({ booking: evening, gym: { hours: 12, today: "2026-10-15", minute: 8 * 60 } }))).toBe("sent");
    // Every quarter hour of the day and every notice there is: a reminder's first minute is by
    // day and before the start; it is later than its notice only where it waited for 08:00,
    // and then the class is still an hour off; and it is inside what the sender reads.
    for (const hours of new Set([...GYM_MESSAGE_REMINDER_HOURS_CHOICES].flatMap((h) => classReminderNotices(h)))) {
      for (let startMinute = 0; startMinute < 1440; startMinute += 15) {
        const from = classReminderFrom("2026-10-15", startMinute, hours);
        const noon = classReminderFrom("2026-10-15", 13 * 60, 1);
        if (from === null || noon === null) throw new Error("not read");
        const startAt = noon - 12 * 60 + startMinute;
        const minuteOfDay = ((from % 1440) + 1440) % 1440;
        const name = `${String(hours)}h ${String(startMinute)}`;
        expect(minuteOfDay >= 8 * 60 && minuteOfDay < 21 * 60, `${name} by day`).toBe(true);
        expect(from < startAt, `${name} before the start`).toBe(true);
        if (from > startAt - hours * 60) expect(minuteOfDay === 8 * 60 && startAt - from >= 60, `${name} later than its notice only at 08:00, an hour ahead`).toBe(true);
        // The sender reads one hour more than this, for the night the clocks go back.
        expect(startAt - from <= (classReminderLookAheadHours(hours) - 1) * 60, `${name} inside what the sender reads`).toBe(true);
      }
    }
    expect(GYM_MESSAGE_REMINDER_HOURS_CHOICES.map((h) => classReminderLookAheadHours(h))).toEqual([16, 16, 16, 19, 31]);
  });

  it("somebody who books the evening before a morning class is reminded: at 08:00 where there is time, that same evening before an early class", () => {
    // Booked at 19:00 for tomorrow's 09:30 class, with 2 hours' notice.
    const morning = { day: "2026-10-15", startMinute: 9 * 60 + 30, bookedDay: "2026-10-14", bookedMinute: 19 * 60 };
    expect(reasonOf(facts({ booking: morning, gym: { minute: 19 * 60 + 4 } }))).toBe("too_early");
    expect(reasonOf(facts({ booking: morning, gym: { today: "2026-10-15", minute: 7 * 60 + 34 } }))).toBe("too_early");
    expect(reasonOf(facts({ booking: morning, gym: { today: "2026-10-15", minute: 8 * 60 + 4 } }))).toBe("sent");
    // Booked at 19:00 for tomorrow's 06:00 class: nothing can go later, so it goes that evening.
    const early = { day: "2026-10-15", startMinute: 6 * 60, bookedDay: "2026-10-14", bookedMinute: 19 * 60 };
    expect(reasonOf(facts({ booking: early, gym: { minute: 19 * 60 + 4 } }))).toBe("sent");
    expect(reasonOf(facts({ booking: { ...early, bookedMinute: 17 * 60 }, gym: { minute: 19 * 60 + 4 } }))).toBe("sent");
    // Booked at 04:30 for the 06:00 class, inside its 2 hours: none.
    expect(reasonOf(facts({ booking: { ...early, bookedDay: "2026-10-15", bookedMinute: 4 * 60 + 30 }, gym: { today: "2026-10-15", minute: 5 * 60 } }))).toBe("booked_late");
    // 12 hours before an 18:00 class is 06:00, told at 08:00: booked at 07:00 that day, she is still told at 08:00.
    expect(reasonOf(facts({ booking: { bookedDay: "2026-10-14", bookedMinute: 7 * 60 }, gym: { hours: 12, minute: 8 * 60 } }))).toBe("sent");
  });

  it("somebody who gets a place inside the gym's own notice is reminded 2 hours before instead, and nobody who gets one inside the last notice", () => {
    expect(GYM_MESSAGE_REMINDER_HOURS_CHOICES.map((h) => classReminderNotices(h))).toEqual([[1], [2], [2 + 1, 2], [12, 2], [24, 2]]);
    const booked = (hours: number, bookedDay: string, bookedMinute: number, minute: number, today = "2026-10-14") => reasonOf(facts({ gym: { hours, today, minute }, booking: { bookedDay, bookedMinute } }));
    // 2 hours, the 18:00 class: its only notice.
    expect(booked(2, "2026-10-14", 16 * 60, 16 * 60 + 15)).toBe("sent");
    expect(booked(2, "2026-10-14", 16 * 60 + 1, 16 * 60 + 15)).toBe("booked_late");
    expect(booked(2, "2026-10-14", 17 * 60 + 30, 17 * 60 + 34)).toBe("booked_late");
    // 1 hour: 59 minutes before is too late, an hour before is not.
    expect(booked(1, "2026-10-14", 17 * 60 + 1, 17 * 60 + 4)).toBe("booked_late");
    expect(booked(1, "2026-10-14", 17 * 60, 17 * 60 + 4)).toBe("sent");
    // 24 hours, booked 20 hours before: reminded at 16:00, 2 hours before, and not straight away.
    expect(booked(24, "2026-10-13", 22 * 60, 9 * 60)).toBe("too_early");
    expect(booked(24, "2026-10-13", 22 * 60, 15 * 60 + 59)).toBe("too_early");
    expect(booked(24, "2026-10-13", 22 * 60, 16 * 60)).toBe("sent");
    expect(booked(24, "2026-10-14", 16 * 60 + 30, 16 * 60 + 34)).toBe("booked_late");
    // 3 hours, booked two and a half before: 2 hours before.
    expect(booked(3, "2026-10-14", 15 * 60 + 30, 15 * 60 + 34)).toBe("too_early");
    expect(booked(3, "2026-10-14", 15 * 60 + 30, 16 * 60 + 4)).toBe("sent");
    // 24 hours, Friday's 07:30 class, booked on Thursday at 19:00: that evening, as a 2-hour gym would.
    const friday = { day: "2026-10-16", startMinute: 7 * 60 + 30, bookedDay: "2026-10-15", bookedMinute: 19 * 60 };
    expect(reasonOf(facts({ booking: friday, gym: { hours: 24, today: "2026-10-15", minute: 19 * 60 + 4 } }))).toBe("sent");
    // A gym that raises its hours after somebody booked: they are still reminded, 2 hours before.
    expect(booked(2, "2026-10-13", 22 * 60, 16 * 60)).toBe("sent");
    expect(booked(24, "2026-10-13", 22 * 60, 16 * 60)).toBe("sent");
    // Reminded by one notice, the other sends nothing more.
    expect(reasonOf(facts({ gym: { hours: 24, minute: 16 * 60 }, booking: { bookedDay: "2026-10-13", bookedMinute: 22 * 60 }, sent: [OCCASION] }))).toBe("already_sent");
  });

  it("a class the gym moves has a new occasion, so its new time is said too", () => {
    const moved = { startMinute: 19 * 60 };
    expect(classReminderOccasion(facts({ booking: moved }).booking)).toBe(`class:${ID}:2026-10-14:1140`);
    expect(reasonOf(facts({ booking: moved, gym: { minute: 17 * 60 + 4 }, sent: [OCCASION] }))).toBe("sent");
    expect(OCCASION.length).toBeLessThanOrEqual(80);
    expect(classReminderOccasion({ what: "session", id: ID, day: "2026-10-14", startMinute: 1439 }).length).toBeLessThanOrEqual(80);
  });

  it("a reminder is not the day's one automatic message: a birthday still goes that day", () => {
    const person = { member: true, former: false, staff: false, off: [], joinedOn: "2026-01-05", joinedUtcOn: "2026-01-05", trial: null, ending: null, bills: [], birthday: "10-14", visits: 3, recentVisitDays: 0, lastVisitOn: "2026-10-12", lastSeenOn: "2026-10-12" };
    const gym = { open: true, live: true, today: "2026-10-14", hour: 12, on: GYM_MESSAGE_STARTING_ON, numbers: GYM_MESSAGE_STARTING_NUMBERS, visitDays: [], billsOverdueAfterDays: 0, takesPayments: false };
    const reminded = gymMessageDue({ gym, person, sent: [{ kind: "class_reminder", occasion: OCCASION, day: "2026-10-14" }] });
    expect(reminded.send).toEqual({ kind: "birthday", occasion: "birthday:2026" });
    const welcomed = gymMessageDue({ gym, person, sent: [{ kind: "welcome", occasion: "joined:2026-01-05", day: "2026-10-14" }] });
    expect(welcomed.send).toBeNull();
  });
});

describe("the reminder's words", () => {
  it("says the time on the gym's own clock", () => {
    const table: [number, string, string][] = [
      [0, "12:00 AM", "00:00"],
      [5, "12:05 AM", "00:05"],
      [6 * 60, "6:00 AM", "06:00"],
      [11 * 60 + 59, "11:59 AM", "11:59"],
      [12 * 60, "12:00 PM", "12:00"],
      [13 * 60 + 30, "1:30 PM", "13:30"],
      [18 * 60, "6:00 PM", "18:00"],
      [23 * 60 + 59, "11:59 PM", "23:59"],
    ];
    for (const [minute, twelve, twentyFour] of table) {
      expect(reminderClock(minute, "12h")).toBe(twelve);
      expect(reminderClock(minute, "24h")).toBe(twentyFour);
    }
    for (const minute of [-1, 1440, 7.5, Number.NaN]) expect(reminderClock(minute, "12h")).toBeNull();
  });

  it("says today, tomorrow, or the day by its name", () => {
    expect(reminderWhen("2026-10-14", "2026-10-14", 1080, "12h")).toBe("today at 6:00 PM");
    expect(reminderWhen("2026-10-14", "2026-10-15", 360, "24h")).toBe("tomorrow at 06:00");
    // 16 October 2026 is a Friday; 1 November a Sunday; 1 March 2028 a Wednesday, after a 29 February.
    expect(reminderWhen("2026-10-14", "2026-10-16", 420, "12h")).toBe("on Friday 16 October at 7:00 AM");
    expect(reminderWhen("2026-10-31", "2026-11-01", 420, "12h")).toBe("tomorrow at 7:00 AM");
    expect(reminderWhen("2026-10-30", "2026-11-01", 420, "12h")).toBe("on Sunday 1 November at 7:00 AM");
    expect(reminderWhen("2028-02-28", "2028-03-01", 420, "24h")).toBe("on Wednesday 1 March at 07:00");
    expect(reminderWhen("2026-10-14", "2026-10-13", 420, "12h")).toBeNull();
    expect(reminderWhen("2026-10-14", "tomorrow", 420, "12h")).toBeNull();
  });

  it("names the class, or the trainer, and the gym; with the gym's own line under it", () => {
    const say = (reminder: { what: "class" | "session"; title: string | null; when: string; online: boolean }, name: string | null, line: string | null = null) =>
      automaticMessage({ kind: "class_reminder", occasion: OCCASION, reminder }, " Northside ", name, line);
    const yoga = { what: "class" as const, title: "Yoga", when: "today at 6:00 PM", online: false };
    expect(say(yoga, "Maya Rao")).toBe("Hi Maya, you're booked for Yoga today at 6:00 PM at Northside. See you there.");
    expect(say(yoga, null)).toBe("You're booked for Yoga today at 6:00 PM at Northside. See you there.");
    expect(say(yoga, "maya@gmail.com")).toBe("You're booked for Yoga today at 6:00 PM at Northside. See you there.");
    expect(say(yoga, "Maya", "Bring a mat.")).toBe("Hi Maya, you're booked for Yoga today at 6:00 PM at Northside. See you there.\nBring a mat.");
    expect(say({ ...yoga, online: true }, "Maya")).toBe("Hi Maya, you're booked for Yoga today at 6:00 PM with Northside. It's an online class.");
    const session = { what: "session" as const, title: "Sam Okoro", when: "tomorrow at 07:00", online: false };
    expect(say(session, "Maya")).toBe("Hi Maya, you have a personal training session with Sam tomorrow at 07:00 at Northside. See you there.");
    expect(say({ ...session, title: null }, "Maya")).toBe("Hi Maya, you have a personal training session tomorrow at 07:00 at Northside. See you there.");
    expect(say({ ...session, title: "sam@gmail.com" }, null)).toBe("You have a personal training session tomorrow at 07:00 at Northside. See you there.");
    // Nothing is sent where the words cannot be made.
    expect(say({ ...yoga, title: " " }, "Maya")).toBeNull();
    expect(say({ ...yoga, when: "" }, "Maya")).toBeNull();
    expect(automaticMessage({ kind: "class_reminder", occasion: OCCASION }, "Northside", "Maya", null)).toBeNull();
  });
});
