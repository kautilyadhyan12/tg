import { formatMinor, minorToPriceText } from '@app/shared';
import { changeWords, countedSpan, csvWords, dayText, earlierDays, earlierLine, monthLong, monthShort, periodName } from './reportsView';
import { PAST_PAYMENT_DUE_SHOW, PAYMENT_DUE_SHOW } from './weekView';

// The Reports page's money words (spec Part 3 §16.5; ROADMAP 21b-i, 21b-ii, 21d-i). The figures come from
// the payments and sales staff record in the app; a figure the notebook cannot give is a sentence,
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
  return `These figures come from the payments and sales your staff record in the app. The first was recorded on ${dayText(report.firstPaidOn)}.`;
}

export const OTHER_CURRENCY_NOTE = 'Payments, sales and bills in another currency, from before your country changed, are not counted here.';

/** What takes the figures' place while there are none: the sentence, the place that
 *  starts them, its button, and who can for staff who may not open it. */
export function moneyMissing(report, words) {
  if (report.state === 'no_memberships') {
    return {
      line: `No membership has been given and nothing has been sold in the app yet. Money figures start when you give memberships to your ${words.people} and record their payments, or sell at the front desk.`,
      place: 'memberships',
      button: 'Set up memberships',
      ask: 'Staff who manage memberships can set them up.',
    };
  }
  if (report.state === 'no_payments') {
    return {
      line: `No payment or sale is recorded in the app yet. If you take payments in other software, your money figures are there. To see them here, record each payment on the ${words.person}'s page.`,
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
  // A gym whose first payment is inside the period is counted from that day, and the tile says so.
  const span = countedSpan(report.period, report.firstPaidOn, 'the first payment or sale recorded here');
  const paidFrom = report.firstPaidOn > report.period.from ? report.firstPaidOn : report.period.from;
  const soFar = `${month}, so far: ${moneyText(report.thisMonth.netMinor, cur)}`;
  const refunded = report.inPeriod.refundedMinor > 0;
  const sold = report.inPeriod.soldMinor > 0;
  const owedMinor = report.owed.minor + report.owed.pastMinor;
  // People the Members page also shows as Payment due, with no amount in the app.
  const listOnly = report.owed.listOnlyPeople;
  const noAmount = report.otherCurrency ? 'with no amount counted here.' : 'with no amount in the app.';
  const listOnlyText =
    listOnly === 0
      ? null
      : owedMinor === 0
        ? `${listOnly === 1 ? `1 ${words.person} is` : `${count(listOnly)} ${words.people} are`} marked Payment due on your ${words.person} list, ${noAmount}`
        : `${listOnly === 1 ? '1 more is' : `${count(listOnly)} more are`} marked Payment due on your ${words.person} list, ${noAmount}`;
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
      label: 'Collected',
      value: moneyText(report.inPeriod.netMinor, cur),
      line: null,
      earlier: earlierLine(
        report.yearEarlier,
        (f) =>
          f.state === 'no_sales_history'
            ? `Your first sale at the front desk was recorded on ${dayText(f.since)}.`
            : `Your first payment was recorded on ${dayText(f.since)}.`,
        (f) => `${moneyText(f.netMinor, cur)} · ${changeWords(report.inPeriod.netMinor, f.netMinor, (n) => moneyText(n, cur))}`,
      ),
      // With desk sales, what came from where is its own lines under the figure.
      split: sold
        ? [
            { label: 'Memberships', value: moneyText(report.inPeriod.paidMinor, cur) },
            { label: 'Product sales', value: moneyText(report.inPeriod.soldMinor, cur) },
            ...(refunded ? [{ label: 'Refunded', value: `-${moneyText(report.inPeriod.refundedMinor, cur)}` }] : []),
          ]
        : null,
      note:
        refunded && !sold
          ? `${span}: ${moneyText(report.inPeriod.paidMinor, cur)} paid, ${moneyText(report.inPeriod.refundedMinor, cur)} refunded · ${soFar}`
          : `${span} · ${soFar}`,
      how: `Membership payments and product sales your staff recorded from ${dayText(paidFrom)} to today, less refunds noted in those days. A payment, sale or refund that was voided is not counted. ${earlierDays(report.period, report.yearEarlier)}`,
      links: [],
    },
    {
      key: 'due',
      label: 'Payment due',
      value: owedMinor === 0 ? null : moneyText(owedMinor, cur),
      line: owedMinor === 0 ? 'No bill in the app is due.' : null,
      note: [owedMinor === 0 ? null : `${owingPeople(report.owed, words)} · ${overdueText}`, listOnlyText].filter((part) => part !== null).join(' · ') || null,
      how: `Bills that have fallen due and are not fully paid, less what has been paid on them. A bill is overdue ${overdueWhen}; you set this in Memberships, under Bills. Voided bills are not counted. A new month's bill appears within the hour after the month begins.`,
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

/** Whether the month-by-month table has a column for product sales: only where a month
 *  it shows holds one, so a gym that never sells at the desk reads no column of zeros. */
export const moneyHasSales = (report) => report.months.some((m) => m.soldMinor > 0);

/** The month-by-month table's headings and the cells each row fills. */
export function moneyMonthColumns(report) {
  return moneyHasSales(report)
    ? { heads: ['Month', 'Memberships', 'Product sales', 'Refunded', 'Collected'], cells: ['month', 'paid', 'sold', 'refunded', 'collected'] }
    : { heads: ['Month', 'Paid', 'Refunded', 'Collected'], cells: ['month', 'paid', 'refunded', 'collected'] };
}

/** The month-by-month table's rows, newest first. */
export function moneyMonthRows(report) {
  const cur = report.currency;
  return [...report.months].reverse().map((m) => ({
    key: m.month,
    month: m.month === report.thisMonth.month ? `${monthShort(m.month)} (so far)` : monthShort(m.month),
    paid: moneyText(m.paidMinor, cur),
    sold: moneyText(m.soldMinor, cur),
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
    period: moneyText(t.periodNetMinor, cur),
  }));
}

/** A row for each product sold in the period. */
export function moneyProductRows(report) {
  const cur = report.currency;
  return report.products.map((p, i) => ({ key: `${String(i)}-${p.name}`, name: p.name, sold: count(p.sold), period: moneyText(p.minor, cur) }));
}

/** What an account that has since been deleted is called in the staff table. */
export const DELETED_STAFF = 'Deleted account';

export const MONEY_STAFF_NOTE = 'The membership payments and product sales each staff member recorded. Refunds are taken off Collected, not off anybody here.';

/** A row for each staff member who recorded a payment or a sale in the period. */
export function moneyStaffRows(report) {
  const cur = report.currency;
  return report.staff.map((m, i) => ({
    key: `${String(i)}-${m.name ?? ''}`,
    name: m.name ?? DELETED_STAFF,
    paid: moneyText(m.paidMinor, cur),
    sold: moneyText(m.soldMinor, cur),
    total: moneyText(m.totalMinor, cur),
  }));
}

/** The month's name, for the membership table's heading. */
export const moneyMonthName = (report) => monthName(report.thisMonth.month);
/** "Collected, last 3 months": the membership table's last heading. */
export const moneyPeriodHead = (report) => `Collected, ${periodName(report.period).toLowerCase()}`;

const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
const csv = (rows) => `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
/** An amount as a plain number for a spreadsheet: "49.99", "-60.00". */
const plain = (minor, currency) => (minor < 0 ? `-${minorToPriceText(-minor, currency)}` : minorToPriceText(minor, currency));

/** The months as a CSV: amounts only, oldest first, with the table's own columns. */
export function moneyMonthsCsv(report) {
  const cur = report.currency;
  const sales = moneyHasSales(report);
  return csv([
    sales
      ? ['Month', `Memberships (${cur})`, `Product sales (${cur})`, `Refunded (${cur})`, `Collected (${cur})`]
      : ['Month', `Paid (${cur})`, `Refunded (${cur})`, `Collected (${cur})`],
    ...report.months.map((m) => [
      m.month === report.thisMonth.month ? `${m.month} (so far)` : m.month,
      plain(m.paidMinor, cur),
      ...(sales ? [plain(m.soldMinor, cur)] : []),
      plain(m.refundedMinor, cur),
      plain(m.netMinor, cur),
    ]),
  ]);
}

/** The memberships as a CSV: counts and amounts, never a person's name. */
export function moneyTypesCsv(report) {
  const cur = report.currency;
  return csv([
    ['Membership', 'In use now', `Monthly recurring (${cur})`, `Collected in ${report.thisMonth.month} (${cur})`, `${moneyPeriodHead(report)} (${cur})`],
    ...report.types.map((t) => [csvWords(t.name), t.inUse, plain(t.monthlyMinor, cur), plain(t.monthNetMinor, cur), plain(t.periodNetMinor, cur)]),
  ]);
}

/** The products as a CSV: counts and amounts. */
export function moneyProductsCsv(report) {
  const cur = report.currency;
  return csv([['Product', 'Sold', `${moneyPeriodHead(report)} (${cur})`], ...report.products.map((p) => [csvWords(p.name), p.sold, plain(p.minor, cur)])]);
}

/** The staff as a CSV: who recorded what, in amounts. */
export function moneyStaffCsv(report) {
  const cur = report.currency;
  return csv([
    ['Staff member', `Membership payments (${cur})`, `Product sales (${cur})`, `Total (${cur})`],
    ...report.staff.map((m) => [csvWords(m.name ?? DELETED_STAFF), plain(m.paidMinor, cur), plain(m.soldMinor, cur), plain(m.totalMinor, cur)]),
  ]);
}
