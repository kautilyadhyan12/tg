// THE LEADERBOARD'S PLACES AND NAMES — the pure rule, over every class of case (spec Part 3
// §15.5). The worst thing: a hidden person seen by somebody else, in a row, a count or a gap.
import { describe, expect, it } from "vitest";
import { LEADERBOARD_TOP } from "@app/shared";
import { hiddenReason, isAutomaticName, rankBoard, shownName, type BoardPerson } from "../src/modules/orgs/leaderboard/rank.js";
import { addDays, mondayOf, periodRange, streakWeeks } from "../src/modules/orgs/leaderboard/periods.js";

let n = 0;
const person = (displayName: string, value: number, extra: Partial<BoardPerson> = {}): BoardPerson => ({
  userId: `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`,
  value,
  circles: null,
  displayName,
  email: null,
  recordName: null,
  isStaff: false,
  takenOff: false,
  hideMe: false,
  under18: false,
  ...extra,
});

const view = (people: BoardPerson[], viewer: BoardPerson) => {
  const b = rankBoard(people, viewer.userId);
  return { ...b, rows: b.rows.map((r) => [r.name, r.place, r.value]) };
};

describe("places", () => {
  it("equal numbers share a place (1, 2, 2, 4) and are listed by name", () => {
    const people = [person("Dev Patel", 3), person("Cara Lee", 5), person("Ana Roy", 3), person("Ben Ng", 1)];
    expect(view(people, people[0] as BoardPerson).rows).toEqual([
      ["Cara L.", 1, 5],
      ["Ana R.", 2, 3],
      ["Dev P.", 2, 3],
      ["Ben N.", 4, 1],
    ]);
  });

  it("every way of being hidden is taken out BEFORE places, so no place is skipped", () => {
    const reasons: Partial<BoardPerson>[] = [
      { isStaff: true },
      { takenOff: true },
      { hideMe: true },
      { under18: true },
      { displayName: "New User" },
    ];
    for (const reason of reasons) {
      const hidden = person("Hal Hidden", 9, reason);
      const shown = [person("Ann A", 3), person("Bob B", 2), person("Cat C", 1)];
      const b = rankBoard([hidden, ...shown], (shown[0] as BoardPerson).userId);
      expect(b.rows.map((r) => [r.userId, r.place])).toEqual(shown.map((s, i) => [s.userId, i + 1]));
      expect(b.ranked).toBe(3);
      expect(JSON.stringify(b)).not.toContain(hidden.userId);
      expect(JSON.stringify(b)).not.toContain("Hal");
    }
  });

  it("the hidden viewer sees the place they would have and why, and nothing else changes", () => {
    const me = person("Hal Hidden", 2, { hideMe: true });
    const shown = [person("Ann A", 3), person("Bob B", 2), person("Cat C", 1)];
    const b = rankBoard([me, ...shown], me.userId);
    expect(b.me).toEqual({ value: 2, place: 2, hidden: "hide_me", toNextPlace: 1, nextPlace: 1, circles: null });
    expect(b.rows.map((r) => r.place)).toEqual([1, 2, 3]);
  });

  it("nobody at 0 is ranked; the viewer at 0 has no place", () => {
    const me = person("Zero Zed", 0);
    const shown = [person("Ann A", 3), person("Bob B", 2), person("Cat C", 1)];
    const b = rankBoard([me, ...shown], me.userId);
    expect(b.rows).toHaveLength(3);
    expect(b.me).toEqual({ value: 0, place: null, hidden: null, toNextPlace: null, nextPlace: null, circles: null });
  });

  it("no board under three people, counted after the hidden are out", () => {
    const people = [person("Ann A", 3), person("Bob B", 2), person("Hal H", 9, { hideMe: true })];
    const b = rankBoard(people, (people[0] as BoardPerson).userId);
    expect(b.status).toBe("too_few");
    expect(b.rows).toEqual([]);
    expect(b.me.place).toBeNull();
    expect(rankBoard([...people, person("Cat C", 1)], (people[0] as BoardPerson).userId).status).toBe("shown");
  });

  it("members see the top 100 and their own place below, with how many more reach the next place", () => {
    const people = Array.from({ length: 150 }, (_, i) => person(`P${String(i).padStart(3, "0")} X`, 200 - i));
    const me = people[120] as BoardPerson;
    const b = rankBoard(people, me.userId);
    expect(b.rows).toHaveLength(LEADERBOARD_TOP);
    expect(b.ranked).toBe(150);
    expect(b.me).toMatchObject({ value: 80, place: 121, toNextPlace: 1, nextPlace: 120 });
    const first = rankBoard(people, (people[0] as BoardPerson).userId);
    expect(first.me).toMatchObject({ place: 1, toNextPlace: null, nextPlace: null });
    // A tie above: the next place up is the tied pair's.
    const tied = [person("Ann A", 5), person("Bob B", 5), person("Cat C", 2)];
    expect(rankBoard(tied, (tied[2] as BoardPerson).userId).me).toMatchObject({ place: 3, toNextPlace: 3, nextPlace: 1 });
    // 4th behind two tied 2nd: the next place up is 2nd, not a 3rd nobody holds.
    const four = [person("Ann A", 5), person("Bob B", 3), person("Cat C", 3), person("Dan D", 1)];
    expect(rankBoard(four, (four[3] as BoardPerson).userId).me).toMatchObject({ place: 4, toNextPlace: 2, nextPlace: 2 });
  });

  it("a staff reason outranks the others, so staff always read 'Staff, not ranked'", () => {
    expect(hiddenReason(person("Sue Staff", 1, { isStaff: true, hideMe: true, under18: true }))).toBe("staff");
    expect(hiddenReason(person("Tom T", 1, { takenOff: true, hideMe: true }))).toBe("taken_off");
    expect(hiddenReason(person("Uma U", 1, { hideMe: true, under18: true }))).toBe("hide_me");
    expect(hiddenReason(person("Uma U", 1))).toBeNull();
  });
});

