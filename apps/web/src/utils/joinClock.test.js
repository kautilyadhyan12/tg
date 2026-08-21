// The waiting room's clock, in words — the pure half, tested directly.
//
// **THIS FILE EXISTS BECAUSE ITS ABSENCE HID A CRITICAL — T3 round 2, Low-4.**
// The three moved functions were reachable through `consoleView.test.js`'s
// re-export, but `nextNudgeText` and `nextNudgeAfter` were new and were exercised
// ONLY through render tests, at two convenient values. That left every bucket
// boundary unpinned (Low-2), and the boundary is exactly where C/H-1 lived: a
// mutant widening `hours <= 12` to `hours <= 20` left 150 tests green.
//
// So every test here is aimed at a BOUNDARY or a REFUSAL, and the clock is
// always passed in — a test whose expected string depends on the day it runs is
// one that fails some morning for a reason nobody can find.
import { afterEach, describe, expect, it } from 'vitest';
import {
  expiresInLabel,
  nextNudgeAfter,
  nextNudgeText,
  nudgedLabel,
  waitingForLabel,
} from './joinClock';

const HOUR = 3600000;
const DAY = 86400000;

describe('nextNudgeText says a calendar word and therefore reads the calendar', () => {
  // The suite pins TZ=Asia/Kolkata (`vitest.config.js`), so "local" here is
  // +05:30 — and that is the point: these words mean the viewer's own day.
  const at = (iso) => Date.parse(iso);

  it('THE C/H-1 CASE: eleven hours away can be TOMORROW, and must say so', () => {
    // Read at 15:30 local, next slot at 02:30 local the NEXT day: eleven hours
    // apart and a day apart. The old code bucketed by elapsed hours — 11 fell in
    // the "<= 12" bucket — and told the member "later today", so they came back
    // that evening to a button still faded.
    //
    // **The instants are chosen for THIS SUITE'S PINNED ZONE (+05:30), not for
    // UTC, and that is the point of the fix rather than an accident of it.** The
    // review's own example was cross-day in UTC and same-day here; the words
    // "today" and "tomorrow" belong to the VIEWER's calendar, which is exactly
    // what an elapsed-hours rule cannot see.
    expect(
      nextNudgeText('2026-08-24T21:00:00.000Z', at('2026-08-24T10:00:00.000Z')),
    ).toBe('tomorrow');
  });

  it('says "later today" only when it IS the same local day', () => {
    // Four hours out, same day: the sentence the L2 fix exists to produce.
    expect(
      nextNudgeText('2026-08-20T13:00:00.000Z', at('2026-08-20T09:00:00.000Z')),
    ).toBe('later today');
    // Twenty-three hours out but the NEXT day — the mirror of the case above,
    // and the one an elapsed-hours rule gets right by luck rather than by rule.
    expect(
      nextNudgeText('2026-08-21T08:00:00.000Z', at('2026-08-20T09:00:00.000Z')),
    ).toBe('tomorrow');
  });

  it('holds at the local-midnight boundary, one minute either side', () => {
    // Local midnight at +05:30 is 18:30 UTC. A minute before it is still today;
    // a minute after is tomorrow. This is the assertion a bucket cannot pass.
    const justBeforeMidnight = at('2026-08-20T18:29:00.000Z');
    expect(nextNudgeText('2026-08-20T18:28:00.000Z', at('2026-08-20T18:00:00.000Z'))).toBe(
      'later today',
    );
    expect(nextNudgeText('2026-08-20T18:31:00.000Z', justBeforeMidnight)).toBe('tomorrow');
  });

  it('goes vague past tomorrow rather than inventing a date', () => {
    expect(
      nextNudgeText('2026-08-23T09:00:00.000Z', at('2026-08-20T09:00:00.000Z')),
    ).toBe('in a couple of days');
  });

  it('holds the tomorrow / later boundary at exactly TWO local days — T3 r3 Low-3', () => {
    // **THE GAP THIS CLOSES IS THE ONE THAT HID THE CRITICAL, in the very file
    // written to close it.** The reviewer mutated `days === 1` to
    // `days <= 2 && days >= 1` — a slot two local days out announced as
    // "tomorrow" — and all 163 tests stayed green, because nothing sat on this
    // boundary. One day out and two days out, a minute apart in wall-clock terms
    // but a day apart on the calendar, are what pin it.
    // Instants in UTC, days in +05:30 — the distinction that broke my FIRST
    // draft of this file and my first draft of this very test. `now` is 20 Aug
    // 14:30 local. Local midnight is 18:30Z, so 21 Aug 18:29Z is still the 21st
    // (tomorrow) and 21 Aug 18:31Z is already the 22nd (two days out).
    const now = at('2026-08-20T09:00:00.000Z');
    expect(nextNudgeText('2026-08-21T18:29:00.000Z', now)).toBe('tomorrow');
    expect(nextNudgeText('2026-08-21T18:31:00.000Z', now)).toBe('in a couple of days');
  });

  it('says "now" when the slot has already arrived, and "later" when it cannot tell', () => {
    expect(nextNudgeText('2026-08-20T09:00:00.000Z', at('2026-08-20T09:00:00.000Z'))).toBe('now');
    expect(nextNudgeText('2026-08-20T08:00:00.000Z', at('2026-08-20T09:00:00.000Z'))).toBe('now');
    // Unreadable in, "later" out — never a guess, and never a crash.
    expect(nextNudgeText(null, at('2026-08-20T09:00:00.000Z'))).toBe('later');
    expect(nextNudgeText('whenever', at('2026-08-20T09:00:00.000Z'))).toBe('later');
    expect(nextNudgeText('2026-08-20T09:00:00.000Z', Number.NaN)).toBe('later');
  });
});

