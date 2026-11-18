// SEARCH (V1-e-i). The worst thing it could do: offer somebody a page or a button their role
// cannot open (front desk shown Payments settings). Each line is checked against the page it
// lands on and the tick that page itself asks for, for every mix of the ticks.
import { describe, expect, it } from 'vitest';
import { ORG_PRIVILEGES, ROLE_PRIVILEGES } from '@app/shared';
import { consoleMenu } from './consoleMenu';
import { RECENT_KEY, RECENT_MAX, opensSearch, plain, readRecent, searchCatalogue, searchKeysLabel, searchResults, searchStart, writeRecent } from './searchPlaces';

const SLUG = 'iron-house';
const org = (extra = {}) => ({ orgType: 'gym', ...extra });
const titles = (lines) => lines.map((l) => l.title);
const found = (privileges, typed, o = org()) => searchResults(searchCatalogue(SLUG, privileges, o), typed);
const inGroup = (groups, key) => titles(groups.find((g) => g.key === key)?.lines ?? []);

// What each Settings section, and each box elsewhere that is set once, asks for: read from the
// pages themselves (Settings.jsx draws each section on `org.manage`, Booking rules on
// `schedule.manage`; Memberships on `memberships.manage`; the plan on `billing.manage`).
const SETTING_NEEDS = {
  'settings#gym-details': 'org.manage',
  'settings#country': 'org.manage',
  'settings#postal-address': 'org.manage',
  'settings#payments': 'org.manage',
  'settings#opening-hours': 'org.manage',
  'settings#member-contact': 'org.manage',
  'settings#automatic-messages': 'org.manage',
  'settings#refer-a-friend': 'org.manage',
  'settings#booking-rules': 'schedule.manage',
  'settings#check-in-devices': 'org.manage',
  'settings#who-can-check-in': 'org.manage',
  'settings#waiver': 'org.manage',
  'settings#membership-agreement': 'org.manage',
  'settings#deleted-forms': 'org.manage',
  'settings#follow-up-emails': 'org.manage',
  'memberships#tax': 'memberships.manage',
  'memberships#discounts': 'memberships.manage',
  'memberships#bills': 'memberships.manage',
  '#plan': 'billing.manage',
};

