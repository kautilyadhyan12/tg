// The admin page (ROADMAP Stage 2 item 14a-i), drawn: only Kd's account sees it or its menu
// line; ticked people get the number he picks after a box names them; what happened is said in
// one line. The server's own refusal of everybody else is `apps/api/test/admin.routes.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../api/adminApi', () => ({
  adminService: { isAdmin: vi.fn(), people: vi.fn(), setLimits: vi.fn() },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'kd', displayName: 'Kd', email: 'kd@gmail.com' }, logout: vi.fn() }),
}));

const { adminService } = await import('../../api/adminApi');
const { forgetAdminAnswers } = await import('./useIsAdmin');
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

beforeEach(() => {
  forgetAdminAnswers();
  vi.mocked(adminService.isAdmin).mockResolvedValue(true);
  vi.mocked(adminService.people).mockResolvedValue({ people: [asha, ben, chen], next: null });
  vi.mocked(adminService.setLimits).mockResolvedValue({ changed: 2, unchanged: 0, notFound: 0 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the admin page', () => {
  it('is not there for anybody else: they are sent to the console, and nobody is read', async () => {
    vi.mocked(adminService.isAdmin).mockResolvedValue(false);
    draw();
    expect(await screen.findByText('Console home')).toBeTruthy();
    expect(adminService.people).not.toHaveBeenCalled();
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

describe("the console's Admin line", () => {
  const console_ = () =>
    render(
      <MemoryRouter initialEntries={['/console']}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout><p>Your organisations</p></ConsoleLayout>} />
        </Routes>
      </MemoryRouter>,
    );

  it('is there for the admin, opening the admin page', async () => {
    console_();
    const links = await screen.findAllByRole('link', { name: 'Admin' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute('href')).toBe('/admin');
  });

  it('is not there for anybody else', async () => {
    vi.mocked(adminService.isAdmin).mockResolvedValue(false);
    console_();
    await waitFor(() => expect(adminService.isAdmin).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });
});
