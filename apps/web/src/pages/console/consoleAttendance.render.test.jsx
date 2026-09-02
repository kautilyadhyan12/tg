// THE CONSOLE'S ATTENDANCE SECTION, AT THE SCREEN.
//
// RENDER ASSERTIONS RATHER THAN SOURCE GREPS, for the reason the crossing suite
// records: a grep is satisfied by spelling a thing differently, and what is
// pinned here is what an OWNER sees — a nav item that appears only with the
// privilege, counts that come off the wire, one row per person, and three
// different sentences for three different empty days.
//
// THE STORE IS REAL AND ONLY THE NETWORK IS MOCKED, matching `myGyms.render`:
// the nav gate reads `attendance.read` out of the same kept answer the screen
// resolves its gym from, exactly as in the browser.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = {
  getMine: vi.fn(),
  getAttendanceDay: vi.fn(),
  getAttendanceHistory: vi.fn(),
  updateOrg: vi.fn(),
};
// THE NETWORK IS MOCKED; THE MODULE'S PURE HELPERS ARE NOT. `isRetryable` is the
// rule deciding whether a failed read gets a Try again, and a hand-written copy
// of it in this factory would be a second declaration of exactly the thing the
// screen is being tested for. `errorText` stays overridden so the cases below
// can assert one sentence instead of every provider of one.
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: api,
    errorText: (_err, fallback) => fallback,
  };
});
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Kd' }, logout: vi.fn(), loading: false }),
}));

const Attendance = (await import('./Attendance')).default;
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['attendance.read', 'org.manage', 'staff.manage'],
  timezone: 'Europe/London',
  clockFormat: '24h',
  manualAttendanceEnabled: true,
  orgType: 'gym',
  subscription: { status: 'trialing' },
};

const visit = (markedAt, over = {}) => ({
  day: '2026-09-02',
  markedAt,
  method: 'manual',
  hoursStatus: 'in_session',
  session: { id: 's360', opensMinute: 360, closesMinute: 420 },
  ...over,
});

const person = (userId, displayName, visits) => ({ userId, displayName, visits });

const day = (over = {}) => ({
  data: {
    attendance: {
      day: '2026-09-02',
      timezone: 'Europe/London',
      clockFormat: '24h',
      totals: { visits: 2, people: 2 },
      summary: [
        {
          hoursStatus: 'in_session',
          session: { id: 's360', opensMinute: 360, closesMinute: 420 },
          visits: 2,
          people: 2,
        },
      ],
      people: [
        person('m1', 'Priya Sharma', [visit('2026-09-02T06:12:00.000Z')]),
        person('m2', 'Rahul Das', [visit('2026-09-02T06:20:00.000Z')]),
      ],
      nextCursor: null,
      ...over,
    },
  },
});

beforeEach(() => {
  resetConsoleOrgs();
  api.getMine.mockReset().mockResolvedValue({ data: { orgs: [ORG], formerOrgs: [] } });
  api.getAttendanceDay.mockReset().mockResolvedValue(day());
  api.getAttendanceHistory.mockReset().mockResolvedValue({
    data: {
      attendance: {
        timezone: 'Europe/London',
        clockFormat: '24h',
        visits: [visit('2026-09-02T06:12:00.000Z'), visit('2026-08-30T07:05:00.000Z', { day: '2026-08-30' })],
        nextCursor: null,
      },
    },
  });
  api.updateOrg.mockReset().mockResolvedValue({ data: { org: ORG } });
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
});

const drawScreen = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/attendance']}>
      <Routes>
        <Route path="/console/:orgSlug/attendance" element={<Attendance />} />
      </Routes>
    </MemoryRouter>,
  );

