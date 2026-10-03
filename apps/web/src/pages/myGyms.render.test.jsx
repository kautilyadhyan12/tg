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
  getCheckinPass: vi.fn(),
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

/** A pass as the server sends it: 62 uppercase letters and digits. */
const PASS = `AHGP${'A2B3C4D5E6F7G8H9J2K3L4M5N6P7Q8R9S2T3U4V5W6X7Y8Z9A2B3C4D5E6F7'.slice(0, 58)}`;
const pass = () => ({ data: { pass: PASS, refreshAt: '2026-09-02T12:00:30.000Z' } });

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

const passButton = () => screen.queryByRole('button', { name: 'Show my pass' });

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
  api.getCheckinPass.mockReset().mockResolvedValue(pass());
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
  it('names the gym and offers the pass', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByText('Iron House')).toBeTruthy());
    expect(passButton()).toBeTruthy();
    expect(screen.getByText('Show your pass at the front desk when you arrive.')).toBeTruthy();
  });

  // THE TAP IS GONE FOR EVERY GYM (ROADMAP 16c), whatever the gym's old switch says.
  it.each([true, false])('draws no "I\'m here" button, with the gym\'s old switch %s', async (manualAttendanceEnabled) => {
    api.getMine.mockResolvedValue({ data: { orgs: [{ ...GYM, manualAttendanceEnabled }], formerOrgs: [] } });
    api.getAttendanceHistory.mockResolvedValue(history([visit()]));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /i'm here/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/marks your attendance/i);
    // The pass is offered either way, and the days they came stay.
    expect(passButton()).toBeTruthy();
    openDay(2);
    expect(screen.getByText('06:12')).toBeTruthy();
  });

  it('tells somebody with no gym where joining happens', async () => {
    api.getMine.mockResolvedValue({ data: { orgs: [], formerOrgs: [] } });
    drawScreen();
    await waitFor(() => expect(screen.getByText(/haven't joined a gym, studio or trainer yet/i)).toBeTruthy());
    expect(screen.getByRole('link', { name: /settings/i }).getAttribute('href')).toBe('/settings');
    // Join codes are switched off (3c): the way in is an invitation to this address.
    expect(screen.getByText(/invites the email address it has for you, and the invitation shows up in Settings → Gym\./)).toBeTruthy();
    expect(screen.queryByText(/code/i)).toBeNull();
  });

  // THE EMPTY-VS-FAILED CLASS (:8267/:8343), which this project has shipped
  // once. A dropped request must never be drawn as "you belong to no gyms".
  it('says the read failed rather than showing an empty list', async () => {
    api.getMine.mockRejectedValue(new Error('offline'));
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy());
    expect(screen.queryByText(/haven't joined a gym, studio or trainer yet/i)).toBeNull();
  });

  /** ROADMAP 2b: the member's own screens speak the type of the place they
   *  joined. The heading is over a LIST, so it follows what is in it — and
   *  the mixed case is the one that cannot be answered with any type's word. */
  it('heads the list with the word of the places actually in it', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...GYM, orgType: 'studio' }], formerOrgs: [] },
    });
    drawScreen();
    expect(await screen.findByRole('heading', { name: 'My studios' })).toBeTruthy();
  });

  it('says My trainers for a personal trainer, and My gyms for a gym', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...GYM, orgType: 'personal_trainer' }], formerOrgs: [] },
    });
    drawScreen();
    expect(await screen.findByRole('heading', { name: 'My trainers' })).toBeTruthy();
    cleanup();
    resetConsoleOrgs();
    api.getMine.mockResolvedValue({ data: { orgs: [{ ...GYM, orgType: 'gym' }], formerOrgs: [] } });
    drawScreen();
    expect(await screen.findByRole('heading', { name: 'My gyms' })).toBeTruthy();
  });

  it('uses the neutral word when the list holds two different types', async () => {
    // "My gyms" over a studio, or "My studios" over a gym, is the app being
    // wrong on screen about something the reader can see. Neither is used.
    api.getMine.mockResolvedValue({
      data: {
        orgs: [
          { ...GYM, orgType: 'gym' },
          { ...GYM, id: 'g2', name: 'Flow Studio', slug: 'flow', orgType: 'studio' },
        ],
        formerOrgs: [],
      },
    });
    drawScreen();
    expect(await screen.findByRole('heading', { name: 'My organisations' })).toBeTruthy();
  });
});

describe('the days they came', () => {
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
    api.getAttendanceHistory.mockImplementation((gymId) => Promise.resolve(history(gymId === 'g1' ? [visit()] : [])));
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(cameOn(2)).toBeTruthy());

    // Their list becomes a gym they have never been to, without the screen ever
    // leaving the list arm.
    const other = { ...GYM, id: 'g2', slug: 'bar-bell', name: 'Bar Bell Club' };
    api.getMine.mockResolvedValue({ data: { orgs: [other], formerOrgs: [] } });
    consoleOrgsRegainedFocus();

    await waitFor(() => expect(screen.getByText('Bar Bell Club')).toBeTruthy());
    expect(screen.queryByText('Iron House')).toBeNull();
    // THE FIRE DOES NOT FOLLOW THEM, and neither does the open calendar: a panel
    // reused across gyms would arrive unfolded, already reading gym B's month.
    expect(cameOn(2)).toBeNull();
    expect(screen.getByRole('button', { name: /days you came/i }).getAttribute('aria-expanded')).toBe('false');
    expect(api.getAttendanceHistory).not.toHaveBeenCalledWith('g2', expect.anything());
  });
});

