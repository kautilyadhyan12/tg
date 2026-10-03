// STAFF CHECK-IN AND THE LIVE LOG, AT THE SCREEN (Attendance; ROADMAP 16b-ii).
//
// The worst thing the screen could do: say somebody was checked in who was not, or show
// a name the staff member did not pick — so the green line names the person the SERVER
// checked in, and a slow answer to an older search never replaces a newer one.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = {
  getMine: vi.fn(),
  getAttendanceDay: vi.fn(),
  getAttendanceHistory: vi.fn(),
  getCheckinLog: vi.fn(),
  findCheckinPeople: vi.fn(),
  staffCheckIn: vi.fn(),
  addVisit: vi.fn(),
  removeVisit: vi.fn(),
};
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: api };
});
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Kd' }, logout: vi.fn(), loading: false }),
}));

const Attendance = (await import('./Attendance')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');
const { addDays, gymToday } = await import('./hoursView');
const { dayLabel } = await import('../../components/gym/leaderboardView');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['attendance.read', 'attendance.mark', 'org.manage', 'staff.manage'],
  timezone: 'Europe/London',
  clockFormat: '24h',
  manualAttendanceEnabled: true,
  orgType: 'gym',
  subscription: { status: 'trialing' },
};

const logAnswer = (visits, day = '2026-10-03') => ({ data: { log: { day, timezone: 'Europe/London', clockFormat: '24h', visits } } });
const lv = (id, markedAt, name, over = {}) => ({ id, markedAt, name, method: 'pass', by: 'Front desk', status: null, payment: null, ...over });

const ANIL = { pick: { entryId: 'e-anil' }, name: 'Anil Kumar', memberNumber: '7102', email: null, notice: { status: null, payment: null, onList: true } };
const ANITA = {
  pick: { entryId: 'e-anita' },
  name: 'Anita Kumar',
  memberNumber: '7103',
  email: 'anita@example.com',
  notice: { status: 'Expired', payment: 'Overdue', onList: true },
};

const emptyDay = () => ({
  data: {
    attendance: {
      day: '2026-10-03',
      timezone: 'Europe/London',
      clockFormat: '24h',
      totals: { visits: 0, people: 0 },
      summary: [],
      people: [],
      nextCursor: null,
    },
  },
});

beforeEach(() => {
  resetConsoleOrgs();
  api.getMine.mockReset().mockResolvedValue({ data: { orgs: [ORG], formerOrgs: [] } });
  api.getAttendanceDay.mockReset().mockResolvedValue(emptyDay());
  api.getAttendanceHistory.mockReset();
  api.getCheckinLog.mockReset().mockResolvedValue(logAnswer([]));
  api.findCheckinPeople.mockReset();
  api.staffCheckIn.mockReset();
  api.addVisit.mockReset();
  api.removeVisit.mockReset();
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
  vi.useRealTimers();
});

const drawScreen = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/attendance']}>
      <Routes>
        <Route path="/console/:orgSlug/attendance" element={<Attendance />} />
      </Routes>
    </MemoryRouter>,
  );

const typeSearch = async (text) => fireEvent.change(await screen.findByLabelText('Find someone to check in'), { target: { value: text } });

