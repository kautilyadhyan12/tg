// WHAT A CHALLENGE CAN BE ABOUT (spec Part 3 §15.10.1; ROADMAP 19d-iii). This file is the
// whole list: nothing else names a subject. When the app comes to track something new, one
// subject or one measure is added here and one counter on the server
// (`apps/api/src/modules/orgs/challenges/counters.ts`); the form, the board, teams and the
// posted result are not touched.
//
// Every challenge is sent with its own words (`challengeWords`), and a screen prints them:
// it never looks a subject up in a list of its own, so a subject added next year shows
// correctly in this year's app.
import { exerciseNameOf } from "./exerciseCatalog.js";

/** Who counts a challenge: the app, from what it measured itself; or the gym's staff, who
 *  type each person's number. */
export const CHALLENGE_COUNTED_BY = ["app", "staff"] as const;
export type ChallengeCountedBy = (typeof CHALLENGE_COUNTED_BY)[number];

/** How a number is counted, said wherever it is shown. */
export const CHALLENGE_COUNTED_HOW = ["desk", "app", "camera", "gps", "staff"] as const;
export type ChallengeCountedHow = (typeof CHALLENGE_COUNTED_HOW)[number];

/** How a number is printed: whole (reps, days), a time kept in seconds, a distance kept in
 *  metres and printed in km. */
export const CHALLENGE_PRINTS = ["whole", "time", "km"] as const;
export type ChallengePrint = (typeof CHALLENGE_PRINTS)[number];

/** How a challenge is won: the most, a target everybody who reaches it wins, the fewest. */
export const CHALLENGE_WINS = ["most", "target", "lowest"] as const;
export type ChallengeWin = (typeof CHALLENGE_WINS)[number];

/** A subject's or a measure's id: small letters and underscores. It never changes and is
 *  never used again for something else. */
export const CHALLENGE_ID_PATTERN = /^[a-z][a-z_]{0,39}$/u;

/** A number the APP works out for a subject. */
export interface ChallengeMeasure {
  id: string;
  /** The word after a number: "1 visit", "3 visits". */
  one: string;
  many: string;
  print: ChallengePrint;
  how: Exclude<ChallengeCountedHow, "staff">;
  wins: readonly ChallengeWin[];
  /** One a day is the most, so a target cannot pass the challenge's days. The database's
   *  target check (`0118`) knows such a measure by its id, `days`: the two agree
   *  (`challengeSubjects.test.ts`). */
  perDay: boolean;
  /** What a member is told counts. */
  explain: (gymName: string) => string;
}

export interface ChallengeSubject {
  id: string;
  /** What the challenge is about, as the form and the challenge's page say it. */
  title: string;
  /** The form's one line under it, with the gym's word for one of its people. */
  hint: (person: string) => string;
  /** The gym picks one exercise from the library (`gym_challenge_exercises`). */
  pickExercise: boolean;
  /** Where the staff count it, the word their form starts with ("visits"); empty: the gym
   *  types its own, or, for an exercise, the exercise's name is it. */
  staffWord: string;
  /** "Everyone in the app" may be in it: members are already told their gym sees the thing
   *  (§15.10.5). Otherwise only people who join. */
  everyone: boolean;
  /** The numbers the app can count; none: only staff can count it. */
  measures: readonly ChallengeMeasure[];
}

const SAME = "It is the same count as the Leaderboard.";

export const CHALLENGE_SUBJECTS: readonly ChallengeSubject[] = [
  {
    id: "gym_visits",
    title: "Visits",
    hint: (person) => `Days a ${person} is checked in, at your front desk or by your staff.`,
    pickExercise: false,
    staffWord: "visits",
    everyone: true,
    measures: [
      {
        id: "days",
        one: "visit",
        many: "visits",
        print: "whole",
        how: "desk",
        wins: ["most", "target"],
        perDay: true,
        explain: (gym) => `A visit is a day you're checked in at ${gym}: a scan at the front desk, or a check-in by staff. Two check-ins on one day are one visit. ${SAME}`,
      },
    ],
  },
  {
    id: "workouts",
    title: "Workouts in the app",
    hint: (person) => `Days a ${person} finishes a workout in the app.`,
    pickExercise: false,
    staffWord: "workouts",
    everyone: true,
    measures: [
      {
        id: "days",
        one: "workout day",
        many: "workout days",
        print: "whole",
        how: "app",
        wins: ["most", "target"],
        perDay: true,
        explain: () => `A workout day is a day you finish a workout in the app, wherever you are. Two on one day are one. ${SAME}`,
      },
    ],
  },
  // Nothing the app counts yet: the camera's count comes with 19d-iii-b.
  {
    id: "exercise",
    title: "An exercise",
    hint: () => "One exercise from the app's library, such as squats.",
    pickExercise: true,
    staffWord: "",
    everyone: true,
    measures: [],
  },
  {
    id: "own",
    title: "Something else",
    hint: () => "Anything the app doesn't track: a rowing time, a tug of war. You name it.",
    pickExercise: false,
    staffWord: "",
    everyone: true,
    measures: [],
  },
];

export const challengeSubject = (id: string): ChallengeSubject | undefined => CHALLENGE_SUBJECTS.find((subject) => subject.id === id);

export const challengeMeasure = (subject: string, measure: string | null): ChallengeMeasure | undefined =>
  measure === null ? undefined : challengeSubject(subject)?.measures.find((m) => m.id === measure);

/** What a challenge is about and who counts it, as it is kept. */
export interface ChallengeKind {
  subject: string;
  /** Null where the staff count. */
  measure: string | null;
  countedBy: ChallengeCountedBy;
}

