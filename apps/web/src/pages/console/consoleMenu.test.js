import { describe, expect, it } from 'vitest';
import { ORG_PRIVILEGES, ROLE_PRIVILEGES } from '@app/shared';
import { MENU_GROUPS, consoleLook, consoleMenu, menuGroups, moreIsCurrent, membersPageName } from './consoleMenu';

const keys = (list) => list.map((p) => p.key);

// The worst thing V1-a could do: put a page in somebody's menu they may not open, or take
// away one they use. The five groups hold exactly the pages each person had before.
describe('the menu in five groups', () => {
  const grouped = (privileges) =>
    menuGroups(consoleMenu('iron-house', privileges, 'gym').pages).map((g) => [g.label, keys(g.pages)]);

  it.each([
    [
      'owner',
      [
        ['Today', ['attendance', 'classes', 'training']],
        ['People', ['members', 'leads', 'at-risk']],
        ['Money', ['payments', 'sell', 'memberships', 'failed-payments']],
        ['Community', ['updates', 'events', 'plans', 'challenges', 'leaderboard']],
        ['Manage', ['reports', 'settings']],
      ],
    ],
    [
      'manager',
      [
        ['Today', ['attendance', 'classes', 'training']],
        ['People', ['members', 'leads', 'at-risk']],
        ['Money', ['payments', 'sell', 'memberships', 'failed-payments']],
        ['Community', ['updates', 'events', 'challenges', 'leaderboard']],
        ['Manage', ['reports', 'settings']],
      ],
    ],
    [
      'trainer',
      [
        ['Today', ['attendance', 'training']],
        ['People', ['members', 'at-risk']],
      ],
    ],
  ])('a %s', (role, groups) => {
    expect(grouped(ROLE_PRIVILEGES[role])).toEqual(groups);
  });

  it('a group with no page for this person has no heading, and Overview sits above them all', () => {
    expect(grouped(['members.read'])).toEqual([
      ['Today', ['training']],
      ['People', ['members', 'at-risk']],
    ]);
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.owner, 'gym');
    expect(menu.pages[0]).toMatchObject({ key: 'overview', group: null });
    expect(MENU_GROUPS.map((g) => g.label)).toEqual(['Today', 'People', 'Money', 'Community', 'Manage']);
  });

  // A page added later without a group would drop out of the menu and of More: for every mix
  // of the permissions, each page is in exactly one group (Overview above them) and, on a
  // phone, in the tabs or under More.
  it('every mix of the permissions: each page in one group, and in the tabs or under More', () => {
    const all = [...ORG_PRIVILEGES];
    for (let mix = 0; mix < 2 ** all.length; mix += 1) {
      const menu = consoleMenu('iron-house', all.filter((_, i) => mix & (1 << i)), 'gym');
      const pages = keys(menu.pages);
      const grouped = menuGroups(menu.pages).flatMap((g) => keys(g.pages));
      if (pages[0] !== 'overview' || grouped.length + 1 !== pages.length || [...grouped].sort().join() !== pages.slice(1).sort().join()) {
        throw new Error(`grouped pages differ for ${all.filter((_, i) => mix & (1 << i)).join(' ')}`);
      }
      if ([...keys(menu.tabs), ...keys(menu.more)].sort().join() !== [...pages].sort().join()) {
        throw new Error(`phone pages differ for ${all.filter((_, i) => mix & (1 << i)).join(' ')}`);
      }
    }
  });

  it('before the permissions arrive: Overview, and Members under People', () => {
    expect(grouped(undefined)).toEqual([['People', ['members']]]);
  });
});

