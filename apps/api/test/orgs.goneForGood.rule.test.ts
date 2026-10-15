// The rule for a gym gone for good (ROADMAP Stage 4 item 14), every class of case: when
// each email goes, the day it names, and when the list may go. No database.
import { describe, expect, it } from "vitest";
import { CLAIM_STALE_MS, nextStep, type Step } from "../src/modules/orgs/goneForGood/sweep.js";
import type { Round } from "../src/modules/orgs/goneForGood/repo.js";
import { goneForGoodEmail } from "../src/modules/orgs/goneForGood/emails.js";

const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string): Date => new Date(iso);
const plus = (d: Date, days: number): Date => new Date(d.getTime() + days * DAY);

const COUNTED = at("2026-01-10T00:00:00Z");
const DUE = at("2026-07-10T00:00:00Z"); // six months on

const round = (r: Partial<Round> = {}): Round => ({
  countedFrom: COUNTED,
  deletesAt: null,
  monthClaimedAt: null,
  monthSentAt: null,
  weekClaimedAt: null,
  weekSentAt: null,
  ...r,
});

const monthSent = (sentAt: Date, deletesAt: Date): Partial<Round> => ({ monthClaimedAt: sentAt, monthSentAt: sentAt, deletesAt });

const cases: { name: string; round: Round; now: Date; step: Step }[] = [
  // The first email.
  { name: "a day before the month window: nothing", round: round(), now: plus(DUE, -31), step: { kind: "wait" } },
  { name: "the month window opens: the month email names the due day", round: round(), now: plus(DUE, -30), step: { kind: "month", deletesAt: DUE } },
  { name: "the worker was off for months: the day named is 30 days on, never the past", round: round(), now: plus(DUE, 90), step: { kind: "month", deletesAt: plus(DUE, 120) } },
  { name: "a month email claimed a minute ago: nothing (another run is sending it)", round: round({ monthClaimedAt: plus(DUE, -30) }), now: new Date(plus(DUE, -30).getTime() + 60_000), step: { kind: "wait" } },
  { name: "a month claim an hour old with nothing sent: taken again", round: round({ monthClaimedAt: plus(DUE, -30) }), now: new Date(plus(DUE, -30).getTime() + CLAIM_STALE_MS), step: { kind: "month", deletesAt: plus(new Date(plus(DUE, -30).getTime() + CLAIM_STALE_MS), 30) } },
  // The second email.
  { name: "month email sent, 8 days before the day: nothing", round: round(monthSent(plus(DUE, -30), DUE)), now: plus(DUE, -8), step: { kind: "wait" } },
  { name: "7 days before the day: the week email names the same day", round: round(monthSent(plus(DUE, -30), DUE)), now: plus(DUE, -7), step: { kind: "week", deletesAt: DUE } },
  { name: "the week email is late: the day moves to 7 days on", round: round(monthSent(plus(DUE, -30), DUE)), now: plus(DUE, 2), step: { kind: "week", deletesAt: plus(DUE, 9) } },
  { name: "the list is never deleted with only the month email sent, however late", round: round(monthSent(plus(DUE, -30), DUE)), now: plus(DUE, 400), step: { kind: "week", deletesAt: plus(DUE, 407) } },
  { name: "a week email claimed a minute ago: nothing", round: round({ ...monthSent(plus(DUE, -30), DUE), weekClaimedAt: plus(DUE, -7) }), now: new Date(plus(DUE, -7).getTime() + 60_000), step: { kind: "wait" } },
  // The deletion.
  {
    name: "both emails sent, a minute before the day: nothing",
    round: round({ ...monthSent(plus(DUE, -30), DUE), weekClaimedAt: plus(DUE, -7), weekSentAt: plus(DUE, -7) }),
    now: new Date(DUE.getTime() - 60_000),
    step: { kind: "wait" },
  },
  {
    name: "both emails sent, the day has come: delete",
    round: round({ ...monthSent(plus(DUE, -30), DUE), weekClaimedAt: plus(DUE, -7), weekSentAt: plus(DUE, -7) }),
    now: DUE,
    step: { kind: "delete" },
  },
  {
    name: "the day has come but the week email went 3 days ago: nothing until a week after it",
    round: round({ ...monthSent(plus(DUE, -30), DUE), weekClaimedAt: plus(DUE, -3), weekSentAt: plus(DUE, -3) }),
    now: DUE,
    step: { kind: "wait" },
  },
  {
    name: "a week after the late week email: delete",
    round: round({ ...monthSent(plus(DUE, -30), DUE), weekClaimedAt: plus(DUE, -3), weekSentAt: plus(DUE, -3) }),
    now: plus(DUE, 4),
    step: { kind: "delete" },
  },
];

