// A place's challenges, in words: the browser's rules (apps/web/src/components/gym/challengesView.js). Pure, so tested
// alone; the web's `challengesView.phone.test.js` holds the two to one answer. Days are the place's own and are printed
// as they are; what a challenge is about is said in the words the server sent with it.
import { challengeTakesNumbers, type GymPostChallengeResult, type MemberGymChallenge } from "@app/shared";
import { ordinal, shortDay } from "./classesView";

type Words = MemberGymChallenge["words"];
type Challenge = MemberGymChallenge;
type TeamRow = NonNullable<Challenge["teamBoard"]>["rows"][number];

export const challengesPath = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}/challenges`;
const onePath = (gymId: string, id: string) => `${challengesPath(gymId)}/${encodeURIComponent(id)}`;
export const joinedPath = (gymId: string, id: string) => `${onePath(gymId, id)}/joined`;
export const teamPath = (gymId: string, id: string) => `${onePath(gymId, id)}/team`;
export const boardPath = (gymId: string, id: string) => `${onePath(gymId, id)}/board`;

export const challengesNotShown = (gymName: string) => `${gymName}’s challenges aren’t available right now.`;
export const CHALLENGES_NOT_READ = "Couldn’t load the challenges.";
export const noChallenges = (gymName: string) => `${gymName} has no challenges on right now.`;
export const CHALLENGE_GONE = "This challenge isn’t shown any more.";
export const BOARD_NOT_READ = "Couldn’t load the board.";

const count = (n: number) => n.toLocaleString("en");
const people = (n: number) => (n === 1 ? "1 person" : `${count(n)} people`);
const teamCount = (n: number) => (n === 1 ? "1 team" : `${count(n)} teams`);
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
const dayAt = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const staffCount = (c: Pick<Challenge, "countedBy">) => c.countedBy === "staff";
const whole = (words: Words) => words.print === "whole";
const wordFor = (words: Words, n: number) => (n === 1 ? words.one : words.many);

/** A number as it is printed: whole; a time from seconds; a distance from metres, cut down, and rounded up only where
 *  it is still `needed`, so doing that much is enough. */
export function printed(n: number, words: Words, needed = false): string {
  if (words.print === "time") {
    const h = Math.floor(n / 3600);
    const min = Math.floor((n % 3600) / 60);
    const s = String(n % 60).padStart(2, "0");
    if (h > 0) return `${count(h)} h ${String(min).padStart(2, "0")} min ${s} s`;
    return min > 0 ? `${String(min)} min ${s} s` : `${String(n % 60)} s`;
  }
  if (words.print === "km") {
    const tenths = needed ? Math.ceil(n / 100) : Math.floor(n / 100);
    return `${(tenths / 10).toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }
  return count(n);
}

/** "3 visits", "1 workout day", "45 s". */
export const countText = (n: number, words: Words) => (whole(words) ? `${printed(n, words)} ${wordFor(words, n)}` : printed(n, words));

/** People are in it in teams: a team's number is its people's added together. */
export const inTeams = (c: Pick<Challenge, "teams" | "teamBoard">) => c.teams !== "none" && c.teamBoard !== null;

export const aboutLine = (c: Challenge) => `${c.words.about} · ${c.words.howLine}`;

export type ChipTone = "good" | "orange" | "bad" | "plain";

/** The mark beside a challenge's name: where it is on the place's calendar. */
export function challengeChip(c: Challenge, today: string): { text: string; tone: ChipTone } {
  if (c.cancelled) return { text: "Cancelled", tone: "bad" };
  if (c.state === "coming") {
    const days = dayNumber(c.startsOn) - dayNumber(today);
    return { text: days <= 1 ? "Starts tomorrow" : `Starts in ${String(days)} days`, tone: "plain" };
  }
  if (c.state === "ended") return { text: "Ended", tone: "plain" };
  const left = dayNumber(c.endsOn) - dayNumber(today) + 1;
  return { text: left <= 1 ? "Last day" : `${String(left)} days left`, tone: left <= 3 ? "orange" : "good" };
}

/** "Mon 5 Oct – Sun 11 Oct"; a year is said only where it is not today's. */
export function challengeDates(c: Pick<Challenge, "startsOn" | "endsOn">, today: string): string {
  const year = (day: string) => (day.slice(0, 4) === today.slice(0, 4) ? "" : ` ${day.slice(0, 4)}`);
  const first = `${shortDay(c.startsOn)}${year(c.startsOn)}`;
  return c.startsOn === c.endsOn ? first : `${first} – ${shortDay(c.endsOn)}${year(c.endsOn)}`;
}

