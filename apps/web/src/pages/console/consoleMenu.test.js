import { describe, expect, it } from 'vitest';
import { ROLE_PRIVILEGES } from '@app/shared';
import { consoleLook, consoleMenu, moreIsCurrent } from './consoleMenu';

const keys = (list) => list.map((p) => p.key);

describe('where each page sits on a phone', () => {
  it('an owner: four tabs, Leads and Settings under More', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.owner, 'gym');
    expect(keys(menu.pages)).toEqual(['overview', 'members', 'leads', 'attendance', 'classes', 'settings']);
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance', 'classes']);
    expect(keys(menu.more)).toEqual(['leads', 'settings']);
  });

  it('a manager: Leads under More, no Settings', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.manager, 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance', 'classes']);
    expect(keys(menu.more)).toEqual(['leads']);
  });

  it('a trainer: three tabs, nothing under More but the way out', () => {
    const menu = consoleMenu('iron-house', ROLE_PRIVILEGES.trainer, 'gym');
    expect(keys(menu.tabs)).toEqual(['overview', 'members', 'attendance']);
    expect(keys(menu.more)).toEqual([]);
  });

  it('Settings for a manager given the gym details only', () => {
    const menu = consoleMenu('iron-house', [...ROLE_PRIVILEGES.manager, 'org.manage'], 'gym');
    expect(keys(menu.more)).toEqual(['leads', 'settings']);
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
