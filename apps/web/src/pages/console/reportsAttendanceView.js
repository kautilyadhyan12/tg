import { REPORT_FULL_WEEKS_NEEDED, addDays, weekdayOf } from '@app/shared';
import { clockLabel } from './hoursView';
import { csvWords, dayText, monthShort, percentText, periodWords } from './reportsView';

// The Reports page's attendance words (spec Part 3 §16.5; ROADMAP 21a-ii, 21d-i). Every figure
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
/** A day beside a later one that carries its year: its own year is said only where it differs. */
const dayBefore = (day, later) => (day.slice(0, 4) === later.slice(0, 4) ? dayShort(day) : dayText(day));
const span = (from, to) => `${dayBefore(from, to)} to ${dayText(to)}`;

/** An hour of the day on the gym's clock: "18:00", or "6 PM". */
export function hourLabel(hour, clockFormat) {
  const label = clockLabel(hour * 60, clockFormat);
  return clockFormat === '12h' ? label.replace(':00', '') : label;
}
/** "Monday 18:00 to 19:00". */
const hourSpan = (cell, clockFormat) =>
  `${weekdayName(cell.weekday)} ${hourLabel(cell.hour, clockFormat)} to ${hourLabel((cell.hour + 1) % 24, clockFormat)}`;

// Each box says in its own words why it has no figure yet.
const have = (report) => (report.fullWeeks === 0 ? 'none yet' : `${String(report.fullWeeks)} so far`);
const memberNotYet = (report, words) =>
  `Not enough data yet. Visits a ${words.person} are shared over ${String(REPORT_FULL_WEEKS_NEEDED)} full weeks of check-ins or more, Monday to Sunday; you have ${have(report)}.`;
const busiestNotYet = (report) =>
  `Not enough data yet. The busiest time is picked once every weekday has been counted twice: ${String(REPORT_FULL_WEEKS_NEEDED)} full weeks of check-ins; you have ${have(report)}.`;

/** The line above the visit figures: where they come from. Null while nobody has checked in. */
export function visitsLine(report) {
  if (report.firstVisitOn === null) return null;
  return `These figures count every check-in on your Attendance page: at the front desk, by staff, and visits staff added later. The first was on ${dayText(report.firstVisitOn)}.`;
}

/** The three visit tiles: `value` is the big number, or null with `line` saying why there
 *  is none; `note` is the small line under a number; `how` is how it is worked out. */
