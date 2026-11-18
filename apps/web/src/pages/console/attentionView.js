import { APP_CANCELS_DAYS, appPaymentChecksHeadline, orgWords } from '@app/shared';
import { appCancelsHeadline } from './appCancelsView';
import { chargebacksHeadline } from './chargebackView';
import { placeFor } from './consolePlaces';
import { totalWords } from './failedPaymentsView';
import { reviewHeadline } from './refundsToReviewView';
import { PAST_PAYMENT_DUE_SHOW, PAYMENT_DUE_SHOW } from './weekView';

// WHAT WAITS (ROADMAP V1-d; spec Part 3 §17.11): the words of the bell's "Needs attention" and
// the counts beside the menu's pages, made here from what `GET …/attention` sent. The server
// sends a part only to somebody who may open its page; a part it left out has no line.

/** The ids of Overview's boxes, so a line of the bell opens Overview at its own box. */
export const OVERVIEW_BOX = {
  chargebacks: 'chargebacks',
  refunds: 'refunds-to-review',
  appPayments: 'app-payment-checks',
  appCancels: 'app-cancels',
};
/** Updates' reported posts and reported comments. */
export const UPDATES_REPORTED = { posts: 'reported', comments: 'reported-comments' };

const n = (count) => count.toLocaleString('en');
const plural = (count, one, many) => (count === 1 ? `1 ${one}` : `${n(count)} ${many}`);

/** The bell's lines, most urgent first: red (money gone wrong), then gold (to review or do),
 *  then plain. Each says what waits, how many, its money where its page shows one, and opens
 *  the place it is dealt with. Nothing waiting: no line. */
export function attentionLines(attention, orgSlug, privileges, orgType) {
  if (attention === null || typeof orgSlug !== 'string' || orgSlug === '') return [];
  const words = orgWords(orgType);
  const base = `/console/${orgSlug}`;
  const lines = [];
  const a = attention;

  // Square connected before the app could read chargebacks: none show until the owner reconnects,
  // so the bell says so, as Overview's Chargebacks box does, and never "Nothing needs attention".
  if (a.chargebacks !== null && a.chargebacks.needsReconnect) {
    const to = a.chargebacks.canReconnect ? placeFor(orgSlug, privileges, 'payments') : null;
    lines.push({
      key: 'reconnect',
      count: 1,
      tone: 'bad',
      title: 'Reconnect Square',
      note: to !== null ? "Chargebacks can't show until you reconnect" : 'The owner needs to reconnect Square before chargebacks can show',
      money: null,
      button: 'Reconnect',
      to,
    });
  }
  if (a.chargebacks !== null && a.chargebacks.count > 0) {
    // Lost ones only: the dispute is over and the money went back (Overview's own words).
    const lostOnly = a.chargebacks.lostCount >= a.chargebacks.count;
    lines.push({
      key: 'chargebacks',
      count: a.chargebacks.count,
      tone: 'bad',
      title: chargebacksHeadline(a.chargebacks.count, a.chargebacks.lostCount),
      note: lostOnly ? 'The money went back to the cardholder' : "A cardholder's bank disputed a payment",
      money: null,
      button: lostOnly ? 'View' : 'Respond',
      to: `${base}#${OVERVIEW_BOX.chargebacks}`,
    });
  }
  if (a.failedPayments !== null && a.failedPayments.count > 0) {
    lines.push({
      key: 'failed-payments',
      count: a.failedPayments.count,
      tone: 'bad',
      title: plural(a.failedPayments.count, 'failed card payment', 'failed card payments'),
      note: 'Declined, still outstanding',
      money: a.failedPayments.totals.length > 0 ? totalWords(a.failedPayments.totals) : null,
      button: 'View',
      to: placeFor(orgSlug, privileges, 'failedPayments'),
    });
  }
  if (a.paymentDue !== null && a.paymentDue.count + a.paymentDue.past > 0) {
    const { count, past } = a.paymentDue;
    const pastPeople = plural(past, `past ${words.person}`, `past ${words.people}`);
    lines.push({
      key: 'payment-due',
      count: count + past,
      tone: 'warn',
      title: count > 0 ? `${plural(count, words.person, words.people)} with a payment due` : `${pastPeople} with a payment due`,
      note: count > 0 && past > 0 ? `Plus ${pastPeople}` : null,
      money: null,
      button: 'View',
      to: `${base}/members?show=${count > 0 ? PAYMENT_DUE_SHOW : PAST_PAYMENT_DUE_SHOW}`,
    });
  }
  if (a.refunds !== null && a.refunds.count > 0) {
    lines.push({
      key: 'refunds',
      count: a.refunds.count,
      tone: 'warn',
      title: reviewHeadline(a.refunds.count),
      note: 'No money moves until you confirm a refund',
      money: null,
      button: 'Review',
      to: `${base}#${OVERVIEW_BOX.refunds}`,
    });
  }
  if (a.appPayments !== null && a.appPayments.count > 0) {
    lines.push({
      key: 'app-payments',
      count: a.appPayments.count,
      tone: 'warn',
      title: appPaymentChecksHeadline(a.appPayments.count),
      note: a.appPayments.more ? 'Charged in the app, not applied here. More appear as you resolve these' : 'Charged in the app, not applied here',
      money: null,
      button: 'Review',
      to: `${base}#${OVERVIEW_BOX.appPayments}`,
    });
  }
  if (a.atRisk !== null && a.atRisk.count > 0) {
    lines.push({
      key: 'at-risk',
      count: a.atRisk.count,
      tone: 'warn',
      title: `${plural(a.atRisk.count, words.person, words.people)} at risk`,
      note: 'Stopped coming',
      money: null,
      button: 'View',
      to: `${base}/at-risk`,
    });
  }
  if (a.reported !== null && a.reported.posts + a.reported.comments > 0) {
    const { posts, comments } = a.reported;
    const parts = [...(posts > 0 ? [plural(posts, 'reported post', 'reported posts')] : []), ...(comments > 0 ? [plural(comments, 'reported comment', 'reported comments')] : [])];
    lines.push({
      key: 'reported',
      count: posts + comments,
      tone: 'warn',
      title: parts.join(' and '),
      note: 'Keep or remove each one',
      money: null,
      button: 'View',
      to: `${base}/updates#${posts > 0 ? UPDATES_REPORTED.posts : UPDATES_REPORTED.comments}`,
    });
  }
  if (a.appCancels !== null && a.appCancels.count > 0) {
    lines.push({
      key: 'app-cancels',
      count: a.appCancels.count,
      tone: 'plain',
      title: appCancelsHeadline(a.appCancels.count),
      note: `Last ${String(APP_CANCELS_DAYS)} days`,
      money: null,
      button: 'View',
      to: `${base}#${OVERVIEW_BOX.appCancels}`,
    });
  }
  if (a.newLeads !== null && a.newLeads.count > 0) {
    lines.push({
      key: 'new-leads',
      count: a.newLeads.count,
      tone: 'plain',
      title: plural(a.newLeads.count, 'new lead', 'new leads'),
      note: 'Not contacted yet',
      money: null,
      button: 'View',
      to: `${base}/leads?status=new`,
    });
  }
  return lines;
}

