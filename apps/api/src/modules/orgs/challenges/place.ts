// A CHALLENGE'S PLACES (spec Part 3 §15.6; ROADMAP 19d-i). Pure.
//
// The leaderboard's own places (`leaderboard/rank.ts`, `rankBoard`) for people whose name
// and hidden reason are already worked out. A member's list ranks every challenge the gym
// runs, and at a big gym sorting everybody for each one kept the server's one thread busy
// for most of the read. So a name is worked out once a person a read, by the leaderboard's
// own functions, and here nobody is sorted who is not sent: a place is one more than the
// people with a higher number, so places, the people ahead and how many reached a target
// are counted, and only the rows that are sent are put in order.
// `challenges.place.unit.test.ts` holds this and `rankBoard` to the same answer on
// thousands of boards.
//
// The worst thing it could do is place somebody hidden. Hidden people are left out BEFORE
// anything is counted, and nothing returned about other people is computed from them.
import { LEADERBOARD_MIN_PEOPLE, type LeaderboardHiddenReason } from "@app/shared";

export interface Entrant {
  userId: string;
  value: number;
  /** Why members do not see them (`hiddenReason`); null when they do. */
  hidden: LeaderboardHiddenReason | null;
  /** Their name as members see it (`shownName`); null with none to show. */
  shown: { name: string; initials: string } | null;
}

export interface Placed {
  userId: string;
  name: string;
  initials: string;
  place: number;
  value: number;
  isMe: boolean;
}

export interface Places {
  status: "shown" | "too_few";
  /** People members may see on it; 0 while fewer than three are. */
  ranked: number;
  /** The first `limit` of them, in order, each with their place. */
  top: Placed[];
  /** How many share first place. */
  leaders: number;
  /** How many have at least `target`; null with no target or no board. */
  reached: number | null;
  me: {
    value: number;
    /** Their place, or the place they would have while hidden; null at 0 or with no board. */
    place: number | null;
    hidden: LeaderboardHiddenReason | null;
    toNextPlace: number | null;
    nextPlace: number | null;
  };
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `limit`: how many rows are sent. `target`: the number to reach, null where the most wins. */
export function placeEntrants(entrants: readonly Entrant[], viewerId: string, limit: number, target: number | null): Places {
  // Everybody members may see, by their number: equal numbers share a place.
  const byValue = new Map<number, { userId: string; name: string; initials: string }[]>();
  let ranked = 0;
  let viewer: Entrant | undefined;
  for (const e of entrants) {
    if (e.userId === viewerId) viewer = e;
    if (e.value <= 0 || e.hidden !== null || e.shown === null) continue;
    ranked += 1;
    const seen = { userId: e.userId, name: e.shown.name, initials: e.shown.initials };
    const same = byValue.get(e.value);
    if (same === undefined) byValue.set(e.value, [seen]);
    else same.push(seen);
  }
  const values = [...byValue.keys()].sort((a, b) => b - a);
  const sizeOf = (value: number): number => byValue.get(value)?.length ?? 0;
  const enough = ranked >= LEADERBOARD_MIN_PEOPLE;
  const value = viewer?.value ?? 0;

  // The people above the viewer, the next number up, and the people above that.
  let above = 0;
  let aboveNext = 0;
  let nextUp: number | null = null;
  for (const v of values) {
    if (v <= value) break;
    aboveNext = above;
    above += sizeOf(v);
    nextUp = v;
  }

  const top: Placed[] = [];
  let before = 0;
  for (const v of values) {
    if (!enough || top.length >= limit) break;
    const same = byValue.get(v) ?? [];
    same.sort((a, b) => byText(a.name, b.name) || byText(a.userId, b.userId));
    for (const s of same) {
      if (top.length >= limit) break;
      top.push({ ...s, place: before + 1, value: v, isMe: s.userId === viewerId });
    }
    before += same.length;
  }

  const placed = enough && value > 0;
  return {
    status: enough ? "shown" : "too_few",
    ranked: enough ? ranked : 0,
    top,
    leaders: enough ? sizeOf(values[0] ?? 0) : 0,
    reached: enough && target !== null ? values.reduce((n, v) => (v >= target ? n + sizeOf(v) : n), 0) : null,
    me: {
      value,
      place: placed ? above + 1 : null,
      hidden: viewer?.hidden ?? null,
      toNextPlace: placed && nextUp !== null ? nextUp - value : null,
      nextPlace: placed && nextUp !== null ? aboveNext + 1 : null,
    },
  };
}
