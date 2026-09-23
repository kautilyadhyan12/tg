// THE CLASSES SCREEN, AT THE SCREEN. ROADMAP 17b-i, 17b-ii-w; Part 3 §13.3.
//
// Only the network is mocked; the nav gate reads `schedule.manage` from the
// same kept answer the screen resolves its gym from. The cases that save assert
// the BODY sent, not only that a call happened — a wrong body puts a number on
// a calendar that nobody typed.
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
  updateClassRepeat: vi.fn(),
  stopClassRepeat: vi.fn(),
  restoreClass: vi.fn(),
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
const { addDays, gymToday } = await import('./hoursView');
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
  // The time slot's own three, deliberately DIFFERENT from the class's
  // 60/20/Priya: a screen still reading the class would show the class's.
  minutes: 45,
  places: 12,
  coachUserId: 'u8',
  coachName: 'Dana Okafor',
  nextDates: ['2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30'],
  sessionsAhead: 16,
  datesComplete: false,
  finished: false,
  startedToday: false,
};

const timetable = (over = {}) => ({
  data: {
    timezone: 'Europe/London',
    clockFormat: '24h',
    horizonDays: 56,
    entries: [{ type: YOGA, schedules: [REPEAT] }],
    archived: [],
    archivedTotal: 0,
    ...over,
  },
});

