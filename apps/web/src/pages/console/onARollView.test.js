// "On a roll" and its one tap, proved without a browser. The render test next
// door proves the screen draws these answers; this file proves the answers.
//
// **THE FIXTURES CARRY ROWS WHERE THE TWO STREAK FIGURES DISAGREE, AND THAT IS
// THE WHOLE DESIGN OF THIS FILE.** Kd ruled both units — *"both weeks and days
// run"* — and a fixture where `weeksRunning` and `daysRunning` move together
// cannot see a sentence built from the wrong one. That is not a hypothetical:
// C155 passed under its own mutant on this exact screen one card ago, because
// its fixture served a percentage that matched the arithmetic the mutant
// substituted (:30399 §6).
import { describe, expect, it } from 'vitest';
import { ON_A_ROLL_MIN_WEEKS } from '@app/shared';
import { readOnlyNote } from './billingView';
import {
  REGULARS_PREVIEW,
  canCheer,
  cheerAgainText,
  cheerState,
  emptyRegularsSentence,
  previewRegulars,
  regularsState,
  streakParts,
  streakText,
} from './onARollView';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;

/** One row off the wire. Every field is stated so a case cannot pass because a
 *  sibling happened to hold the number it was looking for. */
const regular = (over = {}) => ({
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Priya',
  weeksRunning: 5,
  daysRunning: 3,
  visits: 11,
  cheerableAt: null,
  ...over,
});

const CAN = { privileges: ['members.read'], now: NOW };

// The gym's wording of the console's read-only sentence — see `billingView`.
const READ_ONLY_NOTE = readOnlyNote('gym');

describe('is there a list to draw', () => {
  it('says nothing at all without a payload — the read arm above reports that', () => {
    expect(regularsState(null)).toBe('none');
    expect(regularsState(undefined)).toBe('none');
    expect(regularsState('nope')).toBe('none');
  });

  it('tells "nobody is on a run" apart from "there is no payload"', () => {
    expect(regularsState({ onARoll: [] })).toBe('empty');
    // An api older than this bundle sends no such key at all; the shared schema
    // defaults it to `[]`, and either way the honest answer is the same.
    expect(regularsState({})).toBe('empty');
    expect(regularsState({ onARoll: [regular()] })).toBe('ready');
  });
});

describe('the sentence for an empty list', () => {
  // :8343's recorded cost, and :30399 §4 is the same departure made one pane up:
  // this payload cannot answer "has anybody EVER had a run", so the sentence
  // must not imply it was asked. A member whose five-week run ended in March is
  // correctly absent from a list about who is on a run NOW.
  it('never claims anything about the gym\'s history', () => {
    expect(emptyRegularsSentence()).not.toMatch(/\byet\b/i);
    expect(emptyRegularsSentence()).not.toMatch(/\bever\b/i);
    expect(emptyRegularsSentence()).toMatch(/right now/);
  });

  // The floor is a chat's call whose own docblock calls it reversible in one
  // line, so the sentence has to follow it rather than carry a second copy of
  // the number (:20587 — correct a figure in ALL of its copies).
  it('names the floor by reading it, not by spelling it out', () => {
    expect(emptyRegularsSentence()).toContain(String(ON_A_ROLL_MIN_WEEKS));
  });
});

describe('how many names reach the screen', () => {
  it('shows a preview and never the whole cap', () => {
    const rows = Array.from({ length: 10 }, (_, i) => regular({ userId: `u${i}` }));
    expect(previewRegulars(rows)).toHaveLength(REGULARS_PREVIEW);
    expect(previewRegulars(rows)[0].userId).toBe('u0');
  });

  it('drops anything that is not a row rather than drawing a blank one', () => {
    expect(previewRegulars([null, regular(), 'x', undefined])).toHaveLength(1);
    expect(previewRegulars(null)).toEqual([]);
  });
});

