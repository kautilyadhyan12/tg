// WHO IS BOOKED, BEFORE A CLASS GOES, AND THE FOUR BOOKING SETTINGS: the words and the
// numbers (ROADMAP 17c-ii-a).
import { describe, expect, it } from 'vitest';
import {
  bookingSettingsBody,
  bookingSettingsChanged,
  bookingSettingsDraft,
  bookingSettingsProblem,
  bookingSettingsSavedLine,
  bookingSettingsSummary,
  bookingsAsked,
  endingChangeLine,
  endingConfirmLabel,
  endingKeptLine,
  endingMore,
  endingPersonLine,
  endingTitle,
  endingTotal,
  minutesAsUnit,
} from './bookingsEndView';

const person = (over = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Asha Rao',
  initials: 'AR',
  waiting: false,
  className: 'Yoga',
  localDate: '2026-10-12',
  localStartMinute: 1080,
  ...over,
});
const ending = (over = {}) => ({ classes: 1, booked: 12, waiting: 3, people: [person()], ...over });
const refusal = (data) => ({ response: { status: 409, data } });

describe('the server asking before bookings end', () => {
  it('is read from a 409 class_has_bookings, and from nothing else', () => {
    expect(bookingsAsked(refusal({ error: 'class_has_bookings', ending: ending() }))).toEqual(ending());
    expect(bookingsAsked(refusal({ error: 'class_slot_replaces', replaces: 3 }))).toBeNull();
    expect(bookingsAsked(refusal({ error: 'class_has_bookings' }))).toBeNull();
    expect(bookingsAsked(refusal({ error: 'class_has_bookings', ending: ending({ booked: 0, waiting: 0, people: [] }) }))).toBeNull();
    expect(bookingsAsked(new Error('offline'))).toBeNull();
  });

  it('counts the people the request confirms: booked and waiting together', () => {
    expect(endingTotal(ending())).toBe(15);
    expect(endingTotal(ending({ booked: 0, waiting: 2 }))).toBe(2);
    expect(endingMore(ending(), 3)).toBe(12);
    expect(endingMore(ending({ booked: 1, waiting: 0 }), 3)).toBe(0);
  });
});

describe('the box’s words', () => {
  it.each([
    [{ booked: 12, waiting: 3, classes: 1 }, '12 people are booked and 3 are on the waitlist'],
    [{ booked: 1, waiting: 0, classes: 1 }, '1 person is booked'],
    [{ booked: 0, waiting: 1, classes: 1 }, '1 person is on the waitlist'],
    // Several classes: the numbers are bookings, and one person on three of them is three.
    [{ booked: 0, waiting: 4, classes: 2 }, '4 waitlist places will end, across 2 classes'],
    [{ booked: 0, waiting: 1, classes: 2 }, '1 waitlist place will end, across 2 classes'],
    [{ booked: 2, waiting: 1, classes: 3 }, '3 bookings will end, 1 of them waitlist places, across 3 classes'],
    [{ booked: 3, waiting: 0, classes: 2 }, '3 bookings will end, across 2 classes'],
    [{ booked: 1200, waiting: 0, classes: 40 }, '1,200 bookings will end, across 40 classes'],
  ])('%j reads "%s"', (counts, words) => {
    expect(endingTitle(ending(counts))).toBe(words);
  });

  it('says what happens to them, for one booking and for several', () => {
    expect(endingChangeLine(ending({ booked: 1, waiting: 0 }))).toBe('Their booking ends. If it used a class from a pack, the class goes back on the pack.');
    expect(endingChangeLine(ending())).toBe('Their bookings end. A booking that used a class from a pack puts the class back on the pack.');
    // Several classes: the list is of bookings, and the box says so.
    expect(endingChangeLine(ending({ classes: 3 }))).toBe(
      'Each is listed below; somebody booked on several of these classes is there once for each. A booking that used a class from a pack puts the class back on the pack.',
    );
  });

  it('says who does not change, for each kind of change', () => {
    expect(endingKeptLine('cancel')).toBe("Nobody else's bookings change.");
    expect(endingKeptLine('slot')).toBe("Bookings for other classes and time slots don't change.");
    expect(endingKeptLine('class')).toBe("Bookings for other classes and time slots don't change.");
    expect(endingKeptLine('move', '2026-10-12')).toBe("Bookings for classes before Mon 12 Oct don't change.");
    expect(endingKeptLine('move', undefined)).toBe("Bookings for classes before that date don't change.");
  });

  it('names the change and the number on the button', () => {
    expect(endingConfirmLabel('cancel', ending())).toBe('Cancel class and end 15 bookings');
    expect(endingConfirmLabel('slot', ending({ booked: 1, waiting: 0 }))).toBe('Cancel time slot and end 1 booking');
    expect(endingConfirmLabel('class', ending({ booked: 1500, waiting: 0 }))).toBe('Archive class and end 1,500 bookings');
    expect(endingConfirmLabel('move', ending({ booked: 2, waiting: 0 }))).toBe('Move time slot and end 2 bookings');
  });

  it('draws a person with the class their booking is for', () => {
    expect(endingPersonLine(person(), '24h')).toEqual({ name: 'Asha Rao', detail: 'Yoga · Mon 12 Oct · 18:00' });
    expect(endingPersonLine(person({ waiting: true }), '12h')).toEqual({ name: 'Asha Rao', detail: 'Yoga · Mon 12 Oct · 6:00 PM · On the waitlist' });
    expect(endingPersonLine(person({ name: null }), '24h').name).toBe('No name');
  });
});

