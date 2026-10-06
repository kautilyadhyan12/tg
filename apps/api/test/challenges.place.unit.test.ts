// A CHALLENGE'S PLACES against the leaderboard's (spec Part 3 §15.6; ROADMAP 19d-i). No
// database.
//
// `placeEntrants` counts where the leaderboard's `rankBoard` sorts, for people whose name
// and hidden reason are already worked out. The two must never differ: a challenge that
// placed somebody the leaderboard hides would show a person who chose Hide me. So thousands
// of boards from a seeded generator (ties, every way to be hidden, people at nothing, a
// viewer who is hidden, absent or last) are ranked by both, and every place, every count
// and every line of the viewer's own must be the same.
import { describe, expect, it } from "vitest";
import { LEADERBOARD_TOP } from "@app/shared";
import { placeEntrants, type Entrant } from "../src/modules/orgs/challenges/place.js";
import { hiddenReason, rankBoard, shownName, type BoardPerson } from "../src/modules/orgs/leaderboard/rank.js";

/** A small seeded generator (mulberry32): the same boards on every run. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Asha", "Bilal", "Chen", "Dina", "Esha", "Farid", "Gita", "Hema"];
const LAST = ["Rao", "Khan", "Wu", "Das", "", "Ó Sé", "van Dyk"];

function board(next: () => number): { people: BoardPerson[]; viewerId: string } {
  const size = Math.floor(next() * 14);
  const people: BoardPerson[] = [];
  for (let i = 0; i < size; i++) {
    const first = FIRST[Math.floor(next() * FIRST.length)] ?? "Asha";
    const last = LAST[Math.floor(next() * LAST.length)] ?? "";
    const roll = next();
    people.push({
      userId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      // Few distinct numbers, so ties are common; some people at nothing.
      value: Math.floor(next() * 5),
      circles: null,
      // An automatic name (the address's first part) falls back to the record's, or to none.
      displayName: roll < 0.1 ? `p${String(i)}` : `${first} ${last}`.trim(),
      email: `p${String(i)}@example.com`,
      recordName: roll < 0.05 ? `${first} Record` : null,
      isStaff: next() < 0.08,
      takenOff: next() < 0.08,
      hideMe: next() < 0.12,
      under18: next() < 0.08,
    });
  }
  const viewerId = next() < 0.1 || people.length === 0 ? "00000000-0000-4000-8000-999999999999" : (people[Math.floor(next() * people.length)]?.userId ?? "");
  return { people, viewerId };
}

const asEntrants = (people: readonly BoardPerson[]): Entrant[] => people.map((p) => ({ userId: p.userId, value: p.value, hidden: hiddenReason(p), shown: shownName(p) }));
const cells = (rows: readonly { userId: string; name: string; initials: string; place: number; value: number; isMe: boolean }[]) =>
  rows.map((r) => [r.userId, r.name, r.initials, r.place, r.value, r.isMe]);

describe("a challenge's places are the leaderboard's", () => {
  it("on 5,000 boards: every place and name, how many are on it, lead it and reached a target, and the viewer's own line", () => {
    const next = seeded(20261006);
    let shown = 0;
    let hiddenViewers = 0;
    let nameless = 0;
    for (let n = 0; n < 5000; n++) {
      const { people, viewerId } = board(next);
      const target = 1 + Math.floor(next() * 4);
      const theirs = rankBoard(people, viewerId);
      const entrants = asEntrants(people);
      const ours = placeEntrants(entrants, viewerId, LEADERBOARD_TOP, target);
      const what = `board ${String(n)}`;
      // These boards are smaller than a page, so the leaderboard's rows are everybody on it.
      expect(ours.status, what).toBe(theirs.status);
      expect(cells(ours.top), what).toEqual(cells(theirs.rows));
      expect(ours.ranked, what).toBe(theirs.status === "shown" ? theirs.ranked : 0);
      expect(ours.leaders, what).toBe(theirs.rows.filter((r) => r.place === 1).length);
      expect(ours.reached, what).toBe(theirs.status === "shown" ? theirs.rows.filter((r) => r.value >= target).length : null);
      expect(ours.me, what).toEqual({
        value: theirs.me.value,
        place: theirs.me.place,
        hidden: theirs.me.hidden,
        toNextPlace: theirs.me.toNextPlace,
        nextPlace: theirs.me.nextPlace,
      });
      // Three rows asked for are the first three of the same board, and nothing else changes.
      const three = placeEntrants(entrants, viewerId, 3, null);
      expect(cells(three.top), what).toEqual(cells(theirs.rows.slice(0, 3)));
      expect([three.ranked, three.leaders, three.reached, three.me], what).toEqual([ours.ranked, ours.leaders, null, ours.me]);
      if (theirs.status === "shown") shown += 1;
      if (theirs.me.hidden !== null) hiddenViewers += 1;
      if (people.some((p) => hiddenReason(p) === "no_name")) nameless += 1;
    }
    // The generator made the cases it claims to.
    expect(shown).toBeGreaterThan(1000);
    expect(hiddenViewers).toBeGreaterThan(500);
    expect(nameless).toBeGreaterThan(500);
  });

  const entrant = (id: string, value: number, name: string | null, hidden: Entrant["hidden"] = null): Entrant => ({
    userId: id,
    value,
    hidden,
    shown: name === null ? null : { name, initials: name.slice(0, 1) },
  });

  it("nobody hidden is placed, counted or leaves a gap, written out", () => {
    const places = placeEntrants(
      [
        entrant("h", 9, "Hema H.", "hide_me"),
        entrant("s", 8, "Sam S.", "staff"),
        entrant("n", 7, null, "no_name"),
        entrant("a", 3, "Asha R."),
        entrant("b", 2, "Bilal K."),
        entrant("c", 2, "Chen W."),
        entrant("z", 0, "Zed Z."),
        entrant("v", 1, "Vera V."),
      ],
      "v",
      100,
      3,
    );
    expect(places.top.map((p) => [p.name, p.place, p.value])).toEqual([["Asha R.", 1, 3], ["Bilal K.", 2, 2], ["Chen W.", 2, 2], ["Vera V.", 4, 1]]);
    // Four on it, one in the lead, one at the target: the three hidden people past it are in none of them.
    expect([places.ranked, places.leaders, places.reached]).toEqual([4, 1, 1]);
    expect(places.me).toEqual({ value: 1, place: 4, hidden: null, toNextPlace: 1, nextPlace: 2 });
    // The hidden viewer sees the place they would have, and is on nobody's list.
    const hers = placeEntrants([entrant("h", 9, "Hema H.", "hide_me"), entrant("a", 3, "Asha R."), entrant("b", 2, "Bilal K."), entrant("c", 2, "Chen W.")], "h", 100, null);
    expect(hers.top.map((p) => p.userId)).toEqual(["a", "b", "c"]);
    expect([hers.ranked, hers.leaders]).toEqual([3, 1]);
    expect(hers.me).toEqual({ value: 9, place: 1, hidden: "hide_me", toNextPlace: null, nextPlace: null });
  });

  it("a board longer than what is sent: the rows stop, the counts and the viewer's place do not", () => {
    const many = Array.from({ length: 250 }, (_, i) => entrant(`u${String(i).padStart(3, "0")}`, 250 - Math.floor(i / 2), `Person ${String(i).padStart(3, "0")}`));
    const places = placeEntrants(many, "u249", 100, 200);
    expect(places.top).toHaveLength(100);
    // Two share each number: 1, 1, 3, 3, …
    expect(places.top.slice(0, 4).map((p) => [p.userId, p.place])).toEqual([["u000", 1], ["u001", 1], ["u002", 3], ["u003", 3]]);
    expect(places.top[99]).toMatchObject({ userId: "u099", place: 99 });
    expect([places.ranked, places.leaders, places.reached]).toEqual([250, 2, 102]);
    // The last person: 248 are ahead, and the next number up is held by the two just above.
    expect(places.me).toEqual({ value: 126, place: 249, hidden: null, toNextPlace: 1, nextPlace: 247 });
  });

  it("fewer than three: no places and no counts, and the viewer keeps their number", () => {
    const two = [entrant("a", 3, "Asha R."), entrant("v", 1, "Vera V.")];
    expect(placeEntrants(two, "v", 100, 1)).toEqual({
      status: "too_few",
      ranked: 0,
      top: [],
      leaders: 0,
      reached: null,
      me: { value: 1, place: null, hidden: null, toNextPlace: null, nextPlace: null },
    });
  });
});
