// Members → Staff in the third look (ROADMAP V3b-ii): the list with initials, a staff
// member's panel from the right with Save permissions at its foot, Invite staff from the
// right, and the box naming booked personal training on top of everything.
//
// The first tests are the job's worst thing: the panel pressed is that person's, and Save
// permissions or Remove from staff changes them alone, never a colleague with the same
// family name, and never the owner.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getApplications: vi.fn(),
      getNotMe: vi.fn(),
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getStaff: vi.fn(),
      inviteStaff: vi.fn(),
      getStaffInvites: vi.fn(),
      cancelStaffInvite: vi.fn(),
      resendStaffInvite: vi.fn(),
      getStaffRoles: vi.fn(),
      createStaffRole: vi.fn(),
      deleteStaffRole: vi.fn(),
      updateStaffRole: vi.fn(),
      updateStaffPrivileges: vi.fn(),
      removeStaff: vi.fn(),
      removeMember: vi.fn(),
    },
  };
});

const activity = { list: vi.fn() };
vi.mock('../../api/staffActivityApi', () => ({ staffActivityService: activity }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Members = (await import('./Members')).default;

const ORG = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  country: 'US',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: 'owner',
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
};

const OWNER = { userId: 'u1', displayName: 'Kd Owner', email: 'kd@example.com', role: 'owner', since: '2026-08-18T09:00:00.000Z', isYou: true, isMember: true };
// Two of one family: the panel and every change must be the one pressed.
const RITA = { userId: 'u2', displayName: 'Rita Sen', email: 'rita@example.com', role: 'manager', since: '2026-08-20T09:00:00.000Z', isYou: false, isMember: true, privileges: ['members.read'] };
const MIRA = { userId: 'u3', displayName: 'Mira Sen', email: 'mira@example.com', role: 'trainer', since: '2026-08-21T09:00:00.000Z', isYou: false, isMember: false, privileges: ['members.read'] };

const INVITE = {
  id: '6f1c2b8e-0a4d-4f7e-9b1a-2c3d4e5f6a7b',
  email: 'sameer.coach@example.com',
  role: 'trainer',
  invitedAt: '2026-10-01T09:00:00.000Z',
  expiresAt: '2026-10-08T09:00:00.000Z',
  state: 'waiting',
  declinedAt: null,
  emailStatus: 'sent',
  emailReason: null,
  lastSentAt: '2026-10-01T09:00:00.000Z',
  resendsLeft: 3,
  sendAgainFrom: null,
};

const drawStaff = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/members?view=staff']}>
      <Routes>
        <Route path="/console/:orgSlug/members" element={<Members />} />
      </Routes>
    </MemoryRouter>,
  );

const openPerson = async (id, name) => {
  fireEvent.click(await screen.findByTestId(`staff-tab-${id}`));
  return within(await screen.findByRole('dialog', { name }));
};

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  orgService.getMembers.mockResolvedValue({ data: { items: [], nextCursor: null } });
  orgService.getApplications.mockResolvedValue({ data: { items: [], nextCursor: null, pendingCount: 0 } });
  orgService.getNotMe.mockResolvedValue({ data: { items: [] } });
  orgService.getMemberList.mockResolvedValue({
    data: { list: { hasList: false, version: 0, lastConfirmedAt: null, counts: { entries: 0, inApp: 0, canBeInvited: 0, noEmail: 0, former: 0 }, statuses: [], membershipTypes: [], paymentStatuses: [], fields: [], appWords: [] } },
  });
  orgService.getMemberListEntries.mockResolvedValue({ data: { page: { total: 0, entries: [], cursor: null } } });
  orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, RITA, MIRA] } });
  orgService.getStaffInvites.mockResolvedValue({ data: { invites: [INVITE] } });
  orgService.getStaffRoles.mockResolvedValue({ data: { roles: [] } });
  orgService.updateStaffPrivileges.mockResolvedValue({ data: { staff: MIRA } });
  orgService.removeStaff.mockResolvedValue({ data: { status: 'removed' } });
  orgService.removeMember.mockResolvedValue({ data: { status: 'removed' } });
  orgService.inviteStaff.mockResolvedValue({ data: { outcome: 'invited', invite: INVITE } });
  activity.list.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  cleanup();
});

