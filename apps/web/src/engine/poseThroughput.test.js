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
    expect(new PoseThroughput().hz()).toBe(null);
  });

  it('says NULL on a single frame — one timestamp is not a rate', () => {
    const m = new PoseThroughput();
    m.push(0);
    expect(m.hz()).toBe(null);
  });

  it('says NULL for two frames 1 ms apart, rather than 1000 Hz', () => {
    // Arithmetically 1000 fps and obviously not a throughput. Without the span
    // floor this is what the meter reports in the first moments of a workout.
    const m = new PoseThroughput();
    m.push(0);
    m.push(1);
    expect(m.hz()).toBe(null);
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
    feed(justUnder, { n: MIN_SPAN_MS / step, dtMs: step });       // 900 ms of frames
    expect(justUnder.hz()).toBe(null);

    const atTheFloor = new PoseThroughput();
    feed(atTheFloor, { n: MIN_SPAN_MS / step + 1, dtMs: step });  // exactly 1000 ms
    expect(atTheFloor.hz()).toBeCloseTo(1000 / step, 5);
  });
});

describe('PoseThroughput — the rate itself', () => {
  it('reports ~15 Hz for frames arriving every 67 ms (the app\'s own target)', () => {
    // FEED_INTERVAL_MS is 67, so a machine keeping up reads just under 15 and
    // must NOT read below the ladder's threshold by rounding alone.
    const m = new PoseThroughput();
    feed(m, { n: 40, dtMs: 67 });
    expect(m.hz()).toBeCloseTo(1000 / 67, 5);
  });

  it('reports the ~11 fps Kd actually measured, not a rounded 15', () => {
    // His five clips landed at 7.2–12.5 fps against the 15 target (:6386). A
    // meter that could not distinguish those from a healthy machine would be
    // useless for the decision it exists to inform.
    const m = new PoseThroughput();
    feed(m, { n: 40, dtMs: 90 });
    expect(m.hz()).toBeCloseTo(1000 / 90, 5);
    expect(m.hz()).toBeLessThan(15);
  });

  it('divides by the SPAN OF THE FRAMES, not by the window length', () => {
    // THE ONE WITH TEETH. A window of 3000 ms holding only 1200 ms of frames
    // must not report `frames / 3 s` — that is a third of the truth, and it
    // would step down a phone that is keeping up. Measured against a naive
    // count/window, which would give ~5 here instead of ~15.
    const m = new PoseThroughput({ windowMs: 3000 });
    feed(m, { n: 19, dtMs: 67 });           // 18 gaps = 1206 ms of frames
    expect(m.hz()).toBeCloseTo(1000 / 67, 5);
    expect(m.hz()).toBeGreaterThan(10);      // count/window would be ~6.3
  });
});

describe('PoseThroughput — the window', () => {
  it('forgets frames older than the window, so a rate follows a SLOWDOWN down', () => {
    // The failure this prevents is the ladder never firing: 20 seconds of
    // healthy frames followed by a collapse must read as the collapse.
    const m = new PoseThroughput({ windowMs: 3000 });
    const last = feed(m, { n: 100, dtMs: 30 });         // ~33 Hz, healthy
    expect(m.hz()).toBeGreaterThan(30);

    feed(m, { n: 15, dtMs: 250, t0: last + 250 });      // 4 Hz, struggling
    expect(m.hz()).toBeLessThan(6);
  });

  it('does not average across a GAP once the gap outruns the window', () => {
    // A paused set, a hidden tab, or a set that simply ended. Frames stop, then
    // resume healthy. The meter must report the healthy rate, not a stall it
    // computed from a gap nobody was watching.
    const m = new PoseThroughput({ windowMs: 3000 });
    feed(m, { n: 30, dtMs: 67 });
    feed(m, { n: 30, dtMs: 67, t0: 120_000 });          // two minutes later
    expect(m.hz()).toBeCloseTo(1000 / 67, 5);
  });

  it('reset() empties it, so a resumed set is not averaged with the one before', () => {
    const m = new PoseThroughput();
    feed(m, { n: 40, dtMs: 67 });
    expect(m.hz()).not.toBe(null);
    m.reset();
    expect(m.hz()).toBe(null);
    expect(m.frames).toBe(0);
  });
});

describe('PoseThroughput — inputs that should not move it', () => {
  it('drops a repeated timestamp rather than counting it as a frame', () => {
    const m = new PoseThroughput();
    feed(m, { n: 31, dtMs: 100 });                      // 30 gaps over 3000 ms
    const before = m.hz();
    for (let i = 0; i < 20; i += 1) m.push(3000);       // same instant, 20 times
    expect(m.hz()).toBe(before);
  });

  it('drops an OUT-OF-ORDER timestamp rather than reversing the span', () => {
    // :7974's shape — a timestamp that moves the span backwards produced a
    // watched time longer than the set it sat in. Here it would produce a
    // negative or wildly inflated rate.
    const m = new PoseThroughput();
    feed(m, { n: 31, dtMs: 100 });
    const before = m.hz();
    m.push(500);                                        // long past
    expect(m.hz()).toBe(before);
  });

  it('ignores NaN rather than poisoning every later reading', () => {
    const m = new PoseThroughput();
    feed(m, { n: 31, dtMs: 100 });
    m.push(Number.NaN);
    expect(m.hz()).toBeCloseTo(10, 5);
    expect(Number.isFinite(m.hz())).toBe(true);
  });
});

describe('PoseThroughput — the constants are the ones the ladder will read', () => {
  it('averages over less than §3.6\'s 10-second trigger', () => {
    // The ladder must be able to watch ten seconds OF this rate. If the window
    // were 10 s or longer, "below 15 Hz for 10 s" could not be observed without
    // the trigger and the average being the same measurement.
    expect(DEFAULT_WINDOW_MS).toBeLessThan(10_000);
  });
});
