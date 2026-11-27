import { describe, expect, it } from "vitest";
import { CLOCK_AGREE_MS, CLOCK_APART_MS, CLOCK_GAP_MS, judgeClock, type ClockGuess } from "../src/screens/running/runClock";

// A phone whose clock is wrong (the running faults of 2026-11-20, A6). Every class of case: a right clock with
// its point's delay, the GPS's second ahead, a clock set minutes fast or slow, an old point Android kept from
// before Go, a batch handed over at once, two deliveries in the same instant, the edges of each limit.
const MIN = 60_000;
type Row = [string, ClockGuess, number, number, { decided: number } | { guess: ClockGuess }];
const rows: Row[] = [
  ["a right clock, a fresh point", null, -300, 10_000, { decided: 0 }],
  ["the GPS a second ahead of the phone", null, 1_000, 10_000, { decided: 0 }],
  ["a point 4 s on its way", null, -4_000, 10_000, { decided: 0 }],
  ["exactly the limit, behind", null, -CLOCK_GAP_MS, 10_000, { decided: 0 }],
  ["exactly the limit, ahead", null, CLOCK_GAP_MS, 10_000, { decided: 0 }],
  ["just past the limit, seen once: waits", null, CLOCK_GAP_MS + 1, 10_000, { guess: { gap: CLOCK_GAP_MS + 1, seenAt: 10_000 } }],
  ["phone 5 min fast, seen once: waits", null, -5 * MIN, 10_000, { guess: { gap: -5 * MIN, seenAt: 10_000 } }],
  ["phone 5 min fast, seen again a second later: decided, the bigger kept", { gap: -5 * MIN - 400, seenAt: 10_000 }, -5 * MIN - 100, 11_000, { decided: -5 * MIN - 100 }],
  ["phone 5 min slow, seen again: decided", { gap: 5 * MIN, seenAt: 10_000 }, 5 * MIN - 300, 11_000, { decided: 5 * MIN }],
  ["an old point from before Go, then a fresh one: no gap", { gap: -4 * MIN, seenAt: 10_000 }, -200, 11_000, { decided: 0 }],
  ["an old point, then another older still: the newer guess waits", { gap: -4 * MIN, seenAt: 10_000 }, -9 * MIN, 11_000, { guess: { gap: -9 * MIN, seenAt: 11_000 } }],
  ["two deliveries in the same instant never agree: the first guess waits", { gap: -5 * MIN, seenAt: 10_000 }, -5 * MIN, 10_000 + CLOCK_APART_MS - 1, { guess: { gap: -5 * MIN, seenAt: 10_000 } }],
  ["apart by exactly the least: they agree", { gap: -5 * MIN, seenAt: 10_000 }, -5 * MIN, 10_000 + CLOCK_APART_MS, { decided: -5 * MIN }],
  ["agree by exactly the limit", { gap: -5 * MIN, seenAt: 10_000 }, -5 * MIN + CLOCK_AGREE_MS, 11_000, { decided: -5 * MIN + CLOCK_AGREE_MS }],
  ["disagree by just past it: a new guess", { gap: -5 * MIN, seenAt: 10_000 }, -5 * MIN + CLOCK_AGREE_MS + 1, 11_000, { guess: { gap: -5 * MIN + CLOCK_AGREE_MS + 1, seenAt: 11_000 } }],
  ["a test's batch of five minutes handed over at once, then the next: never agree", { gap: 300_000, seenAt: 10_000 }, 600_000, 10_700, { guess: { gap: 600_000, seenAt: 10_700 } }],
];

describe("judgeClock: the gap between the GPS's clock and the phone's (A6)", () => {
  it.each(rows)("%s", (_name, guess, gap, now, expected) => {
    expect(judgeClock(guess, gap, now)).toEqual(expected);
  });
});