describe('check someone in', () => {
  it('names the person the server checked in, with their gym words in orange, and empties the search for the next', async () => {
    api.findCheckinPeople.mockResolvedValue({ data: { people: [ANIL, ANITA] } });
    api.staffCheckIn.mockResolvedValue({
      data: { result: 'checked_in', person: { name: 'Anita Kumar' }, notice: { status: 'Expired', payment: 'Overdue', onList: true } },
    });
    drawScreen();
    await typeSearch('Kumar');
    await screen.findByText('Anita Kumar');
    expect(api.findCheckinPeople).toHaveBeenCalledWith('g1', 'Kumar');
    expect(screen.getByText('No. 7102')).toBeTruthy();
    expect(screen.getByText('No. 7103 · anita@example.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Check in Anita Kumar' }));
    const said = await screen.findByRole('status');
    expect(said.textContent).toContain('Anita Kumar — Checked in');
    expect(said.textContent).toContain('Status: Expired · Payment: Overdue');
    expect(api.staffCheckIn).toHaveBeenCalledTimes(1);
    expect(api.staffCheckIn).toHaveBeenCalledWith('g1', { entryId: 'e-anita' });
    expect(screen.getByLabelText('Find someone to check in').value).toBe('');
    expect(screen.queryByRole('button', { name: 'Check in Anil Kumar' })).toBeNull();
  });

  it('says when somebody was already in, and shows a refusal in the server\'s words', async () => {
    api.findCheckinPeople.mockResolvedValue({ data: { people: [ANIL] } });
    api.staffCheckIn.mockResolvedValueOnce({
      data: {
        result: 'already',
        person: { name: 'Anil Kumar' },
        notice: { status: null, payment: null, onList: true },
        firstAt: '2026-10-03T06:02:00.000Z',
        timezone: 'Europe/London',
        clockFormat: '24h',
      },
    });
    drawScreen();
    await typeSearch('Anil');
    fireEvent.click(await screen.findByRole('button', { name: 'Check in Anil Kumar' }));
    expect((await screen.findByRole('status')).textContent).toContain('Anil Kumar — Already checked in at 07:02');

    api.staffCheckIn.mockRejectedValueOnce({ response: { status: 404, data: { error: 'person_not_found', message: "That person isn't on your list any more." } } });
    await typeSearch('Anil');
    fireEvent.click(await screen.findByRole('button', { name: 'Check in Anil Kumar' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain("That person isn't on your list any more."));
    expect(screen.getByRole('status').textContent).not.toContain('Checked in');
  });

  it('never shows an older search\'s late answer over a newer one', async () => {
    let lateAnswer;
    api.findCheckinPeople.mockImplementation((_gym, query) =>
      query === 'An'
        ? new Promise((resolve) => {
            lateAnswer = resolve;
          })
        : Promise.resolve({ data: { people: [ANITA] } }),
    );
    drawScreen();
    await typeSearch('An');
    await waitFor(() => expect(api.findCheckinPeople).toHaveBeenCalledWith('g1', 'An'));
    await typeSearch('Anita');
    await screen.findByText('Anita Kumar');
    await act(async () => lateAnswer({ data: { people: [ANIL, ANITA] } }));
    expect(screen.queryByText('Anil Kumar')).toBeNull();
    expect(screen.getByText('Anita Kumar')).toBeTruthy();
  });

  it("takes the last search's people off the screen the moment the box changes, and after a check-in", async () => {
    let ravi;
    api.findCheckinPeople.mockImplementation((_gym, query) =>
      query === 'Kumar'
        ? Promise.resolve({ data: { people: [ANIL, ANITA] } })
        : new Promise((resolve) => {
            ravi = resolve;
          }),
    );
    api.staffCheckIn.mockResolvedValue({ data: { result: 'checked_in', person: { name: 'Anita Kumar' }, notice: { status: null, payment: null, onList: true } } });
    drawScreen();
    await typeSearch('Kumar');
    await screen.findByRole('button', { name: 'Check in Anil Kumar' });

    // Another name typed over it: nobody from the old search can be pressed while the new one is on its way.
    await typeSearch('Ravi');
    expect(screen.queryByRole('button', { name: /^Check in / })).toBeNull();
    await waitFor(() => expect(api.findCheckinPeople).toHaveBeenCalledWith('g1', 'Ravi'));
    expect(screen.queryByRole('button', { name: /^Check in / })).toBeNull();
    expect(screen.queryByText(/Nobody on your list matches/)).toBeNull();
    await act(async () => ravi({ data: { people: [] } }));
    expect(await screen.findByText(/Nobody on your list matches “Ravi”/)).toBeTruthy();

    // After a check-in the box is empty; the first letter of the next name brings nobody back.
    await typeSearch('Kumar');
    fireEvent.click(await screen.findByRole('button', { name: 'Check in Anita Kumar' }));
    await screen.findByRole('status');
    await typeSearch('K');
    expect(screen.queryByRole('button', { name: /^Check in / })).toBeNull();
  });

  it('says so when nobody matches, and the box is not there without the tick', async () => {
    api.findCheckinPeople.mockResolvedValue({ data: { people: [] } });
    drawScreen();
    await typeSearch('Zed');
    expect(await screen.findByText(/Nobody on your list matches/)).toBeTruthy();
    cleanup();
    resetConsoleOrgs();
    api.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer', privileges: ['members.read', 'attendance.read'] }], formerOrgs: [] } });
    drawScreen();
    await screen.findByText('Checked in today');
    expect(screen.queryByText('Check someone in')).toBeNull();
    // The page's first line promises only what this person can do.
    expect(screen.getByText(/^Who came in, by day\./)).toBeTruthy();
    expect(screen.queryByText(/Check people in/)).toBeNull();
  });
});

describe('what the search box promises', () => {
  it('names the email only for staff who keep the list', async () => {
    drawScreen();
    expect((await screen.findByLabelText('Find someone to check in')).placeholder).toBe('Name or member number');
    cleanup();
    resetConsoleOrgs();
    api.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, privileges: [...ORG.privileges, 'members.confirm'] }], formerOrgs: [] } });
    drawScreen();
    expect((await screen.findByLabelText('Find someone to check in')).placeholder).toBe('Name, member number or email');
  });
});

