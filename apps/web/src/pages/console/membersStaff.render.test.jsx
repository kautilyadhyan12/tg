// Members → Staff (ROADMAP 23c-ii): where a gym's owner invites staff, sees who runs the
// gym, and changes what each of them can do. It was a closed box in Settings.
//
// The first tests are the job's worst thing: the owner unticks a permission, the screen
// says saved, and the person still has it, or gets one nobody ticked. What is SENT is
// exactly what is TICKED, plus the ticks this screen draws no box for, which travel
// through untouched.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

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

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Members = (await import('./Members')).default;

// ── Fixtures ────────────────────────────────────────────────────────────────

const ORG = {
  id: '11111111-1111-1111-1111-111111111111',
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

const OWNER = {
  userId: 'u1',
  displayName: 'Kd Owner',
  email: 'kd@example.com',
  role: 'owner',
  since: '2026-08-18T09:00:00.000Z',
  isYou: true,
  isMember: true,
};

/** A manager carrying two fields the endpoint does not send, with values no other text
 *  on the page can match. */
const MANAGER = {
  userId: 'u2',
  displayName: 'Rita Sen',
  email: 'rita@example.com',
  role: 'manager',
  since: '2026-08-20T09:00:00.000Z',
  isYou: false,
  isMember: true,
  weightKg: 61.5,
  workouts30d: 9137,
};

const TRAINER = {
  userId: 'u3',
  displayName: 'Anil Bora',
  email: null,
  role: 'trainer',
  since: '2026-08-21T09:00:00.000Z',
  isYou: false,
  isMember: false,
};

/** Narrower than the manager's usual set, so a screen that drew "what a manager gets"
 *  would fail. `codes.invite` is a join-code tick: held, and no box is drawn for it. */
const MANAGER_TICKED = { ...MANAGER, privileges: ['members.read', 'codes.invite'] };

const INVITE = {
  id: '6f1c2b8e-0a4d-4f7e-9b1a-2c3d4e5f6a7b',
  email: 'anil@example.com',
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

const apiError = (status, error, message) => ({
  response: { status, data: { error, message, requestId: 'r' } },
});
const offline = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

const drawStaff = (path = '/console/iron-house/members?view=staff') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Link to="/console/iron-palace/members?view=staff">jump</Link>
      <Routes>
        <Route path="/console/:orgSlug/members" element={<Members />} />
      </Routes>
    </MemoryRouter>,
  );

/** Press a person's row: their panel. */
const openPerson = async (id, name) => {
  fireEvent.click(await screen.findByTestId(`staff-tab-${id}`));
  return within(await screen.findByRole('dialog', { name }));
};

const drawPerson = async (id = 'u2', name = 'Rita Sen') => {
  drawStaff();
  return openPerson(id, name);
};

/** Press Invite staff: the form's panel. */
const openInvite = async () => {
  drawStaff();
  fireEvent.click(await screen.findByRole('button', { name: 'Invite staff' }));
  return within(await screen.findByRole('dialog', { name: 'Invite staff' }));
};

const sentPrivileges = () => [...orgService.updateStaffPrivileges.mock.calls[0][2].privileges].sort();

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
  orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER] } });
  orgService.inviteStaff.mockResolvedValue({ data: { outcome: 'invited', invite: INVITE } });
  orgService.getStaffInvites.mockResolvedValue({ data: { invites: [] } });
  orgService.cancelStaffInvite.mockResolvedValue({ data: { status: 'cancelled' } });
  orgService.getStaffRoles.mockResolvedValue({ data: { roles: [] } });
  orgService.deleteStaffRole.mockResolvedValue({ data: { status: 'deleted' } });
  orgService.updateStaffRole.mockResolvedValue({ data: { staff: MANAGER } });
  orgService.updateStaffPrivileges.mockResolvedValue({ data: { staff: MANAGER } });
  orgService.removeStaff.mockResolvedValue({ data: { status: 'removed' } });
  orgService.removeMember.mockResolvedValue({ data: { status: 'removed' } });
});

afterEach(() => {
  cleanup();
});

// ── The worst thing: what is sent is exactly what is ticked ─────────────────