beforeEach(() => {
  resetConsoleOrgs();
  api.getMine.mockReset().mockResolvedValue({ data: { orgs: [ORG], formerOrgs: [] } });
  api.getClasses.mockReset().mockResolvedValue(timetable());
  api.createClass.mockReset().mockResolvedValue(timetable());
  api.updateClass.mockReset().mockResolvedValue(timetable());
  api.archiveClass
    .mockReset()
    .mockResolvedValue(timetable({ entries: [], archived: [YOGA], archivedTotal: 1 }));
  api.addClassRepeat.mockReset().mockResolvedValue(timetable());
  api.updateClassRepeat.mockReset().mockResolvedValue(timetable());
  api.stopClassRepeat.mockReset().mockResolvedValue(timetable({ entries: [{ type: YOGA, schedules: [] }] }));
  api.restoreClass.mockReset().mockResolvedValue(timetable());
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

// A time slot's heading: its days as text, its time range in a span of its
// own that never breaks across lines.
const slotHeading = (text) =>
  screen.getByText((_, el) => el?.tagName === 'DIV' && el.textContent === text);

const withSlot = (slot) => timetable({ entries: [{ type: YOGA, schedules: [{ ...REPEAT, ...slot }] }] });

// THE WORST THING THIS SCREEN'S WORDS COULD DO (17b-ii-w): a button whose word
// does something else — classes taken off by a tap that read "Close", or a time
// slot's classes cleared without a question. "Cancel" on this screen only ever
// takes classes off, so no form offers a button of that name.
describe('closing and backing out never change the timetable', () => {
  const nothingSent = () => {
    for (const call of [
      api.createClass,
      api.updateClass,
      api.archiveClass,
      api.addClassRepeat,
      api.updateClassRepeat,
      api.stopClassRepeat,
      api.restoreClass,
    ]) {
      expect(call).not.toHaveBeenCalled();
    }
  };

  it('every form closes with Close, sends nothing, and never offers a button named Cancel', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');

    // Each form is closed holding something it COULD save, so a Close wired to
    // Save would send it.
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }));
    fireEvent.change(screen.getByPlaceholderText('Sunrise Yoga'), { target: { value: 'Spin' } });
    expect(screen.getByRole('button', { name: 'Add class' }).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit Sunrise Yoga' }));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add time slot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tue' }));
    expect(screen.getByRole('button', { name: 'Add time slot' }).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit the Mon & Wed 18:30 time slot of Sunrise Yoga' }));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    nothingSent();
    expect(slotHeading('Mon & Wed · 18:30–19:15')).toBeTruthy();
  });

  it('Archive and a time slot s Cancel ask first, and Keep it sends nothing', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');

    fireEvent.click(screen.getByRole('button', { name: 'Archive Sunrise Yoga' }));
    expect(screen.getByText(/Archive Sunrise Yoga\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel the Mon & Wed 18:30 time slot of Sunrise Yoga' }));
    expect(screen.getByText(/Cancel the Mon & Wed 18:30 time slot\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    nothingSent();
    expect(screen.queryByText(/time slot\?/)).toBeNull();
  });
});

describe('the nav item', () => {
  it('appears in the console rail for somebody holding the privilege', async () => {
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Classes').length).toBeGreaterThan(0));
  });

  // The tab asks for the POWER, not the job title (:11429).
  it('is absent for staff whose owner unticked it, even though they are staff', async () => {
    api.getMine.mockResolvedValue({
      data: {
        orgs: [{ ...ORG, staffRole: 'manager', privileges: ['members.read', 'attendance.read'] }],
        formerOrgs: [],
      },
    });
    drawShell();
    // Waited on a tab this staffer DOES hold, so the absence below is not
    // checked before the org row has arrived.
    await waitFor(() => expect(screen.getAllByText('Members').length).toBeGreaterThan(0));
    expect(screen.queryByText('Classes')).toBeNull();
  });
});

describe('reading the timetable', () => {
  it('says which clock the times are on, in gym words', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByText('Iron House · Europe/London time')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Classes' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Calendar' })).toBeTruthy();
    // Struck by Kd on 2026-09-22 and 2026-09-23: nothing explains how dates are
    // written or what a class's numbers are for.
    expect(screen.queryByText(/weeks ahead/)).toBeNull();
    expect(screen.queryByText(/repeat/i)).toBeNull();
  });

  it('draws the class with its description, and not its defaults', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByText('Bring a mat.')).toBeTruthy();
    // 60 min · 20 places · Priya are what a NEW time slot starts from, not what
    // this class runs as; they live in the class's Edit form.
    expect(screen.queryByText(/20 places/)).toBeNull();
    expect(screen.queryByText(/Priya Sharma/)).toBeNull();
  });

  // Kd, at the click-through: a class and its time slots were hard to tell
  // apart. The class carries its own colour down its edge, as on the Calendar,
  // and its buttons say they are the class's.
  it('marks each class with its own colour, and names its buttons as the class s', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByTestId('class-colour').style.background).toBe('rgb(76, 141, 255)');
    expect(screen.getByRole('heading', { name: 'Sunrise Yoga' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Sunrise Yoga' }).textContent).toBe('Edit class');
    expect(screen.getByText('Time slots')).toBeTruthy();
  });

  it('draws each time slot with its own time range, places and coach', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(slotHeading('Mon & Wed · 18:30–19:15')).toBeTruthy();
    // On a phone the heading may wrap before the time, never inside it.
    expect(screen.getByText('18:30–19:15').className).toContain('whitespace-nowrap');
    expect(screen.getByText('12 places · Dana Okafor')).toBeTruthy();
  });

  it('says when the coach a time slot names is no longer this gym s staff', async () => {
    api.getClasses.mockResolvedValue(withSlot({ coachName: null }));
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByText("12 places · Coach not on this gym's staff")).toBeTruthy();
  });

  // The dates are the server's: the fixture's are not what "Mondays and
  // Wednesdays from today" would give.
  it('shows the next dates the server wrote, and never a count of them', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(
      screen.getByText('From 21 Sep 2026 · Next: Mon 21 Sep, Wed 23 Sep, Mon 28 Sep, Wed 30 Sep'),
    ).toBeTruthy();
    cleanup();

    api.getClasses.mockResolvedValue(
      withSlot({ endsOn: '2026-10-14', sessionsAhead: 7, datesComplete: true }),
    );
    drawScreen();
    await screen.findByText(
      '21 Sep – 14 Oct 2026 · Next: Mon 21 Sep, Wed 23 Sep, Mon 28 Sep, Wed 30 Sep',
    );
    cleanup();

    api.getClasses.mockResolvedValue(withSlot({ endsOn: '2027-09-20' }));
    drawScreen();
    await screen.findByText(
      '21 Sep 2026 – 20 Sep 2027 · Next: Mon 21 Sep, Wed 23 Sep, Mon 28 Sep, Wed 30 Sep',
    );
    expect(screen.queryByText(/on the calendar/)).toBeNull();
    expect(screen.queryByText(/ongoing|more to come|\+\d+ more/)).toBeNull();
  });

  it('says a time slot has ended, and lists no dates for it', async () => {
    api.getClasses.mockResolvedValue(
      withSlot({ startsOn: '2026-07-24', endsOn: '2026-08-23', nextDates: [], sessionsAhead: 0, finished: true }),
    );
    drawScreen();
    await screen.findByText('Ended 23 Aug 2026');
    expect(screen.queryByText(/Next:/)).toBeNull();
    expect(screen.queryByText(/yet/)).toBeNull();
  });

  it('shows only the start date of a time slot with nothing on the calendar yet', async () => {
    api.getClasses.mockResolvedValue(withSlot({ startsOn: '2027-01-04', nextDates: [], sessionsAhead: 0 }));
    drawScreen();
    await screen.findByText('From 4 Jan 2027');
    expect(screen.queryByText(/Next:/)).toBeNull();
  });

  // An unreadable page drawn as an empty one tells a gym with a full timetable
  // that it has none.
  it('tells a gym with no classes so, and a gym whose read failed that it failed', async () => {
    api.getClasses.mockResolvedValue(timetable({ entries: [] }));
    drawScreen();
    await screen.findByText('No classes yet.');
    cleanup();

    api.getClasses.mockRejectedValue(new Error('down'));
    drawScreen();
    await screen.findByText("We couldn't load your timetable.");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('No classes yet.')).toBeNull();
  });
});