/** Whether a kind is one the list allows: the app counts only a measure the list has for
 *  the subject; the staff can count any subject on the list, with no measure. */
export function kindOnTheList(kind: ChallengeKind): boolean {
  const subject = challengeSubject(kind.subject);
  if (subject === undefined) return false;
  if (kind.countedBy === "staff") return kind.measure === null;
  return challengeMeasure(kind.subject, kind.measure) !== undefined;
}

/** The ways a kind may be won: what the measure allows; anything where the staff count. */
export function kindWins(kind: ChallengeKind): readonly ChallengeWin[] {
  if (kind.countedBy === "staff") return CHALLENGE_WINS;
  return challengeMeasure(kind.subject, kind.measure)?.wins ?? [];
}

/** One a day is the most: a target cannot pass the challenge's days. */
export const kindPerDay = (kind: ChallengeKind): boolean => kind.countedBy === "app" && challengeMeasure(kind.subject, kind.measure)?.perDay === true;

/** The gym's own word after the number 1: "push-ups" → "push-up", "boxes" → "box". Only a
 *  word whose ending is an English plural's is touched; anything else is printed as typed
 *  ("kg lifted", "5 km time", "abs"). */
export function oneOf(unit: string): string {
  if (/(?:ch|sh|x|ss)es$/iu.test(unit)) return unit.slice(0, -2);
  // Left as typed: "press", "bonus", "tennis", "series", and a word as short as "abs".
  if (/(?:ss|us|is|series|species)$/iu.test(unit) || !/[a-z]s$/iu.test(unit) || unit.length <= 3) return unit;
  return unit.slice(0, -1);
}

const capital = (text: string): string => (text === "" ? text : text.charAt(0).toUpperCase() + text.slice(1));

const HOW_LINE: Record<Exclude<ChallengeCountedHow, "staff">, string> = {
  desk: "Checked in at the front desk",
  app: "Counted by the app",
  camera: "Counted by the camera",
  gps: "Measured by GPS",
};

/** The words a challenge is sent with, so that a screen prints them and never looks its
 *  subject up. */
export interface ChallengeWords {
  /** What it is about: "Visits", or the gym's own word: "Push-ups". */
  about: string;
  /** The word after a number. */
  one: string;
  many: string;
  print: ChallengePrint;
  how: ChallengeCountedHow;
  /** "Checked in at the front desk", "Counted by the staff at Iron Gym". */
  howLine: string;
  /** What a member is told counts. */
  explain: string;
  /** One a day is the most: the member's counted days are drawn. */
  perDay: boolean;
}

/** What a challenge is about; for one about an exercise, the exercise's name: "Squats". */
const aboutOf = (subject: ChallengeSubject | undefined, exercises: readonly string[]): string | null => {
  if (subject?.pickExercise !== true) return subject?.title ?? null;
  const names = exercises.map((slug) => exerciseNameOf(slug));
  return names.length === 0 || names.some((name) => name === null) ? subject.title : names.join(", ");
};

/** A challenge's words. `unit`: the gym's own word, where its staff count. `exercises`: the
 *  library's exercises it is about, by slug. */
export function challengeWords(kind: ChallengeKind & { unit: string; exercises?: readonly string[] }, gymName: string): ChallengeWords {
  const unit = kind.unit.trim();
  const exercises = kind.exercises ?? [];
  const measure = kind.countedBy === "app" ? challengeMeasure(kind.subject, kind.measure) : undefined;
  if (measure !== undefined) {
    return {
      about: aboutOf(challengeSubject(kind.subject), exercises) ?? capital(measure.many),
      one: measure.one,
      many: measure.many,
      print: measure.print,
      how: measure.how,
      howLine: HOW_LINE[measure.how],
      explain: measure.explain(gymName),
      perDay: measure.perDay,
    };
  }
  const subject = challengeSubject(kind.subject);
  // An app count of a kind no longer on the list counts nothing (`counters.ts`): it says so,
  // and is never said as the staff's or as something else.
  if (kind.countedBy === "app") {
    return {
      about: aboutOf(subject, exercises) ?? "Challenge",
      one: "point",
      many: "points",
      print: "whole",
      how: "app",
      howLine: "Not counted yet",
      explain: `This challenge isn't being counted yet. Ask the staff at ${gymName} about it.`,
      perDay: false,
    };
  }
  // The staff count it, in the gym's own word.
  const word = unit === "" ? "points" : unit;
  return {
    about: subject === undefined || subject.id === "own" ? capital(word) : (aboutOf(subject, exercises) ?? capital(word)),
    one: oneOf(word),
    many: word,
    print: "whole",
    how: "staff",
    howLine: `Counted by the staff at ${gymName}`,
    explain: `The staff at ${gymName} count the ${word} and add each person's number. If yours is missing or wrong, ask at the front desk.`,
    perDay: false,
  };
}

/** The list as a gym's form is offered it, in the gym's word for one of its people: each
 *  subject with what the app can count for it. */
export function offeredSubjects(person: string) {
  return CHALLENGE_SUBJECTS.map((subject) => ({
    id: subject.id,
    title: subject.title,
    hint: subject.hint(person),
    pickExercise: subject.pickExercise,
    everyone: subject.everyone,
    staffWord: subject.staffWord,
    appCounts: subject.measures.map((m) => ({ measure: m.id, one: m.one, many: m.many, howLine: HOW_LINE[m.how] })),
  }));
}

/** Whether the app can count an exercise of the library for a challenge: the list has a
 *  measure for an exercise, and the camera has a live definition of this one. */
export function appCountsExercise(liveDefinition: boolean): boolean {
  return liveDefinition && CHALLENGE_SUBJECTS.some((subject) => subject.pickExercise && subject.measures.length > 0);
}
