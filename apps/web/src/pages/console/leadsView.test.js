import { describe, expect, it } from 'vitest';
import {
  addedWords,
  createLeadRequest,
  joinedWords,
  leadLine,
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
  entryId: null,
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
    expect(createLeadRequest({ fullName: ' Tom ', email: '', phone: ' 07700 ', source: 'friend', notes: ' ' })).toEqual({
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

  it('writes a row line and the date added', () => {
    expect(leadLine(lead)).toBe('priya@example.com · Walked in');
    expect(leadLine({ ...lead, email: null, phone: '+447700900123', source: 'social' })).toBe('+447700900123 · Social media');
    expect(addedWords('2026-09-20T10:00:00.000Z', new Date('2026-10-01T10:00:00.000Z'))).toBe('Added 20 Sept');
    expect(addedWords('2025-09-20T10:00:00.000Z', new Date('2026-10-01T10:00:00.000Z'))).toBe('Added 20 Sept 2025');
  });

  it('says what Joined did in the gym words', () => {
    expect(joinedWords('added', 'Tom', WORDS)).toBe('Tom is on your list of members now.');
    expect(joinedWords('linked', 'Tom', WORDS)).toBe('Tom is on your list of members, as the record that was already there.');
    expect(joinedWords('restored', 'Tom', { ...WORDS, people: 'clients' })).toBe("Tom's record is back on your list of clients.");
  });
});
