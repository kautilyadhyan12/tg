// The desk's words and rules, every case (spec Part 3 §12.3; ROADMAP 16b-i).
import { describe, expect, it } from 'vitest';
import { CHECKIN_WORDS, HELD_PAYMENT_WORDS, checkinScanResponseSchema } from '@app/shared';
import {
  DESK_NAMES_KEY,
  DESK_SOUNDS,
  NOT_A_SCAN,
  SAME_PASS_MS,
  claimTrouble,
  isLetIn,
  signedInLine,
  tooLongToScan,
  deskAnswer,
  deskSound,
  deskTrouble,
  noticeLine,
  readDeskMuted,
  readDeskNames,
  readyCode,
  tokenFromHash,
  writeDeskMuted,
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
    [{ status: null, payment: null, onList: false }, "Not on the gym's list"],
    [{ status: 'Cancelled', payment: 'Overdue', onList: false }, "Status: Cancelled · Payment: Overdue · Not on the gym's list"],
    [null, null],
    // 23a-ii: what the person holds in the app, in the Members list's own words.
    [{ status: 'Active', payment: 'Payment due', onList: true }, 'Status: Active · Payment due'],
    [{ status: 'Not started', payment: 'Not due yet', onList: true }, 'Status: Not started · Payment: Not due yet'],
    [{ status: 'Active', payment: 'Free', onList: true }, 'Status: Active · Payment: Free'],
    [{ status: 'Cancelled', payment: null, onList: true }, 'Status: Cancelled'],
    [{ status: 'Active', payment: 'payment overdue', onList: true }, 'Status: Active · payment overdue'],
  ])('%j', (notice, expected) => {
    expect(noticeLine(notice)).toBe(expected);
  });

  it('never says "Payment" twice, whichever payment word a held membership has', () => {
    for (const payment of Object.values(HELD_PAYMENT_WORDS)) {
      const line = noticeLine({ status: 'Active', payment, onList: true });
      expect(line, payment).toContain(payment);
      expect(line.match(/payment/gi), payment).toHaveLength(1);
    }
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

// The worst thing the desk's sound could do: play "let in" for somebody it refused, so
// staff across the room wave them through (ROADMAP 16f).
describe('the sound for an answer', () => {
  const failed = (status, error) => ({ response: { status, data: { error } } });
  const person = { result: 'checked_in', gymName: 'Iron House', person: { name: 'Olivia' } };
  const clean = { status: null, payment: null, onList: true };

  it('only somebody let in gets a "let in" sound: every other answer the contract has is "out"', () => {
    const results = checkinScanResponseSchema.options.map((option) => option.shape.result.value);
    expect(results.length).toBeGreaterThan(2);
    for (const result of results) {
      const answer = { ...person, result, notice: clean, firstAt: '2026-10-02T06:02:00.000Z', timezone: 'Europe/London', clockFormat: '24h' };
      const sound = deskSound(deskAnswer(answer));
      expect([result, sound]).toEqual([result, result === 'checked_in' || result === 'already' ? 'in' : 'out']);
    }
  });

  it.each([
    ['an answer this page has never heard of', deskAnswer({ ...person, result: 'checked_in_maybe' })],
    ['no answer at all', deskAnswer(null)],
    ['a read that is no pass', NOT_A_SCAN],
    ['a device switched off', deskTrouble(failed(401, 'device_not_recognised'))],
    ['key tags paused', deskTrouble(failed(429, 'key_tags_paused'))],
    ['the server down', deskTrouble(failed(500, 'internal'))],
    ['no connection', deskTrouble(new Error('Network Error'))],
    ['nothing', null],
    ['a green colour that deskAnswer did not mark as let in', { tone: 'good', title: 'Checked in', name: 'Olivia', notice: null }],
    ['a mark that is not exactly true', { tone: 'good', title: 'Checked in', name: 'Olivia', notice: null, letIn: 'yes' }],
  ])('%s is "out"', (_name, shown) => {
    expect(deskSound(shown)).toBe('out');
  });

  it.each([
    [{ status: 'Expired', payment: null, onList: true }],
    [{ status: null, payment: 'Overdue', onList: true }],
    [{ status: null, payment: null, onList: false }],
  ])('let in with the gym’s word %j is the warning sound, not the plain one', (notice) => {
    expect(deskSound(deskAnswer({ ...person, notice }))).toBe('in_warn');
    expect(deskSound(deskAnswer({ ...person, result: 'already', notice, firstAt: 'garbage' }))).toBe('in_warn');
  });

  // A list record may have no name (the member list keeps it; the server then answers
  // `name: ""`). They are let in like anybody else, and must sound like it.
  it.each(['', '   '])('a member let in whose record has no name (%j) still gets "let in"', (name) => {
    const first = { ...person, person: { name }, notice: clean };
    const again = { ...first, result: 'already', firstAt: '2026-10-02T06:02:00.000Z', timezone: 'Europe/London', clockFormat: '24h' };
    for (const answer of [first, again]) {
      expect(checkinScanResponseSchema.safeParse(answer).success).toBe(true);
      expect(deskSound(deskAnswer(answer))).toBe('in');
      expect(deskSound(deskAnswer({ ...answer, notice: { ...clean, payment: 'Overdue' } }))).toBe('in_warn');
    }
  });

  it('the mute button’s own note is none of the three answers, and no note of "let in" is in it', () => {
    const pitches = (kind) => DESK_SOUNDS[kind].map((note) => note.hz);
    expect(DESK_SOUNDS.on).toHaveLength(1);
    for (const kind of ['in', 'in_warn', 'out']) for (const hz of pitches(kind)) expect(pitches('on')).not.toContain(hz);
  });

  it('the three sounds are three different sounds, and "out" is the low one', () => {
    const notes = (kind) => DESK_SOUNDS[kind].map((note) => `${String(note.hz)}@${String(note.at)}+${String(note.ms)}`).join(' ');
    expect(new Set(['in', 'in_warn', 'out'].map(notes)).size).toBe(3);
    const lowestIn = Math.min(...[...DESK_SOUNDS.in, ...DESK_SOUNDS.in_warn].map((note) => note.hz));
    for (const note of DESK_SOUNDS.out) expect(note.hz).toBeLessThan(lowestIn / 2);
    // The warning starts as "let in" does and then goes on: nobody hears it as a refusal.
    expect(DESK_SOUNDS.in_warn.slice(0, DESK_SOUNDS.in.length)).toEqual(DESK_SOUNDS.in);
    expect(DESK_SOUNDS.in_warn.length).toBeGreaterThan(DESK_SOUNDS.in.length);
  });
});

describe('the desk’s mute button', () => {
  it('starts with the sound on, and remembers being turned off and on again', () => {
    const store = memoryStorage();
    expect(readDeskMuted(store)).toBe(false);
    writeDeskMuted(store, true);
    expect(readDeskMuted(store)).toBe(true);
    writeDeskMuted(store, false);
    expect(readDeskMuted(store)).toBe(false);
  });

  it('a browser that blocks storage has the sound on', () => {
    const blocked = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    expect(readDeskMuted(blocked)).toBe(false);
    expect(() => writeDeskMuted(blocked, true)).not.toThrow();
    expect(readDeskMuted(null)).toBe(false);
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

describe('a scan longer than any pass or key tag', () => {
  it.each([
    ['x'.repeat(64), false],
    [`  ${'x'.repeat(64)}  `, false],
    ['x'.repeat(65), true],
    ['', false],
    [null, false],
  ])('%j', (typed, expected) => {
    expect(tooLongToScan(typed)).toBe(expected);
  });
  it('says what it is, with no name', () => {
    expect(NOT_A_SCAN).toMatchObject({ title: "That isn't a pass or key tag", name: null });
  });
});

describe('the same pass again', () => {
  it('is kept for the two windows the server takes a pass in', () => {
    expect(SAME_PASS_MS).toBe(60_000);
  });
  it.each([
    [{ result: 'checked_in' }, true],
    [{ result: 'already' }, true],
    [{ result: 'fresh_pass_needed' }, false],
    [{ result: 'not_a_member' }, false],
    [{ result: 'see_staff' }, false],
    [null, false],
  ])('%j', (answer, expected) => {
    expect(isLetIn(answer)).toBe(expected);
  });
});

describe('a browser somebody is signed in to', () => {
  it('names the account and says what to do', () => {
    expect(signedInLine({ email: 'owner@irongym.example' })).toBe(
      'This browser is signed in as owner@irongym.example. Anyone at this desk could open your console in another tab, so the desk works only in a browser nobody is signed in to. Sign out here, or open the link in another browser.',
    );
  });
  it('without an address, still says it is signed in', () => {
    expect(signedInLine({})).toMatch(/^This browser is signed in to AI Home Gym\./);
  });
});