describe('what is sent is exactly what is ticked', () => {
  const MANAGER_USUAL = ROLE_PRIVILEGES.manager.filter((p) => p !== 'staff.manage');

  // Each kind of person an owner can open, one box pressed, and the whole set that must
  // leave the screen: the boxes as they now stand, plus every tick held that has no box.
  it.each([
    {
      name: 'a manager on the usual set: unticking Remove members takes exactly that one away',
      person: MANAGER,
      press: /^Remove members/,
      sent: MANAGER_USUAL.filter((p) => p !== 'members.remove'),
    },
    {
      name: 'a manager narrowed by hand: ticking Remove members adds exactly that one',
      person: MANAGER_TICKED,
      press: /^Remove members/,
      sent: ['codes.invite', 'members.read', 'members.remove'],
    },
    {
      name: 'the last box cleared sends an empty set of boxes, and the join-code tick held stays',
      person: MANAGER_TICKED,
      press: /^See who's in the app/,
      sent: ['codes.invite'],
    },
    {
      name: 'a trainer on a role of the gym\'s own',
      person: { ...TRAINER, userId: 'u2', displayName: 'Rita Sen', roleName: 'Front desk', privileges: ['attendance.read', 'members.read'] },
      press: /^Check people in/,
      sent: ['attendance.mark', 'attendance.read', 'members.read'],
    },
    {
      name: 'the timetable tick, which a manager starts with, can be taken away and nothing else goes',
      person: { ...MANAGER, privileges: [...ROLE_PRIVILEGES.manager] },
      press: /^Run classes and personal training/,
      sent: ROLE_PRIVILEGES.manager.filter((p) => p !== 'schedule.manage'),
    },
    {
      name: 'a tick with no box on a manager\'s row (gym details, billing) travels through untouched',
      person: { ...MANAGER, privileges: ['members.read', 'billing.manage', 'org.manage'] },
      press: /^Remove members/,
      sent: ['billing.manage', 'members.read', 'members.remove', 'org.manage'],
    },
    {
      name: 'a permission this build has no words for travels through untouched',
      person: { ...MANAGER, privileges: ['members.read', 'zzz.not-a-real-privilege'] },
      press: /^Remove members/,
      sent: ['members.read', 'members.remove', 'zzz.not-a-real-privilege'],
    },
    {
      name: 'a leftover Manage staff on a manager is dropped, and nothing else',
      person: { ...MANAGER, privileges: ['members.read', 'codes.invite', 'staff.manage'] },
      press: /^See who came in/,
      sent: ['attendance.read', 'codes.invite', 'members.read'],
    },
  ])('$name', async ({ person, press, sent }) => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, person] } });
    const panel = await drawPerson();
    fireEvent.click(panel.getByLabelText(press));
    fireEvent.click(panel.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(orgService.updateStaffPrivileges).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffPrivileges.mock.calls[0][0]).toBe(ORG.id);
    expect(orgService.updateStaffPrivileges.mock.calls[0][1]).toBe('u2');
    expect(sentPrivileges()).toEqual([...sent].sort());
  });

  it('after a save the boxes show what the SERVER now holds, read again', async () => {
    orgService.getStaff.mockResolvedValueOnce({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const panel = await drawPerson();
    // The server kept less than was asked for: the screen must show its answer, not the edit.
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER_TICKED, privileges: ['codes.invite'] }] } });
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    fireEvent.click(panel.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(panel.getByLabelText(/^Remove members/).checked).toBe(false));
    expect(panel.getByLabelText(/^See who's in the app/).checked).toBe(false);
    expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(true);
    // And it is not called saved: the server holds something else, which is said.
    expect(await panel.findByText('Not everything was kept. The boxes show what they can do now.')).toBeTruthy();
    expect(panel.queryByText('Permissions saved.')).toBeNull();
  });

  it('a save the server refuses is never said to have worked: its sentence, and the edit still in the boxes', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    orgService.updateStaffPrivileges.mockRejectedValue(apiError(409, 'owner_only_privilege', 'Managing staff stays with the owner.'));
    const panel = await drawPerson();
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    fireEvent.click(panel.getByRole('button', { name: 'Save permissions' }));
    // Said under Save permissions, where it was pressed, not at the top of a long panel.
    expect(await within(panel.getByTestId('privileges-u2')).findByText(/Managing staff stays with the owner/)).toBeTruthy();
    expect(panel.getByLabelText(/^Remove members/).checked).toBe(true);
    expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
    expect(orgService.getStaff).toHaveBeenCalledTimes(1);
  });

  it('an edit left unsaved is thrown away by a role change: the boxes are the new role\'s, and Save has nothing to send', async () => {
    orgService.getStaff.mockResolvedValueOnce({ data: { staff: [OWNER, MANAGER] } });
    const panel = await drawPerson();
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(false);
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER, role: 'trainer', privileges: [...ROLE_PRIVILEGES.trainer] }] } });
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
    await waitFor(() => expect(orgService.updateStaffRole).toHaveBeenCalledWith(ORG.id, 'u2', { role: 'trainer' }));
    await waitFor(() => expect(panel.getByLabelText(/^Keep the member list and invite/).checked).toBe(false));
    expect(panel.getByLabelText(/^Remove members/).checked).toBe(false);
    expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(true);
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
  });

  it('one person\'s unsaved edit is never carried onto the next person opened', async () => {
    orgService.getStaff.mockResolvedValue({
      data: { staff: [OWNER, MANAGER_TICKED, { ...TRAINER, privileges: ['members.read'] }] },
    });
    const rita = await drawPerson();
    fireEvent.click(rita.getByLabelText(/^Remove members/));
    fireEvent.click(rita.getByRole('button', { name: 'Close' }));
    const anil = await openPerson('u3', 'Anil Bora');
    expect(anil.getByLabelText(/^Remove members/).checked).toBe(false);
    expect(anil.getByRole('button', { name: 'Save permissions' }).disabled).toBe(true);
    fireEvent.click(anil.getByLabelText(/^See who came in/));
    fireEvent.click(anil.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(orgService.updateStaffPrivileges).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffPrivileges.mock.calls[0][1]).toBe('u3');
    expect(sentPrivileges()).toEqual(['attendance.read', 'members.read']);
  });

  /** The panel does not hold the keyboard, so a row behind it can be reached with Tab and
   *  opened with no Close in between. Two people in the SAME role holding the SAME set:
   *  nothing but a new panel for the second keeps the first one's edit off them. */
  it('a second person opened with the first one\'s panel still open gets their own boxes, not the first one\'s edit', async () => {
    const same = ['members.read', 'attendance.read'];
    orgService.getStaff.mockResolvedValue({
      data: { staff: [OWNER, { ...MANAGER, privileges: [...same] }, { ...TRAINER, role: 'manager', privileges: [...same] }] },
    });
    const rita = await drawPerson();
    fireEvent.click(rita.getByLabelText(/^Remove members/));
    expect(rita.getByRole('button', { name: 'Save permissions' }).disabled).toBe(false);
    fireEvent.click(rita.getByRole('button', { name: 'Remove from staff' }));
    const anil = await openPerson('u3', 'Anil Bora');
    expect(screen.queryByRole('dialog', { name: 'Rita Sen' })).toBeNull();
    expect(anil.getByLabelText(/^Remove members/).checked).toBe(false);
    expect(anil.getByRole('button', { name: 'Save permissions' }).disabled).toBe(true);
    // Nor a question the first person's panel had open.
    expect(anil.queryByText(/open the console any more/)).toBeNull();
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
  });

  it('an invitation carries exactly the boxes ticked on the form, plus the role\'s ones the form has no box for', async () => {
    const form = await openInvite();
    fireEvent.change(form.getByLabelText(/Their email address/i), { target: { value: 'anil@example.com' } });
    fireEvent.click(form.getByRole('radio', { name: 'Manager' }));
    fireEvent.click(form.getByLabelText(/^Remove members/));
    fireEvent.click(form.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(orgService.inviteStaff).toHaveBeenCalledTimes(1));
    const sent = orgService.inviteStaff.mock.calls[0][1];
    expect(sent.role).toBe('manager');
    expect([...sent.privileges].sort()).toEqual(
      ['attendance.mark', 'attendance.read', 'leaderboard.manage', 'members.confirm', 'members.read', 'memberships.manage', 'posts.manage', 'schedule.manage'].sort(),
    );
  });

  /** One address for every gym's Members, so nothing remounts when the gym changes. A row
   *  from the first gym, pressed under the second, would be sent to the second gym's id. */
  it('carries no staff list, and no open person, from one gym onto another', async () => {
    const gymB = { ...ORG, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', slug: 'iron-palace', name: 'Iron Palace' };
    orgService.getMine.mockResolvedValue({ data: { orgs: [ORG, gymB] } });
    orgService.getStaff.mockResolvedValueOnce({ data: { staff: [OWNER, MANAGER] } });
    await drawPerson();

    let landB;
    orgService.getStaff.mockReturnValue(
      new Promise((resolve) => {
        landB = () => resolve({ data: { staff: [{ ...OWNER, userId: 'u9', displayName: 'Bravo Person' }] } });
      }),
    );
    fireEvent.click(screen.getByText('jump'));
    await waitFor(() => expect(orgService.getStaff).toHaveBeenLastCalledWith(gymB.id));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Rita Sen')).toBeNull();
    expect(screen.queryByText('Kd Owner')).toBeNull();
    landB();
    expect(await screen.findByText('Bravo Person')).toBeTruthy();
  });
});

// ── The list ────────────────────────────────────────────────────────────────

describe('who runs this gym', () => {
  it('lists everybody with their role, and a person\'s panel says since when', async () => {
    drawStaff();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    const row = within(screen.getByTestId('staff-tab-u2'));
    expect(row.getByText('Rita Sen')).toBeTruthy();
    expect(row.getByText('Manager')).toBeTruthy();
    expect(row.getByText('rita@example.com')).toBeTruthy();
    const panel = await openPerson('u2', 'Rita Sen');
    expect(panel.getByText(/^On the staff since /)).toBeTruthy();
  });

  it('marks your own row from the SERVER\'s answer, never from a name', async () => {
    drawStaff();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    expect(within(screen.getByTestId('staff-tab-u1')).getByText('(you)')).toBeTruthy();
    expect(within(screen.getByTestId('staff-tab-u2')).queryByText('(you)')).toBeNull();
  });

  it('shows a staff row and nothing Part 3 §2.4 keeps from a gym', async () => {
    const panel = await drawPerson();
    expect(panel.getByText('rita@example.com')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/61\.5/);
    expect(document.body.textContent).not.toMatch(/9137/);
  });

  it('leaves the email out when there is none, rather than printing a dash for it', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, TRAINER] } });
    drawStaff();
    const row = within(await screen.findByTestId('staff-tab-u3'));
    expect(row.getByText('Trainer')).toBeTruthy();
    expect(row.queryByText(/—/)).toBeNull();
  });

  it('says how many people run the gym, and that a staff login is free while the app takes a place (§10.4)', async () => {
    drawStaff();
    expect(await screen.findByText('2 people run your gym')).toBeTruthy();
    expect(screen.getByText(/Staff use the console free\. Using the member app here takes one of your places/)).toBeTruthy();
  });

  it('never draws a failed read as a gym with no staff: it says what went wrong, with a way out, and offers no Invite', async () => {
    orgService.getStaff.mockRejectedValue(offline());
    drawStaff();
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText(/run your gym$/)).toBeNull();
    // No controls over a list that could not be read.
    expect(screen.queryByRole('button', { name: 'Invite staff' })).toBeNull();
  });

  it('Try again reads the list again', async () => {
    orgService.getStaff.mockRejectedValueOnce(offline());
    drawStaff();
    fireEvent.click(await screen.findByText('Try again'));
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
  });

  it("shows a person's own role name on their row", async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER, role: 'trainer', roleName: 'Front desk' }] } });
    drawStaff();
    expect(within(await screen.findByTestId('staff-tab-u2')).getByText('Front desk')).toBeTruthy();
  });
});

// ── The owner ───────────────────────────────────────────────────────────────

