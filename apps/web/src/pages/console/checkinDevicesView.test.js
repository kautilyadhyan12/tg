// Settings → Check-in devices, its words for every state (ROADMAP 16b-i).
import { describe, expect, it } from 'vitest';
import { CHECKIN_DEVICES_MAX } from '@app/shared';
import {
  canAddDevice,
  confirmQuestion,
  deviceNameProblem,
  deviceState,
  devicesSummary,
  keyTagPauseLine,
  momentLabel,
} from './checkinDevicesView';

const LONDON = { timezone: 'Europe/London', clockFormat: '24h' };
const NEW_YORK_12H = { timezone: 'America/New_York', clockFormat: '12h' };
const NOW = new Date('2026-10-02T13:00:00.000Z');

const device = (over) => ({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Front desk',
  state: 'on',
  linkExpiresAt: null,
  lastSeenAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  keyTagsPausedUntil: null,
  ...over,
});

describe('momentLabel', () => {
  it.each([
    ['2026-10-02T13:05:00.000Z', LONDON, '14:05'],
    ['2026-10-01T13:05:00.000Z', LONDON, '1 Oct, 14:05'],
    ['2025-12-24T09:00:00.000Z', LONDON, '24 Dec 2025, 09:00'],
    ['2026-10-02T13:05:00.000Z', NEW_YORK_12H, '9:05 AM'],
    // 01:30 in New York on the 2nd is still the 1st there: the gym's day, not the reader's.
    ['2026-10-02T03:30:00.000Z', NEW_YORK_12H, '1 Oct, 11:30 PM'],
    ['garbage', LONDON, ''],
    [null, LONDON, ''],
  ])('%s', (iso, clock, expected) => {
    expect(momentLabel(iso, clock, NOW)).toBe(expected);
  });
});

describe('deviceState', () => {
  it.each([
    [device({ state: 'waiting', linkExpiresAt: '2026-10-02T14:00:00.000Z' }), { tag: 'Waiting', tone: 'plain', line: 'Waiting for its link to be opened on the device. The link works until 15:00.' }],
    [device({ state: 'waiting', linkExpiresAt: null }), { tag: 'Waiting', line: 'Waiting for its link to be opened on the device.' }],
    [device({ state: 'on', lastSeenAt: null }), { tag: 'On', tone: 'good', line: 'Checking people in. Not used yet.' }],
    [device({ state: 'on', lastSeenAt: '2026-10-02T12:31:00.000Z' }), { tag: 'On', line: 'Checking people in. Last scan 13:31.' }],
    [device({ state: 'off' }), { tag: 'Off', tone: 'off', line: 'Not checking anybody in. Make a new link to use it again.' }],
  ])('%#', (d, expected) => {
    expect(deviceState(d, LONDON, NOW)).toMatchObject(expected);
  });
});

describe('keyTagPauseLine', () => {
  it('says until when, and that passes still work', () => {
    expect(keyTagPauseLine(device({ keyTagsPausedUntil: '2026-10-02T13:10:00.000Z' }), LONDON, NOW)).toBe(
      'Not taking key tags until 14:10: too many numbers were scanned that nobody on your list has. Passes still work.',
    );
  });
  it('is nothing when not paused, or when the device is not on', () => {
    expect(keyTagPauseLine(device({}), LONDON, NOW)).toBeNull();
    expect(keyTagPauseLine(device({ state: 'off', keyTagsPausedUntil: '2026-10-02T13:10:00.000Z' }), LONDON, NOW)).toBeNull();
  });
  it('an unreadable time still says it is paused', () => {
    expect(keyTagPauseLine(device({ keyTagsPausedUntil: 'x' }), LONDON, NOW)).toMatch(/^Not taking key tags for a few minutes/);
  });
});

describe('devicesSummary', () => {
  it.each([
    [[], 'No devices yet'],
    [null, 'No devices yet'],
    [[device({})], '1 device · 1 on'],
    [[device({}), device({ state: 'off' }), device({ state: 'waiting' })], '3 devices · 1 on'],
  ])('%#', (list, expected) => {
    expect(devicesSummary(list)).toBe(expected);
  });
});

describe('deviceNameProblem', () => {
  it.each([
    ['Front desk', null],
    ['  Front desk  ', null],
    ['', 'Give the device a name, such as Front desk.'],
    ['   ', 'Give the device a name, such as Front desk.'],
    ['x'.repeat(60), null],
    ['x'.repeat(61), 'A name can be up to 60 characters.'],
  ])('%j', (name, expected) => {
    expect(deviceNameProblem(name)).toBe(expected);
  });
});

describe('canAddDevice', () => {
  it('up to the gym’s limit', () => {
    expect(canAddDevice([])).toBe(true);
    expect(canAddDevice(Array.from({ length: CHECKIN_DEVICES_MAX - 1 }, () => device({})))).toBe(true);
    expect(canAddDevice(Array.from({ length: CHECKIN_DEVICES_MAX }, () => device({})))).toBe(false);
  });
});

describe('confirmQuestion names the device and what stops', () => {
  it('switch off', () => {
    expect(confirmQuestion('off', device({}))).toBe(
      'Switch off Front desk? It stops checking people in at once. You can turn it back on with a new link.',
    );
  });
  it('a new link for a device in use', () => {
    expect(confirmQuestion('link', device({}))).toBe(
      'Make a new link for Front desk? It stops checking people in until the new link is opened on it.',
    );
  });
});
