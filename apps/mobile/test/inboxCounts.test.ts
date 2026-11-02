import { describe, expect, it } from "vitest";
import { NO_COUNTS, allUnread, inboxAnswered, placeUnread, placesAnswered } from "../src/screens/gym/inboxView";

// The count on each place's Inbox and the Gym tab's dot: every order in which a read of the places and an Inbox
// can answer.
const IRON = "iron";
const LOTUS = "lotus";
const member = (id: string, newMessages: number) => ({ id, isMember: true, newMessages });

describe("each place's count of new messages", () => {
  it("before any read there is no count and no dot", () => {
    expect(placeUnread(NO_COUNTS, IRON)).toBeNull();
    expect(allUnread(NO_COUNTS)).toBe(0);
  });

  it("a read gives each place its count, and the dot their sum", () => {
    const now = placesAnswered(NO_COUNTS, 1, [member(IRON, 2), member(LOTUS, 3)]);
    expect(placeUnread(now, IRON)).toBe(2);
    expect(allUnread(now)).toBe(5);
  });

  it("a place where the person is staff, not a member, is not counted", () => {
    const now = placesAnswered(NO_COUNTS, 1, [{ id: IRON, isMember: false, newMessages: 4 }, member(LOTUS, 1)]);
    expect(placeUnread(now, IRON)).toBeNull();
    expect(allUnread(now)).toBe(1);
  });

  it("an Inbox read to 0 puts its place's count and the dot out", () => {
    const read = placesAnswered(NO_COUNTS, 1, [member(IRON, 2)]);
    const now = inboxAnswered(read, IRON, 0, 1);
    expect(placeUnread(now, IRON)).toBe(0);
    expect(allUnread(now)).toBe(0);
  });

  it("the race: a read that started before the Inbox said 0 and answers after it keeps the 0", () => {
    const first = placesAnswered(NO_COUNTS, 1, [member(IRON, 2)]);
    // Read 2 starts; the Inbox marks them read and says 0 while it is away; read 2 answers with its older 2.
    const said = inboxAnswered(first, IRON, 0, 2);
    const now = placesAnswered(said, 2, [member(IRON, 2)]);
    expect(placeUnread(now, IRON)).toBe(0);
    expect(allUnread(now)).toBe(0);
  });

  it("an older read that answers after a newer one changes nothing", () => {
    const newer = placesAnswered(NO_COUNTS, 3, [member(IRON, 0)]);
    const now = placesAnswered(newer, 2, [member(IRON, 2)]);
    expect(placeUnread(now, IRON)).toBe(0);
  });

  it("a read that started after the Inbox spoke is the server's newer word, and replaces it", () => {
    const said = inboxAnswered(placesAnswered(NO_COUNTS, 1, [member(IRON, 2)]), IRON, 0, 1);
    // A new message came; read 2 started after the Inbox spoke.
    const now = placesAnswered(said, 2, [member(IRON, 1)]);
    expect(placeUnread(now, IRON)).toBe(1);
    expect(allUnread(now)).toBe(1);
  });

  it("a place the person left drops out of the dot", () => {
    const first = placesAnswered(NO_COUNTS, 1, [member(IRON, 2), member(LOTUS, 1)]);
    const now = placesAnswered(first, 2, [member(LOTUS, 1)]);
    expect(placeUnread(now, IRON)).toBeNull();
    expect(allUnread(now)).toBe(1);
  });
});
