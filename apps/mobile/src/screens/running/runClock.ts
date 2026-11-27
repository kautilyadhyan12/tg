// A phone whose clock is wrong (the running faults of 2026-11-20, A6). A point's time is the GPS's own, Go's is
// the phone's: with the phone's clock set by hand minutes fast, every point of those minutes came before Go and
// was dropped; minutes slow, the first point landed minutes into the run. Pure, so the rule is tested case by case.

/** A gap between the GPS's time and the phone's no bigger than this is the delay of a point on its way and the
 *  GPS's own second ahead, never a wrong clock: nothing changes. */
export const CLOCK_GAP_MS = 5_000;
/** Two deliveries agree on the gap when they are within this of each other. */
export const CLOCK_AGREE_MS = 2_000;
/** Two deliveries are told apart on the phone's clock by at least this (Android hands one over each second). */
export const CLOCK_APART_MS = 500;

/** A gap seen once, waiting for a second delivery to agree; `seenAt` on the phone's clock. */
export type ClockGuess = { gap: number; seenAt: number } | null;

/** The gap the newest point of a delivery shows (its GPS time less the phone's, now), judged against the guess
 *  before it. A small gap decides "no gap". A big one is decided only once a second delivery, apart on the phone's
 *  clock, shows the same: an old point Android kept from before Go (a fix from minutes ago, on a right clock)
 *  shows a big gap once, and the next fresh point shows none. Of two that agree, the bigger is kept: a point's
 *  delay on its way only ever makes the gap look smaller. */
export function judgeClock(guess: ClockGuess, gap: number, now: number): { decided: number } | { guess: ClockGuess } {
  if (Math.abs(gap) <= CLOCK_GAP_MS) return { decided: 0 };
  if (guess !== null && now - guess.seenAt < CLOCK_APART_MS) return { guess };
  if (guess !== null && Math.abs(gap - guess.gap) <= CLOCK_AGREE_MS) return { decided: Math.max(gap, guess.gap) };
  return { guess: { gap, seenAt: now } };
}
