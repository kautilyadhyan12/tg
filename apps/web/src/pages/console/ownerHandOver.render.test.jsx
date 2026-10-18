// The owner hands the gym to a co-owner (ROADMAP 4b-ii): Make owner on a co-owner of
// Members → Staff, and the co-owner's Accept or Decline on Overview.
//
// The first tests are the job's worst thing on the screen: a Make owner drawn for somebody
// who may not give the gym away, or on somebody who is not a co-owner, or a box that does
// not say who becomes the owner and what happens to the owner pressing it.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
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
      getStaffInvites: vi.fn(),
      getStaffRoles: vi.fn(),
      askCoOwner: vi.fn(),
      cancelCoOwnerRequest: vi.fn(),
      askOwner: vi.fn(),
      cancelOwnerRequest: vi.fn(),
      getMyOwnerRequest: vi.fn(),
      answerOwnerRequest: vi.fn(),
    },
  };
});
vi.mock('../../api/staffActivityApi', () => ({ staffActivityService: { list: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }) }));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Members = (await import('./Members')).default;
const CoOwnerRequest = (await import('../../components/console/CoOwnerRequest')).default;
const { StaffPersonPanel } = await import('./MembersStaffPanels');
const { formatJoinedAt, orgWords } = await import('./consoleView');
const PAID_UNTIL = '2026-11-01T00:00:00.000Z';

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
const person = (over) => ({ email: null, since: '2026-08-20T09:00:00.000Z', isYou: false, isMember: false, coOwner: false, coOwnerRequest: null, ownerRequest: null, ...over });
const OWNER = person({ userId: 'u1', displayName: 'Kd Owner', role: 'owner' });
const RITA = person({ userId: 'u2', displayName: 'Rita Sen', role: 'manager' });
const CORA = person({ userId: 'u3', displayName: 'Cora Lim', role: 'owner', coOwner: true });
const DAN = person({ userId: 'u4', displayName: 'Dan Roy', role: 'owner', coOwner: true });
const UNTIL = '2026-10-24T09:00:00.000Z';
const CORA_ASKED = { ...CORA, ownerRequest: { expiresAt: UNTIL } };
const apiError = (status, error, message) => ({ response: { status, data: { error, message, requestId: 'r' } } });

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
const staffAs = (you, list, paidPlan = false) => ({ data: { staff: list.map((p) => ({ ...p, isYou: p.userId === you })), paidPlan } });

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
  orgService.getStaff.mockResolvedValue(staffAs('u1', [OWNER, CORA, DAN, RITA]));
  orgService.getStaffInvites.mockResolvedValue({ data: { invites: [] } });
  orgService.getStaffRoles.mockResolvedValue({ data: { roles: [] } });
  orgService.askOwner.mockResolvedValue({ data: { request: { userId: 'u3', expiresAt: UNTIL }, emailed: true } });
  orgService.cancelOwnerRequest.mockResolvedValue({ data: { status: 'cancelled' } });
});
afterEach(() => cleanup());

describe('Make owner is offered by the owner alone, on a co-owner alone, and asks first', () => {
  it('a co-owner reading the Staff tab is offered Make owner on nobody', async () => {
    orgService.getStaff.mockResolvedValue(staffAs('u3', [OWNER, CORA, DAN, RITA]));
    drawStaff();
    for (const [id, name] of [['u1', 'Kd Owner'], ['u3', 'Cora Lim'], ['u4', 'Dan Roy'], ['u2', 'Rita Sen']]) {
      const panel = await openPerson(id, name);
      expect(panel.queryByRole('button', { name: 'Make owner' })).toBeNull();
      expect(panel.queryByTestId('staff-owner')).toBeNull();
      fireEvent.click(panel.getByRole('button', { name: /close/i }));
    }
  });

  it('the owner is offered Make owner on a co-owner, and not on a manager or on themselves', async () => {
    drawStaff();
    let panel = await openPerson('u2', 'Rita Sen');
    expect(panel.queryByRole('button', { name: 'Make owner' })).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: /close/i }));
    panel = await openPerson('u1', 'Kd Owner');
    expect(panel.queryByRole('button', { name: 'Make owner' })).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: /close/i }));
    panel = await openPerson('u3', 'Cora Lim');
    expect(panel.getByText('Hand Iron House over to Cora Lim. You stay on as a co-owner.')).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Make owner' })).toBeTruthy();
  });

  it('the box names who becomes the owner and what happens to the owner, before anything is sent', async () => {
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    fireEvent.click(panel.getByRole('button', { name: 'Make owner' }));
    expect(orgService.askOwner).not.toHaveBeenCalled();
    expect(panel.getByText("Make Cora Lim the owner of Iron House? We'll email them, and they become the owner when they press Accept.")).toBeTruthy();
    expect(panel.getByText('Cora Lim becomes the owner and can add or remove co-owners, including you.')).toBeTruthy();
    expect(panel.getByText('You stay on as a co-owner and can still do everything else.')).toBeTruthy();
    expect(panel.getByText("Handing over doesn't give you a new free trial.")).toBeTruthy();
    fireEvent.click(within(panel.getByTestId('staff-owner')).getByRole('button', { name: 'Cancel' }));
    expect(panel.getByRole('button', { name: 'Make owner' })).toBeTruthy();
    expect(orgService.askOwner).not.toHaveBeenCalled();
  });
});

