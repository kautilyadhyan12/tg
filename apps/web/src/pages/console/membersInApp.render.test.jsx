// V3b-i, the worst thing: In the app, and Waiting to join, in the third look. Opening one
// person shows that person and nobody else; Remove, Confirm and Not this person act on the
// one pressed; Escape, the page behind, the X and Close remove nobody, and nothing closes
// while a Remove is under way.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('./MemberMemberships', () => ({ default: () => null }));
vi.mock('./MemberNotes', () => ({ default: () => null }));
vi.mock('./MemberPayer', () => ({ default: () => null }));
vi.mock('./MemberCard', () => ({ default: () => null }));

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getCodes: vi.fn(),
      getApplications: vi.fn(),
      confirmApplication: vi.fn(),
      rejectApplication: vi.fn(),
      removeMember: vi.fn(),
      getStaff: vi.fn(),
      getStaffInvites: vi.fn(() => Promise.resolve({ data: { invites: [] } })),
      getStaffRoles: vi.fn(() => Promise.resolve({ data: { roles: [] } })),
      getNotMe: vi.fn(() => Promise.resolve({ data: { items: [] } })),
      putMemberOnList: vi.fn(),
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getMemberListEntry: vi.fn(),
      getMyStaffInvitations: vi.fn(() => Promise.resolve({ data: { address: 'a@example.com', addressProved: true, invitations: [] } })),
      getMyCoOwnerRequest: vi.fn(() => Promise.resolve({ data: { request: null } })),
      getMyOwnerRequest: vi.fn(() => Promise.resolve({ data: { request: null } })),
    },
  };
});
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }) }));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Members = (await import('./Members')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ORG = {
  id: GYM,
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: 'owner',
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
};
const seat = (userId, displayName, joinedAt) => ({ userId, displayName, joinedAt, groupLabel: 'Front Desk', complimentary: false, takesSeat: true });
const owner = { ...seat('u1', 'Kd Owner', '2026-08-18T09:00:00.000Z'), staff: { role: 'owner', roleName: null } };
const rita = seat('u2', 'Rita Sen', '2026-08-17T09:00:00.000Z');
const ravi = seat('u3', 'Ravi Sen', '2026-09-03T09:00:00.000Z');
const applicant = (id, displayName) => ({ id, userId: `w-${id}`, displayName, appliedAt: '2026-08-19T09:00:00.000Z', expiresAt: '2026-09-02T09:00:00.000Z', groupLabel: 'Front Desk', gymNotifiedAt: null, nudgedAt: null });
const page = (items) => ({ data: { items, nextCursor: null } });
const queue = (items) => ({ data: { items, nextCursor: null, pendingCount: items.length } });

const drawInApp = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/members?view=app']}>
      <Routes>
        <Route path="/console/:orgSlug/members" element={<Members />} />
      </Routes>
    </MemoryRouter>,
  );
const openRow = async (name) => {
  const row = (await screen.findAllByTestId('roster-row')).find((r) => r.textContent.includes(name));
  fireEvent.click(row);
  return screen.findByRole('dialog', { name });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  orgService.getCodes.mockResolvedValue({ data: { codes: [{ code: 'K7QM2X', label: 'Front Desk', paused: false, expiresAt: null, maxUses: null, joined: 0 }] } });
  orgService.getMembers.mockResolvedValue(page([owner, rita, ravi]));
  orgService.getApplications.mockResolvedValue(queue([]));
  orgService.getMemberList.mockResolvedValue({
    data: { list: { hasList: false, version: 0, lastConfirmedAt: null, counts: { entries: 0, inApp: 0, canBeInvited: 0, noEmail: 0, former: 0 }, statuses: [], membershipTypes: [], paymentStatuses: [], fields: [], appWords: [] } },
  });
  orgService.getMemberListEntries.mockResolvedValue({ data: { page: { total: 0, entries: [], cursor: null } } });
});
afterEach(cleanup);

