// A MEMBER'S INVITE PAGE, drawn (ROADMAP 20e-ii-a). Only the network and the robot check
// are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
const INVITE = {
  gymName: 'Iron House',
  inviterFirstName: 'Maya',
  city: 'Leeds',
  orgType: 'gym',
  friendGift: { words: '20% off a membership' },
  pageSlug: null,
  robotCheckKey: 'k',
};

const draw = () =>
  render(
    <MemoryRouter initialEntries={[`/invite/${CODE}`]}>
      <Routes>
        <Route path="/invite/:code" element={<InvitePage />} />
      </Routes>
    </MemoryRouter>,
  );
const fill = (name, email) => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: email } });
};

beforeEach(() => {
  getPublicInvite.mockReset();
  sendInviteEnquiry.mockReset();
});
afterEach(cleanup);

describe('the invite page', () => {
  it('says who invited them by first name, the business and its welcome offer, with no code to remember, and asks nothing the link already says', async () => {
    getPublicInvite.mockResolvedValue({ data: { invite: INVITE } });
    draw();
    await screen.findByRole('heading', { name: 'Maya invited you to join Iron House.' });
    const ticket = within(screen.getByRole('region', { name: 'Your welcome offer' }));
    expect(ticket.getByText('20% off a membership')).toBeTruthy();
    expect(ticket.getByText('Iron House adds it for you when you join.')).toBeTruthy();
    expect(screen.queryByText(/code/i)).toBeNull();
    expect(screen.getByText('Join, and your offer comes off')).toBeTruthy();
    expect(screen.getByText('This offer is set by Iron House and may change.')).toBeTruthy();
    expect(screen.queryByLabelText('How did you hear about us?')).toBeNull();
    expect(screen.getByLabelText('Phone (optional)')).toBeTruthy();
    // No page of its own: no link to one.
    expect(screen.queryByRole('link', { name: /page/ })).toBeNull();
  });

  it('an email address is needed, and with one the form goes to this link, without a source, and thanks them', async () => {
    getPublicInvite.mockResolvedValue({ data: { invite: { ...INVITE, pageSlug: 'iron-house' } } });
    sendInviteEnquiry.mockResolvedValue({ data: { received: true } });
    draw();
    await screen.findByRole('heading', { name: 'Maya invited you to join Iron House.' });
    expect(screen.getByRole('link', { name: "See Iron House's page" }).getAttribute('href')).toBe('/gyms/iron-house');
    fill('Tara Friend', '');
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '+447700900123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send my details' }));
    expect(await screen.findByText('Add your email address.')).toBeTruthy();
    expect(sendInviteEnquiry).not.toHaveBeenCalled();

    fill('Tara Friend', 'tara@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send my details' }));
    await screen.findByText('Thanks, Tara.');
    expect(sendInviteEnquiry).toHaveBeenCalledWith(CODE, { fullName: 'Tara Friend', email: 'tara@example.com', phone: '+447700900123', robotToken: 'robot-ok' });
  });

  it('with no gift for the friend and no name to say, promises nothing and names nobody', async () => {
    getPublicInvite.mockResolvedValue({ data: { invite: { ...INVITE, friendGift: null, inviterFirstName: null } } });
    draw();
    await screen.findByRole('heading', { name: 'A member of Iron House has invited you.' });
    expect(screen.queryByText(/welcome offer/i)).toBeNull();
    expect(screen.queryByText(/This offer is set by/)).toBeNull();
    expect(screen.getByText('Join and start training')).toBeTruthy();
    expect(screen.getByText('Leave your details and Iron House will be in touch.')).toBeTruthy();
  });

  it('a link that does not work says so in plain words', async () => {
    getPublicInvite.mockRejectedValue({ response: { status: 404, data: { message: REFERRAL_WORDS.not_found } } });
    draw();
    await screen.findByText(REFERRAL_WORDS.not_found);
    expect(screen.queryByRole('button', { name: 'Send my details' })).toBeNull();
  });
});
