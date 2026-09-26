import { describe, expect, it } from 'vitest';
import {
  addedDay,
  addedWords,
  detailsRequest,
  createLeadRequest,
  joinedWords,
  leadProblem,
  leadsQueryString,
  statusChips,
  updateLeadRequest,
} from './leadsView';

const WORDS = { people: 'members', person: 'member', peopleCap: 'Members' };
const lead = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  fullName: 'Priya Shah',
  email: 'priya@example.com',
  phone: null,
  source: 'walk_in',
  status: 'new',
  notes: 'Mornings',
  mayEmail: false,
  entryId: null,
  onList: false,
  createdAt: '2026-09-20T10:00:00.000Z',
  statusChangedAt: '2026-09-20T10:00:00.000Z',
};

describe('the Leads screen', () => {
  it('draws All and every status with the server counts, zeros included', () => {
    expect(statusChips({ all: 4, new: 2, contacted: 0, on_trial: 1, joined: 1, lost: 0 })).toEqual([
      { key: 'all', label: 'All', count: 4 },
      { key: 'new', label: 'New', count: 2 },
      { key: 'contacted', label: 'Contacted', count: 0 },
      { key: 'on_trial', label: 'On trial', count: 1 },
      { key: 'joined', label: 'Joined', count: 1 },
      { key: 'lost', label: 'Lost', count: 0 },
    ]);
  });

  it('asks for a status only when one is picked, and for a trimmed search', () => {
    expect(leadsQueryString({ status: 'all', query: '  ' })).toBe('');
    expect(leadsQueryString({ status: 'on_trial', query: ' shah ' })).toBe('status=on_trial&q=shah');
    expect(leadsQueryString({ status: 'all', query: '' }, 'abc')).toBe('cursor=abc');
  });

  it('says what is missing before sending', () => {
    const draft = { fullName: '', email: '', phone: '', source: '', notes: '' };
    expect(leadProblem(draft)).toBe("Add the person's name.");
    expect(leadProblem({ ...draft, fullName: 'Tom' })).toMatch(/email address or a phone number/);
    expect(leadProblem({ ...draft, fullName: 'Tom', phone: '07700' })).toBe('Choose where they heard of you.');
    expect(leadProblem({ ...draft, fullName: 'Tom', phone: '07700', source: 'other' })).toBeNull();
  });

  it('sends only what was typed, and only what moved', () => {
    // A tick with no email is not sent: it is a yes to an address.
    expect(createLeadRequest({ fullName: 'Tom', email: '', phone: '07700', source: 'friend', notes: '', mayEmail: true })).toEqual({
      fullName: 'Tom',
      phone: '07700',
      source: 'friend',
    });
    expect(createLeadRequest({ fullName: 'Tom', email: 't@example.com', phone: '', source: 'friend', notes: '', mayEmail: true }).mayEmail).toBe(true);
    expect(createLeadRequest({ fullName: ' Tom ', email: '', phone: ' 07700 ', source: 'friend', notes: ' ', mayEmail: false })).toEqual({
      fullName: 'Tom',
      phone: '07700',
      source: 'friend',
    });
    expect(updateLeadRequest(lead, { fullName: 'Priya Shah', email: '', phone: '+447700900123', source: 'walk_in', notes: 'Mornings' })).toEqual({
      email: null,
      phone: '+447700900123',
    });
    expect(updateLeadRequest(lead, { fullName: 'Priya Shah', email: 'priya@example.com', phone: '', source: 'walk_in', notes: 'Mornings' })).toEqual({});
  });

  it("writes the day added in the viewer's own calendar: Today, Yesterday, then the date", () => {
    const now = new Date(2026, 8, 26, 0, 10);
    expect(addedDay(new Date(2026, 8, 26, 0, 1).toISOString(), now)).toBe('Today');
    expect(addedDay(new Date(2026, 8, 25, 23, 30).toISOString(), now)).toBe('Yesterday');
    expect(addedDay(new Date(2026, 8, 24, 23, 59).toISOString(), now)).toBe('24 Sept');
    expect(addedDay(new Date(2025, 11, 31, 22, 0).toISOString(), new Date(2026, 0, 1, 8, 0))).toBe('Yesterday');
    expect(addedDay(new Date(2025, 11, 30, 22, 0).toISOString(), new Date(2026, 0, 1, 8, 0))).toBe('30 Dec 2025');
    expect(addedDay('not a date', now)).toBe('');
    expect(addedWords(new Date(2026, 8, 26, 9, 0).toISOString(), new Date(2026, 8, 26, 18, 0))).toBe('Added today');
    expect(addedWords(new Date(2026, 8, 25, 9, 0).toISOString(), new Date(2026, 8, 26, 18, 0))).toBe('Added yesterday');
    expect(addedWords('2026-09-20T10:00:00.000Z', new Date('2026-10-01T10:00:00.000Z'))).toBe('Added 20 Sept');
    expect(addedWords('2025-09-20T10:00:00.000Z', new Date('2026-10-01T10:00:00.000Z'))).toBe('Added 20 Sept 2025');
  });

  it("saves an open lead's status and details without its notes, which save on their own", () => {
    const draft = { status: 'new', fullName: 'Priya Shah', email: 'priya@example.com', phone: '', source: 'website', notes: 'stale', mayEmail: false };
    expect(detailsRequest({ ...lead, notes: 'Mornings' }, draft)).toEqual({ source: 'website' });
    expect(detailsRequest({ ...lead, notes: 'Mornings' }, { ...draft, source: 'walk_in' })).toEqual({});
    expect(detailsRequest(lead, { ...draft, source: 'walk_in', mayEmail: true })).toEqual({ mayEmail: true });
    expect(detailsRequest(lead, { ...draft, source: 'walk_in', status: 'lost' })).toEqual({ status: 'lost' });
    const joined = { ...lead, status: 'joined', entryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    expect(detailsRequest(joined, { ...draft, source: 'walk_in', status: 'joined' })).toEqual({});
    expect(detailsRequest(joined, { ...draft, source: 'walk_in', status: 'contacted' })).toEqual({ status: 'contacted' });
    expect(detailsRequest({ ...lead, mayEmail: true }, { ...draft, source: 'walk_in', mayEmail: true })).toEqual({});
    // An emptied email takes the tick with it.
    expect(detailsRequest({ ...lead, mayEmail: true }, { ...draft, source: 'walk_in', email: '', phone: '07700 900123', mayEmail: true })).toEqual({
      email: null,
      phone: '07700 900123',
      mayEmail: false,
    });
  });

  it('says what Joined did in the gym words', () => {
    expect(joinedWords('added', 'Tom', WORDS)).toBe('Tom is on your list of members now.');
    expect(joinedWords('linked', 'Tom', WORDS)).toBe('Tom is on your list of members, as the record that was already there.');
    expect(joinedWords('restored', 'Tom', { ...WORDS, people: 'clients' })).toBe("Tom's record is back on your list of clients.");
  });
});
