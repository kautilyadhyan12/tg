/** The delivered-frames-per-second meter.
 *
 *  This is the number Part 6 §3.6's ladder will step down on, so the assertions
 *  that matter are not "does it divide correctly" — they are the two ways a
 *  meter lies to whatever reads it: answering a NUMBER when it has no evidence,
 *  and answering a rate for a stretch of time in which no frames arrived.
 *  Either one steps a healthy phone down to hand counting.
 */
import { describe, it, expect } from 'vitest';
import { PoseThroughput, DEFAULT_WINDOW_MS, MIN_SPAN_MS } from './poseThroughput.js';

/** Feed `n` frames every `dtMs`, starting at `t0`. Returns the last timestamp. */
function feed(meter, { n, dtMs, t0 = 0 }) {
  let t = t0;
  for (let i = 0; i < n; i += 1) {
    meter.push(t);
    if (i < n - 1) t += dtMs;
  }
  return t;
}

describe('PoseThroughput — refusing to answer', () => {
  it('says NULL, never zero, before any frame', () => {
    // The distinction the ladder depends on: "nothing is arriving" and "I have
    // not looked yet" are different, and `Number(null) === 0` is how the second
    // silently becomes the first (:6749).
    expect(new PoseThroughput().hz(0)).toBe(null);
  });

  it('says NULL on a single frame — one timestamp is not a rate', () => {
    const m = new PoseThroughput();
    m.push(0);
    expect(m.hz(0)).toBe(null);
  });

  it('says NULL for two frames 1 ms apart, rather than 1000 Hz', () => {
    // Arithmetically 1000 fps and obviously not a throughput. Without the span
    // floor this is what the meter reports in the first moments of a workout.
    const m = new PoseThroughput();
    m.push(0);
    m.push(1);
    expect(m.hz(1)).toBe(null);
  });

  it('answers on ONE side of the span floor and not the other', () => {
    // The positive control for all three above — they must be satisfied by a
    // meter that has begun working, not by one that never answers — and the
    // boundary itself, from both sides.
    //
    // 100 ms steps deliberately: the first draft used `MIN_SPAN_MS / 15`, and
    // fifteen additions of 66.666… accumulate to a hair UNDER 1000, so the test
    // failed while the code was right. Powers-of-ten steps are exact in binary
    // floating point, so the boundary here is the code's, not the fixture's
    // (:4855 — a test is a claim and the fixture is part of the claim).
    const step = 100;
    const justUnder = new PoseThroughput();
    const shortLast = feed(justUnder, { n: MIN_SPAN_MS / step, dtMs: step });  // 900 ms
    expect(justUnder.hz(shortLast)).toBe(null);

    const atTheFloor = new PoseThroughput();
    const floorLast = feed(atTheFloor, { n: MIN_SPAN_MS / step + 1, dtMs: step });  // 1000 ms
    expect(atTheFloor.hz(floorLast)).toBeCloseTo(1000 / step, 5);
  });
});

describe('PoseThroughput — the rate itself', () => {
  it('reports ~15 Hz for frames arriving every 67 ms (the app\'s own target)', () => {
    // FEED_INTERVAL_MS is 67, so a machine keeping up reads just under 15 and
    // must NOT read below the ladder's threshold by rounding alone.
    const m = new PoseThroughput();
    const last = feed(m, { n: 40, dtMs: 67 });
    expect(m.hz(last)).toBeCloseTo(1000 / 67, 5);
  });

  it('reports the ~11 fps Kd actually measured, not a rounded 15', () => {
    // His five clips landed at 7.2–12.5 fps against the 15 target (:6386). A
    // meter that could not distinguish those from a healthy machine would be
    // useless for the decision it exists to inform.
    const m = new PoseThroughput();
    const last = feed(m, { n: 40, dtMs: 90 });
    expect(m.hz(last)).toBeCloseTo(1000 / 90, 5);
    expect(m.hz(last)).toBeLessThan(15);
  });

  it('divides by the SPAN OF THE FRAMES, not by the window length', () => {
    // THE ONE WITH TEETH. A window of 3000 ms holding only 1200 ms of frames
    // must not report `frames / 3 s` — that is a third of the truth, and it
    // would step down a phone that is keeping up. Measured against a naive
    // count/window, which would give ~5 here instead of ~15.
    const m = new PoseThroughput({ windowMs: 3000 });
    const last = feed(m, { n: 19, dtMs: 67 });   // 18 gaps = 1206 ms of frames
    expect(m.hz(last)).toBeCloseTo(1000 / 67, 5);
    expect(m.hz(last)).toBeGreaterThan(10);      // count/window would be ~6.3
  });
});

