import { orgWords } from '@app/shared';
import { MENU_GROUPS, consoleMenu } from './consoleMenu';
import { canOpenPlace, placeTo } from './consolePlaces';
import { newMenu } from './consoleNew';
import { consoleIsReadOnly } from './billingView';
import { memberContactTitle } from './memberContactView';

// SEARCH, IN THE BAR ACROSS THE TOP (spec Part 3 §17.11, V1-e-i): every page, tab, action and
// Settings section, each with the words people type for it. A page comes from the menu itself
// and every other line from `consolePlaces.js`, so search offers only what this person's menu
// and buttons already would. People join it in V1-e-ii.

/** The groups results come in, in their order. */
export const SEARCH_GROUPS = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'page', label: 'Pages' },
  { key: 'action', label: 'Actions' },
  { key: 'setting', label: 'Settings' },
];

const MONEY = ['money', 'payments', 'billing', 'revenue', 'sales', 'card', 'refund', 'tax'];

/** What each menu page is, in a few words, and the other words people use for it. */
const PAGE_WORDS = {
  overview: { note: () => 'Today at a glance', words: ['home', 'dashboard', 'summary', 'today', 'needs attention', 'getting started'] },
  attendance: { note: () => 'Check-ins and visits', words: ['check in', 'checkin', 'check-ins', 'checkins', 'visits', 'front desk', 'door', 'scan', 'attendance'] },
  classes: { note: () => 'Timetable and bookings', words: ['schedule', 'timetable', 'bookings', 'booking', 'class', 'calendar', 'waitlist'] },
  training: { note: (w) => `${w.coachesCap}' sessions and hours`, words: ['pt', 'personal trainer', 'sessions', 'appointments', 'coach', 'hours'] },
  members: { note: (w) => `Your list and the ${w.people} in the app`, words: ['members', 'clients', 'customers', 'people', 'contacts', 'list', 'past members', 'in the app', 'roster'] },
  leads: { note: () => 'Enquiries and trials', words: ['prospects', 'enquiries', 'inquiries', 'trial', 'sign ups', 'crm', 'pipeline'] },
  'at-risk': { note: (w) => `${w.peopleCap} who have stopped coming`, words: ['churn', 'retention', 'inactive', 'absent', 'lapsed'] },
  sell: { note: () => 'Point of sale', words: ['pos', 'point of sale', 'till', 'register', 'checkout', 'shop', 'products', 'receipt', ...MONEY] },
  memberships: { note: () => 'Price list', words: ['prices', 'pricing', 'packages', 'plans', 'class packs', 'products', 'discounts', ...MONEY] },
  'failed-payments': { note: () => 'Declined card payments', words: ['declined', 'failed', 'retry', 'unpaid', 'outstanding', ...MONEY] },
  updates: { note: (w) => `Posts ${w.people} read in the app`, words: ['news', 'posts', 'announcements', 'feed', 'community', 'reported'] },
  events: { note: () => 'Events and workshops', words: ['workshops', 'seminars', 'socials'] },
  plans: { note: (w) => `Plans you give your ${w.people}`, words: ['meal plan', 'nutrition', 'diet', 'workout plan', 'programme', 'program'] },
  challenges: { note: () => 'Challenges in the app', words: ['competition', 'goals', 'contest'] },
  leaderboard: { note: () => 'Who leads this month', words: ['ranking', 'rankings', 'top', 'scores'] },
  reports: { note: () => 'Revenue and attendance figures', words: ['analytics', 'figures', 'statistics', 'stats', 'export', 'insights', ...MONEY] },
  settings: { note: () => 'What is set once', words: ['preferences', 'setup', 'configuration', 'options'] },
};

/** Tabs and pages inside a menu page, each opened as its own place. */
const TABS = [
  { key: 'staff', place: 'staff', title: () => 'Staff', where: (w, members) => members, words: ['team', 'employees', 'roles', 'permissions', 'access', 'coaches', 'trainers'] },
  { key: 'calendar', place: 'calendar', title: () => 'Calendar', where: () => 'Classes', words: ['week', 'timetable', 'schedule'] },
  { key: 'duplicates', place: 'duplicates', title: () => 'Possible duplicates', where: (w, members) => members, words: ['duplicate', 'merge', 'same person', 'twice'] },
];

/** What each of New's lines is called here, where it opens, and its other words. */
const NEW_WORDS = {
  addMember: { where: (w, members) => members, words: ['new member', 'new client', 'join', 'sign up', 'register', 'create'] },
  addLead: { where: () => 'Leads', words: ['new lead', 'enquiry', 'prospect', 'trial'] },
  newSale: { where: () => 'Sell', words: ['sell', 'sale', 'charge', 'take payment', 'pos', 'checkout', 'money', 'card'] },
  addClass: { where: () => 'Classes', words: ['new class', 'schedule', 'timetable', 'session'] },
  checkIn: { where: () => 'Attendance', words: ['check in', 'checkin', 'scan', 'visit', 'front desk', 'arrive'] },
  newPost: { where: () => 'Updates', words: ['write', 'post', 'announcement', 'news'] },
};

