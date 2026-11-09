// Your account in the console (19b-ii; Kd, 2026-11-04): where the person who manages a gym deletes
// their account; the phone's Delete account sends an owner here. The worst thing first: a gym's own
// owner offered the code (the server refuses them, so the gym would be left with nobody to run it
// had it not), or a co-owner or member stopped from deleting their own account.
// That the server refuses an owner is proven in apps/api/test/users.ownerDeletes.routes.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const auth = { user: { id: 'u1', displayName: 'Odette Owner', email: 'odette@gmail.com' }, logout: vi.fn() };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const auths = { requestDeleteCode: vi.fn(), deleteAccount: vi.fn() };
vi.mock('../../api/authApi', async (importOriginal) => ({ ...(await importOriginal()), authService: auths }));
const orgs = { getMine: vi.fn() };
vi.mock('../../api/orgsApi', async (importOriginal) => ({ ...(await importOriginal()), orgService: orgs }));

const toast = (await import('react-hot-toast')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Account = (await import('./Account')).default;

const gym = (name, more = {}) => ({
  id: name === 'Iron House' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
  slug: name.toLowerCase().replace(' ', '-'),
  name,
  city: 'Austin',
  country: 'US',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: null,
  isMember: false,
  joinedAt: '2026-08-18T09:00:00.000Z',
  ...more,
});
const ACCOUNT = 'http://localhost:5173/console/iron-house/account';
const OWNED = gym('Iron House', { staffRole: 'owner', handOver: { url: ACCOUNT, askedName: null } });
const CO_OWNED = gym('Iron House', { staffRole: 'owner', coOwner: true });
const TRAINS = gym('Lotus Yoga', { isMember: true });
const OWNS_LINE = 'You own Iron House. Before you delete your account, make someone else its owner.';
const apiError = (status, error, message) => Object.assign(new Error(message), { response: { status, data: { error, message } } });

function Where() {
  const at = useLocation();
  return <p data-testid="where">{`${at.pathname}${at.search}`}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  auths.requestDeleteCode.mockResolvedValue({ data: {} });
  auths.deleteAccount.mockResolvedValue({ data: { message: 'Account scheduled for deletion. You have 14 days to undo via the link we emailed you.', emailSent: true } });
  auth.logout.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

const draw = (mine) => {
  orgs.getMine.mockResolvedValue({ data: { orgs: mine, formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/account']}>
      <Routes>
        <Route path="/console/:orgSlug/account" element={<Account />} />
        <Route path="/console/:orgSlug/members" element={<Where />} />
        <Route path="/login" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
};
const openDelete = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
};

describe('Your account → Delete account (the worst thing: an owner deleted, or anybody else stopped)', () => {
  it("a gym's own owner is told to make someone else the owner, is sent no code, and Choose a new owner opens the Staff tab", async () => {
    draw([OWNED, TRAINS]);
    expect(await screen.findByText('Odette Owner · odette@gmail.com')).toBeTruthy();
    await openDelete();
    expect(await screen.findByText(OWNS_LINE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Choose a new owner' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/console/iron-house/members?view=staff&handOver=1');
    expect(auths.requestDeleteCode).not.toHaveBeenCalled();
    expect(auths.deleteAccount).not.toHaveBeenCalled();
  });

  it('an owner who has asked someone is told who, and that they can delete once that person accepts', async () => {
    draw([{ ...OWNED, handOver: { url: ACCOUNT, askedName: 'Priya Shah' } }]);
    await openDelete();
    expect(await screen.findByText('You asked Priya Shah to be the owner of Iron House. Once they accept, you can delete your account.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
  });

  it.each([
    ['a co-owner', [CO_OWNED], 'You leave Iron House today. To come back later, ask them to add you again.'],
    ['a member who trains at a gym', [TRAINS], 'You leave Lotus Yoga today. To come back later, ask them to add you again.'],
  ])('%s is told what goes, gets the code, and deleting signs them out with the server’s words', async (_who, mine, leaves) => {
    draw(mine);
    await openDelete();
    expect(await screen.findByText(leaves)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByText('We emailed a 6-digit code to odette@gmail.com.')).toBeTruthy();
    const deleteButton = screen.getByRole('button', { name: /Delete my account/ });
    expect(deleteButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '12a3456' } });
    expect(screen.getByLabelText('6-digit code').value).toBe('123456');
    fireEvent.click(deleteButton);
    await waitFor(() => expect(auths.deleteAccount).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Account scheduled for deletion. You have 14 days to undo via the link we emailed you.');
    expect((await screen.findByTestId('where')).textContent).toBe('/login');
  });

  it('a wrong code says the server’s words and keeps the person signed in on the code step', async () => {
    auths.deleteAccount.mockRejectedValue(apiError(400, 'invalid_code', 'That code didn’t work. Try again.'));
    draw([TRAINS]);
    await openDelete();
    fireEvent.click(await screen.findByRole('button', { name: 'Email me a code' }));
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    expect(await screen.findByText('That code didn’t work. Try again.')).toBeTruthy();
    expect(screen.getByLabelText('6-digit code').value).toBe('');
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("an owner the console did not know of reads the server's refusal, and the box turns to choosing a new owner", async () => {
    draw([CO_OWNED]);
    await openDelete();
    const send = await screen.findByRole('button', { name: 'Email me a code' });
    orgs.getMine.mockResolvedValue({ data: { orgs: [OWNED], formerOrgs: [] } });
    auths.requestDeleteCode.mockRejectedValue(apiError(409, 'owns_gym', OWNS_LINE));
    fireEvent.click(send);
    expect(await screen.findByRole('link', { name: 'Choose a new owner' })).toBeTruthy();
    // The box says it, once: not again in a red line under it (round one, L-3).
    expect(screen.getAllByText(OWNS_LINE)).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
  });
});