const drawShell = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/attendance']}>
      <Routes>
        <Route
          path="/console/:orgSlug/attendance"
          element={<ConsoleLayout><div>screen</div></ConsoleLayout>}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('the nav item', () => {
  // KD'S RULING 17 (:28107): a fourth item in the left rail, beside Gym,
  // Members and Settings — NOT a panel inside Settings.
  it('appears in the console rail for somebody holding the privilege', async () => {
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Attendance').length).toBeGreaterThan(0));
  });

  // :11429's SEAM AT THE SCREEN. The tab asks for the POWER, not the job title
  // — an owner may untick `attendance.read` for a trainer (:28107 §2), and a
  // screen reading the role would go on drawing a tab the server refuses.
  it('is absent for staff whose owner unticked it, even though they are staff', async () => {
    api.getMine.mockResolvedValue({
      data: {
        orgs: [{ ...ORG, staffRole: 'trainer', privileges: ['members.read'] }],
        formerOrgs: [],
      },
    });
    drawShell();
    // Non-vacuity first: without this the assertion below passes on a rail that
    // never rendered, which is how a guard quietly stops guarding.
    await waitFor(() => expect(screen.getAllByText('Members').length).toBeGreaterThan(0));
    expect(screen.queryByText('Attendance')).toBeNull();
  });

  // :11616 IS UNTOUCHED. The console's rail must not gain a way into the member
  // app, and this new item points at a console screen.
  it('points inside the console and never at the member app', async () => {
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Attendance').length).toBeGreaterThan(0));
    const links = Array.from(document.querySelectorAll('a[href]'));
    expect(links.some((a) => a.getAttribute('href') === '/console/iron-house/attendance')).toBe(true);
    expect(links.filter((a) => a.getAttribute('href') === '/dashboard')).toHaveLength(0);
  });
});

describe('the shape of the day', () => {
  it('draws one line per session with the server’s own count', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('06:00 – 07:00')).toBeTruthy());
    // SCOPED TO THE ROW. "2 people" is legitimately on this screen twice — the
    // day's headline and this session's line — and on a one-session day they
    // agree. An unscoped query would be ambiguous, and scoping it to the row
    // also makes the assertion say what it means: this SESSION had two people.
    const row = screen.getByText('06:00 – 07:00').closest('li');
    expect(within(row).getByText('2 people')).toBeTruthy();
  });

  // RULING 14's ONLY LOAD-BEARING REQUIREMENT (:27992 §3), and the fixture is
  // what makes it testable: this day says 300 people in its TOTALS while
  // shipping a page of TWO. A screen that counted its rows would print "2
  // people"; the served number is 300. This is the "right on six rows, reports
  // the first page on four hundred" defect, made observable.
  it('prints the served day total, NEVER a count of the rows it downloaded', async () => {
    api.getAttendanceDay.mockResolvedValue(
      day({
        totals: { visits: 412, people: 300 },
        summary: [
          {
            hoursStatus: 'in_session',
            session: { id: 's360', opensMinute: 360, closesMinute: 420 },
            visits: 412,
            people: 300,
          },
        ],
        nextCursor: 'page-2',
      }),
    );
    drawScreen();
    await waitFor(() => expect(screen.getByText('300 people · 412 visits')).toBeTruthy());
    // The page holds two rows. Neither number may appear as the day's answer.
    expect(screen.queryByText('2 people · 2 visits')).toBeNull();
  });

  // KD'S RULING 12 ON THE HEADLINE — the second number appears only when
  // somebody came twice, so it means something when an owner sees it.
  //
  // The POSITIVE half is the test above it (`300 people · 412 visits` renders),
  // which is what stops this negative going vacuous: without it, a headline that
  // had stopped rendering entirely would pass this too.
  it('says visits beside people only when they differ', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('06:00 – 07:00')).toBeTruthy());
    expect(screen.queryByText(/2 people · 2 visits/)).toBeNull();
  });

  it('draws the times on the GYM’s clock when the gym chose 12-hour', async () => {
    api.getAttendanceDay.mockResolvedValue(day({ clockFormat: '12h' }));
    drawScreen();
    await waitFor(() => expect(screen.getByText('6:00 AM – 7:00 AM')).toBeTruthy());
  });
});

describe('who came', () => {
  it('draws one row per person with their name', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    expect(screen.getByText('Rahul Das')).toBeTruthy();
  });

  // KD'S RULING 12 AT THE SCREEN (:27992 §1) — the case a reviewer should check
  // first. A member who came morning and evening is ONE row with TWO times, on
  // the owner's screen exactly as on the member's own.
  it('shows somebody who came twice as ONE row with TWO times', async () => {
    api.getAttendanceDay.mockResolvedValue(
      day({
        totals: { visits: 3, people: 2 },
        people: [
          person('m1', 'Priya Sharma', [
            visit('2026-09-02T06:12:00.000Z'),
            visit('2026-09-02T17:40:00.000Z', {
              session: { id: 's1020', opensMinute: 1020, closesMinute: 1080 },
            }),
          ]),
          person('m2', 'Rahul Das', [visit('2026-09-02T06:20:00.000Z')]),
        ],
      }),
    );
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    expect(screen.getAllByText('Priya Sharma')).toHaveLength(1);
    expect(screen.getByText('07:12')).toBeTruthy();
    expect(screen.getByText('18:40')).toBeTruthy();
  });

  // The gym is in London and the suite runs pinned to Asia/Kolkata, so a
  // reader-zone rendering would answer 11:42 rather than 07:12 (trap #8).
  it('draws every time in the GYM’s zone and not the reader’s', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('07:12')).toBeTruthy());
    expect(screen.queryByText('11:42')).toBeNull();
  });
});

