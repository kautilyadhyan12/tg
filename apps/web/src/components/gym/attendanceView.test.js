// The member's side of attendance, in the pure layer: what a tap SAYS, and how
// the days they came are grouped. Rulings under test are Kd's own — :26469,
// :26624 §4.4, :26684, :26736, :27992 §1 — and the two that a reviewer should
// check first are named where they are asserted.
import { describe, expect, it } from 'vitest';
import {
  markedSentence,
  sessionWindowLabel,
  visitDays,
  visitMinutes,
  visitTimeLabel,
  withVisit,
} from './attendanceView';

const visit = (over = {}) => ({
  day: '2026-09-02',
  markedAt: '2026-09-02T00:42:00.000Z',
  method: 'manual',
  hoursStatus: 'hours_unset',
  session: null,
  ...over,
});

describe('the clock a visit is printed on', () => {
  // TRAP #8, AND IT IS THE WHOLE REASON THIS HELPER EXISTS. The instant below is
  // 20:45 on the 1st in UTC and 02:15 on the 2nd in Kolkata. A member in London
  // reading about a gym in Assam must be told the gym's time, so the zone is
  // always the GYM's and never the reader's — which is what `toLocaleTimeString`
  // with no zone would have given (:8156).
  it('reads the time in the GYM zone it is given, not the reader s', () => {
    const at = '2026-09-01T20:45:00.000Z';
    expect(visitMinutes(at, 'Asia/Kolkata')).toBe(2 * 60 + 15);
    expect(visitMinutes(at, 'UTC')).toBe(20 * 60 + 45);
    expect(visitMinutes(at, 'America/Chicago')).toBe(15 * 60 + 45);
  });

  it('prints on the clock the GYM chose', () => {
    const at = '2026-09-01T20:45:00.000Z';
    expect(visitTimeLabel(at, 'Asia/Kolkata', '24h')).toBe('02:15');
    expect(visitTimeLabel(at, 'Asia/Kolkata', '12h')).toBe('2:15 AM');
  });

  // A NUMBER THAT CANNOT BE TRUSTED IS NOT DRAWN. An unreadable zone or instant
  // gives no time at all rather than one computed some other way — a wrong time
  // on screen is :5807's class, an absent one is not.
  it('gives nothing at all when the instant or the zone cannot be read', () => {
    expect(visitMinutes('2026-09-01T20:45:00.000Z', 'Mars/Olympus')).toBeNull();
    expect(visitMinutes('not a date', 'UTC')).toBeNull();
    expect(visitMinutes('2026-09-01T20:45:00.000Z', '')).toBeNull();
    expect(visitTimeLabel('2026-09-01T20:45:00.000Z', 'Mars/Olympus', '24h')).toBe('');
  });

  it('writes a session window as the gym s two minute marks', () => {
    expect(sessionWindowLabel({ opensMinute: 360, closesMinute: 420 }, '24h')).toBe('06:00 – 07:00');
    expect(sessionWindowLabel({ opensMinute: 360, closesMinute: 420 }, '12h')).toBe('6:00 AM – 7:00 AM');
    expect(sessionWindowLabel(null, '24h')).toBe('');
  });
});

