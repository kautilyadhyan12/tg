// ROADMAP 7a-iv-e — the figures the switch over the rings writes. A calorie
// figure reads "1,817 kcal" whatever language the browser is set to, because the
// server's refusal beside it always writes "1,817".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdText, kcalText } from './ringTargets';

afterEach(() => { vi.restoreAllMocks(); });

/** The browser's own number format, as a German browser has it: a figure with
 *  no language named is written "1.817". This test machine is English, so the
 *  German browser is put in front of the real formatter. */
function inAGermanBrowser() {
  const real = Number.prototype.toLocaleString;
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (locales, options) {
    return real.call(this, locales ?? 'de-DE', options);
  });
}

describe('the switch writes a calorie figure one way in every browser', () => {
  it('the stand-in really is German when no language is named', () => {
    inAGermanBrowser();
    expect((1817).toLocaleString()).toBe('1.817');
  });

  it('the pills and "come to" line write 1,817, as the server does', () => {
    inAGermanBrowser();
    expect(kcalText(1817)).toBe('1,817 kcal');
    expect(kcalText(20000)).toBe('20,000 kcal');
    expect(kcalText(900)).toBe('900 kcal');
  });

  it('the hold lines write their figure the same way', () => {
    inAGermanBrowser();
    expect(holdText({ code: 'below_floor', floorKcal: 1200 })).toContain('1,200 kcal');
    expect(holdText({ code: 'no_cut_below_maintenance', maintenanceKcal: 1817, reasons: ['health_answer'] })).toContain('1,817 kcal');
  });
});
