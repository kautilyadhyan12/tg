// "You're invited" (Part 3 §10.2; ROADMAP 3b-ii-a): straight after "Before you start"
// and before setup, the ONE tap on "What {gym} can see", No thanks, Not now; the same
// cards in Settings → Gym; and the invitation email's link.
//
// The REAL provider and the REAL guard, with only the network stood in, so a guard that
// stopped asking, or asked the console too, turns these red.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, configure } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

configure({ asyncUtilTimeout: 3000 });

const authService = { getMe: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), logout: vi.fn() };
vi.mock('../api/authApi', () => ({ default: { post: vi.fn(), get: vi.fn() }, authService }));
const profile = { read: vi.fn() };
vi.mock('../api/userApi', () => ({
  userService: { getProfile: () => profile.read() },
  syncTimezone: vi.fn(async () => {}),
  resetTimezoneSync: vi.fn(),
}));
vi.mock('../utils/storage', () => ({ setCurrentUserId: vi.fn() }));
vi.mock('../sync/syncClient', () => ({ flushSyncQueue: vi.fn(async () => {}) }));
vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (cb) => cb() }),
}));
vi.mock('../api/orgsApi', async (importOriginal) => ({
  ...(await importOriginal()),
  orgService: { getInvitations: vi.fn(), acceptInvitation: vi.fn(), declineInvitation: vi.fn() },
}));
vi.mock('./console/consoleOrgs', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshConsoleOrgsAfterChange: vi.fn(),
}));

const { orgService } = await import('../api/orgsApi');
const { refreshConsoleOrgsAfterChange } = await import('./console/consoleOrgs');
const { AuthProvider } = await import('../context/AuthContext');
const { ProtectedRoute } = await import('../components/common/ProtectedRoute');
const { forgetInvitations } = await import('../components/gym/invitationsStore');
const InvitationsPanel = (await import('../components/gym/InvitationsPanel')).default;
const InvitationLink = (await import('./InvitationLink')).default;
const { MEMBER_DOOR, GYM_DOOR, readDoor, rememberDoor } = await import('./landingRoute');

const USER = { id: '3f0c1a52-6a3b-4a53-9a55-2d6f3f6b9b10', email: 'alice@example.com', displayName: 'Alice' };
const IRON = {
  id: 'b0c7c4b0-8f7e-4d6a-9a3b-1f2e3d4c5b6a',
  state: 'pending',
  gym: { id: '7d3f5a10-2b4c-4e6d-8f9a-0b1c2d3e4f5a', name: 'Iron House', city: 'Leeds', orgType: 'gym' },
  canTakeMembers: true,
};
const JOINED = { outcome: 'joined', gym: { id: IRON.gym.id, slug: 'iron-house', name: 'Iron House', orgType: 'gym' } };

const waiting = (...invitations) =>
  orgService.getInvitations.mockResolvedValue({ data: { address: USER.email, invitations } });

const profileSays = (facts) =>
  profile.read.mockResolvedValue({ data: { user: { ...USER, timezone: 'UTC', signUpDisclaimerAgreed: true, ...facts } } });

/** The routes as App.jsx draws them, each page behind its own guard. */
const draw = (entry) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>SIGN IN PAGE</p>} />
          <Route path="/onboarding" element={<ProtectedRoute requireOnboarding={false}><p>SET UP YOUR PROFILE</p></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><p>MEMBER APP</p></ProtectedRoute>} />
          <Route
            path="/console"
            element={
              <ProtectedRoute requireOnboarding={false} requireSignUpNote={false} requireInvitations={false}>
                <p>GYM CONSOLE</p>
              </ProtectedRoute>
            }
          />
          <Route path="/invitations" element={<ProtectedRoute requireInvitations={false}><InvitationsPanel showEmpty /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><InvitationsPanel /></ProtectedRoute>} />
          <Route path="/join/:slug" element={<InvitationLink />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

const refused = (status, error, message) => Promise.reject(Object.assign(new Error(error), { response: { status, data: { error, message } } }));

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  forgetInvitations();
  authService.getMe.mockResolvedValue({ data: { user: USER } });
  authService.logout.mockResolvedValue({});
  profileSays({ onboardingCompleted: true });
  waiting();
});

afterEach(() => cleanup());