describe("names: first name and last initial, never an email", () => {
  // Real names in the shapes sign-ups and gym exports carry them, including ones no list here
  // was written for: particles, accents, one-word names, Vietnamese order, extra spaces.
  const cases: [string, string, string][] = [
    ["Priya Sharma", "Priya S.", "PS"],
    ["María José García", "María G.", "MG"],
    ["  Ana   de la Cruz ", "Ana C.", "AC"],
    ["Nguyễn Văn An", "Nguyễn A.", "NA"],
    ["Ólafur Arnalds", "Ólafur A.", "ÓA"],
    ["Zoë O'Brien", "Zoë O.", "ZO"],
    ["Li", "Li", "L"],
    ["jean-luc picard", "jean-luc P.", "JP"],
    ["Søren Kierkegaard", "Søren K.", "SK"],
    ["Aarav Kumar Singh", "Aarav S.", "AS"],
  ];
  for (const [given, name, initials] of cases) {
    it(`"${given}" shows as "${name}"`, () => {
      expect(shownName({ displayName: given, email: "someone@example.com", recordName: null })).toEqual({ name, initials });
    });
  }

  it("an automatic name gives way to the gym record's name, else the person has no name to show", () => {
    expect(isAutomaticName("New User", null)).toBe(true);
    expect(isAutomaticName("new user", "a@b.co")).toBe(true);
    expect(isAutomaticName("rahul.k", "rahul.k@gmail.com")).toBe(true);
    expect(isAutomaticName("Rahul.K", "rahul.k@gmail.com")).toBe(true);
    expect(isAutomaticName("Rahul Kumar", "rahul.k@gmail.com")).toBe(false);
    expect(isAutomaticName("rahul", "rahul.k@gmail.com")).toBe(false);
    expect(isAutomaticName("Ana", null)).toBe(false);
    expect(isAutomaticName("   ", null)).toBe(true);
    expect(shownName({ displayName: "rahul.k", email: "rahul.k@gmail.com", recordName: "Rahul Kapoor" })).toEqual({ name: "Rahul K.", initials: "RK" });
    expect(shownName({ displayName: "New User", email: null, recordName: "  " })).toBeNull();
    expect(shownName({ displayName: "New User", email: null, recordName: null })).toBeNull();
    expect(hiddenReason(person("New User", 3))).toBe("no_name");
    // A name somebody typed is theirs even when the record says otherwise.
    expect(shownName({ displayName: "Bobby T", email: "bob@x.com", recordName: "Robert Tables" })?.name).toBe("Bobby T.");
  });

  it("an email's first part is never shown, even when it looks like a name", () => {
    const b = rankBoard(
      [
        person("ann.smith", 3, { email: "ann.smith@gmail.com" }),
        person("Bob B", 2),
        person("Cat C", 1),
        person("Dan D", 1),
      ],
      "x",
    );
    expect(JSON.stringify(b)).not.toContain("ann.smith");
    expect(b.rows.map((r) => r.name)).toEqual(["Bob B.", "Cat C.", "Dan D."]);
  });
});

describe("periods, in the gym's calendar", () => {
  const cases: [string, string, string | null, string][] = [
    ["2026-10-07", "this_week", "2026-10-05", "2026-10-11"],
    ["2026-10-05", "this_week", "2026-10-05", "2026-10-11"],
    ["2026-10-11", "this_week", "2026-10-05", "2026-10-11"],
    ["2026-10-07", "last_week", "2026-09-28", "2026-10-04"],
    ["2026-10-07", "this_month", "2026-10-01", "2026-10-31"],
    ["2026-10-07", "last_month", "2026-09-01", "2026-09-30"],
    ["2026-01-01", "last_month", "2025-12-01", "2025-12-31"],
    ["2026-01-01", "this_week", "2025-12-29", "2026-01-04"],
    ["2028-02-29", "this_month", "2028-02-01", "2028-02-29"],
    ["2028-03-01", "last_month", "2028-02-01", "2028-02-29"],
    ["2028-02-29", "this_week", "2028-02-28", "2028-03-05"],
    ["2026-10-07", "all_time", null, "2026-10-07"],
  ];
  for (const [today, period, from, to] of cases) {
    it(`${period} on ${today} is ${String(from)} to ${to}`, () => {
      expect(periodRange(today, period as Parameters<typeof periodRange>[1])).toEqual({ from, to });
    });
  }
  it("the Streak's seven weeks end with this week", () => {
    expect(streakWeeks("2028-02-29")).toEqual(["2028-01-17", "2028-01-24", "2028-01-31", "2028-02-07", "2028-02-14", "2028-02-21", "2028-02-28"]);
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});