describe('adding a class', () => {
  const openAddForm = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Add class' }));
    // The opener gives way to the form, whose own button has the same words.
    return screen.findByRole('button', { name: 'Add class' });
  };

  it('sends what the gym typed, as numbers, with the colour it picked', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const save = await openAddForm();
    expect(screen.getByText('New class')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Sunrise Yoga'), { target: { value: 'Spin' } });
    fireEvent.change(screen.getByLabelText('Default length (minutes)'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Default class size'), { target: { value: '12' } });
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

  // The route REPLACES rather than merges, so "no limit" must be an explicit
  // null on the wire, never a missing key.
  it('sends no limit as an explicit null for an open-gym class', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const save = await openAddForm();

    fireEvent.change(screen.getByPlaceholderText('Sunrise Yoga'), { target: { value: 'Open Gym' } });
    fireEvent.click(screen.getByLabelText('No limit'));
    fireEvent.click(screen.getByLabelText('Open gym (not a taught class)'));
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
    expect(screen.getByText('Give the class a name.')).toBeTruthy();
    fireEvent.click(save);
    expect(api.createClass).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Sunrise Yoga'), { target: { value: 'Spin' } });
    fireEvent.change(screen.getByLabelText('Default length (minutes)'), { target: { value: '4' } });
    expect(screen.getByText('Length must be 5 to 600 minutes.')).toBeTruthy();
    fireEvent.click(save);
    expect(api.createClass).not.toHaveBeenCalled();
  });

  it('offers this gym s own staff as the coach, and no coach as the default', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    await openAddForm();
    const picker = screen.getByLabelText('Default coach (optional)');
    expect(picker.value).toBe('');
    expect(screen.getByRole('option', { name: 'No coach' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Priya Sharma' })).toBeTruthy();
  });

  // The coach list needs `staff.manage`, which somebody setting the timetable
  // need not hold; its failure is not this screen's failure.
  it('still works when the staff list is refused', async () => {
    api.getStaff.mockRejectedValue(new Error('403'));
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    await openAddForm();
    expect(screen.getByRole('option', { name: 'No coach' })).toBeTruthy();
    expect(screen.queryByText("We couldn't load your timetable.")).toBeNull();
  });
});

describe('adding a time slot', () => {
  const openSlotForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add time slot' }));
    return screen.findByRole('button', { name: 'Add time slot' });
  };

  it('sends the days and the gym s clock time, leaving a blank end date off', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const save = await openSlotForm();
    expect(screen.getByText('New time slot')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thu' }));
    fireEvent.change(screen.getByLabelText('Start time hour'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Start time minute'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } });
    fireEvent.click(save);

    await waitFor(() => expect(api.addClassRepeat).toHaveBeenCalledTimes(1));
    const [, typeId, body] = api.addClassRepeat.mock.calls[0];
    expect(typeId).toBe('t1');
    // Filled in from the class's defaults (60/20/Priya), not the other time
    // slot's 45/12/Dana, and sent outright (Kd, RULINGS 2026-09-22).
    expect(body).toEqual({
      weekdays: [2, 4],
      startMinute: 435,
      startsOn: '2026-10-01',
      minutes: 60,
      places: 20,
      coachUserId: 'u9',
    });
    expect('endsOn' in body).toBe(false);
  });

  // A class whose default coach has left: the server keeps the id and stops
  // naming them, and copying the id would be refused on the first Save.
  it('starts a new time slot with no coach when the class s coach has left', async () => {
    api.getClasses.mockResolvedValue(
      timetable({ entries: [{ type: { ...YOGA, coachName: null }, schedules: [REPEAT] }] }),
    );
    api.getStaff.mockResolvedValue({ data: { staff: [] } });
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const save = await openSlotForm();
    fireEvent.click(screen.getByRole('button', { name: 'Tue' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } });
    expect(screen.getByLabelText('Length (minutes)').value).toBe('60');
    expect(screen.getByLabelText('Coach (optional)').value).toBe('');
    fireEvent.click(save);

    await waitFor(() => expect(api.addClassRepeat).toHaveBeenCalledTimes(1));
    const [, , body] = api.addClassRepeat.mock.calls[0];
    expect(body).toMatchObject({ minutes: 60, places: 20, coachUserId: null });
  });

  it('lets the new time slot differ from its class, and sends what was typed', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const save = await openSlotForm();

    fireEvent.click(screen.getByRole('button', { name: 'Tue' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } });
    expect(screen.getByLabelText('Class size').value).toBe('20');
    fireEvent.change(screen.getByLabelText('Length (minutes)'), { target: { value: '90' } });
    fireEvent.click(screen.getByLabelText('No limit'));
    fireEvent.change(screen.getByLabelText('Coach (optional)'), { target: { value: '' } });
    fireEvent.click(save);

    await waitFor(() => expect(api.addClassRepeat).toHaveBeenCalledTimes(1));
    const [, , body] = api.addClassRepeat.mock.calls[0];
    expect(body).toMatchObject({ minutes: 90, places: null, coachUserId: null });
  });

  it('will not send a time slot that runs on no day', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const save = await openSlotForm();
    expect(screen.getByText('Pick at least one day of the week.')).toBeTruthy();
    fireEvent.click(save);
    expect(api.addClassRepeat).not.toHaveBeenCalled();
  });

  it('cancelling a time slot asks first, and the class stays', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    const slotCancel = { name: 'Cancel the Mon & Wed 18:30 time slot of Sunrise Yoga' };
    fireEvent.click(screen.getByRole('button', slotCancel));

    expect(api.stopClassRepeat).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Cancel the Mon & Wed 18:30 time slot? Its upcoming classes come off the calendar.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.stopClassRepeat).not.toHaveBeenCalled();
    expect(slotHeading('Mon & Wed · 18:30–19:15')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', slotCancel));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel time slot' }));
    await waitFor(() => expect(api.stopClassRepeat).toHaveBeenCalledWith('g1', 's1'));
    await screen.findByText('No time slots yet.');
    expect(screen.getByText('Sunrise Yoga')).toBeTruthy();
  });
});

