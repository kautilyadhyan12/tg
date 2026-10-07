import { orgWords } from '@app/shared';
import { canManageStaff } from './staffView';
import { canManageOrg } from './gymDetailsView';
import { canReadAttendance } from './attendanceView';
import { canManageSchedule } from './classesView';
import { canSeeLeaderboard } from './leaderboardStaffView';
import { canManageChallenges } from './challengesView';
import { canManageMemberships } from './membershipTypesView';
import { canManagePosts } from '../../components/gym/postsView';

/** Settings holds sections gated on two permissions (the gym's details: `org.manage`;
 *  Class bookings: `schedule.manage`), so its page is drawn for whoever holds either.
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

/** THE CONSOLE'S PAGES THIS PERSON MAY OPEN, in the menu's order (spec Part 3 §17.5).
 *
 *  On a computer every page is in the menu on the left. On a phone the pages a gym works in
 *  every day are tabs and the rest sit under More, each page in exactly one of the two.
 *  Drawing a page is not the permission: every route refuses on its own. */
export function consoleMenu(orgSlug, privileges, orgType) {
  const has = (p) => Array.isArray(privileges) && privileges.includes(p);
  const base = `/console/${orgSlug}`;
  const pages = [
    { key: 'overview', to: base, end: true, label: 'Overview', phone: 'tab' },
    // `tabLabel`: the phone's bottom bar has room for one word.
    { key: 'members', to: `${base}/members`, end: false, label: membersPageName(privileges, orgType), tabLabel: orgWords(orgType).peopleCap, phone: 'tab' },
    // What the gym sells (23c-i): its own line, straight after the people who hold it.
    canManageMemberships(privileges) && { key: 'memberships', to: `${base}/memberships`, end: false, label: 'Memberships', phone: 'more' },
    has('members.confirm') && { key: 'leads', to: `${base}/leads`, end: false, label: 'Leads', phone: 'more' },
    canReadAttendance(privileges) && {
      key: 'attendance',
      to: `${base}/attendance`,
      end: false,
      label: 'Attendance',
      phone: 'tab',
    },
    canManageSchedule(privileges) && { key: 'classes', to: `${base}/classes`, end: false, label: 'Classes', phone: 'tab' },
    // Every member of staff: their own hours and sessions, or everybody's for whoever
    // runs the timetable.
    Array.isArray(privileges) && { key: 'training', to: `${base}/personal-training`, end: false, label: 'Personal training', phone: 'more' },
    canManagePosts(privileges) && { key: 'updates', to: `${base}/updates`, end: false, label: 'Updates', phone: 'more' },
    canManagePosts(privileges) && { key: 'events', to: `${base}/events`, end: false, label: 'Events', phone: 'more' },
    canSeeLeaderboard(privileges) && {
      key: 'leaderboard',
      to: `${base}/leaderboard`,
      end: false,
      label: 'Leaderboard',
      phone: 'more',
    },
    canManageChallenges(privileges) && { key: 'challenges', to: `${base}/challenges`, end: false, label: 'Challenges', phone: 'more' },
    settingsIsReachable(privileges) && {
      key: 'settings',
      to: `${base}/settings`,
      end: false,
      label: 'Settings',
      phone: 'more',
    },
  ].filter(Boolean);
  return {
    pages,
    tabs: pages.filter((p) => p.phone === 'tab'),
    more: pages.filter((p) => p.phone === 'more'),
    moreTo: `${base}/more`,
  };
}

/** Whether the phone's More tab is the current one: on More itself, or on a page that is
 *  reached from it. */
export function moreIsCurrent(menu, pathname) {
  if (pathname === menu.moreTo) return true;
  return menu.more.some((p) => pathname === p.to || pathname.startsWith(`${p.to}/`));
}

/** Dark, or light when a development build is opened with `?look=light`: how a page already
 *  drawn in both looks is checked before the Light · Dark · Auto switch exists. */
export function consoleLook(search, isDev) {
  if (!isDev) return 'dark';
  return new URLSearchParams(search).get('look') === 'light' ? 'light' : 'dark';
}