describe('the unusual arrivals', () => {
  const withExceptions = () =>
    day({
      totals: { visits: 6, people: 6 },
      summary: [
        {
          hoursStatus: 'in_session',
          session: { id: 's360', opensMinute: 360, closesMinute: 420 },
          visits: 4,
          people: 4,
        },
        { hoursStatus: 'outside_hours', session: null, visits: 2, people: 2 },
      ],
    });

  it('counts them from the server’s whole-day summary and offers a filter', async () => {
    api.getAttendanceDay.mockResolvedValue(withExceptions());
    drawScreen();
    await waitFor(() =>
      expect(screen.getByText(/2 visits outside opening hours or on a closed day/)).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: /show only these/i })).toBeTruthy();
  });

  // The filter is the SERVER's parameter, not a client predicate over rows
  // already downloaded — otherwise the list would narrow while the counts went
  // on describing the whole day, which is two questions on screen at once.
  it('asks the SERVER for them rather than filtering the page', async () => {
    api.getAttendanceDay.mockResolvedValue(withExceptions());
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /show only these/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /show only these/i }));
    await waitFor(() =>
      expect(api.getAttendanceDay).toHaveBeenLastCalledWith('g1', {
        day: '2026-09-02',
        statuses: 'outside_hours,closed_day',
      }),
    );
  });

  // :26736 — a gym that has never said when it is open has not been arrived at
  // oddly, and counting its visits here would put a false sentence in front of
  // every such gym.
  it('never counts a gym with no timetable as having unusual arrivals', async () => {
    api.getAttendanceDay.mockResolvedValue(
      day({
        totals: { visits: 5, people: 5 },
        summary: [{ hoursStatus: 'hours_unset', session: null, visits: 5, people: 5 }],
      }),
    );
    drawScreen();
    await waitFor(() => expect(screen.getByText('Before opening times were set')).toBeTruthy());
    expect(screen.queryByText(/outside opening hours or on a closed day/)).toBeNull();
  });
});

describe('one person’s own history', () => {
  // :28055 §2 — picking a name answers "how often do they actually come?"
  // through the SAME route with `?userId=`, a filter rather than a second
  // endpoint.
  it('opens their visits on the same route, filtered to them', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    fireEvent.click(screen.getByText('Priya Sharma'));
    await waitFor(() =>
      expect(api.getAttendanceHistory).toHaveBeenCalledWith('g1', { userId: 'm1' }),
    );
    await waitFor(() => expect(screen.getByText(/when they came/i)).toBeTruthy());
  });

  it('says the read failed rather than claiming they have never been', async () => {
    api.getAttendanceHistory.mockRejectedValue(new Error('offline'));
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    fireEvent.click(screen.getByText('Priya Sharma'));
    await waitFor(() => expect(screen.getByText(/couldn't load their visits/i)).toBeTruthy());
    expect(screen.queryByText(/no visits recorded/i)).toBeNull();
  });

  // IT SPENDS THE SAME 600/hour BUCKET AS THE DAY LIST (:28649 L-5), so it is
  // opened by a deliberate press and never prefetched for every row.
  it('reads nobody’s history until a name is actually pressed', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    expect(api.getAttendanceHistory).not.toHaveBeenCalled();
  });
});

describe('the name search', () => {
  it('narrows the rows on screen', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/search by name/i), { target: { value: 'rahul' } });
    await waitFor(() => expect(screen.queryByText('Priya Sharma')).toBeNull());
    expect(screen.getByText('Rahul Das')).toBeTruthy();
  });

  // THE HONESTY, and it is the reason this ships without a server filter. A
  // "nobody by that name" for a member sitting on page three is the same lie as
  // counting a page and calling it the day.
  it('never claims nobody by that name while pages are still unloaded', async () => {
    api.getAttendanceDay.mockResolvedValue(day({ nextCursor: 'page-2' }));
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/search by name/i), { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByText(/load the rest to search them too/i)).toBeTruthy());
    expect(screen.queryByText(/nobody by that name came in on this day/i)).toBeNull();
  });

  it('says nobody by that name once everybody is loaded', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/search by name/i), { target: { value: 'zzz' } });
    await waitFor(() =>
      expect(screen.getByText(/nobody by that name came in on this day/i)).toBeTruthy(),
    );
  });
});