describe('nextNudgeAfter adds the ratified interval and nothing else', () => {
  it('is exactly a day later', () => {
    const out = nextNudgeAfter('2026-08-20T09:00:00.000Z');
    expect(Date.parse(out) - Date.parse('2026-08-20T09:00:00.000Z')).toBe(DAY);
  });

  it('refuses to invent a slot from a date it cannot read', () => {
    // Null flows into `nextNudgeText`, which answers "later" — a screen saying
    // nothing definite beats one stating a time nobody computed.
    expect(nextNudgeAfter(null)).toBeNull();
    expect(nextNudgeAfter('soon')).toBeNull();
  });
});

// The three functions below were moved here from `pages/console/consoleView.js`
// (Low-7) and were already covered through its re-export. Re-tested at their new
// home so the coverage travels with the code rather than with the old importer.
describe('the countdown never says a number it did not measure', () => {
  const expires = '2026-09-03T09:00:00.000Z';
  const at = (ms) => Date.parse(expires) + ms;

  it('THE C/H-1 CASE: says TOMORROW the day before, not "today" — T3 round 4', () => {
    // **MEASURED IN THE PRODUCT'S OWN SHAPE, not a constructed corner.**
    // `expires_at` is `applied_at + 14 days`, so a deadline sits at whatever
    // time of day somebody applied — and every evening applicant produced this
    // window on every day they waited. Read at 23:00 local against a deadline of
    // 20:00 the NEXT day: 21 hours out, one local midnight in between. Flooring
    // elapsed milliseconds called that "Expires today"; a member reading it that
    // night believed their request died before it did.
    const nowLate = Date.parse('2026-08-20T17:30:00.000Z'); // 20 Aug 23:00 IST
    const deadline = '2026-08-21T14:30:00.000Z'; //            21 Aug 20:00 IST
    expect(expiresInLabel(deadline, nowLate)).toBe('Expires tomorrow');
  });

  it('holds the today / tomorrow boundary at local midnight, a minute either side', () => {
    // Local midnight at +05:30 is 18:30Z. The deadline is the 21st at 20:00
    // local; read a minute before midnight it is tomorrow, a minute after it is
    // today. Two minutes apart in elapsed terms, a day apart on the calendar —
    // which is the assertion no hours bucket can pass.
    const deadline = '2026-08-21T14:30:00.000Z';
    expect(expiresInLabel(deadline, Date.parse('2026-08-20T18:29:00.000Z'))).toBe('Expires tomorrow');
    expect(expiresInLabel(deadline, Date.parse('2026-08-20T18:31:00.000Z'))).toBe('Expires today');
  });

  it('counts whole days down and never says "in 0 days"', () => {
    expect(expiresInLabel(expires, at(-11 * DAY))).toBe('Expires in 11 days');
    expect(expiresInLabel(expires, at(-DAY))).toBe('Expires tomorrow');
    expect(expiresInLabel(expires, at(-1))).toBe('Expires today');
  });

  it('says "due to expire" past the deadline, because the sweep runs nightly', () => {
    // The row is still PENDING and still confirmable until the job reaches it,
    // so "expired" here would contradict the Confirm button beside it.
    expect(expiresInLabel(expires, at(1))).toBe('Due to expire');
  });

  it('treats the deadline INSTANT itself as past — T3 round 5, Low-7', () => {
    // The two neighbours were pinned and the instant between them was not, so
    // the reviewer's mutant loosening `<=` to `<` survived every clock suite
    // green: at exactly `expiresAt` the sentence flipped to "Expires today",
    // which is a countdown still promising a day to a request whose day is up.
    // A boundary with tests on both sides and none ON it is not pinned.
    expect(expiresInLabel(expires, Date.parse(expires))).toBe('Due to expire');
  });

  it('states nothing at all when it cannot read the date', () => {
    expect(expiresInLabel(null, at(-DAY))).toBeNull();
    expect(expiresInLabel('soon', at(-DAY))).toBeNull();
    expect(expiresInLabel(expires, Number.NaN)).toBeNull();
  });
});

