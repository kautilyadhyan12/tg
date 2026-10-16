// The trial belongs to the gym (ROADMAP Stage 3 item 2d; RULINGS 2026-09-08, layer 2, and
// Kd's 2026-10-16 plan). A free trial looks at the gym's first people: the owner, always
// counted as one, and the first others to join. When more than half of them came from one
// other gym that had its free trial first and never paid, the trial ends, unless the owner
// was staff or a member at that gym themselves (a trainer opening their own gym): then it
// goes on and Kd has a look. The database fetches the counts; this decides.

/** How many of a gym's first people are looked at, the owner included. */
export const TRIAL_FIRST_PEOPLE = 20;
/** More than half of them. */
export const TRIAL_FIRST_PEOPLE_FROM_ONE_GYM = Math.floor(TRIAL_FIRST_PEOPLE / 2) + 1;

/** One other gym some of the first people came from. */
export interface FirstPeopleSource {
  gymId: string;
  /** How many of the first people were in that gym's app before they joined this one. */
  came: number;
  /** The owner was staff there, or a member there before its free trial ended. */
  ownerWasThere: boolean;
}

export type TrialCheck = { kind: "none" } | { kind: "ended" | "look"; gymId: string };

export function decideTrialCheck(sources: readonly FirstPeopleSource[]): TrialCheck {
  // Every gym that most of the first people came from is asked on its own (one person can
  // have been in two). One whose owner was never there ends the trial; ids sort so the answer
  // never depends on the order the rows came back in.
  const most = sources
    .filter((s) => s.came >= TRIAL_FIRST_PEOPLE_FROM_ONE_GYM)
    .sort((a, b) => (a.gymId < b.gymId ? -1 : a.gymId > b.gymId ? 1 : 0));
  const ended = most.find((s) => !s.ownerWasThere);
  if (ended !== undefined) return { kind: "ended", gymId: ended.gymId };
  const look = most[0];
  return look === undefined ? { kind: "none" } : { kind: "look", gymId: look.gymId };
}
