import { describe, expect, it } from 'vitest';
import { eventBookingSettings, eventGoing, memberGymEventSchema } from '@app/shared';
import * as browser from './eventsView';
import * as phone from '../../../../mobile/src/screens/gym/eventsView.ts';

// The phone's Events has its own words, the phone's Classes' (Kd, 2026-10-31); the browser keeps its own. What each
// offers and asks must still agree (Stage 5 item 17c-i): the same buttons, the same box, the same day and time.

const event = (over = {}, going = {}) =>
  memberGymEventSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Open day',
    details: '',
    place: '',
    startsOn: '2026-11-02',
    startMinute: 600,
    endsOn: '2026-11-02',
    endMinute: 780,
    startsAt: '2026-11-02T04:30:00.000Z',
    endsAt: '2026-11-02T07:30:00.000Z',
    places: 30,
    cancelled: false,
    poster: null,
    ...over,
    going: eventGoing({
      nowMs: going.started === true ? Date.parse('2026-11-02T05:00:00.000Z') : Date.parse('2026-10-20T05:00:00.000Z'),
      startsAtMs: Date.parse(over.startsAt ?? '2026-11-02T04:30:00.000Z'),
      cancelled: over.cancelled ?? false,
      places: over.places === undefined ? 30 : over.places,
      coming: going.coming ?? 0,
      waitlisted: going.waiting ?? 0,
      settings: eventBookingSettings({ handoverMinutes: going.handover ?? 1440, waitlistMax: going.waitlistMax ?? 20 }),
      mine: going.mine ?? null,
      waitlistPlace: going.place ?? null,
    }),
  });

// `going` comes from the server's own rule, so no state appears here that it never sends.
const every = [
  event(),
  event({ places: null }),
  event({ places: null }, { coming: 1200, mine: 'coming' }),
  event({ places: 1 }, { coming: 1 }),
  event({ places: 1 }, { coming: 1, waiting: 3, mine: 'waitlisted', place: 2 }),
  event({}, { coming: 29, waiting: 1, mine: 'waitlisted', place: 1, handover: 100000 }),
  event({}, { coming: 30, mine: 'waitlisted' }),
  event({}, { coming: 30, waiting: 5, waitlistMax: 5 }),
  event({}, { coming: 30, waitlistMax: 0 }),
  event({}, { started: true }),
  event({}, { started: true, mine: 'waitlisted', place: 11 }),
  event({}, { started: true, coming: 30, mine: 'coming' }),
  event({}, { coming: 30, waiting: 1, mine: 'coming' }),
  event({ endsOn: '2026-11-03', endMinute: 240 }),
  event({ startsOn: '2027-01-02', endsOn: '2027-01-02' }),
];
const cancelled = [event({ cancelled: true }), event({ cancelled: true }, { coming: 30, mine: 'coming' }), event({ cancelled: true }, { coming: 30, waiting: 1, mine: 'waitlisted', place: 1 })];

describe('an event offers the same on the phone and in the browser', () => {
  it.each(every.map((e, i) => [i, e]))('case %i', (_, e) => {
    expect(phone.eventPlacesLeft(e) === null).toBe(browser.eventPlacesLeft(e) === null);
    expect(phone.eventMine(e) === null).toBe(browser.eventMine(e) === null);
    expect(phone.eventActions(e).map((a) => [a.kind, a.main])).toEqual(browser.eventActions(e).map((a) => [a.kind, a.main]));
    expect(phone.givingUpAsks(e)).toBe(browser.givingUpAsks(e));
    expect(phone.eventWhen(e, '2026-10-31', '12h').toLowerCase()).toBe(browser.eventWhen(e, '2026-10-31').toLowerCase());
    expect(phone.waitlistNote(e) === null).toBe(browser.waitlistNote(e) === null);
  });

  // The phone offers nothing on a cancelled event, as giving a place up there loses it if the event comes back.
  it.each(cancelled.map((e, i) => [i, e]))('a cancelled event offers nothing on the phone: case %i', (_, e) => {
    expect(phone.eventActions(e)).toEqual([]);
    expect(phone.givingUpAsks(e)).toBe(false);
  });
});