describe('paging', () => {
  // RULING 14: paged, never infinite-scrolled — and a scroll listener that
  // paged itself would also be a loop against a shared 600/hour bucket.
  it('adds the next page on a deliberate press and leaves the day’s counts alone', async () => {
    api.getAttendanceDay.mockResolvedValueOnce(
      day({ totals: { visits: 300, people: 300 }, nextCursor: 'page-2' }),
    );
    drawScreen();
    await waitFor(() => expect(screen.getByText('300 people')).toBeTruthy());

    api.getAttendanceDay.mockResolvedValueOnce(
      day({
        totals: { visits: 300, people: 300 },
        people: [person('m3', 'Anita Roy', [visit('2026-09-02T06:40:00.000Z')])],
        nextCursor: null,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /show more people/i }));

    await waitFor(() => expect(screen.getByText('Anita Roy')).toBeTruthy());
    // The first page is still there — appended, not replaced.
    expect(screen.getByText('Priya Sharma')).toBeTruthy();
    // And the served day total has not moved to describe the rows on screen.
    expect(screen.getByText('300 people')).toBeTruthy();
  });

  it('draws no Show more when the server says there is nothing after this', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /show more people/i })).toBeNull();
  });
});

describe('the day, and moving between days', () => {
  it('opens on the gym’s own today and asks the server for that day', async () => {
    drawScreen();
    await waitFor(() => expect(api.getAttendanceDay).toHaveBeenCalled());
    const [, params] = api.getAttendanceDay.mock.calls[0];
    expect(params.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reads the previous day when the arrow is pressed', async () => {
    drawScreen();
    await waitFor(() => expect(api.getAttendanceDay).toHaveBeenCalled());
    const [, first] = api.getAttendanceDay.mock.calls[0];
    fireEvent.click(screen.getByLabelText(/previous day/i));
    await waitFor(() => expect(api.getAttendanceDay).toHaveBeenCalledTimes(2));
    const [, second] = api.getAttendanceDay.mock.calls[1];
    expect(second.day < first.day).toBe(true);
  });

  /** **CLEARING THE BOX MUST NOT STRAND THE SCREEN** — the regression test for
   *  T3 round 1's C/H-2 (:5348 rule 3). A `type="date"` clears on Backspace in
   *  Chrome and carries an explicit ✕ in Firefox, so an empty value is one
   *  keystroke away and is not an exotic input.
   *
   *  **UNDER THE DEFECT ONE KEYSTROKE TOOK OUT THREE CONTROLS AT ONCE**, which
   *  is why it was Critical rather than a rough edge: the read went out as
   *  `?day=`, which `attendanceDayQuerySchema`'s regex refuses, so the screen
   *  printed the server's own `day: invalid_string` at the owner (K1's ban list,
   *  verbatim); `addDays('', ±1)` answers `''` unchanged so BOTH arrows stopped
   *  issuing reads; and Try again re-sent the same refused request for ever. The
   *  only way out was retyping into the box Kd had just told us he could not see
   *  (:29410).
   *
   *  It asserts the READ was never issued rather than that no error appeared —
   *  an assertion about the error card would also pass on a screen that sent the
   *  bad request and merely worded the refusal better. */
  it('sends no read for an empty date, and keeps the day it had', async () => {
    drawScreen();
    await waitFor(() => expect(api.getAttendanceDay).toHaveBeenCalled());
    const box = screen.getByLabelText('Day');
    const opened = box.value;
    expect(opened).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    fireEvent.change(box, { target: { value: '' } });

    expect(api.getAttendanceDay).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Day').value).toBe(opened);
  });

  /** THE OTHER TWO CONTROLS THE DEFECT KILLED, and they are a separate case
   *  because the assertion above cannot see them: a screen that swallowed the
   *  empty value into state while leaving the arrows reading from it would pass
   *  the first test and still be stranded. */
  it('keeps both arrows working after somebody clears the box', async () => {
    drawScreen();
    await waitFor(() => expect(api.getAttendanceDay).toHaveBeenCalled());
    const [, first] = api.getAttendanceDay.mock.calls[0];

    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText(/previous day/i));

    await waitFor(() => expect(api.getAttendanceDay).toHaveBeenCalledTimes(2));
    const [, second] = api.getAttendanceDay.mock.calls[1];
    // A REAL DAY, AND THE ONE BEFORE THE DAY IT HELD. Asserting only that a
    // second read happened would pass on `?day=` going out again.
    expect(second.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(second.day < first.day).toBe(true);
  });

  // The hours card learned this the hard way: an HTML `min` is a CONSTRAINT,
  // not a hint, and a date outside it makes the field silently refuse with no
  // event and no sentence. Attendance is a history, so the past is the normal
  // direction of travel and a floor would break the screen's main use.
  it('puts no floor or ceiling on the date box', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByLabelText('Day')).toBeTruthy());
    const box = screen.getByLabelText('Day');
    expect(box.getAttribute('min')).toBeNull();
    expect(box.getAttribute('max')).toBeNull();
  });
});

