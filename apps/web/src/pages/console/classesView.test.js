// THE CLASSES SCREEN'S RULES, ON THEIR OWN. ROADMAP 17b-i; Part 3 §13.3.
//
// **WHAT IS PINNED HERE IS WHAT A GYM READS AND WHAT GOES ON THE WIRE**, not
// how either is spelled inside a component. Two of these rules can put a wrong
// number on a calendar — `classRequest`'s handling of "no limit", and
// `repeatRequest`'s of a blank end date — and both are checked by their EFFECT
// (what the body contains) rather than by calling them and eyeballing.
import { describe, expect, it } from 'vitest';
import { CLASS_ARCHIVED_PAGE, CLASS_COLOURS, CLASS_FILL_HORIZON_DAYS } from '@app/shared';
import {
  archivedPageNote,
  CLASS_COLOUR_CHOICES,
  canManageSchedule,
  classDraft,
  classProblem,
  classRequest,
  classSwatch,
  emptyClassDraft,
  emptyRepeatDraft,
  minutesLine,
  nextDatesLine,
  placesLine,
  repeatFactsLine,
  repeatLine,
  repeatProblem,
  repeatRequest,
  repeatTimeValue,
  timetableLists,
  toggleWeekday,
  weekdayLine,
} from './classesView';

describe('who may set the timetable', () => {
  // :11429's SEAM: the POWER, never the job title. An owner may tick
  // `schedule.manage` across to somebody, and a screen reading `staffRole`
  // would give that person a power with no button anywhere.
  it('asks for the privilege and nothing else', () => {
    expect(canManageSchedule(['schedule.manage'])).toBe(true);
    expect(canManageSchedule(['members.read', 'schedule.manage'])).toBe(true);
    expect(canManageSchedule(['members.read', 'org.manage', 'staff.manage'])).toBe(false);
    expect(canManageSchedule([])).toBe(false);
    expect(canManageSchedule(undefined)).toBe(false);
    expect(canManageSchedule('schedule.manage')).toBe(false);
  });
});

describe('the colours', () => {
  // A colour added to the shared list and forgotten here must be VISIBLE, not
  // silently swapped for a default — so `classSwatch` answers null and the dot
  // is simply not drawn.
  it('paints every colour the wire can carry, and nothing it cannot', () => {
    expect(CLASS_COLOUR_CHOICES.map((c) => c.name)).toEqual([...CLASS_COLOURS]);
    for (const choice of CLASS_COLOUR_CHOICES) expect(choice.swatch).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(classSwatch('chartreuse')).toBeNull();
    expect(classSwatch(undefined)).toBeNull();
  });
});

