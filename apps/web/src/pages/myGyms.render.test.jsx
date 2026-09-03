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
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    // The tap is confirmed — that part is true and stays on screen …
    await waitFor(() => expect(screen.getByText(/you're marked in/i)).toBeTruthy());
    // … and the list it says nothing about is not drawn at all.
    expect(screen.queryByText('Days you came')).toBeNull();
    expect(screen.queryByText('Wed 2 Sep 2026')).toBeNull();
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
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText(/you're marked in/i)).toBeTruthy());
    // The read — which left before the tap and therefore knows nothing of it —
    // now comes back empty.
    answerTheRead();
    await waitFor(() => expect(screen.getByText('Days you came')).toBeTruthy());
    expect(screen.getByText('06:12')).toBeTruthy();
    expect(screen.queryByText(/haven't marked yourself in here yet/i)).toBeNull();
  });

  it('draws the visit once when the read comes back already carrying it', async () => {
    let answerTheRead = () => {};
    api.getAttendanceHistory.mockReturnValue(
      new Promise((resolve) => {
        answerTheRead = () => resolve(history([visit()]));
      }),
    );
    drawScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText(/you're marked in/i)).toBeTruthy());
    answerTheRead();
    await waitFor(() => expect(screen.getByText('Days you came')).toBeTruthy());
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
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));

    await waitFor(() => expect(screen.getByText('6:12 AM')).toBeTruthy());
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
    await waitFor(() => expect(screen.getByRole('button', { name: /i'm here/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /i'm here/i }));
    await waitFor(() => expect(screen.getByText('06:12')).toBeTruthy());

    // Their list becomes a gym they have never marked in at, without the screen
    // ever leaving the list arm.
    const other = { ...GYM, id: 'g2', slug: 'bar-bell', name: 'Bar Bell Club' };
    api.getMine.mockResolvedValue({ data: { orgs: [other], formerOrgs: [] } });
    consoleOrgsRegainedFocus();

    await waitFor(() => expect(screen.getByText('Bar Bell Club')).toBeTruthy());
    expect(screen.queryByText('Iron House')).toBeNull();
    expect(screen.queryByText('06:12')).toBeNull();
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
    await waitFor(() => expect(screen.getByText('Days you came')).toBeTruthy());
    expect(screen.queryByText('Attendance')).toBeNull();
    expect(screen.queryByText(/marks your attendance at the gym/i)).toBeNull();
    expect(screen.getByText('06:12')).toBeTruthy();
  });
});
