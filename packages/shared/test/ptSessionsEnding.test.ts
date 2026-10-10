// The sessions a removal or a membership's cancel would end, on the wire (17e-iv-a).
import { describe, expect, it } from "vitest";
import {
  PT_SESSIONS_ENDING_SHOWN,
  cancelHeldMembershipRequestSchema,
  classBookingsEndingSchema,
  confirmPtSessionsQuerySchema,
  memberRemovePreviewSchema,
  ptSessionsEndingSchema,
  ptSessionsEndingWords,
  removeMemberQuerySchema,
} from "../src/index.js";

const MARK = "c".repeat(64);
const session = (n: number) => ({
  id: `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`,
  personName: "Ada Lovelace",
  trainerName: n % 2 === 0 ? "Sam Trainer" : null,
  localDate: "2026-10-09",
  localStartMinute: 600,
  minutes: 60,
  packSession: n % 2 === 0,
});
const ending = { count: 2, packSessions: 1, mark: MARK, sessions: [session(1), session(2)] };

describe("the sessions that would end", () => {
  it("is never an empty box, never more than it may name, and carries nothing it does not list", () => {
    expect(ptSessionsEndingSchema.safeParse(ending).success).toBe(true);
    expect(ptSessionsEndingSchema.safeParse({ ...ending, count: 0, sessions: [] }).success).toBe(false);
    expect(ptSessionsEndingSchema.safeParse({ ...ending, mark: "not-a-mark" }).success).toBe(false);
    expect(ptSessionsEndingSchema.safeParse({ ...ending, sessions: [{ ...session(1), email: "ada@example.com" }] }).success).toBe(false);
    const many = Array.from({ length: PT_SESSIONS_ENDING_SHOWN + 1 }, (_, i) => session(i));
    expect(ptSessionsEndingSchema.safeParse({ ...ending, count: many.length, sessions: many }).success).toBe(false);
    expect(ptSessionsEndingSchema.safeParse({ ...ending, count: 5000, sessions: many.slice(0, PT_SESSIONS_ENDING_SHOWN) }).success).toBe(true);
  });

  it.each([
    [1, 0, "1 personal training session will be cancelled", null],
    [1, 1, "1 personal training session will be cancelled", "1 session goes back to its pack."],
    [7, 1, "7 personal training sessions will be cancelled", "1 session goes back to its pack."],
    [7, 3, "7 personal training sessions will be cancelled", "3 sessions go back to their packs."],
  ])("%i sessions, %i from packs", (count, packSessions, title, packs) => {
    expect(ptSessionsEndingWords({ count, packSessions })).toEqual({ title, packs });
  });
});

describe("where it rides", () => {
  const preview = { selected: 1, move: [], endApp: [], kept: [], movingNotInApp: 0, large: null, digest: "a".repeat(64) };
  it("the Remove box and a membership's cancel carry it only where there are sessions", () => {
    expect(memberRemovePreviewSchema.parse(preview).ptSessions).toBeUndefined();
    expect(memberRemovePreviewSchema.parse({ ...preview, ptSessions: ending }).ptSessions?.count).toBe(2);
    const classes = { classes: 0, booked: 0, waiting: 0, mark: MARK, people: [] };
    expect(classBookingsEndingSchema.parse(classes).ptSessions).toBeUndefined();
    expect(classBookingsEndingSchema.parse({ ...classes, ptSessions: ending }).ptSessions?.mark).toBe(MARK);
  });

  it("the confirmation is a mark and nothing else", () => {
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "today", confirmPtSessions: MARK }).success).toBe(true);
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "today", confirmPtSessions: "2" }).success).toBe(false);
    expect(confirmPtSessionsQuerySchema.parse({})).toEqual({});
    expect(confirmPtSessionsQuerySchema.safeParse({ confirmPtSessions: MARK, entryId: "x" }).success).toBe(false);
    expect(removeMemberQuerySchema.parse({})).toEqual({ alsoStaff: false, confirmPtSessions: null });
    expect(removeMemberQuerySchema.parse({ alsoStaff: "true", confirmPtSessions: MARK })).toEqual({ alsoStaff: true, confirmPtSessions: MARK });
    expect(removeMemberQuerySchema.safeParse({ confirmPtSessions: "' OR 1=1" }).success).toBe(false);
  });
});