describe('Make owner', () => {
  it('Send request asks the server for that co-owner, says it in the panel, and the row says they were asked', async () => {
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    fireEvent.click(panel.getByRole('button', { name: 'Make owner' }));
    orgService.getStaff.mockResolvedValue(staffAs('u1', [OWNER, CORA_ASKED, DAN, RITA]));
    fireEvent.click(panel.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(orgService.askOwner).toHaveBeenCalledWith(ORG.id, 'u3'));
    expect(await panel.findByText("Request sent. We've emailed Cora Lim; they accept it on the Overview when they open the console.")).toBeTruthy();
    expect(panel.getByText(/You asked Cora Lim to be the owner\. Waiting for them to accept\. The request ends on/)).toBeTruthy();
    expect(within(screen.getByTestId('staff-tab-u3')).getByText('Asked to be owner')).toBeTruthy();
    expect(within(screen.getByTestId('staff-tab-u4')).queryByText('Asked to be owner')).toBeNull();
  });

  it('Cancel request takes it back and says so', async () => {
    orgService.getStaff.mockResolvedValue(staffAs('u1', [OWNER, CORA_ASKED, DAN, RITA]));
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    orgService.getStaff.mockResolvedValue(staffAs('u1', [OWNER, CORA, DAN, RITA]));
    fireEvent.click(panel.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(orgService.cancelOwnerRequest).toHaveBeenCalledWith(ORG.id, 'u3'));
    expect(await panel.findByText("Request cancelled. Cora Lim can't accept it any more.")).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Make owner' })).toBeTruthy();
  });

  it('a gym on a paid plan says so, and its Make owner cannot be pressed', async () => {
    orgService.getStaff.mockResolvedValue(staffAs('u1', [OWNER, CORA, DAN, RITA], true));
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    expect(panel.getByText("This gym is on a paid plan, so it can't be handed over.")).toBeTruthy();
    const button = panel.getByRole('button', { name: 'Make owner' });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(panel.queryByText(/We'll email them, and they become the owner/)).toBeNull();
    expect(orgService.askOwner).not.toHaveBeenCalled();
  });

  it('a plan paid through Paddle: the box says it stops renewing, paid until a day, and the new owner then chooses one (4b-iii-a)', async () => {
    orgService.getStaff.mockResolvedValue({ data: { ...staffAs('u1', [OWNER, CORA, DAN, RITA]).data, paidUntil: PAID_UNTIL } });
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    fireEvent.click(panel.getByRole('button', { name: 'Make owner' }));
    expect(
      within(panel.getByTestId('staff-owner')).getByText(
        `Your plan stops renewing, so you won't be charged again. It stays paid until ${formatJoinedAt(PAID_UNTIL)}; then Cora Lim chooses their own plan.`,
      ),
    ).toBeTruthy();
  });

  it("a plan that stops a hand-over says the server's reason (4b-iii-a)", async () => {
    const note = "A payment is overdue, so the owner can't be changed until it's paid.";
    orgService.getStaff.mockResolvedValue({ data: { ...staffAs('u1', [OWNER, CORA, DAN, RITA], true).data, paidPlanNote: note } });
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    expect(panel.getByText(note)).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Make owner' }).disabled).toBe(true);
  });

  it('with another co-owner asked, it names them and opens their page to cancel it', async () => {
    orgService.getStaff.mockResolvedValue(staffAs('u1', [OWNER, CORA_ASKED, DAN, RITA]));
    drawStaff();
    const panel = await openPerson('u4', 'Dan Roy');
    expect(panel.getByText("You've asked Cora Lim to be the owner. Cancel that request to ask Dan Roy instead.")).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Make owner' })).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: 'Open Cora Lim' }));
    const cora = within(await screen.findByRole('dialog', { name: 'Cora Lim' }));
    expect(cora.getByRole('button', { name: 'Cancel request' })).toBeTruthy();
  });

  it("a refusal is the server's sentence, in the Owner part", async () => {
    orgService.askOwner.mockRejectedValue(apiError(409, 'paid_plan', "While a paid plan is running, the owner can't be changed."));
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    fireEvent.click(panel.getByRole('button', { name: 'Make owner' }));
    fireEvent.click(panel.getByRole('button', { name: 'Send request' }));
    expect(await within(panel.getByTestId('staff-owner')).findByText("While a paid plan is running, the owner can't be changed.")).toBeTruthy();
  });
});

it("a gym with no plan is still handed over: Make owner can be pressed while the rest of the panel is greyed", () => {
  render(
    <StaffPersonPanel person={CORA} roles={[]} orgType="gym" words={orgWords('gym')} gymName="Iron House" viewerIsOwner staff={[OWNER, CORA]} readOnly busy={false} error={null} onClose={vi.fn()} />,
  );
  const owner = within(screen.getByTestId('staff-owner'));
  const button = owner.getByRole('button', { name: 'Make owner' });
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(owner.getByRole('button', { name: 'Send request' }).disabled).toBe(false);
});

describe('the co-owner asked, on Overview', () => {
  const REQUEST = { id: '22222222-2222-4222-8222-222222222222', ownerName: 'Kd Owner', expiresAt: UNTIL };
  const draw = (onAccepted = vi.fn()) => {
    render(<CoOwnerRequest kind="owner" gymId={ORG.id} gymName="Iron House" onAccepted={onAccepted} />);
    return onAccepted;
  };

  it('draws nothing when no request waits', async () => {
    orgService.getMyOwnerRequest.mockResolvedValue({ data: { request: null } });
    draw();
    await waitFor(() => expect(orgService.getMyOwnerRequest).toHaveBeenCalledWith(ORG.id));
    expect(screen.queryByTestId('owner-request')).toBeNull();
  });

  it('names who asked, what changes for both, and Accept says it in place and reads the gym again', async () => {
    orgService.getMyOwnerRequest.mockResolvedValue({ data: { request: REQUEST } });
    orgService.answerOwnerRequest.mockResolvedValue({ data: { status: 'accepted' } });
    const onAccepted = draw();
    const box = within(await screen.findByTestId('owner-request'));
    expect(box.getByText('Be the owner of Iron House')).toBeTruthy();
    expect(box.getByText('Kd Owner asked you to be the owner.')).toBeTruthy();
    expect(box.getByText(/As the owner you can also add and remove co-owners\. Kd Owner stays on as a co-owner\. The request works until/)).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText("You're now the owner of Iron House.")).toBeTruthy();
    expect(orgService.answerOwnerRequest).toHaveBeenCalledWith(ORG.id, REQUEST.id, true);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("a plan paid through Paddle: they're told it stops renewing, paid until a day, and they then choose their own (4b-iii-a)", async () => {
    orgService.getMyOwnerRequest.mockResolvedValue({ data: { request: { ...REQUEST, paidUntil: PAID_UNTIL } } });
    draw();
    const box = within(await screen.findByTestId('owner-request'));
    expect(
      box.getByText(
        `As the owner you can also add and remove co-owners. Kd Owner stays on as a co-owner. Their plan stops renewing and stays paid until ${formatJoinedAt(PAID_UNTIL)}; then you choose your own plan and pay with your own card. The request works until ${formatJoinedAt(UNTIL)}.`,
      ),
    ).toBeTruthy();
    expect(box.getByRole('button', { name: 'Accept' })).toBeTruthy();
  });

  it('Decline says the owner can ask again, and changes nothing else', async () => {
    orgService.getMyOwnerRequest.mockResolvedValue({ data: { request: REQUEST } });
    orgService.answerOwnerRequest.mockResolvedValue({ data: { status: 'declined' } });
    const onAccepted = draw();
    fireEvent.click(within(await screen.findByTestId('owner-request')).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('You said no. Kd Owner can ask you again.')).toBeTruthy();
    expect(orgService.answerOwnerRequest).toHaveBeenCalledWith(ORG.id, REQUEST.id, false);
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