describe("You're invited", () => {
  it('comes after "Before you start" and before setup: Join is one tap on what the gym can see, then Continue goes on into setup', async () => {
    profileSays({ onboardingCompleted: false });
    waiting(IRON);
    orgService.acceptInvitation.mockResolvedValue({ data: JOINED });
    draw('/dashboard');

    expect(await screen.findByRole('heading', { name: "You're invited" })).toBeTruthy();
    expect(screen.getByText("You're invited to Iron House")).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What Iron House can see' })).toBeTruthy();
    expect(screen.queryByText('SET UP YOUR PROFILE')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText("You're in Iron House.")).toBeTruthy();
    expect(orgService.acceptInvitation).toHaveBeenCalledTimes(1);
    expect(orgService.acceptInvitation).toHaveBeenCalledWith(IRON.id);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('SET UP YOUR PROFILE')).toBeTruthy();
    // The gym's own screens are read afresh; the visit asked the server once.
    expect(refreshConsoleOrgsAfterChange).toHaveBeenCalled();
    expect(orgService.getInvitations).toHaveBeenCalledTimes(1);
  });

  it('is not shown until "Before you start" is ticked', async () => {
    profileSays({ onboardingCompleted: false, signUpDisclaimerAgreed: false });
    waiting(IRON);
    draw('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeTruthy();
    expect(screen.queryByText("You're invited to Iron House")).toBeNull();
    expect(orgService.getInvitations).not.toHaveBeenCalled();
  });

  it('Not now goes on to the page, and the rest of the visit does not ask again', async () => {
    waiting(IRON);
    draw('/dashboard');
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
    expect(orgService.acceptInvitation).not.toHaveBeenCalled();
    expect(orgService.declineInvitation).not.toHaveBeenCalled();

    cleanup();
    draw('/dashboard');
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
    expect(screen.queryByText("You're invited to Iron House")).toBeNull();
  });

  it('No thanks is kept: the card offers Join again, and Continue goes on', async () => {
    waiting(IRON);
    orgService.declineInvitation.mockResolvedValue({ data: { state: 'declined' } });
    draw('/dashboard');
    fireEvent.click(await screen.findByRole('button', { name: 'No thanks' }));
    expect(await screen.findByText('You said no thanks. You can still join.')).toBeTruthy();
    expect(orgService.declineInvitation).toHaveBeenCalledWith(IRON.id);
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'No thanks' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('with nothing waiting, or only a declined invitation, the page shows at once', async () => {
    draw('/dashboard');
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
    cleanup();
    forgetInvitations();
    waiting({ ...IRON, state: 'declined' });
    draw('/dashboard');
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
    expect(screen.queryByText("You're invited to Iron House")).toBeNull();
  });

  it('a read that fails lets the person on', async () => {
    orgService.getInvitations.mockRejectedValue(new Error('offline'));
    draw('/dashboard');
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('the console never asks', async () => {
    waiting(IRON);
    draw('/console');
    expect(await screen.findByText('GYM CONSOLE')).toBeTruthy();
    expect(orgService.getInvitations).not.toHaveBeenCalled();
  });

  it("a gym that cannot take members: no Join and no sheet of what it would see, the screen says so, and No thanks still answers it", async () => {
    waiting({ ...IRON, canTakeMembers: false });
    orgService.declineInvitation.mockResolvedValue({ data: { state: 'declined' } });
    draw('/dashboard');
    expect(await screen.findByText("Iron House can't take new members in the app right now — tell the front desk.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'What Iron House can see' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(orgService.declineInvitation).toHaveBeenCalledWith(IRON.id);
  });

  it("a Join the server refuses shows the server's own sentence, and the card stays", async () => {
    waiting(IRON);
    orgService.acceptInvitation.mockImplementation(() =>
      refused(409, 'gym_full', 'Iron House has no free places right now — tell the front desk.'),
    );
    draw('/dashboard');
    fireEvent.click(await screen.findByRole('button', { name: 'Join' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Iron House has no free places right now — tell the front desk.');
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
    expect(screen.queryByText("You're in Iron House.")).toBeNull();
  });

  it('two invitations: Continue only once both are answered', async () => {
    const studio = { ...IRON, id: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f', gym: { ...IRON.gym, id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a', name: 'Studio Nine', city: null } };
    waiting(IRON, studio);
    orgService.acceptInvitation.mockResolvedValue({ data: JOINED });
    orgService.declineInvitation.mockResolvedValue({ data: { state: 'declined' } });
    draw('/dashboard');
    expect(await screen.findByRole('heading', { name: 'You have 2 invitations' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Join' })[0]);
    expect(await screen.findByText("You're in Iron House.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(orgService.declineInvitation).toHaveBeenCalledWith(studio.id);
  });
});

describe('Settings → Gym and /invitations', () => {
  it('Settings lists a declined invitation with its Join, and asks the server afresh', async () => {
    waiting({ ...IRON, state: 'declined' });
    orgService.acceptInvitation.mockResolvedValue({ data: JOINED });
    draw('/settings');
    expect(await screen.findByText('You said no thanks. You can still join.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText("You're in Iron House.")).toBeTruthy();
    expect(refreshConsoleOrgsAfterChange).toHaveBeenCalled();
  });

  it('with nothing waiting, /invitations names the address the gym must have', async () => {
    draw('/invitations');
    expect(
      await screen.findByText(
        'No invitation for alice@example.com. Your gym invites the email address it has for you — sign in with that one, or ask the front desk to add this one.',
      ),
    ).toBeTruthy();
  });
});

describe("the invitation email's link", () => {
  it('signed out: sends the person to sign in with the address the gym has, through the member door', async () => {
    authService.getMe.mockRejectedValue(Object.assign(new Error('unauthorized'), { response: { status: 401 } }));
    rememberDoor(GYM_DOOR);
    draw('/join/iron-house');
    expect(await screen.findByRole('heading', { name: 'Your gym invited you' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Sign in/ }));
    expect(await screen.findByText('SIGN IN PAGE')).toBeTruthy();
    expect(readDoor()).toBe(MEMBER_DOOR);
  });

  it('signed in: goes straight to the invitations', async () => {
    waiting(IRON);
    draw('/join/iron-house');
    expect(await screen.findByText("You're invited to Iron House")).toBeTruthy();
    await waitFor(() => expect(orgService.getInvitations).toHaveBeenCalled());
  });
});
