// `GET /v1/orgs/:gymId/overview` as a fixture, in ONE place.
//
// **FIVE SUITES RENDER THE OVERVIEW SCREEN** — its own, the gym switcher, the
// plan prompt, the read-only console and the trial — and every one of them now
// issues this read whether or not the numbers are its subject. Four copies of a
// payload is four places for the shape to drift from the contract, and only one
// of them would be the file somebody remembers to update.
//
// **THE DEFAULT IS QUIET AND THAT IS THE TRUTHFUL DEFAULT rather than a
// convenience.** Those suites build a gym whose only seat is the owner's
// COMPLIMENTARY one, and `month.members` counts current NON-complimentary
// members — so 0 is what the server would answer — with no attendance anywhere.
// The numbers zone therefore draws nothing at all (Part 3 §4.1's "0 members
// ever" edge), which is the screen every one of those suites was written
// against.
//
// **THE EIGHT BUCKETS ARE ALWAYS PRESENT, INCLUDING THE EMPTY ONES.** The server
// GENERATES the weekly series and joins counts onto it, so a week nobody came to
// draws a zero bar rather than vanishing and shifting every other bar left. A
// fixture that omitted them would be exercising a payload the server cannot
// send.
export const WEEK_STARTS = [
  '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03',
  '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31',
];

export const overview = ({ today, week, month, weeks, timezone } = {}) => ({
  data: {
    overview: {
      timezone: timezone ?? 'America/Chicago',
      today: '2026-09-02',
      tiles: {
        today: { visits: 0, visitors: 0, ...today },
        week: { visits: 0, visitors: 0, prevVisits: 0, prevVisitors: 0, ...week },
        month: { visitors: 0, members: 0, adoptionPct: null, ...month },
      },
      weeks: weeks ?? WEEK_STARTS.map((weekStart) => ({ weekStart, visits: 0, visitors: 0 })),
    },
  },
});
