// MY GYMS — the section Kd ruled on 2026-09-02, and the member's half of
// attendance inside it.
//
// THESE ARE RENDER ASSERTIONS RATHER THAN SOURCE GREPS, for the same reason the
// crossing suite gives: a grep is satisfied by spelling a thing differently,
// and what is being pinned here is what a person actually sees — a nav item
// that appears only after a gym approves them, a button that is ABSENT rather
// than dead, and a day that shows two times rather than two rows.
//
// THE STORE IS REAL AND ONLY THE NETWORK IS MOCKED. The gate is `isMember` off
// `/v1/orgs/mine`, and mocking the hook would have tested a fixture instead of
// the rule — the sidebar and the screen read the same kept answer here, exactly
// as they do in the browser.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = {
  getMine: vi.fn(),
  getHours: vi.fn(),
  getAttendanceHistory: vi.fn(),
  markAttendance: vi.fn(),
};
vi.mock('../api/orgsApi', () => ({
  orgService: api,
  // The screens print the server's own sentence where it has one; every path
  // exercised here falls back, so the fallback is what the assertions read.
  errorText: (_err, fallback) => fallback,
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Kd' }, logout: vi.fn(), loading: false }),
}));
vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (cb) => cb() }),
}));
vi.mock('../hooks/useXp', () => ({ useXp: () => ({ xp: null }) }));

const MyGyms = (await import('./MyGyms')).default;
const Sidebar = (await import('../components/common/Sidebar')).default;
const { consoleOrgsRegainedFocus, resetConsoleOrgs, subscribeConsoleOrgs } = await import(
  './console/consoleOrgs'
);

const GYM = {
  id: 'g1',
  name: 'Iron House',
  slug: 'iron-house',
  isMember: true,
  manualAttendanceEnabled: true,
  staffRole: null,
};

const visit = (over = {}) => ({
  day: '2026-09-02',
  markedAt: '2026-09-02T06:12:00.000Z',
  method: 'manual',
  hoursStatus: 'hours_unset',
  session: null,
  ...over,
});

const history = (visits, over = {}) => ({
  data: {
    attendance: { timezone: 'UTC', clockFormat: '24h', visits, nextCursor: null, ...over },
  },
});

const marked = (over = {}) => ({
  data: {
    status: 'created',
    alreadyMarked: false,
    visit: visit(),
    timezone: 'UTC',
    clockFormat: '24h',
    ...over,
  },
});

// THE CALENDAR OPENS ON THE GYM'S CURRENT MONTH, SO EVERY FIXTURE DAY BELOW IS
// A CLAIM ABOUT WHAT MONTH IT IS. Left on the wall clock these tests would pass
// in September 2026 and fail in October — :25567's *"asserting a dated string in
// any web test"*, arriving through the fixture rather than the assertion.
//
// **ONLY `Date` IS FAKED**, for the reason the opening-hours block below already
// records: `setTimeout` stays real so `waitFor` behaves, and `setInterval` stays
// real so the panel's tick fires only in the one test that asks it to. That
// block re-installs with the same list and sets its own moment, which is a
// no-op re-install rather than a conflict.
const NOW = new Date('2026-09-02T12:00:00.000Z');

/** THE GRID CELL FOR A DAY SOMEBODY CAME ON — the fire, addressed by what it
 *  tells a screen reader rather than by an icon nobody can query. A day with no
 *  visit renders a button too (disabled, no fire), so the name is what tells
 *  them apart and `queryByRole` returning null IS the assertion that the day is
 *  not marked. */
const cameOn = (dayOfMonth) =>
  screen.queryByRole('button', { name: `${String(dayOfMonth)} — you came` });

/** THE FLAME ITSELF, AND IT NEEDED ITS OWN QUERY.
 *
 *  `cameOn` addresses a cell by its LABEL and the number is queried by its
 *  class, so the two tests named after the fire both passed with the `<Flame>`
 *  deleted — proven by deleting it. The icon is `aria-hidden`, which is correct
 *  and is exactly why nothing could see it: the one thing Kd sent this card back
 *  over was held up by his single look at it (:32395) and by nothing else.
 *
 *  It is not vacuous — a day nobody came on renders a button with no icon at
 *  all, which is the control every assertion below carries. */
const fireIn = (cell) => cell?.querySelector('svg') ?? null;

/** Open a day's times. Kd was told the times move behind a tap when he chose the
 *  calendar, so every time assertion in this file goes through here. */
const openDay = (dayOfMonth) => {
  fireEvent.click(cameOn(dayOfMonth));
};

/** UNFOLD THE CALENDAR — it arrives CLOSED (Kd, 2026-09-03, at his own browser:
 *  *"the calender need to be compact small and only appear when click"*), so
 *  every assertion about a month in this file goes through here first.
 *
 *  **AND NOTHING IS READ UNTIL THIS RUNS**, which is why the request-count
 *  assertions below sit after it rather than after `drawScreen`. */
const openCalendar = async () => {
  const fold = () => screen.getByRole('button', { name: /days you came/i });
  // It appears once the gym's zone has arrived and a month can be named, so the
  // wait is for the fold itself rather than for anything inside it.
  await waitFor(() => expect(fold()).toBeTruthy());
  fireEvent.click(fold());
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: false });
  vi.setSystemTime(NOW);
  resetConsoleOrgs();
  api.getMine.mockReset().mockResolvedValue({ data: { orgs: [GYM], formerOrgs: [] } });
  // The hours note draws nothing for a gym that has not answered, which keeps
  // these assertions about attendance. Its own states are pinned in
  // `gymHours.render.test.jsx`.
  api.getHours.mockReset().mockResolvedValue({ data: { hours: { mode: 'unset' } } });
  api.getAttendanceHistory.mockReset().mockResolvedValue(history([]));
  api.markAttendance.mockReset().mockResolvedValue(marked());
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
  vi.useRealTimers();
});

const drawSidebar = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Sidebar />
    </MemoryRouter>,
  );

const drawScreen = () =>
  render(
    <MemoryRouter initialEntries={['/my-gyms']}>
      <MyGyms />
    </MemoryRouter>,
  );

