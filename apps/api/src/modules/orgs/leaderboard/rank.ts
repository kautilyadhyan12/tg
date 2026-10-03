// THE LEADERBOARD'S PLACES (spec Part 3 §15.5). Pure: the repo reads each live member's
// number and facts, and this decides who is shown, under what name, and in which place.
//
// The worst thing it could do is show somebody who chose Hide me to another member, in a
// row, a count, or a gap in the places. Hidden people are taken out BEFORE places are
// given, and nothing returned for other people is computed from them.
import {
  LEADERBOARD_MIN_PEOPLE,
  LEADERBOARD_TOP,
  type LeaderboardCircle,
  type LeaderboardHiddenReason,
  type LeaderboardMe,
  type LeaderboardRow,
  type LeaderboardStatus,
  type StaffLeaderboardRow,
} from "@app/shared";

/** A live app member of the gym, as the repo read them. */
export interface BoardPerson {
  userId: string;
  value: number;
  circles: LeaderboardCircle[] | null;
  displayName: string;
  email: string | null;
  /** The name on the gym's record of them, if they joined with one. */
  recordName: string | null;
  isStaff: boolean;
  takenOff: boolean;
  hideMe: boolean;
  under18: boolean;
}

/** Not a name to show: the sign-up's automatic names ("New User", or the email's first
 *  part), and anything typed that is itself an address. */
export function isAutomaticName(displayName: string, email: string | null): boolean {
  const name = displayName.trim().toLowerCase();
  if (name === "" || name === "new user" || name.includes("@")) return true;
  const local = email?.split("@")[0]?.trim().toLowerCase() ?? "";
  return local !== "" && name === local.slice(0, 100);
}

const words = (name: string): string[] => name.trim().split(/\s+/u).filter((w) => w !== "");
const firstLetter = (word: string): string => Array.from(word)[0] ?? "";

/** First name and last initial ("Priya S."), never an email. An automatic app name gives
 *  way to the gym record's name; with neither, the person has no name to show. */
export function shownName(person: Pick<BoardPerson, "displayName" | "email" | "recordName">): { name: string; initials: string } | null {
  const source = isAutomaticName(person.displayName, person.email) ? (person.recordName ?? "") : person.displayName;
  const parts = words(source);
  const first = parts[0];
  if (first === undefined) return null;
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (last === undefined) return { name: first, initials: firstLetter(first).toUpperCase() };
  const initial = firstLetter(last).toUpperCase();
  return { name: `${first} ${initial}.`, initials: `${firstLetter(first).toUpperCase()}${initial}` };
}

/** Why a person is not ranked, or null when they are rankable. */
export function hiddenReason(person: BoardPerson): LeaderboardHiddenReason | null {
  if (person.isStaff) return "staff";
  if (person.takenOff) return "taken_off";
  if (person.hideMe) return "hide_me";
  if (person.under18) return "under_18";
  if (shownName(person) === null) return "no_name";
  return null;
}