describe('where each page sits on a phone', () => {
  it('an owner: four tabs; Memberships, Leads, Personal training, Updates, Leaderboard and Settings under More', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.owner, 'gym');
    expect(keys(menu.pages)).toEqual(['overview', 'attendance', 'classes', 'training', 'members', 'leads', 'at-risk', 'payments', 'sell', 'memberships', 'failed-payments', 'updates', 'events', 'plans', 'challenges', 'leaderboard', 'reports', 'settings']);
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance', 'classes']);
    expect(keys(menu.more)).toEqual(['training', 'leads', 'at-risk', 'payments', 'sell', 'memberships', 'failed-payments', 'updates', 'events', 'plans', 'challenges', 'leaderboard', 'reports', 'settings']);
  });

  // A manager's usual permissions hold the price list (17a-i): Memberships, a page of its
  // own since 23c-i.
  it('a manager: Memberships, Leads, Updates, Leaderboard and Settings under More', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.manager, 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance', 'classes']);
    expect(keys(menu.more)).toEqual(['training', 'leads', 'at-risk', 'payments', 'sell', 'memberships', 'failed-payments', 'updates', 'events', 'challenges', 'leaderboard', 'reports', 'settings']);
    expect(menu.more[5]).toMatchObject({ to: '/console/iron-house/memberships', label: 'Memberships', group: 'money' });
  });

  it('Memberships goes with its tick, not the job title: a trainer given it has the page, a manager without it does not', () => {
    const trainer = consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'memberships.manage'], 'gym');
    expect(keys(trainer.more)).toEqual(['training', 'at-risk', 'payments', 'sell', 'memberships']);
    const manager = consoleMenu('iron-house', ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage'), 'gym');
    expect(keys(manager.pages)).not.toContain('memberships');
  });

  // Settings holds nothing about what the gym sells since 23c-i.
  it('the price list alone does not bring Settings: Memberships is where it is', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.manager.filter((p) => p !== 'schedule.manage'), 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance']);
    expect(keys(menu.more)).toEqual(['training', 'leads', 'at-risk', 'payments', 'sell', 'memberships', 'failed-payments', 'updates', 'events', 'challenges', 'leaderboard', 'reports']);
  });

  // That Members itself is not lit there is checked on the drawn menu (memberships.render.test.jsx).
  it('More is lit on the Memberships page, and not on Members, though the two addresses start the same', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.owner, 'gym');
    expect(moreIsCurrent(menu, '/console/iron-house/memberships')).toBe(true);
    expect(moreIsCurrent(menu, '/console/iron-house/members')).toBe(false);
  });

  it('a manager without the price list, the timetable or the gym details: no Settings', () => {
    const none = ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage' && p !== 'schedule.manage');
    const menu = consoleMenu('iron-house', none, 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance']);
    expect(keys(menu.more)).toEqual(['training', 'leads', 'at-risk', 'payments', 'sell', 'failed-payments', 'updates', 'events', 'challenges', 'leaderboard', 'reports']);
  });

  // Staff are on Members → Staff since 23c-ii: that tick alone opens nothing in Settings.
  it('somebody whose only tick there was staff: no Settings, and Members as everybody has it', () => {
    const none = ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage' && p !== 'schedule.manage');
    const menu = consoleMenu('iron-house', [...none, 'staff.manage'], 'gym');
    expect(keys(menu.more)).not.toContain('settings');
    expect(keys(menu.tabs)).toContain('members');
  });

  it('a manager who sets the timetable and nothing else in Settings still has it, for Booking rules', () => {
    const timetable = ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage');
    const menu = consoleMenu('iron-house', timetable, 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance', 'classes']);
    expect(keys(menu.more)).toEqual(['training', 'leads', 'at-risk', 'payments', 'sell', 'failed-payments', 'updates', 'events', 'challenges', 'leaderboard', 'reports', 'settings']);
    expect(keys(menu.pages)).not.toContain('memberships');
  });

  it('a trainer the owner gave the leaderboard: it and Challenges are under More', () => {
    const menu = consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'leaderboard.manage'], 'gym');
    expect(keys(menu.more)).toEqual(['training', 'at-risk', 'challenges', 'leaderboard']);
  });

  it('a trainer the owner gave Updates: it is under More', () => {
    const menu = consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'posts.manage'], 'gym');
    expect(keys(menu.more)).toEqual(['training', 'at-risk', 'updates', 'events']);
    expect(menu.more[2].to).toBe('/console/iron-house/updates');
  });
  it('Plans goes with its tick: a trainer given it has the page, a manager without it does not', () => {
    const trainer = consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'plans.manage'], 'gym');
    expect(keys(trainer.more)).toEqual(['training', 'at-risk', 'plans']);
    expect(trainer.more[2].to).toBe('/console/iron-house/plans');
    expect(keys(consoleMenu('iron-house', ROLE_PRIVILEGES.manager, 'gym').pages)).not.toContain('plans');
  });

  it('a trainer the owner gave Reports: it is under More, and a manager without the tick has no such line', () => {
    const menu = consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'reports.read'], 'gym');
    expect(keys(menu.more)).toEqual(['training', 'at-risk', 'reports']);
    expect(menu.more[2]).toMatchObject({ to: '/console/iron-house/reports', label: 'Reports' });
    const manager = consoleMenu('iron-house', ROLE_PRIVILEGES.manager.filter((p) => p !== 'reports.read'), 'gym');
    expect(keys(manager.pages)).not.toContain('reports');
  });

  it('At risk is under More, with the gym’s people, for whoever may see them', () => {
    const menu = consoleMenu('iron-house', ['members.read'], 'gym');
    expect(keys(menu.more)).toEqual(['training', 'at-risk']);
    expect(menu.more[1]).toMatchObject({ key: 'at-risk', to: '/console/iron-house/at-risk', label: 'At risk', group: 'people' });
    expect(keys(consoleMenu('iron-house', ['attendance.read', 'reports.read'], 'gym').pages)).not.toContain('at-risk');
  });

  it('Failed payments is under More, after Sell under Money, for whoever keeps the list and records their payments', () => {
    // Records payments without keeping the list: Try again and the person's page would refuse them.
    expect(keys(consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'billing.members'], 'gym').more)).not.toContain('failed-payments');
    const menu = consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'members.confirm', 'billing.members'], 'gym');
    const money = menu.more.filter((p) => p.group === 'money');
    expect(keys(money)).toEqual(['payments', 'sell', 'failed-payments']);
    expect(money[2]).toMatchObject({ to: '/console/iron-house/failed-payments', label: 'Failed payments' });
    expect(keys(consoleMenu('iron-house', ['members.read'], 'gym').pages)).not.toContain('failed-payments');
    expect(keys(consoleMenu('iron-house', ['billing.members'], 'gym').pages)).not.toContain('failed-payments');
  });

  it('a trainer: three tabs, and their own Personal training under More', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.trainer, 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance']);
    expect(keys(menu.more)).toEqual(['training', 'at-risk']);
    expect(menu.more[0].to).toBe('/console/iron-house/personal-training');
  });

  it('Settings for a manager given the gym details only', () => {
    const menu = consoleMenu('iron-house', [...ROLE_PRIVILEGES.manager, 'org.manage'], 'gym');
    expect(keys(menu.more)).toEqual(['training', 'leads', 'at-risk', 'payments', 'sell', 'memberships', 'failed-payments', 'updates', 'events', 'challenges', 'leaderboard', 'reports', 'settings']);
  });

  it('draws only Overview and Members before the permissions arrive', () => {
    const menu = consoleMenu('iron-house', undefined, undefined);
    expect(keys(menu.pages)).toEqual(['overview', 'members']);
  });
});