describe("the owner's own panel", () => {
  it('carries the reason instead of controls the server would refuse', async () => {
    const panel = await drawPerson('u1', 'Kd Owner');
    expect(panel.getByText("The owner runs the gym and can't be removed from staff.")).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Remove from staff' })).toBeNull();
    expect(panel.queryByRole('button', { name: /^Make / })).toBeNull();
  });

  it('shows their permissions, which cannot be changed from this screen', async () => {
    const panel = await drawPerson('u1', 'Kd Owner');
    expect(panel.getByText('What you can do')).toBeTruthy();
    expect(panel.getByLabelText(/^Manage staff/).checked).toBe(true);
    expect(panel.getByLabelText(/^Manage staff/).disabled).toBe(true);
    expect(panel.queryByRole('button', { name: 'Save permissions' })).toBeNull();
    expect(panel.getByText(/can't be changed here/i)).toBeTruthy();
  });

  it('shows what the server actually holds, not "you can do everything"', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [{ ...OWNER, privileges: ['members.read', 'staff.manage'] }, MANAGER_TICKED] } });
    const panel = await drawPerson('u1', 'Kd Owner');
    expect(panel.getByLabelText(/^Manage staff/).checked).toBe(true);
    expect(panel.getByLabelText(/^Remove members/).checked).toBe(false);
  });

  it('says "the owner" about ANOTHER owner, and still lets nobody change the row', async () => {
    const second = { userId: 'u4', displayName: 'Priya Owner', email: 'priya@example.com', role: 'owner', since: '2026-08-19T09:00:00.000Z', isYou: false };
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, second] } });
    const panel = await drawPerson('u4', 'Priya Owner');
    expect(panel.getByText('What they can do')).toBeTruthy();
    expect(panel.getByText(/what the owner can do/i)).toBeTruthy();
    expect(panel.queryByText(/This is what you can do/i)).toBeNull();
    expect(panel.getByLabelText(/^Manage staff/).disabled).toBe(true);
    expect(panel.queryByRole('button', { name: 'Save permissions' })).toBeNull();
  });
});

// ── Changing a role ─────────────────────────────────────────────────────────

describe('changing somebody\'s role', () => {
  const twice = (panel) => {
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
  };

  it('offers the OTHER role, sends exactly that, and reads the list again', async () => {
    const panel = await drawPerson();
    expect(orgService.getStaff).toHaveBeenCalledTimes(1);
    twice(panel);
    await waitFor(() => expect(orgService.updateStaffRole).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffRole).toHaveBeenCalledWith(ORG.id, 'u2', { role: 'trainer' });
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
  });

  it('asks before changing a role, says their permissions BECOME the new defaults, and does nothing on the first press', async () => {
    const panel = await drawPerson();
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
    const question = panel.getByText(/permissions become the defaults for the new role/i);
    expect(question.textContent).toBe('Make Rita Sen a trainer? Their permissions become the defaults for the new role.');
    expect(question.textContent).not.toMatch(/will be lost|lose your changes/i);
    expect(orgService.updateStaffRole).not.toHaveBeenCalled();
  });

  it('Cancel on that question changes nothing and puts the button back', async () => {
    const panel = await drawPerson();
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
    fireEvent.click(within(panel.getByTestId('staff-role')).getByRole('button', { name: 'Cancel' }));
    expect(orgService.updateStaffRole).not.toHaveBeenCalled();
    expect(panel.getByRole('button', { name: 'Make trainer' })).toBeTruthy();
    expect(panel.queryByText(/permissions become the defaults/i)).toBeNull();
  });

  it("shows the server's own sentence when it refuses, and leaves the person as they were", async () => {
    orgService.updateStaffRole.mockRejectedValue(apiError(409, 'owner_role_locked', 'The gym’s owner keeps the owner role.'));
    const panel = await drawPerson();
    twice(panel);
    expect(await within(panel.getByTestId('staff-role')).findByText(/owner keeps the owner role/i)).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Make trainer' })).toBeTruthy();
  });

  it('offers no Try again over a permanent refusal, and does over a dropped connection', async () => {
    orgService.updateStaffRole.mockRejectedValue(apiError(403, 'forbidden', "Your role doesn't allow that."));
    const panel = await drawPerson();
    twice(panel);
    await panel.findByText(/Your role doesn't allow that/i);
    expect(screen.queryByText('Try again')).toBeNull();

    cleanup();
    orgService.updateStaffRole.mockRejectedValue(offline());
    const again = await drawPerson();
    twice(again);
    await again.findByText(/Couldn't reach the server/i);
    expect(again.getByText('Try again')).toBeTruthy();
  });
});

/** Kd, at the click-through: "i made a new role but when i clciked staff in memebrs and go
 *  to a profile the new role is not shown in the Role". */
describe("a profile's Role offers the gym's own roles", () => {
  const FRONT_DESK = { id: '1f1c2b8e-0a4d-4f7e-9b1a-2c3d4e5f6a7b', name: 'Front desk', privileges: ['attendance.read', 'attendance.mark'] };
  const OFFICE = { id: '2f1c2b8e-0a4d-4f7e-9b1a-2c3d4e5f6a7b', name: 'Office manager', privileges: ['members.read'] };
  const buttons = (panel) =>
    within(panel.getByTestId('staff-role'))
      .getAllByRole('button')
      .map((b) => b.textContent);

  it('a manager is offered trainer and each role of the gym\'s own; with none made, only trainer', async () => {
    orgService.getStaffRoles.mockResolvedValue({ data: { roles: [FRONT_DESK, OFFICE] } });
    const panel = await drawPerson();
    expect(buttons(panel)).toEqual(['Make trainer', 'Make Front desk', 'Make Office manager']);
    cleanup();
    orgService.getStaffRoles.mockResolvedValue({ data: { roles: [] } });
    expect(buttons(await drawPerson())).toEqual(['Make trainer']);
  });

  it('Make Front desk asks first, then sends that role\'s id, and the panel shows the role and its permissions', async () => {
    orgService.getStaffRoles.mockResolvedValue({ data: { roles: [FRONT_DESK] } });
    orgService.getStaff.mockResolvedValueOnce({ data: { staff: [OWNER, MANAGER] } });
    const panel = await drawPerson();
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    orgService.getStaff.mockResolvedValue({
      data: { staff: [OWNER, { ...MANAGER, role: 'trainer', roleName: 'Front desk', privileges: [...FRONT_DESK.privileges] }] },
    });
    fireEvent.click(panel.getByRole('button', { name: 'Make Front desk' }));
    expect(panel.getByText('Make Rita Sen a Front desk? Their permissions become the ones saved for that role.')).toBeTruthy();
    expect(orgService.updateStaffRole).not.toHaveBeenCalled();
    fireEvent.click(panel.getByRole('button', { name: 'Make Front desk' }));
    await waitFor(() => expect(orgService.updateStaffRole).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffRole).toHaveBeenCalledWith(ORG.id, 'u2', { roleId: FRONT_DESK.id });
    // Read back: the role by its name, the boxes that role holds, and no edit left over.
    await waitFor(() => expect(buttons(panel)).toEqual(['Make manager', 'Make trainer']));
    expect(within(panel.getByTestId('staff-role')).getByText('Front desk')).toBeTruthy();
    expect(panel.getByLabelText(/^Check people in/).checked).toBe(true);
    expect(panel.getByLabelText(/^Keep the member list and invite/).checked).toBe(false);
    expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(true);
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
  });

  it('somebody on one of them is offered manager, plain trainer and the others, and plain trainer sends the role itself', async () => {
    orgService.getStaffRoles.mockResolvedValue({ data: { roles: [FRONT_DESK, OFFICE] } });
    orgService.getStaff.mockResolvedValue({
      data: { staff: [OWNER, { ...MANAGER, role: 'trainer', roleName: 'Front desk', privileges: [...FRONT_DESK.privileges] }] },
    });
    const panel = await drawPerson();
    expect(buttons(panel)).toEqual(['Make manager', 'Make trainer', 'Make Office manager']);
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
    await waitFor(() => expect(orgService.updateStaffRole).toHaveBeenCalledWith(ORG.id, 'u2', { role: 'trainer' }));
  });

  it('a role somebody deleted meanwhile: the server\'s sentence under the buttons, and its button goes', async () => {
    orgService.getStaffRoles.mockResolvedValueOnce({ data: { roles: [FRONT_DESK] } });
    orgService.getStaffRoles.mockResolvedValue({ data: { roles: [] } });
    orgService.updateStaffRole.mockRejectedValue(apiError(404, 'role_not_found', "That role isn't one of yours any more."));
    const panel = await drawPerson();
    fireEvent.click(panel.getByRole('button', { name: 'Make Front desk' }));
    fireEvent.click(panel.getByRole('button', { name: 'Make Front desk' }));
    expect(await within(panel.getByTestId('staff-role')).findByText("That role isn't one of yours any more.")).toBeTruthy();
    await waitFor(() => expect(buttons(panel)).toEqual(['Make trainer']));
  });

  it('a gym with no live plan: every one of them is greyed', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, subscription: null, consoleReadOnly: true }] } });
    orgService.getStaffRoles.mockResolvedValue({ data: { roles: [FRONT_DESK] } });
    const panel = await drawPerson();
    for (const button of within(panel.getByTestId('staff-role')).getAllByRole('button')) expect(button.disabled).toBe(true);
  });
});