describe('the worst thing: the person pressed, and only them', () => {
  it("pressing Mira Sen opens her panel beside Rita Sen's row, and Save permissions changes Mira alone", async () => {
    orgService.getStaff
      .mockResolvedValueOnce({ data: { staff: [OWNER, RITA, MIRA] } })
      .mockResolvedValue({ data: { staff: [OWNER, RITA, { ...MIRA, privileges: ['members.read', 'attendance.read'] }] } });
    drawStaff();
    const mira = await openPerson('u3', 'Mira Sen');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(mira.getByText('mira@example.com')).toBeTruthy();
    fireEvent.click(mira.getByLabelText(/^See who came in/));
    fireEvent.click(within(mira.getByTestId('privileges-foot')).getByRole('button', { name: 'Save permissions' }));
    expect(await mira.findByText('Permissions saved.')).toBeTruthy();
    expect(orgService.updateStaffPrivileges).toHaveBeenCalledTimes(1);
    expect(orgService.updateStaffPrivileges.mock.calls[0][1]).toBe('u3');
    expect([...orgService.updateStaffPrivileges.mock.calls[0][2].privileges].sort()).toEqual(['attendance.read', 'members.read']);
    expect(orgService.removeStaff).not.toHaveBeenCalled();
  });

  it('Remove from staff takes out the person whose panel is open, and nobody else', async () => {
    drawStaff();
    const mira = await openPerson('u3', 'Mira Sen');
    fireEvent.click(mira.getByRole('button', { name: 'Remove from staff' }));
    expect(orgService.removeStaff).not.toHaveBeenCalled();
    fireEvent.click(mira.getByRole('button', { name: 'Remove from staff' }));
    expect(await screen.findByText('Mira Sen was removed from staff.')).toBeTruthy();
    expect(orgService.removeStaff).toHaveBeenCalledTimes(1);
    expect(orgService.removeStaff).toHaveBeenLastCalledWith(ORG.id, 'u3');
    expect(orgService.removeMember).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the X, Escape and the page behind change nobody', async () => {
    drawStaff();
    const rita = await openPerson('u2', 'Rita Sen');
    fireEvent.mouseDown(document.querySelector('.c-scrim'));
    fireEvent.click(document.querySelector('.c-scrim'));
    expect(screen.getByRole('dialog', { name: 'Rita Sen' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const again = await openPerson('u2', 'Rita Sen');
    fireEvent.click(again.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rita).toBeTruthy();
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
    expect(orgService.removeStaff).not.toHaveBeenCalled();
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it("the owner's panel has no Save permissions and no Remove from staff", async () => {
    drawStaff();
    const owner = await openPerson('u1', 'Kd Owner');
    expect(owner.queryByTestId('privileges-foot')).toBeNull();
    expect(owner.queryByRole('button', { name: 'Save permissions' })).toBeNull();
    expect(owner.queryByRole('button', { name: 'Remove from staff' })).toBeNull();
    expect(owner.getByText(/can't be removed from staff/)).toBeTruthy();
  });
});

describe('a change not saved', () => {
  it('closing with a box changed asks first; Keep editing keeps the tick, and nothing is sent', async () => {
    drawStaff();
    const mira = await openPerson('u3', 'Mira Sen');
    fireEvent.click(mira.getByLabelText(/^See who came in/));
    expect(mira.getByText("You have changes that aren't saved.")).toBeTruthy();
    fireEvent.click(mira.getByRole('button', { name: 'Close' }));
    fireEvent.click(mira.getByRole('button', { name: 'Keep editing' }));
    expect(mira.getByLabelText(/^See who came in/).checked).toBe(true);
    fireEvent.click(mira.getByRole('button', { name: 'Close' }));
    fireEvent.click(mira.getByRole('button', { name: 'Close without saving' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
  });

  it('See activity with a box changed asks first too', async () => {
    drawStaff();
    const mira = await openPerson('u3', 'Mira Sen');
    fireEvent.click(mira.getByLabelText(/^See who came in/));
    fireEvent.click(mira.getByRole('button', { name: 'See activity' }));
    expect(screen.getByRole('dialog', { name: 'Mira Sen' })).toBeTruthy();
    expect(activity.list).not.toHaveBeenCalled();
    // Close without saving goes where See activity leads: Staff activity, showing Mira alone.
    fireEvent.click(mira.getByRole('button', { name: 'Close without saving' }));
    expect(await screen.findByRole('heading', { name: 'Staff activity' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(activity.list).toHaveBeenCalledWith(ORG.id, expect.objectContaining({ worker: 'u3' }));
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
  });
});

describe('the look', () => {
  it('what they can do is under its headings', async () => {
    drawStaff();
    const rita = await openPerson('u2', 'Rita Sen');
    const ticks = within(rita.getByTestId('privileges-u2'));
    expect(ticks.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Members', 'Front desk', 'Classes and plans', 'Money', 'Community', 'Reports']);
    expect(within(ticks.getByRole('group', { name: 'Front desk' })).getByLabelText(/^Check people in/)).toBeTruthy();
  });

  it("each row carries the person's initials, an invitation its address's", async () => {
    drawStaff();
    const row = await screen.findByTestId('staff-tab-u3');
    expect(row.querySelector('.c-avatar').textContent).toBe('MS');
    // Drawn only from 768 px, by the console's own class (jsdom draws no CSS; consoleCss.test.js holds the rule).
    expect(row.querySelector('.c-avatar').classList.contains('c-avatar-md')).toBe(true);
    expect(row.querySelector('.c-avatar').classList.contains('hidden')).toBe(false);
    expect(screen.getByTestId(`staff-invite-${INVITE.id}`).querySelector('.c-avatar').textContent).toBe('SC');
  });

  it('Invite staff opens from the right with Send invitation at its foot', async () => {
    drawStaff();
    fireEvent.click(await screen.findByRole('button', { name: 'Invite staff' }));
    const form = within(await screen.findByRole('dialog', { name: 'Invite staff' }));
    const foot = document.querySelector('.c-panel-f');
    expect(within(foot).getByRole('button', { name: 'Send invitation' })).toBeTruthy();
    fireEvent.change(form.getByLabelText('Their email address'), { target: { value: 'new@example.com' } });
    fireEvent.click(within(foot).getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText(/Invited sameer.coach@example.com/)).toBeTruthy();
    expect(orgService.inviteStaff.mock.calls[0][1].email).toBe('new@example.com');
  });
});

describe('Remove with personal training booked', () => {
  const MARK = 'd'.repeat(64);
  const asks = () =>
    Object.assign(new Error('refused'), {
      response: {
        status: 409,
        data: {
          error: 'pt_sessions_ending',
          message: 'People are booked with this trainer for personal training.',
          sessions: { count: 1, packSessions: 0, mark: MARK, sessions: [{ id: '77777777-7777-4777-8777-000000000001', personName: 'Maya Lopez', trainerName: 'Mira Sen', localDate: '2026-10-09', localStartMinute: 600, minutes: 60, packSession: false }] },
        },
      },
    });

  it("the box naming the sessions is on top: her panel closes, and the box's own button removes her", async () => {
    orgService.removeStaff.mockReset();
    orgService.removeStaff.mockRejectedValueOnce(asks()).mockResolvedValueOnce({ data: { status: 'removed' } });
    drawStaff();
    const mira = await openPerson('u3', 'Mira Sen');
    fireEvent.click(mira.getByRole('button', { name: 'Remove from staff' }));
    fireEvent.click(mira.getByRole('button', { name: 'Remove from staff' }));
    const box = within(await screen.findByTestId('pt-sessions-end-box'));
    expect(screen.queryByTestId('staff-person-panel')).toBeNull();
    expect(orgService.removeStaff).toHaveBeenCalledTimes(1);
    fireEvent.click(box.getByRole('button', { name: /Remove/ }));
    expect(await screen.findByText('Mira Sen was removed from staff.')).toBeTruthy();
    expect(orgService.removeStaff).toHaveBeenLastCalledWith(ORG.id, 'u3', { confirmPtSessions: MARK });
  });

  it('a refusal from that box is said in the box, which stays', async () => {
    orgService.removeStaff.mockReset();
    orgService.removeStaff.mockRejectedValueOnce(asks()).mockRejectedValueOnce({ response: { status: 409, data: { error: 'x', message: 'ZZ-MARKER could not remove.', requestId: 'r' } } });
    drawStaff();
    const mira = await openPerson('u3', 'Mira Sen');
    fireEvent.click(mira.getByRole('button', { name: 'Remove from staff' }));
    fireEvent.click(mira.getByRole('button', { name: 'Remove from staff' }));
    const box = within(await screen.findByTestId('pt-sessions-end-box'));
    fireEvent.click(box.getByRole('button', { name: /Remove/ }));
    expect(await box.findByText('ZZ-MARKER could not remove.')).toBeTruthy();
  });
});
