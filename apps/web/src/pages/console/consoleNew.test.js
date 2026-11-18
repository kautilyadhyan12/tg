// NEW, IN THE BAR ACROSS THE TOP (V1-c). The worst thing: staff offered under New something
// their role may not do. Each line is checked against the rule its own page shows that button
// by, imported from that page's module, and against the app's real roles, never against New's
// own list.
import { describe, expect, it } from 'vitest';
import { ORG_PRIVILEGES, ROLE_PRIVILEGES } from '@app/shared';
import { newMenu } from './consoleNew';
import { canManageSchedule } from './classesView';
import { canSell } from './sellView';
import { canCheckPeopleIn } from './checkinLogView';
import { canManagePosts } from '../../components/gym/postsView';
import { readOnlyNote } from './billingView';

const SLUG = 'iron-house';
const GYM = { orgType: 'gym', consoleReadOnly: false };

/** What each page shows its own add button to: Members' and Leads' `?open=add` need the
 *  list kept (`members.confirm`); Sell, Classes, Attendance and Updates their page's rule. */
const PAGE_SHOWS = {
  addMember: (p) => p.includes('members.confirm'),
  addLead: (p) => p.includes('members.confirm'),
  newSale: canSell,
  addClass: canManageSchedule,
  checkIn: canCheckPeopleIn,
  newPost: canManagePosts,
};

const offered = (privileges, org = GYM) => newMenu(SLUG, privileges, org).items.map((i) => i.key);

describe('the worst thing: New offers only what this person may do', () => {
  it.each(Object.entries(ROLE_PRIVILEGES))('a %s, with the role as the app gives it', (_role, privileges) => {
    const want = Object.keys(PAGE_SHOWS).filter((key) => PAGE_SHOWS[key]([...privileges]));
    expect(offered([...privileges])).toEqual(want);
  });

  it('a trainer as the app gives the role is offered nothing', () => {
    expect(offered([...ROLE_PRIVILEGES.trainer])).toEqual([]);
  });

  it('every mix of the six ticks the lines hang on, with every other tick held too', () => {
    const ticks = ['members.confirm', 'billing.members', 'schedule.manage', 'attendance.mark', 'posts.manage', 'members.read'];
    const others = ORG_PRIVILEGES.filter((p) => !ticks.includes(p));
    for (let mix = 0; mix < 2 ** ticks.length; mix++) {
      const held = ticks.filter((_, bit) => (mix >> bit) % 2 === 1);
      for (const privileges of [held, [...held, ...others]]) {
        const want = Object.keys(PAGE_SHOWS).filter((key) => PAGE_SHOWS[key](privileges));
        expect(offered(privileges), privileges.join(',')).toEqual(want);
      }
    }
  });

  it('each tick alone, as an owner may give it to anybody, offers only its own line', () => {
    for (const tick of ORG_PRIVILEGES) {
      const want = Object.keys(PAGE_SHOWS).filter((key) => PAGE_SHOWS[key]([tick]));
      expect(offered([tick]), tick).toEqual(want);
    }
  });

  it('somebody not on the staff, or with no list of ticks, is offered nothing', () => {
    for (const nobody of [null, undefined, 'owner', {}, [undefined]]) expect(offered(nobody), String(nobody)).toEqual([]);
  });

  it('a business that can change nothing until it has a plan offers nothing, and says why', () => {
    const lapsed = { orgType: 'pilates_studio', consoleReadOnly: true };
    expect(newMenu(SLUG, [...ROLE_PRIVILEGES.owner], lapsed)).toEqual({ items: [], note: readOnlyNote('pilates_studio') });
  });
});

describe('where each line goes', () => {
  it("opens each page's own box, inside this business's console", () => {
    const { items, note } = newMenu(SLUG, [...ROLE_PRIVILEGES.owner], GYM);
    expect(note).toBeNull();
    expect(items.map(({ label, to }) => [label, to])).toEqual([
      ['Add member', '/console/iron-house/members?open=add'],
      ['Add lead', '/console/iron-house/leads?open=add'],
      ['New sale', '/console/iron-house/sell'],
      ['Add class', '/console/iron-house/classes?open=add'],
      ['Check in', '/console/iron-house/attendance#check-in'],
      ['New post', '/console/iron-house/updates#write'],
    ]);
  });

  it('a studio adds a client', () => {
    expect(newMenu(SLUG, [...ROLE_PRIVILEGES.owner], { orgType: 'pilates_studio' }).items[0].label).toBe('Add client');
  });

  it('without a business in the address there is nowhere to go', () => {
    expect(newMenu(undefined, [...ROLE_PRIVILEGES.owner], GYM).items).toEqual([]);
  });
});
