// Signing out of a console page keeps nothing for the next person at the same browser (19b-ii
// round one, H-1): the page still on screen renders once with nobody signed in before the
// sign-in page opens, and it must not be kept then, nor "Manage my gym or studio" chosen.
// The real ProtectedRoute and a real BrowserRouter; sign-out in AuthContext's own order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';

vi.mock('../context/AuthContext', async () => {
  const React = await import('react');
  const FakeAuthContext = React.createContext(null);
  return { useAuth: () => React.useContext(FakeAuthContext), FakeAuthContext };
});

const { FakeAuthContext, useAuth } = await import('../context/AuthContext');
const { GYM_DOOR, MEMBER_DOOR, forgetDoor, noteSignedIn, noteSignedOut, readDoor, readReturn, rememberDoor, returnForDoor } = await import('./landingRoute');
const { ProtectedRoute } = await import('../components/common/ProtectedRoute');

const SIGNED_IN = { id: 'u1', displayName: 'Ana Staff', email: 'ana@gmail.com', onboardingCompleted: true, signUpDisclaimerAgreed: true };
const PAGE = '/console/iron-house/members/abc-person';

function Auth({ startsAs, children }) {
  const [user, setUser] = useState(startsAs);
  // AuthContext's own order: the user goes, then what the sign-in kept.
  const logout = async () => {
    await Promise.resolve();
    setUser(null);
    forgetDoor();
    noteSignedOut();
  };
  return <FakeAuthContext.Provider value={{ user, loading: false, logout }}>{children}</FakeAuthContext.Provider>;
}

function ConsolePage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={async () => {
        await logout();
        navigate('/login');
      }}
    >
      Sign out
    </button>
  );
}
const draw = (startsAs) => {
  window.history.pushState({}, '', PAGE);
  render(
    <Auth startsAs={startsAs}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/console/:orgSlug/members/:id"
            element={
              <ProtectedRoute requireOnboarding={false} requireSignUpNote={false} requireInvitations={false}>
                <ConsolePage />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<p>Sign in page</p>} />
        </Routes>
      </BrowserRouter>
    </Auth>,
  );
};

beforeEach(() => {
  window.sessionStorage.clear();
  noteSignedIn();
});
afterEach(() => {
  cleanup();
  noteSignedIn();
});

describe('the page kept for sign-in', () => {
  it('a console page opened signed out is kept, on Manage my gym or studio', async () => {
    draw(null);
    expect(await screen.findByText('Sign in page')).toBeTruthy();
    expect(readReturn()).toBe(PAGE);
    expect(readDoor()).toBe(GYM_DOOR);
  });

  it('THE NEXT PERSON: signing out of a console page keeps no page and chooses no door', async () => {
    draw(SIGNED_IN);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Sign in page')).toBeTruthy();
    expect(readReturn()).toBeNull();
    expect(readDoor()).toBeNull();
  });

  it('the door pressed on the sign-in page wins: a kept console page opens only through the console door (L-1)', () => {
    draw(null);
    expect(returnForDoor(GYM_DOOR)).toBe(PAGE);
    expect(returnForDoor(MEMBER_DOOR)).toBeNull();
    rememberDoor(MEMBER_DOOR);
    expect(returnForDoor(readDoor())).toBeNull();
  });
});
