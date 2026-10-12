import { describe, expect, it } from 'vitest';
import { weekRows, weekSpan } from './weekView';

const WEEK = {
  from: '2026-10-05',
  to: '2026-10-11',
  members: { joined: 2, left: 1 },
  atRisk: { count: 3 },
  visits: { thisWeek: 1204, weekBefore: 1187 },
  paymentDue: { count: 2 },
};
const rows = (over = {}, orgType = 'gym') => weekRows({ ...WEEK, ...over }, 'iron-house', orgType);
const row = (key, over, orgType) => rows(over, orgType).find((r) => r.key === key);

describe("Overview's Last 7 days box: its words", () => {
  it('says the days counted', () => {
    expect(weekSpan(WEEK)).toBe('5 Oct to 11 Oct');
    expect(weekSpan({ from: '2026-12-26', to: '2027-01-01' })).toBe('26 Dec to 1 Jan');
  });

  it('draws the four rows in order, each with the page that holds the detail', () => {
    expect(rows()).toEqual([
      { key: 'members', label: 'Members', value: '2 new · 1 left', note: null, to: '/console/iron-house/reports', button: 'Open Reports' },
      { key: 'at-risk', label: 'At risk', value: '3 members have stopped coming', note: 'Today', to: '/console/iron-house/at-risk', button: 'See who' },
      { key: 'visits', label: 'Visits', value: '1,204 visits', note: '1,187 in the 7 days before', to: '/console/iron-house/attendance', button: 'Open Attendance' },
      { key: 'payment-due', label: 'Payment due', value: '2 members have a payment due', note: 'Today', to: '/console/iron-house/members?show=payment-due', button: 'See who' },
    ]);
  });

  it('has no row for a part the server left out, and none at all with nothing', () => {
    expect(rows({ members: null, paymentDue: null }).map((r) => r.key)).toEqual(['at-risk', 'visits']);
    expect(rows({ members: null, atRisk: null, visits: null, paymentDue: null })).toEqual([]);
  });

  it('says one person as one person, and a studio and a trainer have clients', () => {
    expect(row('at-risk', { atRisk: { count: 1 } }).value).toBe('1 member has stopped coming');
    expect(row('payment-due', { paymentDue: { count: 1 } }).value).toBe('1 member has a payment due');
    expect(row('visits', { visits: { thisWeek: 1, weekBefore: 0 } })).toMatchObject({ value: '1 visit', note: '0 in the 7 days before' });
    expect(row('members', {}, 'studio').label).toBe('Clients');
    expect(row('at-risk', {}, 'personal_trainer').value).toBe('3 clients have stopped coming');
  });

  it('a true nought is said in words, and offers nobody to see', () => {
    expect(row('at-risk', { atRisk: { count: 0 } })).toMatchObject({ value: 'Nobody has stopped coming', button: 'Open At risk' });
    expect(row('payment-due', { paymentDue: { count: 0 } })).toMatchObject({ value: 'Nobody has a payment due', to: null, button: null });
    expect(row('members', { members: { joined: 0, left: 0 } }).value).toBe('0 new · 0 left');
  });

  it('makes no comparison where there is none', () => {
    expect(row('visits', { visits: { thisWeek: 40, weekBefore: null } })).toMatchObject({ value: '40 visits', note: null });
  });
});