// The worst thing the screen could do: add or remove a visit for somebody staff did not
// pick, or without the box that names them and the day.
describe('fixing a visit on Attendance', () => {
  const today = gymToday('Europe/London');
  const yesterday = addDays(today, -1);

  it('an earlier day turns Check in into Add visit, behind a box naming the person and the day', async () => {
    api.findCheckinPeople.mockResolvedValue({ data: { people: [ANIL, ANITA] } });
    api.addVisit.mockResolvedValue({ data: { result: 'added', person: { name: 'Anita Kumar' }, day: yesterday } });
    drawScreen();
    const dayBox = await screen.findByLabelText('Day they came');
    expect(dayBox.value).toBe(today);
    expect(dayBox.max).toBe(today);
    expect(dayBox.min).toBe(addDays(today, -62));
    fireEvent.change(dayBox, { target: { value: yesterday } });
    await typeSearch('Kumar');
    await screen.findByText('Anita Kumar');
    expect(screen.queryByRole('button', { name: 'Check in Anita Kumar' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add a visit for Anita Kumar' }));
    const box = screen.getByRole('group', { name: 'Add a visit for Anita Kumar' });
    expect(box.textContent).toContain(`Add a visit for Anita Kumar on ${dayLabel(yesterday)}?`);
    expect(box.textContent).toContain('It counts as a gym day on the leaderboard and for their streak.');
    expect(box.textContent).toContain("In their app, they see it with your name and today's date.");
    // Nothing yet, and nobody else can be pressed while the box is open.
    expect(api.addVisit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Add a visit for Anil Kumar' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add visit' }));
    const said = await screen.findByRole('status');
    expect(said.textContent).toBe(`Anita Kumar — Visit added for ${dayLabel(yesterday)}`);
    expect(api.addVisit).toHaveBeenCalledTimes(1);
    expect(api.addVisit).toHaveBeenCalledWith('g1', { entryId: 'e-anita' }, yesterday);
    expect(api.staffCheckIn).not.toHaveBeenCalled();
  });

  it('Cancel adds nothing; a day that already counts says nothing was added; a refusal is in the server\'s words', async () => {
    api.findCheckinPeople.mockResolvedValue({ data: { people: [ANIL] } });
    drawScreen();
    fireEvent.change(await screen.findByLabelText('Day they came'), { target: { value: yesterday } });
    await typeSearch('Anil');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a visit for Anil Kumar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.addVisit).not.toHaveBeenCalled();

    api.addVisit.mockResolvedValueOnce({ data: { result: 'already', person: { name: 'Anil Kumar' }, day: yesterday } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a visit for Anil Kumar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add visit' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      `Anil Kumar — Already has a visit that counts on ${dayLabel(yesterday)}. Nothing was added.`,
    );

    api.addVisit.mockRejectedValueOnce({ response: { status: 404, data: { message: "That person isn't on your list any more." } } });
    await typeSearch('Anil');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a visit for Anil Kumar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add visit' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain("That person isn't on your list any more."));
  });

  it('a date box emptied goes back to today, where the button checks in', async () => {
    api.findCheckinPeople.mockResolvedValue({ data: { people: [ANIL] } });
    drawScreen();
    const dayBox = await screen.findByLabelText('Day they came');
    fireEvent.change(dayBox, { target: { value: yesterday } });
    fireEvent.change(dayBox, { target: { value: '' } });
    expect(dayBox.value).toBe(today);
    await typeSearch('Anil');
    expect(await screen.findByRole('button', { name: 'Check in Anil Kumar' })).toBeTruthy();
  });

  it('Remove on a visit today: a box names the person and the time; the press is for THAT visit, and it leaves the list', async () => {
    api.getCheckinLog.mockResolvedValue(
      logAnswer([lv('v2', '2026-10-03T06:05:00.000Z', 'Ravi Noapp', { method: 'staff', by: 'Iron Owner' }), lv('v1', '2026-10-03T06:02:00.000Z', 'Asha App')]),
    );
    api.removeVisit.mockResolvedValue({ data: { removed: true, day: '2026-10-03' } });
    drawScreen();
    await screen.findByText('Ravi Noapp');
    fireEvent.click(screen.getByRole('button', { name: "Remove Ravi Noapp's 07:05 check-in" }));
    const box = screen.getByRole('group', { name: "Remove Ravi Noapp's check-in" });
    expect(box.textContent).toContain("Remove Ravi Noapp's 07:05 check-in?");
    expect(box.textContent).toContain('It no longer counts as a visit today');
    expect(api.removeVisit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove visit' }));
    await waitFor(() => expect(screen.queryByText('Ravi Noapp')).toBeNull());
    expect(api.removeVisit).toHaveBeenCalledTimes(1);
    expect(api.removeVisit).toHaveBeenCalledWith('g1', 'v2');
    expect(screen.getByText('Asha App')).toBeTruthy();
  });

  it('Cancel removes nothing; a failed removal says so and keeps the visit; staff without the tick see no Remove', async () => {
    api.getCheckinLog.mockResolvedValue(logAnswer([lv('v1', '2026-10-03T06:02:00.000Z', 'Asha App')]));
    api.removeVisit.mockRejectedValue({ response: { status: 409, data: { message: 'Your gym has no plan.' } } });
    drawScreen();
    await screen.findByText('Asha App');
    fireEvent.click(screen.getByRole('button', { name: "Remove Asha App's 07:02 check-in" }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.removeVisit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: "Remove Asha App's 07:02 check-in" }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove visit' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Your gym has no plan.');
    expect(screen.getByRole('group', { name: "Remove Asha App's check-in" })).toBeTruthy();

    cleanup();
    resetConsoleOrgs();
    api.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, privileges: ['attendance.read'] }], formerOrgs: [] } });
    drawScreen();
    await screen.findByText('Asha App');
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.queryByLabelText('Day they came')).toBeNull();
  });
});

