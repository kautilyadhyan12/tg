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
  coachChoices,
  coachLine,
  emptyClassDraft,
  peopleLine,
  placesLine,
  repeatDatesLine,
  repeatLine,
  repeatDraft,
  repeatEditDraft,
  repeatEditRequest,
  repeatProblem,
  repeatRequest,
  repeatTimeValue,
  runFieldsProblem,
  timeRange,
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

// Dates are kept whole with no-break spaces; compared here as plain text.
const datesLine = (slot) => repeatDatesLine(slot).replaceAll('\u00a0', ' ');

describe('reading a time slot', () => {
  it('says which days in words, and Every day when it is every day', () => {
    expect(weekdayLine([1])).toBe('Mon');
    expect(weekdayLine([1, 3])).toBe('Mon & Wed');
    expect(weekdayLine([1, 3, 5])).toBe('Mon, Wed & Fri');
    // Sorted here too: this also draws a draft the gym is still ticking.
    expect(weekdayLine([5, 1, 3])).toBe('Mon, Wed & Fri');
    expect(weekdayLine([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    // A number nothing can produce is dropped rather than printed.
    expect(weekdayLine([1, 9])).toBe('Mon');
    expect(weekdayLine([])).toBe('');
    expect(weekdayLine(undefined)).toBe('');
  });

  // A calendar prints a class as start–end on the gym's own clock.
  it.each([
    [1080, 45, '24h', '18:00–18:45'],
    [1080, 45, '12h', '6:00 PM–6:45 PM'],
    [390, 60, '24h', '06:30–07:30'],
    [690, 60, '12h', '11:30 AM–12:30 PM'],
    // Past midnight: the end is read on the next day's clock.
    [1410, 60, '24h', '23:30–00:30'],
    [1410, 60, '12h', '11:30 PM–12:30 AM'],
    [1380, 60, '24h', '23:00–00:00'],
    [1200, 600, '24h', '20:00–06:00'],
    [0, 30, '24h', '00:00–00:30'],
    // No length: the start alone. No start, or a start that is no start: nothing.
    [1080, null, '24h', '18:00'],
    [null, 45, '24h', ''],
    [1440, 45, '24h', ''],
  ])('%s + %s min on %s → %s', (start, minutes, clock, text) => {
    expect(timeRange(start, minutes, clock)).toBe(text);
  });

  it('puts the days and the time range in one line, or nothing when half is missing', () => {
    const slot = { weekdays: [1, 3], startMinute: 1110, minutes: 45 };
    expect(repeatLine(slot, '24h')).toBe('Mon & Wed · 18:30–19:15');
    expect(repeatLine(slot, '12h')).toBe('Mon & Wed · 6:30 PM–7:15 PM');
    expect(repeatLine({ ...slot, weekdays: [] }, '24h')).toBe('');
    expect(repeatLine({ ...slot, startMinute: null }, '24h')).toBe('');
  });

  // The next dates are the server's, and no count of dates is ever printed:
  // "16 dates on the calendar" was the size of the window, not how often the
  // class runs (Kd, 2026-09-22; 17b-i's round one).
  it('says when a time slot runs from, and the next dates the server wrote', () => {
    const next = ['2026-09-21', '2026-09-23', '2026-09-28'];
    const base = { startsOn: '2026-09-21', nextDates: next, sessionsAhead: 16, finished: false };
    expect(datesLine({ ...base, endsOn: null })).toBe(
      'From 21 Sep 2026 · Next: Mon 21 Sep, Wed 23 Sep, Mon 28 Sep',
    );
    expect(datesLine({ ...base, endsOn: '2026-12-25', datesComplete: false })).toBe(
      '21 Sep – 25 Dec 2026 · Next: Mon 21 Sep, Wed 23 Sep, Mon 28 Sep',
    );
    expect(datesLine({ ...base, endsOn: '2027-09-21' })).toBe(
      '21 Sep 2026 – 21 Sep 2027 · Next: Mon 21 Sep, Wed 23 Sep, Mon 28 Sep',
    );
    // Across a new year the next dates carry no year; their weekday and the
    // range above say which is which.
    expect(
      datesLine({ startsOn: '2026-12-28', nextDates: ['2026-12-28', '2027-01-04'] }),
    ).toBe('From 28 Dec 2026 · Next: Mon 28 Dec, Mon 4 Jan');
  });

  // On a phone the line wraps, and it must wrap between dates, never inside
  // one ("Wed 23 / Sep").
  it('keeps each date on one line and lets the line break between them', () => {
    const line = repeatDatesLine({
      startsOn: '2026-09-21', endsOn: '2026-12-25', nextDates: ['2026-09-23', '2026-09-25'],
    });
    expect(line).toBe(
      '21\u00a0Sep – 25\u00a0Dec\u00a02026 · Next: Wed\u00a023\u00a0Sep, Fri\u00a025\u00a0Sep',
    );
    expect(repeatDatesLine({ startsOn: '2026-07-24', endsOn: '2026-08-23', finished: true })).toBe(
      'Ended 23\u00a0Aug\u00a02026',
    );
  });

  it('lists no next dates when there are none, and says Ended when the slot is over', () => {
    expect(datesLine({ startsOn: '2027-01-04', nextDates: [] })).toBe('From 4 Jan 2027');
    expect(datesLine({ startsOn: '2027-01-04' })).toBe('From 4 Jan 2027');
    // An unreadable date is left out rather than printed raw.
    expect(datesLine({ startsOn: '2026-09-21', nextDates: [null, 'soon'] })).toBe(
      'From 21 Sep 2026',
    );
    // Ended wins over any stale dates.
    expect(
      datesLine({
        startsOn: '2026-07-24', endsOn: '2026-08-23', nextDates: ['2026-08-24'], finished: true,
      }),
    ).toBe('Ended 23 Aug 2026');
    expect(datesLine({ startsOn: '2026-07-24', finished: true })).toBe('Ended');
    expect(datesLine({})).toBe('');
  });
});

describe('the places and the coach', () => {
  // `null` is no limit, and said in words — a blank would read as "nobody has
  // filled this in".
  it('says No limit for a class with no cap, and never a blank', () => {
    expect(placesLine(null)).toBe('No limit');
    expect(placesLine(undefined)).toBe('No limit');
    expect(placesLine(1)).toBe('1 place');
    expect(placesLine(20)).toBe('20 places');
  });

  // The server names a coach only while they are still this gym's staff, so an
  // id with no name is a coach who has gone.
  it('names the coach, and says so when the one who was picked is gone', () => {
    expect(coachLine({ coachUserId: 'x', coachName: 'Dana' })).toBe('Dana');
    expect(coachLine({ coachUserId: 'x', coachName: null })).toBe("Coach not on this gym's staff");
    expect(coachLine({ coachUserId: null, coachName: null })).toBe('');
    expect(coachLine(undefined)).toBe('');
  });

  it('puts the places and the coach in one line', () => {
    expect(peopleLine({ places: 12, coachUserId: 'x', coachName: 'Dana' })).toBe('12 places · Dana');
    expect(peopleLine({ places: null, coachUserId: null, coachName: null })).toBe('No limit');
    expect(peopleLine(null)).toBe('');
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
    expect(classProblem({ ...ok, minutes: '4' })).toBe('Length must be 5 to 600 minutes.');
    expect(classProblem({ ...ok, minutes: '601' })).toBe('Length must be 5 to 600 minutes.');
    expect(classProblem({ ...ok, minutes: '30.5' })).toBe('Length must be 5 to 600 minutes.');
    expect(classProblem({ ...ok, minutes: '' })).toBe('Length must be 5 to 600 minutes.');
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

describe('the time slot form', () => {
  it('ticks a day on and off, keeping the set sorted and the draft new', () => {
    const draft = repeatDraft(null, '2026-09-21');
    const withWed = toggleWeekday(draft, 3);
    const withBoth = toggleWeekday(withWed, 1);
    expect(withBoth.weekdays).toEqual([1, 3]);
    expect(toggleWeekday(withBoth, 3).weekdays).toEqual([1]);
    // The original is untouched: the caller keeps it in React state.
    expect(draft.weekdays).toEqual([]);
  });

  it('refuses a repeat that would run on no day, at no time, or backwards', () => {
    const base = {
      weekdays: [1],
      time: '18:00',
      startsOn: '2026-09-21',
      endsOn: '',
      minutes: '60',
      unlimited: false,
      places: '20',
      coachUserId: '',
    };
    expect(repeatProblem(base)).toBeNull();
    expect(repeatProblem({ ...base, weekdays: [] })).toMatch(/at least one day/);
    expect(repeatProblem({ ...base, time: '' })).toBe('Pick a start time.');
    // 24:00 IS MIDNIGHT AT THE END OF A DAY — a legal CLOSING time for the gym's
    // hours and never a time a class can start. `clockToMinutes` accepts it for
    // that other form, so it is refused HERE rather than there.
    expect(repeatProblem({ ...base, time: '24:00' })).toBe('Pick a start time.');
    expect(repeatProblem({ ...base, startsOn: '21/09/2026' })).toBe('Pick a start date.');
    expect(repeatProblem({ ...base, endsOn: 'soon' })).toBe('Pick the end date from the calendar.');
    expect(repeatProblem({ ...base, endsOn: '2026-09-20' })).toBe('The end date is before the start date.');
    // EQUAL IS ALLOWED and is not a mistake: a one-day repeat is how a gym puts
    // a single workshop on the calendar.
    expect(repeatProblem({ ...base, endsOn: '2026-09-21' })).toBeNull();
  });

  it('sends the clock time as minutes, and leaves a blank end date OFF the body', () => {
    const base = {
      weekdays: [3, 1],
      time: '18:30',
      startsOn: '2026-09-21',
      endsOn: '',
      minutes: '60',
      unlimited: false,
      places: '20',
      coachUserId: '',
    };
    const body = repeatRequest(base);
    expect(body).toEqual({
      weekdays: [1, 3],
      startMinute: 1110,
      startsOn: '2026-09-21',
      minutes: 60,
      places: 20,
      coachUserId: null,
    });
    expect('endsOn' in body).toBe(false);
    expect(repeatRequest({ ...base, endsOn: '2026-12-25' }).endsOn).toBe('2026-12-25');
    expect(repeatRequest({ ...base, weekdays: [] })).toBeNull();
  });

  it('turns a saved start minute back into a clock face for the form', () => {
    expect(repeatTimeValue(1110)).toBe('18:30');
    expect(repeatTimeValue(0)).toBe('00:00');
    expect(repeatTimeValue(null)).toBe('');
  });

  // KD'S RULING, 2026-09-22: the class type is the DEFAULT a new repeat starts
  // from, and THIS FUNCTION is the only place that defaulting happens. The
  // server takes all three outright and never guesses, so a form that stopped
  // copying them would send a gym's Monday whatever the constants say.
  it('fills a new repeat in from its class, and from the constants when there is none', () => {
    // A real class, as the server sends it: a named coach comes WITH their name.
    const type = {
      minutes: 45,
      places: 12,
      coachUserId: 'dana-id',
      coachName: 'Dana Okafor',
      name: 'Spin',
    };
    expect(repeatDraft(type, '2026-09-21')).toEqual({
      weekdays: [],
      time: '18:00',
      startsOn: '2026-09-21',
      endsOn: '',
      minutes: '45',
      unlimited: false,
      places: '12',
      coachUserId: 'dana-id',
      // Carried so the coach box can offer whoever is already set even when
      // the staff list does not hold them — `coachChoices`. It never goes back
      // on the wire.
      coachName: 'Dana Okafor',
    });
    // NO LIMIT SURVIVES THE COPY as the tick, not as a blank box — and the box
    // keeps a number behind it, so switching the tick off leaves something
    // sensible typed in.
    const openGym = repeatDraft({ minutes: 600, places: null, coachUserId: null }, '2026-09-21');
    expect(openGym).toMatchObject({ minutes: '600', unlimited: true, places: '20', coachUserId: '' });
    expect(repeatDraft(null, '2026-09-21')).toMatchObject({
      minutes: '60',
      unlimited: false,
      places: '20',
      coachUserId: '',
    });
  });

  // MEASURED AGAINST REAL POSTGRES: once a coach leaves, the server keeps their
  // id on the class and stops naming them, and a new repeat that copied the id
  // is refused `coach_not_staff` on its first Save — for a field the gym never
  // typed. A NEW repeat starts with nobody; everything else still comes from
  // the class.
  it('does not fill in a coach the server no longer names', () => {
    const gone = { minutes: 45, places: 12, coachUserId: 'dana-id', coachName: null };
    expect(repeatDraft(gone, '2026-09-21')).toMatchObject({
      minutes: '45',
      places: '12',
      coachUserId: '',
      coachName: null,
    });
    // An empty name is the same answer as none.
    expect(repeatDraft({ ...gone, coachName: '' }, '2026-09-21').coachUserId).toBe('');
    // Nobody named on the class stays nobody.
    expect(repeatDraft({ ...gone, coachUserId: null }, '2026-09-21').coachUserId).toBe('');
    // And the EDIT form is deliberately different: it keeps the id it was
    // given, so `coachChoices` can show "No longer on your staff" and the gym
    // decides — it is changing something that already names that person.
    expect(repeatEditDraft(gone).coachUserId).toBe('dana-id');
  });

  it('refuses a repeat whose own length or places are out of bounds, in the form as on the server', () => {
    const base = {
      weekdays: [1],
      time: '18:00',
      startsOn: '2026-09-21',
      endsOn: '',
      minutes: '60',
      unlimited: false,
      places: '20',
      coachUserId: '',
    };
    expect(repeatProblem(base)).toBeNull();
    expect(repeatProblem({ ...base, minutes: '4' })).toBe('Length must be 5 to 600 minutes.');
    expect(repeatProblem({ ...base, minutes: '601' })).toBe('Length must be 5 to 600 minutes.');
    expect(repeatProblem({ ...base, minutes: '' })).toBe('Length must be 5 to 600 minutes.');
    expect(repeatProblem({ ...base, places: '0' })).toMatch(/1 to 500/);
    expect(repeatProblem({ ...base, places: '501' })).toMatch(/1 to 500/);
    expect(repeatProblem({ ...base, places: '' })).toMatch(/1 to 500/);
    // TICKED "no limit", THE BOX STOPS MATTERING — including when it is empty.
    expect(repeatProblem({ ...base, unlimited: true, places: '' })).toBeNull();
  });
});

// CHANGING A REPEAT — its three fields and nothing else, which is the rule the
// server's `.strict()` schema enforces and this side must not break.
describe('editing a time slot', () => {
  it('fills the form from the saved repeat, never from its class', () => {
    expect(
      repeatEditDraft({
        minutes: 90,
        places: null,
        coachUserId: 'sam-id',
        coachName: 'Sam Reid',
        startMinute: 1110,
      }),
    ).toEqual({
      minutes: '90',
      unlimited: true,
      places: '20',
      coachUserId: 'sam-id',
      coachName: 'Sam Reid',
    });
  });

  it('sends the three fields and NOT when it runs, and never the coach s NAME', () => {
    const draft = {
      minutes: '45',
      unlimited: false,
      places: '8',
      coachUserId: 'dana-id',
      coachName: 'Dana Okafor',
    };
    expect(repeatEditRequest(draft)).toEqual({
      minutes: 45,
      places: 8,
      coachUserId: 'dana-id',
    });
    // `null` IS THE VALUE for both, never an omission: the route replaces
    // rather than merges.
    expect(repeatEditRequest({ ...draft, unlimited: true, coachUserId: '' })).toEqual({
      minutes: 45,
      places: null,
      coachUserId: null,
    });
    expect(repeatEditRequest({ ...draft, minutes: '0' })).toBeNull();
    expect(runFieldsProblem({ ...draft, places: 'twenty' })).toMatch(/1 to 500/);
  });

  // **A `<select>` WHOSE VALUE IS NOT AMONG ITS OPTIONS RENDERS BLANK, AND THE
  // NEXT SAVE SENDS null.** Two ordinary cases reach it — the staff list is a
  // separate optional read that 403s for somebody who may set the timetable but
  // not manage staff, and a coach who has left is answered as an id with no
  // name — and in both the gym would lose its coach without touching that box.
  it('always offers whoever is already set, named where the server still names them', () => {
    const staff = [{ userId: 'u9', displayName: 'Priya Sharma' }];
    // Already in the list: nothing is added.
    expect(coachChoices(staff, { coachUserId: 'u9', coachName: 'Priya Sharma' })).toEqual(staff);
    expect(coachChoices(staff, { coachUserId: '', coachName: null })).toEqual(staff);
    // Not in the list but still named — the staff read failed. The value
    // round-trips, so a Save touching only the places leaves the coach alone.
    expect(coachChoices([], { coachUserId: 'u8', coachName: 'Dana Okafor' })).toEqual([
      { userId: 'u8', displayName: 'Dana Okafor' },
    ]);
    // Not named at all — they have left. It SAYS so rather than showing blank.
    expect(coachChoices(staff, { coachUserId: 'u8', coachName: null })).toEqual([
      { userId: 'u8', displayName: 'No longer on your staff' },
      ...staff,
    ]);
    expect(coachChoices(undefined, undefined)).toEqual([]);
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
      `Showing the ${String(CLASS_ARCHIVED_PAGE)} most recent of 341.`,
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
