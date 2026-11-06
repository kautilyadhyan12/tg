// The page "Undo this change" opens (item 19's security pass, H1; Kd 2026-11-06).
//
// The worst thing this page could do: undo a change nobody pressed for (a mail program opening the link),
// or say the account is back when it is not. So landing only reads; the button alone undoes, with the
// token from the link; and the page says "back" only on the server's answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EMAIL_CHANGE_WORDS as W } from '@app/shared';

vi.mock('../api/emailChangeLinkApi', () => ({ emailChangeLinkService: { read: vi.fn(), undo: vi.fn() } }));

const { emailChangeLinkService } = await import('../api/emailChangeLinkApi');
const UndoEmailChange = (await import('./UndoEmailChange')).default;
const { undoTokenFromHash } = await import('./undoEmailChangeView');

const TOKEN = 'a1'.repeat(32);
const OPEN = { state: 'open', oldEmail: 'maya@gmail.com', newEmail: 't***@example.com', supportEmail: 'help@kwazo.example' };
const apiError = (status, error, message) => Object.assign(new Error(error), { response: { status, data: { error, message } } });

const draw = (hash = `#${TOKEN}`) => {
  window.history.replaceState(null, '', `/undo-email-change${hash}`);
  return render(
    <MemoryRouter initialEntries={['/undo-email-change']}>
      <Routes>
        <Route path="/undo-email-change" element={<UndoEmailChange />} />
        <Route path="/login" element={<p>GET STARTED</p>} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  emailChangeLinkService.read.mockResolvedValue(OPEN);
  emailChangeLinkService.undo.mockResolvedValue({ state: 'done', oldEmail: 'maya@gmail.com' });
});
afterEach(() => {
  cleanup();
});

describe('the token in the link', () => {
  it('is read only in our shape', () => {
    expect(undoTokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(undoTokenFromHash(`#${TOKEN.slice(0, 63)}`)).toBeNull();
    expect(undoTokenFromHash(`#${TOKEN.toUpperCase()}`)).toBeNull();
    expect(undoTokenFromHash('#<script>')).toBeNull();
    expect(undoTokenFromHash('')).toBeNull();
  });

  it('with no token, says to open the email again and asks nothing of the server', () => {
    draw('');
    expect(screen.getByText(W.notValid)).toBeTruthy();
    expect(emailChangeLinkService.read).not.toHaveBeenCalled();
  });

  it('takes the token out of the address bar at once', async () => {
    draw();
    await screen.findByText(W.open(OPEN.oldEmail, OPEN.newEmail));
    expect(window.location.hash).toBe('');
    expect(emailChangeLinkService.read).toHaveBeenCalledWith(TOKEN);
  });
});

describe('the worst thing: nothing is undone that nobody pressed for, and "back" only on the server\'s word', () => {
  it('landing reads and undoes nothing; the button undoes with the link\'s token, and the page then says so', async () => {
    draw();
    expect(await screen.findByText(W.open(OPEN.oldEmail, OPEN.newEmail))).toBeTruthy();
    expect(screen.getByRole('heading', { name: W.openTitle })).toBeTruthy();
    expect(screen.getByText(W.nothingYet)).toBeTruthy();
    expect(emailChangeLinkService.undo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: W.button }));
    await waitFor(() => expect(emailChangeLinkService.undo).toHaveBeenCalledWith(TOKEN));
    expect(await screen.findByRole('heading', { name: W.doneTitle })).toBeTruthy();
    expect(screen.getByText(W.done('maya@gmail.com'))).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.getByText(W.phone)).toBeTruthy();
  });

  it('a refusal keeps the button and says why; it never says the account is back', async () => {
    emailChangeLinkService.undo.mockRejectedValue(apiError(409, 'email_in_use', `${W.taken} ${W.writeToUs('help@kwazo.example')}`));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: W.button }));
    expect(await screen.findByText(`${W.taken} ${W.writeToUs('help@kwazo.example')}`)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: W.doneTitle })).toBeNull();
    expect(screen.getByRole('button', { name: W.button })).toBeTruthy();
  });

  it('a link that ran out while the page was open says so, with where to write', async () => {
    emailChangeLinkService.undo.mockRejectedValue(apiError(409, 'link_closed', 'closed'));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: W.button }));
    expect(await screen.findByRole('heading', { name: W.closedTitle })).toBeTruthy();
    expect(screen.getByText(W.writeToUs('help@kwazo.example'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: W.button })).toBeNull();
  });
});

describe('what the server says the link is', () => {
  it('already undone: says the account is back, with no button', async () => {
    emailChangeLinkService.read.mockResolvedValue({ state: 'done', oldEmail: 'maya@gmail.com' });
    draw();
    expect(await screen.findByText(W.done('maya@gmail.com'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: W.button })).toBeNull();
  });

  it('run out: says so, and where to write only where there is an address', async () => {
    emailChangeLinkService.read.mockResolvedValue({ state: 'closed', supportEmail: null });
    draw();
    expect(await screen.findByText(W.closed)).toBeTruthy();
    expect(screen.queryByText(/write to us/)).toBeNull();
  });

  it('unknown to the server: not valid, with no button', async () => {
    emailChangeLinkService.read.mockRejectedValue(apiError(404, 'link_not_valid', W.notValid));
    draw();
    expect(await screen.findByText(W.notValid)).toBeTruthy();
    expect(screen.queryByRole('button', { name: W.button })).toBeNull();
  });

  it('no answer: Try again reads it again', async () => {
    emailChangeLinkService.read.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    draw();
    expect(await screen.findByText("We couldn't load this page. Try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(W.open(OPEN.oldEmail, OPEN.newEmail))).toBeTruthy();
    expect(emailChangeLinkService.read).toHaveBeenCalledTimes(2);
  });
});
