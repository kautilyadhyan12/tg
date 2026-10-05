// THE CALENDAR TAB, AT THE SCREEN. ROADMAP 17b-ii-b-i, 17b-ii-w; Part 3 §13.3, §13.6.
//
// Only the network is mocked. The mutation cases assert what goes on the wire
// and what the screen draws from the server's answer — never only that a
// button was pressed.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

const api = {
  getMine: vi.fn(),
  getClasses: vi.fn(),
  getStaff: vi.fn(),
  getClassWeek: vi.fn(),
  getClassBookings: vi.fn(),
  changeClassDay: vi.fn(),
  cancelClassDay: vi.fn(),
  restoreClassDay: vi.fn(),
};
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  // The real `errorText`: the server's own sentence must reach the screen.
  return { ...actual, orgService: api };
});
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Kd' }, logout: vi.fn(), loading: false }),
}));

const Classes = (await import('./Classes')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'schedule.manage', 'org.manage', 'staff.manage'],
  timezone: 'Europe/London',
  clockFormat: '24h',
  orgType: 'gym',
  subscription: { status: 'trialing' },
};

const day = (over) => ({
  id: 'x1',
  classTypeId: 't1',
  scheduleId: 's1',
  name: 'Spin',
  colour: 'teal',
  openGym: false,
  localDate: '2026-09-22',
  startMinute: 1080,
  startsAt: '2026-09-22T17:00:00.000Z',
  minutes: 45,
  places: 12,
  coachUserId: 'u8',
  coachName: 'Dana Okafor',
  status: 'scheduled',
  changedAlone: false,
  started: false,
  ...over,
});

const SPIN_TUE = day({});
const BOOKED = {
  response: {
    status: 409,
    data: {
      error: 'class_has_bookings',
      ending: {
        classes: 1,
        booked: 2,
        waiting: 1,
        people: [
          { id: '00000000-0000-4000-8000-000000000001', name: 'Asha Rao', initials: 'AR', waiting: false, className: 'Spin', localDate: '2026-09-22', localStartMinute: 1080 },
          { id: '00000000-0000-4000-8000-000000000002', name: 'Ben Okoro', initials: 'BO', waiting: false, className: 'Spin', localDate: '2026-09-22', localStartMinute: 1080 },
          { id: '00000000-0000-4000-8000-000000000003', name: 'Cy Diaz', initials: 'CD', waiting: true, className: 'Spin', localDate: '2026-09-22', localStartMinute: 1080 },
        ],
      },
    },
  },
};
const YOGA_WED = day({
  id: 'x2',
  classTypeId: 't2',
  scheduleId: 's2',
  name: 'Yoga',
  colour: 'blue',
  localDate: '2026-09-23',
  startMinute: 420,
  minutes: 60,
  places: null,
  coachUserId: null,
  coachName: null,
  status: 'cancelled',
});
const SPIN_FRI = day({ id: 'x3', localDate: '2026-09-25', startMinute: 1170, minutes: 90, places: 8, changedAlone: true });
const SPIN_MON = day({ id: 'x0', localDate: '2026-09-21', started: true });

const person = (n, name, over = {}) => ({
  bookingId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  name,
  initials: '',
  status: 'booked',
  membership: null,
  packCharged: null,
  at: '2026-09-20T09:00:00.000Z',
  ...over,
});
const bookings = (over = {}) => ({
  data: {
    sessionId: '00000000-0000-4000-8000-0000000000aa',
    className: 'Spin',
    startsAt: '2026-09-22T17:00:00.000Z',
    cancelled: false,
    places: 12,
    booked: [],
    waitlisted: [],
    lateCancelled: [],
    lateCancelledTotal: 0,
    ...over,
  },
});

const week = (over = {}) => ({
  data: {
    timezone: 'Europe/London',
    clockFormat: '24h',
    today: '2026-09-22',
    weekStart: '2026-09-21',
    lastWeekStart: '2026-11-09',
    sessions: [SPIN_MON, SPIN_TUE, YOGA_WED, SPIN_FRI],
    ...over,
  },
});

const timetable = () => ({
  data: {
    timezone: 'Europe/London',
    clockFormat: '24h',
    horizonDays: 56,
    entries: [],
    archived: [],
    archivedTotal: 0,
  },
});