describe('waiting and nudged labels measure ELAPSED time, as the file says', () => {
  const applied = Date.parse('2026-08-20T09:00:00.000Z');

  it('counts DURATIONS by elapsed time', () => {
    // Two local days out (20 Aug 14:30 → 22 Aug 14:29:59.999 IST) is where the
    // duration starts being printed, and it prints ELAPSED days: one whole day
    // has passed, not two. One millisecond later a second day has, which is the
    // same arithmetic the server uses for the same question.
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', applied + 2 * DAY - 1)).toBe('Waiting 1 day');
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', applied + 2 * DAY)).toBe('Waiting 2 days');
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', applied + 3 * DAY)).toBe('Waiting 3 days');
  });

  it('but says "Asked today" and "Asked yesterday" off the CALENDAR — T3 rounds 4 and 5', () => {
    // Applied 20:00, read at 09:00 the next morning: thirteen hours, and the
    // front desk was told "Asked today" about somebody who came in last night.
    // Same defect as the Critical above, past tense — a wrong word rather than a
    // wrong promise, which is why it is Low and still fixed.
    const lastNight = '2026-08-20T14:30:00.000Z'; //   20 Aug 20:00 IST
    const thisMorning = Date.parse('2026-08-21T03:30:00.000Z'); // 21 Aug 09:00 IST
    expect(waitingForLabel(lastNight, thisMorning)).toBe('Asked yesterday');
    // Same local day, hours apart: still today.
    expect(waitingForLabel(lastNight, Date.parse('2026-08-20T16:00:00.000Z'))).toBe('Asked today');
    // One local day exactly — the word, never a count.
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', applied + DAY)).toBe('Asked yesterday');
  });

  it('THE ROUND-5 CASE: two minutes across midnight is not a day of waiting', () => {
    // **The rule at the top of the file names THREE day words and the function
    // implemented TWO.** With no "yesterday" branch a midnight crossing fell
    // through to the duration, where the floor rounded it up — so a request two
    // minutes old was announced to the front desk as "Waiting 1 day". Every
    // evening applicant produced it on the morning after they applied.
    const justBefore = '2026-08-20T18:29:00.000Z'; //          20 Aug 23:59 IST
    const justAfter = Date.parse('2026-08-20T18:31:00.000Z'); // 21 Aug 00:01 IST
    expect(waitingForLabel(justBefore, justAfter)).toBe('Asked yesterday');
    // Thirteen hours later it is still yesterday, and still not a count: the
    // word changes on the calendar, never on the stopwatch.
    expect(waitingForLabel(justBefore, justAfter + 13 * HOUR)).toBe('Asked yesterday');
  });

  it('never reports a fraction of a day as "Waiting 0 days"', () => {
    // Two calendar days wide and one elapsed day long: the duration path taken
    // honestly, without the floor doing any work. 20 Aug 23:30 → 22 Aug 00:30
    // local is 25 hours.
    const lastNight = '2026-08-20T18:00:00.000Z';
    expect(waitingForLabel(lastNight, Date.parse('2026-08-21T19:00:00.000Z'))).toBe('Waiting 1 day');
  });
});