describe('the nav item', () => {
  // KD'S RULING, THE WHOLE OF IT: *"it will appear only after a gym approves a
  // memebr joining"*. A person still waiting is not a member, and `isMember` is
  // the server's own answer to that.
  it('appears once a gym has approved the member', async () => {
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
  });

  it('is absent for somebody who is not a member of any gym', async () => {
    api.getMine.mockResolvedValue({ data: { orgs: [], formerOrgs: [] } });
    drawSidebar();
    // Non-vacuity first: without this the assertion below passes on a sidebar
    // that never rendered, which is how a guard quietly stops guarding.
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeTruthy());
    expect(screen.queryByText('My Gyms')).toBeNull();
  });

  // AN OWNER IS NOT AUTOMATICALLY A MEMBER. Their view of the same gym is the
  // console, behind the other door; this section is a member's own.
  it('is absent for staff of a gym they do not train at', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...GYM, isMember: false, staffRole: 'owner' }], formerOrgs: [] },
    });
    drawSidebar();
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeTruthy());
    expect(screen.queryByText('My Gyms')).toBeNull();
  });

  // :11616 IS UNTOUCHED AND THIS IS WHERE THE TWO ARE TOLD APART. The item Kd
  // removed pointed at `/console`; this one points at a member screen. An edit
  // that aimed the new item across the crossing fails here as well as in the
  // crossing suite.
  it('points at the member screen and NOT into the gym console', async () => {
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    const links = Array.from(document.querySelectorAll('a[href]'));
    expect(links.some((a) => a.getAttribute('href') === '/my-gyms')).toBe(true);
    expect(links.filter((a) => a.getAttribute('href').startsWith('/console'))).toHaveLength(0);
  });

  // C/H-3. `Sidebar` is mounted on every member screen for the whole session,
  // so subscribing the console's way put :16331's refresh-on-focus into the
  // member app — measured at 4 reads after three focus events. A console is a
  // handful of staff; a gym's members are hundreds of people behind one address
  // and `/v1/orgs/mine` has only the global 300/minute keyed to `req.ip`.
  //
  // THE OTHER DIRECTION IS NOT ORPHANED: the console's focus re-read is driven
  // through real window events by `console.render.test.jsx` and
  // `settings.render.test.jsx`, which go red if this fix took the watch away
  // from the console too.
  it('does not re-read the gym list when the window regains focus', async () => {
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    expect(api.getMine).toHaveBeenCalledTimes(1);
    fireEvent(window, new Event('focus'));
    fireEvent(window, new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    expect(api.getMine).toHaveBeenCalledTimes(1);
  });

  // T3 ROUND 2, F1 — THE OTHER HALF OF C/H-3, WHICH NOTHING HELD. That fix has
  // two parts: `{ watch: false }` keeps the member app out of the window watch
  // (the case above), and stopping keyed on WATCHERS rather than on all
  // listeners is what stops a quiet member subscriber holding that watch OPEN
  // after the last console screen has gone. Reverting the second half to
  // `listeners.size === 0` left every web test green.
  //
  // IT CANNOT LIVE IN `consoleOrgs.test.js`, which is where the review proposed
  // putting it: that file runs in NODE, so `startWatching` returns early for
  // want of a `window`, no listener is ever attached, and the case would pass
  // under the fix AND under the revert. That is :25567's shape — a suggested fix
  // that leaves the finding behind — so it lives here, where there is a DOM.
  it('lets go of the window watch when the last console screen does, with the member app still subscribed', async () => {
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    expect(api.getMine).toHaveBeenCalledTimes(1);

    // A console screen opens beside it — the only kind of subscriber that ever
    // asks for the focus re-read — and then closes again.
    const closeConsoleScreen = subscribeConsoleOrgs(() => {});
    closeConsoleScreen();

    // The member app is still subscribed, and nothing should be listening.
    fireEvent(window, new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    expect(api.getMine).toHaveBeenCalledTimes(1);
  });

  it('does not draw the item when the list could not be read', async () => {
    api.getMine.mockRejectedValue(new Error('offline'));
    drawSidebar();
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeTruthy());
    expect(screen.queryByText('My Gyms')).toBeNull();
  });
});

describe('the screen', () => {
  it('names the gym and offers the button', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('Iron House')).toBeTruthy());
    expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy();
  });

  // RULING 4 AND :24141: ABSENT, NOT GREYED. A dead control with no explanation
  // is the defect; and the member's own history stays, because those visits
  // really happened.
  it('draws NO button when the gym has the switch off, and keeps the history', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...GYM, manualAttendanceEnabled: false }], formerOrgs: [] },
    });
    api.getAttendanceHistory.mockResolvedValue(history([visit()]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('Days you came')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /i'm here/i })).toBeNull();
    // THE HISTORY STAYS — the day is still marked and its times still open.
    // Those visits really happened, and hiding them because the gym stopped
    // taking new ones would remove a thing Kd ruled in.
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    openDay(2);
    expect(screen.getByText('06:12')).toBeTruthy();
  });

  it('tells somebody with no gym where joining happens', async () => {
    api.getMine.mockResolvedValue({ data: { orgs: [], formerOrgs: [] } });
    drawScreen();
    await waitFor(() => expect(screen.getByText(/not a member of a gym yet/i)).toBeTruthy());
    expect(screen.getByRole('link', { name: /settings/i }).getAttribute('href')).toBe('/settings');
  });

  // THE EMPTY-VS-FAILED CLASS (:8267/:8343), which this project has shipped
  // once. A dropped request must never be drawn as "you belong to no gyms".
  it('says the read failed rather than showing an empty list', async () => {
    api.getMine.mockRejectedValue(new Error('offline'));
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy());
    expect(screen.queryByText(/not a member of a gym yet/i)).toBeNull();
  });
});