describe('In the app: one person opened from the right', () => {
  it('opens the person pressed, beside two with the same family name, and Remove takes out only them', async () => {
    orgService.removeMember.mockResolvedValue({ data: { status: 'removed' } });
    drawInApp();
    const panel = within(await openRow('Ravi Sen'));
    expect(panel.getByRole('heading', { name: 'Ravi Sen' })).toBeTruthy();
    expect(panel.getByText(/In the app since 3 Sep/)).toBeTruthy();
    expect(panel.queryByText('Rita Sen')).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: 'Remove' }));
    expect(panel.getByText(/Remove Ravi Sen's app access\?/)).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(orgService.removeMember).toHaveBeenCalledTimes(1));
    expect(orgService.removeMember).toHaveBeenCalledWith(GYM, 'u3', { alsoStaff: false });
  });

  it('Escape while Remove is asked closes the panel and removes nobody', async () => {
    drawInApp();
    const dialog = await openRow('Rita Sen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rita Sen' })).toBeNull());
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it('the page behind does nothing; the X closes it, and nobody is removed', async () => {
    drawInApp();
    const dialog = await openRow('Rita Sen');
    fireEvent.mouseDown(document.querySelector('.c-scrim'));
    fireEvent.click(document.querySelector('.c-scrim'));
    expect(screen.getByRole('dialog', { name: 'Rita Sen' })).toBe(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it('nothing closes it while a Remove is under way', async () => {
    let finish;
    orgService.removeMember.mockReturnValue(new Promise((ok) => (finish = ok)));
    drawInApp();
    const dialog = await openRow('Rita Sen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(orgService.removeMember).toHaveBeenCalledWith(GYM, 'u2', { alsoStaff: false }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'Rita Sen' })).toBeTruthy();
    finish({ data: { status: 'removed' } });
  });

  it('a row reads in 14 px words with their initials, and the panel is the one from the right', async () => {
    drawInApp();
    const row = (await screen.findAllByTestId('roster-row')).find((r) => r.textContent.includes('Rita Sen'));
    expect(row.querySelector('.c-avatar-sm').textContent).toBe('RS');
    expect(within(row).getByText(/In the app since/).className).toContain('c-s14');
    const dialog = await openRow('Rita Sen');
    expect(dialog.className).toContain('c-panel');
    expect(dialog.getAttribute('data-testid')).toBe('roster-panel');
  });
});

describe('Waiting to join: each button acts on its own row', () => {
  it('Not this person refuses only that person, and Confirm lets in only theirs', async () => {
    orgService.getApplications.mockResolvedValue(queue([applicant('a-1', 'Anil Bora'), applicant('a-2', 'Asha Bora')]));
    orgService.rejectApplication.mockResolvedValue({ data: { status: 'rejected' } });
    orgService.confirmApplication.mockResolvedValue({ data: { status: 'confirmed', membership: { id: 'm', joinedAt: '2026-08-19T10:00:00.000Z', groupLabel: 'Front Desk' } } });
    drawInApp();
    const rows = await screen.findAllByTestId('applicant-row');
    const asha = rows.find((r) => r.textContent.includes('Asha Bora'));
    const anil = rows.find((r) => r.textContent.includes('Anil Bora'));
    fireEvent.click(within(asha).getByRole('button', { name: 'Not this person' }));
    await waitFor(() => expect(orgService.rejectApplication).toHaveBeenCalledWith(GYM, 'a-2'));
    expect(orgService.confirmApplication).not.toHaveBeenCalled();
    await waitFor(() => expect(within(anil).getByRole('button', { name: 'Confirm' }).disabled).toBe(false));
    fireEvent.click(within(anil).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(orgService.confirmApplication).toHaveBeenCalledWith(GYM, 'a-1'));
    expect(orgService.rejectApplication).toHaveBeenCalledTimes(1);
  });

  it('is a card with its title, the count and readable words', async () => {
    orgService.getApplications.mockResolvedValue(queue([{ ...applicant('a-1', 'Anil Bora'), gymNotifiedAt: '2026-08-20T09:00:00.000Z' }]));
    drawInApp();
    const box = await screen.findByTestId('waiting-to-join');
    expect(box.className).toContain('c-card');
    expect(within(box).getByRole('heading', { name: 'Waiting to join' })).toBeTruthy();
    expect(within(box).getByText(/1 person waiting/)).toBeTruthy();
    expect(within(box).getByText('Needs a decision').className).toContain('c-tag-warn');
  });
});
