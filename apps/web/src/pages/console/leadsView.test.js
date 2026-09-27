import { describe, expect, it } from 'vitest';
import {
  addedDay,
  addedWords,
  detailsRequest,
  createLeadRequest,
  followUpEmail,
  followUpState,
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
  followUp: { sent: 0, dueOn: null, dueNow: false, lastSentAt: null },
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

describe('the follow-up emails (20c-ii)', () => {
  const GYM = { name: 'Iron House', city: 'Leeds', postalAddress: '12 Kirkgate, Leeds LS1 6BY' };
  const due = (over) => ({ ...lead, mayEmail: true, followUp: { sent: 0, dueOn: '2026-09-27', dueNow: true, lastSentAt: null, ...over } });

  it("each email goes to the lead's saved address, names them and the gym, and ends with where the gym is", () => {
    const one = followUpEmail(1, { ...lead, fullName: 'Priya  Shah', email: 'priya+gym@example.com' }, GYM);
    expect(one.subject).toBe('Thanks for asking about Iron House');
    expect(one.body).toBe(
      "Hi Priya,\n\nThanks for asking about Iron House. We'd love to show you around.\n\n" +
        'Come in any time we are open, or reply to this email with any questions.\n\nIron House\n12 Kirkgate, Leeds LS1 6BY',
    );
    const url = new URL(one.href);
    expect(url.protocol).toBe('mailto:');
    expect(decodeURIComponent(url.pathname)).toBe('priya+gym@example.com');
    expect(url.searchParams.get('subject')).toBe(one.subject);
    expect(url.searchParams.get('body')).toBe(one.body);
    expect(followUpEmail(2, lead, GYM).subject).toBe('Come and see us at Iron House');
    expect(followUpEmail(3, lead, GYM).subject).toBe('Still thinking about Iron House?');
    expect(followUpEmail(3, lead, GYM).body).toContain("This is our last note, so we won't fill your inbox.");
    expect(followUpEmail(4, lead, GYM)).toBeNull();
  });

  it('a gym with no postal address signs with its city, and with neither, its name', () => {
    expect(followUpEmail(1, lead, { name: 'Iron House', city: 'Leeds', postalAddress: null }).body.endsWith('\n\nIron House\nLeeds')).toBe(true);
    expect(followUpEmail(1, lead, { name: 'Iron House', city: null, postalAddress: null }).body.endsWith('\n\nIron House')).toBe(true);
  });

  it('a name the gym typed with & or ? cannot break the email link', () => {
    const odd = followUpEmail(1, { ...lead, fullName: 'Jo & Sam?' }, { ...GYM, name: 'Fit & Well? Gym' });
    const url = new URL(odd.href);
    expect(url.searchParams.get('subject')).toBe('Thanks for asking about Fit & Well? Gym');
    expect(url.searchParams.get('body').startsWith('Hi Jo,')).toBe(true);
  });

  it('says which is due and when, what went, and why they stopped', () => {
    const now = new Date('2026-09-27T12:00:00');
    expect(followUpState(due({}), now)).toEqual({ next: 1, headline: 'Email 1 of 3 is due today', due: true, sentLine: null });
    expect(followUpState(due({ sent: 1, dueOn: '2026-09-30', dueNow: false, lastSentAt: '2026-09-27T09:00:00.000Z' }), now)).toEqual({
      next: 2,
      headline: 'Email 2 of 3 is due Wed 30 Sept',
      due: false,
      sentLine: '1 of 3 sent, the last today.',
    });
    expect(followUpState(due({ sent: 3, dueOn: null, dueNow: false, lastSentAt: '2026-09-20T09:00:00.000Z' }), now)).toMatchObject({
      next: null,
      headline: 'All 3 follow-up emails sent',
      sentLine: '3 of 3 sent, the last on 20 Sept.',
    });
    expect(followUpState({ ...due({ sent: 1, dueOn: null, dueNow: false, lastSentAt: '2026-09-26T09:00:00.000Z' }), status: 'contacted' }, now)).toMatchObject({
      next: null,
      headline: "Follow-up emails stopped: they're marked Contacted",
      sentLine: '1 of 3 sent, the last yesterday.',
    });
    expect(followUpState({ ...due({ sent: 2, dueOn: null, dueNow: false, lastSentAt: '2026-09-26T09:00:00.000Z' }), mayEmail: false }, now).headline).toBe(
      "Follow-up emails stopped: they haven't said yes to email at this address",
    );
  });

  it('a lead who never said yes and has had none gets no box, and nothing to send', () => {
    expect(followUpState(lead)).toBeNull();
    expect(followUpState({ ...lead, status: 'lost' })).toBeNull();
  });

  it('"Email due" asks the server for due leads only', () => {
    expect(leadsQueryString({ status: 'all', query: '', due: true })).toBe('followUp=due');
    expect(leadsQueryString({ status: 'new', query: 'pri', due: false })).toBe('status=new&q=pri');
  });
});
