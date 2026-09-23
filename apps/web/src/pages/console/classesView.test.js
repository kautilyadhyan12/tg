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
  bulkEditBounds,
  bulkEditDraft,
  bulkEditProblem,
  bulkEditRequest,
  bulkEditSlots,
  toggleBulkSlot,
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
  repeatDraft,
  repeatEditDraft,
  repeatEditMoves,
  repeatEditNote,
  repeatEditProblem,
  repeatEditRequest,
  repeatProblem,
  repeatRequest,
  repeatTimeValue,
  replaceQuestion,
  replacesAsked,
  runFieldsProblem,
  slotEditable,
  updateFromBounds,
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

  // A one-day time slot (a workshop) names its day once, not "3 Oct – 3 Oct".
  it('names a one-day time slot s date once', () => {
    expect(datesLine({ startsOn: '2026-10-03', endsOn: '2026-10-03', nextDates: ['2026-10-03'] })).toBe(
      '3 Oct 2026 · Next: Sat 3 Oct',
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
  const SLOT = {
    weekdays: [3, 1],
    startMinute: 1110,
    startsOn: '2026-09-01',
    endsOn: null,
    minutes: 90,
    places: null,
    coachUserId: 'sam-id',
    coachName: 'Sam Reid',
    nextDates: ['2026-10-05', '2026-10-07'],
  };
  const BOUNDS = { min: '2026-10-05', max: '2026-11-29' };

  it('fills the form from the saved time slot, never from its class, from its next class', () => {
    expect(repeatEditDraft(SLOT, BOUNDS)).toEqual({
      weekdays: [1, 3],
      time: '18:30',
      updateFrom: '2026-10-05',
      minutes: '90',
      unlimited: true,
      places: '20',
      coachUserId: 'sam-id',
      coachName: 'Sam Reid',
    });
  });

  // A class that already ran this morning is not today's next one: the date
  // starts at the next class, so a move from it never gives today a second one.
  it('starts the date at the next class that has not run, inside the bounds', () => {
    expect(repeatEditDraft({ ...SLOT, nextDates: ['2026-10-07'] }, BOUNDS).updateFrom).toBe('2026-10-07');
    expect(repeatEditDraft({ ...SLOT, nextDates: [] }, BOUNDS).updateFrom).toBe('2026-10-05');
    // A stale or odd date never lands outside what can be picked.
    expect(repeatEditDraft({ ...SLOT, nextDates: ['2026-09-20'] }, BOUNDS).updateFrom).toBe('2026-10-05');
    expect(repeatEditDraft({ ...SLOT, nextDates: ['2027-01-01'] }, BOUNDS).updateFrom).toBe('2026-10-05');
  });

  it('offers dates from today or the slot s first day, to the calendar s last day or the slot s own last day', () => {
    expect(updateFromBounds(SLOT, '2026-10-05', 56)).toEqual({ min: '2026-10-05', max: '2026-11-29' });
    expect(updateFromBounds({ ...SLOT, startsOn: '2026-10-19' }, '2026-10-05', 56)).toEqual({
      min: '2026-10-19',
      max: '2026-11-29',
    });
    expect(updateFromBounds({ ...SLOT, endsOn: '2026-10-31' }, '2026-10-05', 56)).toEqual({
      min: '2026-10-05',
      max: '2026-10-31',
    });
    // Without the server's number it uses the shared one: 5 Oct + 55 days.
    expect(CLASS_FILL_HORIZON_DAYS).toBe(56);
    expect(updateFromBounds(SLOT, '2026-10-05', undefined).max).toBe('2026-11-29');
  });

  // Round one, L-4 and H-2.
  it('starts at tomorrow once today s class has run, and keeps a later-starting slot s own first day', () => {
    expect(updateFromBounds({ ...SLOT, startedToday: true }, '2026-10-05', 56)).toEqual({
      min: '2026-10-06',
      max: '2026-11-29',
    });
    // Starting past the calendar: its own first day, and only that.
    const later = { ...SLOT, startsOn: '2026-12-22', nextDates: [] };
    expect(updateFromBounds(later, '2026-10-05', 56)).toEqual({ min: '2026-12-22', max: '2026-12-22' });
    expect(slotEditable(later, updateFromBounds(later, '2026-10-05', 56))).toBe(true);
    const draft = repeatEditDraft(later, updateFromBounds(later, '2026-10-05', 56));
    expect(draft.updateFrom).toBe('2026-12-22');
    expect(repeatEditProblem(draft, updateFromBounds(later, '2026-10-05', 56))).toBeNull();
  });

  it('offers no Edit on a time slot with no date left to change it from', () => {
    const ended = { ...SLOT, endsOn: '2026-09-25', finished: true };
    expect(slotEditable(ended, updateFromBounds(ended, '2026-10-05', 56))).toBe(false);
    // Its last class ran this morning.
    const lastToday = { ...SLOT, endsOn: '2026-10-05', startedToday: true };
    expect(slotEditable(lastToday, updateFromBounds(lastToday, '2026-10-05', 56))).toBe(false);
    // The control: the same slot before its last class has run.
    const notYet = { ...SLOT, endsOn: '2026-10-05', startedToday: false };
    expect(slotEditable(notYet, updateFromBounds(notYet, '2026-10-05', 56))).toBe(true);
  });

  it('knows a move from a change of length, size or coach', () => {
    const same = repeatEditDraft(SLOT, BOUNDS);
    expect(repeatEditMoves(SLOT, same)).toBe(false);
    expect(repeatEditMoves(SLOT, { ...same, minutes: '30', coachUserId: '' })).toBe(false);
    expect(repeatEditMoves(SLOT, { ...same, time: '19:00' })).toBe(true);
    expect(repeatEditMoves(SLOT, { ...same, weekdays: [1, 3, 5] })).toBe(true);
    expect(repeatEditMoves(SLOT, { ...same, weekdays: [1] })).toBe(true);
    expect(repeatEditMoves(SLOT, { ...same, weekdays: [3, 1] })).toBe(false);
    // The line under the form is true for each.
    expect(repeatEditNote(false)).toMatch(/marked Changed on the Calendar keep their own/);
    expect(repeatEditNote(true)).toBe('Classes before this date stay as they are.');
  });

  it('sends the date, the days, the time and the three fields, and never the coach s NAME', () => {
    const draft = { ...repeatEditDraft(SLOT, BOUNDS), minutes: '45', unlimited: false, places: '8' };
    expect(repeatEditRequest(draft, BOUNDS)).toEqual({
      updateFrom: '2026-10-05',
      weekdays: [1, 3],
      startMinute: 1110,
      minutes: 45,
      places: 8,
      coachUserId: 'sam-id',
    });
    // `null` IS THE VALUE for both, never an omission: the route replaces
    // rather than merges.
    expect(repeatEditRequest({ ...draft, unlimited: true, coachUserId: '' }, BOUNDS)).toMatchObject({
      places: null,
      coachUserId: null,
    });
    // The count goes back only when the server asked for it.
    expect(repeatEditRequest(draft, BOUNDS, 2)).toMatchObject({ confirmReplace: 2 });
    expect(repeatEditRequest(draft, BOUNDS, 0)).not.toHaveProperty('confirmReplace');
    expect(runFieldsProblem({ ...draft, places: 'twenty' })).toMatch(/1 to 500/);
  });

  it('will not send a form the server would refuse, and says why', () => {
    const ok = repeatEditDraft(SLOT, BOUNDS);
    expect(repeatEditProblem(ok, BOUNDS)).toBeNull();
    const cases = [
      [{ weekdays: [] }, 'Pick at least one day of the week.'],
      [{ time: '' }, 'Pick a start time.'],
      [{ time: '24:00' }, 'Pick a start time.'],
      [{ minutes: '4' }, 'Length must be 5 to 600 minutes.'],
      [{ updateFrom: '' }, 'Pick the date to update from.'],
      [{ updateFrom: '2026-10-04' }, 'Pick a date from Mon 5 Oct 2026 to Sun 29 Nov 2026.'],
      [{ updateFrom: '2026-11-30' }, 'Pick a date from Mon 5 Oct 2026 to Sun 29 Nov 2026.'],
    ];
    for (const [over, words] of cases) {
      expect(repeatEditProblem({ ...ok, ...over }, BOUNDS), JSON.stringify(over)).toBe(words);
      expect(repeatEditRequest({ ...ok, ...over }, BOUNDS)).toBeNull();
    }
  });

  it('asks before a move replaces classes changed on their own, in the gym s words', () => {
    expect(replaceQuestion(2, '2026-10-12')).toBe(
      '2 classes from Mon 12 Oct on were changed or cancelled on their own. Move anyway?',
    );
    expect(replaceQuestion(1, '2026-10-12')).toBe(
      '1 class from Mon 12 Oct on was changed or cancelled on its own. Move anyway?',
    );
    const asked = (data) => replacesAsked({ response: { status: 409, data } });
    expect(asked({ error: 'class_slot_replaces', replaces: 2 })).toBe(2);
    expect(asked({ error: 'class_slot_replaces' })).toBeNull();
    expect(asked({ error: 'repeat_clashes', replaces: 2 })).toBeNull();
    expect(replacesAsked(new Error('offline'))).toBeNull();
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

describe('bulk edit', () => {
  const today = '2026-10-05';
  const slot = (over = {}) => ({
    id: 's1',
    weekdays: [1],
    startMinute: 1080,
    startsOn: '2026-09-01',
    endsOn: null,
    minutes: 45,
    places: 12,
    coachUserId: 'u8',
    coachName: 'Dana',
    nextDates: ['2026-10-05'],
    finished: false,
    startedToday: false,
    ...over,
  });

  it('reaches only the time slots with a date left to change from', () => {
    const ended = slot({ id: 's2', endsOn: '2026-10-01', finished: true });
    const later = slot({ id: 's3', startsOn: '2027-01-04' });
    expect(bulkEditSlots([slot(), ended, later], today, 56).map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('offers dates from today to the calendar s end or the earliest ticked last day', () => {
    const last = '2026-11-29';
    expect(bulkEditBounds([slot()], today, 56)).toEqual({ min: today, max: last });
    expect(bulkEditBounds([slot(), slot({ id: 's2', endsOn: '2026-10-20' })], today, 56)).toEqual({
      min: today,
      max: '2026-10-20',
    });
    // One that starts later is changed from its own first day; it narrows nothing.
    expect(bulkEditBounds([slot(), slot({ id: 's3', startsOn: '2027-01-04' })], today, 56)).toEqual({
      min: today,
      max: last,
    });
  });

  it('sends only what is ticked, and every ticked time slot', () => {
    const bounds = bulkEditBounds([slot()], today, 56);
    const draft = bulkEditDraft([slot(), slot({ id: 's2' })], today);
    expect(draft.ticked).toEqual(['s1', 's2']);
    expect(bulkEditRequest(draft, bounds)).toBeNull();
    expect(bulkEditProblem(draft, bounds)).toBe('Tick what to change.');

    const rows = [
      [{ changeMinutes: true, minutes: '50' }, { minutes: 50 }],
      [{ changeCoach: true, coachUserId: '' }, { coachUserId: null }],
      [{ changeCoach: true, coachUserId: 'u9' }, { coachUserId: 'u9' }],
      [{ changePlaces: true, unlimited: true }, { places: null }],
      [{ changePlaces: true, unlimited: false, places: '15' }, { places: 15 }],
      [
        { changeMinutes: true, minutes: '30', changePlaces: true, unlimited: false, places: '10' },
        { minutes: 30, places: 10 },
      ],
    ];
    for (const [patch, set] of rows) {
      expect(bulkEditRequest({ ...draft, ...patch }, bounds)).toEqual({
        scheduleIds: ['s1', 's2'],
        updateFrom: today,
        set,
      });
    }
  });

  it('sends nothing the server would refuse, and says why', () => {
    const bounds = bulkEditBounds([slot()], today, 56);
    const draft = { ...bulkEditDraft([slot()], today), changeMinutes: true };
    const cases = [
      [{ ticked: [] }, 'Tick at least one time slot.'],
      [{ minutes: '2' }, 'Length must be 5 to 600 minutes.'],
      [{ changePlaces: true, unlimited: false, places: '0' }, 'Class size must be 1 to 500, or tick No limit.'],
      [{ updateFrom: '' }, 'Pick the date to update from.'],
      [{ updateFrom: '2026-10-04' }, 'Pick a date from Mon 5 Oct 2026 to Sun 29 Nov 2026.'],
      [{ updateFrom: '2026-11-30' }, 'Pick a date from Mon 5 Oct 2026 to Sun 29 Nov 2026.'],
    ];
    for (const [patch, problem] of cases) {
      expect(bulkEditProblem({ ...draft, ...patch }, bounds)).toBe(problem);
      expect(bulkEditRequest({ ...draft, ...patch }, bounds)).toBeNull();
    }
    // A size left unticked is not checked: its box is not sent.
    expect(bulkEditProblem({ ...draft, places: '0', unlimited: false }, bounds)).toBeNull();
  });

  it('ticks and unticks a time slot', () => {
    const draft = bulkEditDraft([slot(), slot({ id: 's2' })], today);
    expect(toggleBulkSlot(draft, 's1').ticked).toEqual(['s2']);
    expect(toggleBulkSlot(toggleBulkSlot(draft, 's1'), 's1').ticked).toEqual(['s2', 's1']);
  });
});
