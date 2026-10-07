import { describe, expect, it } from 'vitest';
import { ROLE_PRIVILEGES } from '@app/shared';
import { consoleLook, consoleMenu, moreIsCurrent } from './consoleMenu';

const keys = (list) => list.map((p) => p.key);

describe('where each page sits on a phone', () => {
  it('an owner: four tabs; Memberships, Leads, Personal training, Updates, Leaderboard and Settings under More', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.owner, 'gym');
    expect(keys(menu.pages)).toEqual(['overview', 'members', 'memberships', 'leads', 'attendance', 'classes', 'training', 'updates', 'events', 'leaderboard', 'challenges', 'settings']);
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance', 'classes']);
    expect(keys(menu.more)).toEqual(['memberships', 'leads', 'training', 'updates', 'events', 'leaderboard', 'challenges', 'settings']);
  });

  // A manager's usual permissions hold the price list (17a-i): Memberships, a page of its
  // own since 23c-i.
  it('a manager: Memberships, Leads, Updates, Leaderboard and Settings under More', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.manager, 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance', 'classes']);
    expect(keys(menu.more)).toEqual(['memberships', 'leads', 'training', 'updates', 'events', 'leaderboard', 'challenges', 'settings']);
    expect(menu.more[0]).toMatchObject({ to: '/console/iron-house/memberships', label: 'Memberships' });
  });

  it('Memberships goes with its tick, not the job title: a trainer given it has the page, a manager without it does not', () => {
    const trainer = consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'memberships.manage'], 'gym');
    expect(keys(trainer.more)).toEqual(['memberships', 'training']);
    const manager = consoleMenu('iron-house', ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage'), 'gym');
    expect(keys(manager.pages)).not.toContain('memberships');
  });

  // Settings holds nothing about what the gym sells since 23c-i.
  it('the price list alone does not bring Settings: Memberships is where it is', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.manager.filter((p) => p !== 'schedule.manage'), 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance']);
    expect(keys(menu.more)).toEqual(['memberships', 'leads', 'training', 'updates', 'events', 'leaderboard', 'challenges']);
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
    expect(keys(menu.more)).toEqual(['leads', 'training', 'updates', 'events', 'leaderboard', 'challenges']);
  });

  // Staff are on Members → Staff since 23c-ii: that tick alone opens nothing in Settings.
  it('somebody whose only tick there was staff: no Settings, and Members as everybody has it', () => {
    const none = ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage' && p !== 'schedule.manage');
    const menu = consoleMenu('iron-house', [...none, 'staff.manage'], 'gym');
    expect(keys(menu.more)).not.toContain('settings');
    expect(keys(menu.tabs)).toContain('members');
  });

  it('a manager who sets the timetable and nothing else in Settings still has it, for Class bookings', () => {
    const timetable = ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage');
    const menu = consoleMenu('iron-house', timetable, 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance', 'classes']);
    expect(keys(menu.more)).toEqual(['leads', 'training', 'updates', 'events', 'leaderboard', 'challenges', 'settings']);
    expect(keys(menu.pages)).not.toContain('memberships');
  });

  it('a trainer the owner gave the leaderboard: it and Challenges are under More', () => {
    const menu = consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'leaderboard.manage'], 'gym');
    expect(keys(menu.more)).toEqual(['training', 'leaderboard', 'challenges']);
  });

  it('a trainer the owner gave Updates: it is under More', () => {
    const menu = consoleMenu('iron-house', [...ROLE_PRIVILEGES.trainer, 'posts.manage'], 'gym');
    expect(keys(menu.more)).toEqual(['training', 'updates', 'events']);
    expect(menu.more[1].to).toBe('/console/iron-house/updates');
  });

  it('a trainer: three tabs, and their own Personal training under More', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.trainer, 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance']);
    expect(keys(menu.more)).toEqual(['training']);
    expect(menu.more[0].to).toBe('/console/iron-house/personal-training');
  });

  it('Settings for a manager given the gym details only', () => {
    const menu = consoleMenu('iron-house', [...ROLE_PRIVILEGES.manager, 'org.manage'], 'gym');
    expect(keys(menu.more)).toEqual(['memberships', 'leads', 'training', 'updates', 'events', 'leaderboard', 'challenges', 'settings']);
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
    const menu = consoleMenu('flow', ROLE_PRIVILEGES.owner, orgType);
    expect(menu.pages.find((p) => p.key === 'members').label).toBe(word);
    expect(menu.pages[0].label).toBe('Overview');
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