/** The colour a count takes: red if anything in it is, else gold if anything is, else plain. */
function toneOf(lines) {
  if (lines.some((l) => l.tone === 'bad')) return 'bad';
  if (lines.some((l) => l.tone === 'warn')) return 'warn';
  return 'plain';
}

/** The counts beside the menu's pages, by the page's key: Overview's is the number of kinds
 *  waiting (the bell's lines); Leads, At risk, Failed payments and Updates their own. A page
 *  with nothing waiting has no count. */
export function menuCounts(lines) {
  const counts = {};
  if (lines.length > 0) counts.overview = { count: lines.length, tone: toneOf(lines) };
  const own = { 'new-leads': 'leads', 'at-risk': 'at-risk', 'failed-payments': 'failed-payments', reported: 'updates' };
  for (const line of lines) {
    const page = own[line.key];
    if (page !== undefined) counts[page] = { count: line.count, tone: line.tone };
  }
  return counts;
}

/** What a screen reader hears for the bell. */
export function bellLabel(lines) {
  if (lines.length === 0) return 'Needs attention: nothing needs attention';
  return lines.length === 1 ? 'Needs attention: 1 thing needs attention' : `Needs attention: ${String(lines.length)} things need attention`;
}

/** The figure drawn in a count: never wider than three characters. */
export function countText(count) {
  return count > 99 ? '99+' : String(count);
}

/** The count on the phone's More tab: everything waiting on the pages under More, in the
 *  colour of the most urgent of them; null with nothing waiting there. */
export function moreCount(morePages, counts) {
  const under = morePages.map((p) => counts[p.key]).filter((c) => c !== undefined);
  if (under.length === 0) return null;
  const tone = under.some((c) => c.tone === 'bad') ? 'bad' : under.some((c) => c.tone === 'warn') ? 'warn' : 'plain';
  return { count: under.reduce((sum, c) => sum + c.count, 0), tone };
}

/** Whether this person may see any part at all. Somebody who may see none has no bell: its
 *  "Nothing needs attention" would say what the app cannot know for them. */
export function seesAnyPart(attention) {
  return attention !== null && Object.values(attention).some((part) => part !== null);
}
