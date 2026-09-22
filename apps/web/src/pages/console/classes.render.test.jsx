// THE CLASSES SCREEN, AT THE SCREEN. ROADMAP 17b-i; Part 3 §13.3.
//
// RENDER ASSERTIONS RATHER THAN SOURCE GREPS, for the reason the attendance
// suite records: a grep is satisfied by spelling a thing differently, and what
// is pinned here is what an OWNER sees — a nav item that appears only with the
// privilege, the dates the SERVER wrote, and what actually goes on the wire when
// they press Save.
//
// **THE STORE IS REAL AND ONLY THE NETWORK IS MOCKED**, matching
// `consoleAttendance.render`: the nav gate reads `schedule.manage` out of the
// same kept answer the screen resolves its gym from, exactly as in the browser.
//
// **THE MUTATION CASES ASSERT THE BODY, NOT THE BUTTON.** A test that only
// checked a call happened would stay green if the screen sent the gym's places
// as a string, or dropped `places: null` on the floor — and both put a number on
// a calendar that nobody typed, which is this card's own worst thing one screen
// removed.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = {
  getMine: vi.fn(),
  getClasses: vi.fn(),
  createClass: vi.fn(),
  updateClass: vi.fn(),
  archiveClass: vi.fn(),
  addClassRepeat: vi.fn(),
  stopClassRepeat: vi.fn(),
  getStaff: vi.fn(),
};
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: api, errorText: (_err, fallback) => fallback };
});
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Kd' }, logout: vi.fn(), loading: false }),
}));

const Classes = (await import('./Classes')).default;
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
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

const YOGA = {
  id: 't1',
  name: 'Sunrise Yoga',
  description: 'Bring a mat.',
  minutes: 60,
  places: 20,
  coachUserId: 'u9',
  coachName: 'Priya Sharma',
  colour: 'blue',
  openGym: false,
  archivedAt: null,
};

const REPEAT = {
  id: 's1',
  classTypeId: 't1',
  weekdays: [1, 3],
  startMinute: 1110,
  startsOn: '2026-09-21',
  endsOn: null,
  nextDates: ['2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30'],
  sessionsAhead: 16,
};

const timetable = (over = {}) => ({
  data: {
    timezone: 'Europe/London',
    clockFormat: '24h',
    horizonDays: 56,
    entries: [{ type: YOGA, schedules: [REPEAT] }],
    archived: [],
    ...over,
  },
});

beforeEach(() => {
  resetConsoleOrgs();
  api.getMine.mockReset().mockResolvedValue({ data: { orgs: [ORG], formerOrgs: [] } });
  api.getClasses.mockReset().mockResolvedValue(timetable());
  api.createClass.mockReset().mockResolvedValue(timetable());
  api.updateClass.mockReset().mockResolvedValue(timetable());
  api.archiveClass.mockReset().mockResolvedValue(timetable({ entries: [], archived: [YOGA] }));
  api.addClassRepeat.mockReset().mockResolvedValue(timetable());
  api.stopClassRepeat.mockReset().mockResolvedValue(timetable({ entries: [{ type: YOGA, schedules: [] }] }));
  api.getStaff.mockReset().mockResolvedValue({
    data: { staff: [{ userId: 'u9', displayName: 'Priya Sharma', email: 'p@example.com', role: 'trainer' }] },
  });
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
});

const drawScreen = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/classes']}>
      <Routes>
        <Route path="/console/:orgSlug/classes" element={<Classes />} />
      </Routes>
    </MemoryRouter>,
  );

const drawShell = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/classes']}>
      <Routes>
        <Route
          path="/console/:orgSlug/classes"
          element={<ConsoleLayout><div>screen</div></ConsoleLayout>}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('the nav item', () => {
  it('appears in the console rail for somebody holding the privilege', async () => {
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Classes').length).toBeGreaterThan(0));
  });

  // :11429's SEAM AT THE SCREEN. The tab asks for the POWER, not the job title:
  // an owner may tick `schedule.manage` away from a manager, and a screen
  // reading the role would go on drawing a tab the server refuses.
  it('is absent for staff whose owner unticked it, even though they are staff', async () => {
    api.getMine.mockResolvedValue({
      data: {
        orgs: [{ ...ORG, staffRole: 'manager', privileges: ['members.read', 'attendance.read'] }],
        formerOrgs: [],
      },
    });
    drawShell();
    // Waited on a tab this staffer DOES hold, not on a timeout: a bare
    // `queryByText(...).toBeNull()` would pass before the org row had even
    // arrived, which is a test that proves nothing.
    await waitFor(() => expect(screen.getAllByText('Members').length).toBeGreaterThan(0));
    expect(screen.queryByText('Classes')).toBeNull();
  });
});

