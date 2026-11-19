import { orgWords } from '@app/shared';
import { canManageStaff } from './staffView';
import { canManageOrg } from './gymDetailsView';
import { canReadAttendance } from './attendanceView';
import { canManageSchedule } from './classesView';
import { canSeeLeaderboard } from './leaderboardStaffView';
import { canManageChallenges } from './challengesView';
import { canManageMemberships } from './membershipTypesView';
import { canManagePosts } from '../../components/gym/postsView';
import { canReadReports } from './reportsView';
import { canSeeAtRisk } from './atRiskView';
import { canOpenSell } from './sellView';
import { canSeeFailedPayments } from './failedPaymentsAccess';
import { canManagePlans } from './mealPlansView';
import { canOpenPaymentsOverview } from './consolePlaces';

/** Settings holds sections gated on two permissions (the gym's details: `org.manage`;
 *  Booking rules: `schedule.manage`), so its page is drawn for whoever holds either.
 *  What the gym sells left it for a page of its own (23c-i), and staff for Members → Staff
 *  (23c-ii). */
function settingsIsReachable(privileges) {
  return canManageOrg(privileges) || canManageSchedule(privileges);
}

/** WHAT THE MEMBERS PAGE IS CALLED, in the menu and as its own title: "Members & staff"
 *  for whoever has its Staff tab (Kd, RULINGS 2026-10-07: staff are on this page, so its
 *  name says so), and "Members" for everybody else, whose page holds no staff. A studio
 *  and a trainer have clients. */
export function membersPageName(privileges, orgType) {
  const people = orgWords(orgType).peopleCap;
  return canManageStaff(privileges) ? `${people} & staff` : people;
}

/** THE MENU'S FIVE GROUPS (spec Part 3 §17.10 rule 7), in their order. Overview sits above
 *  them; a group is drawn only when it holds a page this person may open. */
export const MENU_GROUPS = [
  { key: 'today', label: 'Today' },
  { key: 'people', label: 'People' },
  { key: 'money', label: 'Money' },
  { key: 'community', label: 'Community' },
  { key: 'manage', label: 'Manage' },
];

/** The phone's bottom bar, in its own order whatever the menu's groups are. */
const TAB_ORDER = ['overview', 'members', 'attendance', 'classes'];

/** THE CONSOLE'S PAGES THIS PERSON MAY OPEN, in the menu's order (spec Part 3 §17.5, §17.10).
 *
 *  On a computer every page is in the menu on the left, under its group. On a phone the pages
 *  a gym works in every day are tabs and the rest sit under More, each page in exactly one of
 *  the two. Drawing a page is not the permission: every route refuses on its own. */