/** Actions that are not on New. */
const MORE_ACTIONS = [
  { key: 'importMembers', place: 'importMembers', title: (w) => `Import ${w.people}`, where: (w, members) => members, words: ['upload', 'file', 'csv', 'spreadsheet', 'excel', 'move from'] },
  { key: 'recordPayment', place: 'paymentDue', title: () => 'Record a payment', where: () => 'Payment due · select a member', words: ['take payment', 'cash', 'bank transfer', 'paid', 'record', ...MONEY] },
  { key: 'inviteStaff', place: 'inviteStaff', title: () => 'Invite staff', where: () => 'Staff', words: ['add staff', 'team', 'employee', 'coach', 'trainer', 'front desk'] },
];

/** Lists and boxes inside a page, opened as their own place. */
const PAGE_PARTS = [
  { key: 'paymentDue', place: 'paymentDue', title: () => 'Payment due', where: (w, members) => members, words: ['overdue', 'outstanding', 'owe', 'unpaid', 'due', 'arrears', ...MONEY] },
  { key: 'noCardOnFile', place: 'noCardOnFile', title: () => 'No card on file', where: (w, members) => members, words: ['card on file', 'cards on file', 'request cards', 'autopay', 'saved card', ...MONEY] },
  { key: 'products', place: 'products', title: () => 'Products', where: () => 'Sell', words: ['stock', 'inventory', 'shop', 'retail', 'items', 'merchandise', ...MONEY] },
];

/** Settings sections and the boxes set once on other pages, by their own titles. */
const SETTINGS = [
  { place: 'gymDetails', title: (w) => `${w.itCap} details`, where: () => 'Settings', words: ['name', 'business', 'profile', 'logo', 'details', 'kind of business'] },
  { place: 'country', title: () => 'Country', where: (w) => `Settings · ${w.itCap} details`, words: ['currency', 'region', 'tax', 'location'] },
  { place: 'postalAddress', title: () => 'Postal address', where: (w) => `Settings · ${w.itCap} details`, words: ['address', 'location', 'street'] },
  { place: 'payments', title: () => 'Payments', where: () => 'Settings', words: ['square', 'connect', 'card reader', 'terminal', 'payouts', 'stripe', 'razorpay', ...MONEY] },
  { place: 'openingHours', title: () => "When we're open", where: () => 'Settings', words: ['hours', 'opening hours', 'opening times', 'closed', 'holidays'] },
  { place: 'memberContact', title: (w, orgType) => memberContactTitle(orgType), where: () => 'Settings', words: ['contact', 'phone', 'email', 'whatsapp', 'reach'] },
  { place: 'messages', title: () => 'Automatic messages', where: () => 'Settings', words: ['emails', 'reminders', 'notifications', 'birthday', 'welcome'] },
  { place: 'referrals', title: () => 'Refer a friend', where: () => 'Settings', words: ['referral', 'referrals', 'reward', 'invite a friend'] },
  { place: 'bookingRules', title: () => 'Booking rules', where: () => 'Settings', words: ['cancel', 'cancellation', 'late cancel', 'no show', 'fee', 'waitlist', 'booking window'] },
  { place: 'frontDesk', title: () => 'Check-in devices', where: () => 'Settings', words: ['tablet', 'kiosk', 'door', 'scanner', 'front desk', 'qr'] },
  { place: 'checkinRules', title: () => 'Who can check in', where: () => 'Settings', words: ['access', 'door', 'entry', 'blocked', 'overdue'] },
  { place: 'waiver', title: () => 'Waiver', where: () => 'Settings', words: ['liability', 'form', 'sign', 'consent', 'release'] },
  { place: 'agreement', title: () => 'Membership agreements', where: () => 'Settings', words: ['contract', 'terms', 'sign', 'agreement'] },
  { place: 'deletedForms', title: (w) => `Signed forms of deleted ${w.people}`, where: () => 'Settings', words: ['deleted', 'waiver', 'agreement', 'signed', 'records'] },
  { place: 'leadEmails', title: () => 'Follow-up emails to leads', where: () => 'Settings', words: ['lead', 'follow up', 'nurture', 'emails'] },
  { place: 'membershipTax', title: () => 'Tax', where: () => 'Memberships', words: ['vat', 'gst', 'sales tax', 'tax rate', 'money'] },
  { place: 'membershipDiscounts', title: () => 'Discounts', where: () => 'Memberships', words: ['promo', 'promo code', 'coupon', 'code', 'offer', 'money'] },
  { place: 'membershipBills', title: () => 'Bills', where: () => 'Memberships', words: ['invoice', 'invoices', 'grace period', 'overdue', 'due', 'money', 'billing'] },
  { place: 'plan', title: () => 'Your KWAZO plan', where: () => 'Overview', words: ['subscription', 'kwazo', 'upgrade', 'trial', 'billing', 'pay us', 'money', 'invoice'] },
];

