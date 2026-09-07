// The Get started screen, in a browser-shaped test (Kd 2026-09-07: sign-in
// by 6-digit email code is the main way in; Google second; no password).
//
// The pure helpers next door prove the landing decision; these prove the
// SCREEN offers the two doors, walks a person from address to code to the
// right place, shows the server's words when a code is refused, and never
// draws a password box. Both are needed: a source assertion can be spelled
// around, and the decision being right is worth nothing if the button is not
// wired to it.
//
// `PublicRoute` is exercised here too — it is the second place a signed-in
// person gets sent somewhere, and it used to spell the destination itself.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// One mutable auth state serves both subjects: `Login` reads `sendCode` and
// `verifyCode`; `ProtectedRoute` (same module) reads `user`/`loading`.
const authState = { user: null, loading: false, sendCode: vi.fn(), verifyCode: vi.fn() };
vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }));

// The overlay's real 500 ms timer would make every assertion race a clock; the
// navigation it wraps is the subject, so it runs straight through.
vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (cb) => cb() }),
}));

// `toast(...)` itself is the neutral notice (a "too soon" is neither a success
// nor an error), so the mock is callable as well as carrying the two flavours.
vi.mock('react-hot-toast', () => {
  const plain = vi.fn();
  plain.error = vi.fn();
  plain.success = vi.fn();
  return { default: plain };
});

const toast = (await import('react-hot-toast')).default;
const Login = (await import('./Login')).default;
const { PublicRoute } = await import('../components/common/ProtectedRoute');
const { GYM_DOOR, MEMBER_DOOR, readDoor } = await import('./landingRoute');

/** A refusal shaped the way axios hands it back — the server's words are the
 *  thing the screen must show. */
const refusal = (status, error, message, extra = {}) =>
  Object.assign(new Error(message), { response: { status, data: { error, message, ...extra } } });

// Landing markers. Asserting on these rather than on a spied `useNavigate` means
// the real router resolves the real path — a destination that does not exist as
// a route would fail here rather than pass as a string comparison.
const drawLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
        <Route path="/console" element={<p>GYM CONSOLE</p>} />
        <Route path="/onboarding" element={<p>SET UP YOUR PROFILE</p>} />
      </Routes>
    </MemoryRouter>,
  );

const drawPublicRoute = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <p>THE LOGIN FORM</p>
            </PublicRoute>
          }
        />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
        <Route path="/console" element={<p>GYM CONSOLE</p>} />
        <Route path="/onboarding" element={<p>SET UP YOUR PROFILE</p>} />
      </Routes>
    </MemoryRouter>,
  );

const TRAIN = 'Train';
const MANAGE = 'Manage my gym, studio or clients';
const pressDoor = (label) => fireEvent.click(screen.getByText(label));

const typeEmail = (value = 'kd@example.com') =>
  fireEvent.change(document.querySelector('input[autocomplete="email"]'), { target: { value } });

const askForCode = async (email) => {
  typeEmail(email);
  fireEvent.click(screen.getByText('Continue with email'));
  await screen.findByText('6-digit code');
};

const typeCode = (value) =>
  fireEvent.change(document.querySelector('input[autocomplete="one-time-code"]'), { target: { value } });

const signIn = async () => {
  await askForCode();
  typeCode('123456');
  fireEvent.click(screen.getByText('Continue'));
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  authState.user = null;
  authState.loading = false;
  authState.sendCode = vi.fn().mockResolvedValue({ resendAfterSeconds: 60, expiresInSeconds: 600 });
  authState.verifyCode = vi.fn().mockResolvedValue({ user: { id: 'u1', onboardingCompleted: true }, isNewAccount: false });
});

afterEach(() => cleanup());

// ── The door on screen ──────────────────────────────────────────────────────

describe('the Get started screen asks which door you came for', () => {
  it('offers Train and Manage, with Train chosen by default', () => {
    drawLogin();
    expect(screen.getByText(TRAIN).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(MANAGE).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps ONE email box whichever door is pressed, and NO password box at all', () => {
    // Two DOORS, one ACCOUNT: the door must not turn into a second form. And
    // the password is gone from this screen entirely (Kd 2026-09-07).
    drawLogin();
    pressDoor(MANAGE);
    expect(document.querySelectorAll('input[autocomplete="email"]').length).toBe(1);
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0);
    expect(screen.queryByText(/forgot password/i)).toBeNull();
    expect(screen.queryByText(/create an account/i)).toBeNull();
  });

  it('still offers Google as the second way in', () => {
    drawLogin();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
  });
});

// ── Address, then code ──────────────────────────────────────────────────────

