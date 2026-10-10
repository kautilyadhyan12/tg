import { REPORT_FULL_WEEKS_NEEDED, weekdayOf } from '@app/shared';
import { clockLabel } from './hoursView';
import { dayText, monthShort, percentText } from './reportsView';

// The Reports page's attendance words (spec Part 3 §16.5; ROADMAP 21a-ii). Every figure
// says how it is worked out, and a figure the gym's check-ins or classes cannot give is a
// sentence, never a zero.

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const weekdayName = (weekday) => WEEKDAYS[weekday - 1] ?? '';
export const weekdayShort = (weekday) => weekdayName(weekday).slice(0, 3);

const count = (n) => n.toLocaleString('en-GB');
const visitsWord = (n) => (n === 1 ? '1 visit' : `${count(n)} visits`);
const placesWord = (n) => (n === 1 ? '1 place' : `${count(n)} places`);
const classesWord = (n) => (n === 1 ? '1 class' : `${count(n)} classes`);
/** 'YYYY-MM-DD' as "5 Oct". */
const dayShort = (day) => `${String(Number(day.slice(8, 10)))} ${monthShort(day.slice(0, 7)).slice(0, 3)}`;
/** "Mon 5 Oct". */
const dayNamed = (day) => `${weekdayShort(weekdayOf(day))} ${dayShort(day)}`;
const span = (from, to) => `${dayShort(from)} to ${dayText(to)}`;

/** An hour of the day on the gym's clock: "18:00", or "6 PM". */
export function hourLabel(hour, clockFormat) {
  const label = clockLabel(hour * 60, clockFormat);
  return clockFormat === '12h' ? label.replace(':00', '') : label;
}
/** "Monday 18:00 to 19:00". */
const hourSpan = (cell, clockFormat) =>
  `${weekdayName(cell.weekday)} ${hourLabel(cell.hour, clockFormat)} to ${hourLabel((cell.hour + 1) % 24, clockFormat)}`;

const notYet = (report) => {
  const have = report.fullWeeks === 0 ? 'none yet' : `${String(report.fullWeeks)} so far`;
  return `Not enough data yet. This needs ${String(REPORT_FULL_WEEKS_NEEDED)} full weeks of check-ins, Monday to Sunday; you have ${have}.`;
};

/** The line above the visit figures: where they come from. Null while nobody has checked in. */
export function visitsLine(report) {
  if (report.firstVisitOn === null) return null;
  return `These figures count every check-in on your Attendance page: at the front desk, by staff, and visits staff added later. The first was on ${dayText(report.firstVisitOn)}.`;
}

/** The three visit tiles: `value` is the big number, or null with `line` saying why there
 *  is none; `note` is the small line under a number; `how` is how it is worked out. */
