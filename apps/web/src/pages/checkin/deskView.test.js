// The desk's words and rules, every case (spec Part 3 §12.3; ROADMAP 16b-i).
import { describe, expect, it } from 'vitest';
import { CHECKIN_WORDS, checkinScanResponseSchema } from '@app/shared';
import {
  DESK_NAMES_KEY,
  claimTrouble,
  deskAnswer,
  deskTrouble,
  noticeLine,
  readDeskNames,
  readyCode,
  tokenFromHash,
  writeDeskNames,
} from './deskView';

const TOKEN = 'Ab0_-'.repeat(8) + 'xyz';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('tokenFromHash', () => {
  it.each([
    [`#${TOKEN}`, TOKEN],
    [TOKEN, TOKEN],
    ['', null],
    ['#', null],
    [`#${TOKEN}x`, null],
    [`#${TOKEN.slice(1)}`, null],
    [`#${TOKEN.slice(1)}=`, null],
    [`#${TOKEN.slice(1)}+`, null],
    [null, null],
    [undefined, null],
  ])('%s', (hash, expected) => {
    expect(tokenFromHash(hash)).toBe(expected);
  });
});

describe('readyCode', () => {
  it.each([
    ['1001', '1001'],
    ['  1001\t', '1001'],
    ['', null],
    ['   ', null],
    ['x'.repeat(64), 'x'.repeat(64)],
    ['x'.repeat(65), null],
    [null, null],
  ])('%j', (typed, expected) => {
    expect(readyCode(typed)).toBe(expected);
  });
});

describe('noticeLine', () => {
  it.each([
    [{ status: null, payment: null, onList: true }, null],
    [{ status: 'Active', payment: null, onList: true }, 'Status: Active'],
    [{ status: null, payment: 'Overdue', onList: true }, 'Payment: Overdue'],
    [{ status: ' Frozen ', payment: 'Paid', onList: true }, 'Status: Frozen · Payment: Paid'],
    [{ status: '  ', payment: '', onList: true }, null],
    [{ status: null, payment: null, onList: false }, 'Not on your list'],
    [{ status: 'Cancelled', payment: 'Overdue', onList: false }, 'Status: Cancelled · Payment: Overdue · Not on your list'],
    [null, null],
  ])('%j', (notice, expected) => {
    expect(noticeLine(notice)).toBe(expected);
  });
});

describe('deskAnswer covers every answer the contract allows', () => {
  const notice = { status: 'Expired', payment: null, onList: true };
  const cases = [
    [{ result: 'checked_in', gymName: 'Iron House', person: { name: 'Olivia' }, notice }, { tone: 'good', title: 'Checked in', name: 'Olivia', notice: 'Status: Expired' }],
    [
      {
        result: 'already',
        gymName: 'Iron House',
        person: { name: 'Olivia' },
        notice,
        firstAt: '2026-10-02T06:02:00.000Z',
        timezone: 'Europe/London',
        clockFormat: '24h',
      },
      { tone: 'good', title: 'Already checked in at 07:02', name: 'Olivia', notice: 'Status: Expired' },
    ],
    [{ result: 'fresh_pass_needed', gymName: 'Iron House' }, { tone: 'plain', title: 'Show a fresh pass', name: null }],
    [{ result: 'not_a_member', gymName: 'Iron House' }, { tone: 'bad', title: 'Not a member of Iron House', name: null }],
    [{ result: 'see_staff', gymName: 'Iron House' }, { tone: 'warn', title: 'Please see a member of staff', name: null }],
  ];

  it('the cases are every result the contract has', () => {
    const results = checkinScanResponseSchema.options.map((option) => option.shape.result.value).sort();
    expect(cases.map(([answer]) => answer.result).sort()).toEqual(results);
  });

  it.each(cases)('%j', (answer, expected) => {
    expect(checkinScanResponseSchema.safeParse(answer).success).toBe(true);
    expect(deskAnswer(answer)).toMatchObject(expected);
  });

  it('a red or grey answer never carries a name', () => {
    for (const [answer] of cases.slice(2)) expect(deskAnswer(answer).name).toBeNull();
  });

  it('an unreadable time says "Already checked in" without one', () => {
    const answer = { ...cases[1][0], firstAt: 'garbage' };
    expect(deskAnswer(answer).title).toBe('Already checked in');
  });

  it('something unknown is "Please scan again", never a green tick', () => {
    expect(deskAnswer({ result: 'checked_in_maybe' })).toMatchObject({ tone: 'warn', title: 'Please scan again' });
    expect(deskAnswer(null)).toMatchObject({ tone: 'warn' });
  });
});