// Round one of 23c-ii's review.
describe('what was found by the review', () => {
  const SAME = ['members.read', 'attendance.read'];
  const FRONT_DESK = { id: '1f1c2b8e-0a4d-4f7e-9b1a-2c3d4e5f6a7b', name: 'Front desk', privileges: SAME };

  /** T1, L3: the same underlying role and the same ticks, under another name. Nothing but
   *  the name tells the edit that the set under it has changed hands. */
  it('an unsaved edit is dropped by a role change even when the new role holds the same ticks', async () => {
    orgService.getStaffRoles.mockResolvedValue({ data: { roles: [FRONT_DESK] } });
    orgService.getStaff.mockResolvedValueOnce({ data: { staff: [OWNER, { ...MANAGER, role: 'trainer', privileges: [...SAME] }] } });
    const panel = await drawPerson();
    fireEvent.click(panel.getByLabelText(/^Check people in/));
    expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(false);
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER, role: 'trainer', roleName: 'Front desk', privileges: [...SAME] }] } });
    fireEvent.click(panel.getByRole('button', { name: 'Make Front desk' }));
    fireEvent.click(panel.getByRole('button', { name: 'Make Front desk' }));
    await waitFor(() => expect(within(panel.getByTestId('staff-role')).getByText('Front desk')).toBeTruthy());
    expect(panel.getByLabelText(/^Check people in/).checked).toBe(false);
    expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(true);
  });

  /** L2: the line is about the set that was saved, and a role change replaces that set. */
  it('"Permissions saved." goes when their role is changed after the save', async () => {
    orgService.getStaff.mockResolvedValueOnce({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const panel = await drawPerson();
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER_TICKED, privileges: ['members.read', 'codes.invite', 'members.remove'] }] } });
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    fireEvent.click(panel.getByRole('button', { name: 'Save permissions' }));
    expect(await panel.findByText('Permissions saved.')).toBeTruthy();
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER_TICKED, role: 'trainer', privileges: [...ROLE_PRIVILEGES.trainer] }] } });
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
    fireEvent.click(panel.getByRole('button', { name: 'Make trainer' }));
    await waitFor(() => expect(panel.getByRole('button', { name: 'Make manager' })).toBeTruthy());
    expect(panel.queryByText('Permissions saved.')).toBeNull();
    // Nor does it come back when a later change lands on the saved set again.
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER_TICKED, privileges: ['members.read', 'codes.invite', 'members.remove'] }] } });
    fireEvent.click(panel.getByRole('button', { name: 'Make manager' }));
    fireEvent.click(panel.getByRole('button', { name: 'Make manager' }));
    await waitFor(() => expect(panel.getByRole('button', { name: 'Make trainer' })).toBeTruthy());
    expect(panel.getByLabelText(/^Remove members/).checked).toBe(true);
    expect(panel.queryByText('Permissions saved.')).toBeNull();
  });

  /** L4: nothing to check the save against, so nothing is claimed. */
  it('says nothing of a save when the list comes back without their permissions', async () => {
    orgService.getStaff.mockResolvedValueOnce({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const panel = await drawPerson();
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER] } });
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    fireEvent.click(panel.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(true));
    expect(panel.queryByText('Permissions saved.')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  /** L5: a panel closed while its save is on its way. */
  it("one person's refusal is never drawn in the next person's panel, whose controls wait for it", async () => {
    orgService.getStaff.mockResolvedValue({
      data: { staff: [OWNER, MANAGER_TICKED, { ...TRAINER, privileges: ['members.read'] }] },
    });
    let refuse;
    orgService.updateStaffPrivileges.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = () => reject(apiError(409, 'owner_only_privilege', 'ZZ-MARKER refused for Rita.'));
      }),
    );
    const rita = await drawPerson();
    fireEvent.click(rita.getByLabelText(/^Remove members/));
    fireEvent.click(rita.getByRole('button', { name: 'Save permissions' }));
    fireEvent.click(rita.getByRole('button', { name: 'Close' }));
    const anil = await openPerson('u3', 'Anil Bora');
    // Her save is still on its way: nothing of his can be pressed over it.
    expect(anil.getByLabelText(/^See who came in/).disabled).toBe(true);
    expect(anil.getByRole('button', { name: 'Make manager' }).disabled).toBe(true);
    refuse();
    await waitFor(() => expect(anil.getByLabelText(/^See who came in/).disabled).toBe(false));
    expect(screen.queryByText(/ZZ-MARKER/)).toBeNull();
    // It is not lost either: opened again, her own panel says it, under Save permissions.
    fireEvent.click(anil.getByRole('button', { name: 'Close' }));
    const again = await openPerson('u2', 'Rita Sen');
    expect(within(again.getByTestId('privileges-u2')).getByText('ZZ-MARKER refused for Rita.')).toBeTruthy();
  });

  /** L7: the form belongs to the Staff tab. */
  it('"?open=invite" with no Staff tab in the address opens nothing, then or later', async () => {
    drawStaff('/console/iron-house/members?open=invite');
    const tab = await screen.findByRole('tab', { name: 'Staff' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(tab);
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ── Remove from staff ───────────────────────────────────────────────────────

describe('Remove from staff', () => {
  it('asks first, naming the person and what they lose, and does nothing until the last press', async () => {
    const panel = await drawPerson();
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    expect(panel.getByText("Remove Rita Sen from staff? They can't open the console any more.")).toBeTruthy();
    expect(panel.getByText('They keep using the app as a member.')).toBeTruthy();
    expect(orgService.removeStaff).not.toHaveBeenCalled();
    expect(orgService.removeMember).not.toHaveBeenCalled();
    fireEvent.click(within(panel.getByTestId('staff-remove')).getByRole('button', { name: 'Cancel' }));
    expect(panel.queryByText(/Remove Rita Sen from staff\?/)).toBeNull();
    expect(orgService.removeStaff).not.toHaveBeenCalled();
  });

  it('unticked, takes only their staff access; the panel closes and the list is read again', async () => {
    const panel = await drawPerson();
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    await waitFor(() => expect(orgService.removeStaff).toHaveBeenCalledWith(ORG.id, 'u2'));
    expect(orgService.removeMember).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
  });

  it('ticked, one step takes them off staff and out of the app', async () => {
    const panel = await drawPerson();
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    fireEvent.click(panel.getByText('Also remove Rita Sen from the app'));
    expect(panel.getByText(/They lose access to your gym in the app too\./)).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff and app' }));
    await waitFor(() => expect(orgService.removeMember).toHaveBeenCalledWith(ORG.id, 'u2', { alsoStaff: true }));
    expect(orgService.removeStaff).not.toHaveBeenCalled();
  });

  it('somebody who is not in the app gets no app tick: there is only their access to take back', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, TRAINER] } });
    const panel = await drawPerson('u3', 'Anil Bora');
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    expect(within(panel.getByTestId('staff-remove')).queryByRole('checkbox')).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    await waitFor(() => expect(orgService.removeStaff).toHaveBeenCalledWith(ORG.id, 'u3'));
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it('a removal that fails says so in the panel, which stays open with the person still on staff', async () => {
    orgService.removeStaff.mockRejectedValue(offline());
    const panel = await drawPerson();
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    expect(await within(panel.getByTestId('staff-remove')).findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Remove from staff' })).toBeTruthy();
  });
});

// ── Invite staff ────────────────────────────────────────────────────────────

describe('Invite staff', () => {
  const type = (form, value) => fireEvent.change(form.getByLabelText(/Their email address/i), { target: { value } });
  const send = (form) => fireEvent.click(form.getByRole('button', { name: 'Send invitation' }));
  const ticked = (form) =>
    within(form.getByTestId('invite-ticks'))
      .getAllByRole('checkbox')
      .filter((box) => box.checked)
      .map((box) => box.closest('label').querySelector('span span').textContent);

  it('sends the typed email with the chosen role', async () => {
    const form = await openInvite();
    type(form, 'anil@example.com');
    fireEvent.click(form.getByRole('radio', { name: 'Manager' }));
    send(form);
    await waitFor(() => expect(orgService.inviteStaff).toHaveBeenCalledTimes(1));
    const [gymId, sent] = orgService.inviteStaff.mock.calls[0];
    expect(gymId).toBe(ORG.id);
    expect(sent).toMatchObject({ email: 'anil@example.com', role: 'manager' });
    // The join code ticks have no box and are not sent (3c).
    expect([...sent.privileges].sort()).toEqual(ROLE_PRIVILEGES.manager.filter((p) => !p.startsWith('codes.')).sort());
  });

  it('starts on the SMALLER grant, so a form nobody reads hands out less', async () => {
    const form = await openInvite();
    type(form, 'anil@example.com');
    send(form);
    await waitFor(() => expect(orgService.inviteStaff).toHaveBeenCalledTimes(1));
    const sent = orgService.inviteStaff.mock.calls[0][1];
    expect(sent).toMatchObject({ email: 'anil@example.com', role: 'trainer' });
    expect([...sent.privileges].sort()).toEqual(ROLE_PRIVILEGES.trainer.filter((p) => !p.startsWith('codes.')).sort());
  });

  it("tells a STUDIO owner their coach cannot see the client list, in the studio's word", async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, orgType: 'studio' }] } });
    const form = await openInvite();
    expect(form.getByText(/can't see your clients in the app/i)).toBeTruthy();
    expect(form.getByRole('radio', { name: 'Coach' })).toBeTruthy();
  });

  it('tells a GYM owner their trainer CAN see it: the same control, the other answer', async () => {
    const form = await openInvite();
    expect(form.getByText(/Can see who's in the app/i)).toBeTruthy();
  });

  it('refuses a too-short entry in words, without asking the server', async () => {
    const form = await openInvite();
    type(form, 'ab');
    send(form);
    expect(form.getByText(/too short for an email address/i)).toBeTruthy();
    expect(orgService.inviteStaff).not.toHaveBeenCalled();
  });

  it('refuses a too-long entry, and something that is not an address, in words', async () => {
    const form = await openInvite();
    const tooLong = `${'a'.repeat(250)}@example.com`;
    type(form, tooLong);
    send(form);
    expect(form.getByText(/doesn't look like an email address/i)).toBeTruthy();
    type(form, 'anil at example');
    send(form);
    expect(form.getByText(/doesn't look like an email address/i)).toBeTruthy();
    expect(orgService.inviteStaff).not.toHaveBeenCalled();
  });

  it('asks for an email instead of sending an empty one, and trims what was typed', async () => {
    const form = await openInvite();
    send(form);
    expect(form.getByText(/Type the email address/i)).toBeTruthy();
    expect(orgService.inviteStaff).not.toHaveBeenCalled();
    type(form, '  anil@example.com  ');
    send(form);
    await waitFor(() => expect(orgService.inviteStaff).toHaveBeenCalledTimes(1));
    expect(orgService.inviteStaff.mock.calls[0][1].email).toBe('anil@example.com');
  });

  it("says an invitation is emailed, and ticks the role's usual permissions, which the owner can change", async () => {
    const form = await openInvite();
    expect(form.getByText(/We'll email them an invitation/i)).toBeTruthy();
    expect(ticked(form)).toEqual(["See who's in the app", 'See who came in']);
    fireEvent.click(form.getByRole('radio', { name: 'Manager' }));
    expect(ticked(form)).toEqual([
      "See who's in the app",
      'See who came in',
      'Check people in',
      'Run the leaderboard',
      'Post updates',
      'Run classes and personal training',
      'Keep the member list and invite',
      'Remove members',
      'Change membership types and prices',
    ]);
    // Join codes are switched off (3c), and managing staff is never offered.
    expect(within(form.getByTestId('invite-ticks')).queryByText(/join code/i)).toBeNull();
    expect(within(form.getByTestId('invite-ticks')).queryByText('Manage staff')).toBeNull();
  });

  it('says the invitation went, closes the form and reads the lists again', async () => {
    const form = await openInvite();
    type(form, 'anil@example.com');
    send(form);
    expect(await screen.findByText("Invited anil@example.com. We're sending the email now; the invitation works for 7 days.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
    expect(orgService.getStaffInvites).toHaveBeenCalledTimes(2);
  });

  it('says so when the address was somebody already in the gym, who is staff at once', async () => {
    orgService.inviteStaff.mockResolvedValue({ data: { outcome: 'added', staff: TRAINER } });
    let form = await openInvite();
    type(form, 'rita@example.com');
    send(form);
    expect(await screen.findByText(`${TRAINER.displayName} is now a trainer here.`)).toBeTruthy();

    // A role of the gym's own that starts with a vowel reads "an".
    cleanup();
    orgService.inviteStaff.mockResolvedValue({ data: { outcome: 'added', staff: { ...TRAINER, roleName: 'Office manager' } } });
    form = await openInvite();
    type(form, 'om@example.com');
    send(form);
    expect(await screen.findByText(`${TRAINER.displayName} is now an Office manager here.`)).toBeTruthy();
  });

  it('keeps the form and the typing when the server refuses, and shows ITS sentence in the form', async () => {
    orgService.inviteStaff.mockRejectedValue(
      apiError(409, 'already_invited', "You've already invited ghost@example.com. The invitation is waiting for them to accept."),
    );
    const form = await openInvite();
    type(form, 'ghost@example.com');
    send(form);
    expect(await form.findByText(/You've already invited ghost@example.com/i)).toBeTruthy();
    expect(form.getByLabelText(/Their email address/i).value).toBe('ghost@example.com');
    expect(form.queryByText('Try again')).toBeNull();
  });

  it('Cancel closes the form and sends nothing', async () => {
    const form = await openInvite();
    type(form, 'anil@example.com');
    fireEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(orgService.inviteStaff).not.toHaveBeenCalled();
  });
});

describe("the gym's own roles", () => {
  const FRONT_DESK = { id: '1f1c2b8e-0a4d-4f7e-9b1a-2c3d4e5f6a7b', name: 'Front desk', privileges: ['attendance.read', 'members.read'] };
  const tickedNow = (form) =>
    within(form.getByTestId('invite-ticks'))
      .getAllByRole('checkbox')
      .filter((box) => box.checked).length;

  it('shows the roles in one row, and choosing one ticks its permissions right underneath', async () => {
    orgService.getStaffRoles.mockResolvedValue({ data: { roles: [FRONT_DESK] } });
    const form = await openInvite();
    expect(within(form.getByRole('radiogroup')).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Manager', 'Trainer', 'Front desk']);
    fireEvent.click(form.getByRole('radio', { name: 'Front desk' }));
    expect(tickedNow(form)).toBe(2);
    fireEvent.change(form.getByLabelText(/Their email address/i), { target: { value: 'desk@example.com' } });
    fireEvent.click(form.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(orgService.inviteStaff).toHaveBeenCalledTimes(1));
    const sent = orgService.inviteStaff.mock.calls[0][1];
    expect(sent).toMatchObject({ email: 'desk@example.com', role: 'trainer', roleId: FRONT_DESK.id });
    expect([...sent.privileges].sort()).toEqual(['attendance.read', 'members.read']);
  });

  it('New role saves a name with the ticked permissions and chooses it', async () => {
    orgService.createStaffRole.mockResolvedValue({ data: { role: { ...FRONT_DESK, privileges: ['attendance.read'] } } });
    const form = await openInvite();
    fireEvent.click(form.getByRole('button', { name: 'New role' }));
    fireEvent.change(form.getByLabelText('Role name'), { target: { value: 'Front desk' } });
    for (const box of within(form.getByTestId('invite-ticks')).getAllByRole('checkbox')) {
      if (box.checked) fireEvent.click(box);
    }
    fireEvent.click(form.getByLabelText(/^See who came in/));
    fireEvent.click(form.getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(orgService.createStaffRole).toHaveBeenCalledWith(ORG.id, { name: 'Front desk', privileges: ['attendance.read'] }));
    expect((await form.findByRole('radio', { name: 'Front desk' })).getAttribute('aria-checked')).toBe('true');
    expect(form.getByRole('button', { name: 'Send invitation' })).toBeTruthy();
  });

  it('a role without a name is not saved, and a refusal is said', async () => {
    orgService.createStaffRole.mockRejectedValue(apiError(409, 'role_name_reserved', "Manager is already one of the app's roles. Choose another name."));
    const form = await openInvite();
    fireEvent.click(form.getByRole('button', { name: 'New role' }));
    fireEvent.click(form.getByRole('button', { name: 'Save role' }));
    expect(form.getByText('Give the role a name.')).toBeTruthy();
    expect(orgService.createStaffRole).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('Role name'), { target: { value: 'Manager' } });
    fireEvent.click(form.getByRole('button', { name: 'Save role' }));
    expect(await form.findByText("Manager is already one of the app's roles. Choose another name.")).toBeTruthy();
  });

  it('a role is deleted only after asking, and says staff keep it', async () => {
    orgService.getStaffRoles.mockResolvedValue({ data: { roles: [FRONT_DESK] } });
    const form = await openInvite();
    fireEvent.click(form.getByRole('button', { name: 'Delete the role Front desk' }));
    expect(orgService.deleteStaffRole).not.toHaveBeenCalled();
    expect(form.getByText(/Staff who have it keep it/)).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(orgService.deleteStaffRole).toHaveBeenCalledWith(ORG.id, FRONT_DESK.id));
    await waitFor(() => expect(form.queryByRole('radio', { name: 'Front desk' })).toBeNull());
  });
});

// ── Invited ─────────────────────────────────────────────────────────────────

describe('the invitations waiting', () => {
  const id = (n) => `${n}f1c2b8e-0a4d-4f7e-9b1a-2c3d4e5f6a7b`;
  const row = async (n) => within(await screen.findByTestId(`staff-invite-${id(n)}`));

  it('lists each invitation with its role, until when, and whether the email went', async () => {
    orgService.getStaffInvites.mockResolvedValue({
      data: {
        invites: [
          INVITE,
          { ...INVITE, id: id(7), email: 'nomail@example.com', role: 'manager', emailStatus: 'not_sent', emailReason: 'no_mail_domain' },
          { ...INVITE, id: id(8), email: 'late@example.com', state: 'ended' },
          { ...INVITE, id: id(9), email: 'no@example.com', state: 'declined', declinedAt: '2026-10-02T09:00:00.000Z' },
        ],
      },
    });
    drawStaff();
    const waiting = await row(6);
    expect(waiting.getByText('anil@example.com')).toBeTruthy();
    expect(waiting.getByText(/^Trainer · Waiting for them to accept · until /)).toBeTruthy();
    expect(waiting.getByText('Email sent')).toBeTruthy();
    expect(waiting.getByRole('button', { name: 'Cancel invitation' })).toBeTruthy();
    expect((await row(7)).getByText(/^Manager · Waiting/)).toBeTruthy();
    expect((await row(7)).getByText(/this email address can't receive email/i)).toBeTruthy();
    expect((await row(8)).getByText(/^Trainer · Ended .* · not accepted$/)).toBeTruthy();
    expect((await row(8)).getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect((await row(8)).queryByText('Email sent')).toBeNull();
    expect((await row(9)).getByText(/^Trainer · Said no thanks · /)).toBeTruthy();
  });

  it('Cancel invitation asks first, naming the address, then cancels that one and reads the lists again', async () => {
    orgService.getStaffInvites.mockResolvedValue({ data: { invites: [INVITE] } });
    drawStaff();
    const waiting = await row(6);
    fireEvent.click(waiting.getByRole('button', { name: 'Cancel invitation' }));
    expect(waiting.getByText("Cancel the invitation to anil@example.com? They won't be able to accept it. You can invite them again.")).toBeTruthy();
    expect(orgService.cancelStaffInvite).not.toHaveBeenCalled();
    fireEvent.click(waiting.getByRole('button', { name: 'Keep it' }));
    expect(orgService.cancelStaffInvite).not.toHaveBeenCalled();
    fireEvent.click(waiting.getByRole('button', { name: 'Cancel invitation' }));
    fireEvent.click(waiting.getByRole('button', { name: 'Cancel invitation' }));
    await waitFor(() => expect(orgService.cancelStaffInvite).toHaveBeenCalledWith(ORG.id, INVITE.id));
    await waitFor(() => expect(orgService.getStaffInvites).toHaveBeenCalledTimes(2));
  });

  it('Remove on one that ended asks first too', async () => {
    orgService.getStaffInvites.mockResolvedValue({ data: { invites: [{ ...INVITE, id: id(8), email: 'late@example.com', state: 'ended' }] } });
    drawStaff();
    const ended = await row(8);
    fireEvent.click(ended.getByRole('button', { name: 'Remove' }));
    expect(ended.getByText('Remove the invitation to late@example.com from this list? You can invite them again.')).toBeTruthy();
    expect(orgService.cancelStaffInvite).not.toHaveBeenCalled();
    fireEvent.click(ended.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(orgService.cancelStaffInvite).toHaveBeenCalledWith(ORG.id, id(8)));
  });

  it('Send again sends that one again, says until when, and reads the lists again', async () => {
    orgService.getStaffInvites.mockResolvedValue({ data: { invites: [INVITE] } });
    orgService.resendStaffInvite.mockResolvedValue({
      data: { invite: { ...INVITE, expiresAt: '2026-10-10T09:00:00.000Z', lastSentAt: '2026-10-03T09:00:00.000Z', resendsLeft: 2, emailStatus: 'sending' } },
    });
    drawStaff();
    fireEvent.click((await row(6)).getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(orgService.resendStaffInvite).toHaveBeenCalledWith(ORG.id, INVITE.id));
    // Said in the invitation's own row, under the button that was pressed.
    expect(await (await row(6)).findByText(/^Sent again to anil@example\.com\. The invitation now works until /)).toBeTruthy();
    await waitFor(() => expect(orgService.getStaffInvites).toHaveBeenCalledTimes(2));
  });

  it('Send again is offered for an ended or declined one, says when it was sent again, and is not offered where it cannot help', async () => {
    orgService.getStaffInvites.mockResolvedValue({
      data: {
        invites: [
          { ...INVITE, id: id(1), email: 'again@example.com', lastSentAt: '2026-10-03T09:00:00.000Z', resendsLeft: 2 },
          { ...INVITE, id: id(2), email: 'late@example.com', state: 'ended' },
          { ...INVITE, id: id(3), email: 'no@example.com', state: 'declined', declinedAt: '2026-10-02T09:00:00.000Z' },
          { ...INVITE, id: id(4), email: 'bounce@example.com', emailStatus: 'not_sent', emailReason: 'bounced' },
          { ...INVITE, id: id(5), email: 'going@example.com', emailStatus: 'sending' },
          { ...INVITE, id: id(7), email: 'used@example.com', resendsLeft: 0 },
        ],
      },
    });
    drawStaff();
    expect((await row(1)).getByText(/^Email sent again · /)).toBeTruthy();
    for (const n of [1, 2, 3]) expect((await row(n)).getByRole('button', { name: 'Send again' })).toBeTruthy();
    // A bounced address, an email still going, and one sent four times: no button.
    for (const n of [4, 5, 7]) expect((await row(n)).queryByRole('button', { name: 'Send again' })).toBeNull();
    expect((await row(4)).getByText(/emails to this address bounce/i)).toBeTruthy();
    expect((await row(7)).getByText("Sent 4 times, so it can't be sent again. Remove it and invite them again if they still need it.")).toBeTruthy();
  });

  it("once the week's 3 emails have gone it says the day Send again opens, and a day already passed offers it", async () => {
    orgService.getStaffInvites.mockResolvedValue({
      data: {
        invites: [
          { ...INVITE, id: id(1), resendsLeft: 1, sendAgainFrom: '2099-10-08T09:00:00.000Z' },
          { ...INVITE, id: id(2), email: 'then@example.com', resendsLeft: 1, sendAgainFrom: '2020-10-08T09:00:00.000Z' },
        ],
      },
    });
    drawStaff();
    expect((await row(1)).queryByRole('button', { name: 'Send again' })).toBeNull();
    expect((await row(1)).getByText(/^3 emails went to this address this week\. You can send it again on /)).toBeTruthy();
    expect((await row(2)).getByRole('button', { name: 'Send again' })).toBeTruthy();
  });

  it('Send again refused because they are already staff: reads the list again, so the row goes, and still says why', async () => {
    orgService.getStaffInvites.mockResolvedValueOnce({ data: { invites: [INVITE] } });
    orgService.getStaffInvites.mockResolvedValue({ data: { invites: [] } });
    orgService.resendStaffInvite.mockRejectedValue(apiError(409, 'already_staff', 'Anil Rao is already a trainer here. Change what they can do instead of inviting them again.'));
    drawStaff();
    fireEvent.click((await row(6)).getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(orgService.getStaffInvites).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId(`staff-invite-${INVITE.id}`)).toBeNull());
    // The row it would have been said in is gone, so it is said over the lists.
    expect(screen.getByText(/Anil Rao is already a trainer here\./)).toBeTruthy();
  });

  it("Send again's other refusals are the server's own sentence, and the list is not read again", async () => {
    orgService.getStaffInvites.mockResolvedValue({ data: { invites: [INVITE] } });
    orgService.resendStaffInvite.mockRejectedValue(
      apiError(429, 'too_many_to_address', "You've sent anil@example.com 3 invitations this week. Try again next week."),
    );
    drawStaff();
    fireEvent.click((await row(6)).getByRole('button', { name: 'Send again' }));
    expect(await (await row(6)).findByText("You've sent anil@example.com 3 invitations this week. Try again next week.")).toBeTruthy();
    expect(orgService.getStaffInvites).toHaveBeenCalledTimes(1);
  });

  it('shows nothing under Invited when there are none', async () => {
    drawStaff();
    await screen.findByText('Kd Owner');
    expect(screen.queryByTestId('staff-invites')).toBeNull();
  });

  it('a list it cannot read says so, and who runs the gym is still shown', async () => {
    orgService.getStaffInvites.mockRejectedValue(offline());
    drawStaff();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
  });
});

// ── The tick boxes ──────────────────────────────────────────────────────────

describe('what one person is allowed to do', () => {
  it('ticks exactly what the SERVER says, not what the role would give', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const panel = await drawPerson();
    expect(panel.getByLabelText(/^See who's in the app/).checked).toBe(true);
    // Join codes are switched off (3c): their tick has no box, though the person holds it.
    expect(panel.queryByLabelText(/join code/i)).toBeNull();
    expect(panel.getByLabelText(/^Remove members/).checked).toBe(false);
    expect(panel.getByLabelText(/^Keep the member list and invite/).checked).toBe(false);
  });

  it('does NOT offer "Manage staff" for a manager', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const panel = await drawPerson();
    expect(panel.queryByLabelText(/^Manage staff/)).toBeNull();
    expect(panel.getByLabelText(/^See who's in the app/)).toBeTruthy();
  });

  it('asks the server NOTHING until something actually changes, and goes back to that if the change is undone', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const panel = await drawPerson();
    const save = panel.getByRole('button', { name: 'Save permissions' });
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    expect(save.disabled).toBe(false);
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    expect(save.disabled).toBe(true);
  });

  it('Cancel throws the edit away, asks the server nothing, and shows the server\'s set again', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const panel = await drawPerson();
    const ticks = within(panel.getByTestId('privileges-u2'));
    expect(ticks.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    fireEvent.click(ticks.getByRole('button', { name: 'Cancel' }));
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
    expect(panel.getByLabelText(/^Remove members/).checked).toBe(false);
    expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(true);
  });

  it("shows the server's own sentence when it refuses, whatever that sentence is", async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const SERVER_SAID = 'ZZ-MARKER: the gym would be left unable to do something it needs.';
    orgService.updateStaffPrivileges.mockRejectedValue(apiError(409, 'last_owner_locked', SERVER_SAID));
    const panel = await drawPerson();
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    fireEvent.click(panel.getByRole('button', { name: 'Save permissions' }));
    expect(await panel.findByText(SERVER_SAID)).toBeTruthy();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it('offers no Try again over a failed save: reading the list again cannot save anything', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    orgService.updateStaffPrivileges.mockRejectedValue(offline());
    const panel = await drawPerson();
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    fireEvent.click(panel.getByRole('button', { name: 'Save permissions' }));
    await panel.findByText(/Couldn't reach the server/i);
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('says "Permissions saved." once a save has landed and been read back', async () => {
    orgService.getStaff.mockResolvedValueOnce({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const panel = await drawPerson();
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER_TICKED, privileges: ['members.read', 'codes.invite', 'members.remove'] }] } });
    fireEvent.click(panel.getByLabelText(/^Remove members/));
    fireEvent.click(panel.getByRole('button', { name: 'Save permissions' }));
    expect(await panel.findByText('Permissions saved.')).toBeTruthy();
    expect(panel.getByLabelText(/^Remove members/).checked).toBe(true);
    // The next edit takes the line down: it is about the set that was saved.
    fireEvent.click(panel.getByLabelText(/^See who came in/));
    expect(panel.queryByText('Permissions saved.')).toBeNull();
  });

  /** The web and the api deploy apart: a server that sends no `privileges` must never be
   *  drawn as a colleague who can do nothing. */
  it('an older server that sends no permissions shows what the ROLE gives, not an empty set', async () => {
    const panel = await drawPerson();
    expect(panel.getByLabelText(/^See who's in the app/).checked).toBe(true);
    expect(panel.getByLabelText(/^Remove members/).checked).toBe(true);
    expect(panel.getByLabelText(/^Keep the member list and invite/).checked).toBe(true);
  });

  it('a permission held that has no box here is mentioned, so Save is not a silent half-truth', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER, privileges: ['members.read', 'billing.manage'] }] } });
    const panel = await drawPerson();
    expect(panel.getByText('They can also: Manage the plan and billing. Saving leaves it alone.')).toBeTruthy();
    expect(panel.queryByLabelText(/^Manage the plan and billing/)).toBeNull();
  });

  /** What the real server sends for each role. A manager's timetable tick had no box until
   *  23c-ii, so this line was on every manager's panel; the owner's said it of three. */
  it('and is not mentioned for anybody on their role\'s usual set: every one of those has a box', async () => {
    orgService.getStaff.mockResolvedValue({
      data: {
        staff: [
          { ...OWNER, privileges: [...ROLE_PRIVILEGES.owner] },
          { ...MANAGER, privileges: [...ROLE_PRIVILEGES.manager] },
          { ...TRAINER, privileges: [...ROLE_PRIVILEGES.trainer] },
        ],
      },
    });
    const rita = await drawPerson();
    expect(rita.queryByText(/no box for/)).toBeNull();
    expect(rita.getByLabelText(/^Run classes and personal training/).checked).toBe(true);
    fireEvent.click(rita.getByRole('button', { name: 'Close' }));
    const anil = await openPerson('u3', 'Anil Bora');
    expect(anil.queryByText(/no box for/)).toBeNull();
    expect(anil.getByLabelText(/^Run classes and personal training/).checked).toBe(false);
    fireEvent.click(anil.getByRole('button', { name: 'Close' }));
    const owner = await openPerson('u1', 'Kd Owner');
    expect(owner.queryByText(/no box for/)).toBeNull();
    for (const label of [/^Run classes and personal training/, /^Change gym details/, /^Manage the plan and billing/, /^Manage staff/]) {
      expect(owner.getByLabelText(label).checked).toBe(true);
      expect(owner.getByLabelText(label).disabled).toBe(true);
    }
  });
});

// ── Who gets the tab, and a gym with no plan ────────────────────────────────

describe('who gets the Staff tab', () => {
  /** Kd, RULINGS 2026-10-07: the page holds the staff, so its name says so, for whoever
   *  has the tab. A manager's page holds none, and is not called what it is not. */
  it('the page is titled "Members & staff" for the owner, and "Members" for a manager, who has no Staff tab', async () => {
    drawStaff();
    expect(await screen.findByRole('heading', { level: 1, name: 'Members & staff' })).toBeTruthy();
    cleanup();
    resetConsoleOrgs();
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, staffRole: 'manager', privileges: ROLE_PRIVILEGES.manager.filter((p) => p !== 'staff.manage') }] },
    });
    drawStaff();
    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeTruthy();
    expect(screen.queryByText(/& staff/)).toBeNull();
  });

  it('a manager who types its address gets the list they may see, and the server is asked nothing about staff', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, staffRole: 'manager', privileges: ROLE_PRIVILEGES.manager.filter((p) => p !== 'staff.manage') }] },
    });
    drawStaff('/console/iron-house/members?view=staff&open=invite');
    expect(await screen.findByRole('tab', { name: 'Your list' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Staff' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(orgService.getStaff).not.toHaveBeenCalled();
    expect(orgService.getStaffInvites).not.toHaveBeenCalled();
    expect(orgService.getStaffRoles).not.toHaveBeenCalled();
  });

  it('a trainer who types its address is asked nothing about staff either', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer' }] } });
    drawStaff();
    await waitFor(() => expect(orgService.getMembers).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: 'Staff' })).toBeNull();
    expect(screen.queryByText('Rita Sen')).toBeNull();
    expect(orgService.getStaff).not.toHaveBeenCalled();
  });

  it('"?open=invite" opens the Staff tab with the form already open, once', async () => {
    drawStaff('/console/iron-house/members?view=staff&open=invite');
    const form = within(await screen.findByRole('dialog', { name: 'Invite staff' }));
    expect(screen.getByRole('tab', { name: 'Staff' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Closed stays closed: the address no longer asks for it.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a gym with no live plan', () => {
  // The server's own answer to "may this console change anything".
  const LAPSED = { ...ORG, subscription: null, consoleReadOnly: true };

  it('sees its staff and invitations, and every control that changes them is greyed', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [LAPSED] } });
    orgService.getStaffInvites.mockResolvedValue({ data: { invites: [INVITE] } });
    drawStaff('/console/iron-house/members?view=staff&open=invite');
    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Invite staff' }).disabled).toBe(true);
    const invite = within(screen.getByTestId(`staff-invite-${INVITE.id}`));
    expect(invite.getByRole('button', { name: 'Send again' }).disabled).toBe(true);
    expect(invite.getByRole('button', { name: 'Cancel invitation' }).disabled).toBe(true);
    const panel = await openPerson('u2', 'Rita Sen');
    expect(panel.getByRole('button', { name: 'Make trainer' }).disabled).toBe(true);
    expect(panel.getByRole('button', { name: 'Remove from staff' }).disabled).toBe(true);
    expect(panel.getByLabelText(/^Remove members/).disabled).toBe(true);
    expect(panel.getByRole('button', { name: 'Save permissions' }).disabled).toBe(true);
  });
});

