// The clip rule (Kd, 2026-11-14: the videos never slow the page), every class of visit in one table.
import { describe, expect, it } from 'vitest';
import { SETTLE_SECONDS, SLOW_MBITS, mayLoadClip, measuredMbits, picturesOnly } from './clipRules.js';

// A picture the browser downloaded: `kb` kilobytes arriving between `start` and `end` milliseconds.
const pic = (kb, start, end, name = `/assets/w${String(start)}-room-x.webp`) => ({ name, transferSize: kb * 1000, responseStart: start, responseEnd: end });
// Two pictures of 125 kB each over 1000 ms of arrival: 2 Mbit/s. Over 2000 ms: 1 Mbit/s.
const fast = [pic(125, 0, 500), pic(125, 500, 1000)];
const slow = [pic(125, 0, 1000), pic(125, 1000, 2000)];
const cached = [pic(0, 0, 0), { ...pic(125, 0, 10), transferSize: 0 }];

describe('measuring the line from the page\'s own pictures', () => {
  it('counts only the time something was arriving, not the pauses between downloads', () => {
    // 250 kB over 1000 ms of arrival, with a 5-second pause between the two: still 2 Mbit/s.
    expect(measuredMbits([pic(125, 0, 500), pic(125, 5500, 6000)])).toBeCloseTo(2, 5);
    // Two at once share the line: 250 kB over the 1000 ms both took.
    expect(measuredMbits([pic(125, 0, 1000), pic(125, 0, 1000)])).toBeCloseTo(2, 5);
    expect(measuredMbits(fast)).toBeCloseTo(2, 5);
    expect(measuredMbits(slow)).toBeCloseTo(1, 5);
  });

  it('cannot measure from cached pictures, small ones, a single one, or anything but pictures', () => {
    expect(measuredMbits(cached)).toBeNull();
    expect(measuredMbits([pic(10, 0, 500), pic(10, 500, 1000)])).toBeNull();
    expect(measuredMbits([pic(125, 0, 1000)])).toBeNull();
    expect(measuredMbits([pic(125, 0, 1000, '/assets/home-x.css'), pic(125, 0, 1000, '/assets/w1-clip-x.mp4')])).toBeNull();
    expect(measuredMbits([])).toBeNull();
    expect(measuredMbits(undefined)).toBeNull();
  });
});

describe('which visits get the still pictures only', () => {
  const cases = [
    // [what, input, pictures only?]
    ['a fast line, measured', { entries: fast }, false],
    ['a slow line, measured', { entries: slow }, true],
    ['exactly the limit, measured', { entries: [pic(93.75, 0, 500), pic(93.75, 500, 1000)] }, false],
    ['just under the limit, measured', { entries: [pic(93.7, 0, 500), pic(93.7, 500, 1000)] }, true],
    ['Reduce motion, on a fast line', { reduceMotion: true, entries: fast }, true],
    ['a data saver, on a fast line', { connection: { saveData: true }, entries: fast }, true],
    ['2G, on a line measured fast', { connection: { effectiveType: '2g' }, entries: fast }, true],
    ['slow 2G', { connection: { effectiveType: 'slow-2g' }, entries: fast }, true],
    ['"3g" by the browser\'s guess, measured fast (the guess is not trusted alone)', { connection: { effectiveType: '3g' }, entries: fast }, false],
    ['a slow measurement beats a fast guess', { connection: { effectiveType: '4g', downlink: 10 }, entries: slow }, true],
    ['a return visit, pictures cached, the browser estimates 1 Mbit/s', { connection: { downlink: 1 }, entries: cached }, true],
    ['a return visit, pictures cached, the browser estimates 10 Mbit/s', { connection: { downlink: 10 }, entries: cached }, false],
    ['a return visit, pictures cached, no estimate (Safari, Firefox)', { connection: null, entries: cached }, false],
    ['nothing measured and an estimate of 0 (unknown)', { connection: { downlink: 0 }, entries: [] }, false],
    ['nothing at all', {}, false],
  ];
  it.each(cases)('%s', (_what, input, expected) => {
    expect(picturesOnly(input)).toBe(expected);
  });

  it('holds the limit Kd named', () => {
    expect(SLOW_MBITS).toBe(1.5);
  });
});

describe('when a room\'s clip may start downloading', () => {
  const cases = [
    ['before the page has loaded, however long on screen', { pageLoaded: false, onScreenFor: 10 }, false],
    ['the page loaded, the room just arrived', { pageLoaded: true, onScreenFor: 0 }, false],
    ['the page loaded, raced past in a moment', { pageLoaded: true, onScreenFor: SETTLE_SECONDS - 0.01 }, false],
    ['the page loaded, the room settled', { pageLoaded: true, onScreenFor: SETTLE_SECONDS }, true],
    ['the page loaded, the tab hidden', { pageLoaded: true, hidden: true, onScreenFor: 10 }, false],
    ['nothing said', {}, false],
  ];
  it.each(cases)('%s', (_what, input, expected) => {
    expect(mayLoadClip(input)).toBe(expected);
  });
});
