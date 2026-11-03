// No new bookings until the membership agreement is signed (ROADMAP Stage 2 item 18u-iv; Kd,
// `rulings/2026-10-23-18u-i.md`).
//
// The worst thing this job could do to a real person: turn a member away from their class
// when they have signed, when their membership asks for no agreement, or when only their
// child has one to sign. Whether a record has one to sign is the server's (Members' "Agreement
// not signed" rule, tested in the api); here, that the gym's choice and staff decide the rest,
// and that each kind of booking is refused, or kept, as the spec's words say.
import { describe, expect, it } from "vitest";
import {
  CLASS_BOOKING_WORDS,
  UNSIGNED_BOOKING_WORDS,
  agreementBookingsBodySchema,
  bookingSettingsBodySchema,
  bookingTime,
  decideBook,
  ptMemberWords,
  unsignedStopped,
  type BookInput,
  type BookingUnsigned,
} from "../src/index.js";

describe("the worst thing: nobody with nothing to sign is stopped", () => {
  it("nothing to sign, under Stop new bookings", () => {
    expect(unsignedStopped({ rule: "stop", staff: false, unsigned: false })).toBe(false);
  });
  it("one to sign, while the gym lets everybody book", () => {
    expect(unsignedStopped({ rule: "let_book", staff: false, unsigned: true })).toBe(false);
  });
  it("one to sign, but the record is one of the gym's staff", () => {
    expect(unsignedStopped({ rule: "stop", staff: true, unsigned: true }), "the owner and staff are never stopped").toBe(false);
  });
});

describe("every case of the choice, staff and an agreement to sign", () => {
  const cases: [BookingUnsigned, boolean, boolean, boolean][] = [];
  for (const rule of ["let_book", "stop"] as const) {
    for (const staff of [false, true]) {
      for (const unsigned of [false, true]) cases.push([rule, staff, unsigned, rule === "stop" && !staff && unsigned]);
    }
  }
  it.each(cases)("%s, staff %s, to sign %s: stopped %s", (rule, staff, unsigned, stopped) => {
    expect(unsignedStopped({ rule, staff, unsigned })).toBe(stopped);
  });
});

describe("what is refused and what stays, for somebody stopped until they sign", () => {
  const START = Date.UTC(2026, 10, 10, 17, 0);
  const settings = { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 60, waitlistMax: 20 };
  const base: BookInput = {
    time: bookingTime(START - 48 * 60 * 60_000, START, settings),
    cancelled: false,
    places: 10,
    booked: 4,
    waitlisted: 0,
    waitlistMax: 20,
    mine: null,
    joinWaitlist: false,
    cover: { ok: true, membershipId: null, chargePack: false },
    stop: "agreement_not_signed",
  };
  const full = { ...base, booked: 10, waitlisted: 2 };
  const refused = { kind: "refuse", reason: "agreement_not_signed" } as const;
  const table: [string, BookInput, ReturnType<typeof decideBook>][] = [
    ["Book a free place", base, refused],
    ["Join the waitlist of a full class", { ...full, joinWaitlist: true }, refused],
    ["Claim a freed place from the waitlist", { ...base, mine: "waitlisted", waitlisted: 1 }, refused],
    ["A place they hold already stays", { ...base, mine: "booked" }, { kind: "already", status: "booked" }],
    ["A full class they wait for already: still waiting", { ...full, mine: "waitlisted", joinWaitlist: true }, { kind: "already", status: "waitlisted" }],
    ["A class not open yet says so first", { ...base, time: bookingTime(START - 10 * 24 * 60 * 60_000, START, settings) }, { kind: "refuse", reason: "not_open_yet" }],
    ["Signed: a free place is booked", { ...base, stop: null }, { kind: "book", membershipId: null, chargePack: false, fromWaitlist: false }],
    ["Signed: the waitlist is joined", { ...full, joinWaitlist: true, stop: null }, { kind: "waitlist" }],
  ];
  it.each(table)("%s", (_, input, answer) => {
    expect(decideBook(input)).toEqual(answer);
  });
});

describe("what the member reads", () => {
  it("is a whole sentence that says what to do, for a class and a session alike", () => {
    expect(UNSIGNED_BOOKING_WORDS).toBe("Your membership agreement isn't signed yet. Please sign it at the front desk to book.");
    expect(CLASS_BOOKING_WORDS.agreement_not_signed).toBe(UNSIGNED_BOOKING_WORDS);
    expect(ptMemberWords("yoga_studio").agreement_not_signed).toBe(UNSIGNED_BOOKING_WORDS);
  });
});

describe("the choice as Membership agreements saves it", () => {
  it("is one of the two choices, and nothing else", () => {
    expect(agreementBookingsBodySchema.safeParse({ rule: "stop" }).success).toBe(true);
    expect(agreementBookingsBodySchema.safeParse({ rule: "let_book" }).success).toBe(true);
    expect(agreementBookingsBodySchema.safeParse({}).success).toBe(false);
    expect(agreementBookingsBodySchema.safeParse({ rule: "sign_later" }).success).toBe(false);
    expect(agreementBookingsBodySchema.safeParse({ rule: "stop", overdue: "stop" }).success).toBe(false);
  });
  it("booking settings no longer take it", () => {
    const body = { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 60, waitlistMax: 20, pt: { opensDays: 7, freeCancelMinutes: 120 } };
    expect(bookingSettingsBodySchema.safeParse({ ...body, unsigned: "stop" }).success).toBe(false);
  });
});