export function visitTiles(report, words, clockFormat) {
  const week = report.weeks.length > 0 ? report.weeks[report.weeks.length - 1] : null;
  const before = report.weeks.length >= 2 ? report.weeks[report.weeks.length - 2] : null;

  let member;
  if (report.perMember.state === 'ok') {
    const m = report.perMember;
    member = {
      value: String(m.perWeek),
      line: null,
      note: `${count(m.visitors)} of ${count(m.members)} ${m.members === 1 ? words.person : words.people} came · ${span(m.from, m.to)}`,
      how: `The ${visitsWord(m.visits)} that the ${count(m.members)} ${m.members === 1 ? words.person : words.people} on your list today made in the last ${String(m.weeks)} full weeks (${span(m.from, m.to)}), shared between them and the ${String(m.weeks)} weeks. A visit by someone you have removed is not counted.`,
    };
  } else {
    member = {
      value: null,
      line: report.perMember.state === 'no_members' ? `Nobody is on your ${words.person} list, so there is nobody to share the visits between.` : notYet(report),
      note: null,
      how: `Visits by the ${words.people} on your list today in the last full weeks, Monday to Sunday (4 at most), shared between them and those weeks.`,
    };
  }

  let busiest;
  const hours = report.hours;
  if (hours.state === 'ok') {
    const left = hours.noTime > 0 ? ` ${visitsWord(hours.noTime)} staff added on a later day ${hours.noTime === 1 ? 'has' : 'have'} no time and ${hours.noTime === 1 ? 'is' : 'are'} left out.` : '';
    const how = `Check-ins in the last ${String(hours.weeks)} full weeks (${span(hours.from, hours.to)}), counted by weekday and hour on your clock.${left}`;
    const names = hours.busiest.map((c) => `${weekdayShort(c.weekday)} ${hourLabel(c.hour, clockFormat)}`);
    if (hours.tied > hours.busiest.length) {
      busiest = { value: null, line: `No one hour stands out: ${String(hours.tied)} hours had ${visitsWord(hours.top)} each.`, note: null, how };
    } else {
      busiest = {
        value: names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`,
        line: null,
        note: `${visitsWord(hours.top)}${names.length > 1 ? ' each' : ''} in ${String(hours.weeks)} weeks`,
        how,
      };
    }
  } else {
    busiest = {
      value: null,
      line:
        hours.state === 'no_visits'
          ? hours.noTime > 0
            ? `The only visits in the last ${String(hours.weeks)} full weeks were added by staff on a later day, so their time is not known.`
            : `Nobody checked in in the last ${String(hours.weeks)} full weeks.`
          : notYet(report),
      note: null,
      how: 'Check-ins in the last full weeks, Monday to Sunday (8 at most), counted by weekday and hour on your clock.',
    };
  }

  return [
    {
      key: 'week',
      label: 'Visits this week',
      value: week === null ? null : count(week.visits),
      line: null,
      note:
        week === null
          ? null
          : `${dayNamed(week.weekStart)} to today · ${count(week.people)} ${week.people === 1 ? 'person' : 'people'}${before === null ? '' : ` · last week: ${count(before.visits)}`}`,
      how: 'Every check-in from Monday to today. Someone who comes on three days is three visits and one person.',
    },
    { key: 'per-member', label: `Visits a ${words.person} a week`, ...member },
    { key: 'busiest', label: 'Busiest time', ...busiest },
  ];
}

/** A bar for each day shown, as a share of the busiest day. */
export function dayBars(report) {
  const top = Math.max(1, ...report.days.map((d) => d.visits));
  return report.days.map((d) => {
    const weekday = weekdayOf(d.day);
    const title = d.day === report.today ? `Today, ${dayNamed(d.day)}` : dayNamed(d.day);
    return {
      key: d.day,
      // A week's first day carries its date under the bars.
      label: weekday === 1 ? dayShort(d.day) : '',
      monday: weekday === 1,
      visits: d.visits,
      height: (d.visits / top) * 100,
      text: `${title}: ${d.day === report.today ? `${visitsWord(d.visits)} so far` : visitsWord(d.visits)}`,
    };
  });
}

/** The week-by-week table's rows, newest first. */
export function weekRows(report) {
  return [...report.weeks].reverse().map((w, i) => ({
    key: w.weekStart,
    week: i === 0 ? `${dayShort(w.weekStart)} (so far)` : dayText(w.weekStart),
    visits: count(w.visits),
    people: count(w.people),
  }));
}

/** The busiest hours as a grid: a row for each weekday, a column for each hour from the
 *  earliest to the latest that had a visit. `share` is a cell's visits against the busiest
 *  hour's. Null without the figure. */
export function hourGrid(report, clockFormat) {
  const hours = report.hours;
  if (hours.state !== 'ok') return null;
  const from = Math.min(...hours.cells.map((c) => c.hour));
  const to = Math.max(...hours.cells.map((c) => c.hour));
  const columns = [];
  for (let hour = from; hour <= to; hour += 1) columns.push({ hour, label: hourLabel(hour, clockFormat) });
  const visitsAt = new Map(hours.cells.map((c) => [`${String(c.weekday)}-${String(c.hour)}`, c.visits]));
  return {
    columns,
    rows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      label: weekdayShort(weekday),
      cells: columns.map(({ hour }) => {
        const visits = visitsAt.get(`${String(weekday)}-${String(hour)}`) ?? 0;
        return { key: `${String(weekday)}-${String(hour)}`, hour, visits, share: visits / hours.top, text: `${hourSpan({ weekday, hour }, clockFormat)}: ${visitsWord(visits)}` };
      }),
    })),
    caption: `Check-ins by weekday and hour, ${span(hours.from, hours.to)}`,
  };
}

/** The two class tiles; null where the gym has no class that ran. */
export function classTiles(report) {
  const classes = report.classes;
  if (classes.state !== 'ok') return null;
  const since = `classes that started since ${dayText(classes.from)} (the last 8 weeks)`;
  const fill = classes.fill;
  const noShows = classes.noShows;
  let noShowTile;
  if (noShows.state === 'ok') {
    noShowTile = {
      value: percentText(noShows.percent),
      line: null,
      note: `${count(noShows.noShows)} of ${placesWord(noShows.marked)} marked${noShows.unmarked > 0 ? ` · ${count(noShows.unmarked)} not marked yet` : ''}`,
      calendar: false,
    };
  } else if (noShows.state === 'nothing_marked') {
    noShowTile = {
      value: null,
      line: `No place has been marked Came or No-show yet (${count(noShows.unmarked)} booked). The app marks a class when people check in at the gym around it; staff can also mark each person on the Calendar.`,
      note: null,
      calendar: true,
    };
  } else {
    noShowTile = { value: null, line: 'Nobody has booked a class in the last 8 weeks.', note: null, calendar: false };
  }
  return [
    {
      key: 'fill',
      label: 'How full classes are',
      value: fill.state === 'ok' ? percentText(fill.percent) : null,
      line: fill.state === 'ok' ? null : 'None of your classes has a limit on places, so there is no share to give.',
      note: fill.state === 'ok' ? `${count(fill.booked)} of ${placesWord(fill.places)} booked · ${classesWord(fill.classes)}` : null,
      how: `Places booked, out of all the places in ${since}. A cancelled class and a class with no limit on places are not counted; a cancelled booking and the waitlist are not a place booked.`,
      calendar: false,
    },
    {
      key: 'no-shows',
      label: 'No-shows',
      ...noShowTile,
      how: `Places marked No-show, out of the places marked Came or No-show, in ${since}. A place nobody marked is left out.`,
    },
  ];
}

/** A row for each class the gym ran. A dash where there is no figure. */
export function classRows(report) {
  const classes = report.classes;
  if (classes.state !== 'ok') return [];
  return classes.types.map((t, i) => ({
    key: `${String(i)}-${t.name}`,
    name: t.name,
    classes: count(t.classes),
    booked: t.places === null ? `${count(t.booked)} · no limit` : `${count(t.booked)} of ${count(t.places)}`,
    full: t.fillPercent === null ? '–' : percentText(t.fillPercent),
    fillPercent: t.fillPercent,
    noShows: t.noShowPercent === null ? '–' : `${count(t.noShows)} · ${percentText(t.noShowPercent)}`,
  }));
}

const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
/** A cell a spreadsheet would run as a formula is kept as words. */
const words = (value) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
const csv = (rows) => `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;

/** The weeks as a CSV: counts only, oldest first. */
export function weeksCsv(report) {
  return csv([
    ['Week starting (Monday)', 'Visits', 'People'],
    ...report.weeks.map((w) => [w.weekStart === report.weeks[report.weeks.length - 1].weekStart ? `${w.weekStart} (so far)` : w.weekStart, w.visits, w.people]),
  ]);
}

export function daysCsv(report) {
  return csv([['Day', 'Weekday', 'Visits'], ...report.days.map((d) => [d.day === report.today ? `${d.day} (so far)` : d.day, weekdayName(weekdayOf(d.day)), d.visits])]);
}

/** Every weekday and hour that had a visit. */
export function hoursCsv(report, clockFormat) {
  const hours = report.hours;
  return csv([
    ['Weekday', 'Hour starting', 'Visits'],
    ...(hours.state === 'ok' ? hours.cells.map((c) => [weekdayName(c.weekday), hourLabel(c.hour, clockFormat), c.visits]) : []),
  ]);
}

export function classesCsv(report) {
  const classes = report.classes;
  return csv([
    ['Class', 'Classes', 'Places', 'Booked', 'Full %', 'Came', 'No-show', 'No-show %'],
    ...(classes.state === 'ok'
      ? classes.types.map((t) => [words(t.name), t.classes, t.places ?? '', t.booked, t.fillPercent ?? '', t.attended, t.noShows, t.noShowPercent ?? ''])
      : []),
  ]);
}