/** How it is won, in one line. */
export function howToWin(c: Challenge): string {
  const teamed = inTeams(c);
  if (c.target !== null) return `Reach ${countText(c.target, c.words)}${teamed ? " as a team" : ""}`;
  if (teamed) return c.lowestWins ? "The fastest team wins" : `The team with the most ${c.words.many} wins`;
  return c.lowestWins ? "Fastest time wins" : `Most ${c.words.many} wins`;
}

export function whoLine(c: Challenge, gymName: string): string {
  if (c.who === "everyone") return `Everyone at ${gymName} is in`;
  const joined = c.joinedCount ?? 0;
  if (joined === 0) return "Nobody has joined yet";
  return `${people(joined)} ${joined === 1 ? "has" : "have"} joined`;
}

export interface Progress {
  big: number;
  of: number | null;
  unit: string;
  /** How full its steps are, 0 to 1; null with none to fill. */
  share: number | null;
  note: string | null;
  done: boolean;
}

/** The member's own number: the words under it, and how full its steps are. */
export function progress(c: Challenge): Progress | null {
  const { me } = c;
  if (me === null) return null;
  const waiting = staffCount(c) && me.value === 0 && c.state === "running" ? "The staff haven’t added your number yet." : null;
  // In teams the number to reach is the team's.
  if (c.target === null || inTeams(c)) return { big: me.value, of: null, unit: whole(c.words) ? wordFor(c.words, me.value) : "", share: null, note: waiting, done: false };
  const unit = whole(c.words) ? c.words.many : "";
  if (me.reached) return { big: me.value, of: c.target, unit, share: 1, note: `Done. You reached ${countText(c.target, c.words)}.`, done: true };
  const toGo = Math.max(0, c.target - me.value);
  const share = Math.min(1, Math.round((me.value / c.target) * 100) / 100);
  const note = waiting ?? (c.state === "ended" ? null : `${printed(toGo, c.words, true)} to go`);
  return { big: me.value, of: c.target, unit, share, note, done: false };
}

/** "3rd of 24", then what it takes to move up; null with no place, or hidden. */
export function placeLine(c: Challenge): string | null {
  const { me } = c;
  if (me === null || me.place === null || me.hidden !== null || inTeams(c)) return null;
  const where = `${ordinal(me.place)} of ${count(c.board.ranked)}`;
  if (c.state === "ended" || me.toNextPlace === null || me.nextPlace === null) return where;
  const less = c.lowestWins ? "fewer" : "more";
  const gap = !whole(c.words)
    ? `${printed(me.toNextPlace, c.words, true)} ${c.lowestWins ? (c.words.print === "time" ? "faster" : "less") : "more"}`
    : staffCount(c)
      ? `${count(me.toNextPlace)} ${less} ${c.words.many}`
      : `${count(me.toNextPlace)} more ${wordFor(c.words, me.toNextPlace)}`;
  return `${where} · ${gap} to reach ${ordinal(me.nextPlace)}`;
}

const aNumber = (c: Challenge) => (staffCount(c) ? "number" : c.words.one);

/** Why there are no places to show yet, or null when there are. */
export function boardNote(c: Challenge): string | null {
  if (c.cancelled || c.board.status !== "too_few") return null;
  return `The ${inTeams(c) ? "teams’ numbers" : "places"} show once 3 people have a ${aNumber(c)} in this challenge.`;
}

/** Counted at the front desk, at a place that checks nobody in, it counts nothing: say so, never a bare 0. */
export function notCountingNote(c: Challenge, checkingIn: boolean, gymName: string): string | null {
  if (c.words.how !== "desk" || c.state !== "running" || c.cancelled || checkingIn) return null;
  return `${gymName} hasn’t checked anyone in at the front desk in the last 30 days, so no ${c.words.many} are being counted.`;
}

function numbersComing(c: Challenge, today: string, gymName: string): string | null {
  if (!staffCount(c) || !challengeTakesNumbers(c, today)) return null;
  return `The staff at ${gymName} are still adding people’s numbers. The result shows here once 3 people have one.`;
}

