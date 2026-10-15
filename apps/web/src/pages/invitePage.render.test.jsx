// A MEMBER'S INVITE PAGE, drawn (ROADMAP 20e-ii-a). Only the network and the robot check
// are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { REFERRAL_WORDS } from '@app/shared';

const getPublicInvite = vi.fn();
const sendInviteEnquiry = vi.fn();
vi.mock('../api/orgsApi', () => ({
  orgService: { getPublicInvite, sendInviteEnquiry },
  errorCode: (err) => err?.response?.data?.error,
  errorStatus: (err) => err?.response?.status,
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
  gymPhotoUrl: () => '',
}));
vi.mock('./useRobotCheck', () => ({
  useRobotCheck: () => ({ boxRef: { current: null }, token: 'robot-ok', failed: false, blocked: false, reset: () => undefined }),
}));

const InvitePage = (await import('./InvitePage')).default;

const CODE = 'abcdefghijklmnop';
const INVITE = { gymName: 'Iron House', city: 'Leeds', orgType: 'gym', friendGift: { code: 'WELCOME20', words: '20% off a membership' }, pageSlug: null, robotCheckKey: 'k' };

const draw = () =>
  render(
    <MemoryRouter initialEntries={[`/invite/${CODE}`]}>
      <Routes>
        <Route path="/invite/:code" element={<InvitePage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  getPublicInvite.mockReset();
  sendInviteEnquiry.mockReset();
});
afterEach(cleanup);

describe('the invite page', () => {
  it('names the business and its welcome offer with its code, never the member, and asks nothing the link already says', async () => {
    getPublicInvite.mockResolvedValue({ data: { invite: INVITE } });
    draw();
    await screen.findByRole('heading', { name: 'Iron House' });
    expect(screen.getByText('A member of Iron House has invited you.')).toBeTruthy();
    expect(screen.getByText('Your welcome offer: 20% off a membership. Use code WELCOME20 when you join.')).toBeTruthy();
    expect(screen.getByText('WELCOME20')).toBeTruthy();
    expect(screen.getByText('This offer is set by Iron House and may change.')).toBeTruthy();
    expect(screen.queryByLabelText('How did you hear about us?')).toBeNull();
    // No page of its own: no link to one.
    expect(screen.queryByRole('link', { name: /page/ })).toBeNull();
  });

  it('sends the form to this link, without a source, and thanks them', async () => {
    getPublicInvite.mockResolvedValue({ data: { invite: { ...INVITE, pageSlug: 'iron-house' } } });
    sendInviteEnquiry.mockResolvedValue({ data: { received: true } });
    draw();
    await screen.findByRole('heading', { name: 'Iron House' });
    expect(screen.getByRole('link', { name: "See Iron House's page" }).getAttribute('href')).toBe('/gyms/iron-house');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tara Friend' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'tara@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Thanks, Tara.');
    expect(sendInviteEnquiry).toHaveBeenCalledWith(CODE, { fullName: 'Tara Friend', email: 'tara@example.com', robotToken: 'robot-ok' });
  });

  it('with no gift for the friend, promises nothing', async () => {
    getPublicInvite.mockResolvedValue({ data: { invite: { ...INVITE, friendGift: null } } });
    draw();
    await screen.findByRole('heading', { name: 'Iron House' });
    expect(screen.queryByText(/welcome offer/)).toBeNull();
    expect(screen.queryByText(/This offer is set by/)).toBeNull();
    expect(screen.getByText('Leave your details and Iron House will be in touch.')).toBeTruthy();
  });

  it('a link that does not work says so in plain words', async () => {
    getPublicInvite.mockRejectedValue({ response: { status: 404, data: { message: REFERRAL_WORDS.not_found } } });
    draw();
    await screen.findByText(REFERRAL_WORDS.not_found);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });
});