describe('reading the timetable', () => {
  it('says which clock the times are on, so nobody reads their own', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByText(/times are Europe\/London/)).toBeTruthy();
    expect(screen.getByText(/8 weeks ahead/)).toBeTruthy();
  });

  it('draws the class, its numbers and its coach', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByText('60 min · 20 places · Priya Sharma')).toBeTruthy();
    expect(screen.getByText('Bring a mat.')).toBeTruthy();
  });

  // **THE DATES ARE THE SERVER'S.** This is the case that would go green on a
  // screen that worked them out itself, so the fixture's dates are deliberately
  // NOT the ones "Mondays and Wednesdays from today" would produce.
  it('reads the repeat and its dates off the wire, and never recomputes them', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByText('Mon & Wed at 18:30')).toBeTruthy();
    expect(screen.getByText(/16 dates on the calendar/)).toBeTruthy();
    expect(
      screen.getByText('Next: Mon 21 Sep 2026 · Wed 23 Sep 2026 · Mon 28 Sep 2026 · Wed 30 Sep 2026 · +12 more'),
    ).toBeTruthy();
  });

  // A gym reading on a 12-hour clock reads ITS OWN clock, not the browser's
  // locale and not the other gym's.
  it('reads the time on the gym s own clock', async () => {
    api.getClasses.mockResolvedValue(timetable({ clockFormat: '12h' }));
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByText('Mon & Wed at 6:30 PM')).toBeTruthy();
  });

  // THE EMPTY ARM AND THE FAILED ARM ARE DIFFERENT SCREENS. An unreadable page
  // drawn as an empty one tells a gym with a full timetable that it has none.
  it('tells a gym with no classes what to do, and a gym whose read failed that it failed', async () => {
    api.getClasses.mockResolvedValue(timetable({ entries: [] }));
    drawScreen();
    await screen.findByText(/haven't added any classes yet/);
    cleanup();

    api.getClasses.mockRejectedValue(new Error('down'));
    drawScreen();
    await screen.findByText("We couldn't load your timetable.");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(/haven't added any classes yet/)).toBeNull();
  });

  it('says so when a repeat has no dates, rather than looking blank', async () => {
    api.getClasses.mockResolvedValue(
      timetable({
        entries: [
          { type: YOGA, schedules: [{ ...REPEAT, nextDates: [], sessionsAhead: 0 }] },
        ],
      }),
    );
    drawScreen();
    await screen.findByText('No dates yet.');
    expect(screen.getByText(/Nothing on the calendar yet/)).toBeTruthy();
  });
});

describe('adding a class', () => {
  const openAddForm = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /Add a class/ }));
    return screen.findByRole('button', { name: /Add this class/ });
  };

  it('sends what the gym typed, as numbers, with the colour it picked', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const save = await openAddForm();

    fireEvent.change(screen.getByPlaceholderText('Sunrise Yoga'), { target: { value: 'Spin' } });
    fireEvent.change(screen.getByLabelText('How long (minutes)'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('How many people fit'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'red' }));
    fireEvent.click(save);

    await waitFor(() => expect(api.createClass).toHaveBeenCalledTimes(1));
    expect(api.createClass.mock.calls[0][1]).toEqual({
      name: 'Spin',
      description: '',
      minutes: 45,
      places: 12,
      coachUserId: null,
      colour: 'red',
      openGym: false,
    });
  });

  // **`places: null` ON THE WIRE, and this is the case that stops an open-gym
  // slot silently keeping a cap.** The route REPLACES rather than merges, so an
  // omitted key and an explicit null are not the same thing.
  it('sends no limit as an explicit null for an open-gym slot', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const save = await openAddForm();

    fireEvent.change(screen.getByPlaceholderText('Sunrise Yoga'), { target: { value: 'Open Gym' } });
    fireEvent.click(screen.getByLabelText('No limit'));
    fireEvent.click(screen.getByLabelText('This is open gym, not a taught class'));
    fireEvent.click(save);

    await waitFor(() => expect(api.createClass).toHaveBeenCalledTimes(1));
    const body = api.createClass.mock.calls[0][1];
    expect(body.places).toBeNull();
    expect('places' in body).toBe(true);
    expect(body.openGym).toBe(true);
  });

  it('will not send a class the server would refuse, and says why', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const save = await openAddForm();
    // Empty name: the button is dead and the sentence is on screen.
    expect(screen.getByText('Give the class a name.')).toBeTruthy();
    fireEvent.click(save);
    expect(api.createClass).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Sunrise Yoga'), { target: { value: 'Spin' } });
    fireEvent.change(screen.getByLabelText('How long (minutes)'), { target: { value: '4' } });
    expect(screen.getByText(/5 minutes to 10 hours/)).toBeTruthy();
    fireEvent.click(save);
    expect(api.createClass).not.toHaveBeenCalled();
  });

  it('offers this gym s own staff as the coach, and nobody as the default', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    await openAddForm();
    const picker = screen.getByLabelText('Usual coach (optional)');
    expect(picker.value).toBe('');
    expect(screen.getByRole('option', { name: 'Nobody yet' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Priya Sharma' })).toBeTruthy();
  });

  // The coach list is gated on `staff.manage`, which somebody setting the
  // timetable need not hold. Its failure is NOT this screen's failure.
  it('still works when the staff list is refused', async () => {
    api.getStaff.mockRejectedValue(new Error('403'));
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    await openAddForm();
    expect(screen.getByRole('option', { name: 'Nobody yet' })).toBeTruthy();
    expect(screen.queryByText("We couldn't load your timetable.")).toBeNull();
  });
});

