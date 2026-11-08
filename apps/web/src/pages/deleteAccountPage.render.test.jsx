// The website's Delete your account page (21b-ii), the web address Google Play asks for.
//
// The worst thing this page could do: delete with no code, or say an account is being deleted when the
// server did not delete it. So Delete sends only the address and the code typed, and the page says
// "being deleted" only on the server's answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DELETE_PAGE_WORDS as W, KEPT_AFTER_DELETION, LEGAL_PATHS } from '@app/shared';
import { isSignedOutPage } from '../api/authApi';

vi.mock('../api/deleteAccountApi', () => ({ deleteAccountService: { sendCode: vi.fn(), deleteAccount: vi.fn() } }));

const { deleteAccountService } = await import('../api/deleteAccountApi');
const DeleteAccountPage = (await import('./DeleteAccountPage')).default;

const EMAIL = 'maya@gmail.com';
const SENT = { message: W.sent(EMAIL), resendAfterSeconds: 60, expiresInSeconds: 600 };
const apiError = (status, error, message) => Object.assign(new Error(error), { response: { status, data: { error, message } } });

const draw = () =>
  render(
    <MemoryRouter initialEntries={[LEGAL_PATHS.deleteAccount]}>
      <Routes>
        <Route path={LEGAL_PATHS.deleteAccount} element={<DeleteAccountPage />} />
        <Route path="/login" element={<p>GET STARTED</p>} />
      </Routes>
    </MemoryRouter>,
  );

const typeEmailAndSend = async () => {
  fireEvent.change(screen.getByLabelText(W.emailLabel), { target: { value: ` ${EMAIL} ` } });
  fireEvent.click(screen.getByRole('button', { name: W.sendButton }));
  await screen.findByText(W.sent(EMAIL));
};
const typeCode = (code) => fireEvent.change(screen.getByLabelText(W.codeLabel), { target: { value: code } });

beforeEach(() => {
  vi.clearAllMocks();
  deleteAccountService.sendCode.mockResolvedValue(SENT);
  deleteAccountService.deleteAccount.mockResolvedValue({ message: W.doneUndo, emailSent: true });
});
afterEach(() => {
  cleanup();
});

describe('the Delete your account page', () => {
  it('opens signed out, and shows the steps in the app, what happens and what is kept', () => {
    expect(isSignedOutPage(LEGAL_PATHS.deleteAccount)).toBe(true);
    draw();
    expect(screen.getByRole('heading', { level: 1, name: W.title })).toBeTruthy();
    const page = document.body.textContent ?? '';
    const lines = [...W.inAppSteps, ...W.whatHappens, ...KEPT_AFTER_DELETION.flatMap((k) => [k.what, k.howLong]), W.ownerLine];
    expect(lines.filter((line) => !page.includes(line))).toEqual([]);
    expect(screen.getByRole('link', { name: W.keptMore }).getAttribute('href')).toBe(`${LEGAL_PATHS.privacy}#how-long`);
  });

  it('THE WORST THING: Delete waits for six digits, sends only the address and code typed, and says "being deleted" only on the answer', async () => {
    deleteAccountService.deleteAccount.mockReturnValue(new Promise(() => {}));
    draw();
    await typeEmailAndSend();
    expect(deleteAccountService.sendCode).toHaveBeenCalledWith(EMAIL, undefined);
    const del = screen.getByRole('button', { name: W.deleteButton });
    typeCode('12a45');
    expect(screen.getByLabelText(W.codeLabel).value).toBe('1245');
    expect(del.disabled).toBe(true);
    fireEvent.click(del);
    expect(deleteAccountService.deleteAccount).not.toHaveBeenCalled();
    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: W.deleteButton }));
    expect(deleteAccountService.deleteAccount).toHaveBeenCalledWith(EMAIL, '123456');
    expect(screen.queryByText(W.doneTitle)).toBeNull();
  });

  it('on the answer, says the account is being deleted and how to undo it', async () => {
    draw();
    await typeEmailAndSend();
    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: W.deleteButton }));
    const done = (await screen.findByText(W.doneTitle)).closest('[role="status"]');
    expect(within(done).getByText(W.doneUndo)).toBeTruthy();
    expect(screen.queryByLabelText(W.codeLabel)).toBeNull();
  });

  it('a wrong code says so and clears the box; the address can be changed', async () => {
    deleteAccountService.deleteAccount.mockRejectedValue(apiError(400, 'invalid_code', 'That code didn’t work. Check it and try again, or ask for a new one.'));
    draw();
    await typeEmailAndSend();
    typeCode('111111');
    fireEvent.click(screen.getByRole('button', { name: W.deleteButton }));
    expect((await screen.findByRole('alert')).textContent).toBe('That code didn’t work. Check it and try again, or ask for a new one.');
    expect(screen.getByLabelText(W.codeLabel).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: W.otherEmail }));
    expect(screen.getByLabelText(W.emailLabel).value).toBe(EMAIL);
  });

  it('a gym owner is told to hand the gym over, with the way to sign in', async () => {
    const line = 'You own Iron House. Before you delete your account, make someone else its owner.';
    deleteAccountService.deleteAccount.mockRejectedValue(apiError(409, 'owns_gym', line));
    draw();
    await typeEmailAndSend();
    typeCode('123456');
    fireEvent.click(screen.getByRole('button', { name: W.deleteButton }));
    expect((await screen.findByRole('alert')).textContent).toBe(line);
    fireEvent.click(screen.getByRole('link', { name: W.ownerNext }));
    expect(await screen.findByText('GET STARTED')).toBeTruthy();
  });

  it('asks for the robot check when the server does, and shows the box', async () => {
    deleteAccountService.sendCode.mockRejectedValueOnce(
      Object.assign(new Error('robot'), { response: { status: 403, data: { error: 'robot_check', message: 'One quick check', robotCheckKey: 'k' } } }),
    );
    draw();
    fireEvent.change(screen.getByLabelText(W.emailLabel), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: W.sendButton }));
    expect(await screen.findByTestId('robot-check')).toBeTruthy();
    expect(screen.getByText('One quick check')).toBeTruthy();
    expect(screen.queryByLabelText(W.codeLabel)).toBeNull();
  });

  it('an address that is not one is refused on the page, and nothing is sent', () => {
    draw();
    fireEvent.change(screen.getByLabelText(W.emailLabel), { target: { value: 'maya' } });
    fireEvent.click(screen.getByRole('button', { name: W.sendButton }));
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address.');
    expect(deleteAccountService.sendCode).not.toHaveBeenCalled();
  });
});
