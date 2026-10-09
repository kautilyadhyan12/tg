// Online classes on the console, and the box that asks before staff take a person off a
// class, in words (spec Part 3 §13.3, §13.4; ROADMAP 17g). What each should say is
// written out here from the plan, not read back from the code.
import { describe, expect, it } from 'vitest';
import { removeAsk } from './classBookingsListView';
import { repeatDraft, repeatProblem, repeatRequest } from './classesView';
import {
  onlineAffectedLine,
  onlineButton,
  onlineChanged,
  onlineDraft,
  onlineLine,
  onlineNeedsLink,
  onlineProblem,
  onlineRequest,
  onlineScopeNote,
} from './classOnlineView';

const LINK = 'https://us02web.zoom.us/j/81234567890?pwd=abc';

describe('the Online class tick and its link', () => {
  it('a time slot or class at the gym says nothing; an online one says whether its link is there', () => {
    expect(onlineLine({ online: false, onlineLink: null })).toBe('');
    expect(onlineLine(undefined)).toBe('');
    expect(onlineLine({ online: true, onlineLink: LINK })).toBe('Online class · link added');
    expect(onlineLine({ online: true, onlineLink: null })).toBe('Online class · no link yet');
    expect(onlineNeedsLink({ online: true, onlineLink: null })).toBe(true);
    expect(onlineNeedsLink({ online: true, onlineLink: LINK })).toBe(false);
    expect(onlineNeedsLink({ online: false, onlineLink: null })).toBe(false);
  });

  it('the button names what it will do', () => {
    expect(onlineButton({ online: false, onlineLink: null })).toBe('Make it online');
    expect(onlineButton({ online: true, onlineLink: null })).toBe('Add the link');
    expect(onlineButton({ online: true, onlineLink: LINK })).toBe('Change link');
  });

  it('sends both answers every time, and never a link for a class at the gym', () => {
    expect(onlineRequest({ online: true, link: `  ${LINK}  ` })).toEqual({ online: true, onlineLink: LINK });
    expect(onlineRequest({ online: true, link: '' })).toEqual({ online: true, onlineLink: null });
    expect(onlineRequest({ online: false, link: LINK })).toEqual({ online: false, onlineLink: null });
    expect(onlineRequest(onlineDraft({ online: true, onlineLink: LINK }))).toEqual({ online: true, onlineLink: LINK });
  });

  it.each(['http://zoom.us/j/1', 'zoom.us/j/1', '812 3456 7890', 'javascript:alert(1)', 'https://coach:secret@zoom.us/j/1'])(
    'refuses %s in plain words, and sends nothing',
    (link) => {
      expect(onlineProblem({ online: true, link })).toBe('Paste the whole link, starting with https://');
      expect(onlineRequest({ online: true, link })).toBeNull();
      // Unticked, what is left in the box is nobody's problem.
      expect(onlineProblem({ online: false, link })).toBeNull();
    },
  );

  it('a capital H from a phone is taken, and sent as https://', () => {
    expect(onlineProblem({ online: true, link: 'Https://meet.google.com/abc-defg-hij' })).toBeNull();
    expect(onlineRequest({ online: true, link: 'Https://meet.google.com/abc-defg-hij' })).toEqual({ online: true, onlineLink: 'https://meet.google.com/abc-defg-hij' });
    expect(onlineProblem({ online: true, link: 'https://zoom.us/j/555\u200b111' })).toBe('Paste the whole link, starting with https://');
  });

  it('says how many people a change reaches, from the server’s count, and nothing until it is known', () => {
    expect(onlineAffectedLine('class', null)).toBe('');
    expect(onlineAffectedLine('slot', {})).toBe('');
    expect(onlineAffectedLine('class', { classes: 1, booked: 0 })).toBe('Nobody is booked on this class yet.');
    expect(onlineAffectedLine('class', { classes: 1, booked: 1 })).toBe('1 person is booked on this class.');
    expect(onlineAffectedLine('class', { classes: 1, booked: 14 })).toBe('14 people are booked on this class.');
    expect(onlineAffectedLine('slot', { classes: 0, booked: 0 })).toBe('This time slot has no coming classes to change.');
    expect(onlineAffectedLine('slot', { classes: 8, booked: 0 })).toBe('Nobody is booked on the 8 coming classes this changes yet.');
    expect(onlineAffectedLine('slot', { classes: 1, booked: 1 })).toBe('1 booking is held on the 1 coming class this changes.');
    expect(onlineAffectedLine('slot', { classes: 57, booked: 1140 })).toBe('1,140 bookings are held on the 57 coming classes this changes.');
  });

  it('Save is for a change only', () => {
    const holder = { online: true, onlineLink: LINK };
    expect(onlineChanged(holder, onlineDraft(holder))).toBe(false);
    expect(onlineChanged(holder, { online: true, link: `${LINK}x` })).toBe(true);
    expect(onlineChanged(holder, { online: false, link: LINK })).toBe(true);
    expect(onlineChanged({ online: false, onlineLink: null }, { online: false, link: 'typed and then unticked' })).toBe(false);
  });

  it('says what Save changes', () => {
    expect(onlineScopeNote('slot', {})).toBe('This changes every coming class of this time slot, except a class you gave a link of its own.');
    expect(onlineScopeNote('class', { onlineAlone: false })).toBe('This changes this class only. It then keeps its own link when the time slot’s link changes.');
    expect(onlineScopeNote('class', { onlineAlone: true })).toBe('This changes this class only. It already has a link of its own.');
  });

  it('a new time slot: not online unless ticked, and a bad link stops the save', () => {
    const draft = { ...repeatDraft({ minutes: 45, places: 12, coachUserId: null }, '2026-10-20'), weekdays: [2] };
    expect(draft).toMatchObject({ online: false, link: '' });
    expect(repeatRequest(draft)).toEqual({ weekdays: [2], startMinute: 1080, startsOn: '2026-10-20', minutes: 45, places: 12, coachUserId: null });
    expect(repeatRequest({ ...draft, online: true, link: LINK })).toMatchObject({ online: true, onlineLink: LINK });
    expect(repeatRequest({ ...draft, online: true, link: '' })).toMatchObject({ online: true, onlineLink: null });
    expect(repeatProblem({ ...draft, online: true, link: 'zoom.us/j/1' })).toBe('Paste the whole link, starting with https://');
    expect(repeatRequest({ ...draft, online: true, link: 'zoom.us/j/1' })).toBeNull();
    // A link left typed under an unticked box is not sent.
    expect(repeatRequest({ ...draft, online: false, link: LINK })).toEqual({ weekdays: [2], startMinute: 1080, startsOn: '2026-10-20', minutes: 45, places: 12, coachUserId: null });
  });
});