describe('the two streak figures', () => {
  it('reads each figure from its own field', () => {
    // THE DISAGREEING FIXTURE. 5 and 3 are different numbers, so a sentence
    // built from the wrong field says something different rather than the same
    // thing by luck.
    const parts = streakParts(regular({ weeksRunning: 5, daysRunning: 3 }));
    expect(parts.weeks).toBe('5 weeks in a row');
    expect(parts.days).toBe('3 days in a row');
  });

  // **:30624's CLASS, WHICH IS THIS SCREEN'S OWN RECORDED DEFECT FROM ONE CARD
  // AGO**: two true figures arranged into a sentence that reads as a
  // contradiction. "5 weeks in a row · 1 day in a row" invites the reading that
  // the run just broke. One row, one story.
  it('hides a one-day streak beside a long week streak', () => {
    expect(streakParts(regular({ weeksRunning: 5, daysRunning: 1 })).days).toBeNull();
    expect(streakParts(regular({ weeksRunning: 5, daysRunning: 0 })).days).toBeNull();
    expect(streakParts(regular({ weeksRunning: 5, daysRunning: 2 })).days).toBe('2 days in a row');
  });

  it('says a single week in the singular', () => {
    expect(streakParts(regular({ weeksRunning: 1 })).weeks).toBe('1 week in a row');
  });

  it('builds the whole row in the order the panel reads it', () => {
    expect(streakText(regular({ weeksRunning: 5, daysRunning: 3, visits: 11 })))
      .toBe('5 weeks in a row · 3 days in a row · 11 visits');
  });

  // The same row WITHOUT the day clause, so the separator logic cannot leave a
  // dangling "·" and the visits figure still arrives.
  it('joins cleanly when the day clause is hidden', () => {
    expect(streakText(regular({ weeksRunning: 4, daysRunning: 1, visits: 4 })))
      .toBe('4 weeks in a row · 4 visits');
  });

  it('reads visits from its own field too', () => {
    expect(streakText(regular({ weeksRunning: 2, daysRunning: 0, visits: 1 })))
      .toBe('2 weeks in a row · 1 visit');
  });
});

describe('may this viewer cheer at all', () => {
  // :12518 C/H-2 — a trainer drawn a Remove button the server would refuse. The
  // overview read is gated on `attendance.read` and the cheer on `members.read`,
  // so seeing this list is not permission to press anything on it.
  it('asks for the power the server asks for', () => {
    expect(canCheer(['members.read'])).toBe(true);
    expect(canCheer(['attendance.read'])).toBe(false);
    expect(canCheer([])).toBe(false);
    expect(canCheer(null)).toBe(false);
  });
});

describe('when the button reopens', () => {
  it('is open when the server says null', () => {
    expect(cheerAgainText(null, NOW)).toBeNull();
    expect(cheerAgainText(undefined, NOW)).toBeNull();
  });

  // The contract's own words: a string is the instant it opens AGAIN. One that
  // has already passed is an open window on a page that has been sitting there.
  it('is open again once the instant has passed', () => {
    expect(cheerAgainText(new Date(NOW - HOUR).toISOString(), NOW)).toBeNull();
  });

  // joinClock's standing rule, four review rounds' worth: a DAY WORD compares
  // calendar days. 23:00 tonight against a deadline 12 hours away is TOMORROW,
  // and floored elapsed hours would call it today.
  it('says tomorrow across a local midnight rather than counting hours', () => {
    const late = Date.parse('2026-09-05T23:00:00.000Z');
    const soon = new Date(late + 3 * HOUR).toISOString();
    // Computed in the runner's own zone deliberately — the sentence is read by
    // whoever is looking at the console, so the assertion asks the same clock
    // the code does rather than pinning a zone the reader may not be in.
    const expected = new Date(soon).getDate() === new Date(late).getDate() ? 'later today' : 'tomorrow';
    expect(cheerAgainText(soon, late)).toBe(expected);
  });

  it('counts the rest of the week in days', () => {
    expect(cheerAgainText(new Date(NOW + 5 * DAY).toISOString(), NOW)).toBe('in 5 days');
  });

  // `''` AND `null` ARE DIFFERENT ANSWERS AND COLLAPSING THEM WOULD BE THE BUG.
  // Null means "press it"; a value this code could not read must never be
  // promoted into permission, because the server would refuse the tap.
  it('does not turn an unreadable instant into permission', () => {
    expect(cheerAgainText('not-an-instant', NOW)).toBe('');
    expect(cheerAgainText(12345, NOW)).toBe('');
  });
});

