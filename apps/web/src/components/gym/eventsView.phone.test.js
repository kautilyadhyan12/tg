import { describe, expect, it } from 'vitest';
import { memberGymEventSchema } from '@app/shared';
import * as browser from './eventsView';
import * as phone from '../../../../mobile/src/screens/gym/eventsView.ts';

// The phone's Events has its own words, the phone's Classes' (Kd, 2026-10-31); the browser keeps its own. What each
// offers and asks must still agree (Stage 5 item 17c-i): the same buttons, the same box, the same day and time.

const can = (over = {}) => ({ come: false, joinWaitlist: false, claim: false, cancel: false, why: null, ...over });
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
    going: { coming: 0, waiting: 0, mine: null, can: can(), ...going },
  });

const COMING = { status: 'coming', waitlistPlace: null };
const waiting = (place) => ({ status: 'waitlisted', waitlistPlace: place });
const every = [
  event({}, { can: can({ come: true }) }),
  event({ places: null }, { can: can({ come: true }) }),
  event({ places: null }, { coming: 1200, mine: COMING, can: can({ cancel: true }) }),
  event({ places: 1 }, { coming: 1, can: can({ joinWaitlist: true }) }),
  event({ places: 1 }, { coming: 1, waiting: 3, mine: waiting(2), can: can({ cancel: true }) }),
  event({}, { coming: 29, waiting: 1, mine: waiting(1), can: can({ claim: true, cancel: true }) }),
  event({}, { coming: 30, mine: waiting(null), can: can({ cancel: true }) }),
  event({}, { coming: 30, waiting: 5, can: can({ why: 'waitlist_full' }) }),
  event({}, { coming: 30, can: can({ why: 'event_full' }) }),
  event({}, { can: can({ why: 'event_started' }) }),
  event({}, { mine: waiting(11), can: can({ why: 'event_started' }) }),
  event({}, { coming: 30, mine: COMING }),
  event({}, { coming: 30, waiting: 1, mine: COMING, can: can({ cancel: true }) }),
  event({ cancelled: true }, { mine: COMING, can: can({ why: 'event_cancelled' }) }),
  event({ endsOn: '2026-11-03', endMinute: 240 }),
  event({ startsOn: '2027-01-02', endsOn: '2027-01-02' }),
];

describe('an event offers the same on the phone and in the browser', () => {
  it.each(every.map((e, i) => [i, e]))('case %i', (_, e) => {
    expect(phone.eventPlacesLeft(e) === null).toBe(browser.eventPlacesLeft(e) === null);
    expect(phone.eventMine(e) === null).toBe(browser.eventMine(e) === null);
    expect(phone.eventActions(e).map((a) => [a.kind, a.main])).toEqual(browser.eventActions(e).map((a) => [a.kind, a.main]));
    expect(phone.givingUpAsks(e)).toBe(browser.givingUpAsks(e));
    expect(phone.eventWhen(e, '2026-10-31', '12h').toLowerCase()).toBe(browser.eventWhen(e, '2026-10-31').toLowerCase());
    expect(phone.waitlistNote(e) === null).toBe(browser.waitlistNote(e) === null);
  });

});
