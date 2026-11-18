// SEARCH (V1-e-i). The worst thing it could do: offer somebody a page or a button their role
// cannot open (front desk shown Payments settings). Each line is checked against the page it
// lands on and the tick that page itself asks for, for every mix of the ticks.
import { describe, expect, it } from 'vitest';
import { ORG_PRIVILEGES, ROLE_PRIVILEGES } from '@app/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consoleMenu } from './consoleMenu';
import { PLAN_SECTION, SETTINGS_SECTION } from './consolePlaces';
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
        // Members showing who has a payment due or no card: the list's bills, `billing.members`.
        if (line.to.includes('?show=') && !privileges.includes('billing.members')) throw new Error(`${line.key} shown without billing.members`);
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
    ['overdue', 'page', 'Payment due'],
    ['owe', 'page', 'Payment due'],
    ['card on file', 'page', 'No card on file'],
    ['inventory', 'page', 'Products'],
    ['stock', 'page', 'Products'],
    ['cash', 'action', 'Record a payment'],
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

  it('groups come Pages, Actions, Settings, every match shown', () => {
    const groups = found(owner, 'money');
    expect(groups.map((g) => g.label)).toEqual(['Pages', 'Actions', 'Settings']);
  });

  // Kd at the click-through: "money" must bring every money feature, none cut off. The list is
  // the console's money places as its pages and menu name them, written out here by hand.
  // V1-e-i's review: a hand-written list cannot see a money place it never had. Every line that
  // opens a page of the menu's Money group, Settings' Payments or Country, the plan, or the
  // member list's money filters is a money place, and "money" must find each one.
  it('"money" finds every line that opens a money place, whatever its words', () => {
    const lines = searchCatalogue(SLUG, owner, org());
    const moneyPages = consoleMenu(SLUG, owner, 'gym').pages.filter((p) => p.group === 'money').map((p) => p.to);
    const isMoney = (to) =>
      moneyPages.some((p) => to === p || to.startsWith(`${p}#`) || to.startsWith(`${p}?`) || to.startsWith(`${p}/`)) ||
      /settings#(payments|country)$/.test(to) ||
      to.endsWith('#plan') ||
      /members\?show=(payment-due|no-card)$/.test(to);
    const money = lines.filter((l) => isMoney(l.to));
    expect(money.length).toBeGreaterThan(10);
    const shown = searchResults(lines, 'money').flatMap((g) => g.lines.map((l) => l.key));
    expect(money.map((l) => l.key).filter((k) => !shown.includes(k))).toEqual([]);
  });

  it('"money" finds every money feature an owner has', () => {
    const groups = found(owner, 'money');
    expect(inGroup(groups, 'page')).toEqual(expect.arrayContaining(['Sell', 'Memberships', 'Failed payments', 'Reports', 'Payment due', 'No card on file', 'Products']));
    expect(inGroup(groups, 'action')).toEqual(expect.arrayContaining(['New sale', 'Record a payment']));
    expect(inGroup(groups, 'setting')).toEqual(expect.arrayContaining(['Payments', 'Tax', 'Discounts', 'Bills', 'Your KWAZO plan']));
  });

  it('what waits in the bell is found too, and money that waits by "money"', () => {
    const waiting = [
      { key: 'chargebacks', title: '1 chargeback', note: "A cardholder's bank disputed a payment", to: '/console/iron-house#chargebacks' },
      { key: 'refunds', title: '2 refunds to review', note: null, to: '/console/iron-house#refunds-to-review' },
      { key: 'reconnect', title: 'Reconnect Square', note: 'The owner needs to reconnect Square', to: null },
    ];
    const lines = searchCatalogue(SLUG, owner, org(), waiting);
    const groups = searchResults(lines, 'money');
    expect(groups[0].label).toBe('Needs attention');
    expect(titles(groups[0].lines)).toEqual(['1 chargeback', '2 refunds to review']);
    expect(inGroup(searchResults(lines, 'dispute'), 'attention')).toEqual(['1 chargeback']);
    // A line with no place to open (only the owner may reconnect) is not offered.
    expect(titles(lines)).not.toContain('Reconnect Square');
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

// V1-e-i's review: a test that only checks the address stays green when the page has no
// such section. Every `#` a search line opens names an element the console really draws.
describe('every #section search opens is on its page', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const at = path.join(dir, e.name);
      if (e.isDirectory()) return read(at);
      return /\.jsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [fs.readFileSync(at, 'utf8')] : [];
    });
  const source = [...read(here), ...read(path.join(here, '../../components'))].join('\n');
  const drawn = (id) =>
    source.includes(`id="${id}"`) ||
    source.includes(`hash !== '#${id}'`) ||
    (id === PLAN_SECTION && source.includes('id={PLAN_SECTION}')) ||
    Object.entries(SETTINGS_SECTION).some(([k, v]) => v === id && source.includes(`id={SETTINGS_SECTION.${k}}`));

  it.each(searchCatalogue(SLUG, ROLE_PRIVILEGES.owner, org()).filter((l) => l.to.includes('#')).map((l) => [l.title, l.to]))('%s (%s)', (_, to) => {
    const id = to.slice(to.indexOf('#') + 1);
    expect(drawn(id), `#${id} is drawn by no page`).toBe(true);
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
