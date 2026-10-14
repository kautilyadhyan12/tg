// The Reports page, a year earlier (ROADMAP 21d-ii): the line under New members, Visits and
// Collected, and no other figure (Kd, 2026-10-14). The worst thing it could do is set a figure beside a zero from a year the app
// was not used, or beside somebody else's days: a gym without those records reads why.
import { describe, expect, it } from 'vitest';
import { attendanceReportFrom, membersReportFrom, moneyReportFrom, orgWords } from '@app/shared';
import { changeWords, leadsHeadline, memberTiles, periodLine } from './reportsView';
import { classTiles, visitTiles } from './reportsAttendanceView';
import { moneyTiles } from './reportsMoneyView';

const GYM = orgWords('gym');
const TODAY = '2026-10-14';

function monthsTo(today) {
  const out = [];
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < 12; i += 1) {
    out.unshift({ month: `${String(year)}-${String(month).padStart(2, '0')}`, activeAtStart: 100, joined: 0, left: 0, leftOfStart: 0 });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

const members = (over = {}) =>
  membersReportFrom({
    timezone: 'Europe/London',
    today: TODAY,
    period: '12m',
    firstListedOn: '2023-05-02',
    listChangedOn: '2026-10-01',
    activeNow: 100,
    everLeft: true,
    months: monthsTo(TODAY),
    inPeriod: { joined: 10, left: 5 },
    stay: { leavers: 5, totalDays: 500 },
    leads: [{ source: 'walk_in', leads: 4, joined: 2 }],
    anyLead: true,
    yearEarlier: { joined: 7, left: 5, stay: { leavers: 5, totalDays: 802 }, leads: 8, leadsJoined: 2 },
    firstLeadOn: '2024-01-01',
    ...over,
  });
const memberLine = (report, key) => memberTiles(report, GYM).find((t) => t.key === key).earlier;

const SPIN = { name: 'Spin', classes: 4, limitedClasses: 4, places: 40, booked: 30, bookings: 30, attended: 20, noShows: 5 };
const attendance = (over = {}) =>
  attendanceReportFrom({
    timezone: 'Europe/London',
    today: TODAY,
    period: '4w',
    firstVisitOn: '2025-01-06',
    days: [{ day: '2026-10-01', visits: 50 }],
    weeks: [],
    people: 20,
    hours: [],
    hoursNoTime: 0,
    member: { members: 20, visits: 40, visitors: 15 },
    classes: { ever: true, types: [SPIN] },
    firstClassOn: '2025-02-01',
    yearEarlier: { visits: 62, people: 30, member: { members: 20, visits: 60, visitors: 15 }, classes: [{ ...SPIN, places: 50, booked: 25, attended: 9, noShows: 1 }] },
    ...over,
  });
const visitLine = (report, key) => visitTiles(report, GYM, '24h').find((t) => t.key === key).earlier;
const classLine = (report, key) => classTiles(report).find((t) => t.key === key).earlier;

const money = (over = {}) =>
  moneyReportFrom({
    timezone: 'Europe/London',
    today: TODAY,
    period: '3m',
    currency: 'GBP',
    anyMembership: true,
    firstPaidOn: '2025-01-10',
    otherCurrency: false,
    overdueAfterDays: 0,
    held: [],
    months: [{ typeId: 'g', typeName: 'Gold', month: '2026-09', paidMinor: 50000, refundedMinor: 0, periodPaidMinor: 50000, periodRefundedMinor: 0 }],
    owed: { currentMinor: 0, currentPeople: 0, listPeople: 0, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 },
    members: { today: TODAY, firstListedOn: '2024-03-04', everLeft: false, months: monthsTo(TODAY) },
    yearEarlier: { paidMinor: 62000, refundedMinor: 2000 },
    ...over,
  });
const collectedLine = (report) => moneyTiles(report, GYM, 'iron-house').find((t) => t.key === 'collected').earlier;

describe('the words of a change', () => {
  it.each([
    [10, 7, 'up 3'],
    [7, 10, 'down 3'],
    [7, 7, 'the same'],
    [1200, 0, 'up 1,200'],
  ])('%s beside %s is "%s"', (now, then, said) => {
    expect(changeWords(now, then)).toBe(said);
  });
});

describe('members a year earlier', () => {
  it('new members, with how it moved; no other member figure has a line (Kd, 2026-10-14)', () => {
    const r = members();
    expect(memberLine(r, 'new')).toBe('A year earlier: 7 · up 3');
    for (const key of ['active', 'left', 'churn', 'retention', 'stay']) expect(memberLine(r, key), key).toBeUndefined();
    expect(leadsHeadline(r).earlier).toBeUndefined();
  });

  it('a list that began after those days did reads the day it began, never 0', () => {
    const r = members({ firstListedOn: '2025-03-04' });
    expect(memberLine(r, 'new')).toBe('A year earlier: no figures. Your member list started on 4 Mar 2025.');
  });

  it('a list that began in the month those days began says why its first people are not new', () => {
    // Four weeks a year earlier begin on 18 Sep 2025; a list begun on 5 September counts new members from 1 October.
    expect(memberLine(members({ period: '4w', firstListedOn: '2025-09-05' }), 'new')).toBe(
      'A year earlier: no figures. Your member list started on 5 Sep 2025, and the people on it in its first month are not counted as new.',
    );
  });

  it('the line under the picker names the days a year earlier', () => {
    const r = members();
    expect(periodLine(r.period, GYM, false, r.yearEarlier)).toBe(
      "Showing 1 Nov 2025 to 14 Oct 2026. Members now, churn and retention are today's figures, so they stay the same whichever period you choose. \"A year earlier\" under a figure counts the same days a year before: 1 Nov 2024 to 14 Oct 2025.",
    );
  });
});

describe('attendance a year earlier', () => {
  it('visits, with how it moved; visits a member a week, the busiest time and the class tiles have none', () => {
    const r = attendance();
    expect(visitLine(r, 'visits')).toBe('A year earlier: 62 · down 12');
    expect(visitLine(r, 'per-member')).toBeUndefined();
    expect(visitLine(r, 'busiest')).toBeUndefined();
    expect(classLine(r, 'fill')).toBeUndefined();
    expect(classLine(r, 'no-shows')).toBeUndefined();
  });

  it('a first check-in after those days began reads its day, never 0 visits', () => {
    const r = attendance({ firstVisitOn: '2025-09-20' });
    expect(visitLine(r, 'visits')).toBe('A year earlier: no figures. Your first check-in was on 20 Sep 2025.');
  });

});

describe('money a year earlier', () => {
  it('collected, with how it moved, in the gym\'s money', () => {
    expect(collectedLine(money())).toBe('A year earlier: £600.00 · down £100.00');
  });

  it('a first payment after those days began reads its day, never £0.00', () => {
    expect(collectedLine(money({ firstPaidOn: '2025-08-02' }))).toBe('A year earlier: no figures. Your first payment was recorded on 2 Aug 2025.');
  });

  it('only Collected has a line: what is true today has none', () => {
    const tiles = moneyTiles(money(), GYM, 'iron-house');
    expect(tiles.filter((t) => t.earlier).map((t) => t.key)).toEqual(['collected']);
  });
});