describe('the words follow the organisation', () => {
  it.each([
    ['gym', 'Members'],
    ['studio', 'Clients'],
    ['personal_trainer', 'Clients'],
  ])('a %s calls its people %s', (orgType, word) => {
    const menu = consoleMenu('flow', ROLE_PRIVILEGES.manager, orgType);
    expect(menu.pages.find((p) => p.key === 'members').label).toBe(word);
    expect(menu.pages[0].label).toBe('Overview');
  });

  /** Kd, RULINGS 2026-10-07: staff are on this page, so its name says so, for whoever has
   *  the Staff tab. Nobody else is promised staff, and the phone's bar has room for one word. */
  it.each([
    ['gym', 'Members'],
    ['studio', 'Clients'],
    ['personal_trainer', 'Clients'],
  ])('at a %s the owner\'s line reads "%s & staff"; a manager\'s and a trainer\'s keeps the one word, as the phone\'s bar does for everybody', (orgType, word) => {
    const line = (privileges) => consoleMenu('flow', privileges, orgType).pages.find((p) => p.key === 'members');
    expect([line(ROLE_PRIVILEGES.owner).label, line(ROLE_PRIVILEGES.owner).tabLabel]).toEqual([`${word} & staff`, word]);
    for (const role of ['manager', 'trainer']) {
      expect([line(ROLE_PRIVILEGES[role]).label, line(ROLE_PRIVILEGES[role]).tabLabel]).toEqual([word, word]);
    }
    expect(membersPageName(ROLE_PRIVILEGES.owner, orgType)).toBe(`${word} & staff`);
    expect(membersPageName(null, orgType)).toBe(word);
    expect(membersPageName(['members.read', 'members.confirm'], orgType)).toBe(word);
  });
});

describe('the More tab is lit', () => {
  const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.owner, 'gym');
  it.each([
    ['/console/iron-house/more', true],
    ['/console/iron-house/leads', true],
    ['/console/iron-house/leaderboard', true],
    ['/console/iron-house/personal-training', true],
    ['/console/iron-house/updates', true],
    ['/console/iron-house/events', true],
    ['/console/iron-house/challenges', true],
    ['/console/iron-house/settings', true],
    ['/console/iron-house/settings/staff', true],
    ['/console/iron-house', false],
    ['/console/iron-house/members', false],
    ['/console/iron-house/leadsx', false],
  ])('on %s: %s', (path, lit) => {
    expect(moreIsCurrent(menu, path)).toBe(lit);
  });
});

describe('the light look before the switch', () => {
  it.each([
    ['?look=light', true, 'light'],
    ['?look=dark', true, 'dark'],
    ['', true, 'dark'],
    ['?look=light', false, 'dark'],
  ])('%s in development %s is %s', (search, isDev, look) => {
    expect(consoleLook(search, isDev)).toBe(look);
  });
});