// **THE FLOOR UNDER THE DURATION IS NOT DEAD CODE, AND THIS IS THE ONLY THING
// THAT CAN PROVE IT — T3 round 5, Low-1.**
//
// The review's proposed fix was to add the "yesterday" branch and DROP
// `Math.max(1, …)`, on the reasoning that two calendar days apart implies a
// whole day elapsed. That is true in every zone this suite can normally see and
// FALSE across a spring-forward day, which is 23 hours long — so the floor is
// the only thing standing between a real user and "Waiting 0 days".
//
// Asia/Kolkata is pinned for the whole suite precisely because it has no DST
// (`vitest.config.js`), so this corner is unreachable here by construction. The
// zone is therefore switched for this one describe and restored in `afterEach`
// — not as the last line of the test body, which a failing assertion never
// reaches (round 3, Low-4). The restore is asserted, so a leak into a later file
// cannot be silent.
//
// `process` is declared for this file rather than added to `eslint.config.js`:
// that config gives every `.js` file BROWSER globals only, which is right for
// app code and simply does not describe a vitest run. The global is real here
// (vitest runs this suite in node) and the declaration is scoped to the one
// file that needs it, rather than opening node globals across `apps/web`.
/* global process */
describe('the duration floor, in a zone that has a 23-hour day', () => {
  const PINNED = process.env.TZ;

  afterEach(() => {
    process.env.TZ = PINNED;
    expect(new Date('2026-03-08T12:00:00.000Z').getTimezoneOffset()).toBe(-330);
  });

  it('prints one day rather than zero across the US spring forward', () => {
    process.env.TZ = 'America/New_York';
    // 7 Mar 2026 23:59 EST (UTC−5) → 9 Mar 00:01 EDT (UTC−4). The 8th is the
    // short day, so the span is 23h02m while the calendar has moved two days.
    const applied = '2026-03-08T04:59:00.000Z';
    const read = Date.parse('2026-03-09T04:01:00.000Z');
    expect((read - Date.parse(applied)) / HOUR).toBeCloseTo(23.033, 2);
    // The premise the review's one-liner rests on, measured and false:
    expect(Math.floor((read - Date.parse(applied)) / DAY)).toBe(0);
    expect(waitingForLabel(applied, read)).toBe('Waiting 1 day');
  });

  it('and the same wall-clock span is a whole day where no clock changed', () => {
    // The positive control: without it the assertion above could be satisfied
    // by any zone at all, and would not be about the transition.
    process.env.TZ = 'Asia/Kolkata';
    const applied = '2026-03-07T18:29:00.000Z'; //          7 Mar 23:59 IST
    const read = Date.parse('2026-03-08T18:31:00.000Z'); // 9 Mar 00:01 IST is
    // a day later than the US case's local rendering, so compare the span, not
    // the label: two calendar days here really is 24h02m.
    expect((read - Date.parse(applied)) / HOUR).toBeCloseTo(24.033, 2);
    expect(Math.floor((read - Date.parse(applied)) / DAY)).toBe(1);
  });
});

describe('the nudge label is a DURATION and says so', () => {
  it('never claims a calendar day for a nudge', () => {
    const nudged = '2026-08-22T09:00:00.000Z';
    const t = (ms) => Date.parse(nudged) + ms;
    expect(nudgedLabel(nudged, t(59 * 60 * 1000))).toBe('They asked again in the last hour');
    expect(nudgedLabel(nudged, t(HOUR))).toBe('They asked again 1 hour ago');
    // 25 hours is "1 day ago" and never "yesterday" — 25 hours before Tuesday
    // 00:30 is Sunday, and the word would simply be wrong.
    expect(nudgedLabel(nudged, t(25 * HOUR))).toBe('They asked again 1 day ago');
    expect(nudgedLabel(nudged, t(48 * HOUR))).toBe('They asked again 2 days ago');
  });

  it('says nothing about a future timestamp rather than counting backwards', () => {
    expect(nudgedLabel('2026-08-22T09:00:00.000Z', Date.parse('2026-08-22T08:00:00.000Z'))).toBeNull();
    expect(waitingForLabel('2026-08-22T09:00:00.000Z', Date.parse('2026-08-21T09:00:00.000Z'))).toBeNull();
  });
});
