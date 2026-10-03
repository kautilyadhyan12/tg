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
const lv = (id, markedAt, name, over = {}) => ({ id, markedAt, name, method: 'pass', by: 'Front desk', ...over });

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
