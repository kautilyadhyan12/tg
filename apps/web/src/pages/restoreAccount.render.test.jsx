// The deletion email's undo page (Part 4 §5.2), in a browser-shaped test.
// Landing does nothing; the button restores; the server's words are shown
// when the link is dead; a link with no token cannot be pressed.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = { restoreAccount: vi.fn() };
vi.mock('../api/authApi', () => ({ authService: api }));

const RestoreAccount = (await import('./RestoreAccount')).default;

const draw = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/restore-account" element={<RestoreAccount />} />
        <Route path="/login" element={<p>GET STARTED</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  api.restoreAccount = vi.fn().mockResolvedValue({ data: { message: 'Account restored. You can now log in.' } });
});
afterEach(() => cleanup());

describe('the restore page', () => {
  it('does NOTHING on landing — a prefetching mail client cannot undo a deletion', () => {
    draw('/restore-account?token=abc123');
    expect(api.restoreAccount).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /restore my account/i })).toBeTruthy();
  });

  it('restores with the token from the link when the button is pressed', async () => {
    draw('/restore-account?token=abc123');
    fireEvent.click(screen.getByRole('button', { name: /restore my account/i }));
    await waitFor(() => expect(api.restoreAccount).toHaveBeenCalledWith('abc123'));
    expect(await screen.findByText(/your account is back/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Sign in'));
    expect(await screen.findByText('GET STARTED')).toBeTruthy();
  });

  it("shows the server's words when the link is dead, and stays on the page", async () => {
    api.restoreAccount = vi.fn().mockRejectedValue(
      Object.assign(new Error('x'), { response: { status: 400, data: { message: 'Invalid or expired restore token' } } }),
    );
    draw('/restore-account?token=stale');
    fireEvent.click(screen.getByRole('button', { name: /restore my account/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('expired');
    expect(screen.queryByText(/your account is back/i)).toBeNull();
  });

  it('a link with no token cannot be pressed, and says why', () => {
    draw('/restore-account');
    expect(screen.getByRole('button', { name: /restore my account/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/missing its token/i);
  });
});