describe("a gym gone for good: the rule", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(nextStep(c.round, DUE, c.now)).toEqual(c.step);
    });
  }

  it("never deletes before the day the emails named, at any hour of a year's nights", () => {
    let r = round();
    let firstSent: Date | null = null;
    let weekSent: Date | null = null;
    for (let day = -60; day <= 300; day += 1) {
      const now = plus(DUE, day);
      const step = nextStep(r, DUE, now);
      if (step.kind === "month") {
        r = { ...r, ...monthSent(now, step.deletesAt) };
        firstSent = now;
      } else if (step.kind === "week") {
        r = { ...r, weekClaimedAt: now, weekSentAt: now, deletesAt: step.deletesAt };
        weekSent = now;
      } else if (step.kind === "delete") {
        expect(firstSent).not.toBeNull();
        expect(weekSent).not.toBeNull();
        expect(now.getTime()).toBeGreaterThanOrEqual(r.deletesAt?.getTime() ?? Infinity);
        expect(now.getTime() - (firstSent?.getTime() ?? now.getTime())).toBeGreaterThanOrEqual(30 * DAY);
        expect(now.getTime() - (weekSent?.getTime() ?? now.getTime())).toBeGreaterThanOrEqual(7 * DAY);
        expect(now).toEqual(DUE);
        return;
      }
    }
    throw new Error("the list was never deleted");
  });
});

describe("a gym gone for good: the email", () => {
  const base = {
    to: "owner@example.com",
    gymName: "Iron House",
    orgType: "gym",
    timezone: "Asia/Kolkata",
    countedFrom: at("2026-01-10T00:00:00Z"),
    deletesAt: at("2026-07-09T20:00:00Z"), // 10 Jul in Kolkata
    membersLink: "https://app.example/console/iron-house/members",
  };

  it("names the day in the gym's own zone, what goes, what stays, how to keep it, and where to download", () => {
    const mail = goneForGoodEmail({ ...base, notice: "month" });
    expect(mail.subject).toBe("Iron House: your member list will be deleted on 10 Jul 2026");
    expect(mail.text).toContain("Iron House has had no paid plan, and nobody from Iron House has signed in to AI Home Gym, since 10 Jan 2026.");
    expect(mail.text).toContain("On 10 Jul 2026 we will delete its member list, its leads and its staff invitations. Your members keep their own accounts, workouts and visits.");
    expect(mail.text).toContain("To keep everything, sign in to your gym console before 10 Jul 2026.");
    expect(mail.text).toContain("To keep a copy of your list, sign in and press Download member list:\nhttps://app.example/console/iron-house/members");
    expect(mail.html).toContain('<a href="https://app.example/console/iron-house/members">');
  });

  it("the week email says it is the last reminder", () => {
    expect(goneForGoodEmail({ ...base, notice: "week" }).subject).toBe("Last reminder: Iron House's member list will be deleted on 10 Jul 2026");
  });

  it("a studio reads its own words, and a name with markup and line breaks is one escaped line", () => {
    const mail = goneForGoodEmail({ ...base, notice: "month", orgType: "studio", gymName: "<b>Flow</b>\nYoga" });
    expect(mail.subject).not.toContain("\n");
    expect(mail.html).toContain("&lt;b&gt;Flow&lt;/b&gt; Yoga");
    expect(mail.html).not.toContain("<b>Flow");
    expect(mail.text).toContain("client list");
  });
});