describe('checked in today', () => {
  it('shows each visit with how and by whom, and asks every 5 seconds from the newest it has', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.getCheckinLog.mockResolvedValueOnce(
      logAnswer([lv('v2', '2026-10-03T06:05:00.000Z', 'Ravi Noapp', { method: 'staff', by: 'Iron Owner' }), lv('v1', '2026-10-03T06:02:00.000Z', 'Asha App')]),
    );
    drawScreen();
    await screen.findByText('Ravi Noapp');
    expect(screen.getByText('Checked in by Iron Owner')).toBeTruthy();
    expect(screen.getByText('Pass · Front desk')).toBeTruthy();
    expect(api.getCheckinLog).toHaveBeenLastCalledWith('g1', null);

    api.getCheckinLog.mockResolvedValueOnce(
      logAnswer([lv('v3', '2026-10-03T06:09:00.000Z', 'New Person', { method: 'key_tag', by: 'Side door' }), lv('v2', '2026-10-03T06:05:00.000Z', 'Ravi Noapp', { method: 'staff', by: 'Iron Owner' })]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await screen.findByText('New Person');
    expect(api.getCheckinLog).toHaveBeenLastCalledWith('g1', '2026-10-03T06:05:00.000Z');
    const names = screen.getAllByText(/^(New Person|Ravi Noapp|Asha App)$/).map((el) => el.textContent);
    expect(names).toEqual(['New Person', 'Ravi Noapp', 'Asha App']);
  });

  it("shows the gym's status and payment words under a person who has them, and nothing under one who has none", async () => {
    api.getCheckinLog.mockResolvedValueOnce(
      logAnswer([
        lv('v2', '2026-10-03T06:05:00.000Z', 'Maya Patel', { method: 'key_tag', status: 'Active', payment: 'Overdue' }),
        lv('v1', '2026-10-03T06:02:00.000Z', 'Asha App'),
      ]),
    );
    drawScreen();
    const maya = (await screen.findByText('Maya Patel')).closest('li');
    expect(maya.textContent).toContain('Key tag · Front desk');
    expect(maya.textContent).toContain('Active · Overdue');
    const asha = screen.getByText('Asha App').closest('li');
    // Nothing under her but how she came in, then the row's Remove.
    expect(asha.textContent).toBe('07:02Asha AppPass · Front deskRemove');
  });

  it('keeps asking after a failure that may clear, and stops with the server\'s words after one that will not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.getCheckinLog.mockResolvedValueOnce(logAnswer([lv('v1', '2026-10-03T06:02:00.000Z', 'Asha App')]));
    drawScreen();
    await screen.findByText('Asha App');

    api.getCheckinLog.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText("Couldn't refresh — trying again")).toBeTruthy();
    expect(screen.getByText('Asha App')).toBeTruthy();

    api.getCheckinLog.mockRejectedValueOnce({ response: { status: 403, data: { error: 'forbidden', message: "Your role doesn't allow that." } } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText("Your role doesn't allow that.")).toBeTruthy();
    expect(screen.queryByText('Asha App')).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    const asked = api.getCheckinLog.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(api.getCheckinLog.mock.calls.length).toBe(asked);
  });

  it('asks nothing while the page is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    drawScreen();
    await screen.findByText(/Nobody has checked in yet today/);
    const asked = api.getCheckinLog.mock.calls.length;
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(api.getCheckinLog.mock.calls.length).toBe(asked);
    hidden.mockRestore();
  });
});

describe('the day list counts somebody without the app', () => {
  it('draws them by their record and reads their visits by it', async () => {
    api.getAttendanceDay.mockResolvedValue({
      data: {
        attendance: {
          ...emptyDay().data.attendance,
          totals: { visits: 1, people: 1 },
          people: [
            {
              userId: null,
              entryId: 'e-ravi',
              displayName: 'Ravi Noapp',
              email: 'ravi@example.com',
              visits: [{ day: '2026-10-03', markedAt: '2026-10-03T06:05:00.000Z', method: 'staff', hoursStatus: 'hours_unset', session: null }],
            },
          ],
        },
      },
    });
    api.getAttendanceHistory.mockResolvedValue({ data: { attendance: { timezone: 'Europe/London', clockFormat: '24h', visits: [], nextCursor: null } } });
    drawScreen();
    const row = await screen.findByText('ravi@example.com');
    fireEvent.click(row.closest('button'));
    await waitFor(() => expect(api.getAttendanceHistory).toHaveBeenCalledWith('g1', { entryId: 'e-ravi' }));
  });
});
