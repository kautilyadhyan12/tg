import { REPORT_FULL_MONTHS_NEEDED } from '@app/shared';
import { sourceWord } from './leadsView';

// The Reports page's words (spec Part 3 §16.5; ROADMAP 21a-i). Every figure says how it is
// worked out, and a figure the gym's list cannot give is a sentence, never a zero.

export function canReadReports(privileges) {
  return Array.isArray(privileges) && privileges.includes('reports.read');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (month) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;

/** 'YYYY-MM' as "October 2026". */
export const monthLong = (month) => `${monthName(month)} ${month.slice(0, 4)}`;
/** 'YYYY-MM' as "Oct 2026". */
export const monthShort = (month) => `${monthName(month).slice(0, 3)} ${month.slice(0, 4)}`;
/** 'YYYY-MM-DD' as "3 Oct 2026". */
export const dayText = (day) => `${String(Number(day.slice(8, 10)))} ${monthShort(day.slice(0, 7))}`;

const people = (n) => (n === 1 ? '1 person' : `${String(n)} people`);
const count = (n) => n.toLocaleString('en-GB');
const leadsWord = (n) => (n === 1 ? '1 lead' : `${count(n)} leads`);
export const percentText = (percent) => `${String(percent)}%`;

/** "July, August and September". */
function monthList(months) {
  const names = months.map(monthName);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Days as a length of membership: "23 days", "11 months", "2 years 3 months". */
export function stayText(days) {
  if (days < 60) return days === 1 ? '1 day' : `${String(days)} days`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${String(months)} months`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (rest === 0) return `${String(years)} years`;
  return `${String(years)} years ${rest === 1 ? '1 month' : `${String(rest)} months`}`;
}

const notYet = (report, words) => {
  const have = report.fullMonths === 0 ? 'none yet' : report.fullMonths === 1 ? '1 so far' : `${String(report.fullMonths)} so far`;
  return `Not enough data yet. This needs ${String(REPORT_FULL_MONTHS_NEEDED)} full months of your ${words.person} list here; you have ${have}.`;
};
const nobodyRemoved = (words) => `Nobody has been removed from your ${words.person} list yet.`;

/** A share figure's number, or the sentence in its place. */
function shareTile(figure, report, words) {
  if (figure.state === 'ok') return { value: percentText(figure.percent), line: null };
  if (figure.state === 'nobody_left') return { value: null, line: nobodyRemoved(words) };
  if (figure.state === 'nobody_at_start') return { value: null, line: `You had no ${words.people} at the start of the last 3 full months.` };
  return { value: null, line: notYet(report, words) };
}

/** The line above the figures: where they come from and how fresh the list is. */
export function listLine(report, words) {
  if (report.listChangedOn === null) return null;
  return `These figures come from your ${words.person} list. Someone was last added or removed on ${dayText(report.listChangedOn)}.`;
}

/** Shown once, under the tiles, while nobody has ever come off the list. */
export function nobodyRemovedNote(report, words) {
  if (report.everLeft || report.listChangedOn === null) return null;
  return `Left, churn, retention and average stay count ${words.people} you remove from your list or mark as left in an import. If you keep your list in other software, import it here each month to keep these true.`;
}

/** The six tiles, in order: `value` is the big number, or null with `line` saying why
 *  there is none; `note` is the small line under a number; `how` is how it is worked out. */
export function memberTiles(report, words) {
  const month = monthLong(report.thisMonth.month);
  // The month before, whole, beside this month's so far. Not an arrow: ten days against thirty would mislead.
  const before = report.months.length >= 2 ? report.months[report.months.length - 2] : null;
  const soFar = (n) => {
    const was = before === null ? null : n(before);
    return was === null ? `${month}, so far` : `${month}, so far · ${monthName(before.month)}: ${count(was)}`;
  };
  const churn = shareTile(report.churn, report, words);
  const retention = shareTile(report.retention, report, words);
  const over = report.churnMonths.length > 0 ? monthList(report.churnMonths) : 'the last 3 full months';
  const overShort = report.churnMonths.length > 0 ? `${monthShort(report.churnMonths[0]).slice(0, 3)} to ${monthShort(report.churnMonths[report.churnMonths.length - 1])}` : null;

  let stay;
  if (report.averageStay.state === 'ok') {
    stay = { value: stayText(report.averageStay.days), line: null, note: `${people(report.averageStay.leavers)} left in the months shown` };
  } else if (report.averageStay.state === 'nobody_left') {
    stay = { value: null, line: report.everLeft ? 'Nobody has left in the months shown.' : nobodyRemoved(words), note: null };
  } else {
    stay = { value: null, line: notYet(report, words), note: null };
  }

  // The list's first people have been with the gym for years: they are not new members.
  const started = report.thisMonth.joined === null;

  return [
    {
      key: 'active',
      label: `${words.peopleCap} now`,
      value: count(report.activeNow),
      line: null,
      note: null,
      how: `Everyone on your ${words.person} list today. ${words.peopleCap} you have removed are not counted.`,
    },
    {
      key: 'new',
      label: 'New this month',
      value: started ? null : count(report.thisMonth.joined),
      line: started ? `Your ${words.person} list started this month, so new ${words.people} are counted from next month.` : null,
      note: started ? null : soFar((m) => m.joined),
      how: `${words.peopleCap} whose join date is in ${month}. Where your list gave no join date, or one later than the day they were added here, it is the day they were added. The month your list started is not counted.`,
    },
    {
      key: 'left',
      label: 'Left this month',
      value: report.everLeft ? count(report.thisMonth.left) : null,
      line: report.everLeft ? null : nobodyRemoved(words),
      note: report.everLeft ? soFar((m) => m.left) : null,
      how: `${words.peopleCap} removed from your ${words.person} list in ${month}. Someone you removed and later put back counts as a ${words.person} the whole time. Records deleted for good are not counted.`,
    },
    {
      key: 'churn',
      label: 'Churn',
      value: churn.value,
      line: churn.line,
      note: churn.value !== null && overShort !== null ? `a month, ${overShort}` : null,
      how: `Of the ${words.people} on your list at the start of ${over}, the share who left during that month, the three months taken together. Someone who joined and left inside one month is not counted.`,
    },
    {
      key: 'retention',
      label: 'Retention',
      value: retention.value,
      line: retention.line,
      note: retention.value !== null && overShort !== null ? `a month, ${overShort}` : null,
      how: `The ${words.people} you kept: 100% less churn.`,
    },
    {
      key: 'stay',
      label: 'Average stay',
      value: stay.value,
      line: stay.line,
      note: stay.note,
      how: `How long the ${words.people} who left in the months shown below had been with you on average, from their join date to the day they were removed.`,
    },
  ];
}

/** The month-by-month table's rows, newest first. A dash where there is no figure. */
export function monthRows(report) {
  return [...report.months].reverse().map((m) => ({
    key: m.month,
    month: m.month === report.thisMonth.month ? `${monthShort(m.month)} (so far)` : monthShort(m.month),
    activeAtStart: m.activeAtStart === null ? '–' : count(m.activeAtStart),
    joined: m.joined === null ? '–' : count(m.joined),
    left: report.everLeft ? count(m.left) : '–',
    churn: m.churnPercent === null ? '–' : percentText(m.churnPercent),
  }));
}

/** Whether any lead has been marked Joined. Until one has, a share would be a false zero:
 *  a gym may add its members by import and use Leads only for enquiries. */
const everJoined = (report) => report.leads.joined > 0;

/** A row for each place leads heard of the gym, in the Leads page's own order. */
export function leadRows(report) {
  const shares = everJoined(report);
  return report.leads.sources.map((s) => ({
    key: s.source,
    source: sourceWord(s.source),
    percent: shares ? s.percent : 0,
    text: shares ? `${count(s.joined)} of ${count(s.leads)} joined · ${percentText(s.percent)}` : leadsWord(s.leads),
  }));
}

/** The leads headline: the share that joined, or the sentence in its place; null with no leads. */
export function leadsHeadline(report) {
  if (report.leads.percent === null) return null;
  if (!everJoined(report)) {
    return { value: null, line: 'No lead has been marked Joined yet. Press Joined on a lead when they sign up.', note: leadsWord(report.leads.total) };
  }
  return { value: percentText(report.leads.percent), line: null, note: `${count(report.leads.joined)} of ${leadsWord(report.leads.total)} joined` };
}

export const LEADS_HOW =
  'Leads marked Joined, out of every lead on your Leads page, by where they heard of you. Leads you deleted are not counted.';

const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
const csv = (rows) => `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;

/** The months as a CSV: counts only, oldest first. A figure that is not given is left empty. */
export function membersCsv(report, words) {
  return csv([
    ['Month', `${words.peopleCap} at start`, 'New', 'Left', 'Churn %'],
    ...report.months.map((m) => [
      m.month === report.thisMonth.month ? `${m.month} (so far)` : m.month,
      m.activeAtStart ?? '',
      m.joined ?? '',
      report.everLeft ? m.left : '',
      m.churnPercent ?? '',
    ]),
  ]);
}

export function leadsCsv(report) {
  const shares = everJoined(report);
  return csv([
    ['Where they heard of you', 'Leads', 'Joined', 'Share %'],
    ...report.leads.sources.map((s) => [sourceWord(s.source), s.leads, shares ? s.joined : '', shares ? s.percent : '']),
    ['All leads', report.leads.total, shares ? report.leads.joined : '', shares ? (report.leads.percent ?? '') : ''],
  ]);
}

export const csvName = (what, report) => `${what}-${report.today}.csv`;

/** The browser saves the text as a CSV file under this name. */
export function saveCsv(text, filename) {
  const link = document.createElement('a');
  const href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// THE PICTURES. Each is drawn from the same answer as the numbers beside it.

const daysIn = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Members over the months: how many were on the list as each month began, then today.
 *  A month that began before the list did has no point. `at` is where a point sits along
 *  the line, from 0 to 1: a month apart for each month, and today as far into this month
 *  as the day is. Fewer than two places to draw: no points. */
export function trendPoints(report, words) {
  const said = (n) => (n === 1 ? `1 ${words.person}` : `${count(n)} ${words.people}`);
  const starts = report.months.filter((m) => m.activeAtStart !== null);
  const into = (Number(report.today.slice(8, 10)) - 1) / daysIn(report.thisMonth.month);
  const span = starts.length - 1 + into;
  if (starts.length === 0 || span <= 0) return [];
  return [
    ...starts.map((m, i) => ({ key: m.month, label: `1 ${monthShort(m.month)}`, value: m.activeAtStart, text: said(m.activeAtStart), at: i / span })),
    { key: 'today', label: `Today, ${dayText(report.today)}`, value: report.activeNow, text: said(report.activeNow), at: 1 },
  ];
}

/** The line through those points in a box `width` by `height`, from zero at the bottom. */
export function trendShape(points, width, height) {
  const top = Math.max(1, ...points.map((p) => p.value));
  const xy = points.map((p) => ({ x: Math.round(p.at * width * 10) / 10, y: Math.round((height - (p.value / top) * height) * 10) / 10 }));
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${String(p.x)} ${String(p.y)}`).join(' ');
  return { xy, line, area: `${line} L${String(width)} ${String(height)} L0 ${String(height)} Z`, top };
}

/** A bar for each month: New upwards and Left downwards, as a share of the tallest bar.
 *  The month the list started has no New bar. */
export function monthBars(report) {
  const top = Math.max(1, ...report.months.flatMap((m) => [m.joined ?? 0, report.everLeft ? m.left : 0]));
  return report.months.map((m) => {
    const title = m.month === report.thisMonth.month ? `${monthLong(m.month)} (so far)` : monthLong(m.month);
    const parts = [m.joined === null ? 'your list started' : `${count(m.joined)} new`, ...(report.everLeft ? [`${count(m.left)} left`] : [])];
    return {
      key: m.month,
      label: monthName(m.month).slice(0, 3),
      title,
      joined: m.joined,
      left: report.everLeft ? m.left : null,
      up: ((m.joined ?? 0) / top) * 100,
      down: report.everLeft ? (m.left / top) * 100 : 0,
      text: `${title}: ${parts.join(', ')}`,
    };
  });
}

/** Stayed and left as two parts of one bar; null without a churn figure. */
export function staySplit(report) {
  if (report.churn.state !== 'ok' || report.retention.state !== 'ok') return null;
  return { stayed: report.retention.percent, left: report.churn.percent };
}