export function visitTiles(report, words, clockFormat) {
  const week = report.weeks.length > 0 ? report.weeks[report.weeks.length - 1] : null;
  const shownFrom = report.days.length > 0 ? report.days[0].day : report.period.from;

  let member;
  if (report.perMember.state === 'ok') {
    const m = report.perMember;
    member = {
      value: String(m.perWeek),
      line: null,
      note: `${count(m.visitors)} of the ${count(m.members)} ${m.members === 1 ? words.person : words.people} on your list since ${dayBefore(m.from, m.to)} came · ${span(m.from, m.to)}`,
      how: `The ${visitsWord(m.visits)} that the ${count(m.members)} ${m.members === 1 ? words.person : words.people} on your list since ${dayText(m.from)} made in the last ${String(m.weeks)} full weeks (${span(m.from, m.to)}), shared between them and the ${String(m.weeks)} weeks. Anyone added since, and anyone you have removed, is not counted.`,
    };
  } else {
    member = {
      value: null,
      line:
        report.perMember.state === 'no_members'
          ? `Nobody on your ${words.person} list today was on it by ${dayText(report.perMember.from)}, when the weeks counted here began.`
          : memberNotYet(report, words),
      note: null,
      how: `Visits in the full weeks of ${periodWords(report.period)}, Monday to Sunday, by the ${words.people} who were on your list when those weeks began, shared between them and those weeks.`,
    };
  }

  let busiest;
  const hours = report.hours;
  if (hours.state === 'ok') {
    const left = hours.noTime > 0 ? ` ${visitsWord(hours.noTime)} staff added on a later day ${hours.noTime === 1 ? 'has' : 'have'} no time and ${hours.noTime === 1 ? 'is' : 'are'} left out.` : '';
    const how = `Check-ins from ${dayText(hours.from)} to today, counted by weekday and hour on your clock.${left}`;
    const names = hours.busiest.map((c) => `${weekdayShort(c.weekday)} ${hourLabel(c.hour, clockFormat)}`);
    if (hours.tied > hours.busiest.length) {
      busiest = { value: null, line: `No one hour stands out: ${String(hours.tied)} hours had ${visitsWord(hours.top)} each.`, note: null, how };
    } else {
      busiest = {
        value: names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`,
        line: null,
        note: `${visitsWord(hours.top)}${names.length > 1 ? ' each' : ''} · ${span(hours.from, hours.to)}`,
        how,
      };
    }
  } else {
    busiest = {
      value: null,
      line:
        hours.state === 'no_visits'
          ? hours.noTime > 0
            ? `The only visits from ${span(hours.from, hours.to)} were added by staff on a later day, so their time is not known.`
            : `Nobody checked in from ${span(hours.from, hours.to)}.`
          : busiestNotYet(report),
      note: null,
      how: `Check-ins in ${periodWords(report.period)}, counted by weekday and hour on your clock.`,
    };
  }

  return [
    {
      key: 'visits',
      label: 'Visits',
      value: count(report.inPeriod.visits),
      line: null,
      note: `${count(report.inPeriod.people)} ${report.inPeriod.people === 1 ? 'person' : 'people'} · ${span(shownFrom, report.period.to)}${week === null ? '' : ` · this week, so far: ${count(week.visits)}`}`,
      how: `Every check-in from ${dayText(shownFrom)} to today${shownFrom === report.period.from ? '' : ', the day of your first check-in'}. Someone who comes on three days is three visits and one person.`,
    },
    { key: 'per-member', label: `Visits a ${words.person} a week`, ...member },
    { key: 'busiest', label: 'Busiest time', ...busiest },
  ];
}

/** A round number at or above `max` that splits into four whole steps, for the chart's side:
 *  the nearest one, so the line fills the chart. */
export function chartTop(max) {
  for (const step of [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000, 10000]) {
    if (step * 4 >= max) return step * 4;
  }
  return Math.ceil(max / 40000) * 40000;
}

/** Visits day by day as a line: a point for each day shown, the numbers down the side, and
 *  one line of words saying the usual day and the busiest one. `at` is where a point sits
 *  along the chart, from 0 to 1; `up` is how high, as a share of the chart's top. */
export function dayChart(report) {
  const days = report.days;
  const top = chartTop(Math.max(1, ...days.map((d) => d.visits)));
  // A date under the line for each Monday, or for each month's first day where Mondays would crowd.
  const byMonth = days.length > 45;
  const points = days.map((d, i) => {
    const weekday = weekdayOf(d.day);
    const today = d.day === report.today;
    return {
      key: d.day,
      at: days.length === 1 ? 0.5 : i / (days.length - 1),
      up: d.visits / top,
      visits: d.visits,
      today,
      weekend: weekday >= 6,
      mark: byMonth ? d.day.endsWith('-01') : weekday === 1,
      label: byMonth ? monthShort(d.day.slice(0, 7)).slice(0, 3) : dayShort(d.day),
      title: today ? `Today, ${dayNamed(d.day)}` : dayNamed(d.day),
      said: today ? `${visitsWord(d.visits)} so far` : visitsWord(d.visits),
      text: `${today ? `Today, ${dayNamed(d.day)}` : dayNamed(d.day)}: ${today ? `${visitsWord(d.visits)} so far` : visitsWord(d.visits)}`,
    };
  });
  // Today is still going, so the usual day is worked out from the days that have ended.
  const ended = days.filter((d) => d.day !== report.today);
  const most = Math.max(0, ...days.map((d) => d.visits));
  const busiest = days.filter((d) => d.visits === most);
  const parts = [];
  if (ended.length >= 2) {
    const usual = Math.round((ended.reduce((sum, d) => sum + d.visits, 0) / ended.length) * 10) / 10;
    parts.push(`About ${count(usual)} a day`);
  }
  if (most > 0 && days.length >= 2) parts.push(busiest.length === 1 ? `busiest: ${dayNamed(busiest[0].day)}, ${visitsWord(most)}` : `most in one day: ${count(most)}`);
  return {
    points,
    top,
    ticks: [top, top / 2, 0].map((value) => ({ value, label: count(value) })),
    summary: parts.length === 0 ? `Visits each day, the last ${String(days.length)} days` : parts.join(' · '),
    any: most > 0,
  };
}

/** A smooth line through points in a box `width` by `height`: each stretch leaves and
 *  arrives level, so the line never dips under zero or climbs over a day's own number. */
export function smoothLine(points, width, height) {
  const xy = points.map((p) => ({ x: Math.round(p.at * width * 10) / 10, y: Math.round((height - p.up * height) * 10) / 10 }));
  let line = '';
  xy.forEach((p, i) => {
    if (i === 0) {
      line = `M${String(p.x)} ${String(p.y)}`;
      return;
    }
    const before = xy[i - 1];
    const mid = Math.round(((before.x + p.x) / 2) * 10) / 10;
    line += ` C${String(mid)} ${String(before.y)} ${String(mid)} ${String(p.y)} ${String(p.x)} ${String(p.y)}`;
  });
  const first = xy[0];
  const last = xy[xy.length - 1];
  return { xy, line, area: xy.length === 0 ? '' : `${line} L${String(last.x)} ${String(height)} L${String(first.x)} ${String(height)} Z` };
}

/** How many weeks the table lists before its "Show all" button. */
export const WEEK_ROWS_SHOWN = 12;

/** The last day of a week that does not begin on a Monday: the week a period begins in is
 *  counted from the period's first day, and is said as the days it holds. Null for a whole week. */
const partWeekEnd = (weekStart) => (weekdayOf(weekStart) === 1 ? null : addDays(weekStart, 7 - weekdayOf(weekStart)));
/** "Sat 1 Aug to Sun 2 Aug 2026"; across New Year each day says its own year. */
const partWeekText = (from, to) => `${dayNamed(from)}${from.slice(0, 4) === to.slice(0, 4) ? '' : ` ${from.slice(0, 4)}`} to ${dayNamed(to)} ${to.slice(0, 4)}`;

/** The week-by-week table's rows, newest first. */
export function weekRows(report) {
  return [...report.weeks].reverse().map((w, i) => ({
    key: w.weekStart,
    week:
      i === 0
        ? `${dayShort(w.weekStart)} (so far)`
        : partWeekEnd(w.weekStart) !== null
          ? partWeekText(w.weekStart, partWeekEnd(w.weekStart))
          : dayText(w.weekStart),
    visits: count(w.visits),
    people: count(w.people),
  }));
}

/** What stands in the grid of hours' place while there is none: why, and the days counted.
 *  Null where the grid is drawn. */
export function hoursMissing(report) {
  const hours = report.hours;
  if (hours.state === 'ok') return null;
  if (hours.state === 'not_enough_data') return busiestNotYet(report);
  if (hours.noTime > 0) return `The only visits from ${span(hours.from, hours.to)} were added by staff on a later day, so their time is not known.`;
  return `Nobody checked in from ${span(hours.from, hours.to)}.`;
}

/** The grid of hours always shows at least these, a gym's usual day, so that one busy hour
 *  is one square; it is wider when anybody came earlier or later. */
const GRID_FROM = 6;
const GRID_TO = 21;

/** How many shades the grid of hours has, quiet to busy. */
export const HEAT_LEVELS = 5;

/** The busiest hours as a grid: a row for each weekday, a column for each hour from the
 *  earliest to the latest that had a visit, and never fewer than 06:00 to 21:00. `share` is a cell's visits against the busiest
 *  hour's. Null without the figure. */
export function hourGrid(report, clockFormat) {
  const hours = report.hours;
  if (hours.state !== 'ok') return null;
  const from = Math.min(GRID_FROM, ...hours.cells.map((c) => c.hour));
  const to = Math.max(GRID_TO, ...hours.cells.map((c) => c.hour));
  const columns = [];
  for (let hour = from; hour <= to; hour += 1) columns.push({ hour, label: hourLabel(hour, clockFormat) });
  const visitsAt = new Map(hours.cells.map((c) => [`${String(c.weekday)}-${String(c.hour)}`, c.visits]));
  // The busiest hour is ringed only where the tile names it: one hour, or a few that tie.
  const marked = hours.tied <= hours.busiest.length;
  return {
    columns,
    rows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      label: weekdayShort(weekday),
      cells: columns.map(({ hour }) => {
        const visits = visitsAt.get(`${String(weekday)}-${String(hour)}`) ?? 0;
        return {
          key: `${String(weekday)}-${String(hour)}`,
          hour,
          visits,
          share: visits / hours.top,
          // 0 is nobody; 1 to 5 from quiet to the busiest hour.
          level: visits === 0 ? 0 : Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((visits / hours.top) * HEAT_LEVELS))),
          best: marked && visits === hours.top,
          title: hourSpan({ weekday, hour }, clockFormat),
          said: visits === 0 ? 'Nobody checked in' : visitsWord(visits),
          text: `${hourSpan({ weekday, hour }, clockFormat)}: ${visitsWord(visits)}`,
        };
      }),
    })),
    caption: `Check-ins by weekday and hour, ${span(hours.from, hours.to)}`,
    marked,
  };
}

/** The two class tiles; null where the gym has no class that ran. */
export function classTiles(report) {
  const classes = report.classes;
  if (classes.state !== 'ok') return null;
  const since = `classes that started since ${dayText(classes.from)} (${periodWords(report.period)})`;
  const fill = classes.fill;
  const noShows = classes.noShows;
  let noShowTile;
  if (noShows.state === 'ok') {
    noShowTile = {
      value: percentText(noShows.percent),
      line: null,
      note: `${noShows.noShows === 1 ? '1 no-show' : `${count(noShows.noShows)} no-shows`} of ${placesWord(noShows.marked)} marked${noShows.unmarked > 0 ? ` · ${count(noShows.unmarked)} not marked yet` : ''}`,
      calendar: false,
    };
  } else if (noShows.state === 'nothing_marked') {
    noShowTile = {
      value: null,
      line: `No place has been marked Came or No-show yet (${count(noShows.unmarked)} booked). The app marks a class when people check in around it; staff can also mark each person on the Calendar.`,
      note: null,
      calendar: true,
    };
  } else {
    noShowTile = { value: null, line: `Nobody has booked a class in ${periodWords(report.period)}.`, note: null, calendar: false };
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
const words = csvWords;
const csv = (rows) => `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;

/** The weeks as a CSV: counts only, oldest first. */
export function weeksCsv(report) {
  return csv([
    ['Week starting', 'Visits', 'People'],
    ...report.weeks.map((w) => [
      w.weekStart === report.weeks[report.weeks.length - 1].weekStart
        ? `${w.weekStart} (so far)`
        : partWeekEnd(w.weekStart) !== null
          ? `${w.weekStart} (part week, to ${partWeekEnd(w.weekStart)})`
          : w.weekStart,
      w.visits,
      w.people,
    ]),
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