describe('from the address to the code', () => {
  it('asks the server for a code for the typed address and moves to the code step', async () => {
    drawLogin();
    await askForCode('  Kd@Example.com ');
    expect(authState.sendCode).toHaveBeenCalledWith('Kd@Example.com');
    expect(screen.getByText(/we sent a 6-digit code to/i)).toBeTruthy();
    expect(screen.getByText('Kd@Example.com')).toBeTruthy();
    // The screen never invents the countdown — it shows the server's number.
    expect(screen.getByText('Resend code in 60s')).toBeTruthy();
    expect(screen.getByText('Resend code in 60s').hasAttribute('disabled')).toBe(true);
  });

  it('refuses to ask with an empty address', () => {
    drawLogin();
    fireEvent.click(screen.getByText('Continue with email'));
    expect(authState.sendCode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/type your email/i);
  });

  it("shows the server's own words when a code cannot be sent, and stays on the address", async () => {
    authState.sendCode = vi.fn().mockRejectedValue(
      refusal(429, 'code_limit', 'You have asked for too many codes today. Try again in about 23 hours.'),
    );
    drawLogin();
    typeEmail();
    fireEvent.click(screen.getByText('Continue with email'));
    expect((await screen.findByRole('alert')).textContent).toContain('too many codes today');
    expect(screen.queryByText('6-digit code')).toBeNull();
  });

  it('"too soon" goes to the code box with the SERVER\'s countdown, and claims only the wait — never that a code was sent', async () => {
    // "Use a different email" then the same address inside the gap must not
    // strand the person on the address step: usually a live code is in their
    // inbox, and waiting the gap out would spend a code they never needed.
    // But the server refuses the same way when the last code has ALREADY
    // signed someone in (laptop, then phone inside the minute), and it cannot
    // say which without revealing that the address has an account. So the
    // header may say a code was asked for, and nothing more.
    authState.sendCode = vi.fn().mockRejectedValue(
      refusal(429, 'code_too_soon', 'Please wait 37 seconds before asking for a new code.', { retryAfterSeconds: 37 }),
    );
    drawLogin();
    typeEmail();
    fireEvent.click(screen.getByText('Continue with email'));
    expect(await screen.findByText('6-digit code')).toBeTruthy();
    expect(screen.getByText('Resend code in 37s')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/less than a minute ago/i)).toBeTruthy();
    expect(screen.getByText('kd@example.com')).toBeTruthy();
    expect(screen.queryByText(/we sent/i)).toBeNull();
    expect(screen.queryByText(/still valid/i)).toBeNull();
  });

  it('after a "too soon" arrival the header stops saying "a minute ago" once the countdown ends, and a Resend that really sends flips it to "we sent"', async () => {
    // The smallest wait the server can hand out is one second (it never says
    // zero), so the countdown is left to tick out for real: "less than a
    // minute ago" must go with it, or the line is false for as long as the
    // person leaves the tab open.
    authState.sendCode = vi
      .fn()
      .mockRejectedValueOnce(
        refusal(429, 'code_too_soon', 'Please wait 1 second before asking for a new code.', { retryAfterSeconds: 1 }),
      )
      .mockResolvedValueOnce({ resendAfterSeconds: 60, expiresInSeconds: 600 });
    drawLogin();
    typeEmail();
    fireEvent.click(screen.getByText('Continue with email'));
    expect(await screen.findByText(/less than a minute ago/i)).toBeTruthy();
    expect(screen.getByText('Resend code in 1s').hasAttribute('disabled')).toBe(true);

    const resend = await screen.findByText('Resend code', {}, { timeout: 4000 });
    expect(resend.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/less than a minute ago/i)).toBeNull();
    expect(screen.getByText(/type the 6-digit code for/i)).toBeTruthy();
    expect(screen.getByText('kd@example.com')).toBeTruthy();

    fireEvent.click(resend);
    expect(await screen.findByText(/we sent a 6-digit code to/i)).toBeTruthy();
    expect(screen.queryByText(/type the 6-digit code for/i)).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('New code sent.');
  }, 10_000);

  it('offers Resend at once when the server says so, asks again on press, and says a new code was sent', async () => {
    authState.sendCode = vi.fn().mockResolvedValue({ resendAfterSeconds: 0, expiresInSeconds: 600 });
    drawLogin();
    await askForCode();
    const resend = screen.getByText('Resend code');
    expect(resend.hasAttribute('disabled')).toBe(false);
    fireEvent.click(resend);
    await waitFor(() => expect(authState.sendCode).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalledWith('New code sent.');
  });

  it('Resend refused as "too soon" says only that a code was asked for inside the minute — not "sent", not "still valid"', async () => {
    // Two tabs on the same address: this tab's countdown has ended, the other
    // tab asked inside the gap, the server refuses, so no new code was sent.
    // The other tab's code may be unused or may have signed them in already;
    // the notice must not claim either.
    authState.sendCode = vi
      .fn()
      .mockResolvedValueOnce({ resendAfterSeconds: 0, expiresInSeconds: 600 })
      .mockRejectedValueOnce(
        refusal(429, 'code_too_soon', 'Please wait 41 seconds before asking for a new code.', { retryAfterSeconds: 41 }),
      );
    drawLogin();
    await askForCode();
    fireEvent.click(screen.getByText('Resend code'));
    expect(await screen.findByText('Resend code in 41s')).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    const [notice] = toast.mock.calls[0];
    expect(notice).toMatch(/less than a minute ago/i);
    expect(notice).not.toMatch(/still valid|sent/i);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('6-digit code')).toBeTruthy();
    // The header flips from "we sent" to the same claim as the toast, and no
    // more than that.
    expect(screen.getByText(/you asked for a code for/i)).toBeTruthy();
    expect(screen.getByText(/less than a minute ago/i)).toBeTruthy();
    expect(screen.queryByText(/we sent/i)).toBeNull();
    expect(screen.queryByText(/still valid/i)).toBeNull();
  });

  it('"Use a different email" goes back to the address step', async () => {
    drawLogin();
    await askForCode();
    fireEvent.click(screen.getByText('Use a different email'));
    expect(document.querySelector('input[autocomplete="email"]')).toBeTruthy();
    expect(screen.queryByText('6-digit code')).toBeNull();
  });

  it('keeps only digits in the code box, six at most', async () => {
    drawLogin();
    await askForCode();
    typeCode('12ab34-5678');
    expect(document.querySelector('input[autocomplete="one-time-code"]').value).toBe('123456');
  });

  it("a refused code shows the server's words (the tries left) and stays on the code step", async () => {
    authState.verifyCode = vi.fn().mockRejectedValue(
      refusal(400, 'invalid_code', 'That code is not right. You have 4 tries left.'),
    );
    drawLogin();
    await signIn();
    expect((await screen.findByRole('alert')).textContent).toContain('4 tries left');
    expect(screen.getByText('6-digit code')).toBeTruthy();
    expect(screen.queryByText('MEMBER APP')).toBeNull();
  });
});