describe('saying when it repeats', () => {
  it('sends the weekdays and the gym s clock time, leaving a blank end date off', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: /Add a repeat/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Tue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thu' }));
    fireEvent.change(screen.getByLabelText('Class start hour'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Class start minute'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('First date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: /Save this repeat/ }));

    await waitFor(() => expect(api.addClassRepeat).toHaveBeenCalledTimes(1));
    const [, typeId, body] = api.addClassRepeat.mock.calls[0];
    expect(typeId).toBe('t1');
    expect(body).toEqual({ weekdays: [2, 4], startMinute: 435, startsOn: '2026-10-01' });
    expect('endsOn' in body).toBe(false);
  });

  it('will not send a repeat that runs on no day', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: /Add a repeat/ }));
    const save = await screen.findByRole('button', { name: /Save this repeat/ });
    expect(screen.getByText(/at least one day/)).toBeTruthy();
    fireEvent.click(save);
    expect(api.addClassRepeat).not.toHaveBeenCalled();
  });

  it('stops a repeat and leaves the class standing', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: /Stop the Mon & Wed repeat of Sunrise Yoga/ }));
    await waitFor(() => expect(api.stopClassRepeat).toHaveBeenCalledWith('g1', 's1'));
    await screen.findByText(/isn't on the calendar yet/);
    expect(screen.getByText('Sunrise Yoga')).toBeTruthy();
  });
});

describe('changing and removing a class', () => {
  it('opens the form already filled in, and sends every field back', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const name = await screen.findByPlaceholderText('Sunrise Yoga');
    expect(name.value).toBe('Sunrise Yoga');
    expect(screen.getByLabelText('How many people fit').value).toBe('20');
    expect(screen.getByLabelText('Usual coach (optional)').value).toBe('u9');

    fireEvent.change(name, { target: { value: 'Sunrise Yoga (Reformer)' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(api.updateClass).toHaveBeenCalledTimes(1));
    const [, typeId, body] = api.updateClass.mock.calls[0];
    expect(typeId).toBe('t1');
    expect(body).toEqual({
      name: 'Sunrise Yoga (Reformer)',
      description: 'Bring a mat.',
      minutes: 60,
      places: 20,
      coachUserId: 'u9',
      colour: 'blue',
      openGym: false,
    });
  });

  it('takes a class off the timetable and keeps it in the list below', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: /Take Sunrise Yoga off the timetable/ }));
    await waitFor(() => expect(api.archiveClass).toHaveBeenCalledWith('g1', 't1'));
    // The archived section's heading, and the class still named inside it —
    // "removed from the timetable" is not "deleted".
    await screen.findByText('No longer running');
    fireEvent.click(screen.getByRole('button', { name: /No longer running/ }));
    expect(screen.getByText(/Sunrise Yoga · 60 min · 20 places/)).toBeTruthy();
  });

  it('prints the server s own sentence when a save is refused', async () => {
    api.archiveClass.mockRejectedValue(new Error('nope'));
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: /Take Sunrise Yoga off the timetable/ }));
    await screen.findByText("We couldn't save that.");
    // AND THE TIMETABLE IS STILL THERE. A failed save must not blank the screen.
    expect(screen.getByText('Sunrise Yoga')).toBeTruthy();
  });
});

describe('who may change it', () => {
  // §4.2's read-only console: staff of a lapsed gym SEE everything and change
  // nothing (:23711 — read-only "seals nobody out").
  it('a lapsed gym reads its timetable and is offered no control', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, consoleReadOnly: true, subscription: null }], formerOrgs: [] },
    });
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByText(/needs a plan before anything here can be changed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add a class/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a repeat/ })).toBeNull();
  });

  // Hiding is not the enforcement (R3.3) — the address is reachable by typing
  // it, so the screen says why rather than drawing controls that would 403.
  it('somebody without the tick who types the address is told, not handed controls', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, staffRole: 'trainer', privileges: ['members.read'] }], formerOrgs: [] },
    });
    drawScreen();
    await screen.findByText(/role doesn't allow you to set the timetable/);
    expect(screen.queryByRole('button', { name: /Add a class/ })).toBeNull();
  });
});