describe('the four booking settings', () => {
  const START = { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440, waitlistMax: 20 };

  it.each([
    [0, { amount: '0', unit: 'hours' }],
    [45, { amount: '45', unit: 'minutes' }],
    [90, { amount: '90', unit: 'minutes' }],
    [120, { amount: '2', unit: 'hours' }],
    [1440, { amount: '1', unit: 'days' }],
    [2160, { amount: '36', unit: 'hours' }],
    [10080, { amount: '7', unit: 'days' }],
  ])('%i minutes is shown as %j', (minutes, shown) => {
    expect(minutesAsUnit(minutes)).toEqual(shown);
  });

  // Personal training's own two (17e-vi), set apart from the classes' so a mix-up shows.
  const PT = { opensDays: 3, freeCancelMinutes: 1440 };

  it('opens with what is saved, and saves back the same minutes', () => {
    const draft = bookingSettingsDraft(START, PT);
    expect(draft).toEqual({
      opensDays: '7',
      freeAmount: '2',
      freeUnit: 'hours',
      handoverAmount: '1',
      handoverUnit: 'days',
      waitlistMax: '20',
      ptOpensDays: '3',
      ptFreeAmount: '1',
      ptFreeUnit: 'days',
    });
    expect(bookingSettingsBody(draft)).toEqual({ ...START, pt: PT });
    expect(bookingSettingsChanged(draft, START, PT)).toBe(false);
    expect(bookingSettingsProblem(draft)).toBeNull();
  });

  it('turns the unit into minutes', () => {
    const draft = { ...bookingSettingsDraft(START, PT), freeAmount: '90', freeUnit: 'minutes', handoverAmount: '3', handoverUnit: 'hours' };
    expect(bookingSettingsBody(draft)).toEqual({ ...START, freeCancelMinutes: 90, handoverMinutes: 180, pt: PT });
    expect(bookingSettingsChanged(draft, START, PT)).toBe(true);
  });

  it('personal training’s two are their own: changing one leaves the classes’ four, and the other way round', () => {
    const ptOnly = { ...bookingSettingsDraft(START, PT), ptOpensDays: '14', ptFreeAmount: '45', ptFreeUnit: 'minutes' };
    expect(bookingSettingsBody(ptOnly)).toEqual({ ...START, pt: { opensDays: 14, freeCancelMinutes: 45 } });
    expect(bookingSettingsChanged(ptOnly, START, PT)).toBe(true);
    const classesOnly = { ...bookingSettingsDraft(START, PT), opensDays: '14', freeAmount: '45', freeUnit: 'minutes' };
    expect(bookingSettingsBody(classesOnly)).toEqual({ ...START, opensDays: 14, freeCancelMinutes: 45, pt: PT });
    // What was saved for one is never read as the other's.
    expect(bookingSettingsChanged(bookingSettingsDraft(START, PT), START, { opensDays: 7, freeCancelMinutes: 120 })).toBe(true);
    expect(bookingSettingsChanged(bookingSettingsDraft(START, PT), { ...START, opensDays: 3, freeCancelMinutes: 1440 }, PT)).toBe(true);
  });

  it.each([
    [{ opensDays: '' }, 'Type a whole number in each box.'],
    [{ waitlistMax: '1.5' }, 'Type a whole number in each box.'],
    [{ ptOpensDays: '' }, 'Type a whole number in each box.'],
    [{ ptFreeAmount: '' }, 'Type a whole number in each box.'],
    [{ opensDays: '0' }, 'Classes, when booking opens: pick 1 to 56 days.'],
    [{ opensDays: '57' }, 'Classes, when booking opens: pick 1 to 56 days.'],
    [{ freeAmount: '8', freeUnit: 'days' }, 'Classes, free cancelling: pick 0 to 7 days.'],
    [{ ptOpensDays: '0' }, 'Personal training, when booking opens: pick 1 to 56 days.'],
    [{ ptOpensDays: '57' }, 'Personal training, when booking opens: pick 1 to 56 days.'],
    [{ ptFreeAmount: '8', ptFreeUnit: 'days' }, 'Personal training, free cancelling: pick 0 to 7 days.'],
    [{ ptFreeAmount: '169', ptFreeUnit: 'hours' }, 'Personal training, free cancelling: pick 0 to 7 days.'],
    [{ handoverAmount: '169', handoverUnit: 'hours' }, 'The waitlist time: pick 0 to 7 days.'],
    [{ waitlistMax: '101' }, 'The waitlist size: pick 0 to 100 people.'],
  ])('%j is refused: %s', (patch, words) => {
    expect(bookingSettingsProblem({ ...bookingSettingsDraft(START, PT), ...patch })).toBe(words);
  });

  it('allows each end of each range', () => {
    const least = { opensDays: '1', freeAmount: '0', freeUnit: 'minutes', handoverAmount: '0', handoverUnit: 'days', waitlistMax: '0', ptOpensDays: '1', ptFreeAmount: '0', ptFreeUnit: 'minutes' };
    const most = { opensDays: '56', freeAmount: '7', freeUnit: 'days', handoverAmount: '168', handoverUnit: 'hours', waitlistMax: '100', ptOpensDays: '56', ptFreeAmount: '168', ptFreeUnit: 'hours' };
    expect(bookingSettingsProblem(least)).toBeNull();
    expect(bookingSettingsProblem(most)).toBeNull();
    expect(bookingSettingsBody(most).pt).toEqual({ opensDays: 56, freeCancelMinutes: 10080 });
  });

  it('says what a save did: a shorter waitlist time can book people who were waiting', () => {
    expect(bookingSettingsSavedLine(undefined)).toBe('Saved.');
    expect(bookingSettingsSavedLine(0)).toBe('Saved.');
    expect(bookingSettingsSavedLine(1)).toBe('Saved. 1 person moved in from a waitlist.');
    expect(bookingSettingsSavedLine(4)).toBe('Saved. 4 people moved in from waitlists.');
  });

  it('sums the settings up in the closed section', () => {
    expect(bookingSettingsSummary(null)).toBe('When members can book and cancel, and how the waitlist works');
    expect(bookingSettingsSummary(START, PT)).toBe(
      'Classes: opens 7 days before · free to cancel until 2 hours before · waitlist of 20. Personal training: opens 3 days before · free to cancel until 1 day before.',
    );
    expect(bookingSettingsSummary({ opensDays: 1, freeCancelMinutes: 0, handoverMinutes: 0, waitlistMax: 0 }, { opensDays: 1, freeCancelMinutes: 0 })).toBe(
      'Classes: opens 1 day before · free to cancel until the start · no waitlist. Personal training: opens 1 day before · free to cancel until the start.',
    );
    // With personal training's two not read, they are left out, never made up.
    expect(bookingSettingsSummary(START)).toBe('Classes: opens 7 days before · free to cancel until 2 hours before · waitlist of 20');
  });
});