describe('the box that asks before staff take one person off a class', () => {
  const list = (over = {}) => ({ className: 'Spin', canRemove: true, online: false, waitlisted: [], ...over });
  const booking = (over = {}) => ({ bookingId: 'b1', name: 'Maya Shah', status: 'booked', packCharged: false, ...over });

  it('names the person and the class, says what happens to them, and that nobody else changes', () => {
    expect(removeAsk(booking(), list())).toEqual({
      button: { label: 'Remove from class', aria: 'Remove Maya Shah from Spin' },
      title: 'Remove Maya Shah from Spin?',
      lines: [
        'Their place is cancelled. It is not counted as a late cancel.',
        'Nobody else in this class is changed.',
        "The app doesn't tell them yet. Tell them yourself.",
      ],
      yes: 'Yes, remove from class',
      no: 'Keep them',
    });
  });

  it('adds a line for a pack, for a waitlist and for an online class, each only where it is true', () => {
    const lines = (b, l) => removeAsk(b, l).lines;
    expect(lines(booking({ packCharged: true }), list())).toContain('The class goes back on their pack.');
    expect(lines(booking(), list())).not.toContain('The class goes back on their pack.');
    expect(lines(booking(), list({ waitlisted: [{}] }))).toContain('The free place goes to the waitlist, by your booking rules.');
    expect(lines(booking(), list())).not.toContain('The free place goes to the waitlist, by your booking rules.');
    expect(lines(booking(), list({ online: true }))).toContain('They stop seeing the link to this online class.');
    expect(lines(booking(), list())).not.toContain('They stop seeing the link to this online class.');
  });

  it('a coach, who is not sent what a person paid with, is told what happens if a pack paid', () => {
    const lines = removeAsk(booking({ packCharged: null }), list()).lines;
    expect(lines).toContain('If a pack paid for this class, the class goes back on it.');
    expect(lines).not.toContain('The class goes back on their pack.');
    expect(removeAsk(booking({ packCharged: false }), list()).lines.join(' ')).not.toMatch(/pack/);
  });

  it('somebody waiting leaves the waitlist, and no place or pack is spoken of', () => {
    const ask = removeAsk(booking({ status: 'waitlisted', packCharged: true }), list({ online: true, waitlisted: [{}, {}] }));
    expect(ask.button).toEqual({ label: 'Remove from waitlist', aria: 'Remove Maya Shah from the waitlist' });
    expect(ask.title).toBe('Remove Maya Shah from the waitlist of Spin?');
    expect(ask.lines).toEqual(['They leave the waitlist. Nobody else moves.', 'Nobody else in this class is changed.', "The app doesn't tell them yet. Tell them yourself."]);
    expect(ask.yes).toBe('Yes, remove from waitlist');
  });

  it('a place a check-in marked came before the start is removed like a booked one', () => {
    expect(removeAsk(booking({ status: 'attended' }), list()).button.label).toBe('Remove from class');
  });

  it('no button once the class has started or is cancelled, or for a place already given up', () => {
    expect(removeAsk(booking(), list({ canRemove: false }))).toBeNull();
    expect(removeAsk(booking(), {})).toBeNull();
    for (const status of ['cancelled', 'late_cancelled', 'no_show']) expect(removeAsk(booking({ status }), list())).toBeNull();
  });

  it('somebody with no name is still asked about plainly', () => {
    expect(removeAsk(booking({ name: null }), list()).title).toBe('Remove this person from Spin?');
  });
});
