// A member's words for an event's places (ROADMAP 19c-ii; spec Part 3 §15.4).
import { describe, expect, it } from 'vitest';
import { eventActions, eventMine, eventPlacesLeft, eventWhyNot, givingUpAsks, ordinal } from './eventsView';

const NO = { come: false, joinWaitlist: false, claim: false, cancel: false, why: null };
const event = (places, going, over = {}) => ({ name: 'Open Day', places, cancelled: false, going: { coming: 0, waiting: 0, mine: null, can: NO, ...going }, ...over });
const coming = { status: 'coming', waitlistPlace: null };
const waiting = (place) => ({ status: 'waitlisted', waitlistPlace: place });

describe('places', () => {
  it('says how many are left, never a number below nought', () => {
    const lines = [
      [event(30, { coming: 18 }), '12 of 30 places left'],
      [event(1, { coming: 0 }), '1 of 1 place left'],
      [event(2000, { coming: 500 }), '1,500 of 2,000 places left'],
      [event(30, { coming: 30 }), 'Full'],
      [event(30, { coming: 30, waiting: 3 }), 'Full · 3 on the waitlist'],
      // Places cut by staff is refused below the people coming, but a line never reads "-1".
      [event(30, { coming: 31 }), 'Full'],
      [event(null, { coming: 12 }), '12 coming'],
      // No limit and nobody yet: nothing to say, and no "0 coming".
      [event(null, { coming: 0 }), null],
    ];
    for (const [given, text] of lines) expect(eventPlacesLeft(given), JSON.stringify(given.going)).toBe(text);
  });

  it('counts a place in line the way people say it', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });
});

describe("the member's own line and buttons", () => {
  it('says what they are down for', () => {
    expect(eventMine(event(30, {}))).toBeNull();
    expect(eventMine(event(30, { mine: coming }))).toEqual({ text: "You're coming", good: true });
    expect(eventMine(event(30, { mine: waiting(2) }))).toEqual({ text: "You're 2nd on the waitlist", good: false });
    expect(eventMine(event(30, { mine: waiting(1), can: { ...NO, claim: true } }))).toEqual({ text: 'A place is free for you. Take it before somebody else does.', good: true });
  });

  it('offers only what the server says they can do', () => {
    const labels = (going) => eventActions(event(30, going)).map((a) => [a.label, a.kind]);
    expect(labels({ can: { ...NO, come: true } })).toEqual([["I'm coming", 'come']]);
    expect(labels({ can: { ...NO, joinWaitlist: true } })).toEqual([['Join the waitlist', 'wait']]);
    expect(labels({ mine: coming, can: { ...NO, cancel: true } })).toEqual([["Can't come", 'cancel']]);
    expect(labels({ mine: waiting(1), can: { ...NO, claim: true, cancel: true } })).toEqual([['Take the place', 'come'], ['Leave the waitlist', 'cancel']]);
    expect(labels({ can: NO })).toEqual([]);
  });

  it('says why there is no button, where the card does not already', () => {
    expect(eventWhyNot(event(30, { can: { ...NO, why: 'waitlist_full' } }))).toBe('This event and its waitlist are full.');
    expect(eventWhyNot(event(30, { can: { ...NO, why: 'event_started' } }))).toBe("This event has started, so it's too late to say you're coming.");
    expect(eventWhyNot(event(30, { mine: coming, can: NO }))).toBe("This event has started, so this can't be changed.");
    // A cancelled event's own line says it.
    expect(eventWhyNot(event(30, { can: { ...NO, why: 'event_cancelled' } }, { cancelled: true }))).toBeNull();
    expect(eventWhyNot(event(30, { can: { ...NO, come: true } }))).toBeNull();
  });

  it('asks before a place is given up only where somebody else would take it', () => {
    expect(givingUpAsks(event(30, { coming: 30, mine: coming }))).toBe(true);
    expect(givingUpAsks(event(30, { coming: 29, waiting: 1, mine: coming }))).toBe(true);
    expect(givingUpAsks(event(30, { coming: 12, mine: coming }))).toBe(false);
    expect(givingUpAsks(event(null, { coming: 500, mine: coming }))).toBe(false);
    expect(givingUpAsks(event(30, { coming: 30, waiting: 2, mine: waiting(1) }))).toBe(false);
  });
});
