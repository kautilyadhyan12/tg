import { REPORT_FULL_MONTHS_NEEDED, REPORT_PERIODS } from '@app/shared';
import { sourceWord } from './leadsView';

// The Reports page's words (spec Part 3 §16.5; ROADMAP 21a-i, 21d-i, 21d-ii). Every figure says how it is
// worked out and which days it counts, and a figure the gym's list cannot give is a sentence,
// never a zero.

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

// THE PERIOD. The page asks for one of three; every answer says which days it counted,
// and the page's words are made from the answer, never from what was pressed.

/** What the page shows when its address names no period. */
export const DEFAULT_PERIOD = '12m';
const PERIOD_NAMES = { '4w': 'Last 4 weeks', '3m': 'Last 3 months', '12m': 'Last 12 months' };
/** The picker's choices, in order. */
export const PERIOD_CHOICES = REPORT_PERIODS.map((key) => ({ key, label: PERIOD_NAMES[key] }));
/** The period an address names, or the page's own when it names none or one that is not a choice. */
export const periodFrom = (value) => (REPORT_PERIODS.includes(value) ? value : DEFAULT_PERIOD);
/** "Last 3 months". */
export const periodName = (period) => PERIOD_NAMES[period.key];
/** "the last 3 months", for the middle of a sentence. */
export const periodWords = (period) => `the ${PERIOD_NAMES[period.key].toLowerCase()}`;
/** "1 Aug 2026 to 13 Oct 2026". */
export const periodSpan = (period) => `${dayText(period.from)} to ${dayText(period.to)}`;
/** The days a figure counts, in a tile's small line: the period's, or, for a gym that began
 *  `what` inside the period, the day it began and what began then. */
export function countedSpan(period, startedOn, what) {
  if (startedOn !== null && startedOn > period.from) return `since ${dayText(startedOn)}, ${what}`;
  return periodSpan(period);
}
/** The line under the picker: the days counted, and what does not move with them. The
 *  money figures are named only to staff who are shown money. */
export function periodLine(period, words, seesMoney) {
  const still = [`${words.peopleCap} now`, 'churn', 'retention', ...(seesMoney ? ['monthly recurring revenue', 'payment due', 'lifetime value'] : [])];
  return `Showing ${periodSpan(period)}. ${still.slice(0, -1).join(', ')} and ${still[still.length - 1]} are today's figures, so they stay the same whichever period you choose.`;
}

// A YEAR EARLIER. Under New members and Collected only (Kd, 2026-10-14), the same figure
// for the same days a year before; where the app has no records of all those days, why
// there is none.

/** "up 3", "down 3" or "the same", with `text` writing the difference. */
export function changeWords(now, then, text = (n) => n.toLocaleString('en-GB')) {
  if (now === then) return 'the same';
  return now > then ? `up ${text(now - then)}` : `down ${text(then - now)}`;
}

/** The line under a figure: "A year earlier: 9 · up 3", from `said`, the year-earlier
 *  figure's words. Without the records for those days, `why` says why, with the day. */
export function earlierLine(yearEarlier, why, said) {
  if (yearEarlier.state === 'ok') return `A year earlier: ${said(yearEarlier)}`;
  if (yearEarlier.state === 'no_history' && yearEarlier.since === null) return 'A year earlier: no figures.';
  return `A year earlier: no figures. ${why(yearEarlier)}`;
}

/** Which days "a year earlier" counts, said under a figure's "how": four weeks are set
 *  beside the same weekdays 52 weeks before, so their dates are a day or two apart. */
export function earlierDays(period, yearEarlier) {
  const same = period.key === '4w' ? 'the same weekdays 52 weeks before' : 'the same days a year before';
  return `A year earlier counts ${same}: ${periodSpan(yearEarlier)}.`;
}

/** Why the member list has no figure a year earlier: it began after those days did, or in
 *  the month they began, whose people are not new members; or most of the people who
 *  joined in those days were added to it only later. */
const listBegan = (words) => (yearEarlier) => {
  if (yearEarlier.state === 'added_later') return `Most of your ${words.person} list was added on ${dayText(yearEarlier.on)}.`;
  return yearEarlier.since > yearEarlier.from
    ? `Your ${words.person} list started on ${dayText(yearEarlier.since)}.`
    : `Your ${words.person} list started on ${dayText(yearEarlier.since)}, and the people on it in its first month are not counted as new.`;
};
/** Under a month-by-month table when the period begins inside a month: the rows are whole
 *  months, so they do not add up to the period's own figure. Null where they do. */