describe('reading a repeat', () => {
  it('says which days in words, and Every day when it is every day', () => {
    expect(weekdayLine([1])).toBe('Mon');
    expect(weekdayLine([1, 3])).toBe('Mon & Wed');
    expect(weekdayLine([1, 3, 5])).toBe('Mon, Wed & Fri');
    // SORTED HERE TOO, because this also draws a DRAFT the gym is still ticking
    // and that has no server behind it.
    expect(weekdayLine([5, 1, 3])).toBe('Mon, Wed & Fri');
    expect(weekdayLine([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    // A number nothing can produce is dropped rather than printed.
    expect(weekdayLine([1, 9])).toBe('Mon');
    expect(weekdayLine([])).toBe('');
    expect(weekdayLine(undefined)).toBe('');
  });

  it('reads the time on the clock the GYM chose, never the reader s', () => {
    const schedule = { weekdays: [1, 3], startMinute: 1110 };
    expect(repeatLine(schedule, '24h')).toBe('Mon & Wed at 18:30');
    expect(repeatLine(schedule, '12h')).toBe('Mon & Wed at 6:30 PM');
    // Half a line is no line: a caller must not render "at 18:30" with no days
    // in front of it.
    expect(repeatLine({ weekdays: [], startMinute: 1110 }, '24h')).toBe('');
    expect(repeatLine({ weekdays: [1], startMinute: null }, '24h')).toBe('');
  });

  // **THE COUNT IS PRINTED ONLY WHEN THE SERVER SAYS IT IS THE WHOLE TRUTH.**
  //
  // This block replaces one that asserted the DEFECT as correct. The old rule
  // was "an open-ended repeat gets no count, a bounded one does, because there
  // the window closes before the horizon" — true only while the end date is
  // inside 56 days. Round one drove the case it misses: a repeat from 22 Sep
  // 2026 to 22 Sep 2027 runs on 52 Mondays, `sessionsAhead` is the window's 8,
  // and the line read "9 dates on the calendar". **The test asserted such a case
  // as correct**, which is the shape a table built from the code's own
  // assumption always has.
  //
  // So the page no longer decides: `datesComplete` is the server's answer,
  // against the horizon and the gym's own today.
  it('prints the count ONLY when the server says every date is written', () => {
    const base = { startsOn: '2026-09-21', sessionsAhead: 16, finished: false };

    // Open-ended: no count, and the word for it.
    expect(repeatFactsLine({ ...base, endsOn: null, datesComplete: false })).toBe(
      'From Mon 21 Sep 2026 · ongoing',
    );
    expect(repeatFactsLine({ ...base, datesComplete: false })).toBe(
      'From Mon 21 Sep 2026 · ongoing',
    );

    // **THE CASE ROUND ONE FOUND**: it ends, but past the window. Dates shown,
    // NO number — saying nothing beats saying something false.
    expect(
      repeatFactsLine({ ...base, endsOn: '2027-09-21', datesComplete: false }),
    ).toBe('Mon 21 Sep 2026 to Tue 21 Sep 2027');
    // The exact shape the old test asserted as correct, now asserted as silent.
    expect(
      repeatFactsLine({ ...base, endsOn: '2026-12-25', datesComplete: false }),
    ).toBe('Mon 21 Sep 2026 to Fri 25 Dec 2026');

    // Ends inside the window: the count IS the whole truth, so it is printed.
    expect(
      repeatFactsLine({ ...base, endsOn: '2026-10-14', sessionsAhead: 7, datesComplete: true }),
    ).toBe('Mon 21 Sep 2026 to Wed 14 Oct 2026 · 7 dates on the calendar.');
    expect(
      repeatFactsLine({ ...base, endsOn: '2026-09-21', sessionsAhead: 1, datesComplete: true }),
    ).toBe('Mon 21 Sep 2026 to Mon 21 Sep 2026 · 1 date on the calendar.');

    // A server that sends no answer at all is treated as "not the whole truth",
    // which is the safe direction: silence, never a false number.
    expect(repeatFactsLine({ ...base, endsOn: '2026-10-14' })).toBe(
      'Mon 21 Sep 2026 to Wed 14 Oct 2026',
    );
  });

  // Round one, Low-1: nothing ends a repeat whose end date passes, so it stayed
  // on screen reading "nothing on the calendar YET" about something finished
  // months ago. "Today" is the gym's, so the server answers it.
  it('says finished, not "yet", about a repeat that has run its course', () => {
    expect(
      repeatFactsLine({
        startsOn: '2026-07-24', endsOn: '2026-08-23', sessionsAhead: 0, finished: true,
      }),
    ).toBe('Fri 24 Jul 2026 to Sun 23 Aug 2026 · finished');
    // Finished wins over every other branch, including a stale count.
    expect(
      repeatFactsLine({
        startsOn: '2026-07-24', endsOn: '2026-08-23', sessionsAhead: 4,
        datesComplete: true, finished: true,
      }),
    ).toBe('Fri 24 Jul 2026 to Sun 23 Aug 2026 · finished');
  });

  it('says when a repeat has no dates at all, ended or not', () => {
    expect(repeatFactsLine({ startsOn: '2026-09-21', sessionsAhead: 0 })).toBe(
      'From Mon 21 Sep 2026 · nothing on the calendar yet.',
    );
    expect(repeatFactsLine({ startsOn: '2026-09-21', endsOn: '2026-12-25' })).toBe(
      'Mon 21 Sep 2026 to Fri 25 Dec 2026 · nothing on the calendar yet.',
    );
    expect(repeatFactsLine({})).toBe('');
  });

  // **THE LINE IS THE SERVER'S ANSWER, AND AN EMPTY ONE SAYS SO.** A screen that
  // worked out "Mondays from today" would always look right — including on the
  // day the calendar had not been written — and the gym would be reading a
  // promise nothing books against.
  it('shows the dates the server wrote, and says so when there are none', () => {
    expect(nextDatesLine({ nextDates: [], sessionsAhead: 0 })).toBe('No dates yet.');
    expect(nextDatesLine({})).toBe('No dates yet.');
    // **"YET" IS LOW-1's WORD AND IT SURVIVED IN THIS FUNCTION**: a repeat that
    // has run its course read "finished" on one line and "No dates yet." on the
    // next. Raised by the closing re-check as a line for 17b-ii; fixed here,
    // because it is the same defect in the same shape.
    expect(nextDatesLine({ nextDates: [], sessionsAhead: 0, finished: true })).toBe(
      'No more dates.',
    );
    // `[null]` and not `['not-a-date']`: `closureDateLabel` returns an
    // unreadable STRING unchanged on purpose, so only a non-string empties the
    // list — which is the second of the two branches that print this word.
    expect(nextDatesLine({ nextDates: [null], finished: true })).toBe('No more dates.');
    expect(nextDatesLine({ nextDates: [null] })).toBe('No dates yet.');
    expect(
      nextDatesLine({ nextDates: ['2026-09-21', '2026-09-23'], sessionsAhead: 2, datesComplete: true }),
    ).toBe('Next: Mon 21 Sep 2026 · Wed 23 Sep 2026');
  });

  // **`+N more` IS `sessionsAhead` WEARING A DELTA, AND IT IS THE THIRD TIME
  // THAT NUMBER WAS SHOWN AS "how many times the class runs".** Kd struck it as
  // "16 dates on the calendar"; round one found it on the bounded branch; the
  // re-check found this, one line below the line that had just been fixed —
  // "ongoing" and "+4 more" on consecutive lines about a class that runs 52
  // times. The previous version of THIS test pinned it as correct.
  it('never counts what is left unless the server says the dates are all written', () => {
    const shown = ['2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30'];

    // Open-ended: the window holds 16, the class runs for ever.
    expect(nextDatesLine({ nextDates: shown, sessionsAhead: 16, datesComplete: false })).toBe(
      'Next: Mon 21 Sep 2026 · Wed 23 Sep 2026 · Mon 28 Sep 2026 · Wed 30 Sep 2026 · more to come',
    );
    // Ends past the window: 52 Mondays, and the delta would claim 4 remain.
    expect(nextDatesLine({ nextDates: shown.slice(0, 4), sessionsAhead: 8, datesComplete: false })).toBe(
      'Next: Mon 21 Sep 2026 · Wed 23 Sep 2026 · Mon 28 Sep 2026 · Wed 30 Sep 2026 · more to come',
    );
    // A server that says nothing is treated as "not the whole truth".
    expect(nextDatesLine({ nextDates: ['2026-09-21'], sessionsAhead: 16 })).toBe(
      'Next: Mon 21 Sep 2026 · more to come',
    );

    // ONLY when every date is written is the number real.
    expect(nextDatesLine({ nextDates: shown, sessionsAhead: 16, datesComplete: true })).toBe(
      'Next: Mon 21 Sep 2026 · Wed 23 Sep 2026 · Mon 28 Sep 2026 · Wed 30 Sep 2026 · +12 more',
    );
    expect(nextDatesLine({ nextDates: shown, sessionsAhead: 4, datesComplete: true })).toBe(
      'Next: Mon 21 Sep 2026 · Wed 23 Sep 2026 · Mon 28 Sep 2026 · Wed 30 Sep 2026',
    );
  });


});

describe('reading a class', () => {
  // `null` IS NO LIMIT AND IS SAID IN WORDS. A blank would read as "nobody has
  // filled this in", which is a different thing — and open gym is the case that
  // makes the distinction real.
  it('says No limit for a class with no cap, and never a blank', () => {
    expect(placesLine(null)).toBe('No limit');
    expect(placesLine(undefined)).toBe('No limit');
    expect(placesLine(1)).toBe('1 place');
    expect(placesLine(20)).toBe('20 places');
  });

  it('says how long it runs', () => {
    expect(minutesLine(45)).toBe('45 min');
    expect(minutesLine(null)).toBe('');
  });
});

describe('the class form', () => {
  it('starts empty enough to be unsaveable, and says what is missing', () => {
    const draft = emptyClassDraft();
    expect(classProblem(draft)).toBe('Give the class a name.');
    expect(classRequest(draft)).toBeNull();
  });

  it('refuses every bound the server refuses, in words a person can act on', () => {
    const ok = { ...emptyClassDraft(), name: 'Yoga' };
    expect(classProblem(ok)).toBeNull();
    expect(classProblem({ ...ok, name: '   ' })).toBe('Give the class a name.');
    expect(classProblem({ ...ok, name: 'x'.repeat(81) })).toMatch(/too long/);
    expect(classProblem({ ...ok, description: 'x'.repeat(501) })).toMatch(/too long/);
    expect(classProblem({ ...ok, minutes: '4' })).toMatch(/5 minutes/);
    expect(classProblem({ ...ok, minutes: '601' })).toMatch(/5 minutes/);
    expect(classProblem({ ...ok, minutes: '30.5' })).toMatch(/5 minutes/);
    expect(classProblem({ ...ok, minutes: '' })).toMatch(/5 minutes/);
    expect(classProblem({ ...ok, places: '0' })).toMatch(/1 to 500/);
    expect(classProblem({ ...ok, places: '501' })).toMatch(/1 to 500/);
    expect(classProblem({ ...ok, places: '' })).toMatch(/1 to 500/);
    expect(classProblem({ ...ok, colour: 'chartreuse' })).toBe('Pick a colour.');
    // TICKING "no limit" MAKES THE PLACES BOX IRRELEVANT, including when it
    // holds nonsense — otherwise an open-gym slot could not be saved at all.
    expect(classProblem({ ...ok, unlimited: true, places: '' })).toBeNull();
  });

  // **`places: null` HAS TO BE ON THE WIRE, and an omitted key would be
  // indistinguishable from it only by luck.** The route REPLACES rather than
  // merges, so this is the one value that decides whether a gym clearing the cap
  // on its open-gym slot keeps it.
  it('sends no limit as an explicit null, and a number as a number', () => {
    const base = { ...emptyClassDraft(), name: '  Sunrise Yoga  ', minutes: '45', places: '12' };
    expect(classRequest(base)).toEqual({
      name: 'Sunrise Yoga',
      description: '',
      minutes: 45,
      places: 12,
      coachUserId: null,
      colour: CLASS_COLOURS[0],
      openGym: false,
    });
    const unlimited = classRequest({ ...base, unlimited: true });
    expect(unlimited.places).toBeNull();
    expect('places' in unlimited).toBe(true);
    // An empty coach box is "nobody", which the server stores as null — never
    // the empty string, which is not a uuid and would be a 400.
    expect(classRequest({ ...base, coachUserId: '' }).coachUserId).toBeNull();
    expect(classRequest({ ...base, coachUserId: 'u-1' }).coachUserId).toBe('u-1');
  });

  // THE TICK AND THE BOX ARE SEPARATE STATE, which is what lets a gym switch
  // "no limit" off and find its old number still typed in.
  it('fills the form from a saved class, keeping a number behind the no-limit tick', () => {
    expect(classDraft({ name: 'Spin', minutes: 45, places: 12, colour: 'red', openGym: false })).toMatchObject({
      name: 'Spin',
      minutes: '45',
      unlimited: false,
      places: '12',
      colour: 'red',
    });
    const open = classDraft({ name: 'Open Gym', minutes: 60, places: null, colour: 'slate', openGym: true });
    expect(open.unlimited).toBe(true);
    expect(open.places).toBe('20');
    expect(open.openGym).toBe(true);
    // A colour the web has never heard of falls back rather than being painted.
    expect(classDraft({ name: 'X', minutes: 60, places: 1, colour: 'chartreuse' }).colour).toBe(
      CLASS_COLOURS[0],
    );
    expect(classDraft(null)).toEqual(emptyClassDraft());
  });
});

describe('the repeat form', () => {
  it('ticks a day on and off, keeping the set sorted and the draft new', () => {
    const draft = emptyRepeatDraft('2026-09-21');
    const withWed = toggleWeekday(draft, 3);
    const withBoth = toggleWeekday(withWed, 1);
    expect(withBoth.weekdays).toEqual([1, 3]);
    expect(toggleWeekday(withBoth, 3).weekdays).toEqual([1]);
    // The original is untouched: the caller keeps it in React state.
    expect(draft.weekdays).toEqual([]);
  });

  it('refuses a repeat that would run on no day, at no time, or backwards', () => {
    const base = { weekdays: [1], time: '18:00', startsOn: '2026-09-21', endsOn: '' };
    expect(repeatProblem(base)).toBeNull();
    expect(repeatProblem({ ...base, weekdays: [] })).toMatch(/at least one day/);
    expect(repeatProblem({ ...base, time: '' })).toMatch(/What time/);
    // 24:00 IS MIDNIGHT AT THE END OF A DAY — a legal CLOSING time for the gym's
    // hours and never a time a class can start. `clockToMinutes` accepts it for
    // that other form, so it is refused HERE rather than there.
    expect(repeatProblem({ ...base, time: '24:00' })).toMatch(/What time/);
    expect(repeatProblem({ ...base, startsOn: '21/09/2026' })).toMatch(/first date/);
    expect(repeatProblem({ ...base, endsOn: 'soon' })).toMatch(/not a date/);
    expect(repeatProblem({ ...base, endsOn: '2026-09-20' })).toMatch(/before the first/);
    // EQUAL IS ALLOWED and is not a mistake: a one-day repeat is how a gym puts
    // a single workshop on the calendar.
    expect(repeatProblem({ ...base, endsOn: '2026-09-21' })).toBeNull();
  });

  it('sends the clock time as minutes, and leaves a blank end date OFF the body', () => {
    const base = { weekdays: [3, 1], time: '18:30', startsOn: '2026-09-21', endsOn: '' };
    const body = repeatRequest(base);
    expect(body).toEqual({ weekdays: [1, 3], startMinute: 1110, startsOn: '2026-09-21' });
    expect('endsOn' in body).toBe(false);
    expect(repeatRequest({ ...base, endsOn: '2026-12-25' }).endsOn).toBe('2026-12-25');
    expect(repeatRequest({ ...base, weekdays: [] })).toBeNull();
  });

  it('turns a saved start minute back into a clock face for the form', () => {
    expect(repeatTimeValue(1110)).toBe('18:30');
    expect(repeatTimeValue(0)).toBe('00:00');
    expect(repeatTimeValue(null)).toBe('');
  });
});

// Round one, C/H-2: the archived list is a PAGE of an unbounded set, and a gym
// past it was shown a short list that looked complete.
describe('the archived page', () => {
  it('says nothing while the whole list is on screen, and says so when it is not', () => {
    expect(archivedPageNote(3, 3)).toBeNull();
    expect(archivedPageNote(0, 0)).toBeNull();
    // A sentence about paging over a list with nothing hidden is noise.
    expect(archivedPageNote(CLASS_ARCHIVED_PAGE, CLASS_ARCHIVED_PAGE)).toBeNull();
    expect(archivedPageNote(CLASS_ARCHIVED_PAGE, 341)).toBe(
      `Showing the ${String(CLASS_ARCHIVED_PAGE)} most recently removed, of 341.`,
    );
    expect(archivedPageNote(undefined, 341)).toBeNull();
  });
});

describe('the timetable as a whole', () => {
  // A BODY THAT ARRIVED HALF-SHAPED MUST NOT CRASH THE SCREEN, and must not
  // quietly become an empty gym either — the lists are defaulted, the clock and
  // the horizon fall back, and the caller's own failure arm is what handles a
  // read that did not work.
  it('defaults every list and falls back on the clock and the horizon', () => {
    expect(timetableLists(null)).toEqual({
      entries: [],
      archived: [],
      archivedTotal: 0,
      timezone: '',
      clockFormat: '24h',
      horizonDays: CLASS_FILL_HORIZON_DAYS,
    });
    // An older server that does not send the total still prints a TRUE number
    // for the list it did send, rather than 0 over a list of three.
    expect(timetableLists({ archived: [{ id: 'a' }, { id: 'b' }] }).archivedTotal).toBe(2);
    expect(timetableLists({ archived: [{ id: 'a' }], archivedTotal: 130 }).archivedTotal).toBe(130);
    expect(
      timetableLists({
        entries: [{ type: { id: 't1' }, schedules: [] }],
        archived: [{ id: 't2' }],
        timezone: 'Asia/Kolkata',
        clockFormat: '12h',
        horizonDays: 56,
      }),
    ).toMatchObject({ timezone: 'Asia/Kolkata', clockFormat: '12h', horizonDays: 56 });
    expect(timetableLists({ clockFormat: 'roman' }).clockFormat).toBe('24h');
  });
});
