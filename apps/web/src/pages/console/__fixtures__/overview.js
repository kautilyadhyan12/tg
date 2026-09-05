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

/** `GET /v1/orgs/:gymId/attendance` — the day the Overview previews under its
 *  numbers, added 2026-09-03 with the names.
 *
 *  **EMPTY BY DEFAULT for the same reason the overview above is quiet:** the
 *  suites that merely RENDER this screen have no attendance, so the preview
 *  draws nothing and they see the screen they were written against.
 *
 *  **`totals` IS NOT DERIVED FROM `people`, HERE OR ANYWHERE.** They are set
 *  independently on purpose — a fixture whose totals always agree with its page
 *  cannot catch a screen that counts the page (:27992 §3, and :29250 §3's
 *  fixture, which hands the Attendance screen 300 people beside a page of two). */
export const attendanceDay = ({ totals, summary, people, nextCursor, timezone, clockFormat } = {}) => ({
  data: {
    attendance: {
      day: '2026-09-02',
      timezone: timezone ?? 'America/Chicago',
      clockFormat: clockFormat ?? '24h',
      totals: { visits: 0, people: 0, ...totals },
      summary: summary ?? [],
      people: people ?? [],
      nextCursor: nextCursor ?? null,
    },
  },
});

/** One person and the times they came, in the shape the wire uses. `markedAt`
 *  is an INSTANT and the zone comes off the day above it, because every time on
 *  this screen is the GYM's (trap #8). */
export const attendee = (userId, displayName, visits) => ({
  userId,
  displayName,
  visits: visits.map(([markedAt, hoursStatus = 'in_session']) => ({
    markedAt,
    hoursStatus,
    method: 'manual',
  })),
});

/** ONE MEMBER WHO KEEPS TURNING UP, in the shape `orgRegularSchema` pins.
 *
 *  **THE TWO STREAK FIGURES DEFAULT TO DIFFERENT NUMBERS, DELIBERATELY.** Kd
 *  ruled both units and they answer different questions, so a fixture where they
 *  move together cannot see a sentence built from the wrong field — which is how
 *  C155 passed under its own mutant on this screen one card ago (:30399 §6).
 *  Every caller may override either, and the ones that matter do.
 *
 *  `cheerableAt` is null by default: the window is OPEN, so the button is live
 *  and a test about the dead states has to say so explicitly. */
export const regular = ({ userId, displayName, weeksRunning, daysRunning, visits, cheerableAt } = {}) => ({
  userId: userId ?? 'r1',
  displayName: displayName ?? 'Priya Nair',
  weeksRunning: weeksRunning ?? 5,
  daysRunning: daysRunning ?? 3,
  visits: visits ?? 11,
  cheerableAt: cheerableAt ?? null,
});

export const overview = ({ today, week, month, weeks, timezone, onARoll } = {}) => ({
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
      // EMPTY BY DEFAULT, like everything else in this fixture and for the same
      // reason: a gym with no attendance has nobody on a run, so the five suites
      // that merely RENDER this screen keep seeing the screen they were written
      // against. It is also what an api older than this bundle sends — the
      // shared schema's `.default([])` — so the quiet case is the true one twice
      // over.
      onARoll: onARoll ?? [],
    },
  },
});
