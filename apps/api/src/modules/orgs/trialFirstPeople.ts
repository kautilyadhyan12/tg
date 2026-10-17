// The trial belongs to the gym (ROADMAP Stage 3 item 2d; RULINGS 2026-09-08, layer 2, and
// Kd's 2026-10-16 plan). A free trial looks at the gym's people while it runs: the owner,
// always counted as one, and everybody who joins. When 11 of them came from one other gym that
// had its free trial first and never paid, the trial ends, unless the owner was staff or a
// member at that gym themselves (a trainer opening their own gym): then it goes on and Kd has a
// look. A count over the whole trial, not a share of the first 20, so that spare accounts
// joining first cannot crowd the old gym's people out (Kd, 2026-10-17, the passes' High-1).
// Each person is counted once, however their email is spelled. The database fetches the
// counts; this decides.

/** How many people from one gym end the trial. */
export const TRIAL_PEOPLE_FROM_ONE_GYM = 11;

/** One other gym some of the gym's people came from. */
export interface FirstPeopleSource {
  gymId: string;
  /** How many of the gym's people were in that gym's app before they joined this one. */
  came: number;
  /** The owner was staff there, or a member there before its free trial ended. */
  ownerWasThere: boolean;
}

export type TrialCheck = { kind: "none" } | { kind: "ended" | "look"; gymId: string };

export function decideTrialCheck(sources: readonly FirstPeopleSource[]): TrialCheck {
  // Every gym that 11 people came from is asked on its own (one person can have been in
  // two). One whose owner was never there ends the trial; ids sort so the answer never
  // depends on the order the rows came back in.
  const most = sources
    .filter((s) => s.came >= TRIAL_PEOPLE_FROM_ONE_GYM)
    .sort((a, b) => (a.gymId < b.gymId ? -1 : a.gymId > b.gymId ? 1 : 0));
  const ended = most.find((s) => !s.ownerWasThere);
  if (ended !== undefined) return { kind: "ended", gymId: ended.gymId };
  const look = most[0];
  return look === undefined ? { kind: "none" } : { kind: "look", gymId: look.gymId };
}