describe('PoseThroughput — the window', () => {
  it('forgets frames older than the window, so a rate follows a SLOWDOWN down', () => {
    // The failure this prevents is the ladder never firing: 20 seconds of
    // healthy frames followed by a collapse must read as the collapse.
    const m = new PoseThroughput({ windowMs: 3000 });
    const last = feed(m, { n: 100, dtMs: 30 });         // ~33 Hz, healthy
    expect(m.hz(last)).toBeGreaterThan(30);

    const slowLast = feed(m, { n: 15, dtMs: 250, t0: last + 250 });   // 4 Hz
    expect(m.hz(slowLast)).toBeLessThan(6);
  });

  it('does not average across a GAP once the gap outruns the window', () => {
    // A paused set, a hidden tab, or a set that simply ended. Frames stop, then
    // resume healthy. The meter must report the healthy rate, not a stall it
    // computed from a gap nobody was watching.
    const m = new PoseThroughput({ windowMs: 3000 });
    feed(m, { n: 30, dtMs: 67 });
    const last = feed(m, { n: 30, dtMs: 67, t0: 120_000 });   // two minutes later
    expect(m.hz(last)).toBeCloseTo(1000 / 67, 5);
  });

  it('reset() empties it, so a resumed set is not averaged with the one before', () => {
    const m = new PoseThroughput();
    const last = feed(m, { n: 40, dtMs: 67 });
    expect(m.hz(last)).not.toBe(null);
    m.reset();
    expect(m.hz(last)).toBe(null);
    expect(m.frames).toBe(0);
  });
});

describe('PoseThroughput — a reading EXPIRES', () => {
  // THE DEFECT THIS PAIR EXISTS FOR (2026-08-17, T3 round 1 C/H-1). The window
  // was trimmed only by `push`, so with the camera stopped nothing ever left it
  // and the meter answered its last rate for ever — measured at 5½ minutes after
  // the final frame, still reading "14.9 of 14.9/s" on a screen whose camera was
  // dead. Every one of the tests above stayed green through it, because every
  // one of them read the meter at the instant the last frame arrived.

  it('goes BLANK once the frames stop, instead of holding the last rate', () => {
    const m = new PoseThroughput({ windowMs: 3000 });
    const last = feed(m, { n: 60, dtMs: 67 });          // the app at its ceiling
    expect(m.hz(last)).toBeCloseTo(1000 / 67, 5);       // control: it does answer

    // The camera stops. No `push`, no `reset` — nothing tells the meter,
    // because in the real failure there IS nothing to tell it: a pause is
    // cleared only by the resume that ends it, and a dead camera never resumes.
    expect(m.hz(last + 3001)).toBe(null);               // one window of silence
    expect(m.hz(last + 330_000)).toBe(null);            // 5½ minutes of silence
  });

  it('still answers between frames, so the expiry cannot just blank everything', () => {
    // The other half of the claim, and the reason the test above cannot be
    // satisfied by a meter that always says null: a reading taken in the normal
    // gap between two frames — which is every reading the screen ever takes —
    // must still be a number.
    const m = new PoseThroughput({ windowMs: 3000 });
    const last = feed(m, { n: 60, dtMs: 67 });
    const atLastFrame = m.hz(last);
    const oneGapLater = m.hz(last + 67);
    expect(oneGapLater).not.toBe(null);
    expect(oneGapLater, 'a full-speed camera still reads as a full-speed camera')
      .toBeGreaterThan(14);
    // AND IT IS NOT PINNED AT THE IDEAL FIGURE, which is what this assertion
    // used to do (`toBeCloseTo(1000 / 67, 1)`, round 2 C/H-1). Read one gap after
    // the last frame, 67 ms of the window is silence, and a reading that ignores
    // that is the defect itself — under it these two numbers were IDENTICAL.
    expect(oneGapLater, 'a gap since the last frame must cost something')
      .toBeLessThan(atLastFrame);
    expect(m.hz(last + 500)).not.toBe(null);
  });

  it('DECAYS as the silence grows, instead of holding the last rate until it blanks', () => {
    // THE DEFECT THIS EXISTS FOR (2026-08-17, T3 round 2 C/H-1). Round 1 made
    // the reading expire, but the span it divided by ran from the first
    // surviving frame to the LAST FRAME — so a gap at the END was invisible, and
    // the row printed the full 14.9 at 1,990 ms of silence when 5.3 was the
    // truth. The same lie as round 1's, two seconds long instead of five
    // minutes, and the tests above could not see it: one reads at the last
    // frame, the other at a single point 500 ms later.
    //
    // THE TRUTH IS COMPUTED BY COUNTING THE FIXTURE'S OWN TIMESTAMPS in the
    // trailing window, never by calling the thing under test — a test whose
    // inputs and its subject share a source proves only that the source is
    // self-consistent (:3610).
    const m = new PoseThroughput({ windowMs: 3000 });
    const stamps = [];
    for (let i = 0; i < 60; i += 1) stamps.push(i * 67);
    stamps.forEach((t) => m.push(t));
    const last = stamps[stamps.length - 1];
    const trailingRate = (now) =>
      stamps.filter((t) => t > now - 3000 && t <= now).length / 3;

    let previous = Infinity;
    for (const idle of [500, 1000, 1500, 1990]) {
      const reading = m.hz(last + idle);
      expect(reading, `${idle} ms of silence must still read as a number`).not.toBe(null);
      expect(reading, `${idle} ms of silence must read LOWER than the moment before`)
        .toBeLessThan(previous);
      expect(reading, `${idle} ms of silence must read close to what really arrived`)
        .toBeCloseTo(trailingRate(last + idle), 0);
      previous = reading;
    }
  });

  it('blanks when the window runs out of frames, not two seconds early', () => {
    // The coverage gap that let the defect above sit for a whole round: the
    // blank was pinned at +500 ms (answers) and +3001 ms (blank), so ANY
    // blanking point between them passed, and the real one was at 2,000 ms.
    const m = new PoseThroughput({ windowMs: 3000 });
    const last = feed(m, { n: 60, dtMs: 67 });
    // Two frames are still inside the trailing window: a real, tiny rate, and
    // saying so is the honest end of the decay above.
    expect(m.hz(last + 2900)).not.toBe(null);
    // Only the final frame remains, and one frame is not a rate.
    expect(m.hz(last + 2950)).toBe(null);
  });

  it('says NULL when the caller passes no clock, rather than the last rate', () => {
    // A missing clock must not fall back to "the newest frame's own time" —
    // that is the old behaviour, restored silently at any caller that forgot.
    const m = new PoseThroughput();
    feed(m, { n: 60, dtMs: 67 });
    expect(m.hz()).toBe(null);
    expect(m.hz(Number.NaN)).toBe(null);
  });

  it('says NULL when the clock runs backwards, rather than a rate above the ceiling', () => {
    // `push` refuses an out-of-order timestamp and says why; a meter that
    // refuses out-of-order INPUT while accepting an out-of-order READ is only
    // half-guarded. Unreachable from today's only caller (`performance.now()`
    // is monotonic), so this pins a guard rather than a defect — but the number
    // it prevents is the one shape that makes the row self-contradicting: MORE
    // frames than the span it claims to have measured them over.
    const m = new PoseThroughput({ windowMs: 3000 });
    const last = feed(m, { n: 60, dtMs: 67 });
    expect(m.hz(last)).not.toBe(null);          // control: it does answer
    expect(m.hz(last - 1000)).toBe(null);       // without the guard: 19.98/s
  });
});