describe('an empty day says WHICH empty', () => {
  const empty = (over = {}) =>
    day({ totals: { visits: 0, people: 0 }, summary: [], people: [], ...over });

  // THE :8267/:8343 CLASS, which this project has shipped once. The three cases
  // look identical in the data and only one of them is a problem.
  it('tells the owner the button is switched off, and where to turn it on', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, manualAttendanceEnabled: false }], formerOrgs: [] },
    });
    api.getAttendanceDay.mockResolvedValue(empty());
    drawScreen();
    await waitFor(() => expect(screen.getByText(/the button is switched off/i)).toBeTruthy());
    expect(screen.getByText(/settings/i)).toBeTruthy();
    expect(screen.queryByText(/nobody has marked themselves in/i)).toBeNull();
  });

  it('never says nobody came when a filter emptied the list', async () => {
    api.getAttendanceDay.mockResolvedValueOnce(
      day({
        totals: { visits: 200, people: 180 },
        summary: [
          {
            hoursStatus: 'in_session',
            session: { id: 's360', opensMinute: 360, closesMinute: 420 },
            visits: 198,
            people: 178,
          },
          { hoursStatus: 'outside_hours', session: null, visits: 2, people: 2 },
        ],
      }),
    );
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /show only these/i })).toBeTruthy());

    // The filtered read comes back with no people — a real answer, because the
    // owner narrowed it, and NOT an empty day.
    api.getAttendanceDay.mockResolvedValueOnce(
      day({ totals: { visits: 200, people: 180 }, summary: [], people: [] }),
    );
    fireEvent.click(screen.getByRole('button', { name: /show only these/i }));

    await waitFor(() =>
      expect(screen.getByText(/nobody arrived outside opening hours on this day/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/nobody has marked themselves in/i)).toBeNull();
  });

  it('says nobody came for an honestly empty day', async () => {
    api.getAttendanceDay.mockResolvedValue(empty());
    drawScreen();
    await waitFor(() =>
      expect(screen.getByText(/nobody has marked themselves in on this day yet/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/switched off/i)).toBeNull();
  });

  // A FAILED READ IS NOT AN EMPTY DAY and must never be drawn as one — this
  // app telling an owner nobody came because a request dropped.
  it('says the read failed rather than drawing an empty day', async () => {
    api.getAttendanceDay.mockRejectedValue(new Error('offline'));
    drawScreen();
    await waitFor(() => expect(screen.getByText(/couldn't load who came in/i)).toBeTruthy());
    expect(screen.queryByText(/nobody has marked themselves in/i)).toBeNull();
    // The people section is not drawn at all. Matched as the exact heading
    // rather than a loose /who came/i, which the ERROR SENTENCE itself contains
    // ("We couldn't load who came in.") — a pattern that matches the thing it is
    // asserting the absence of can never fail for the right reason.
    expect(screen.queryByText('Who came')).toBeNull();
  });
});

describe('the rate-limit constraint', () => {
  // :28649 L-5. This read and the history read share ONE 600/hour bucket, so a
  // poll or a focus re-read here would spend an owner's allowance twice over.
  // The card's "no live-updating ticker" is therefore also a server constraint.
  it('reads once and never again on its own — no focus re-read, no timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      drawScreen();
      await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
      expect(api.getAttendanceDay).toHaveBeenCalledTimes(1);

      fireEvent(window, new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(120_000);

      expect(api.getAttendanceDay).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('an answer that arrives for a question nobody is asking any more', () => {
  /** THE SAME SHAPE AS THE MEMBER HALF'S C/H-2, on the owner's screen: a read
   *  begun BEFORE the owner moved cannot answer for where they moved to. Here
   *  the held answer carries the day and filter it was fetched for, so a slow
   *  read landing after the day changed can never be drawn under the new day's
   *  heading — the console store's rule 3, applied to a day instead of a user. */
  it('never draws the previous day’s people under the new day', async () => {
    // THE WINDOW THAT MATTERS IS WHILE THE NEW READ IS STILL IN THE AIR, and a
    // first draft of this test missed it entirely: it hung the FIRST read and
    // let the second resolve at once, so the abandoned read was cancelled by the
    // effect's own cleanup and never landed. **The mutant proved it** — with the
    // freshness check replaced by `true` the test stayed green, because the path
    // it claimed to cover was never taken.
    //
    // The held people are the previous day's for as long as the new read takes.
    // Only the stamp keeps them off screen, so the new read is the one that must
    // hang.
    drawScreen();
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());

    let landSecond = () => {};
    api.getAttendanceDay.mockReturnValueOnce(
      new Promise((resolve) => {
        landSecond = () =>
          resolve(
            day({
              people: [
                person('m9', 'Someone Else', [visit('2026-09-01T06:12:00.000Z', { day: '2026-09-01' })]),
              ],
              totals: { visits: 1, people: 1 },
            }),
          );
      }),
    );
    fireEvent.click(screen.getByLabelText(/previous day/i));

    // MID-FLIGHT: yesterday is on the heading and yesterday's answer has not
    // arrived, so today's people must not be sitting under it.
    await waitFor(() => expect(screen.getByText(/loading who came in/i)).toBeTruthy());
    expect(screen.queryByText('Priya Sharma')).toBeNull();
    expect(screen.queryByText('Rahul Das')).toBeNull();

    landSecond();
    await waitFor(() => expect(screen.getByText('Someone Else')).toBeTruthy());
    expect(screen.queryByText('Priya Sharma')).toBeNull();
  });

  /** The other door into the same defect: a PAGE that lands after the day
   *  changed belongs to the day the owner has left, and appending it would put
   *  one day's people under another day's heading. */
  it('never appends a page that belongs to a day the owner has left', async () => {
    api.getAttendanceDay.mockResolvedValueOnce(day({ nextCursor: 'page-2' }));
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /show more people/i })).toBeTruthy());

    let landPage = () => {};
    api.getAttendanceDay.mockReturnValueOnce(
      new Promise((resolve) => {
        landPage = () =>
          resolve(day({ people: [person('m9', 'Late Arrival', [visit('2026-09-02T07:00:00.000Z')])] }));
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /show more people/i }));

    api.getAttendanceDay.mockResolvedValueOnce(
      day({ people: [person('m8', 'Other Day Person', [visit('2026-09-01T06:00:00.000Z')])] }),
    );
    fireEvent.click(screen.getByLabelText(/previous day/i));
    landPage();

    await waitFor(() => expect(screen.getByText('Other Day Person')).toBeTruthy());
    expect(screen.queryByText('Late Arrival')).toBeNull();
  });
});

describe('trying again after a failed read', () => {
  /** A retry must actually RE-READ. The day and the filter do not change when
   *  somebody presses Try again, so a screen keyed only on those would show a
   *  spinner for ever — the effect would never run a second time. */
  it('reads again and recovers', async () => {
    api.getAttendanceDay.mockRejectedValueOnce(new Error('offline'));
    drawScreen();
    await waitFor(() => expect(screen.getByText(/couldn't load who came in/i)).toBeTruthy());

    api.getAttendanceDay.mockResolvedValueOnce(day());
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeTruthy());
    expect(api.getAttendanceDay).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/couldn't load who came in/i)).toBeNull();
  });

  /** **NO BUTTON WHERE PRESSING IT CANNOT HELP** (T3 round 1, L-2). The refusal
   *  this screen actually meets is `attendance.read` having been unticked, and
   *  no amount of pressing re-grants a privilege. The SENTENCE stays — it is the
   *  server's own and it is true — and what goes is the button's implied promise
   *  that trying again might work. Same `isRetryable` the Overview's two panes
   *  ask. */
  it('offers no Try again when the server refused the privilege', async () => {
    api.getAttendanceDay.mockRejectedValue({
      response: {
        status: 403,
        data: { error: 'forbidden', message: 'You cannot see attendance for this gym.', requestId: 'r' },
      },
    });
    drawScreen();
    // THE ERROR CARD IS STILL DRAWN — this is about the button, never about
    // swallowing the refusal. (The sentence reads as the fallback here only
    // because `errorText` is stubbed at the top of the file; in the browser it
    // is the server's own.)
    await waitFor(() => expect(screen.getByText(/couldn't load who came in/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  /** THE POSITIVE CONTROL — offline is the case that MUST keep the button, and
   *  without this the case above is satisfied by a screen that never offers one
   *  (:7104's PG1). A request that never reached the server carries no status
   *  and no body, so the bound stays `true`. */
  it('still offers it when the request never reached the server', async () => {
    api.getAttendanceDay.mockRejectedValue(new Error('offline'));
    drawScreen();
    await waitFor(() => expect(screen.getByText(/couldn't load who came in/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});

describe('the day picker announces itself', () => {
  /** KD AT THE SCREEN, 2026-09-02 (the attendance smoke). He ran the sheet, then
   *  asked for the ‹ › arrows to be REMOVED because they confused him — and the
   *  cause was the opposite of what it looked like: *"oh its there working i did
   *  not see that"*. The calendar had been reachable all along behind a bare box
   *  with no affordance, so the arrows read as the only way to move.
   *
   *  Removing them was put to him WITH ITS COST ("what about yesterday?" is an
   *  owner's commonest question, one click today) and he chose the other repair:
   *  *"make it obvious"*. **These pin the obvious-ness as BEHAVIOUR rather than
   *  as styling**, because a test that asserted an icon exists would pass on an
   *  icon nobody can click. */
  it('opens the calendar when the icon beside the date is clicked, not just the box', async () => {
    const showPicker = vi.fn();
    const had = Object.prototype.hasOwnProperty.call(HTMLInputElement.prototype, 'showPicker');
    const original = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = showPicker;
    try {
      drawScreen();
      await waitFor(() => expect(screen.getByLabelText('Day')).toBeTruthy());
      // The icon is decorative, so it is reached through the control that wraps
      // it — a <label>, which forwards a click on ANY of its area to the input.
      const box = screen.getByLabelText('Day').closest('label');
      expect(box).not.toBeNull();
      const icon = box.querySelector('svg');
      expect(icon).not.toBeNull();

      fireEvent.click(icon);
      expect(showPicker).toHaveBeenCalled();
    } finally {
      if (had) HTMLInputElement.prototype.showPicker = original;
      else delete HTMLInputElement.prototype.showPicker;
    }
  });

  /** THE ARROWS STAY, and this is the positive control on the decision above.
   *  Kd asked for them to go and then chose not to; a later chat reading only
   *  his first message would delete them. */
  it('still offers both arrows beside the calendar', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByLabelText('Day')).toBeTruthy());
    expect(screen.getByLabelText(/previous day/i)).toBeTruthy();
    expect(screen.getByLabelText(/next day/i)).toBeTruthy();
  });

  /** A browser that has no `showPicker` must still let somebody TYPE a date —
   *  the try/catch is what makes that true, and a throw escaping it would take
   *  the click handler down with it. */
  it('does not break on a browser with no calendar API', async () => {
    const had = Object.prototype.hasOwnProperty.call(HTMLInputElement.prototype, 'showPicker');
    const original = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = () => { throw new Error('unsupported'); };
    try {
      drawScreen();
      await waitFor(() => expect(screen.getByLabelText('Day')).toBeTruthy());
      fireEvent.click(screen.getByLabelText('Day'));
      fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-08-30' } });
      await waitFor(() => expect(screen.getByLabelText('Day').value).toBe('2026-08-30'));
    } finally {
      if (had) HTMLInputElement.prototype.showPicker = original;
      else delete HTMLInputElement.prototype.showPicker;
    }
  });
});