beforeEach(() => {
  resetConsoleOrgs();
  api.getMine.mockReset().mockResolvedValue({ data: { orgs: [ORG], formerOrgs: [] } });
  api.getClasses.mockReset().mockResolvedValue(timetable());
  api.getStaff.mockReset().mockResolvedValue({
    data: { staff: [{ userId: 'u8', displayName: 'Dana Okafor', email: 'd@example.com', role: 'trainer' }] },
  });
  api.getClassWeek.mockReset().mockResolvedValue(week());
  api.getClassBookings.mockReset().mockResolvedValue(bookings());
  api.changeClassDay.mockReset().mockResolvedValue(week());
  api.cancelClassDay.mockReset().mockResolvedValue(week());
  api.restoreClassDay.mockReset().mockResolvedValue(week());
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
});

let lastSearch = '';
function Where() {
  lastSearch = useLocation().search;
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      browser back
    </button>
  );
}

const draw = (path = '/console/iron-house/classes?view=week', history = [path]) =>
  render(
    <MemoryRouter initialEntries={history} initialIndex={history.length - 1}>
      <Routes>
        <Route
          path="/console/:orgSlug/classes"
          element={
            <>
              <Classes />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const openDay = async (label) => {
  fireEvent.click(await screen.findByRole('button', { name: label }));
};

// THE WORST THING THIS SCREEN'S WORDS COULD DO (17b-ii-w): a class cancelled
// for its members by a tap that read "Close", or cancelled without a question.
describe('closing and backing out never change a class', () => {
  it('Close, the X and Keep it send nothing; only the second Cancel class cancels', async () => {
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    expect(screen.getByText('Cancel Spin on Tue 22 Sep 2026 at 18:00?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    fireEvent.click(screen.getByRole('button', { name: 'Close this class' }));

    expect(api.changeClassDay).not.toHaveBeenCalled();
    expect(api.cancelClassDay).not.toHaveBeenCalled();
    expect(api.restoreClassDay).not.toHaveBeenCalled();

    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    expect(api.cancelClassDay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    await waitFor(() => expect(api.cancelClassDay).toHaveBeenCalledWith('g1', 'x1'));
  });
});

// WHO IS BOOKED (17c-iii). The worst this list could do: draw one class's people under
// another class, or word somebody waiting as booked.
describe('a class on the Calendar opens who is booked on it', () => {
  it('lists who is booked, the waitlist in its order and the late cancels, each under its own heading', async () => {
    api.getClassBookings.mockResolvedValue(
      bookings({
        booked: [
          person(1, 'Maya Shah', { membership: 'Gold Monthly', packCharged: false }),
          person(2, 'Leo Grant', { membership: '10 classes', packCharged: true }),
          person(3, null),
        ],
        waitlisted: [person(4, 'Tom Reed', { status: 'waitlisted' }), person(5, 'Sara Cole', { status: 'waitlisted' })],
        lateCancelled: [person(6, 'Ana Diaz', { status: 'late_cancelled' })],
        lateCancelledTotal: 1,
      }),
    );
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    const list = within(await screen.findByTestId('class-bookings'));
    expect(api.getClassBookings).toHaveBeenCalledWith('g1', 'x1');
    const groups = list.getAllByRole('list').map((ol) => within(ol).getAllByRole('listitem').map((li) => li.textContent));
    expect(list.getByText('Booked · 3 of 12 places')).toBeTruthy();
    expect(list.getByText('Waitlist · 2')).toBeTruthy();
    expect(list.getByText('Cancelled late · 1')).toBeTruthy();
    expect(groups).toEqual([
      ['Maya ShahGold Monthly', 'Leo Grant10 classes · 1 class used from this pack', 'No name'],
      ['1.Tom Reed', '2.Sara Cole'],
      ['Ana Diaz'],
    ]);
  });

  it("another class opened while the first one's list is still on its way never shows the first one's people", async () => {
    let answerSpin;
    api.getClassBookings.mockImplementation((_gym, id) =>
      id === 'x1'
        ? new Promise((resolve) => {
            answerSpin = resolve;
          })
        : Promise.resolve(bookings({ booked: [person(7, 'Friday Person')], places: 8 })),
    );
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    await waitFor(() => expect(answerSpin).toBeTypeOf('function'));
    await openDay('Spin on Fri 25 Sep 2026 at 19:30, changed');
    expect(await screen.findByText('Friday Person')).toBeTruthy();
    answerSpin(bookings({ booked: [person(1, 'Tuesday Person')] }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Tuesday Person')).toBeNull();
    expect(screen.getByText('Booked · 1 of 8 places')).toBeTruthy();
  });

  it('says so when nobody has booked, and a class with no limit counts people without "places"', async () => {
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    expect(await screen.findByText('Nobody has booked this class yet.')).toBeTruthy();
    cleanup();
    resetConsoleOrgs();
    api.getClassBookings.mockResolvedValue(bookings({ places: null, booked: [person(1, 'Maya Shah')] }));
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    expect(await screen.findByText('Booked · 1')).toBeTruthy();
  });

  it('staff the server refuses are told who can see the list, and a cancelled class asks for none', async () => {
    api.getClassBookings.mockRejectedValue({ response: { status: 403, data: { error: 'forbidden', message: "Your role doesn't allow that." } } });
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    expect((await screen.findByTestId('class-bookings-refused')).textContent).toBe('Only this class’s coach and staff who can change classes see who is booked.');
    api.getClassBookings.mockClear();
    await openDay('Yoga on Wed 23 Sep 2026 at 07:00, cancelled');
    await screen.findByRole('button', { name: 'Un-cancel' });
    expect(api.getClassBookings).not.toHaveBeenCalled();
    expect(screen.queryByTestId('class-bookings')).toBeNull();
  });

  it('reads the list again after a save, since a bigger class takes people in from the waitlist', async () => {
    api.getClassBookings.mockResolvedValueOnce(bookings({ booked: [person(1, 'Maya Shah')], waitlisted: [person(4, 'Tom Reed', { status: 'waitlisted' })], places: 1 }));
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    expect(await screen.findByText('Waitlist · 1')).toBeTruthy();
    api.getClassBookings.mockResolvedValueOnce(bookings({ booked: [person(1, 'Maya Shah'), person(4, 'Tom Reed')], places: 12 }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Booked · 2 of 12 places')).toBeTruthy();
    expect(screen.queryByText('Waitlist · 1')).toBeNull();
    expect(api.getClassBookings).toHaveBeenCalledTimes(2);
  });
});

describe('the Calendar tab', () => {
  it('opens from the Classes list, reads the gym s current week, and keeps the tab in the address', async () => {
    draw('/console/iron-house/classes');
    fireEvent.click(await screen.findByRole('tab', { name: 'Calendar' }));
    await screen.findByText('21 – 27 Sep 2026');
    expect(api.getClassWeek).toHaveBeenCalledWith('g1', null);
    expect(lastSearch).toBe('?view=week');
  });

  it('draws each day with its classes, in the gym s own words', async () => {
    draw();
    await screen.findByText('21 – 27 Sep 2026');
    expect(screen.getByText('Tue 22 Sep · Today')).toBeTruthy();
    expect(screen.getByText('Sun 27 Sep')).toBeTruthy();
    const tuesday = screen.getByRole('button', { name: 'Spin on Tue 22 Sep 2026 at 18:00' });
    expect(within(tuesday).getByText('18:00–18:45')).toBeTruthy();
    expect(within(tuesday).getByText('12 places · Dana Okafor')).toBeTruthy();
    const wednesday = screen.getByRole('button', { name: 'Yoga on Wed 23 Sep 2026 at 07:00, cancelled' });
    expect(within(wednesday).getByText('Cancelled')).toBeTruthy();
    expect(within(wednesday).getByText('No limit')).toBeTruthy();
    const friday = screen.getByRole('button', {
      name: 'Spin on Fri 25 Sep 2026 at 19:30, changed',
    });
    expect(within(friday).getByText('Changed')).toBeTruthy();
  });

  it('steps between weeks, and never past the last week the server says is written', async () => {
    draw();
    await screen.findByText('21 – 27 Sep 2026');
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();

    api.getClassWeek.mockResolvedValueOnce(
      week({ weekStart: '2026-09-14', sessions: [] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Week before' }));
    await screen.findByText('14 – 20 Sep 2026');
    expect(api.getClassWeek).toHaveBeenLastCalledWith('g1', '2026-09-14');
    expect(screen.getByText('No classes this week.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();

    api.getClassWeek.mockResolvedValueOnce(week({ weekStart: '2026-11-09', sessions: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Week after' }));
    await screen.findByText('9 – 15 Nov 2026');
    expect(screen.getByRole('button', { name: 'Week after' }).disabled).toBe(true);
  });

  it('filters by class and by coach, including classes with nobody named', async () => {
    draw();
    await screen.findByText('21 – 27 Sep 2026');
    fireEvent.change(screen.getByRole('combobox', { name: 'Show which class' }), {
      target: { value: 't2' },
    });
    expect(screen.queryByRole('button', { name: /^Spin on/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Yoga on/ })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Show which class' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Show which coach' }), {
      target: { value: 'none' },
    });
    expect(screen.queryByRole('button', { name: /^Spin on/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Yoga on/ })).toBeTruthy();
  });
});

describe('one class on one date', () => {
  it('Cancel class asks first, sends the date, and then offers Un-cancel', async () => {
    api.cancelClassDay.mockResolvedValue(
      week({ sessions: [SPIN_MON, { ...SPIN_TUE, status: 'cancelled' }, YOGA_WED, SPIN_FRI] }),
    );
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    expect(api.cancelClassDay).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Cancel Spin on Tue 22 Sep 2026 at 18:00?',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    await waitFor(() => expect(api.cancelClassDay).toHaveBeenCalledWith('g1', 'x1'));
    expect(await screen.findByRole('button', { name: 'Un-cancel' })).toBeTruthy();
  });

  // 17c-ii-a: people booked on the class are named before it is cancelled.
  it('Cancel class with people booked: the box names them, Keep it cancels nothing, and its button sends their number', async () => {
    api.cancelClassDay.mockRejectedValueOnce(BOOKED).mockRejectedValueOnce(BOOKED);
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    expect(await screen.findByText('2 people are booked and 1 is on the waitlist')).toBeTruthy();
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('Spin · Tue 22 Sep · 18:00 · On the waitlist')).toBeTruthy();
    expect(screen.getByText("Nobody else's bookings change.")).toBeTruthy();
    // A question, not a failure, and the first request confirmed nothing.
    expect(screen.queryByText("We couldn't save that.")).toBeNull();
    expect(api.cancelClassDay.mock.calls).toEqual([['g1', 'x1']]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByText('2 people are booked and 1 is on the waitlist')).toBeNull();
    expect(api.cancelClassDay).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancel class' })).toBeTruthy();

    api.cancelClassDay.mockResolvedValue(week({ sessions: [SPIN_MON, { ...SPIN_TUE, status: 'cancelled' }, YOGA_WED, SPIN_FRI] }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel class and end 3 bookings' }));
    await waitFor(() => expect(api.cancelClassDay).toHaveBeenLastCalledWith('g1', 'x1', 3));
    expect(await screen.findByRole('button', { name: 'Un-cancel' })).toBeTruthy();
  });

  it('a move from this date with people booked: the box says who keeps their booking, and its button sends their number', async () => {
    api.changeClassDay.mockRejectedValueOnce(BOOKED);
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'This and future classes' }));
    fireEvent.change(screen.getByLabelText('Start time hour'), { target: { value: '19' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('2 people are booked and 1 is on the waitlist')).toBeTruthy();
    expect(screen.getByText("Bookings for classes before Tue 22 Sep don't change.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    // Changing the form takes the box away: it was about the old answer.
    fireEvent.change(screen.getByLabelText('Start time hour'), { target: { value: '20' } });
    expect(screen.queryByText('2 people are booked and 1 is on the waitlist')).toBeNull();

    api.changeClassDay.mockRejectedValueOnce(BOOKED);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move time slot and end 3 bookings' }));
    await waitFor(() => expect(api.changeClassDay).toHaveBeenCalledTimes(3));
    expect(api.changeClassDay.mock.calls[2][2]).toEqual({
      scope: 'future',
      startMinute: 1200,
      minutes: 45,
      places: 12,
      coachUserId: 'u8',
      confirmBookings: 3,
    });
  });

  it('Un-cancel is one tap', async () => {
    draw();
    await openDay('Yoga on Wed 23 Sep 2026 at 07:00, cancelled');
    fireEvent.click(screen.getByRole('button', { name: 'Un-cancel' }));
    await waitFor(() => expect(api.restoreClassDay).toHaveBeenCalledWith('g1', 'x2'));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('Edit starts from that date s own numbers and sends all four', async () => {
    draw();
    await openDay('Spin on Fri 25 Sep 2026 at 19:30, changed');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Kd, at the click-through: "there is no hour" — the boxes now say which is which.
    expect(screen.getByLabelText('Start time hour').value).toBe('19');
    expect(screen.getByText('Hour')).toBeTruthy();
    expect(screen.getByText('Minute')).toBeTruthy();
    expect(screen.getByLabelText('Length (minutes)').value).toBe('90');
    expect(screen.getByLabelText('Class size').value).toBe('8');
    expect(screen.getByLabelText('Coach (optional)').value).toBe('u8');

    fireEvent.change(screen.getByLabelText('Class size'), { target: { value: '15' } });
    fireEvent.click(screen.getByLabelText('No limit'));
    fireEvent.change(screen.getByLabelText('Coach (optional)'), { target: { value: '' } });
    // "This class only" unless the gym picks otherwise.
    expect(screen.getByRole('button', { name: 'This class only' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.changeClassDay).toHaveBeenCalled());
    expect(api.changeClassDay).toHaveBeenCalledWith('g1', 'x3', {
      scope: 'this',
      startMinute: 1170,
      minutes: 90,
      places: null,
      coachUserId: null,
    });
  });

  // 17b-ii-b-ii: the same form changes its time slot from this date.
  it('This and future classes sends the time slot s change from this date', async () => {
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'This and future classes' }));
    expect(screen.getByRole('button', { name: 'This and future classes' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.change(screen.getByLabelText('Coach (optional)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.changeClassDay).toHaveBeenCalled());
    expect(api.changeClassDay).toHaveBeenCalledWith('g1', 'x1', {
      scope: 'future',
      startMinute: 1080,
      minutes: 45,
      places: 12,
      coachUserId: null,
    });
  });

  it('asks before a move from this date replaces classes changed on their own: Go back sends nothing more, Move anyway sends the count', async () => {
    const asked = { response: { status: 409, data: { error: 'class_slot_replaces', replaces: 3 } } };
    api.changeClassDay.mockRejectedValueOnce(asked);
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'This and future classes' }));
    fireEvent.change(screen.getByLabelText('Start time hour'), { target: { value: '19' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        /^3 classes from Tue.22.Sep on were changed or cancelled on their own\. Move anyway\?$/,
      ),
    ).toBeTruthy();
    // A question, not a failure: no error line, and the week is not re-read.
    expect(screen.queryByText("We couldn't save that.")).toBeNull();
    expect(api.getClassWeek).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByText(/Move anyway\?/)).toBeNull();
    expect(api.changeClassDay).toHaveBeenCalledTimes(1);

    api.changeClassDay.mockRejectedValueOnce(asked);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Move anyway\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Move anyway' }));
    await waitFor(() => expect(api.changeClassDay).toHaveBeenCalledTimes(3));
    expect(api.changeClassDay.mock.calls[2][2]).toEqual({
      scope: 'future',
      startMinute: 1140,
      minutes: 45,
      places: 12,
      coachUserId: 'u8',
      confirmReplace: 3,
    });
  });

  it('a date with no time slot behind it offers This class only and nothing else', async () => {
    api.getClassWeek.mockResolvedValue(week({ sessions: [{ ...SPIN_TUE, scheduleId: null }] }));
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('button', { name: 'This and future classes' })).toBeNull();
  });

  it('a class that has already started offers nothing to press', async () => {
    draw();
    await openDay('Spin on Mon 21 Sep 2026 at 18:00');
    expect(screen.getByText("This class has started, so it can't be changed.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel class' })).toBeNull();
  });

  it('a gym with no live plan sees its week and nothing to press', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, consoleReadOnly: true }], formerOrgs: [] },
    });
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel class' })).toBeNull();
  });

  it('a refusal says the server s own sentence, and the week is read again', async () => {
    const sentence = "This class has already started, so it can't be changed now.";
    api.cancelClassDay.mockRejectedValue({
      response: { status: 409, data: { error: 'class_started', message: sentence, requestId: 'r' } },
    });
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    // The fresh week says it has started; the open day follows it.
    api.getClassWeek.mockResolvedValueOnce(
      week({ sessions: [SPIN_MON, { ...SPIN_TUE, started: true }, YOGA_WED, SPIN_FRI] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }));
    expect(await screen.findByText(sentence)).toBeTruthy();
    await waitFor(() => expect(api.getClassWeek).toHaveBeenLastCalledWith('g1', '2026-09-21'));
    expect(
      await screen.findByText("This class has started, so it can't be changed."),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel class' })).toBeNull();
  });

  it('coming back to the list with the browser s Back reads the timetable again', async () => {
    draw('/console/iron-house/classes?view=week', [
      '/console/iron-house/classes',
      '/console/iron-house/classes?view=week',
    ]);
    await screen.findByText('21 – 27 Sep 2026');
    const before = api.getClasses.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'browser back' }));
    await waitFor(() => expect(api.getClasses.mock.calls.length).toBe(before + 1));
    expect(lastSearch).toBe('');
  });

  it('going back to the Classes list reads the timetable again', async () => {
    draw();
    await screen.findByText('21 – 27 Sep 2026');
    const before = api.getClasses.mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: 'Classes' }));
    await waitFor(() => expect(api.getClasses.mock.calls.length).toBe(before + 1));
    expect(lastSearch).toBe('');
  });
});
