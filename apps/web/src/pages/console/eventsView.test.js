// The console's Events form, as rules (ROADMAP 19c-i; spec Part 3 §15.4), and the words an
// event is printed in on both screens.
import { describe, expect, it } from 'vitest';
import { addGymEventRequestSchema, changeGymEventRequestSchema } from '@app/shared';
import { eventIsOn, eventPlaces, eventWhen, eventsZoneNote } from '../../components/gym/eventsView';
import {
  cancelBox,
  changeHint,
  clockOf,
  dayAfter,
  detailsLine,
  draftOf,
  eventProblem,
  eventTaken,
  fieldsOf,
  minuteOf,
  namesLine,
  newEventDraft,
  pastTitle,
  peopleHeading,
  placesHint,
  posterBox,
  removeBox,
  sameAsSent,
  withStartDay,
} from './eventsView';

const EVENT = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Saturday Open Day',
  details: 'Bring a friend.',
  place: 'Main hall',
  startsOn: '2026-10-17',
  startMinute: 600,
  endsOn: '2026-10-17',
  endMinute: 780,
  startsAt: '2026-10-17T09:00:00.000Z',
  endsAt: '2026-10-17T12:00:00.000Z',
  places: 40,
  cancelled: false,
  poster: null,
};
const good = (over = {}) => ({ ...newEventDraft(), name: 'Saturday Open Day', startsOn: '2026-10-17', startTime: '10:00', endsOn: '2026-10-17', endTime: '13:00', ...over });

describe('an event in words', () => {
  it('says its day and times on the gym’s clock, and both days when it runs past one', () => {
    expect(eventWhen(EVENT)).toBe('Sat 17 Oct · 10:00 am – 1:00 pm');
    expect(eventWhen({ ...EVENT, endsOn: '2026-10-18', endMinute: 960 })).toBe('Sat 17 Oct, 10:00 am – Sun 18 Oct, 4:00 pm');
    expect(eventWhen({ ...EVENT, startMinute: 0, endMinute: 725 })).toBe('Sat 17 Oct · 12:00 am – 12:05 pm');
    // The year is said only where it is not the year of the gym's today.
    expect(eventWhen(EVENT, '2026-10-07')).toBe('Sat 17 Oct · 10:00 am – 1:00 pm');
    expect(eventWhen({ ...EVENT, startsOn: '2027-10-16', endsOn: '2027-10-16' }, '2026-10-07')).toBe('Sat 16 Oct 2027 · 10:00 am – 1:00 pm');
    expect(eventWhen({ ...EVENT, startsOn: '2026-12-31', endsOn: '2027-01-01', endMinute: 60 }, '2026-10-07')).toBe('Thu 31 Dec, 10:00 am – Fri 1 Jan 2027, 1:00 am');
  });

  it('counts places, and says nothing for no limit', () => {
    expect(eventPlaces(EVENT)).toBe('40 places');
    expect(eventPlaces({ ...EVENT, places: 1 })).toBe('1 place');
    expect(eventPlaces({ ...EVENT, places: 2500 })).toBe('2,500 places');
    expect(eventPlaces({ ...EVENT, places: null })).toBeNull();
  });

  it('is on from its start until its end', () => {
    expect(eventIsOn(EVENT, Date.parse('2026-10-17T08:59:59Z'))).toBe(false);
    expect(eventIsOn(EVENT, Date.parse('2026-10-17T09:00:00Z'))).toBe(true);
    expect(eventIsOn(EVENT, Date.parse('2026-10-17T11:59:59Z'))).toBe(true);
    expect(eventIsOn(EVENT, Date.parse('2026-10-17T12:00:00Z'))).toBe(false);
  });

  it('says whose clock the times are on only where this device’s differs', () => {
    expect(eventsZoneNote([EVENT], 'Iron House', 'Europe/London', 'Europe/London')).toBeNull();
    expect(eventsZoneNote([EVENT], 'Iron House', 'Europe/London', 'Asia/Kolkata')).toBe("Times are Iron House time (Europe/London), not this device's.");
    expect(eventsZoneNote([EVENT], 'Hudson', 'America/New_York', 'not a zone')).toBe("Times are Hudson time (America/New York), not this device's.");
    expect(eventsZoneNote([], 'Iron House', 'Europe/London', 'Asia/Kolkata')).toBeNull();
  });
});