describe('the worst thing: nothing this person cannot open', () => {
  it('front desk, a trainer and a manager are never offered what their role cannot open', () => {
    const trainer = searchCatalogue(SLUG, ROLE_PRIVILEGES.trainer, org());
    expect(titles(trainer)).not.toContain('Payments');
    expect(titles(trainer)).not.toContain('Sell');
    expect(titles(trainer)).not.toContain('Settings');
    expect(titles(trainer)).not.toContain('Tax');
    expect(titles(trainer)).not.toContain('Invite staff');
    // A desk that checks people in and sells, and nothing else.
    const desk = searchCatalogue(SLUG, ['members.read', 'attendance.read', 'attendance.mark', 'billing.members'], org());
    expect(titles(desk)).toContain('Check in');
    expect(titles(desk)).not.toContain('Payments');
    expect(titles(desk)).not.toContain("Gym details");
    expect(found(['members.read', 'attendance.read', 'attendance.mark'], 'square')).toEqual([]);
    const manager = searchCatalogue(SLUG, ROLE_PRIVILEGES.manager, org());
    expect(titles(manager)).not.toContain('Your KWAZO plan');
  });

  it('every mix of the ticks: each line lands on a page in their menu, behind the tick it asks for', () => {
    const all = [...ORG_PRIVILEGES];
    for (let mix = 0; mix < 2 ** all.length; mix += 1) {
      const privileges = all.filter((_, i) => (mix & (1 << i)) !== 0);
      const pages = consoleMenu(SLUG, privileges, 'gym').pages;
      const inMenu = (path) => pages.some((p) => path === p.to || (!p.end && path.startsWith(`${p.to}/`)));
      for (const line of searchCatalogue(SLUG, privileges, org())) {
        const path = line.to.split(/[?#]/)[0];
        if (!inMenu(path)) throw new Error(`${line.key} opens ${line.to}, not in the menu of ${privileges.join(',')}`);
        if (line.kind === 'setting') {
          const tail = line.to.slice(`/console/${SLUG}`.length).replace(/^\//, '');
          const need = SETTING_NEEDS[tail];
          if (need === undefined) throw new Error(`${line.key}: no rule known for ${line.to}`);
          if (!privileges.includes(need)) throw new Error(`${line.key} shown without ${need}`);
        }
      }
    }
  });

  it('while the business can change nothing, it offers no action; its pages stay', () => {
    const lines = searchCatalogue(SLUG, ROLE_PRIVILEGES.owner, org({ consoleReadOnly: true }));
    expect(lines.filter((l) => l.kind === 'action')).toEqual([]);
    expect(titles(lines)).toContain('Sell');
  });

  it('no business, no list', () => {
    expect(searchCatalogue('', ROLE_PRIVILEGES.owner, org())).toEqual([]);
    expect(searchCatalogue(undefined, ROLE_PRIVILEGES.owner, org())).toEqual([]);
    // Without a role yet the menu holds Overview and Members, as it does today; nothing else.
    expect(searchCatalogue(SLUG, undefined, org()).map((l) => l.key)).toEqual(['page:overview', 'page:members']);
  });
});

// The words people type, from outside the code: the help pages and menus of Mindbody, Glofox,
// Gymdesk and PushPress name these, and front desks say them. Several are on no list here.
describe('what people type finds the place', () => {
  const owner = ROLE_PRIVILEGES.owner;
  it.each([
    ['money', 'page', 'Sell'],
    ['money', 'setting', 'Payments'],
    ['billing', 'page', 'Failed payments'],
    ['card', 'setting', 'Payments'],
    ['square', 'setting', 'Payments'],
    ['card reader', 'setting', 'Payments'],
    ['refund', 'page', 'Sell'],
    ['tax', 'setting', 'Tax'],
    ['vat', 'setting', 'Tax'],
    ['gst', 'setting', 'Tax'],
    ['promo code', 'setting', 'Discounts'],
    ['coupon', 'setting', 'Discounts'],
    ['invoice', 'setting', 'Bills'],
    ['waiver', 'setting', 'Waiver'],
    ['contract', 'setting', 'Membership agreements'],
    ['cancellation', 'setting', 'Booking rules'],
    ['no show', 'setting', 'Booking rules'],
    ['opening hours', 'setting', "When we're open"],
    ['kiosk', 'setting', 'Check-in devices'],
    ['pos', 'page', 'Sell'],
    ['point of sale', 'page', 'Sell'],
    ['timetable', 'page', 'Classes'],
    ['schedule', 'page', 'Classes'],
    ['enquiries', 'page', 'Leads'],
    ['churn', 'page', 'At risk'],
    ['analytics', 'page', 'Reports'],
    ['check in', 'action', 'Check in'],
    ['checkin', 'page', 'Attendance'],
    ['csv', 'action', 'Import members'],
    ['import', 'action', 'Import members'],
    ['staff', 'page', 'Staff'],
    ['team', 'page', 'Staff'],
    ['subscription', 'setting', 'Your KWAZO plan'],
    ['sett', 'page', 'Settings'],
    ['MEMBERSHIPS', 'page', 'Memberships'],
  ])('"%s" finds %s %s', (typed, group, title) => {
    expect(inGroup(found(owner, typed), group)).toContain(title);
  });

  it('the title counts most: "sell" puts Sell first, "tax" puts Tax first', () => {
    expect(inGroup(found(owner, 'sell'), 'page')[0]).toBe('Sell');
    expect(inGroup(found(owner, 'tax'), 'setting')[0]).toBe('Tax');
  });

  it('a word nothing has finds nothing, and nothing typed is no groups', () => {
    expect(found(owner, 'calories')).toEqual([]);
    expect(found(owner, 'zzzz')).toEqual([]);
    expect(found(owner, '   ')).toEqual([]);
    expect(found(owner, '%$#')).toEqual([]);
  });

  it('the group with the best line comes first: "tax" the Tax setting, "check in" the action', () => {
    expect(found(owner, 'tax')[0].lines[0].title).toBe('Tax');
    expect(found(owner, 'check in')[0].lines[0].title).toBe('Check in');
    expect(found(owner, 'opening hours')[0].lines[0].title).toBe("When we're open");
    expect(found(owner, 'sell')[0].lines[0].title).toBe('Sell');
  });

  it('groups come Pages, Actions, Settings, each at most eight', () => {
    const groups = found(owner, 'money');
    expect(groups.map((g) => g.label)).toEqual(['Pages', 'Actions', 'Settings']);
    for (const g of groups) expect(g.lines.length).toBeLessThanOrEqual(8);
  });

  it("a studio's words: clients, instructors", () => {
    const lines = searchCatalogue(SLUG, ROLE_PRIVILEGES.owner, org({ orgType: 'studio' }));
    expect(titles(lines)).toContain('Add client');
    expect(titles(lines)).toContain('Studio details');
    expect(titles(lines)).toContain('Clients & staff');
    expect(inGroup(found(owner, 'members', org({ orgType: 'studio' })), 'page')).toContain('Clients & staff');
  });

  it('accents and capitals are ignored', () => {
    expect(plain('  Café  RÈGLES ')).toBe('cafe regles');
  });
});

describe('Recent and Quick actions', () => {
  const store = () => {
    const kept = new Map();
    return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), kept };
  };

  it('keeps the last five opened, newest first, for each business apart, by key only', () => {
    const s = store();
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) writeRecent(s, SLUG, k);
    writeRecent(s, 'core-pilates', 'x');
    expect(readRecent(s, SLUG)).toEqual(['b', 'f', 'e', 'd', 'c']);
    expect(readRecent(s, 'core-pilates')).toEqual(['x']);
    expect(RECENT_MAX).toBe(5);
  });

  it('a broken or blocked store keeps nothing and throws nothing', () => {
    const broken = { getItem: () => '{not json', setItem: () => {} };
    expect(readRecent(broken, SLUG)).toEqual([]);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readRecent(blocked, SLUG)).toEqual([]);
    expect(() => writeRecent(blocked, SLUG, 'a')).not.toThrow();
    expect(readRecent(null, SLUG)).toEqual([]);
    const s = store();
    s.setItem(RECENT_KEY, JSON.stringify({ [SLUG]: ['page:sell', 7, null] }));
    expect(readRecent(s, SLUG)).toEqual(['page:sell']);
  });

  it('a place their role no longer opens drops out of Recent', () => {
    const trainer = searchCatalogue(SLUG, ROLE_PRIVILEGES.trainer, org());
    const groups = searchStart(trainer, ['setting:payments', 'page:attendance', 'page:sell', 'action:checkIn']);
    expect(groups.map((g) => [g.label, titles(g.lines)])).toEqual([['Recent', ['Attendance']]]);
  });

  it('an owner starts with Check in, Add member and New sale', () => {
    const owner = searchCatalogue(SLUG, ROLE_PRIVILEGES.owner, org());
    expect(searchStart(owner, []).map((g) => [g.label, titles(g.lines)])).toEqual([['Quick actions', ['Check in', 'Add member', 'New sale']]]);
  });
});

describe('the keys', () => {
  it('Ctrl K and ⌘K open it; K alone, Ctrl Shift K and Ctrl Alt K do not', () => {
    expect(opensSearch({ ctrlKey: true, key: 'k' })).toBe(true);
    expect(opensSearch({ metaKey: true, key: 'K' })).toBe(true);
    expect(opensSearch({ key: 'k' })).toBe(false);
    expect(opensSearch({ ctrlKey: true, shiftKey: true, key: 'K' })).toBe(false);
    expect(opensSearch({ ctrlKey: true, altKey: true, key: 'k' })).toBe(false);
    expect(searchKeysLabel('MacIntel')).toBe('⌘K');
    expect(searchKeysLabel('Win32')).toBe('Ctrl K');
  });
});