/** What waits, from the bell's own lines (V1-d): the words each kind is found by. */
const ATTENTION_WORDS = {
  reconnect: ['square', 'chargebacks', 'reconnect', ...MONEY],
  chargebacks: ['chargeback', 'chargebacks', 'dispute', 'disputed', ...MONEY],
  'failed-payments': ['declined', 'failed', ...MONEY],
  'payment-due': ['overdue', 'outstanding', 'due', 'unpaid', ...MONEY],
  refunds: ['refunds to review', 'refund', 'refunds', ...MONEY],
  'app-payments': ['app payments', 'paid in the app', ...MONEY],
  'app-cancels': ['cancelled', 'cancel', 'cancellations', 'membership', ...MONEY],
  'at-risk': ['churn', 'inactive', 'absent'],
  reported: ['reported', 'post', 'comment', 'moderation'],
  'new-leads': ['leads', 'enquiries', 'prospects'],
};
const NEEDS = ['needs attention', 'attention', 'alerts', 'waiting', 'to do'];

/** The lines before anything is typed under Quick actions, by their key. */
const QUICK = ['checkIn', 'addMember', 'newSale'];

const groupLabel = (key) => MENU_GROUPS.find((g) => g.key === key)?.label ?? null;

/** EVERY PLACE THIS PERSON MAY OPEN, as search lines `{ key, kind, title, where, words, to }`.
 *  Nothing with no address, nothing their role cannot open, and no action while the business
 *  can change nothing (§4.2), as New. `waiting`: the bell's lines (`attentionLines`), each
 *  already only what this person may open. */