describe('saying you are here', () => {
  it('records the visit and says what was recorded', async () => {
    api.markAttendance.mockResolvedValue(
      marked({
        visit: visit({ hoursStatus: 'in_session', session: { opensMinute: 360, closesMinute: 420 } }),
      }),
    );
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() =>
      expect(screen.getByText("You're marked in — the 06:00 – 07:00 session.")).toBeTruthy(),
    );
    expect(api.markAttendance).toHaveBeenCalledWith('g1');
  });

  // THE VISIT LANDS IN THE LIST WITHOUT A SECOND REQUEST — both attendance
  // reads share one rate-limit bucket (600/hour), so this screen writes down
  // what the server told it rather than asking again.
  it('adds the new day without re-reading the history', async () => {
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText(/no visits yet this month/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    // THE DAY LIGHTS UP, and its times are behind the tap Kd was told about.
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    openDay(2);
    expect(screen.getByText('06:12')).toBeTruthy();
    // **AND THE MONTH WAS READ EXACTLY ONCE.** This counted a re-read after a
    // mark before the calendar; it now also pins that neither the tap, the
    // opened day, nor the panel's own half-minute tick asks again — the shared
    // 600/hour bucket, with the console's day list on the other side of it.
    expect(api.getAttendanceHistory).toHaveBeenCalledTimes(1);
  });

  // :28221's IDEMPOTENCE AT THE SCREEN. A second tap in the same session
  // answers with the FIRST visit — so the screen must not draw a second time
  // chip for it, which would be a count the database disagrees with.
  it('draws ONE time when the same session is tapped twice', async () => {
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    api.markAttendance.mockResolvedValue(marked({ alreadyMarked: true }));
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText(/already marked in/i)).toBeTruthy());
    // ONE DAY, ONE TIME. A second chip would be a count the database disagrees
    // with — and the grid has one more way to get this wrong than the list did,
    // so the CELL is asserted to be single as well as the chip inside it.
    expect(screen.getAllByRole('button', { name: '2 — you came' })).toHaveLength(1);
    openDay(2);
    expect(screen.getAllByText('06:12')).toHaveLength(1);
  });

  // KD RULING 12 AT THE SCREEN (:27992 §1) — the case to check first. Two
  // visits in two sessions on one day is ONE row with TWO times, on the
  // member's side exactly as on the owner's.
  it('shows a day they came twice as one row with two times', async () => {
    api.getAttendanceHistory.mockResolvedValue(
      history([
        visit({ markedAt: '2026-09-02T17:40:00.000Z' }),
        visit({ markedAt: '2026-09-02T06:12:00.000Z' }),
      ]),
    );
    drawScreen();
    await openCalendar();
    // ONE SQUARE, not two — the grid's version of ruling 12's "one row".
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    expect(screen.getAllByRole('button', { name: '2 — you came' })).toHaveLength(1);
    // AND BOTH TIMES BEHIND IT. This is the assertion that says a square is not
    // a loss of information: the day carries everything the row carried.
    openDay(2);
    expect(screen.getByText('17:40')).toBeTruthy();
    expect(screen.getByText('06:12')).toBeTruthy();
  });

  // A FAILED HISTORY READ DRAWS NOTHING — never "you haven't been here yet",
  // which is this app telling somebody their own past is empty because a
  // request dropped.
  // **THE FAILED READ SAYS SO NOW, WHERE IT USED TO SAY NOTHING, AND THE CHANGE
  // IS DELIBERATE.** The list drew nothing at all on a failure, reasoned as "a
  // red bar about a background read would be noise". A GRID has arrows: drawing
  // nothing would take away the only way to step to a month that would have
  // loaded, so the heading and the arrows stay and one honest line replaces the
  // squares. What has not changed is the thing :8267/:8343 are about — a failure
  // is never drawn as an empty month.
  it('says the month could not be read, and never draws it as an empty month', async () => {
    api.getAttendanceHistory.mockRejectedValue(new Error('offline'));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText(/couldn't load the days you came/i)).toBeTruthy());
    expect(screen.queryByText(/no visits/i)).toBeNull();
    expect(cameOn(2)).toBeNull();
    // NO SQUARES AT ALL — a month of blank cells on a read nobody completed
    // would be this app telling somebody they did not come on days it never
    // looked at.
    expect(screen.queryByRole('button', { name: '2' })).toBeNull();
  });

  // ── T3 ROUND 1 REGRESSIONS ────────────────────────────────────────────────
  // Each of the three fails without its fix; that is the whole reason it is
  // here (:5348 rule 3). All three describe a state the SCREEN gets into, which
  // is where round 1's C/H defects lived and where round 1's own seven mutants
  // did not look — they aimed at the pure helpers and the nav gate.

  // C/H-1. A tap used to flip a FAILED read to `ready`, so the list appeared
  // holding only the visit just made: a member with months of history was shown
  // a history of one day, `more` false so not even the "most recent" line
  // qualified it. A tap knows what it recorded and knows nothing about the rest.
  it('never draws the history off a read that failed, even after a tap', async () => {
    api.getAttendanceHistory.mockRejectedValue(new Error('offline'));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    // The tap is confirmed — that part is true and stays on screen …
    await waitFor(() => expect(screen.getByText(/you're marked in/i)).toBeTruthy());
    // … and the month it says nothing about is still not drawn. The tap knows
    // one day; the grid would be a claim about thirty.
    expect(screen.getByText(/couldn't load the days you came/i)).toBeTruthy();
    expect(cameOn(2)).toBeNull();
  });

  // C/H-2. The mount read landed AFTER the mark and replaced the list
  // wholesale, erasing the visit — so the screen said "You're marked in." and
  // "You haven't marked yourself in here yet." at once. The read was started
  // before the tap, so it cannot answer for it.
  it('does not let a read that was already in flight erase the visit', async () => {
    let answerTheRead = () => {};
    api.getAttendanceHistory.mockReturnValue(
      new Promise((resolve) => {
        answerTheRead = () => resolve(history([]));
      }),
    );
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText(/you're marked in/i)).toBeTruthy());
    // The read — which left before the tap and therefore knows nothing of it —
    // now comes back empty.
    answerTheRead();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    openDay(2);
    expect(screen.getByText('06:12')).toBeTruthy();
    expect(screen.queryByText(/no visits/i)).toBeNull();
  });

  it('draws the visit once when the read comes back already carrying it', async () => {
    let answerTheRead = () => {};
    api.getAttendanceHistory.mockReturnValue(
      new Promise((resolve) => {
        answerTheRead = () => resolve(history([visit()]));
      }),
    );
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText(/you're marked in/i)).toBeTruthy());
    answerTheRead();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    expect(screen.getAllByRole('button', { name: '2 — you came' })).toHaveLength(1);
    openDay(2);
    expect(screen.getAllByText('06:12')).toHaveLength(1);
  });

  it('prints the refusal when the server turns the mark down', async () => {
    api.markAttendance.mockRejectedValue(new Error('409'));
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText(/couldn't record that just now/i)).toBeTruthy());
  });

  // ── T3 ROUND 2 REGRESSIONS ────────────────────────────────────────────────
  // Both round-1 fixes that shipped with nothing holding them. Neither was
  // wrong; each was a guarantee one ordinary edit could take away in silence,
  // which is :5348 rule 4's definition of the gap a green suite hides.

  // T3 ROUND 2, F2. Round 1's L-4 made the MARK's zone and clock win over the
  // pair the history read brought back — the fresher of two answers about the
  // same gym. **Nothing could tell the two precedences apart**: every fixture
  // sent `UTC` and `24h` on BOTH answers, so the test data made the defect and
  // the fix identical (:20712's own trap, and :4856 — the fixture is part of
  // the claim). The two answers now disagree, which is the only way to ask.
  it('draws the new chip on the clock the MARK came back with, not the read’s', async () => {
    api.getAttendanceHistory.mockResolvedValue(history([], { clockFormat: '24h' }));
    api.markAttendance.mockResolvedValue(marked({ clockFormat: '12h' }));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));

    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    openDay(2);
    expect(screen.getByText('6:12 AM')).toBeTruthy();
    // The stale pair winning would spell the same minute the other way.
    expect(screen.queryByText('06:12')).toBeNull();
  });

  // T3 ROUND 2, F4. A visit must never follow the member onto a DIFFERENT gym.
  // What guarantees that is the `key` on the card in `MyGyms.jsx` — React throws
  // the panel away when the gym changes, so no state can cross — and the review
  // proposed patching the panel instead. :20712 ruled that shape out: a
  // per-field reset fixes the field somebody remembered and leaves the next one,
  // while the key covers the taps, the history and every field added later.
  // **The key is the fix and it was already there; what was missing is this**,
  // so a key changed to a position or a constant cannot re-arm the class in
  // silence. The assertion is the GUARANTEE, not the mechanism: either fix
  // satisfies it, and neither being present fails it.
  //
  // **THE RE-READ MUST BE A BACKGROUND ONE, AND THE FIRST DRAFT OF THIS TEST WAS
  // VACUOUS FOR WANT OF THAT.** Written with `refreshConsoleOrgs` — a FOREGROUND
  // read — the store publishes `loading` first, `MyGyms` swaps the whole list for
  // its spinner, and the panel is destroyed by the arm change rather than by the
  // key: the positional-key mutant stayed ALIVE and the test passed for a reason
  // that had nothing to do with what it claims. A background read never
  // publishes `loading` (the store's rule 1), so the list stays on screen and
  // the KEY is the only thing deciding whether the panel is reused.
  //
  // Nothing in the member app calls this today — that is what `watch: false`
  // bought — so this drives the store directly to put the screen in the state a
  // later edit could create. That is the finding: unreachable now, one edit away.
  it('never carries a visit across to a different gym', async () => {
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(cameOn(2)).toBeTruthy());

    // Their list becomes a gym they have never marked in at, without the screen
    // ever leaving the list arm.
    const other = { ...GYM, id: 'g2', slug: 'bar-bell', name: 'Bar Bell Club' };
    api.getMine.mockResolvedValue({ data: { orgs: [other], formerOrgs: [] } });
    consoleOrgsRegainedFocus();

    await waitFor(() => expect(screen.getByText('Bar Bell Club')).toBeTruthy());
    expect(screen.queryByText('Iron House')).toBeNull();
    // THE FIRE DOES NOT FOLLOW THEM. The grid is one more piece of state the key
    // has to throw away, and it is drawn from `marked` as well as from the read
    // — so a panel reused across gyms would show gym A's day on gym B's month.
    expect(cameOn(2)).toBeNull();
  });
});

// ── KD'S RULING OF 2026-09-03 (`:30867`) AT THE SCREEN ──────────────────────
// *"i set owner gym times to 7 am to 8 am but now it is 5:28 but the i am here
// button was still there which i told you to disable if it does not incline
// with the gym time"* — and *"should not be able to press i am here"*, which is
// why every assertion below is about the button's DISABLED state and not about
// what a tap answers. The server has refused since `:30867`; being refused
// AFTER pressing is not what he asked for.
//
// **ONLY `Date` IS FAKED.** `setTimeout` stays real so `waitFor` behaves
// normally, and `setInterval` stays real so the panel's clock simply never
// fires except in the one case that asks it to. A test that let the gate read
// the wall clock would pass at 07:30 and fail at 05:28 — :27094 §2's defect.
describe('the button outside opening hours', () => {
  // 05:28 on Thursday in London, which is Kd's own moment. The gym below opens
  // at 07:00, so this instant is the one he was looking at.
  const KDS_MOMENT = new Date('2026-09-03T05:28:00.000Z');
  const THURSDAY = 4;

  const hoursOf = (over = {}) => ({
    data: {
      hours: {
        mode: 'scheduled',
        timezone: 'UTC',
        clockFormat: '24h',
        week: [{ weekday: THURSDAY, sessions: [{ opensMinute: 420, closesMinute: 480 }] }],
        closures: [],
        ...over,
      },
    },
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: false });
    vi.setSystemTime(KDS_MOMENT);
    api.getHours.mockResolvedValue(hoursOf());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const button = () => screen.queryByRole('button', { name: /i'm here/i });

  it('cannot be pressed before the gym opens', async () => {
    drawScreen();
    await waitFor(() => expect(button()?.disabled).toBe(true));
  });

  // ITS OWN CASE, AND SEPARATE FROM THE ONE ABOVE ON PURPOSE. :29500's C/H-1
  // was a control that greyed correctly and said nothing beside it — the sixth
  // panel in this app to disable something and the first to leave a person with
  // no explanation. The disable half and the sentence half fail independently,
  // so they are asserted independently rather than folded into one case that
  // passes while half of it is broken.
  it('says why the button is dead', async () => {
    drawScreen();
    await waitFor(() => expect(button()?.disabled).toBe(true));
    expect(screen.getByText(/isn't open right now/i)).toBeTruthy();
  });

  // THE STATE IT IS *NOT* IN WHEN YOU FIND IT (:31295). Same fixture, same
  // gym, one hour later: a gate that simply killed the button would satisfy
  // every assertion above and fail here.
  it('can be pressed while the gym is open', async () => {
    vi.setSystemTime(new Date('2026-09-03T07:30:00.000Z'));
    drawScreen();
    await waitFor(() => expect(button()).toBeTruthy());
    expect(button()?.disabled).toBe(false);
    expect(screen.queryByText(/isn't open right now/i)).toBeNull();
    fireEvent.click(button());
    await waitFor(() => expect(api.markAttendance).toHaveBeenCalledWith('g1'));
  });

  it('cannot be pressed on a day the gym said it is closed', async () => {
    api.getHours.mockResolvedValue(hoursOf({ closures: [{ day: '2026-09-03', note: 'Holi' }] }));
    vi.setSystemTime(new Date('2026-09-03T07:30:00.000Z'));
    drawScreen();
    await waitFor(() => expect(button()?.disabled).toBe(true));
    // The closure wins over a session that is running (:26684 §3), and the
    // sentence says which of the two shut the day.
    expect(screen.getByText(/closed today, so attendance isn't open/i)).toBeTruthy();
    expect(screen.queryByText(/isn't open right now/i)).toBeNull();
  });

  // **THIS IS WHAT LETS THE REFUSAL SAY NO TIME.** The server's 409 spells
  // today's windows because it arrives with no context; here the opening times
  // are already on the card, on the gym's own clock, ABOVE the dead button. If
  // that ever stops being true the sentence becomes a bare no at a locked door,
  // which is the thing `:30867` §1 refused to ship — so it is asserted rather
  // than assumed.
  it('tells the member when the gym IS open, beside the button it just killed', async () => {
    drawScreen();
    await waitFor(() => expect(button()?.disabled).toBe(true));
    expect(screen.getByText('Today: 07:00 – 08:00')).toBeTruthy();
  });

  // EVERY UNKNOWN ADMITS (:24141 §3a). Three ways the screen can fail to know,
  // and none of them may take a member's door away — the server decides.
  // **THE FIXTURE CARRIES A ZONE, AND T3 ROUND 1's L-3 IS WHY.** Written as a
  // bare `{ mode: 'unset' }` this case passed for the wrong reason: with no
  // timezone the gate admits at the ZONE guard, so deleting the unset branch
  // altogether left it green — measured, and the pure suite was the only thing
  // that went red. A fixture missing a field tests the guard that catches the
  // missing field, not the rule the test is named for.
  it('stays pressable when the gym has never set hours', async () => {
    api.getHours.mockResolvedValue({
      data: { hours: { mode: 'unset', timezone: 'UTC', clockFormat: '24h', week: [], closures: [] } },
    });
    drawScreen();
    await waitFor(() => expect(button()).toBeTruthy());
    expect(button()?.disabled).toBe(false);
  });

  it('stays pressable for a gym that is open 24 hours', async () => {
    api.getHours.mockResolvedValue({
      data: { hours: { mode: 'open_24h', timezone: 'UTC', clockFormat: '24h', week: [], closures: [] } },
    });
    drawScreen();
    await waitFor(() => expect(screen.getByText('Open 24 hours')).toBeTruthy());
    expect(button()?.disabled).toBe(false);
  });

  it('stays pressable when the opening times could not be read', async () => {
    api.getHours.mockRejectedValue(new Error('offline'));
    drawScreen();
    await waitFor(() => expect(button()).toBeTruthy());
    expect(button()?.disabled).toBe(false);
    // And nothing is invented about a gym we could not ask about.
    expect(screen.queryByText(/isn't open right now/i)).toBeNull();
  });

  // THE CLOCK, AND WHY IT EXISTS. Without it the gate is decided once at paint,
  // so a member who opens this screen at 06:59 is still refused at 07:05 —
  // blocked from something they are entitled to do, which is :5807's second
  // clause. `setInterval` is faked ONLY here.
  it('comes back to life at opening time without a reload', async () => {
    // **`useRealTimers()` FIRST, AND IT IS NOT TIDINESS — MEASURED.** Calling
    // `useFakeTimers` while fake timers are ALREADY installed silently keeps
    // the first `toFake` list and drops the new one: `setInterval` stayed real,
    // the panel's tick never fired, and the test failed with the button dead
    // while the code was right. Probed both ways in isolation — re-install
    // fired 0, release-then-install fired 2 — rather than reasoned about.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-09-03T06:59:40.000Z'));
    drawScreen();
    await waitFor(() => expect(button()?.disabled).toBe(true));

    // ONE MECHANISM MOVES TIME, and the first draft of this test used two.
    // `advanceTimersByTime` carries the faked `Date` forward AND fires what is
    // due; a `setSystemTime` beside it moves `Date` while leaving every
    // scheduled callback where it was, so the clock said 07:00 and the panel
    // never heard about it — the test failed with the button still dead and
    // the CODE was right. Twenty past seven, one tick fired, nothing else
    // touched.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(button()?.disabled).toBe(false);
    expect(screen.queryByText(/isn't open right now/i)).toBeNull();
  });
});

// KD ASKED FOR THIS IN THE SAME MESSAGE THAT APPROVED THE CARD: *"there should
// be some indication that i am here means attandance in gym so that user
// understands"*. "I'm here" is his own wording and is untouched; what was
// missing is anything on the card SAYING what pressing it does.
describe('what the button is for', () => {
  it('says that pressing it marks attendance at the gym', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    expect(screen.getByText('Attendance')).toBeTruthy();
    expect(screen.getByText(/marks your attendance at the gym/i)).toBeTruthy();
  });

  // IT DESCRIBES THE CONTROL, SO IT GOES WHERE THE CONTROL GOES. A gym with
  // the switch off draws no button (ruling 4), and an explanation of a button
  // that is not there is the same class of false sentence as :30867 §2.4 — the
  // line promising nobody is turned away, left standing after they were. The
  // history below is untouched, because those visits happened.
  it('says nothing about a button the gym has switched off', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...GYM, manualAttendanceEnabled: false }], formerOrgs: [] },
    });
    api.getAttendanceHistory.mockResolvedValue(history([visit()]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('Days you came')).toBeTruthy());
    expect(screen.queryByText('Attendance')).toBeNull();
    expect(screen.queryByText(/marks your attendance at the gym/i)).toBeNull();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    openDay(2);
    expect(screen.getByText('06:12')).toBeTruthy();
  });
});

// ── KD'S CALENDAR AT THE SCREEN (`:31508`) ──────────────────────────────────
// *"i think a calander with dates when you went to gym is good and a day with
// attandance will have a fire effect"*. The list this replaces grew without
// bound; a month is a fixed height however often somebody comes.
//
// **EVERY MONTH HERE IS THE GYM'S MONTH.** The gym below is in `Asia/Kolkata`
// and the suite's pinned clock is 2026-09-02T12:00Z, so its today is the 2nd of
// September and the grid opens there.
describe('the calendar', () => {
  const hoursIn = (timezone) => ({
    data: { hours: { mode: 'open_24h', timezone, clockFormat: '24h', week: [], closures: [] } },
  });

  const windowOf = (call) => call[1];

  it('opens on the gym s current month and asks the server for exactly it', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy());
    // HALF-OPEN, so August's `to` is September's `from` and a visit belongs to
    // exactly one month (DECISIONS `:31921`).
    expect(windowOf(api.getAttendanceHistory.mock.calls[0])).toEqual({
      from: '2026-09-01',
      to: '2026-10-01',
    });
  });

  // **THE MONTH IS THE GYM'S, NOT THE READER'S, AND THIS IS THE CASE THAT TELLS
  // THEM APART.** The pinned instant is 2026-09-30T20:00Z. In `Asia/Kolkata`
  // (+05:30) that is already 01:30 on 1 OCTOBER, while the browser — pinned to
  // `Asia/Kolkata` in `vitest.config.js` — and UTC disagree. A gym in Honolulu
  // (-10:00) is still on 30 September. Two gyms, one instant, two months, and a
  // grid built from the browser's clock would open on the wrong one for the
  // second: the window and the grid answering differently about one visit,
  // which is the defect the server half was arranged to prevent.
  it('opens on the GYM s month even when the reader s calendar says another', async () => {
    vi.setSystemTime(new Date('2026-09-30T20:00:00.000Z'));
    api.getHours.mockResolvedValue(hoursIn('Pacific/Honolulu'));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy());
    expect(windowOf(api.getAttendanceHistory.mock.calls[0])).toEqual({
      from: '2026-09-01',
      to: '2026-10-01',
    });
    // And the same instant at a gym the other side of UTC is a month ahead.
    cleanup();
    api.getAttendanceHistory.mockClear();
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('October 2026')).toBeTruthy());
    expect(windowOf(api.getAttendanceHistory.mock.calls[0])).toEqual({
      from: '2026-10-01',
      to: '2026-11-01',
    });
  });

  /** THE GREYING FOLLOWS THE GYM'S CLOCK TOO, AND ONE GYM CANNOT PROVE IT.
   *
   *  `monthGrid`'s `future` flag has its own tests in the pure file, and nothing
   *  asserted that the PANEL hands it the gym's today rather than the reader's:
   *  swapping `gymToday(gymZone, tick)` for `gymToday(undefined, tick)` left the
   *  whole suite green. **That is :32197 §6's own stated gap** — "the greying of
   *  future days is pinned in the pure layer only" — and :28976's lesson that a
   *  sweep aimed at pure functions misses what a screen does.
   *
   *  **TWO GYMS, BECAUSE ONE ANSWER IS NOT A COMPARISON.** The clock is
   *  2026-09-02T12:00Z and `TZ` is pinned to `Asia/Kolkata`, so the READER is on
   *  the 2nd. At UTC+14 the gym is already on the 3rd, so that square is TODAY;
   *  at UTC-10 it is still the 2nd, so the 3rd is future and dimmed. **A panel
   *  reading the reader's clock hands both gyms the same answer**, so it fails
   *  the first of these whichever way round it is wrong — which one gym, in one
   *  zone, could never show. (C207.) */
  it('greys the day ahead by the GYM s clock and not the reader s', async () => {
    api.getHours.mockResolvedValue(hoursIn('Pacific/Kiritimati'));
    api.getAttendanceHistory.mockResolvedValue(history([]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy());
    // UTC+14: the gym is ON the 3rd, so the 3rd is today and is not dimmed.
    expect(screen.getByRole('button', { name: '3' }).style.opacity).toBe('1');

    cleanup();
    api.getAttendanceHistory.mockClear();
    api.getHours.mockResolvedValue(hoursIn('Pacific/Honolulu'));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy());
    // UTC-10, same instant: the gym is still on the 2nd, so the 3rd has not
    // happened there yet.
    expect(screen.getByRole('button', { name: '3' }).style.opacity).toBe('0.3');
  });

  it('draws the fire on the days somebody came and on no others', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory.mockResolvedValue(
      history([visit({ day: '2026-09-02' }), visit({ day: '2026-09-20' })]),
    );
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    expect(cameOn(20)).toBeTruthy();
    expect(cameOn(3)).toBeNull();
    // A day nobody came on is still a square — it is just not one you can open.
    const blank = screen.getByRole('button', { name: '3' });
    expect(blank.disabled).toBe(true);
    // AND THE FIRE IS ACTUALLY DRAWN. Without these three lines this test
    // passes with the flame deleted, because the label it queries by is set by
    // the CELL and not by the icon.
    expect(fireIn(cameOn(2))).not.toBeNull();
    expect(fireIn(cameOn(20))).not.toBeNull();
    expect(fireIn(blank)).toBeNull();
  });

  // STEPPING IS THE ONE THING THAT RE-READS, and it asks for the month it moved
  // to. A step that re-asked for the same window would draw the wrong month
  // silently.
  it('steps back a month and asks for that month', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    await waitFor(() => expect(screen.getByText('August 2026')).toBeTruthy());
    expect(windowOf(api.getAttendanceHistory.mock.calls[1])).toEqual({
      from: '2026-08-01',
      to: '2026-09-01',
    });
    // AND FORWARD AGAIN, so the arrows are not tested in one direction only —
    // :7104's PG1, on a control instead of a guard.
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy());
  });

  it('will not step past the month the gym is in', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy());
    expect(screen.getByRole('button', { name: /next month/i }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    await waitFor(() => expect(screen.getByText('August 2026')).toBeTruthy());
    expect(screen.getByRole('button', { name: /next month/i }).disabled).toBe(false);
  });

  // **A TAP MADE TODAY MUST NOT LAND ON A MONTH SOMEBODY STEPPED BACK TO.** The
  // panel merges this session's taps into whatever month is on screen, so this
  // is the assertion that the merge is bounded by the grid's own dates rather
  // than by a filter somebody remembered to write.
  it('does not draw today s tap on a month it did not happen in', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(cameOn(2)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    await waitFor(() => expect(screen.getByText('August 2026')).toBeTruthy());
    // The 2nd of AUGUST is not the day they marked.
    expect(cameOn(2)).toBeNull();
    // …and stepping back finds it again, so this cannot be passing because the
    // tap was simply lost.
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy());
    expect(cameOn(2)).toBeTruthy();
  });

  // **AN ANSWER TO A DIFFERENT MONTH IS NOT AN ANSWER** (:29250 §6), AND THE
  // SWEEP CORRECTED WHAT THIS TEST FIRST CLAIMED.
  //
  // Its first version stepped to a month whose read was slow and asserted that
  // the other month's visits were not drawn — and the stamp mutant SURVIVED it,
  // because that is not what the stamp buys. The grid indexes by full DATE, so a
  // visit from another month can never match a cell whatever the state says;
  // cross-month bleeding is impossible by construction, in both directions.
  //
  // **WHAT THE STAMP ACTUALLY PREVENTS IS A CONFIDENT SENTENCE ABOUT A MONTH
  // NOBODY HAS READ YET.** Without it, the completed September read leaves
  // `status: 'ready'`, so stepping to August draws an empty grid captioned "No
  // visits in August 2026" while August's request is still in the air — the
  // :8267/:8343 class, told about a month rather than about a list. That is the
  // assertion, and it is the one the mutant dies on.
  it('never calls a month empty while its read is still in flight', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory.mockResolvedValue(history([visit({ day: '2026-09-02' })]));

    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());

    // AUGUST IS HELD OPEN, and the mock is swapped only once September has
    // landed. **A chained `mockImplementationOnce` was tried first and the
    // September read never resolved at all** — no third render, measured — so
    // the fixture is built from the two mock shapes this file already drives
    // successfully: a plain `mockResolvedValue`, then a `mockReturnValue`
    // holding one promise open. A fixture that does not behave is not a smaller
    // problem than a defect; it is a test that proves nothing.
    let answerAugust = () => {};
    api.getAttendanceHistory.mockReturnValue(
      new Promise((resolve) => {
        answerAugust = () => resolve(history([visit({ day: '2026-08-11' })]));
      }),
    );

    // **`act` RATHER THAN `waitFor`, AND IT IS NOT A STYLE CHOICE — MEASURED.**
    // With `waitFor` this case failed once in three identical runs: `Date` is
    // faked suite-wide, testing-library then takes its fake-timer path, and its
    // yielding to the microtask queue races a promise that resolves off a click.
    // A test that is right two times in three is a liar the third time, which is
    // worse than one that fails. `act` flushes the render and the microtasks
    // once, deterministically, and asserts on what is then on screen.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    });
    expect(screen.getByText('August 2026')).toBeTruthy();

    // AUGUST IS UNREAD, SO NOTHING IS SAID ABOUT IT. September's answer is still
    // the newest one held, and it is not an answer to this question.
    expect(screen.queryByText(/no visits/i)).toBeNull();
    // Nor is September's day drawn — true by the date index rather than by the
    // stamp, and asserted so a later change to either cannot lose it.
    expect(cameOn(2)).toBeNull();

    await act(async () => {
      answerAugust();
    });
    expect(cameOn(11)).toBeTruthy();
  });

  // :4267's F1 AND :4355's F4, WHICH THIS CARD COULD REPEAT EXACTLY: a
  // condition caused by OTHER months printed as a sentence about this one. The
  // list said "you haven't marked yourself in here yet" and was right; over a
  // month grid that sentence is false for anybody stepping back past the month
  // they joined.
  it('says an empty month is empty, never that the member has never come', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory
      .mockResolvedValueOnce(history([visit({ day: '2026-09-02' })]))
      .mockResolvedValue(history([]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    await waitFor(() => expect(screen.getByText('No visits in August 2026.')).toBeTruthy());
    expect(screen.queryByText(/haven't marked yourself in here yet/i)).toBeNull();
    expect(screen.queryByText(/never/i)).toBeNull();
  });

  // SAID RATHER THAN SILENTLY SHORT. A month holding more visits than one page
  // must say so — a grid that just left days blank would be telling somebody
  // they did not come.
  it('says so when a month holds more visits than it can show', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory.mockResolvedValue(
      history([visit({ day: '2026-09-02' })], { nextCursor: 'more|00000000-0000-4000-8000-000000000000' }),
    );
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText(/more visits than this view can show/i)).toBeTruthy());
    // And it is not said when the month came back whole, or every member would
    // be told their history is incomplete.
    cleanup();
    api.getAttendanceHistory.mockResolvedValue(history([visit({ day: '2026-09-02' })]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    expect(screen.queryByText(/more visits than this view can show/i)).toBeNull();
  });

  // KD WAS TOLD THIS COST BEFORE HE CHOSE THE CALENDAR: a square cannot show
  // that somebody came at 5:01 PM *and* 3:32 AM, so the times move behind a tap.
  // If they cannot be reached, the card lost information the list had.
  it('opens a day to its times, headed by the day s own date', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory.mockResolvedValue(
      history([
        visit({ day: '2026-09-02', markedAt: '2026-09-02T17:40:00.000Z' }),
        visit({ day: '2026-09-02', markedAt: '2026-09-02T06:12:00.000Z' }),
      ]),
    );
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    expect(screen.queryByText('06:12')).toBeNull();
    openDay(2);
    expect(screen.getByText('Wed 2 Sep 2026')).toBeTruthy();
    expect(screen.getByText('17:40')).toBeTruthy();
    expect(screen.getByText('06:12')).toBeTruthy();
    // AND IT CLOSES. A sheet that cannot be dismissed is what :31295 was.
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByText('17:40')).toBeNull();
  });

  // STEPPING MONTHS MUST NOT LEAVE A DAY OPEN — AND THE SWEEP FOUND THAT THE
  // OBVIOUS ASSERTION PROVES NOTHING.
  //
  // The first version stepped away and checked the sheet had gone. It goes
  // either way: `openRow` is looked up out of the CURRENT grid, so a date from
  // another month matches no cell and the sheet closes itself. The clearing
  // mutant survived, which is :28221 §3(d)'s question — is the expression
  // load-bearing at all?
  //
  // **IT IS, AND ONLY COMING BACK SHOWS IT.** Step away and step back and the
  // held date matches again, so the sheet REOPENS on a month change nobody
  // asked to open anything on — a panel appearing over the screen by itself.
  // That is the case this drives.
  it('does not re-open a day by itself when the member steps back to its month', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory
      .mockResolvedValueOnce(history([visit({ day: '2026-09-02' })]))
      .mockResolvedValueOnce(history([]))
      .mockResolvedValue(history([visit({ day: '2026-09-02' })]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    openDay(2);
    expect(screen.getByText(/you were here/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    await waitFor(() => expect(screen.getByText('August 2026')).toBeTruthy());
    expect(screen.queryByText(/you were here/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    // NOBODY TAPPED ANYTHING. A sheet here is the screen deciding to open
    // something on its own.
    expect(screen.queryByText(/you were here/i)).toBeNull();
  });
});

// ── KD AT HIS BROWSER, 2026-09-03 ───────────────────────────────────────────
// *"it looks disgusting covering alsmot the whole page and the burn sysmbol so
// small have to use a maginfying glass, men the calender need to be compact
// small and only appear when click may be have a calendar symbol big that the
// user can see properly and the burn symbol should be bright with color and in
// the middle of the symbol should be the date with white color"*.
describe('the calendar folds away', () => {
  const hoursIn = (timezone) => ({
    data: { hours: { mode: 'open_24h', timezone, clockFormat: '24h', week: [], closures: [] } },
  });

  it('arrives CLOSED, with no month on screen', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory.mockResolvedValue(history([visit({ day: '2026-09-02' })]));
    drawScreen();
    // The fold itself is there…
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /days you came/i })).toBeTruthy(),
    );
    // …and nothing of the month is.
    expect(screen.queryByText('September 2026')).toBeNull();
    expect(cameOn(2)).toBeNull();
    expect(screen.queryByRole('button', { name: /previous month/i })).toBeNull();
  });

  // **AND IT MUST GO BACK, WHICH IS THE HALF :31295 SHIPPED BROKEN** — a
  // dropdown that arrived open and could not be closed, because one `||`
  // overrode the tap and both its comments said otherwise. **The assertion is
  // the state it is NOT in when you find it**, which is that entry's standing
  // rule for a two-state control.
  it('opens on a tap and closes again on the next one', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory.mockResolvedValue(history([visit({ day: '2026-09-02' })]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText('September 2026')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /days you came/i }));
    expect(screen.queryByText('September 2026')).toBeNull();
    expect(cameOn(2)).toBeNull();
  });

  it('says which way it will go, for somebody not looking at the chevron', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    drawScreen();
    const fold = () => screen.getByRole('button', { name: /days you came/i });
    await waitFor(() => expect(fold()).toBeTruthy());
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold());
    expect(fold().getAttribute('aria-expanded')).toBe('true');
  });

  // **NOTHING IS ASKED FOR UNTIL IT IS OPENED**, and `/my-gyms` draws one of
  // these per gym — so on a member of three this is three requests saved on
  // every page load, against a 600/hour bucket shared with the console.
  it('asks the server for nothing until it is opened', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    drawScreen();
    // Non-vacuity: the screen really did finish drawing before this is checked.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy(),
    );
    expect(api.getAttendanceHistory).not.toHaveBeenCalled();

    await openCalendar();
    await waitFor(() => expect(api.getAttendanceHistory).toHaveBeenCalledTimes(1));
  });

  // FOLDING AND UNFOLDING IS NOT A REASON TO ASK AGAIN — the month is already
  // in hand, and re-reading on every open would spend the bucket on nothing.
  it('does not re-read a month it already has when closed and opened again', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory.mockResolvedValue(history([visit({ day: '2026-09-02' })]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    expect(api.getAttendanceHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /days you came/i }));
    fireEvent.click(screen.getByRole('button', { name: /days you came/i }));
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    expect(api.getAttendanceHistory).toHaveBeenCalledTimes(1);
  });

  // **THE DATE LIVES INSIDE THE FIRE AND IS STILL TEXT** (Kd: *"in the middle
  // of the symbol should be the date with white color"*). A flame that swallowed
  // the number would take the date away from anybody not looking at pixels,
  // which is why the number is rendered rather than drawn.
  it('keeps the day number readable inside the fire', async () => {
    api.getHours.mockResolvedValue(hoursIn('Asia/Kolkata'));
    api.getAttendanceHistory.mockResolvedValue(history([visit({ day: '2026-09-02' })]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    // The number is inside the cell, as text, and white — his three words.
    const inside = cameOn(2).querySelector('.text-white');
    expect(inside).not.toBeNull();
    expect(inside.textContent).toBe('2');
    // AND IT IS INSIDE A FLAME. "Readable inside the fire" is two claims and
    // this test could only see one of them: with the icon deleted the white
    // number is still there, still white, still says 2 — and the day has no
    // fire on it at all.
    expect(fireIn(cameOn(2))).not.toBeNull();
    // AND IT IS *INSIDE* IT RATHER THAN BESIDE IT, which is the THIRD claim in
    // this test's own name and was still unobserved after round 2 fixed the
    // second (T3 round 3). jsdom has no layout, so the only thing this layer
    // can see is the thing that does the positioning: the number's wrapper is
    // stretched across the whole cell, over an icon that fills the same square.
    // **Delete that one class and every assertion above still passes** — the
    // number is still there, still white, still says 2, and there is still a
    // flame — while the number drops BELOW the fire, which is the small-number-
    // with-a-smaller-flame-under-it shape Kd sent this card back over (:32395).
    // Queried by the positioning rather than through `inside.parentElement` so
    // that wrapping the number in one more span does not quietly satisfy it.
    // Mutant C209.
    const overTheFlame = cameOn(2).querySelector('.absolute.inset-0');
    expect(overTheFlame).not.toBeNull();
    expect(overTheFlame.contains(inside)).toBe(true);
  });
});

