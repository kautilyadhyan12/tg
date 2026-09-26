import { orgWords } from '@app/shared';
import { canManageStaff } from './staffView';
import { canManageOrg } from './gymDetailsView';
import { canReadAttendance } from './attendanceView';
import { canManageSchedule } from './classesView';

/** Settings holds two sections gated on two permissions (Staff: `staff.manage`; the gym's
 *  details: `org.manage`, which an owner may tick across to a manager), so its page is drawn
 *  for whoever holds either. */
function settingsIsReachable(privileges) {
  return canManageStaff(privileges) || canManageOrg(privileges);
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
    { key: 'members', to: `${base}/members`, end: false, label: orgWords(orgType).peopleCap, phone: 'tab' },
    has('members.confirm') && { key: 'leads', to: `${base}/leads`, end: false, label: 'Leads', phone: 'more' },
    canReadAttendance(privileges) && {
      key: 'attendance',
      to: `${base}/attendance`,
      end: false,
      label: 'Attendance',
      phone: 'tab',
    },
    canManageSchedule(privileges) && { key: 'classes', to: `${base}/classes`, end: false, label: 'Classes', phone: 'tab' },
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
