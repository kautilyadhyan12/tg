// The console's Events form, as rules (ROADMAP 19c-i; spec Part 3 §15.4), and the words an
// event is printed in on both screens.
import { describe, expect, it } from 'vitest';
import { addGymEventRequestSchema, changeGymEventRequestSchema } from '@app/shared';
import { eventIsOn, eventPlaces, eventWhen, eventsZoneNote } from '../../components/gym/eventsView';
import { cancelBox, clockOf, dayAfter, detailsLine, draftOf, eventProblem, fieldsOf, minuteOf, newEventDraft, pastTitle, withStartDay } from './eventsView';

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
      [good({ details: 'x'.repeat(2001) }), 'details', 'Keep the details to 2,000 characters.'],
    ];
    for (const [draft, field, text] of cases) expect(eventProblem(draft), text).toEqual({ field, text });
    const fine = [good(), good({ endsOn: '2026-10-18', endTime: '09:00' }), good({ endsOn: '2026-11-17' }), good({ unlimited: false, places: ' 40 ' }), good({ unlimited: true, places: 'junk' }), good({ name: 'x'.repeat(80) })];
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
    expect(detailsLine('')).toEqual({ over: false, text: '2,000 characters left' });
    expect(detailsLine('x'.repeat(2003))).toEqual({ over: true, text: '3 characters too many' });
    expect(cancelBox(EVENT, { people: 'members' })).toEqual({
      title: 'Cancel Saturday Open Day?',
      lines: ['Your members still see it on their Events list, marked Cancelled, until Sat 17 Oct.', 'Nobody is emailed. You can un-cancel it until then.'],
      yes: 'Cancel event',
      no: 'Keep it',
    });
    expect(pastTitle({ past: [EVENT], pastTotal: 1 })).toBe('Past events (1)');
    expect(pastTitle({ past: Array(50).fill(EVENT), pastTotal: 73 })).toBe('Past events (the newest 50 of 73)');
  });
});
