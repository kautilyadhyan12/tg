// The admin page (ROADMAP Stage 2 item 14a-i), drawn: its own door (a fresh code, then Kd's
// password), never a line in a gym's menu; ticked people get the number he picks after a box names
// them; what happened is said in one line. The server's own refusal of everybody else, and the
// door's rules, are `apps/api/test/admin.routes.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../api/adminApi', () => ({
  adminService: { door: vi.fn(), makePassword: vi.fn(), openDoor: vi.fn(), lock: vi.fn(), people: vi.fn(), setLimits: vi.fn() },
  isDoorShut: (err) => err?.response?.status === 403 && err?.response?.data?.error === 'admin_locked',
}));
const auth = { user: { id: 'kd', displayName: 'Kd', email: 'kd@gmail.com' }, logout: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn() };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

const { adminService } = await import('../../api/adminApi');
const Admin = (await import('./Admin')).default;
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;

const person = (name, over = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${String(name.length)}`,
  name,
  email: `${name.toLowerCase()}@gmail.com`,
  signedUpAt: '2026-11-08T09:00:00.000Z',
  lastSeenAt: null,
  ownPlan: null,
  gyms: [],
  mealScans: { window: 'month', limit: 3, yours: false },
  routePlans: { window: 'month', limit: 2, yours: false },
  ...over,
});
const asha = person('Asha', { id: 'a1' });
const ben = person('Ben', { id: 'b1', gyms: ['Iron Gym'], mealScans: { window: 'day', limit: 15, yours: true } });
const chen = person('Chen', { id: 'c1', ownPlan: 'month', mealScans: { window: 'day', limit: 15, yours: false } });

function draw(path = '/admin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="/console" element={<p>Console home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const OPEN = { passwordSet: true, open: true, openUntil: '2026-11-08T21:40:00.000Z', fresh: true };

beforeEach(() => {
  auth.user = { id: 'kd', displayName: 'Kd', email: 'kd@gmail.com' };
  vi.mocked(adminService.door).mockResolvedValue(OPEN);
  vi.mocked(adminService.people).mockResolvedValue({ people: [asha, ben, chen], next: null });
  vi.mocked(adminService.setLimits).mockResolvedValue({ changed: 2, unchanged: 0, notFound: 0 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the admin page', () => {
  it('is not there for anybody else: it says so, offers Sign out, and nobody is read', async () => {
    vi.mocked(adminService.door).mockResolvedValue(null);
    draw();
    expect(await screen.findByText("This page isn't available")).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sign out' }).length).toBeGreaterThan(0);
    expect(adminService.people).not.toHaveBeenCalled();
  });

  it('signed out: its own sign-in, the email then the code', async () => {
    auth.user = null;
    draw();
    expect(await screen.findByText('Admin sign-in')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kd@gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => expect(auth.sendCode).toHaveBeenCalledWith('kd@gmail.com', undefined));
    fireEvent.change(await screen.findByLabelText('The code we emailed to kd@gmail.com'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(auth.verifyCode).toHaveBeenCalledWith('kd@gmail.com', '123456'));
    expect(adminService.people).not.toHaveBeenCalled();
  });

  it('signed in a while ago: a new code first, to the same email; then the door is read again', async () => {
    vi.mocked(adminService.door).mockResolvedValueOnce({ passwordSet: true, open: false, openUntil: null, fresh: false }).mockResolvedValue({ passwordSet: true, open: false, openUntil: null, fresh: true });
    draw();
    expect(await screen.findByText('Sign in again')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toHaveProperty('value', 'kd@gmail.com');
    expect(screen.getByLabelText('Email')).toHaveProperty('readOnly', true);
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByLabelText('The code we emailed to kd@gmail.com'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Admin password')).toBeTruthy();
    expect(adminService.people).not.toHaveBeenCalled();
  });

  it('the first time: make the password (long enough, typed twice the same), and the page opens', async () => {
    vi.mocked(adminService.door).mockResolvedValue({ passwordSet: false, open: false, openUntil: null, fresh: true });
    vi.mocked(adminService.makePassword).mockResolvedValue(OPEN);
    draw();
    expect(await screen.findByText('Make your admin password')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make password and open' }));
    expect(screen.getByRole('alert').textContent).toBe('Your admin password needs at least 12 characters.');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-admin-pw-1' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'a-long-admin-pw-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make password and open' }));
    expect(screen.getByRole('alert').textContent).toBe('The two passwords are not the same.');
    expect(adminService.makePassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'a-long-admin-pw-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make password and open' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(adminService.makePassword).toHaveBeenCalledWith('a-long-admin-pw-1');
    expect(screen.getByTestId('open-until').textContent).toMatch(/^Open until /);
  });

  it('a wrong password says so and opens nothing; the right one opens the page; Lock shuts it', async () => {
    vi.mocked(adminService.door).mockResolvedValue({ passwordSet: true, open: false, openUntil: null, fresh: true });
    vi.mocked(adminService.openDoor).mockRejectedValueOnce({ response: { status: 403, data: { error: 'wrong_password', message: 'That password is not right.' } } }).mockResolvedValue(OPEN);
    draw();
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'not-the-right-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That password is not right.');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'the-right-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(adminService.lock).toHaveBeenCalled());
    expect(await screen.findByText('Admin password')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('when the 12 hours end mid-use, the page goes back to the door', async () => {
    vi.mocked(adminService.people).mockRejectedValue({ response: { status: 403, data: { error: 'admin_locked', message: 'Open the admin page with your password first.' } } });
    vi.mocked(adminService.door).mockResolvedValueOnce(OPEN).mockResolvedValue({ passwordSet: true, open: false, openUntil: null, fresh: false });
    draw();
    expect(await screen.findByText('Sign in again')).toBeTruthy();
  });

  it('lists the people with their plan and what they get', async () => {
    draw();
    const table = await screen.findByRole('table');
    await within(table).findByText('Asha');
    const rows = within(table).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'NameEmailSigned upLast seenPlanMeal scansRoute plans',
      'Ashaasha@gmail.com8 Nov 2026Not recordedFree3 a month2 a month',
      'Benben@gmail.com8 Nov 2026Not recordedMember of Iron Gym15 a day · set by you2 a month',
      'Chenchen@gmail.com8 Nov 2026Not recorded$10 a month15 a day2 a month',
    ]);
  });

  it('ticked people get your number after a box names who changes and who does not; one line says what happened', async () => {
    draw();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tick Asha' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick Ben' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick Chen' }));
    expect(screen.getByText('3 people ticked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set meal scans' }));
    const box = screen.getByRole('dialog', { name: 'Check before saving' });
    expect(within(box).getByText('Give 2 people 15 meal scans a day?')).toBeTruthy();
    expect(within(box).getByText('Asha and Chen')).toBeTruthy();
    expect(within(box).getByText('No change for Ben: already 15 a day.')).toBeTruthy();
    expect(adminService.setLimits).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole('button', { name: 'Yes, save' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', '2 people now have 15 meal scans a day. 1 person already had it.');
    expect(adminService.setLimits).toHaveBeenCalledWith({ userIds: ['a1', 'c1'], feature: 'meal_scan', perDay: 15 });
    await waitFor(() => expect(adminService.people).toHaveBeenCalledTimes(2));
  });

  it('any number from 0 to 100, for route plans too, and Cancel changes nobody', async () => {
    draw();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tick Asha' }));
    const [what, howMany] = screen.getAllByRole('combobox');
    expect(within(howMany).getAllByRole('option').map((o) => o.textContent)).toEqual(Array.from({ length: 101 }, (_x, n) => String(n)));
    fireEvent.change(what, { target: { value: 'route_gen' } });
    fireEvent.change(howMany, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set route plans' }));
    expect(screen.getByText('Give 1 person 0 route plans a day?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(adminService.setLimits).not.toHaveBeenCalled();
  });

  it("back to their plan's number: only those on your number change; nobody to change offers no Save", async () => {
    vi.mocked(adminService.setLimits).mockResolvedValue({ changed: 1, unchanged: 0, notFound: 0 });
    draw();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tick Ben' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick Asha' }));
    fireEvent.click(screen.getByRole('button', { name: "Back to their plan's number" }));
    expect(screen.getByText("Put 1 person back on their plan's meal scans?")).toBeTruthy();
    expect(screen.getByText("No change for Asha: already on their plan's meal scans.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', "1 person is back on their plan's meal scans. 1 person already had it.");
    expect(adminService.setLimits).toHaveBeenCalledWith({ userIds: ['b1'], feature: 'meal_scan', perDay: null });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick Asha' }));
    fireEvent.click(screen.getByRole('button', { name: "Back to their plan's number" }));
    expect(screen.getByText('Nobody to change.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes, save' })).toBeNull();
  });

  it('searches by name or email, and Show more adds the next page', async () => {
    vi.mocked(adminService.people).mockImplementation(async ({ search, after } = {}) => {
      if (after === 'next-1') return { people: [chen], next: null };
      if (search === 'asha') return { people: [asha], next: null };
      return { people: [asha, ben], next: 'next-1' };
    });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Chen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search by name or email'), { target: { value: ' asha ' } });
    await waitFor(() => expect(adminService.people).toHaveBeenCalledWith({ search: 'asha' }));
    await waitFor(() => expect(screen.queryByText('Ben')).toBeNull());
    vi.mocked(adminService.people).mockResolvedValue({ people: [], next: null });
    fireEvent.change(screen.getByPlaceholderText('Search by name or email'), { target: { value: 'zzz' } });
    expect(await screen.findByText('Nobody matches “zzz”.')).toBeTruthy();
  });
});

describe("the gym console", () => {
  it('has no Admin line, and never asks about the admin page', async () => {
    render(
      <MemoryRouter initialEntries={['/console']}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout><p>Your organisations</p></ConsoleLayout>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Your organisations')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
    expect(adminService.door).not.toHaveBeenCalled();
  });
});