// ── Where a proved code ends up ─────────────────────────────────────────────

describe('the door decides where a proved code ends up', () => {
  it('sends the typed address and code to the server', async () => {
    drawLogin();
    await signIn();
    await waitFor(() => expect(authState.verifyCode).toHaveBeenCalledWith('kd@example.com', '123456'));
  });

  it('takes the Manage door to the console', async () => {
    drawLogin();
    pressDoor(MANAGE);
    await signIn();
    expect(await screen.findByText('GYM CONSOLE')).toBeTruthy();
  });

  it('takes the Train door to the app', async () => {
    drawLogin();
    await signIn();
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('sends a brand-new Train sign-in to the questionnaire first, and says the account is ready', async () => {
    // A new account has no profile, so the gate reads false — straight to
    // onboarding, as the ROADMAP says ("signed in at once, straight to onboarding").
    authState.verifyCode = vi.fn().mockResolvedValue({ user: { id: 'u1', onboardingCompleted: false }, isNewAccount: true });
    drawLogin();
    await signIn();
    expect(await screen.findByText('SET UP YOUR PROFILE')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/account is ready/i));
  });

  it('a returning sign-in is NOT greeted as a new account', async () => {
    drawLogin();
    await signIn();
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('takes a brand-new Manage sign-in straight to the console — the questionnaire waits', async () => {
    // Kd amendment 2026-08-19: the wizard is the member app's gate, not the
    // account's. A new owner gets their business screens first.
    authState.verifyCode = vi.fn().mockResolvedValue({ user: { id: 'u1', onboardingCompleted: false }, isNewAccount: true });
    drawLogin();
    pressDoor(MANAGE);
    await signIn();
    expect(await screen.findByText('GYM CONSOLE')).toBeTruthy();
  });
});

// ── Surviving a reload ──────────────────────────────────────────────────────

describe('the door survives leaving the page', () => {
  it('is remembered across a reload, so Continue with Google comes back to it', async () => {
    // Google sign-in leaves the site entirely, so a door held only in React
    // state is gone by the time the person comes back — and the button would
    // have promised the console and delivered the member app.
    drawLogin();
    pressDoor(MANAGE);
    expect(readDoor()).toBe(GYM_DOOR);

    cleanup();
    drawLogin();
    await waitFor(() =>
      expect(screen.getByText(MANAGE).getAttribute('aria-pressed')).toBe('true'),
    );
  });

  it('records the Train door when it is pressed back', () => {
    drawLogin();
    pressDoor(MANAGE);
    pressDoor(TRAIN);
    expect(readDoor()).toBe(MEMBER_DOOR);
  });
});

// ── Coming back already signed in ───────────────────────────────────────────

describe('landing on the Get started page while already signed in', () => {
  it('follows the door rather than always the dashboard', async () => {
    authState.user = { id: 'u1', onboardingCompleted: true };
    window.sessionStorage.setItem('aihg_login_door', GYM_DOOR);
    drawPublicRoute();
    expect(await screen.findByText('GYM CONSOLE')).toBeTruthy();
  });

  it('goes to the member app when no door was chosen', async () => {
    authState.user = { id: 'u1', onboardingCompleted: true };
    drawPublicRoute();
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('still shows the form to somebody with no session', () => {
    drawPublicRoute();
    expect(screen.getByText('THE LOGIN FORM')).toBeTruthy();
  });
});
