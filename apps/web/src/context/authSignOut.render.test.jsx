// Signing out forgets what this tab kept for ONE sign-in: the door pressed and a
// poster's join code. The next person at a shared browser must not land at the
// last person's door, nor find a gym's code filled in one tap from asking to
// join. The real provider, with its network calls stood in.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const authService = { getMe: vi.fn(), logout: vi.fn() };
vi.mock('../api/authApi', () => ({ authService }));
vi.mock('../api/userApi', () => ({
  userService: { getProfile: vi.fn(async () => ({ data: { user: { onboardingCompleted: true, timezone: 'UTC' } } })) },
  syncTimezone: vi.fn(async () => {}),
  resetTimezoneSync: vi.fn(),
}));
vi.mock('../utils/storage', () => ({ setCurrentUserId: vi.fn() }));
vi.mock('../sync/syncClient', () => ({ flushSyncQueue: vi.fn(async () => {}) }));

const { AuthProvider, useAuth } = await import('./AuthContext');
const { GYM_DOOR, readDoor, readJoinCode, rememberDoor, rememberJoinCode } = await import('../pages/landingRoute');

function SignOut() {
  const { user, logout } = useAuth();
  return user ? (
    <button type="button" onClick={logout}>
      Sign out
    </button>
  ) : (
    <p>SIGNED OUT</p>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  authService.getMe.mockResolvedValue({ data: { user: { id: 'u1', email: 'kd@example.com' } } });
  authService.logout.mockResolvedValue({});
});

afterEach(() => cleanup());

describe('signing out', () => {
  it('forgets the kept join code and the door', async () => {
    render(
      <AuthProvider>
        <SignOut />
      </AuthProvider>,
    );
    await screen.findByText('Sign out');
    rememberJoinCode('k7qm2x');
    rememberDoor(GYM_DOOR);
    expect(readJoinCode()).toBe('K7QM2X');
    expect(readDoor()).toBe(GYM_DOOR);

    fireEvent.click(screen.getByText('Sign out'));
    await screen.findByText('SIGNED OUT');
    expect(readJoinCode()).toBeNull();
    expect(readDoor()).toBeNull();
  });

  it('forgets them even when the server cannot be reached to end the session', async () => {
    authService.logout.mockRejectedValue(new Error('Network Error'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AuthProvider>
        <SignOut />
      </AuthProvider>,
    );
    await screen.findByText('Sign out');
    rememberJoinCode('k7qm2x');

    fireEvent.click(screen.getByText('Sign out'));
    await screen.findByText('SIGNED OUT');
    expect(readJoinCode()).toBeNull();
    quiet.mockRestore();
  });
});