export function searchCatalogue(orgSlug, privileges, org, waiting = []) {
  if (typeof orgSlug !== 'string' || orgSlug === '') return [];
  const orgType = org?.orgType;
  const w = orgWords(orgType);
  const menu = consoleMenu(orgSlug, privileges, orgType);
  const membersName = menu.pages.find((p) => p.key === 'members')?.label ?? w.peopleCap;
  const lines = [];

  for (const line of Array.isArray(waiting) ? waiting : []) {
    if (typeof line?.to !== 'string' || line.to === '') continue;
    lines.push({ key: `attention:${line.key}`, kind: 'attention', title: line.title, where: line.note ?? 'Needs attention', words: [...(ATTENTION_WORDS[line.key] ?? []), ...NEEDS], to: line.to });
  }
  for (const page of menu.pages) {
    const about = PAGE_WORDS[page.key];
    const group = groupLabel(page.group);
    const note = about ? about.note(w) : null;
    lines.push({
      key: `page:${page.key}`,
      kind: 'page',
      title: page.label,
      where: [group, note].filter(Boolean).join(' · '),
      words: about ? about.words : [],
      to: page.to,
    });
  }
  for (const tab of TABS) {
    if (!canOpenPlace(privileges, tab.place)) continue;
    const to = placeTo(orgSlug, tab.place);
    if (to !== null) lines.push({ key: `page:${tab.key}`, kind: 'page', title: tab.title(w), where: tab.where(w, membersName), words: tab.words, to });
  }

  for (const part of PAGE_PARTS) {
    if (!canOpenPlace(privileges, part.place)) continue;
    const to = placeTo(orgSlug, part.place);
    if (to !== null) lines.push({ key: `page:${part.key}`, kind: 'page', title: part.title(w), where: part.where(w, membersName), words: part.words, to });
  }

  if (!consoleIsReadOnly(org)) {
    for (const item of newMenu(orgSlug, privileges, org).items) {
      const about = NEW_WORDS[item.key];
      lines.push({ key: `action:${item.key}`, kind: 'action', title: item.label, where: about ? about.where(w, membersName) : '', words: about ? about.words : [], to: item.to });
    }
    for (const action of MORE_ACTIONS) {
      if (!canOpenPlace(privileges, action.place)) continue;
      const to = placeTo(orgSlug, action.place);
      if (to !== null) lines.push({ key: `action:${action.key}`, kind: 'action', title: action.title(w), where: action.where(w, membersName), words: action.words, to });
    }
  }

  for (const setting of SETTINGS) {
    if (!canOpenPlace(privileges, setting.place)) continue;
    const to = placeTo(orgSlug, setting.place);
    if (to !== null) lines.push({ key: `setting:${setting.place}`, kind: 'setting', title: setting.title(w, orgType), where: setting.where(w), words: setting.words, to });
  }
  // A line lands only on a page in this person's own menu: a tick for a box (check people in)
  // without the tick for its page (see who came) offers nothing here.
  const inMenu = (to) => {
    const path = to.split(/[?#]/)[0];
    return menu.pages.some((p) => path === p.to || (!p.end && path.startsWith(`${p.to}/`)));
  };
  return lines.filter((line) => inMenu(line.to));
}

/** Lower case, accents and punctuation gone, one space between words. */
export function plain(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** How well a line answers what was typed: 0 for no match. Every word typed must start a
 *  word of the line's title, its other words or where it lives; the title counts most. */
function score(line, asked) {
  const title = plain(line.title);
  const titleWords = title.split(' ');
  const other = [...line.words.map(plain), plain(line.where)].join(' ').split(' ');
  const typed = asked.split(' ');
  let total = 0;
  for (const word of typed) {
    if (titleWords.some((t) => t.startsWith(word))) total += 3;
    else if (other.some((t) => t.startsWith(word))) total += 1;
    else return 0;
  }
  if (title === asked) total += 10;
  else if (title.startsWith(asked)) total += 5;
  else if (line.words.some((x) => plain(x) === asked)) total += 2;
  return total;
}

/** The results for what was typed, each group's best first, every match shown; a group with
 *  none is left out. The group holding the best line comes first ("tax" opens on the Tax
 *  setting, "check in" on the action), and otherwise SEARCH_GROUPS' order. Nothing typed is no
 *  groups. */
export function searchResults(catalogue, typed) {
  const asked = plain(typed);
  if (asked === '') return [];
  const scored = catalogue.map((line, at) => ({ line, at, s: score(line, asked) })).filter((x) => x.s > 0);
  return SEARCH_GROUPS.map((g, order) => {
    const mine = scored.filter((x) => x.line.kind === g.key).sort((a, b) => b.s - a.s || a.at - b.at);
    return { ...g, order, best: mine[0]?.s ?? 0, lines: mine.map((x) => x.line) };
  })
    .filter((g) => g.lines.length > 0)
    .sort((a, b) => b.best - a.best || a.order - b.order)
    .map(({ key, label, lines }) => ({ key, label, lines }));
}

/** What shows before anything is typed: Recent (the keys kept on this device, only those this
 *  person may still open) and Quick actions. */
export function searchStart(catalogue, recentKeys) {
  const byKey = new Map(catalogue.map((line) => [line.key, line]));
  const recent = (Array.isArray(recentKeys) ? recentKeys : []).map((k) => byKey.get(k)).filter((line) => line !== undefined).slice(0, RECENT_MAX);
  const quick = QUICK.map((k) => byKey.get(`action:${k}`)).filter((line) => line !== undefined);
  return [
    { key: 'recent', label: 'Recent', lines: recent },
    { key: 'quick', label: 'Quick actions', lines: quick },
  ].filter((g) => g.lines.length > 0);
}

/** THE PLACES THIS PERSON OPENED FROM SEARCH, on this device, by key only: never a name, and a
 *  key their role no longer opens is not shown (`searchStart`). Kept for each business apart. */
export const RECENT_KEY = 'kwazo.console.searchRecent';
export const RECENT_MAX = 5;

export function readRecent(storage, orgSlug) {
  try {
    const kept = JSON.parse(storage?.getItem(RECENT_KEY) ?? '{}');
    const list = kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? kept[orgSlug] : null;
    return Array.isArray(list) ? list.filter((k) => typeof k === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function writeRecent(storage, orgSlug, key) {
  try {
    const kept = JSON.parse(storage?.getItem(RECENT_KEY) ?? '{}');
    const all = kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
    const was = Array.isArray(all[orgSlug]) ? all[orgSlug] : [];
    all[orgSlug] = [key, ...was.filter((k) => k !== key)].slice(0, RECENT_MAX);
    storage?.setItem(RECENT_KEY, JSON.stringify(all));
  } catch {
    // Not kept: search still works, with no Recent.
  }
}

/** The words in the search box, by the business's own word for its people once people join
 *  search; until then, what it finds. */
export function searchPlaceholder() {
  return 'Search pages or actions';
}

/** The keys that open search: Ctrl K, or ⌘K on a Mac. */
export function opensSearch(event) {
  return (event.ctrlKey === true || event.metaKey === true) && event.altKey !== true && event.shiftKey !== true && String(event.key).toLowerCase() === 'k';
}

export function searchKeysLabel(platform) {
  return /mac|iphone|ipad/i.test(String(platform ?? '')) ? '⌘K' : 'Ctrl K';
}
