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
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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
const { resetConsoleOrgs } = await import('./console/consoleOrgs');

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

beforeEach(() => {
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
    await waitFor(() => expect(screen.getByText('Days you came')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /i'm here/i })).toBeNull();
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
    await waitFor(() => expect(screen.getByText(/haven't marked yourself in here yet/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText('Wed 2 Sep 2026')).toBeTruthy());
    expect(screen.getByText('06:12')).toBeTruthy();
    expect(api.getAttendanceHistory).toHaveBeenCalledTimes(1);
  });

  // :28221's IDEMPOTENCE AT THE SCREEN. A second tap in the same session
  // answers with the FIRST visit — so the screen must not draw a second time
  // chip for it, which would be a count the database disagrees with.
  it('draws ONE time when the same session is tapped twice', async () => {
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText('06:12')).toBeTruthy());
    api.markAttendance.mockResolvedValue(marked({ alreadyMarked: true }));
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText(/already marked in/i)).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText('17:40')).toBeTruthy());
    expect(screen.getByText('06:12')).toBeTruthy();
    expect(screen.getAllByText('Wed 2 Sep 2026')).toHaveLength(1);
  });

  // A FAILED HISTORY READ DRAWS NOTHING — never "you haven't been here yet",
  // which is this app telling somebody their own past is empty because a
  // request dropped.
  it('says nothing about the history when the read failed', async () => {
    api.getAttendanceHistory.mockRejectedValue(new Error('offline'));
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    expect(screen.queryByText(/haven't marked yourself in here yet/i)).toBeNull();
    expect(screen.queryByText('Days you came')).toBeNull();
  });

  it('prints the refusal when the server turns the mark down', async () => {
    api.markAttendance.mockRejectedValue(new Error('409'));
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText(/couldn't record that just now/i)).toBeTruthy());
  });
});