// 23d-ii: the email reason that needs the gym's name changed has the button to that box.
describe("an invitation whose email did not go because of the gym's name", () => {
  const id = (n) => `${n}f1c2b8e-0a4d-4f7e-9b1a-2c3d4e5f6a7b`;

  it('has the button to the gym details, on that invitation alone', async () => {
    orgService.getStaffInvites.mockResolvedValue({
      data: {
        invites: [
          { ...INVITE, id: id(3), email: 'name@example.com', emailStatus: 'not_sent', emailReason: 'gym_name' },
          { ...INVITE, id: id(4), email: 'bounce@example.com', emailStatus: 'not_sent', emailReason: 'bounced' },
          { ...INVITE, id: id(5), email: 'ended@example.com', state: 'ended', emailStatus: 'not_sent', emailReason: 'gym_name' },
        ],
      },
    });
    drawStaff();
    const named = within(await screen.findByTestId(`staff-invite-${id(3)}`));
    expect(named.getByText("Email not sent: an email couldn't show your business name as it was written. Change it to the name in words, then send it again.")).toBeTruthy();
    expect(named.getByRole('link', { name: 'Open Gym details' }).getAttribute('href')).toBe('/console/iron-house/settings#gym-details');
    expect(within(screen.getByTestId(`staff-invite-${id(4)}`)).queryByRole('link')).toBeNull();
    expect(within(screen.getByTestId(`staff-invite-${id(5)}`)).queryByRole('link')).toBeNull();
    expect(document.body.textContent).not.toMatch(/in Settings/);
  });
});