describe('what the screen says after a tap', () => {
  it('names the session when the visit fell inside one', () => {
    expect(
      markedSentence(
        visit({ hoursStatus: 'in_session', session: { opensMinute: 360, closesMinute: 420 } }),
        { clockFormat: '24h' },
      ),
    ).toBe("You're marked in — the 06:00 – 07:00 session.");
  });

  // :26624 §4.4 AND :26684 — RECORDED AND MARKED, NEVER REFUSED, AND NEVER
  // SCOLDED. The sentence states what happened; nothing here suggests the
  // member did something wrong, because they did not.
  it('states an odd arrival without blaming anybody for it', () => {
    const outside = markedSentence(visit({ hoursStatus: 'outside_hours' }));
    const closed = markedSentence(visit({ hoursStatus: 'closed_day' }));
    expect(outside).toBe("You're marked in — that's outside your gym's opening times.");
    expect(closed).toBe("You're marked in — your gym said it's closed today.");
    for (const sentence of [outside, closed]) {
      expect(sentence).toMatch(/^You're marked in/);
      expect(sentence).not.toMatch(/sorry|error|invalid|not allowed|can't|cannot/i);
    }
  });

  it('says the gym is open around the clock when it is', () => {
    expect(markedSentence(visit({ hoursStatus: 'open_24h' }))).toBe(
      "You're marked in. Your gym is open 24 hours.",
    );
  });

  // :26736, AND THIS IS THE ASSERTION THAT MATTERS MOST IN THIS FILE. A gym that
  // has never said when it is open must be told NOTHING about opening hours —
  // "nobody has answered" is not "outside hours", and folding the two together
  // is the false sentence that ruling exists to prevent. Asserted as an absence
  // of any claim rather than as one exact string, so a reworded sentence that
  // smuggles a claim back in still fails.
  it('claims NOTHING about opening hours when the gym has never set them', () => {
    const sentence = markedSentence(visit({ hoursStatus: 'hours_unset' }));
    expect(sentence).toBe("You're marked in.");
    expect(sentence).not.toMatch(/hour|open|clos|session|outside/i);
  });

  // A NEWER SERVER'S STATE IS NOT GUESSED AT. It gets the sentence that claims
  // nothing, for `hours_unset`'s reason one level out.
  it('claims nothing for a state this bundle does not know', () => {
    expect(markedSentence(visit({ hoursStatus: 'something_new' }))).toBe("You're marked in.");
  });

  // A SECOND TAP IN THE SAME SESSION IS NOT A SECOND VISIT (:28221's
  // idempotence). Saying "marked in" again would be true and would still tell
  // somebody their tap counted, which it did not.
  it('words a second tap apart from the first', () => {
    expect(markedSentence(visit({ hoursStatus: 'open_24h' }), { alreadyMarked: true })).toBe(
      "You're already marked in. Your gym is open 24 hours.",
    );
  });
});

describe('the days they came', () => {
  // KD RULING 12 AT THE SCREEN (:27992 §1) — the case a reviewer should check
  // first. A member who trains in the morning and comes back in the evening
  // attended TWICE, and that is ONE row with TWO times, exactly as the owner's
  // screen will show it. Two rows for one day would be the same day counted
  // twice on a person's own history.
  it('draws one row per DAY with a time for each visit', () => {
    const days = visitDays(
      [
        visit({ day: '2026-09-02', markedAt: '2026-09-02T12:10:00.000Z' }),
        visit({ day: '2026-09-02', markedAt: '2026-09-02T00:35:00.000Z' }),
        visit({ day: '2026-09-01', markedAt: '2026-09-01T01:05:00.000Z' }),
      ],
      { timezone: 'UTC', clockFormat: '24h' },
    );
    expect(days).toHaveLength(2);
    expect(days[0].day).toBe('2026-09-02');
    expect(days[0].times).toEqual(['12:10', '00:35']);
    expect(days[1].times).toEqual(['01:05']);
  });

  it('keeps the server s order rather than re-sorting it', () => {
    const days = visitDays(
      [visit({ day: '2026-08-30' }), visit({ day: '2026-09-02' })],
      { timezone: 'UTC', clockFormat: '24h' },
    );
    expect(days.map((d) => d.day)).toEqual(['2026-08-30', '2026-09-02']);
  });

  // A DAY IS A FACT OFF THE WIRE; A CHIP IS A RENDERING OF IT. An unreadable
  // zone must not delete the day the member came.
  it('keeps the day when the time cannot be drawn', () => {
    const days = visitDays([visit()], { timezone: 'Mars/Olympus', clockFormat: '24h' });
    expect(days).toHaveLength(1);
    expect(days[0].times).toEqual([]);
    expect(days[0].label).toContain('Sep');
  });

  it('writes the date the way a person writes one, in the gym s own date', () => {
    const days = visitDays([visit({ day: '2026-09-02' })], { timezone: 'UTC' });
    expect(days[0].label).toBe('Wed 2 Sep 2026');
  });

  it('ignores rows with no day rather than inventing one', () => {
    expect(visitDays([{ markedAt: '2026-09-02T00:42:00.000Z' }], { timezone: 'UTC' })).toEqual([]);
    expect(visitDays(null, { timezone: 'UTC' })).toEqual([]);
  });
});

describe('putting the visit the server just confirmed into the list', () => {
  it('prepends a new visit, because the list is newest first', () => {
    const held = [visit({ day: '2026-09-01', markedAt: '2026-09-01T01:00:00.000Z' })];
    const fresh = visit({ day: '2026-09-02', markedAt: '2026-09-02T01:00:00.000Z' });
    expect(withVisit(held, fresh)).toEqual([fresh, held[0]]);
  });

  // THE SECOND TAP RETURNS THE FIRST VISIT, so adding it again would draw two
  // chips for one visit — a number on screen the database disagrees with.
  it('adds nothing when that exact visit is already on screen', () => {
    const already = visit({ day: '2026-09-02', markedAt: '2026-09-02T01:00:00.000Z' });
    expect(withVisit([already], { ...already })).toHaveLength(1);
  });

  it('leaves the list alone when there is no visit to add', () => {
    const held = [visit()];
    expect(withVisit(held, null)).toBe(held);
  });
});