const listed = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`);
const FEW = "It finished with fewer than 3 people in it, so there are no places.";

export interface Result {
  headline: string;
  mine: string | null;
}

function teamResult(c: Challenge, board: NonNullable<Challenge["teamBoard"]>, today: string, gymName: string): Result {
  const { me, target } = c;
  const said = (n: number) => countText(n, c.words);
  const rows = board.rows;
  let headline: string;
  if (board.status !== "shown") headline = numbersComing(c, today, gymName) ?? FEW;
  else if (target !== null) {
    const reached = rows.filter((r) => r.reached);
    headline = reached.length === 0 ? `No team reached ${said(target)}.` : `${teamCount(reached.length)} reached ${said(target)}: ${listed(reached.map((r) => r.name))}.`;
  } else {
    const first = rows.filter((r) => r.place === 1);
    const top = first[0];
    if (top === undefined) headline = !rows.some((r) => r.waiting > 0) ? "No team had a number." : rows.every((r) => r.waiting > 0) ? "No team got a place: every team had somebody with no number." : "No team got a place.";
    else if (first.length === 1) headline = `Winner: ${top.name}, with ${said(top.value)}.`;
    else headline = `Joint winners: ${listed(first.map((r) => r.name))}, with ${said(top.value)} each.`;
  }
  let mine: string | null = null;
  const my = rows.find((r) => r.isMine);
  if (my !== undefined && board.status === "shown") {
    const own = me !== null && me.value > 0 ? ` You had ${said(me.value)}.` : "";
    if (target !== null) mine = my.reached ? `Your team, ${my.name}, reached it: ${said(my.value)}.${own}` : `Your team, ${my.name}, got to ${printed(my.value, c.words)} of ${printed(target, c.words)}.${own}`;
    else if (my.place === null && my.waiting > 0) mine = `Your team, ${my.name}, had no place: ${my.waiting === 1 ? "1 of its people" : `${count(my.waiting)} of its people`} had no number.${own}`;
    else if (my.place === null) mine = `Your team, ${my.name}, had no number.`;
    else if (my.place === 1) mine = `Your team, ${my.name}, ${rows.filter((r) => r.place === 1).length > 1 ? "was joint first" : "won"}.${own}`;
    else mine = `Your team, ${my.name}, finished ${ordinal(my.place)}, with ${said(my.value)}.${own}`;
  }
  return { headline, mine };
}

/** How it finished: who won, and how the member did. Null until it has ended. */
export function resultOf(c: Challenge, today: string, gymName: string): Result | null {
  if (c.state !== "ended" || c.cancelled) return null;
  if (c.teamBoard !== null && inTeams(c)) return teamResult(c, c.teamBoard, today, gymName);
  const { board, me, target } = c;
  const said = (n: number) => countText(n, c.words);
  let headline: string;
  if (board.status !== "shown") headline = numbersComing(c, today, gymName) ?? FEW;
  else if (target !== null) {
    const reached = board.reached ?? 0;
    headline = reached === 0 ? `Nobody reached ${said(target)}.` : `${people(reached)} reached ${said(target)}.`;
  } else {
    const first = board.top.filter((r) => r.place === 1);
    const names = first.map((r) => (r.isMe ? "You" : r.name));
    const withThat = `with ${said(first[0]?.value ?? 0)}`;
    if (board.leaders <= 1) headline = names[0] === "You" ? `You won, ${withThat}.` : `Winner: ${names[0] ?? ""}, ${withThat}.`;
    else {
      // The card names three at most; the rest who share first place are counted.
      const more = board.leaders - names.length;
      headline = `Joint winners: ${more > 0 ? `${names.join(", ")} and ${count(more)} more` : listed(names)}, ${withThat} each.`;
    }
  }
  let mine: string | null = null;
  if (me !== null) {
    if (target !== null) mine = me.reached ? `You reached it: ${said(me.value)}.` : `You got to ${printed(me.value, c.words)} of ${printed(target, c.words)}.`;
    else if (me.value === 0) mine = staffCount(c) ? "No number was added for you." : `You had no ${c.words.many} in it.`;
    else if (me.place !== null && me.hidden === null && me.place > 1) mine = `You finished ${ordinal(me.place)}, with ${said(me.value)}.`;
    else if (me.place === null || me.hidden !== null) mine = `You had ${said(me.value)}.`;
  }
  return { headline, mine };
}

export type DayState = "yes" | "no" | "open" | "ahead";
export interface DayCell {
  day: string;
  state: DayState;
}

/** The days to draw as flames, in weeks of seven, Monday first: a challenge of five weeks or less whole, a longer one as
 *  the week it is in. Null cells are outside it. */
export function dayMarks(c: Challenge, today: string): { weeks: (DayCell | null)[][]; whole: boolean } | null {
  const { me } = c;
  if (me === null || c.state === "coming" || c.cancelled || !c.words.perDay) return null;
  const counted = new Set(me.days);
  const first = dayNumber(c.startsOn);
  const last = dayNumber(c.endsOn);
  const now = dayNumber(today);
  const monday = (n: number) => n - ((new Date(n * 86_400_000).getUTCDay() + 6) % 7);
  const all = last - first + 1 <= 35;
  const at = Math.min(Math.max(now, first), last);
  const from = all ? monday(first) : monday(at);
  const to = all ? monday(last) + 6 : monday(at) + 6;
  const weeks: (DayCell | null)[][] = [];
  for (let start = from; start <= to; start += 7) {
    weeks.push(
      [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const n = start + i;
        if (n < first || n > last) return null;
        const day = dayAt(n);
        const state: DayState = counted.has(day) ? "yes" : n > now ? "ahead" : n === now ? "open" : "no";
        return { day, state };
      }),
    );
  }
  return { weeks, whole: all };
}

/** What a flame means, for a screen reader. */
export function markLabel(cell: DayCell, words: Words): string {
  const what: Record<DayState, string> = { yes: words.one, no: `no ${words.one}`, open: "today, not counted yet", ahead: "still to come" };
  return `${shortDay(cell.day)}: ${what[cell.state]}`;
}

export function leaveBox(c: Challenge) {
  return {
    title: `Leave ${c.name}?`,
    line: staffCount(c) ? "You come off its board. You can join again until it ends." : `You come off its board. Your ${c.words.many} stay yours, and you can join again until it ends.`,
  };
}

export function joinNote(c: Challenge): string | null {
  if (!c.can.join) return null;
  if (c.state === "coming") return `Join now and you’re in from ${shortDay(c.startsOn)}.`;
  if (staffCount(c)) return "Join, and the staff can add your number.";
  return `Your ${c.words.many} since ${shortDay(c.startsOn)} count as soon as you join.`;
}

export function teamsLine(c: Challenge, gymName: string): string | null {
  if (!inTeams(c)) return null;
  return c.teams === "staff" ? `In teams. The staff at ${gymName} put people in teams.` : "In teams. You pick your own team.";
}

const inTeam = (n: number) => (n === 0 ? "Nobody yet" : people(n));

export interface TeamLine {
  id: string;
  name: string;
  place: number | null;
  people: string;
  number: string | null;
  reached: boolean;
  isMine: boolean;
  label: string;
}

/** The teams as listed: the placed first, then the rest in the gym's order. No number or place while the board is not shown. */
export function teamRows(c: Challenge): TeamLine[] {
  const board = c.teamBoard;
  if (board === null || !inTeams(c)) return [];
  const shown = board.status === "shown";
  return board.rows
    .map((row, at): { row: TeamRow; at: number } => ({ row, at }))
    .sort((a, b) => Number(a.row.place === null) - Number(b.row.place === null) || (a.row.place ?? 0) - (b.row.place ?? 0) || a.at - b.at)
    .map(({ row }) => ({
      id: row.id,
      name: row.name,
      place: shown ? row.place : null,
      people: `${inTeam(row.people)}${row.waiting > 0 ? ` · waiting for ${row.waiting === 1 ? "1 number" : `${count(row.waiting)} numbers`}` : ""}`,
      number: shown ? countText(row.value, c.words) : null,
      reached: row.reached,
      isMine: row.isMine,
      label: `${row.name}${row.isMine ? ", your team" : ""}: ${shown && row.place !== null ? `${ordinal(row.place)}, ` : ""}${inTeam(row.people)}${shown ? `, ${countText(row.value, c.words)}` : ""}${row.reached ? ", reached the target" : ""}`,
    }));
}

export function teamRuleNote(c: Challenge): string | null {
  return inTeams(c) && !c.cancelled && c.lowestWins ? "A team gets its place once everyone in it has a number." : null;
}

/** What the member is told about their own team, or null with nothing to say. */
export function myTeamNote(c: Challenge, gymName: string): string | null {
  const board = c.teamBoard;
  if (board === null || !inTeams(c) || c.cancelled || c.state === "ended") return null;
  if (board.mine !== null) {
    if (board.mine.counted) return null;
    const { teamId } = board.mine;
    return `Your number isn’t added to ${board.rows.find((r) => r.id === teamId)?.name ?? "your team"}’s, because you aren’t shown on the boards.`;
  }
  if (c.can.pick) return c.me === null ? "Pick a team to join the challenge." : "Pick your team.";
  if (c.me !== null && c.teams === "staff") return `You’re not in a team yet. The staff at ${gymName} put people in teams.`;
  return null;
}

export interface MyTeam {
  name: string;
  people: { userId: string; name: string; initials: string; isMe: boolean; number: string | null }[];
  more: string | null;
  note: string | null;
}

/** The member's own team's people, or null with no team. */
export function myTeam(c: Challenge): MyTeam | null {
  const board = c.teamBoard;
  if (board === null || !inTeams(c) || c.cancelled || board.mine === null) return null;
  const { mine } = board;
  const team = board.rows.find((r) => r.id === mine.teamId);
  if (team === undefined) return null;
  const shown = board.status === "shown";
  return {
    name: team.name,
    people: mine.people.map((p) => ({ userId: p.userId, name: p.isMe ? "You" : p.name, initials: p.isMe ? "You" : p.initials, isMe: p.isMe, number: shown || p.isMe ? countText(p.value, c.words) : null })),
    more: mine.more > 0 ? `and ${count(mine.more)} more with a ${aNumber(c)}` : null,
    // Only while numbers are shown: until three people have one nobody is listed, and the page says why.
    note: shown && mine.people.length + mine.more < team.people ? `Teammates show here once they have a ${aNumber(c)}.` : null,
  };
}

export function pickBox(c: Challenge, teamName: string) {
  const moving = c.teamBoard?.mine != null;
  const joins = c.who === "joined" && !c.joined ? "This puts you in the challenge. " : "";
  const after = c.state === "coming" ? `You can change team until ${shortDay(c.startsOn)}, when the challenge starts.` : "The challenge has started, so you can’t change team after this.";
  return { title: moving ? `Move to ${teamName}?` : `Join ${teamName}?`, line: `${joins}${after}`, yes: moving ? `Move to ${teamName}` : `Join ${teamName}` };
}

/** The line a challenge's row in the list says about the member: their number and place, how it finished, or that they
 *  are not in it. Null with nothing of theirs to say. */
export function rowLine(c: Challenge, today: string, gymName: string, checkingIn: boolean): string | null {
  if (c.cancelled) return null;
  if (c.state === "ended") return resultOf(c, today, gymName)?.headline ?? null;
  if (c.me === null) return c.can.join || c.can.pick ? "Not joined yet" : null;
  if (c.state === "coming") return c.who === "joined" ? "You’re in." : null;
  if (notCountingNote(c, checkingIn, gymName) !== null) return "Not being counted yet";
  if (staffCount(c) && c.me.value === 0) return "No number yet";
  const mine = progress(c);
  if (mine === null) return null;
  const number = mine.of === null ? countText(mine.big, c.words) : `${printed(mine.big, c.words)} of ${countText(mine.of, c.words)}`;
  const where = c.me.place !== null && c.me.hidden === null && !inTeams(c) ? ` · ${ordinal(c.me.place)} of ${count(c.board.ranked)}` : "";
  return `${number}${where}`;
}

export interface ResultRow {
  key: string;
  place: number | null;
  placeText: string | null;
  name: string;
  mine: string | null;
  sub: string | null;
  number: string | null;
  reached: boolean;
  label: string;
}

/** A challenge's result as the post that announces it shows it: the same sentences as the Challenges page. */
export function resultPost(result: GymPostChallengeResult | null, gymName: string) {
  if (result === null) return null;
  const { challenge: c, today } = result;
  const said = resultOf(c, today, gymName);
  if (said === null) return null;
  let rows: ResultRow[] = [];
  if (inTeams(c)) {
    if (c.teamBoard?.status === "shown") {
      rows = teamRows(c).map((t) => ({ key: t.id, place: t.place, placeText: t.place === null ? null : ordinal(t.place), name: t.name, mine: t.isMine ? "Your team" : null, sub: t.people, number: t.number, reached: t.reached, label: t.label }));
    }
  } else {
    rows = c.board.top.map((r) => {
      const number = countText(r.value, c.words);
      const name = r.isMe ? "You" : r.name;
      return { key: r.userId, place: r.place, placeText: ordinal(r.place), name, mine: null, sub: null, number, reached: r.reached, label: `${ordinal(r.place)}: ${name}, ${number}${r.reached ? ", reached the target" : ""}` };
    });
  }
  return {
    challengeId: c.id,
    headline: said.headline,
    mine: said.mine,
    facts: `${howToWin(c)} · ${challengeDates(c, today)}`,
    rows,
    prize: c.prize === "" ? null : `Prize: ${c.prize}`,
    canOpen: result.canOpen,
  };
}