// REMOVE FROM STAFF AND APP, WITH PERSONAL TRAINING BOOKED FOR THEM (17e-iv-a).
describe('Remove from staff and app names the personal training sessions it cancels', () => {
  const MARK = 'c'.repeat(64);
  const sessions = {
    count: 1,
    packSessions: 1,
    mark: MARK,
    sessions: [{ id: '66666666-6666-4666-8666-000000000001', personName: 'Rita Sen', trainerName: 'Sam Trainer', localDate: '2026-10-09', localStartMinute: 600, minutes: 60, packSession: true }],
  };
  const asks = () => Object.assign(new Error('refused'), { response: { status: 409, data: { error: 'pt_sessions_ending', message: 'This person has personal training sessions booked.', sessions } } });

  it('nobody is removed until the box that names the session is confirmed, and the mark goes back', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER, isMember: true }] } });
    orgService.removeMember.mockRejectedValueOnce(asks()).mockResolvedValueOnce({ data: { status: 'removed' } });
    const panel = await drawPerson();
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    fireEvent.click(panel.getByRole('checkbox', { name: 'Also remove Rita Sen from the app' }));
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff and app' }));
    const box = within(await screen.findByTestId('pt-sessions-end-box'));
    expect(orgService.removeMember).toHaveBeenLastCalledWith(ORG.id, 'u2', { alsoStaff: true });
    expect(box.getByRole('heading', { name: 'Remove Rita Sen?' })).toBeTruthy();
    expect(box.getByText("Rita Sen hasn't been removed yet: they have personal training booked.")).toBeTruthy();
    expect(box.getByRole('heading', { name: '1 personal training session will be cancelled' })).toBeTruthy();
    // One person's box: the line leads with when, and her name is in the title alone.
    expect(within(box.getByTestId('pt-sessions-ending')).getByRole('listitem').textContent).toMatch(/^Fri 9 Oct · .*with Sam Trainer$/);
    expect(box.getByText("The trainer's time can be booked again. 1 session goes back to its pack. A session that has already started stays as it is.")).toBeTruthy();
    expect(orgService.removeMember).toHaveBeenCalledTimes(1);

    fireEvent.click(box.getByRole('button', { name: 'Remove and cancel 1 session' }));
    await waitFor(() => expect(orgService.removeMember).toHaveBeenCalledTimes(2));
    expect(orgService.removeMember).toHaveBeenLastCalledWith(ORG.id, 'u2', { alsoStaff: true, confirmPtSessions: MARK });
    await waitFor(() => expect(screen.queryByTestId('pt-sessions-end-box')).toBeNull());
    expect(await screen.findByText('Rita Sen was removed from staff and from the app.')).toBeTruthy();
  });

  it("Don't remove closes the box with nothing more sent", async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, { ...MANAGER, isMember: true }] } });
    orgService.removeMember.mockRejectedValue(asks());
    const panel = await drawPerson();
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff' }));
    fireEvent.click(panel.getByRole('checkbox', { name: 'Also remove Rita Sen from the app' }));
    fireEvent.click(panel.getByRole('button', { name: 'Remove from staff and app' }));
    const box = within(await screen.findByTestId('pt-sessions-end-box'));
    fireEvent.click(box.getByRole('button', { name: "Don't remove" }));
    expect(screen.queryByTestId('pt-sessions-end-box')).toBeNull();
    expect(orgService.removeMember).toHaveBeenCalledTimes(1);
    expect(orgService.removeStaff).not.toHaveBeenCalled();
  });
});
