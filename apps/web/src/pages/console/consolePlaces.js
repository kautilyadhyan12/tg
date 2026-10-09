import { orgWords } from '@app/shared';
import { canManageStaff } from './staffView';
import { canManageOrg } from './gymDetailsView';
import { canManageSchedule } from './classesView';
import { canManageMemberships } from './membershipTypesView';
import { canManageBilling } from './billingView';
import { canReadAttendance } from './attendanceView';

// WHERE EACH PLACE IN THE CONSOLE IS, AND WHO MAY OPEN IT (ROADMAP 23d). A sentence that
// sends somebody to another page carries a button that opens that exact place, with its
// box open. This is the one list of those places: every button to a place has the same
// address, and nobody is sent to a place their role cannot open.

/** The parts of Settings a button opens: the `id` each has on that page. The postal
 *  address and the country are boxes inside the gym's details. */
export const SETTINGS_SECTION = {
  details: 'gym-details',
  postalAddress: 'postal-address',
  country: 'country',
  hours: 'opening-hours',
  memberContact: 'member-contact',
  bookingRules: 'booking-rules',
  frontDesk: 'check-in-devices',
  leadEmails: 'follow-up-emails',
};

/** The sections of Settings that the gym's details box holds. */
export const DETAILS_SECTIONS = [SETTINGS_SECTION.details, SETTINGS_SECTION.postalAddress, SETTINGS_SECTION.country];

/** Where the plan is on Overview. */
export const PLAN_SECTION = 'plan';

const has = (privileges, privilege) => Array.isArray(privileges) && privileges.includes(privilege);
const onStaff = (privileges) => Array.isArray(privileges);

/** Each place: the rest of its address after the gym's own, and who may open it (the
 *  rule its page and the menu use). */
const PLACES = {
  gymDetails: { path: `/settings#${SETTINGS_SECTION.details}`, may: canManageOrg },
  postalAddress: { path: `/settings#${SETTINGS_SECTION.postalAddress}`, may: canManageOrg },
  country: { path: `/settings#${SETTINGS_SECTION.country}`, may: canManageOrg },
  openingHours: { path: `/settings#${SETTINGS_SECTION.hours}`, may: canManageOrg },
  memberContact: { path: `/settings#${SETTINGS_SECTION.memberContact}`, may: canManageOrg },
  bookingRules: { path: `/settings#${SETTINGS_SECTION.bookingRules}`, may: canManageSchedule },
  frontDesk: { path: `/settings#${SETTINGS_SECTION.frontDesk}`, may: canManageOrg },
  leadEmails: { path: `/settings#${SETTINGS_SECTION.leadEmails}`, may: canManageOrg },
  memberships: { path: '/memberships', may: canManageMemberships },
  members: { path: '/members', may: onStaff },
  importMembers: { path: '/members?open=import', may: onStaff },
  addMember: { path: '/members?open=add', may: onStaff },
  staff: { path: '/members?view=staff', may: canManageStaff },
  inviteStaff: { path: '/members?view=staff&open=invite', may: canManageStaff },
  classes: { path: '/classes', may: canManageSchedule },
  calendar: { path: '/classes?view=week', may: canManageSchedule },
  personalTraining: { path: '/personal-training', may: onStaff },
  attendance: { path: '/attendance', may: canReadAttendance },
  leads: { path: '/leads', may: (privileges) => has(privileges, 'members.confirm') },
  plan: { path: `#${PLAN_SECTION}`, may: canManageBilling },
};

/** Whether somebody holding these permissions can open the place. An unknown place, or
 *  no permissions at all, is a no. */
export function canOpenPlace(privileges, place) {
  const found = Object.hasOwn(PLACES, place) ? PLACES[place] : null;
  return found !== null && found.may(privileges) === true;
}

/** The address of a place in this gym's console, or null without a gym or for a place
 *  that is not on the list. */
export function placeTo(orgSlug, place) {
  const found = Object.hasOwn(PLACES, place) ? PLACES[place] : null;
  if (found === null || typeof orgSlug !== 'string' || orgSlug === '') return null;
  return `/console/${orgSlug}${found.path}`;
}

/** A real calendar day as 'YYYY-MM-DD', or null for anything else. */
export function dayOrNull(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const at = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === text ? text : null;
}

/** The Calendar on the week that holds `day` ('YYYY-MM-DD'); this week for anything else. */
export function calendarTo(orgSlug, day) {
  const to = placeTo(orgSlug, 'calendar');
  if (to === null) return null;
  return dayOrNull(day) === null ? to : `${to}&week=${day}`;
}

/** Personal training showing one trainer's week. */
export function trainerWeekTo(orgSlug, trainerId) {
  const to = placeTo(orgSlug, 'personalTraining');
  if (to === null) return null;
  return typeof trainerId === 'string' && trainerId !== '' ? `${to}?trainer=${encodeURIComponent(trainerId)}` : to;
}

/** The address a button uses, or null when this person cannot open the place: the
 *  sentence then says who can, and has no button. */
export function placeFor(orgSlug, privileges, place) {
  return canOpenPlace(privileges, place) ? placeTo(orgSlug, place) : null;
}

/** The sentences the server writes that need something done in another place (ROADMAP
 *  23d-ii): the place, its button, and who can for somebody who cannot open it. */
const SENTENCE_PLACES = {
  gymName: { place: 'gymDetails', button: (details) => `Open ${details}`, ask: (details) => `The owner can change the name in ${details}.` },
  postalAddress: { place: 'postalAddress', button: () => 'Add your postal address', ask: (details) => `The owner can add it in ${details}.` },
  country: { place: 'country', button: () => 'Set your country', ask: (details) => `The owner can set the country in ${details}.` },
  staff: { place: 'staff', button: () => 'Open the Staff tab', ask: () => 'The owner can change their access.' },
};

/** What goes under such a sentence: `to` and the button's words for whoever can open the
 *  place, or `to: null` and `ask`, the line that says who can. Null for a sentence that
 *  names no place. */
export function sentencePlace(kind, orgSlug, privileges, orgType) {
  const found = typeof kind === 'string' && Object.hasOwn(SENTENCE_PLACES, kind) ? SENTENCE_PLACES[kind] : null;
  if (found === null) return null;
  const details = `${orgWords(orgType).itCap} details`;
  if (!canOpenPlace(privileges, found.place)) return { to: null, button: null, ask: found.ask(details) };
  const to = placeTo(orgSlug, found.place);
  return to === null ? null : { to, button: found.button(details), ask: null };
}
