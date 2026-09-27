// When a lead's next follow-up email is due (ROADMAP 20c-ii; RULINGS 2026-09-27). A
// table over every status, the tick, every count, and the calendar's edges.
import { describe, expect, it } from "vitest";
import { LEAD_STATUSES } from "@app/shared";
import { followUpDueOn, type FollowUpFacts } from "../src/modules/orgs/leads/followUp.js";

const base: FollowUpFacts = { status: "new", ticked: true, sent: 0, tickDay: "2026-09-27", lastSentDay: null };

describe("followUpDueOn", () => {
  it("only a New lead with the tick is ever due, whatever has been sent", () => {
    for (const status of LEAD_STATUSES) {
      for (const ticked of [true, false]) {
        for (const sent of [0, 1, 2]) {
          const facts: FollowUpFacts = { ...base, status, ticked, sent, lastSentDay: sent === 0 ? null : "2026-09-27" };
          const due = followUpDueOn(facts);
          if (status === "new" && ticked) expect(due, `${status} ticked ${String(sent)}`).not.toBeNull();
          else expect(due, `${status} ticked=${String(ticked)} sent=${String(sent)}`).toBeNull();
        }
      }
    }
  });

  it.each([
    // [sent, tick day, last sent day, due]
    [0, "2026-09-27", null, "2026-09-27"],
    [1, "2026-09-27", "2026-09-27", "2026-09-30"],
    [2, "2026-09-27", "2026-09-30", "2026-10-04"],
    // Each counts from the one before: a late second moves the third.
    [2, "2026-09-27", "2026-10-02", "2026-10-06"],
    // A first sent late still waits 3 days for the second.
    [1, "2026-09-27", "2026-10-05", "2026-10-08"],
    // Month and year ends, and 29 February.
    [1, "2026-12-01", "2026-12-30", "2027-01-02"],
    [2, "2028-02-20", "2028-02-26", "2028-03-01"],
    [1, "2027-02-20", "2027-02-27", "2027-03-02"],
  ] as const)("sent %i, ticked %s, last sent %s: due %s", (sent, tickDay, lastSentDay, due) => {
    expect(followUpDueOn({ ...base, sent, tickDay, lastSentDay })).toBe(due);
  });

  it("all three sent: none due", () => {
    expect(followUpDueOn({ ...base, sent: 3, lastSentDay: "2026-10-04" })).toBeNull();
  });

  it("garbage in gives no due day, never a wrong one", () => {
    expect(followUpDueOn({ ...base, sent: -1 })).toBeNull();
    expect(followUpDueOn({ ...base, sent: 1.5, lastSentDay: "2026-09-27" })).toBeNull();
    expect(followUpDueOn({ ...base, sent: 4, lastSentDay: "2026-09-27" })).toBeNull();
    expect(followUpDueOn({ ...base, sent: 0, tickDay: null })).toBeNull();
    expect(followUpDueOn({ ...base, sent: 1, lastSentDay: null })).toBeNull();
  });
});
