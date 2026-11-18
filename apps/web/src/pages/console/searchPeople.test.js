// PEOPLE IN SEARCH (V1-e-ii): the words of each person's line, and who is shown at all. The
// worst thing first: a staff line drawn for somebody who may not open the Staff tab.
import { describe, expect, it } from 'vitest';
import { ROLE_PRIVILEGES } from '@app/shared';
import { asksForPeople, initials, leadLine, memberLine, peopleGroup, searchFindsPeople, searchPlaceholder, staffLine } from './searchPeople';

const SLUG = 'iron-house';
const member = (over = {}) => ({
  entryId: '22222222-2222-4222-8222-222222222222',
  fullName: 'Sam Rivera',
  email: 'sam@example.com',
  phone: null,
  memberNumber: '195',
  status: 'Active',
  membershipType: 'Gold Monthly',
  paymentStatus: 'Paid',
  held: null,
  owedSince: null,
  overdue: false,
  formerAt: null,
  ...over,
});
const lead = { id: '33333333-3333-4333-8333-333333333333', fullName: 'Samir Khan', email: 'samir@example.com', status: 'new', createdAt: '2026-11-12T10:00:00.000Z' };
const staff = { userId: '44444444-4444-4444-8444-444444444444', displayName: 'Samira Ali', role: 'manager', roleName: 'Front desk', coOwner: false };
const found = (over = {}) => ({
  members: { people: [member()], more: false },
  leads: { people: [lead], more: false },
  staff: { people: [staff], more: false },
  ...over,
});
const opts = (privileges = ROLE_PRIVILEGES.owner, typed = 'sam') => ({ orgSlug: SLUG, orgType: 'gym', privileges, typed, membersName: 'Members', today: '2026-11-18' });

describe('the worst thing: nobody is shown a person their role may not open', () => {
  it('a staff line the server sent is dropped for somebody who may not open the Staff tab', () => {
    const group = peopleGroup(found(), opts(ROLE_PRIVILEGES.manager));
    expect(group?.lines.map((l) => l.title)).toEqual(['Sam Rivera', 'Samir Khan']);
  });

  it('search looks for people only for whoever may open Members or the Staff tab', () => {
    expect(searchFindsPeople(ROLE_PRIVILEGES.owner)).toBe(true);
    expect(searchFindsPeople(ROLE_PRIVILEGES.manager)).toBe(true);
    expect(searchFindsPeople(ROLE_PRIVILEGES.trainer)).toBe(false);
    expect(searchFindsPeople(ROLE_PRIVILEGES.manager.filter((p) => p !== 'members.confirm'))).toBe(false);
    expect(searchFindsPeople(undefined)).toBe(false);
  });

  it('nothing found, or a kind the role may not open (null), draws no group or line for it', () => {
    expect(peopleGroup(null, opts())).toBeNull();
    expect(peopleGroup({ members: null, leads: null, staff: null }, opts())).toBeNull();
    expect(peopleGroup({ members: { people: [], more: false }, leads: null, staff: null }, opts())).toBeNull();
  });
});

describe('the words', () => {
  it('the box says what it finds, in the business’s own word', () => {
    expect(searchPlaceholder('gym', true)).toBe('Search members, pages or actions');
    expect(searchPlaceholder('studio', true)).toBe('Search clients, pages or actions');
    expect(searchPlaceholder('gym', false)).toBe('Search pages or actions');
  });

  it('two letters are needed before people are asked for', () => {
    expect(asksForPeople('s')).toBe(false);
    expect(asksForPeople('  s ')).toBe(false);
    expect(asksForPeople('sa')).toBe(true);
  });

  it('initials from names as real lists write them', () => {
    expect(initials('Sam Rivera')).toBe('SR');
    expect(initials('Anne-Marie van der Berg')).toBe('AB');
    expect(initials('José Núñez')).toBe('JN');
    expect(initials('王芳')).toBe('王');
    expect(initials('  Cher ')).toBe('C');
    expect(initials('')).toBe('?');
  });

  it('a member: their number and membership, and their state as their row says it', () => {
    expect(memberLine(member(), SLUG, 'gym', '2026-11-18')).toMatchObject({
      title: 'Sam Rivera',
      where: 'Member 195 · Gold Monthly',
      initials: 'SR',
      tag: { text: 'Active', tone: 'c-tag-soft' },
      to: `/console/${SLUG}/members?person=22222222-2222-4222-8222-222222222222`,
    });
    expect(memberLine(member({ memberNumber: null }), SLUG, 'gym').where).toBe('sam@example.com · Gold Monthly');
    expect(memberLine(member({ memberNumber: null, email: null, phone: '+447700900111' }), SLUG, 'gym').where).toBe('+447700900111 · Gold Monthly');
    expect(memberLine(member({ memberNumber: '41' }), SLUG, 'studio').where).toBe('Client 41 · Gold Monthly');
  });

  it('a member who owes: Payment due, or Overdue in red', () => {
    const held = { status: 'active', memberships: ['Gold Weekly'], day: null, payment: { state: 'due', since: '2026-11-10' } };
    expect(memberLine(member({ held }), SLUG, 'gym').tag).toEqual({ text: 'Payment due', tone: 'c-tag-warn' });
    expect(memberLine(member({ held, overdue: true }), SLUG, 'gym').tag).toEqual({ text: 'Overdue', tone: 'c-tag-bad' });
  });

  it('a past member says so, with the day they left', () => {
    const line = memberLine(member({ formerAt: '2026-09-03T12:00:00.000Z' }), SLUG, 'gym', '2026-11-18');
    expect(line.tag).toEqual({ text: 'Past member', tone: 'c-tag-plain' });
    expect(line.where).toBe('Member 195 · Left 3 Sep 2026');
  });

  it('a lead and a staff member', () => {
    expect(leadLine(lead, SLUG, '2026-11-18')).toMatchObject({
      where: 'Lead · added 12 Nov',
      tag: { text: 'New', tone: 'c-tag-soft' },
      to: `/console/${SLUG}/leads?lead=33333333-3333-4333-8333-333333333333`,
    });
    expect(staffLine(staff, SLUG, 'gym')).toMatchObject({ where: 'Staff · Front desk', tag: null, to: `/console/${SLUG}/members?view=staff&staff=44444444-4444-4444-8444-444444444444` });
    expect(staffLine({ ...staff, role: 'owner', roleName: null, coOwner: true }, SLUG, 'gym').where).toBe('Staff · Co-owner');
  });

  it('more than were shown: "See all" opens the list with the same words in its box', () => {
    const group = peopleGroup(found({ members: { people: [member()], more: true }, leads: { people: [lead], more: true } }), opts(ROLE_PRIVILEGES.owner, 'sam r'));
    expect(group?.lines.map((l) => l.title)).toEqual(['Sam Rivera', 'See all in Members', 'Samir Khan', 'See all in Leads', 'Samira Ali']);
    expect(group?.lines.find((l) => l.title === 'See all in Members')?.to).toBe(`/console/${SLUG}/members?search=sam+r`);
    expect(group?.lines.find((l) => l.title === 'See all in Leads')?.to).toBe(`/console/${SLUG}/leads?search=sam+r`);
  });
});