export interface Board {
  status: Extract<LeaderboardStatus, "shown" | "too_few">;
  ranked: number;
  rows: LeaderboardRow[];
  me: LeaderboardMe;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Everybody members may see, in order, each with their place. Hidden people are left out
 *  before a place is given. */
function placedRows(people: readonly BoardPerson[], viewerId: string | null): LeaderboardRow[] {
  const shown: { person: BoardPerson; name: string; initials: string }[] = [];
  for (const person of people) {
    if (person.value <= 0 || hiddenReason(person) !== null) continue;
    const named = shownName(person);
    if (named !== null) shown.push({ person, ...named });
  }
  shown.sort(
    (a, b) => b.person.value - a.person.value || byName(a.name, b.name) || byName(a.person.userId, b.person.userId),
  );

  const placed: LeaderboardRow[] = [];
  let place = 0;
  let previous = Number.NaN;
  shown.forEach((s, i) => {
    if (s.person.value !== previous) {
      place = i + 1;
      previous = s.person.value;
    }
    placed.push({
      userId: s.person.userId,
      name: s.name,
      initials: s.initials,
      place,
      value: s.person.value,
      circles: s.person.circles,
      isMe: s.person.userId === viewerId,
    });
  });
  return placed;
}

/** Places for the people the viewer may see, and the viewer's own line. */
export function rankBoard(people: readonly BoardPerson[], viewerId: string): Board {
  const placed = placedRows(people, viewerId);
  const enough = placed.length >= LEADERBOARD_MIN_PEOPLE;
  const viewer = people.find((p) => p.userId === viewerId);
  const value = viewer?.value ?? 0;
  const above = placed.filter((r) => r.value > value);
  const nextUp = above.length === 0 ? null : Math.min(...above.map((r) => r.value));
  const me: LeaderboardMe = {
    value,
    place: enough && value > 0 ? above.length + 1 : null,
    hidden: viewer === undefined ? null : hiddenReason(viewer),
    toNextPlace: enough && value > 0 && nextUp !== null ? nextUp - value : null,
    nextPlace: enough && value > 0 && nextUp !== null ? placed.filter((r) => r.value > nextUp).length + 1 : null,
    circles: viewer?.circles ?? null,
  };

  return {
    status: enough ? "shown" : "too_few",
    ranked: placed.length,
    rows: enough ? placed.slice(0, LEADERBOARD_TOP) : [],
    me,
  };
}

/** The person's whole name for staff, as on Members: what they typed, or their record's
 *  name when the app's is automatic; null with neither. Never an email. */
export function fullName(person: Pick<BoardPerson, "displayName" | "email" | "recordName">): { name: string | null; initials: string } {
  const source = isAutomaticName(person.displayName, person.email) ? (person.recordName ?? "") : person.displayName;
  const parts = words(source);
  const first = parts[0];
  if (first === undefined) return { name: null, initials: "?" };
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initials = `${firstLetter(first)}${last === undefined ? "" : firstLetter(last)}`.toUpperCase();
  return { name: parts.join(" "), initials };
}

export interface StaffBoard {
  /** What members see: the rows, or nothing while fewer than three are on it. */
  status: Extract<LeaderboardStatus, "shown" | "too_few">;
  /** People members see on it. */
  ranked: number;
  /** Everyone with a number, the hidden included: by number, then by full name, a person
   *  with no name last. */
  rows: StaffLeaderboardRow[];
}

/** The board as staff see it. A place is the one MEMBERS see, from the same function that
 *  ranks their board; a hidden person has none, only the reason. */
export function rankStaffBoard(people: readonly BoardPerson[]): StaffBoard {
  const placed = placedRows(people, null);
  const placeOf = new Map(placed.map((row) => [row.userId, row.place]));
  const rows = people
    .filter((person) => person.value > 0)
    .map((person): StaffLeaderboardRow => {
      const named = fullName(person);
      return {
        userId: person.userId,
        name: named.name,
        initials: named.initials,
        place: placeOf.get(person.userId) ?? null,
        value: person.value,
        circles: person.circles,
        hidden: hiddenReason(person),
      };
    })
    .sort(
      (a, b) =>
        b.value - a.value ||
        Number(a.name === null) - Number(b.name === null) ||
        byName(a.name ?? "", b.name ?? "") ||
        byName(a.userId, b.userId),
    );
  return { status: placed.length >= LEADERBOARD_MIN_PEOPLE ? "shown" : "too_few", ranked: placed.length, rows };
}

/** One person's line on the staff board without ranking everybody: the same place and
 *  number `rankStaffBoard` gives them (equal numbers share a place, so a place is one more
 *  than the people members see above them). */
export function staffPlace(people: readonly BoardPerson[], userId: string): { place: number | null; value: number } {
  const person = people.find((p) => p.userId === userId);
  if (person === undefined || person.value <= 0) return { place: null, value: 0 };
  if (hiddenReason(person) !== null) return { place: null, value: person.value };
  let above = 0;
  for (const other of people) {
    if (other.value > person.value && hiddenReason(other) === null) above += 1;
  }
  return { place: above + 1, value: person.value };
}