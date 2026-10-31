import { describe, expect, it } from 'vitest';
import { memberGymEventSchema } from '@app/shared';
import * as browser from './eventsView';
import * as phone from '../../../../mobile/src/screens/gym/eventsView.ts';

// The phone's Events says an event with its own copy of these sentences (Stage 5 item 17c-i). The two never differ,
// but for the phone's curly apostrophe, its upper-case AM and PM, and its waitlist line with no "doesn't tell you yet".

const straight = (text) => (typeof text === 'string' ? text.replaceAll('’', "'") : text);
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

describe('an event reads the same on the phone and in the browser', () => {
  it.each(every.map((e, i) => [i, e]))('case %i', (_, e) => {
    expect(straight(phone.eventPlacesLeft(e))).toBe(browser.eventPlacesLeft(e));
    const mine = phone.eventMine(e);
    expect(mine === null ? null : { ...mine, text: straight(mine.text) }).toEqual(browser.eventMine(e));
    expect(phone.eventActions(e).map((a) => ({ ...a, label: straight(a.label) }))).toEqual(browser.eventActions(e));
    expect(straight(phone.eventWhyNot(e))).toBe(browser.eventWhyNot(e));
    expect(phone.givingUpAsks(e)).toBe(browser.givingUpAsks(e));
    expect(phone.eventWhen(e, '2026-10-31', '12h').toLowerCase()).toBe(browser.eventWhen(e, '2026-10-31').toLowerCase());
    expect(phone.waitlistNote(e) === null).toBe(browser.waitlistNote(e) === null);
  });

  it('the fixed sentences', () => {
    expect(straight(phone.noEvents('Iron House'))).toBe(browser.noEvents('Iron House'));
    const e = event();
    expect(straight(phone.eventsZoneNote([e], 'Iron House', 'Asia/Kolkata', 'America/New_York'))).toBe(
      browser.eventsZoneNote([e], 'Iron House', 'Asia/Kolkata', 'America/New_York').replace("this device's", "this phone's"),
    );
  });
});