export function consoleMenu(orgSlug, privileges, orgType) {
  const has = (p) => Array.isArray(privileges) && privileges.includes(p);
  const base = `/console/${orgSlug}`;
  const pages = [
    { key: 'overview', to: base, end: true, label: 'Overview', phone: 'tab', group: null },
    // Today: what happens at the desk and on the timetable.
    canReadAttendance(privileges) && { key: 'attendance', to: `${base}/attendance`, end: false, label: 'Attendance', phone: 'tab', group: 'today' },
    canManageSchedule(privileges) && { key: 'classes', to: `${base}/classes`, end: false, label: 'Classes', phone: 'tab', group: 'today' },
    // Every member of staff: their own hours and sessions, or everybody's for whoever
    // runs the timetable.
    Array.isArray(privileges) && { key: 'training', to: `${base}/personal-training`, end: false, label: 'Personal training', phone: 'more', group: 'today' },
    // People. `tabLabel`: the phone's bottom bar has room for one word.
    { key: 'members', to: `${base}/members`, end: false, label: membersPageName(privileges, orgType), tabLabel: orgWords(orgType).peopleCap, phone: 'tab', group: 'people' },
    has('members.confirm') && { key: 'leads', to: `${base}/leads`, end: false, label: 'Leads', phone: 'more', group: 'people' },
    // Who has stopped coming (20d-i).
    canSeeAtRisk(privileges) && { key: 'at-risk', to: `${base}/at-risk`, end: false, label: 'At risk', phone: 'more', group: 'people' },
    // Money: Payments overview first, a line to every payment page and setting (V1-f), the
    // desk's register (18b-i), what the gym sells (23c-i), and card payments declined and
    // still owed (18d-iii-ii-b).
    canOpenPaymentsOverview(privileges) && { key: 'payments', to: `${base}/payments`, end: false, label: 'Payments overview', phone: 'more', group: 'money' },
    canOpenSell(privileges) && { key: 'sell', to: `${base}/sell`, end: false, label: 'Sell', phone: 'more', group: 'money' },
    canManageMemberships(privileges) && { key: 'memberships', to: `${base}/memberships`, end: false, label: 'Memberships', phone: 'more', group: 'money' },
    canSeeFailedPayments(privileges) && { key: 'failed-payments', to: `${base}/failed-payments`, end: false, label: 'Failed payments', phone: 'more', group: 'money' },
    // Community: what members see in the app.
    canManagePosts(privileges) && { key: 'updates', to: `${base}/updates`, end: false, label: 'Updates', phone: 'more', group: 'community' },
    canManagePosts(privileges) && { key: 'events', to: `${base}/events`, end: false, label: 'Events', phone: 'more', group: 'community' },
    // The meal plans the gym gives its members (24a-i).
    canManagePlans(privileges) && { key: 'plans', to: `${base}/plans`, end: false, label: 'Fitness plans', phone: 'more', group: 'community' },
    canManageChallenges(privileges) && { key: 'challenges', to: `${base}/challenges`, end: false, label: 'Challenges', phone: 'more', group: 'community' },
    canSeeLeaderboard(privileges) && { key: 'leaderboard', to: `${base}/leaderboard`, end: false, label: 'Leaderboard', phone: 'more', group: 'community' },
    // Manage: the gym's figures (21a-i), and what is set once.
    canReadReports(privileges) && { key: 'reports', to: `${base}/reports`, end: false, label: 'Reports', phone: 'more', group: 'manage' },
    settingsIsReachable(privileges) && { key: 'settings', to: `${base}/settings`, end: false, label: 'Settings', phone: 'more', group: 'manage' },
  ].filter(Boolean);
  const tabs = TAB_ORDER.map((key) => pages.find((p) => p.key === key)).filter((p) => p !== undefined);
  return {
    pages,
    tabs,
    more: pages.filter((p) => p.phone === 'more'),
    moreTo: `${base}/more`,
  };
}

/** The pages of a list under the five groups, in order; a group with none of them is left
 *  out. Overview, which has no group, is in none. */
export function menuGroups(pages) {
  return MENU_GROUPS.map((g) => ({ ...g, pages: pages.filter((p) => p.group === g.key) })).filter((g) => g.pages.length > 0);
}

/** Whether the phone's More tab is the current one: on More itself, or on a page that is
 *  reached from it. */
export function moreIsCurrent(menu, pathname) {
  if (pathname === menu.moreTo) return true;
  // Your account is opened from More on a phone (19b-ii).
  if (pathname === `${menu.moreTo.slice(0, -'/more'.length)}/account`) return true;
  return menu.more.some((p) => pathname === p.to || pathname.startsWith(`${p.to}/`));
}

/** Dark, or light when a development build is opened with `?look=light`: how a page already
 *  drawn in both looks is checked before the Light · Dark · Auto switch exists. */
export function consoleLook(search, isDev) {
  if (!isDev) return 'dark';
  return new URLSearchParams(search).get('look') === 'light' ? 'light' : 'dark';
}

/** WHICH OF THE MENU'S GROUPS THIS PERSON FOLDED, on this device (spec Part 3 §17.11): kept in
 *  the browser, and nothing is folded until they fold it. A browser that keeps nothing (a private
 *  window, storage blocked) keeps the menu open. */
export const FOLDED_KEY = 'kwazo.console.folded';

export function readFolded(storage) {
  try {
    const kept = JSON.parse(storage?.getItem(FOLDED_KEY) ?? '[]');
    const known = new Set(MENU_GROUPS.map((g) => g.key));
    return Array.isArray(kept) ? kept.filter((k) => typeof k === 'string' && known.has(k)) : [];
  } catch {
    return [];
  }
}

export function writeFolded(storage, keys) {
  try {
    storage?.setItem(FOLDED_KEY, JSON.stringify(keys));
  } catch {
    // Not kept: the menu still folds until the page is opened again.
  }
}