describe('PoseThroughput — inputs that should not move it', () => {
  it('drops a repeated timestamp rather than counting it as a frame', () => {
    const m = new PoseThroughput();
    const last = feed(m, { n: 31, dtMs: 100 });         // 30 gaps over 3000 ms
    const before = m.hz(last);
    for (let i = 0; i < 20; i += 1) m.push(3000);       // same instant, 20 times
    expect(m.hz(last)).toBe(before);
  });

  it('drops an OUT-OF-ORDER timestamp rather than reversing the span', () => {
    // :7974's shape — a timestamp that moves the span backwards produced a
    // watched time longer than the set it sat in. Here it would produce a
    // negative or wildly inflated rate.
    const m = new PoseThroughput();
    const last = feed(m, { n: 31, dtMs: 100 });
    const before = m.hz(last);
    m.push(500);                                        // long past
    expect(m.hz(last)).toBe(before);
  });

  it('ignores NaN rather than poisoning every later reading', () => {
    const m = new PoseThroughput();
    const last = feed(m, { n: 31, dtMs: 100 });
    m.push(Number.NaN);
    expect(m.hz(last)).toBeCloseTo(10, 5);
    expect(Number.isFinite(m.hz(last))).toBe(true);
  });
});

describe('PoseThroughput — the constants are the ones the ladder will read', () => {
  it('averages over less than §3.6\'s 10-second trigger', () => {
    // The ladder must be able to watch ten seconds OF this rate. If the window
    // were 10 s or longer, "below 15 Hz for 10 s" could not be observed without
    // the trigger and the average being the same measurement.
    expect(DEFAULT_WINDOW_MS).toBeLessThan(10_000);
  });

  it('pins the span floor itself, which its own boundary test cannot', () => {
    // THE HOLE THIS CLOSES (T3 round 3, L-4). The boundary test above feeds
    // `MIN_SPAN_MS / step` frames, so its 900 ms / 1000 ms pair MOVES WITH the
    // constant: set MIN_SPAN_MS to 100 and the fixture shrinks with it, leaving
    // every test in this file green. The TRAP is pinned there (delete the floor
    // and two tests go red); only the VALUE was pinned by nothing.
    //
    // :3610's lesson, three describe-blocks above its own quotation in the
    // DECAY test — a test whose inputs and its subject share a source proves
    // only that the source is self-consistent.
    expect(MIN_SPAN_MS).toBe(1000);
  });
});