describe('the button, in one of four states', () => {
  it('is live for somebody who may press it at a gym on a plan', () => {
    expect(cheerState(regular(), CAN)).toEqual({ kind: 'live', disabled: false, text: null });
  });

  // **THE SENTENCE A REAL OWNER NOW READS, under Kd's one-per-gym-day cap
  // (:35762).** The server sends the gym's next midnight, so the live server's
  // only two answers are this and *"later today"* — and this case is what would
  // go red if the day word were ever computed from floored elapsed hours
  // instead of `joinClock`'s calendar comparison. Built from a real local
  // midnight rather than "+1 day" for exactly that reason.
  it('says TOMORROW after a cheer, which is the whole of the new cap on screen', () => {
    const late = new Date(2026, 8, 5, 21, 30).getTime();
    const nextMidnight = new Date(2026, 8, 6, 0, 0).getTime();
    const state = cheerState(regular({ cheerableAt: new Date(nextMidnight).toISOString() }), {
      ...CAN,
      now: late,
    });
    expect(state.kind).toBe('sent');
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('Cheered — you can again tomorrow.');
    // NOT "in 0 days", and not "later today": two and a half hours away is
    // TOMORROW because the calendar says so.
    expect(state.text).not.toMatch(/today|days/);
  });

  // **THE MULTI-DAY ARM IS KEPT AND STILL TESTED THOUGH A LIVE SERVER CANNOT
  // PRODUCE IT.** A bundle newer than the api — the deploy window this repo has
  // been bitten in twice (:31222, :12660) — is handed the OLD seven-day instant,
  // and it must render it rather than draw nothing.
  it('still renders a multi-day instant from a server older than the rule', () => {
    const state = cheerState(regular({ cheerableAt: new Date(NOW + 2 * DAY).toISOString() }), CAN);
    expect(state.kind).toBe('sent');
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('Cheered — you can again in 2 days.');
  });

  it('still says it was cheered when it cannot say when', () => {
    const state = cheerState(regular({ cheerableAt: 'rubbish' }), CAN);
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('Cheered today.');
    // AND IT NAMES NO SPAN. The cap is one per gym-DAY (:35762), so a sentence
    // reaching for "7 days" here would be the old rule surviving in the one arm
    // that writes its own words instead of the server's.
    expect(state.text).not.toMatch(/\d/);
  });

  it('covers the tap that has landed before the refreshed payload arrives', () => {
    const state = cheerState(regular(), { ...CAN, outcome: 'sent' });
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('Cheered just now.');
  });

  // **THE TWO OUTCOMES ARE TWO DIFFERENT TRUE SENTENCES AND THIS IS THE CASE
  // THAT KEEPS THEM APART.** A 409 means somebody cheered this member TODAY —
  // the cap is per GYM (:35762), so it may have been the colleague at the next
  // desk. Saying "just now" there is :34443 §4 exactly: a refusal that tells the
  // reader they did something a colleague did.
  it('does not say "just now" about a cheer somebody else already sent', () => {
    const state = cheerState(regular(), { ...CAN, outcome: 'already' });
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('Cheered today.');
    expect(state.text).not.toMatch(/just now/);
  });

  // :24141 — every dead control on this console carries the sentence for why,
  // never silently inert. And it is the SERVER's sentence, so the screen and the
  // door cannot come to say different things about one refusal.
  it('greys on a gym with no plan, in the server\'s own words', () => {
    const state = cheerState(regular(), { ...CAN, readOnly: true });
    expect(state.kind).toBe('read-only');
    expect(state.disabled).toBe(true);
    expect(state.text).toBe(READ_ONLY_NOTE);
  });

  it('greys for a role the server would refuse', () => {
    const state = cheerState(regular(), { privileges: ['attendance.read'], now: NOW });
    expect(state.kind).toBe('blocked');
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('Your role cannot send this.');
  });

  // **THE ORDER IS THE SERVER'S ORDER AND IT IS ASSERTED RATHER THAN ASSUMED.**
  // `sendOrgCheer` checks the privilege first and the plan second, so a staffer
  // without the tick at a lapsed gym is told about their ROLE — which is the
  // refusal they would actually meet. A screen answering in the other order
  // would give a reason the server never would.
  it('answers with the refusal the server would give first', () => {
    const state = cheerState(regular(), {
      privileges: [],
      readOnly: true,
      now: NOW,
    });
    expect(state.kind).toBe('blocked');
  });

  // The plan outranks the window for the same reason: a lapsed gym's tap is
  // refused before the gym-day check is ever reached. (It said "the seven-day
  // check" until 2026-09-06 — there is no such check since :35762 cut the cap to
  // one per member per gym-day, and the fixture below is one DAY ahead, not
  // seven.)
  it('names the plan before the window when both would refuse', () => {
    const state = cheerState(regular({ cheerableAt: new Date(NOW + DAY).toISOString() }), {
      ...CAN,
      readOnly: true,
    });
    expect(state.kind).toBe('read-only');
  });

  // ── T3 ROUND 1 C/H-1, AND THE CASE THREE LINES UP COULD NOT SEE IT ─────────
  // `covers the tap that has landed before the refreshed payload arrives` uses
  // the default fixture, whose `cheerableAt` is null — so it puts an outcome
  // beside NO server instant and passes under both orderings. The two cases
  // below are the pair that tells them apart, and they are written as a pair
  // deliberately: neither is sufficient alone.
  //
  // The defect: `outcome` was asked BEFORE `cheerableAt`, and `OnARollPanel`'s
  // `taps` map is never cleared, so "Cheered just now." held for the whole life
  // of the mount. The date the re-read had already fetched never reached the
  // owner — :7298 (a sentence outliving its condition) and :5807 (on screen and
  // false).
  it('lets the refreshed instant replace "just now" once the re-read has landed', () => {
    const state = cheerState(regular({ cheerableAt: new Date(NOW + 7 * DAY).toISOString() }), {
      ...CAN,
      outcome: 'sent',
    });
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('Cheered — you can again in 7 days.');
    expect(state.text).not.toMatch(/just now/);
  });

  // THE OTHER HALF, AND IT IS WHAT STOPS THE FIX BECOMING ITS OWN DEFECT: with
  // the ordering simply swapped and nothing else, a tap whose re-read has NOT
  // landed must still put the buttons away — otherwise a second cheer can go
  // out while the first is in flight. A test that only asserted the case above
  // is satisfied by deleting the outcome arms altogether.
  it('still covers the tap whose re-read has not landed yet', () => {
    const state = cheerState(regular({ cheerableAt: null }), { ...CAN, outcome: 'sent' });
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('Cheered just now.');
  });

  // The same handover for the 409 arm, which reaches it by a different route:
  // its outcome is set from an error rather than from a success, and the
  // re-read is issued from the `catch`.
  it('names the day for an already-cheered member once the re-read has landed', () => {
    const state = cheerState(regular({ cheerableAt: new Date(NOW + 3 * DAY).toISOString() }), {
      ...CAN,
      outcome: 'already',
    });
    expect(state.text).toBe('Cheered — you can again in 3 days.');
  });
});