describe('deskTrouble', () => {
  const failed = (status, error, message) => ({ response: { status, data: { error, message } } });
  it.each([
    [failed(401, 'device_not_recognised'), { stop: true, message: CHECKIN_WORDS.device_not_recognised }],
    [failed(401, undefined), { stop: true }],
    [failed(429, 'key_tags_slow'), { stop: false, message: CHECKIN_WORDS.key_tags_slow }],
    [failed(429, 'key_tags_paused'), { stop: false, message: CHECKIN_WORDS.key_tags_paused }],
    [failed(429, 'rate_limited', 'Too many scans. Please try again in a minute.'), { stop: false, message: 'Too many scans. Please try again in a minute.' }],
    [failed(503, 'passes_off'), { stop: false, message: CHECKIN_WORDS.passes_off }],
    [failed(503, 'checkin_unavailable'), { stop: false, message: CHECKIN_WORDS.checkin_unavailable }],
    [failed(500, 'internal'), { stop: false, title: 'Please scan again' }],
    [failed(400, 'validation_error'), { stop: false, title: 'Please scan again' }],
    [new Error('Network Error'), { stop: false, title: 'No connection' }],
    [Object.assign(new Error('x'), { isContractError: true }), { stop: false, title: 'Please scan again' }],
  ])('%#', (err, expected) => {
    expect(deskTrouble(err)).toMatchObject(expected);
  });

  it('a refusal never shows a name', () => {
    expect(deskTrouble(failed(429, 'key_tags_paused')).name).toBeUndefined();
  });
});

describe('claimTrouble', () => {
  it.each([
    [{ response: { status: 404, data: { error: 'link_not_valid' } } }, CHECKIN_WORDS.link_not_valid],
    [{ response: { status: 404, data: {} } }, CHECKIN_WORDS.link_not_valid],
    [{ response: { status: 429, data: { error: 'rate_limited' } } }, CHECKIN_WORDS.checkin_unavailable],
    [new Error('Network Error'), "Couldn't reach the server. Check the internet connection, then open the link again."],
  ])('%#', (err, expected) => {
    expect(claimTrouble(err)).toBe(expected);
  });
});

describe('the desk’s own names', () => {
  it('are kept and read back, and only the two names', () => {
    const store = memoryStorage();
    writeDeskNames(store, { gymName: 'Iron House', deviceName: 'Front desk', key: 'secret' });
    expect(JSON.parse(store.getItem(DESK_NAMES_KEY))).toEqual({ gymName: 'Iron House', deviceName: 'Front desk' });
    expect(readDeskNames(store)).toEqual({ gymName: 'Iron House', deviceName: 'Front desk' });
  });

  it('are forgotten', () => {
    const store = memoryStorage();
    writeDeskNames(store, { gymName: 'Iron House', deviceName: 'Front desk' });
    writeDeskNames(store, null);
    expect(readDeskNames(store)).toBeNull();
  });

  it('read as none when broken, missing or blocked', () => {
    const store = memoryStorage();
    store.setItem(DESK_NAMES_KEY, '{not json');
    expect(readDeskNames(store)).toBeNull();
    store.setItem(DESK_NAMES_KEY, JSON.stringify({ gymName: 3 }));
    expect(readDeskNames(store)).toBeNull();
    expect(readDeskNames(null)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readDeskNames(blocked)).toBeNull();
    expect(() => writeDeskNames(blocked, { gymName: 'a', deviceName: 'b' })).not.toThrow();
  });
});
