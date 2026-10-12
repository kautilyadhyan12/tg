import { orgWords } from '@app/shared';
import { shortDay } from './atRiskView';

// THE WORDS OF OVERVIEW'S "LAST 7 DAYS" BOX (spec Part 3 §16.4; ROADMAP 20d-ii). Every
// line the box says is made here, from what the server sent; the box only draws them.

/** Members opened already showing the people with a payment due (`Members.jsx` reads it). */
export const PAYMENT_DUE_SHOW = 'payment-due';

const n = (count) => count.toLocaleString('en');

/** "5 Oct to 11 Oct": the seven days counted. */
export function weekSpan(week) {
  return `${shortDay(week.from)} to ${shortDay(week.to)}`;
}

/** The box's rows, top to bottom: each a name, what it reads, and the page that holds the
 *  detail. A part the server left out has no row; with none there is no box. */
export function weekRows(week, orgSlug, orgType) {
  const words = orgWords(orgType);
  const people = (count) => (count === 1 ? `1 ${words.person}` : `${n(count)} ${words.people}`);
  const base = `/console/${orgSlug}`;
  const rows = [];
  if (week.members !== null) {
    const { joined, left } = week.members;
    rows.push({
      key: 'members',
      label: words.peopleCap,
      // The list's first people are not new members: only who left is said then.
      value: joined === null ? `${n(left)} left` : `${n(joined)} new · ${n(left)} left`,
      note: null,
      to: `${base}/reports`,
      button: 'Open Reports',
    });
  }
  if (week.atRisk !== null) {
    const { count } = week.atRisk;
    rows.push({
      key: 'at-risk',
      label: 'At risk',
      value: count === 0 ? 'Nobody has stopped coming' : `${people(count)} ${count === 1 ? 'has' : 'have'} stopped coming`,
      note: 'Today',
      to: `${base}/at-risk`,
      button: count === 0 ? 'Open At risk' : 'See who',
    });
  }
  if (week.visits !== null) {
    const { thisWeek, weekBefore } = week.visits;
    rows.push({
      key: 'visits',
      label: 'Visits',
      value: thisWeek === 1 ? '1 visit' : `${n(thisWeek)} visits`,
      note: weekBefore === null ? null : `${n(weekBefore)} in the 7 days before`,
      to: `${base}/attendance`,
      button: 'Open Attendance',
    });
  }
  if (week.paymentDue !== null) {
    const { count } = week.paymentDue;
    rows.push({
      key: 'payment-due',
      label: 'Payment due',
      value: count === 0 ? 'Nobody has a payment due' : `${people(count)} ${count === 1 ? 'has' : 'have'} a payment due`,
      note: 'Today',
      // With nobody owing there is nobody to see.
      to: count === 0 ? null : `${base}/members?show=${PAYMENT_DUE_SHOW}`,
      button: count === 0 ? null : 'See who',
    });
  }
  return rows;
}
