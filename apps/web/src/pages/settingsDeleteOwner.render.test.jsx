// Settings → Account → Delete for a gym's own owner (19b-ii; Kd, 2026-11-04): their account is not
// deleted until they make someone else its owner, so the box says so and opens the gym's Staff tab.
// That the server refuses is proven in apps/api/test/users.ownerDeletes.routes.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const auth = { user: { displayName: 'Kd' }, updateUser: vi.fn(), logout: vi.fn() };
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../context/TransitionContext', () => ({ useTransition: () => ({ triggerTransition: vi.fn() }) }));
vi.mock('../hooks/useMyGyms', () => ({ useMyGyms: () => ({ gyms: [] }) }));
vi.mock('../api/mlApi', () => ({
  default: { get: vi.fn(() => Promise.reject(new Error('old backend down'))), patch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/userApi', async (importOriginal) => ({ ...(await importOriginal()), userService: svc }));
const auths = { requestDeleteCode: vi.fn(), deleteAccount: vi.fn() };
vi.mock('../api/authApi', async (importOriginal) => ({ ...(await importOriginal()), authService: auths }));
const orgs = { getMine: vi.fn() };
vi.mock('../api/orgsApi', async (importOriginal) => ({ ...(await importOriginal()), orgService: orgs }));
const health = {
  get: vi.fn(async () => ({
    data: { healthScreening: { answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null } },
  })),
  put: vi.fn(),
};
vi.mock('../api/healthApi', async (importOriginal) => ({ ...(await importOriginal()), healthService: health }));

const toast = (await import('react-hot-toast')).default;
const { resetConsoleOrgs } = await import('./console/consoleOrgs');
const Settings = (await import('./Settings')).default;

const STAFF = 'http://localhost:5173/console/iron-house/members?view=staff&handOver=1';
const gym = (name, more = {}) => ({
  id: name === 'Iron House' ? '11111111-1111-1111-1111-111111111111' : '22222222-2222-2222-2222-222222222222',
  slug: name.toLowerCase().replace(' ', '-'),
  name,
  city: null,
  country: 'US',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: null,
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
  ...more,
});
const OWNED = gym('Iron House', { staffRole: 'owner', handOver: { url: STAFF, askedName: null } });
const CO_OWNED = gym('Lotus Yoga', { staffRole: 'owner', coOwner: true });
const OWNS_LINE = 'You own Iron House. Before you delete your account, make someone else its owner.';
const apiError = (error, message) => Object.assign(new Error(message), { response: { status: 409, data: { error, message } } });

function Where() {
  const at = useLocation();
  return <p data-testid="where">{`${at.pathname}${at.search}`}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  svc.getProfile = vi.fn(async () => ({
    data: { user: { id: 'u1', email: 'kd@example.com', displayName: 'Kd', weightKg: 70, onboardingCompleted: true, createdAt: '2026-09-01T00:00:00.000Z' } },
  }));
  svc.getFitnessProfile = vi.fn(async () => ({ data: { fitnessProfile: { fitnessGoals: [], availableEquipment: [], trainingPlaces: [], onboardingCompleted: true } } }));
  auths.requestDeleteCode.mockResolvedValue({ data: {} });
});
afterEach(() => cleanup());

const openDelete = async (mine) => {
  orgs.getMine.mockResolvedValue({ data: { orgs: mine, formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/console/:orgSlug/members" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByDisplayValue('Kd');
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
};

describe('Delete account for a gym owner (the worst thing: an owner deletes their account and the gym has nobody to run it)', () => {
  it('the owner is told to make someone else the owner, is sent no code, and Choose a new owner opens the Staff tab', async () => {
    await openDelete([OWNED, CO_OWNED]);
    expect(await screen.findByText(OWNS_LINE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Email me a code/ })).toBeNull();
    expect(screen.queryByText(/Lotus Yoga/)).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Choose a new owner' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/console/iron-house/members?view=staff&handOver=1');
    expect(auths.requestDeleteCode).not.toHaveBeenCalled();
  });

  it('an owner who has asked someone is told who, and that they can delete once that person accepts', async () => {
    await openDelete([{ ...OWNED, handOver: { url: STAFF, askedName: 'Priya Shah' } }]);
    expect(await screen.findByText('You asked Priya Shah to be the owner of Iron House. Once they accept, you can delete your account.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose a new owner' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Email me a code/ })).toBeNull();
  });

  it('a co-owner or a member deletes as before', async () => {
    await openDelete([CO_OWNED, gym('Pulse Studio')]);
    expect(await screen.findByRole('button', { name: /Email me a code/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Choose a new owner/ })).toBeNull();
  });

  it("an owner this page did not know of reads the server's refusal, and the box turns to choosing a new owner", async () => {
    await openDelete([CO_OWNED]);
    const send = await screen.findByRole('button', { name: /Email me a code/ });
    orgs.getMine.mockResolvedValue({ data: { orgs: [CO_OWNED, OWNED], formerOrgs: [] } });
    auths.requestDeleteCode.mockRejectedValue(apiError('owns_gym', OWNS_LINE));
    fireEvent.click(send);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OWNS_LINE));
    expect(await screen.findByRole('link', { name: 'Choose a new owner' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Email me a code/ })).toBeNull();
  });

  it('an owner of two gyms has a button for each', async () => {
    const lotus = { ...CO_OWNED, coOwner: false, handOver: { url: 'http://localhost:5173/console/lotus-yoga/members?view=staff&handOver=1', askedName: null } };
    await openDelete([OWNED, lotus]);
    expect(await screen.findByText('You own Lotus Yoga. Before you delete your account, make someone else its owner.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose a new owner for Iron House' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose a new owner for Lotus Yoga' }).getAttribute('href')).toBe('/console/lotus-yoga/members?view=staff&handOver=1');
  });
});
