// A test's challenge as the server sends it, in ONE place (ROADMAP 19d-iii-a-i). The tests
// still describe a challenge by the three kinds a gym could make before it (`counts`:
// gym_days · workout_days · own); this turns one into what is sent now: its kind as the list
// keeps it and the words it carries, made by the server's own `challengeWords`. The screens
// never see `counts`.
import { challengeWords } from '@app/shared';

const KINDS = {
  gym_days: { subject: 'gym_visits', measure: 'days', countedBy: 'app' },
  workout_days: { subject: 'workouts', measure: 'days', countedBy: 'app' },
  own: { subject: 'own', measure: null, countedBy: 'staff' },
};

/** `fixture` with its `counts` made into the list's kind and its words. `gymName`: the gym
 *  the words name ("Counted by the staff at …"). */
export function sentChallenge(fixture, gymName = 'Iron House') {
  const { counts, ...rest } = fixture;
  if (counts === undefined) return rest;
  // A subject already given (a form's fields sent back) wins over the default kind.
  const kind = rest.subject !== undefined ? { subject: rest.subject, measure: rest.measure ?? null, countedBy: rest.countedBy } : KINDS[counts];
  return { ...rest, ...kind, words: challengeWords({ ...kind, unit: rest.unit ?? '' }, gymName) };
}

/** The same, for a request body the console sends: the kind, no words. */
export const sentKind = (counts) => KINDS[counts];