export function wholeMonthsNote(period) {
  if (period.from.endsWith('-01')) return null;
  return `Months are shown whole, so they include days before ${dayText(period.from)}.`;
}

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

const have = (report) => (report.fullMonths === 0 ? 'none yet' : report.fullMonths === 1 ? '1 so far' : `${String(report.fullMonths)} so far`);
const nobodyRemoved = (words) => `Nobody has left yet: nobody has been removed from your ${words.person} list, and no membership has ended or been cancelled.`;

// Each box says in its own words what its figure is and why there is none yet: three boxes
// with one sentence read as one fault said three times.
const NO_FIGURE = {
  churn: {
    nobody_left: (report, words) => `Churn is the share of your ${words.people} who leave in a month. Nobody has left yet, so there is none to show.`,
    nobody_at_start: (report, words) => `You had no ${words.people} at the start of the last 3 full months, so nobody could leave.`,
    not_enough_data: (report, words) =>
      `Not enough data yet. Churn compares ${String(REPORT_FULL_MONTHS_NEEDED)} full months of your ${words.person} list; you have ${have(report)}.`,
  },
  retention: {
    nobody_left: (report, words) => `Retention is the share of your ${words.people} you keep each month. It shows once somebody has left, so the app knows you record who leaves.`,
    nobody_at_start: (report, words) => `You had no ${words.people} at the start of the last 3 full months, so there was nobody to keep.`,
    not_enough_data: (report) => `Not enough data yet. Retention is worked out over the same ${String(REPORT_FULL_MONTHS_NEEDED)} full months as churn; you have ${have(report)}.`,
  },
  stay: {
    nobody_left: (report, words) => `Average stay is how long your ${words.people} had been with you when they left. Nobody has left yet.`,
    nobody_in_period: (report) => `Nobody has left in ${periodWords(report.period)}.`,
    not_enough_data: (report, words) =>
      `Not enough data yet. Average stay shows after ${String(REPORT_FULL_MONTHS_NEEDED)} full months of your ${words.person} list here; you have ${have(report)}.`,
  },
};

/** A share figure's number, or the sentence in its place. */
function shareTile(key, figure, report, words) {
  if (figure.state === 'ok') return { value: percentText(figure.percent), line: null };
  return { value: null, line: NO_FIGURE[key][figure.state](report, words) };
}

/** The line above the figures: where they come from and how fresh the list is. */
export function listLine(report, words) {
  if (report.listChangedOn === null) return null;
  return `These figures come from your ${words.person} list and the memberships you give in the app. Someone was last added or removed on ${dayText(report.listChangedOn)}.`;
}

/** Shown once, under the tiles, while nobody has ever left. */
export function nobodyRemovedNote(report, words) {
  if (report.everLeft || report.listChangedOn === null) return null;
  return `Left, churn, retention and average stay count ${words.people} you remove from your list or mark as left in an import, and ${words.people} whose membership given in the app ends or is cancelled. A status from your own file, such as Expired, is not counted. If you keep your list in other software, import it here each month to keep these true.`;
}

/** The six tiles, in order: `value` is the big number, or null with `line` saying why
 *  there is none; `note` is the small line under a number; `how` is how it is worked out. */
