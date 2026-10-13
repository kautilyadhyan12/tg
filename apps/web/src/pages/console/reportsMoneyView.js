import { formatMinor, minorToPriceText } from '@app/shared';
import { csvWords, dayText, monthLong, monthShort } from './reportsView';
import { PAST_PAYMENT_DUE_SHOW, PAYMENT_DUE_SHOW } from './weekView';

// The Reports page's money words (spec Part 3 §16.5; ROADMAP 21b-i). The figures come from
// the payments staff record in the app; a figure the notebook cannot give is a sentence,
// never a zero.

export function canReadMoney(privileges) {
  return Array.isArray(privileges) && privileges.includes('billing.members');
}

const count = (n) => n.toLocaleString('en-GB');
const monthName = (month) => monthLong(month).split(' ')[0];

/** An amount in the gym's currency: "£49.99", and "-£60.00" where more went back than came in. */
export const moneyText = (minor, currency) => (minor < 0 ? `-${formatMinor(-minor, currency)}` : formatMinor(minor, currency));

/** "July, August and September". */
function monthList(months) {
  const names = months.map(monthName);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The line under the heading: where the figures come from. */
export function moneyLine(report) {
  return `These figures come from the payments your staff record in the app. The first was recorded on ${dayText(report.firstPaidOn)}.`;
}

export const OTHER_CURRENCY_NOTE = 'Payments and bills in another currency, from before your country changed, are not counted here.';

/** What takes the figures' place while there are none: the sentence, the place that
 *  starts them, its button, and who can for staff who may not open it. */
export function moneyMissing(report, words) {
  if (report.state === 'no_memberships') {
    return {
      line: `No membership has been given in the app yet. Money figures start when you set up your memberships, give them to your ${words.people} and record their payments.`,
      place: 'memberships',
      button: 'Set up memberships',
      ask: 'Staff who manage memberships can set them up.',
    };
  }
  if (report.state === 'no_payments') {
    return {
      line: `No payment is recorded in the app yet. If you take payments in other software, your money figures are there. To see them here, record each payment on the ${words.person}'s page.`,
      place: 'members',
      button: `Open ${words.peopleCap}`,
      ask: `Staff who can open ${words.peopleCap} can record payments.`,
    };
  }
  return null;
}

const LIFETIME_NONE = {
  not_enough_data: (words) => `Not enough data yet. Lifetime value needs 3 full months of payments recorded here and of your ${words.person} list.`,
  nobody_left: (words) => `Lifetime value is what a ${words.person} pays you before they leave. Nobody left in the months it is worked out over.`,
  nobody_at_start: (words) => `You had no ${words.people} at the start of the last 3 full months, so there is no lifetime value yet.`,
  nothing_collected: () => 'In the last 3 full months you refunded as much as you collected, so there is no lifetime value to show.',
};

/** The people who owe, in words: "2 members", "1 past member", "2 members and 1 past member". */
function owingPeople(owed, words) {
  const now = owed.people === 0 ? null : owed.people === 1 ? `1 ${words.person}` : `${count(owed.people)} ${words.people}`;
  const past = owed.pastPeople === 0 ? null : owed.pastPeople === 1 ? `1 past ${words.person}` : `${count(owed.pastPeople)} past ${words.people}`;
  return [now, past].filter((part) => part !== null).join(' and ');
}

/** The four tiles, in order, as the page's `Tile` draws them. `links` are the buttons
 *  under a tile, each to the people it counts. */
export function moneyTiles(report, words, orgSlug) {
  const cur = report.currency;
  const month = monthName(report.thisMonth.month);
  const before = report.months.length >= 2 ? report.months[report.months.length - 2] : null;
  const beforeText = before === null ? '' : ` · ${monthName(before.month)}: ${moneyText(before.netMinor, cur)}`;
  const refunded = report.thisMonth.refundedMinor > 0;
  const owedMinor = report.owed.minor + report.owed.pastMinor;
  // People the Members page also shows as Payment due, with no amount in the app.
  const listOnly = report.owed.listOnlyPeople;
  const listOnlyText =
    listOnly === 0
      ? null
      : owedMinor === 0
        ? `${listOnly === 1 ? `1 ${words.person} is` : `${count(listOnly)} ${words.people} are`} marked Payment due on your ${words.person} list, with no amount in the app.`
        : `${listOnly === 1 ? '1 more is' : `${count(listOnly)} more are`} marked Payment due on your ${words.person} list, with no amount in the app.`;
  const overdueText = report.owed.overdueMinor === 0 ? 'none of it overdue' : report.owed.overdueMinor >= owedMinor ? 'all of it overdue' : `${moneyText(report.owed.overdueMinor, cur)} of it overdue`;
  const base = `/console/${orgSlug}`;
  const overdueWhen =
    report.owed.overdueAfterDays === 0
      ? 'the day after its due date'
      : report.owed.overdueAfterDays === 1
        ? '1 day after its due date'
        : `${String(report.owed.overdueAfterDays)} days after its due date`;
  const life = report.lifetimeValue;
  const leavers = life.state === 'ok' ? (life.leavers === 1 ? `1 ${words.person}` : `${count(life.leavers)} ${words.people}`) : null;

  return [
    {
      key: 'recurring',
      label: 'Monthly recurring revenue',
      value: report.recurring.memberships === 0 ? null : moneyText(report.recurring.monthlyMinor, cur),
      line: report.recurring.memberships === 0 ? 'No repeating membership is in use today.' : null,
      note:
        report.recurring.memberships === 0
          ? null
          : report.recurring.memberships === 1
            ? '1 repeating membership'
            : `${count(report.recurring.memberships)} repeating memberships`,
      how: 'What your repeating memberships bring in each month: the price of every repeating membership in use today, as one month. A yearly price is divided by 12, and a weekly price is counted as 52 weeks a year. Memberships that are frozen, cancelled, ended, free or not started yet are not counted.',
      links: [],
    },
    {
      key: 'collected',
      label: 'Collected this month',
      value: moneyText(report.thisMonth.netMinor, cur),
      line: null,
      note: refunded
        ? `${month}, so far: ${moneyText(report.thisMonth.paidMinor, cur)} paid, ${moneyText(report.thisMonth.refundedMinor, cur)} refunded${beforeText}`
        : `${month}, so far${beforeText}`,
      how: `Payments your staff recorded in ${month}, less refunds noted in ${month}. A payment or a refund that was undone is not counted.`,
      links: [],
    },
    {
      key: 'due',
      label: 'Payment due',
      value: owedMinor === 0 ? null : moneyText(owedMinor, cur),
      line: owedMinor === 0 ? 'No bill in the app is due.' : null,
      note: [owedMinor === 0 ? null : `${owingPeople(report.owed, words)} · ${overdueText}`, listOnlyText].filter((part) => part !== null).join(' · ') || null,
      how: `Bills that have fallen due and are not fully paid, less what has been paid on them. A bill is overdue ${overdueWhen}; you set this in Memberships, under Bills. Cancelled bills are not counted. A new month's bill appears within the hour after the month begins.`,
      links: [
        ...(report.owed.people + listOnly > 0 ? [{ to: `${base}/members?show=${PAYMENT_DUE_SHOW}`, button: 'See who' }] : []),
        ...(report.owed.pastPeople > 0 ? [{ to: `${base}/members?show=${PAST_PAYMENT_DUE_SHOW}`, button: `See past ${words.people}` }] : []),
      ],
    },
    {
      key: 'lifetime',
      label: 'Lifetime value',
      value: life.state === 'ok' ? moneyText(life.minor, cur) : null,
      line: life.state === 'ok' ? null : LIFETIME_NONE[life.state](words),
      note: life.state === 'ok' ? `a ${words.person}, ${monthShort(life.months[0]).slice(0, 3)} to ${monthShort(life.months[life.months.length - 1])}` : null,
      how:
        life.state === 'ok'
          ? `What a ${words.person} pays you before they leave, on average: the money collected in ${monthList(life.months)}, divided by the ${leavers} who left in those months. Someone who joined and left inside one month is not counted. It is the same as the money a ${words.person} brings in a month divided by churn.`
          : `What a ${words.person} pays you before they leave, on average: the money collected in the last 3 full months, divided by the ${words.people} who left in those months.`,
      links: [],
    },
  ];
}

/** The month-by-month table's rows, newest first. */
export function moneyMonthRows(report) {
  const cur = report.currency;
  return [...report.months].reverse().map((m) => ({
    key: m.month,
    month: m.month === report.thisMonth.month ? `${monthShort(m.month)} (so far)` : monthShort(m.month),
    paid: moneyText(m.paidMinor, cur),
    refunded: moneyText(m.refundedMinor, cur),
    collected: moneyText(m.netMinor, cur),
  }));
}

/** A row for each membership the gym sells that is in use or took money. */
export function moneyTypeRows(report) {
  const cur = report.currency;
  return report.types.map((t, i) => ({
    key: `${String(i)}-${t.name}`,
    name: t.name,
    inUse: count(t.inUse),
    monthly: t.monthlyMinor === 0 ? '–' : moneyText(t.monthlyMinor, cur),
    month: moneyText(t.monthNetMinor, cur),
    year: moneyText(t.yearNetMinor, cur),
  }));
}

/** The month's name, for the membership table's heading. */
export const moneyMonthName = (report) => monthName(report.thisMonth.month);

const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
const csv = (rows) => `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
/** An amount as a plain number for a spreadsheet: "49.99", "-60.00". */
const plain = (minor, currency) => (minor < 0 ? `-${minorToPriceText(-minor, currency)}` : minorToPriceText(minor, currency));

/** The months as a CSV: amounts only, oldest first. */
export function moneyMonthsCsv(report) {
  const cur = report.currency;
  return csv([
    ['Month', `Paid (${cur})`, `Refunded (${cur})`, `Collected (${cur})`],
    ...report.months.map((m) => [
      m.month === report.thisMonth.month ? `${m.month} (so far)` : m.month,
      plain(m.paidMinor, cur),
      plain(m.refundedMinor, cur),
      plain(m.netMinor, cur),
    ]),
  ]);
}

/** The memberships as a CSV: counts and amounts, never a person's name. */
export function moneyTypesCsv(report) {
  const cur = report.currency;
  return csv([
    ['Membership', 'In use now', `Monthly recurring (${cur})`, `Collected in ${report.thisMonth.month} (${cur})`, `Collected, last 12 months (${cur})`],
    ...report.types.map((t) => [csvWords(t.name), t.inUse, plain(t.monthlyMinor, cur), plain(t.monthNetMinor, cur), plain(t.yearNetMinor, cur)]),
  ]);
}