// The time slot is the live answer (Kd, RULINGS 2026-09-22): its form opens
// from the SLOT, never from its class.
describe('editing a time slot', () => {
  const openEdit = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Edit the Mon & Wed 18:30 time slot of Sunrise Yoga' }));

  // The fixture's next dates may be in the past by the time this runs, so the
  // date the form starts at is the gym's today, worked out the screen's way.
  const today = () => gymToday('Europe/London');

  it('opens filled in from the time slot, not its class, and sends its days, time and three fields from the date', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    openEdit();

    expect((await screen.findByLabelText('Length (minutes)')).value).toBe('45');
    expect(screen.getByLabelText('Class size').value).toBe('12');
    expect(screen.getByLabelText('Coach (optional)').value).toBe('u8');
    expect(screen.getByLabelText('Start time hour').value).toBe('18');
    expect(screen.getByLabelText('Start time minute').value).toBe('30');
    expect(screen.getByRole('button', { name: 'Mon' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tue' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('Update from').value).toBe(today());
    expect(
      screen.getByText(
        'Classes before this date stay as they are, and any marked Changed on the Calendar keep their own.',
      ),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Length (minutes)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Coach (optional)'), { target: { value: 'u9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateClassRepeat).toHaveBeenCalledTimes(1));
    const [gymId, scheduleId, body] = api.updateClassRepeat.mock.calls[0];
    expect(gymId).toBe('g1');
    expect(scheduleId).toBe('s1');
    // Every key, and no more: the route's schema is `.strict()`.
    expect(body).toEqual({
      updateFrom: today(),
      weekdays: [1, 3],
      startMinute: 1110,
      minutes: 30,
      places: 12,
      coachUserId: 'u9',
    });
    await waitFor(() => expect(screen.queryByLabelText('Update from')).toBeNull());
  });

  it('moves the time slot to new days and a new time from a later date', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    openEdit();
    await screen.findByLabelText('Update from');

    fireEvent.click(screen.getByRole('button', { name: 'Fri' }));
    fireEvent.change(screen.getByLabelText('Start time hour'), { target: { value: '19' } });
    fireEvent.change(screen.getByLabelText('Start time minute'), { target: { value: '0' } });
    const later = addDays(today(), 7);
    fireEvent.change(screen.getByLabelText('Update from'), { target: { value: later } });
    // A move says only what is true of a move.
    expect(screen.getByText('Classes before this date stay as they are.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateClassRepeat).toHaveBeenCalledTimes(1));
    expect(api.updateClassRepeat.mock.calls[0][2]).toEqual({
      updateFrom: later,
      weekdays: [1, 3, 5],
      startMinute: 1140,
      minutes: 45,
      places: 12,
      coachUserId: 'u8',
    });
  });

  // Round one, H-2: no Edit on a time slot that has ended, and one that starts
  // past the calendar opens at its own first day and can be saved.
  it('offers no Edit on a time slot that has ended, and still offers its Cancel', async () => {
    api.getClasses.mockResolvedValue(withSlot({ endsOn: '2026-09-25', finished: true, nextDates: [] }));
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.queryByRole('button', { name: 'Edit the Mon & Wed 18:30 time slot of Sunrise Yoga' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel the Mon & Wed 18:30 time slot of Sunrise Yoga' })).toBeTruthy();
  });

  it('opens a time slot that starts past the calendar at its own first day, and saves from it', async () => {
    const first = addDays(today(), 90);
    api.getClasses.mockResolvedValue(withSlot({ startsOn: first, nextDates: [] }));
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    openEdit();
    expect((await screen.findByLabelText('Update from')).value).toBe(first);
    fireEvent.change(screen.getByLabelText('Length (minutes)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateClassRepeat).toHaveBeenCalledTimes(1));
    expect(api.updateClassRepeat.mock.calls[0][2]).toMatchObject({ updateFrom: first, minutes: 30 });
  });

  // Round one, L-3: a refusal can mean the list is out of date.
  it('reads the list again after a refusal, and says so', async () => {
    api.updateClassRepeat.mockRejectedValueOnce({
      response: { status: 409, data: { error: 'class_update_from', message: 'Pick a date.' } },
    });
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(api.getClasses).toHaveBeenCalledTimes(1);
    openEdit();
    await screen.findByLabelText('Update from');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.getClasses).toHaveBeenCalledTimes(2));
    expect(screen.getByText("We couldn't save that.")).toBeTruthy();
  });

  it('asks before a move replaces classes changed on their own: Go back sends nothing, Move anyway sends the count', async () => {
    const asked = { response: { status: 409, data: { error: 'class_slot_replaces', replaces: 2 } } };
    api.updateClassRepeat.mockRejectedValueOnce(asked).mockRejectedValueOnce(asked);
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    openEdit();
    await screen.findByLabelText('Update from');
    fireEvent.change(screen.getByLabelText('Start time hour'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const question = await screen.findByText(/^2 classes from .+ on were changed or cancelled on their own\. Move anyway\?$/);
    expect(question).toBeTruthy();
    // The question stands where Save was, and it is not an error.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByText("We couldn't save that.")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByText(/Move anyway\?/)).toBeNull();
    expect(api.updateClassRepeat).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Move anyway\?/);
    // Changing the form takes the question away: it was about the old answer.
    fireEvent.change(screen.getByLabelText('Length (minutes)'), { target: { value: '50' } });
    expect(screen.queryByText(/Move anyway\?/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Length (minutes)'), { target: { value: '45' } });
    expect(api.updateClassRepeat).toHaveBeenCalledTimes(2);

    api.updateClassRepeat.mockRejectedValueOnce(asked);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Move anyway\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Move anyway' }));
    await waitFor(() => expect(api.updateClassRepeat).toHaveBeenCalledTimes(4));
    expect(api.updateClassRepeat.mock.calls[3][2]).toMatchObject({ startMinute: 450, confirmReplace: 2 });
    expect(api.updateClassRepeat.mock.calls[2][2]).not.toHaveProperty('confirmReplace');
    await waitFor(() => expect(screen.queryByLabelText('Update from')).toBeNull());
  });

  it('sends nothing when the numbers are out of bounds', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    openEdit();
    fireEvent.change(await screen.findByLabelText('Class size'), { target: { value: '0' } });
    expect(screen.getByText('Class size must be 1 to 500, or tick No limit.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updateClassRepeat).not.toHaveBeenCalled();
  });
});

describe('editing, archiving and restoring a class', () => {
  it('opens the form already filled in, with the defaults, and sends every field back', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Sunrise Yoga' }));

    const name = await screen.findByPlaceholderText('Sunrise Yoga');
    expect(name.value).toBe('Sunrise Yoga');
    expect(screen.getByLabelText('Default length (minutes)').value).toBe('60');
    expect(screen.getByLabelText('Default class size').value).toBe('20');
    expect(screen.getByLabelText('Default coach (optional)').value).toBe('u9');

    fireEvent.change(name, { target: { value: 'Sunrise Yoga (Reformer)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

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

  // Kd, 2026-09-22: it asks in place, under the class it is asking about.
  it('asks before archiving a class, and Keep it sends nothing', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: 'Archive Sunrise Yoga' }));

    expect(api.archiveClass).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Archive Sunrise Yoga? Its time slots are cancelled and its upcoming classes come off the calendar. You can restore the class later and add its time slots again.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Sunrise Yoga')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.archiveClass).not.toHaveBeenCalled();
    expect(screen.queryByText(/Archive Sunrise Yoga\?/)).toBeNull();
  });

  it('archives a class and keeps it under Archived classes, by name', async () => {
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: 'Archive Sunrise Yoga' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.archiveClass).toHaveBeenCalledWith('g1', 't1'));
    fireEvent.click(await screen.findByRole('button', { name: /Archived classes/ }));
    expect(screen.getByText('Sunrise Yoga')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore Sunrise Yoga' })).toBeTruthy();
    expect(screen.queryByText(/20 places/)).toBeNull();
  });

  // Round one, C/H-2 of 17b-i: the archived list is a PAGE, so the heading
  // prints the gym's real total and says when it shows only part of it.
  it('prints the real archived total, and says when it is showing a page of it', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...YOGA, id: `t${String(i)}`, name: `Old ${String(i)}` }));
    api.getClasses.mockResolvedValue(timetable({ entries: [], archived: many, archivedTotal: 341 }));
    drawScreen();
    await screen.findByText('341');
    fireEvent.click(screen.getByRole('button', { name: /Archived classes/ }));
    expect(screen.getByText('Showing the 200 most recent of 341.')).toBeTruthy();
    cleanup();

    api.getClasses.mockResolvedValue(timetable({ entries: [], archived: [YOGA], archivedTotal: 1 }));
    drawScreen();
    fireEvent.click(await screen.findByRole('button', { name: /Archived classes/ }));
    expect(screen.queryByText(/most recent of/)).toBeNull();
  });

  // The server brings the class back with none of its time slots (they stay
  // cancelled), and the screen says so rather than showing old ones.
  it('restores an archived class with one tap, without its time slots', async () => {
    api.getClasses.mockResolvedValue(timetable({ entries: [], archived: [YOGA], archivedTotal: 1 }));
    api.restoreClass.mockResolvedValue(timetable({ entries: [{ type: YOGA, schedules: [] }] }));
    drawScreen();
    fireEvent.click(await screen.findByRole('button', { name: /Archived classes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Sunrise Yoga' }));
    await waitFor(() => expect(api.restoreClass).toHaveBeenCalledWith('g1', 't1'));
    await screen.findByText('No time slots yet.');
  });

  it('prints the server s own sentence when a save is refused, and keeps the timetable', async () => {
    api.archiveClass.mockRejectedValue(new Error('nope'));
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    fireEvent.click(screen.getByRole('button', { name: 'Archive Sunrise Yoga' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText("We couldn't save that.");
    expect(screen.getByText('Sunrise Yoga')).toBeTruthy();
  });
});

describe('who may change it', () => {
  // §4.2: staff of a lapsed gym see everything and change nothing (:23711).
  it('a lapsed gym reads its timetable and is offered no control', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, consoleReadOnly: true, subscription: null }], formerOrgs: [] },
    });
    drawScreen();
    await screen.findByText('Sunrise Yoga');
    expect(screen.getByText(/needs a plan before anything here can be changed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add class' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Sunrise Yoga' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add time slot' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive Sunrise Yoga' })).toBeNull();
    expect(screen.queryByRole('button', { name: /time slot of Sunrise Yoga/ })).toBeNull();
  });

  it('a lapsed gym is not offered Restore either', async () => {
    api.getClasses.mockResolvedValue(timetable({ entries: [], archived: [YOGA], archivedTotal: 1 }));
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, consoleReadOnly: true, subscription: null }], formerOrgs: [] },
    });
    drawScreen();
    fireEvent.click(await screen.findByRole('button', { name: /Archived classes/ }));
    expect(screen.getByText('Sunrise Yoga')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore Sunrise Yoga' })).toBeNull();
  });

  // Hiding is not the enforcement (R3.3): somebody who types the address is
  // told why, not handed controls that would 403.
  it('somebody without the tick who types the address is told, not handed controls', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, staffRole: 'trainer', privileges: ['members.read'] }], formerOrgs: [] },
    });
    drawScreen();
    await screen.findByText(/role doesn't allow you to set the timetable/);
    expect(screen.queryByRole('button', { name: 'Add class' })).toBeNull();
  });
});