// THE PASS ON THE CARD (ROADMAP 16c). What the pass itself does — renewing, failing,
// closing — is pinned in `checkinPass.render.test.jsx`; this is the card's half.
describe('the pass', () => {
  it('asks for no pass until the member opens it', async () => {
    drawScreen();
    await waitFor(() => expect(passButton()).toBeTruthy());
    expect(api.getCheckinPass).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the pass on a tap, and closes it again', async () => {
    drawScreen();
    await waitFor(() => expect(passButton()).toBeTruthy());
    fireEvent.click(passButton());
    await waitFor(() => expect(screen.getByRole('img', { name: 'Your check-in pass' })).toBeTruthy());
    expect(api.getCheckinPass).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // A scan at the desk is never refused for the hour (RULINGS 2026-09-21), so the pass
  // is offered at 05:28 to a member of a gym that opens at 07:00.
  it('is offered outside the gym’s opening hours', async () => {
    vi.setSystemTime(new Date('2026-09-03T05:28:00.000Z'));
    api.getHours.mockResolvedValue({
      data: {
        hours: {
          mode: 'scheduled',
          timezone: 'UTC',
          clockFormat: '24h',
          week: [{ weekday: 4, sessions: [{ opensMinute: 420, closesMinute: 480 }] }],
          closures: [],
        },
      },
    });
    drawScreen();
    await waitFor(() => expect(passButton()).toBeTruthy());
    expect(passButton().disabled).toBe(false);
    expect(document.body.textContent).not.toMatch(/isn't open/i);
  });

  it('opens ONE pass from the card that was tapped, for a member of two gyms', async () => {
    const other = { ...GYM, id: 'g2', slug: 'bar-bell', name: 'Bar Bell Club' };
    api.getMine.mockResolvedValue({ data: { orgs: [GYM, other], formerOrgs: [] } });
    drawScreen();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Show my pass' })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Show my pass' })[1]);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Your check-in pass' })).toHaveLength(1));
    expect(api.getCheckinPass).toHaveBeenCalledTimes(1);
  });

  // A scan while the pass was open made a visit this screen was never told about.
  it('reads the open month once more when the pass is closed, and shows the new day', async () => {
    drawScreen();
    await openCalendar();
    await waitFor(() => expect(screen.getByText(/no visits yet this month/i)).toBeTruthy());
    expect(api.getAttendanceHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(passButton());
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    api.getAttendanceHistory.mockResolvedValue(history([visit({ method: 'pass' })]));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(cameOn(2)).toBeTruthy());
    expect(api.getAttendanceHistory).toHaveBeenCalledTimes(2);
  });

  it('reads no history when the pass is closed over a calendar never opened', async () => {
    drawScreen();
    await waitFor(() => expect(passButton()).toBeTruthy());
    fireEvent.click(passButton());
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.getAttendanceHistory).not.toHaveBeenCalled();
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
    await waitFor(() => expect(passButton()).toBeTruthy());
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
  /** TWO GYMS, AND THE CHEERED ONE IS NEVER THE FIRST.
   *
   *  **T3 round 1 L-1, and it is C220's shape left standing on the member's
   *  half.** Every case here used to render ONE gym, so "this gym's cheer" and
   *  "the first gym's cheer" were the same object and no assertion could tell
   *  them apart. Measured on the shipping bytes: `latestCheer={gyms[0]?.latestCheer}`
   *  left the whole 59-test suite GREEN. What that cannot see is a member of two
   *  gyms, cheered only by Iron House, reading Iron House's message on Bar Bell
   *  Club's card.
   *
   *  `:28221` §3b in the shape a screen takes, and `:34809` §2 is the same
   *  finding one surface over — a fixture with one of something cannot see code
   *  that reaches for the wrong one. */
  const BAR_BELL = { ...GYM, id: 'g2', slug: 'bar-bell', name: 'Bar Bell Club' };

  const cheered = (over = {}) => ({
    data: {
      orgs: [
        BAR_BELL,
        { ...GYM, latestCheer: { preset: 'on_a_roll', sentAt: '2026-09-02T10:00:00.000Z', ...over } },
      ],
      formerOrgs: [],
    },
  });

  /** The card a gym's name sits in — `MyGyms` draws one `rounded-2xl` box per
   *  gym and the name is the first thing in it. */
  const cardFor = (name) => screen.getByText(name).closest('.rounded-2xl');

  it('draws the line the gym chose, and how long ago', async () => {
    api.getMine.mockResolvedValue(cheered());
    drawScreen();
    expect(await screen.findByText(/You're on a roll\./)).toBeTruthy();
    // `NOW` is 12:00 and the cheer landed at 10:00 — elapsed, never a calendar
    // word, because `sentAt` is an INSTANT read by a member wherever they are
    // (the shared contract's own reasoning).
    expect(screen.getByText('2 hours ago')).toBeTruthy();
  });

  // **WHICH CARD, WHICH IS THE ASSERTION THE ONE-GYM FIXTURE COULD NOT MAKE.**
  // Iron House cheered them; Bar Bell Club did not. A card that read the FIRST
  // gym's cheer would put Iron House's words under Bar Bell Club's name and say
  // a gym sent something it never sent — :5807, on screen and false.
  it('puts the cheer on the card of the gym that sent it, and on no other', async () => {
    api.getMine.mockResolvedValue(cheered());
    drawScreen();
    await screen.findByText('Bar Bell Club');
    expect(cardFor('Iron House').textContent).toMatch(/You're on a roll\./);
    expect(cardFor('Bar Bell Club').textContent).not.toMatch(/You're on a roll\./);
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

/** A STUDIO'S CLIENT, END TO END — roadmap 2b at the member's own screens: the REAL
 *  sidebar and the REAL screen off `/v1/orgs/mine`, so the nav label, the heading and
 *  the card's own line are read off one render. The gym is the control in the suite
 *  above this one. */
describe('a studio’s client', () => {
  const STUDIO = { ...GYM, name: 'Flow Studio', slug: 'flow-studio', orgType: 'studio' };
  // 05:28 on Thursday, the studio opens at 07:00 — Kd's own moment, one card up.
  const KDS_MOMENT = new Date('2026-09-03T05:28:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: false });
    vi.setSystemTime(KDS_MOMENT);
    api.getMine.mockResolvedValue({ data: { orgs: [STUDIO], formerOrgs: [] } });
    api.getHours.mockResolvedValue({
      data: {
        hours: {
          mode: 'scheduled',
          timezone: 'UTC',
          clockFormat: '24h',
          week: [{ weekday: 4, sessions: [{ opensMinute: 420, closesMinute: 480 }] }],
          closures: [],
        },
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sees My Studios in the nav, and never My Gyms', async () => {
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Studios')).toBeTruthy());
    expect(screen.queryByText('My Gyms')).toBeNull();
  });

  it('reads My studios over the list, and is never told they are at a gym', async () => {
    drawScreen();
    await waitFor(() => expect(passButton()).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'My studios' })).toBeTruthy();
    expect(screen.getByText('Show your pass at the front desk when you arrive.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/your gym/i);
  });

  // A personal trainer has no front desk.
  it('is told to show the pass to the TRAINER when the place is a personal trainer', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...STUDIO, name: 'Coach Priya', orgType: 'personal_trainer' }], formerOrgs: [] },
    });
    drawScreen();
    await waitFor(() => expect(screen.getByText('Show your pass to your trainer when you arrive.')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'My trainers' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/front desk/i);
  });
});

describe('the dot on the nav item', () => {
  const withCheer = (sentAt) => ({
    data: { orgs: [{ ...GYM, latestCheer: { preset: 'on_a_roll', sentAt } }], formerOrgs: [] },
  });

  // WITHOUT SOMETHING POINTING AT IT, a cheer waits on a screen nobody opens.
  // That is the whole reason this exists, and it is Kd's approved call.
  // **THREE HOURS AND NOT A DAY.** This said `2026-09-01T12:00` — EXACTLY
  // twenty-four hours before this suite's faked `NOW`, so it sat inside the old
  // seven-day window and lands precisely ON the boundary of the one-day one Kd
  // ruled at :35762. It went RED on the fix, which is the fixture doing its job.
  it('appears for a cheer inside the cap', async () => {
    api.getMine.mockResolvedValue(withCheer('2026-09-02T09:00:00.000Z'));
    drawSidebar();
    await waitFor(() => expect(screen.getByLabelText('New message')).toBeTruthy());
  });

  // **THE POSITIVE CONTROL IS THE ITEM ITSELF.** A dot asserted absent on a
  // sidebar that never drew `My Gyms` would pass for the wrong reason
  // entirely — :28976, and the reason every absence assertion here carries its
  // opposite.
  // **TWO DAYS OLD, NOT THIRTEEN — and the distance is the point.** Thirteen
  // days was outside the old seven-day window as well, so this case could not
  // tell the cap Kd replaced from the cap he ruled (:35762); two days is
  // outside one and inside seven, so the screen half now observes the change
  // the pure half does (:20712 — a fixture where the defect and the fix look
  // alike proves neither).
  it('goes away once the cheer is older than the cap', async () => {
    api.getMine.mockResolvedValue(withCheer('2026-08-31T12:00:00.000Z'));
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    expect(screen.queryByLabelText('New message')).toBeNull();
  });

  it('is absent for a member nobody has cheered', async () => {
    api.getMine.mockResolvedValue({ data: { orgs: [{ ...GYM, latestCheer: null }], formerOrgs: [] } });
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    expect(screen.queryByLabelText('New message')).toBeNull();
  });
});
