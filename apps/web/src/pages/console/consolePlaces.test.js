// WHERE EACH PLACE IS, AND WHO MAY OPEN IT (ROADMAP 23d). A button that sends somebody to
// a place they cannot open is the fault this file is for: each place is checked against
// the rule the menu itself draws its pages with.
import { describe, expect, it } from 'vitest';
import {
  DETAILS_SECTIONS,
  PLAN_SECTION,
  SETTINGS_SECTION,
  calendarTo,
  canOpenPlace,
  dayOrNull,
  placeFor,
  placeTo,
  trainerWeekTo,
} from './consolePlaces';
import { consoleMenu } from './consoleMenu';

const PLACES = {
  gymDetails: '/console/iron-house/settings#gym-details',
  postalAddress: '/console/iron-house/settings#postal-address',
  country: '/console/iron-house/settings#country',
  openingHours: '/console/iron-house/settings#opening-hours',
  frontDesk: '/console/iron-house/settings#check-in-devices',
  leadEmails: '/console/iron-house/settings#follow-up-emails',
  memberships: '/console/iron-house/memberships',
  members: '/console/iron-house/members',
  importMembers: '/console/iron-house/members?open=import',
  addMember: '/console/iron-house/members?open=add',
  staff: '/console/iron-house/members?view=staff',
  inviteStaff: '/console/iron-house/members?view=staff&open=invite',
  classes: '/console/iron-house/classes',
  calendar: '/console/iron-house/classes?view=week',
  personalTraining: '/console/iron-house/personal-training',
  attendance: '/console/iron-house/attendance',
  leads: '/console/iron-house/leads',
  plan: '/console/iron-house#plan',
};

/** The one permission each place needs; null: anybody on the staff. */
const NEEDS = {
  gymDetails: 'org.manage',
  postalAddress: 'org.manage',
  country: 'org.manage',
  openingHours: 'org.manage',
  frontDesk: 'org.manage',
  leadEmails: 'org.manage',
  memberships: 'memberships.manage',
  members: null,
  importMembers: null,
  addMember: null,
  staff: 'staff.manage',
  inviteStaff: 'staff.manage',
  classes: 'schedule.manage',
  calendar: 'schedule.manage',
  personalTraining: null,
  attendance: 'attendance.read',
  leads: 'members.confirm',
  plan: 'billing.manage',
};

const EVERY = ['org.manage', 'staff.manage', 'memberships.manage', 'schedule.manage', 'members.read', 'members.confirm', 'billing.manage', 'attendance.read'];

describe('where each place is', () => {
  it('every place has one address in the gym on screen', () => {
    for (const [place, to] of Object.entries(PLACES)) expect(placeTo('iron-house', place), place).toBe(to);
    expect(Object.keys(PLACES).sort()).toEqual(Object.keys(NEEDS).sort());
  });

  it('there is no address without a gym, or for a place that is not on the list', () => {
    for (const slug of [undefined, null, '', 7]) expect(placeTo(slug, 'members')).toBeNull();
    for (const place of ['billing', '', undefined, 'toString', '__proto__', 'constructor']) {
      expect(placeTo('iron-house', place), String(place)).toBeNull();
      expect(canOpenPlace(EVERY, place), String(place)).toBe(false);
    }
  });

  it('the parts of Settings and of Overview have the ids their pages draw', () => {
    expect(SETTINGS_SECTION).toEqual({
      details: 'gym-details',
      postalAddress: 'postal-address',
      country: 'country',
      hours: 'opening-hours',
      frontDesk: 'check-in-devices',
      leadEmails: 'follow-up-emails',
    });
    // The postal address and the country are boxes inside the details: a link to either opens them.
    expect(DETAILS_SECTIONS).toEqual(['gym-details', 'postal-address', 'country']);
    expect(PLAN_SECTION).toBe('plan');
  });

  it('the Calendar opens on the week of a real day, and on this week for anything else', () => {
    expect(calendarTo('iron-house', '2026-10-09')).toBe('/console/iron-house/classes?view=week&week=2026-10-09');
    for (const day of [null, undefined, '', '2026-13-01', '2026-02-30', '9 Oct', '2026-10-09&x=1', 20261009]) {
      expect(calendarTo('iron-house', day), String(day)).toBe('/console/iron-house/classes?view=week');
    }
    expect(calendarTo(undefined, '2026-10-09')).toBeNull();
    expect(dayOrNull('2028-02-29')).toBe('2028-02-29');
    expect(dayOrNull('2027-02-29')).toBeNull();
  });

  it("Personal training opens on one trainer's week", () => {
    expect(trainerWeekTo('iron-house', 'u-sam')).toBe('/console/iron-house/personal-training?trainer=u-sam');
    expect(trainerWeekTo('iron-house', 'a b&c')).toBe('/console/iron-house/personal-training?trainer=a%20b%26c');
    expect(trainerWeekTo('iron-house', null)).toBe('/console/iron-house/personal-training');
    expect(trainerWeekTo('', 'u-sam')).toBeNull();
  });
});

describe('who may open each place', () => {
  it.each(Object.entries(NEEDS))('%s: its own permission opens it, and every other one together does not', (place, needs) => {
    if (needs === null) {
      // Anybody on the staff, whatever they hold; nobody who is not.
      expect(canOpenPlace([], place)).toBe(true);
      expect(canOpenPlace(['members.read'], place)).toBe(true);
    } else {
      expect(canOpenPlace([needs], place)).toBe(true);
      expect(canOpenPlace(EVERY.filter((p) => p !== needs), place)).toBe(false);
      expect(canOpenPlace([], place)).toBe(false);
    }
    for (const nobody of [null, undefined, 'owner', { 0: needs }]) expect(canOpenPlace(nobody, place), String(nobody)).toBe(false);
  });

  it('a button has an address only for somebody who can open its place', () => {
    for (const [place, needs] of Object.entries(NEEDS)) {
      const holds = needs === null ? [] : [needs];
      expect(placeFor('iron-house', holds, place), place).toBe(PLACES[place]);
      if (needs !== null) expect(placeFor('iron-house', EVERY.filter((p) => p !== needs), place), place).toBeNull();
      expect(placeFor('iron-house', null, place), place).toBeNull();
      expect(placeFor(undefined, EVERY, place), place).toBeNull();
    }
  });

  // The menu is what a person can open. A place on a page of the menu is offered to
  // exactly the people whose menu has that page, for every mix of the permissions.
  it('agrees with the menu, for every mix of permissions', () => {
    const PAGE_OF = {
      memberships: 'memberships',
      members: 'members',
      importMembers: 'members',
      addMember: 'members',
      classes: 'classes',
      calendar: 'classes',
      personalTraining: 'training',
      attendance: 'attendance',
      leads: 'leads',
    };
    const ticks = ['org.manage', 'staff.manage', 'memberships.manage', 'schedule.manage', 'members.confirm', 'billing.manage', 'attendance.read'];
    for (let mix = 0; mix < 2 ** ticks.length; mix++) {
      const held = ticks.filter((_, bit) => (mix >> bit) % 2 === 1);
      const keys = consoleMenu('iron-house', held, 'gym').pages.map((p) => p.key);
      for (const [place, page] of Object.entries(PAGE_OF)) {
        expect(canOpenPlace(held, place), `${place} for ${held.join(',')}`).toBe(keys.includes(page));
      }
      // A section of Settings needs the gym's details, which is narrower than Settings itself.
      const settings = canOpenPlace(held, 'gymDetails');
      expect(settings).toBe(held.includes('org.manage'));
      if (settings) expect(keys).toContain('settings');
    }
  });
});