export function memberTiles(report, words) {
  // A list younger than the period is counted from the day it began, and the tiles say so.
  const listed = report.firstListedOn;
  const span = countedSpan(report.period, listed, `when your ${words.person} list started`);
  const from = dayText(listed !== null && listed > report.period.from ? listed : report.period.from);
  const churn = shareTile('churn', report.churn, report, words);
  const retention = shareTile('retention', report.retention, report, words);
  const over = report.churnMonths.length > 0 ? monthList(report.churnMonths) : 'the last 3 full months';
  const overShort = report.churnMonths.length > 0 ? `${monthShort(report.churnMonths[0]).slice(0, 3)} to ${monthShort(report.churnMonths[report.churnMonths.length - 1])}` : null;

  let stay;
  if (report.averageStay.state === 'ok') {
    stay = { value: stayText(report.averageStay.days), line: null, note: `${people(report.averageStay.leavers)} left · ${span}` };
  } else if (report.averageStay.state === 'nobody_left') {
    stay = { value: null, line: report.everLeft ? NO_FIGURE.stay.nobody_in_period(report) : NO_FIGURE.stay.nobody_left(report, words), note: null };
  } else {
    stay = { value: null, line: NO_FIGURE.stay.not_enough_data(report, words), note: null };
  }

  // The list's first people have been with the gym for years: they are not new members.
  const started = report.inPeriod.joined === null;
  // New is counted from the month after the list began, when that is inside the period.
  const newFrom = report.inPeriod.joinedFrom;
  const newSpan = countedSpan(report.period, newFrom, `the month after your ${words.person} list started`);
  const was = report.yearEarlier;
  const began = listBegan(words);

  return [
    {
      key: 'active',
      label: `${words.peopleCap} now`,
      value: count(report.activeNow),
      line: null,
      note: null,
      how: `Everyone on your ${words.person} list today, except ${words.people} whose membership has ended or been cancelled and who have no new one, unless your ${words.person} list shows a later end date for them. A status from your own file, such as Expired, is not counted. ${words.peopleCap} you have removed are not counted.`,
    },
    {
      key: 'new',
      label: `New ${words.people}`,
      value: started ? null : count(report.inPeriod.joined),
      line: started ? `Your ${words.person} list started this month, so new ${words.people} are counted from next month.` : null,
      note: started ? null : newSpan,
      earlier: started ? null : earlierLine(was, began, (f) => `${count(f.joined)} · ${changeWords(report.inPeriod.joined ?? 0, f.joined)}`),
      how: `${words.peopleCap} whose join date is from ${dayText(newFrom ?? report.period.from)} to today. Where your list gave no join date, or one later than the day they were added here, it is the day they were added. The month your list started is not counted.${started ? '' : ` ${earlierDays(report.period, was)} It counts only ${words.people} who were on your list by the last of those days.`}`,
    },
    {
      key: 'left',
      label: `${words.peopleCap} who left`,
      value: report.everLeft ? count(report.inPeriod.left) : null,
      line: report.everLeft ? null : nobodyRemoved(words),
      note: report.everLeft ? span : null,
      how: `${words.peopleCap} removed from your ${words.person} list from ${from} to today, and ${words.people} whose membership ended or was cancelled in those days and who have no new one. On your ${words.person} list, their status is Ended or Cancelled. Someone you put back, or gave a new membership later, counts as a ${words.person} the whole time. ${words.peopleCap} deleted permanently are not counted.`,
    },
    {
      key: 'churn',
      label: 'Churn',
      value: churn.value,
      line: churn.line,
      note: churn.value !== null && overShort !== null ? `a month, ${overShort}` : null,
      how: `Of your ${words.people} at the start of ${over}, the share who left during that month, the three months taken together. Someone who joined and left inside one month is not counted.`,
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
      how: `How long the ${words.people} who left from ${from} to today had been with you on average, from their join date to the day they were removed or their membership ended.`,
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

/** What stands in the leads box's place with no lead in the period: the gym has none at
 *  all, or none added in these days. Null with leads to show. */
export function leadsMissing(report) {
  if (report.leads.percent !== null) return null;
  return report.leads.ever ? `No lead was added in ${periodWords(report.period)}.` : "You haven't added any leads yet.";
}

/** The leads headline: the share that joined, or the sentence in its place; null with no leads in the period. */
export function leadsHeadline(report) {
  if (report.leads.percent === null) return null;
  if (!everJoined(report)) {
    return { value: null, line: 'No lead has been marked Joined yet. Press Joined on a lead when they sign up.', note: `${leadsWord(report.leads.total)} added · ${periodSpan(report.period)}` };
  }
  return {
    value: percentText(report.leads.percent),
    line: null,
    note: `${count(report.leads.joined)} of ${leadsWord(report.leads.total)} joined · added ${periodSpan(report.period)}`,
  };
}

/** How the leads figure is worked out, for the period shown. */
export const leadsHow = (report) =>
  `Leads added from ${dayText(report.period.from)} to today that are marked Joined, out of every lead added in those days, by where they heard of you. Leads you deleted are not counted.`;

const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
/** A cell a spreadsheet would run as a formula is kept as words: for any name staff typed. */
export const csvWords = (value) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
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

const PERIOD_SLUGS = { '4w': 'last-4-weeks', '3m': 'last-3-months', '12m': 'last-12-months' };
/** A CSV's file name: what it holds, the period it covers and the day it was saved. */
export const csvName = (what, report) => `${what}-${PERIOD_SLUGS[report.period.key]}-${report.today}.csv`;

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