// ── WHAT THE GYM SAID ────────────────────────────────────────────────────────
// Kd's :29961 ruling 4, arriving where it can. **Nothing in this product sends
// anything** — no mailer, no SMTP, no notifications table (measured at :29961
// §4) — so a cheer is STORED on the `/v1/orgs/mine` row and READ HERE, and the
// nav dot is the whole of its arrival.
describe('the cheer', () => {
  const cheered = (over = {}) => ({
    data: {
      orgs: [{ ...GYM, latestCheer: { preset: 'on_a_roll', sentAt: '2026-09-02T10:00:00.000Z', ...over } }],
      formerOrgs: [],
    },
  });

  it('draws the line the gym chose, and how long ago', async () => {
    api.getMine.mockResolvedValue(cheered());
    drawScreen();
    expect(await screen.findByText(/You're on a roll\./)).toBeTruthy();
    // `NOW` is 12:00 and the cheer landed at 10:00 — elapsed, never a calendar
    // word, because `sentAt` is an INSTANT read by a member wherever they are
    // (the shared contract's own reasoning).
    expect(screen.getByText('2 hours ago')).toBeTruthy();
  });

  // **IT NEVER NAMES WHO PRESSED IT** (§2.4 — a plain member is told nothing
  // about a gym's staff), and the server does not even send it:
  // `sent_by_user_id` never reaches a response. This is the client half of that
  // guarantee.
  it('says the gym cheered them and never which member of staff', async () => {
    api.getMine.mockResolvedValue(cheered());
    drawScreen();
    // POSITIVE CONTROL FIRST — :28976's vacuity class. An absence assertion
    // over a card that never rendered passes perfectly.
    expect(await screen.findByText(/You're on a roll\./)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sent by/i);
    expect(document.body.textContent).not.toMatch(/Kd Owner/);
  });

  // NOTHING INVENTED, EVER. The three absences are different — no cheer, an
  // unreadable instant, a preset this bundle has no words for — and only the
  // middle one still draws the words.
  it('draws nothing at all for a gym that has never cheered', async () => {
    api.getMine.mockResolvedValue({ data: { orgs: [{ ...GYM, latestCheer: null }], formerOrgs: [] } });
    drawScreen();
    expect(await screen.findByText('Iron House')).toBeTruthy();
    expect(screen.queryByText(/on a roll/i)).toBeNull();
    expect(screen.queryByText(/keep it going/i)).toBeNull();
  });

  it('still shows the words when it cannot say when', async () => {
    api.getMine.mockResolvedValue(cheered({ sentAt: 'not-an-instant' }));
    drawScreen();
    expect(await screen.findByText(/You're on a roll\./)).toBeTruthy();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it('draws nothing for a preset it has no words for', async () => {
    api.getMine.mockResolvedValue(cheered({ preset: 'something_new' }));
    drawScreen();
    expect(await screen.findByText('Iron House')).toBeTruthy();
    expect(screen.queryByText(/on a roll/i)).toBeNull();
  });
});

describe('the dot on the nav item', () => {
  const withCheer = (sentAt) => ({
    data: { orgs: [{ ...GYM, latestCheer: { preset: 'on_a_roll', sentAt } }], formerOrgs: [] },
  });

  // WITHOUT SOMETHING POINTING AT IT, a cheer waits on a screen nobody opens.
  // That is the whole reason this exists, and it is Kd's approved call.
  it('appears for a cheer inside the last week', async () => {
    api.getMine.mockResolvedValue(withCheer('2026-09-01T12:00:00.000Z'));
    drawSidebar();
    await waitFor(() => expect(screen.getByLabelText('New from your gym')).toBeTruthy());
  });

  // **THE POSITIVE CONTROL IS THE ITEM ITSELF.** A dot asserted absent on a
  // sidebar that never drew `My Gyms` would pass for the wrong reason
  // entirely — :28976, and the reason every absence assertion here carries its
  // opposite.
  it('goes away once the cheer is older than the cap', async () => {
    api.getMine.mockResolvedValue(withCheer('2026-08-20T12:00:00.000Z'));
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    expect(screen.queryByLabelText('New from your gym')).toBeNull();
  });

  it('is absent for a member nobody has cheered', async () => {
    api.getMine.mockResolvedValue({ data: { orgs: [{ ...GYM, latestCheer: null }], formerOrgs: [] } });
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    expect(screen.queryByLabelText('New from your gym')).toBeNull();
  });
});