describe('the form', () => {
  it('reads a clock both ways', () => {
    expect(clockOf(600)).toBe('10:00');
    expect(clockOf(5)).toBe('00:05');
    expect(minuteOf('10:00')).toBe(600);
    expect(minuteOf('23:55')).toBe(1435);
    for (const half of ['', '10:', ':30', '24:00', undefined]) expect(minuteOf(half), String(half)).toBeNull();
    expect(dayAfter('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('a new start day brings an unpicked or earlier end day with it, and leaves a later one', () => {
    expect(withStartDay(newEventDraft(), '2026-10-17').endsOn).toBe('2026-10-17');
    expect(withStartDay(good({ endsOn: '2026-10-17' }), '2026-10-20').endsOn).toBe('2026-10-20');
    expect(withStartDay(good({ endsOn: '2026-10-25' }), '2026-10-20').endsOn).toBe('2026-10-25');
  });

  it('names the first thing wrong, in the order the form is read', () => {
    const cases = [
      [newEventDraft(), 'name', 'Give the event a name.'],
      [good({ name: '   ' }), 'name', 'Give the event a name.'],
      // Characters that draw nothing: a zero-width space, a Hangul filler.
      [good({ name: String.fromCodePoint(0x200b, 0x200b) }), 'name', 'Give the event a name.'],
      [good({ name: String.fromCodePoint(0x3164) }), 'name', 'Give the event a name.'],
      [good({ name: 'x'.repeat(81) }), 'name', 'Keep the name to 80 characters.'],
      [good({ startsOn: '' }), 'startsOn', 'Pick the day it starts.'],
      [good({ startTime: '' }), 'startTime', 'Pick the time it starts: the hour and the minute.'],
      [good({ endsOn: '' }), 'endsOn', 'Pick the day it ends.'],
      [good({ endTime: '' }), 'endTime', 'Pick the time it ends: the hour and the minute.'],
      [good({ endTime: '10:00' }), 'endTime', 'The end must be after the start.'],
      [good({ endTime: '09:55' }), 'endTime', 'The end must be after the start.'],
      [good({ endsOn: '2026-10-16' }), 'endTime', 'The end must be after the start.'],
      [good({ endsOn: '2026-11-18' }), 'endsOn', 'An event can run for 31 days at most.'],
      [good({ place: 'x'.repeat(121) }), 'place', 'Keep the place to 120 characters.'],
      [good({ unlimited: false, places: '' }), 'places', 'Type how many places there are, from 1 to 10,000, or tick No limit.'],
      [good({ unlimited: false, places: '0' }), 'places', 'Type how many places there are, from 1 to 10,000, or tick No limit.'],
      [good({ unlimited: false, places: '10001' }), 'places', 'Type how many places there are, from 1 to 10,000, or tick No limit.'],
      [good({ unlimited: false, places: '2.5' }), 'places', 'Type how many places there are, from 1 to 10,000, or tick No limit.'],
      [good({ unlimited: false, places: 'forty' }), 'places', 'Type how many places there are, from 1 to 10,000, or tick No limit.'],
      [good({ details: 'x'.repeat(1001) }), 'details', 'Keep the details to 1,000 characters.'],
    ];
    for (const [draft, field, text] of cases) expect(eventProblem(draft), text).toEqual({ field, text });
    const fine = [good(), good({ endsOn: '2026-10-18', endTime: '09:00' }), good({ endsOn: '2026-11-17' }), good({ unlimited: false, places: ' 40 ' }), good({ unlimited: true, places: 'junk' }), good({ name: 'x'.repeat(80) }), good({ details: 'x'.repeat(1000) }), good({ name: '5K' }), good({ name: String.fromCodePoint(0xc694, 0xac00) })];
    for (const draft of fine) expect(eventProblem(draft)).toBeNull();
  });

  it('sends what the server takes: every draft with no problem passes the server’s own check', () => {
    const key = '00000000-0000-4000-8000-0000000000aa';
    const added = fieldsOf(good({ name: '  Saturday Open Day ', unlimited: false, places: '40', place: ' Main hall ' }), true);
    expect(added).toEqual({ name: 'Saturday Open Day', details: '', place: 'Main hall', startsOn: '2026-10-17', startMinute: 600, endsOn: '2026-10-17', endMinute: 780, places: 40 });
    expect(addGymEventRequestSchema.safeParse({ eventKey: key, ...added }).success).toBe(true);
    expect(fieldsOf(good(), true).places).toBeNull();
    // A typed number under a ticked "No limit" is not sent.
    expect(fieldsOf(good({ unlimited: true, places: '40' }), true).places).toBeNull();
    for (const draft of [good({ endsOn: '2026-11-17' }), good({ endsOn: '2026-10-18', endTime: '00:00' })]) {
      expect(eventProblem(draft)).toBeNull();
      expect(addGymEventRequestSchema.safeParse({ eventKey: key, ...fieldsOf(draft, true) }).success).toBe(true);
    }
  });

  it('a poster is sent when picked, left alone when kept, and taken off only on a change', () => {
    const picked = { kind: 'new', base64: 'QUJD', preview: 'blob:x' };
    expect(fieldsOf(good({ poster: picked }), true).poster).toBe('QUJD');
    expect(fieldsOf(good({ poster: picked }), false).poster).toBe('QUJD');
    expect('poster' in fieldsOf(good({ poster: { kind: 'kept', id: 'p1' } }), false)).toBe(false);
    expect(fieldsOf(good({ poster: { kind: 'none' } }), false).poster).toBeNull();
    expect('poster' in fieldsOf(good({ poster: { kind: 'none' } }), true)).toBe(false);
    expect(changeGymEventRequestSchema.safeParse(fieldsOf(good({ poster: { kind: 'none' } }), false)).success).toBe(true);
  });

  it('opens an event as it is saved', () => {
    expect(draftOf(EVENT)).toEqual({ name: 'Saturday Open Day', details: 'Bring a friend.', place: 'Main hall', startsOn: '2026-10-17', startTime: '10:00', endsOn: '2026-10-17', endTime: '13:00', places: '40', unlimited: false, poster: { kind: 'none' } });
    const withPoster = draftOf({ ...EVENT, places: null, poster: { id: 'p1', width: 800, height: 1000 } });
    expect(withPoster).toMatchObject({ places: '', unlimited: true, poster: { kind: 'kept', id: 'p1' } });
    // Saved again untouched, it sends what it was.
    expect(fieldsOf(draftOf(EVENT), false)).toMatchObject({ name: EVENT.name, startMinute: 600, endMinute: 780, places: 40, poster: null });
  });

  it('counts the details down, and says what a cancel does and to whom', () => {
    expect(detailsLine('')).toEqual({ over: false, text: '1,000 characters left' });
    expect(detailsLine('x'.repeat(1003))).toEqual({ over: true, text: '3 characters too many' });
    expect(cancelBox(EVENT, { people: 'members' })).toEqual({
      title: 'Cancel Saturday Open Day?',
      lines: ['Your members still see it on their Events list, marked Cancelled, until Sat 17 Oct.', 'Nobody is emailed. You can un-cancel it until then.'],
      yes: 'Cancel event',
      no: 'Keep it',
    });
    expect(cancelBox({ ...EVENT, endsOn: '2027-01-02' }, { people: 'members' }, '2026-10-07').lines[0]).toBe('Your members still see it on their Events list, marked Cancelled, until Sat 2 Jan 2027.');
    expect(posterBox(EVENT)).toEqual({ title: 'Remove the poster from Saturday Open Day?', lines: ["The picture is deleted and can't be brought back. The rest of the event stays as it is."], yes: 'Remove poster', no: 'Keep it' });
    // The event the server answers an add with is the one sent, or an earlier press's.
    const sent = fieldsOf(good({ unlimited: false, places: '40' }), true);
    expect(sameAsSent({ ...EVENT, details: '', place: '' }, sent)).toBe(true);
    expect(sameAsSent({ ...EVENT, details: '', place: '', name: 'Saturday Open Dya' }, sent)).toBe(false);
    expect(sameAsSent({ ...EVENT, details: '', place: '', places: null }, sent)).toBe(false);
    expect(pastTitle({ past: [EVENT], pastTotal: 1 })).toBe('Past events (1)');
    expect(pastTitle({ past: Array(50).fill(EVENT), pastTotal: 73 })).toBe('Past events (the newest 50 of 73)');
  });

  it("says how many are coming, and nothing of people until somebody is", () => {
    const taken = (places, coming, waiting, past) => eventTaken({ places, coming, waiting }, past);
    expect(taken(40, 0, 0)).toBe('40 places');
    expect(taken(null, 0, 0)).toBe('No limit on places');
    expect(taken(40, 12, 0)).toBe('40 places · 12 coming');
    expect(taken(1, 1, 0)).toBe('1 place · full');
    expect(taken(40, 40, 3)).toBe('40 places · full · 3 on the waitlist');
    expect(taken(null, 1200, 0)).toBe('No limit on places · 1,200 coming');
    // An event that has ended: what people had said, never "coming".
    expect(taken(40, 12, 2, true)).toBe('40 places · 12 people said they were coming');
    expect(taken(40, 1, 0, true)).toBe('40 places · 1 person said they were coming');
    expect(taken(40, 0, 0, true)).toBe('40 places');
  });

  it('names a few of the people and counts the rest; somebody with no name is counted, never named', () => {
    const people = (...names) => names.map((name, i) => ({ id: String(i), name }));
    expect(namesLine([], 0)).toBeNull();
    expect(namesLine(people('Ann Smith'), 1)).toBe('Ann Smith');
    expect(namesLine(people('Ann Smith', 'Bea Jones', 'Cal Brown'), 3)).toBe('Ann Smith, Bea Jones, Cal Brown');
    expect(namesLine(people('Ann Smith', 'Bea Jones', 'Cal Brown', 'Dee Hall'), 12)).toBe('Ann Smith, Bea Jones, Cal Brown and 9 more');
    expect(namesLine(people(null, 'Bea Jones'), 2)).toBe('Bea Jones and 1 more');
    expect(namesLine(people(null, null), 2)).toBe('2 people');
  });

  it('the cancel box says who is down for the event and that the app does not tell them', () => {
    const busy = { ...EVENT, coming: 12, waiting: 1 };
    const tell = "The app doesn't tell them yet, so let them know yourself. They keep their places if you un-cancel.";
    // Before the names are read, the numbers stand.
    expect(cancelBox(busy, { people: 'members' }, '2026-10-07').lines).toEqual([
      'Your members still see it on their Events list, marked Cancelled, until Sat 17 Oct.',
      "12 people said they're coming.",
      '1 person is on the waitlist.',
      tell,
      'Nobody is emailed. You can un-cancel it until then.',
    ]);
    const read = { coming: [{ id: '1', name: 'Ann Smith' }, { id: '2', name: 'Bea Jones' }, { id: '3', name: 'Cal Brown' }, { id: '4', name: 'Dee Hall' }], waiting: [] };
    expect(cancelBox(busy, { people: 'members' }, '2026-10-07', read).lines[1]).toBe("12 people said they're coming: Ann Smith, Bea Jones, Cal Brown and 9 more.");
    expect(cancelBox({ ...EVENT, coming: 1, waiting: 0 }, { people: 'clients' }, '2026-10-07', { coming: [{ id: '1', name: 'Ann Smith' }], waiting: [] }).lines.slice(1, 3)).toEqual([
      "1 person said they're coming: Ann Smith.",
      tell,
    ]);
    expect(cancelBox({ ...EVENT, coming: 0, waiting: 2 }, { people: 'members' }, '2026-10-07').lines.slice(1, 3)).toEqual(['2 people are on the waitlist.', tell]);
  });

  it('heads the two lists, and says what removing a person does', () => {
    expect(peopleHeading('coming', { places: 40, comingTotal: 12, waitingTotal: 0 })).toBe('Coming (12 of 40)');
    expect(peopleHeading('coming', { places: null, comingTotal: 12, waitingTotal: 0 })).toBe('Coming (12)');
    expect(peopleHeading('waiting', { places: 40, comingTotal: 40, waitingTotal: 3 })).toBe('Waitlist (3), first in line first');
  });

  it('the Remove box says what happens to the place as the server will do it, never a hand-over that will not happen', () => {
    const ann = { id: '1', name: 'Ann Smith' };
    const list = (over = {}) => ({ handsOver: true, started: false, waiting: [{ id: '9', name: 'Cal Brown' }], waitingTotal: 1, ...over });
    const tell = "The app doesn't tell them yet, so let them know yourself.";
    const again = `${tell} They can say they're coming again.`;
    const lines = (waiting, people, event = EVENT) => removeBox(ann, waiting, event, people).lines;
    expect(removeBox(ann, false, EVENT, list())).toEqual({
      title: 'Remove Ann Smith from Saturday Open Day?',
      lines: ['Their place goes to Cal Brown, first on the waitlist.', again],
      yes: 'Remove',
      no: 'Keep them',
    });
    expect(removeBox({ id: '1', name: null }, false, EVENT, list()).title).toBe('Remove this person from Saturday Open Day?');
    // The first in line has no name yet.
    expect(lines(false, list({ waiting: [{ id: '9', name: null }] }))[0]).toBe('Their place goes to the first person, first on the waitlist.');
    // Nobody waiting: nothing is said of the place.
    expect(lines(false, list({ waiting: [], waitingTotal: 0 }))).toEqual([again]);
    // Inside the gym's hand-over time nobody is moved in.
    expect(lines(false, list({ handsOver: false }))).toEqual([
      'Their place is free for the first person to take it. This close to the event, nobody on the waitlist is moved in automatically.',
      again,
    ]);
    // Started: no place moves, and they cannot say they are coming again.
    expect(lines(false, list({ handsOver: false, started: true }))).toEqual([tell]);
    // Cancelled: the same.
    expect(lines(false, list({ handsOver: false }), { ...EVENT, cancelled: true })).toEqual([tell]);
    // Somebody on the waitlist: nobody else moves.
    expect(lines(true, list())).toEqual(['They leave the waitlist. Nobody else moves.', again]);
    expect(lines(true, list({ handsOver: false, started: true }))).toEqual(['They leave the waitlist. Nobody else moves.', tell]);
  });

  it('the form says the fewest places it can have, and that nobody is told of a change', () => {
    expect(placesHint(null)).toBeNull();
    expect(placesHint({ coming: 0, waiting: 3 })).toBeNull();
    expect(placesHint({ coming: 1, waiting: 0 })).toBe("1 person is coming, so places can't be fewer than 1.");
    expect(placesHint({ coming: 12, waiting: 0 })).toBe("12 people are coming, so places can't be fewer than 12.");
    expect(changeHint(null)).toBeNull();
    expect(changeHint({ coming: 0, waiting: 0 })).toBeNull();
    expect(changeHint({ coming: 0, waiting: 1 })).toBe("People have said they're coming. The app doesn't tell them about changes yet, so let them know yourself.");
  });
});
