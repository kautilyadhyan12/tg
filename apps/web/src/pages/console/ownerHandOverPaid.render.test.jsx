// A gym paying through Paddle handed to a co-owner (ROADMAP 4b-iii-a): the owner's box says
// the new owner pays from then on, the co-owner's Accept opens Paddle's window for their own
// card, and the gym is said to be theirs only once the server says so.
//
// The first tests are the job's worst thing on the screen: a co-owner told they are the owner
// when no card was saved, or an owner not told that the plan moves to the other person.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react';
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
      askOwner: vi.fn(),
      cancelOwnerRequest: vi.fn(),
      getMyOwnerRequest: vi.fn(),
      answerOwnerRequest: vi.fn(),
      ownerCardSaved: vi.fn(),
    },
  };
});
vi.mock('../../utils/paddleCheckout', () => ({ openPaddleCheckout: vi.fn(), closePaddleCheckout: vi.fn() }));
vi.mock('../../api/staffActivityApi', () => ({ staffActivityService: { list: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }) }));

const { orgService } = await import('../../api/orgsApi');
const { openPaddleCheckout } = await import('../../utils/paddleCheckout');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Members = (await import('./Members')).default;
const CoOwnerRequest = (await import('../../components/console/CoOwnerRequest')).default;

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
const CORA = person({ userId: 'u3', displayName: 'Cora Lim', role: 'owner', coOwner: true });
const UNTIL = '2026-10-24T09:00:00.000Z';
const staffAs = (list, extra) => ({ data: { staff: list.map((p) => ({ ...p, isYou: p.userId === 'u1' })), paidPlan: false, paidPlanNote: null, cardNeeded: false, ...extra } });

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
  orgService.getStaffInvites.mockResolvedValue({ data: { invites: [] } });
  orgService.getStaffRoles.mockResolvedValue({ data: { roles: [] } });
});
afterEach(() => cleanup());

describe('the owner, on a co-owner of a gym paying through Paddle', () => {
  it('the box says they pay for the plan from then on and the owner will not be charged again', async () => {
    orgService.getStaff.mockResolvedValue(staffAs([OWNER, CORA], { cardNeeded: true }));
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    fireEvent.click(panel.getByRole('button', { name: 'Make owner' }));
    const owner = within(panel.getByTestId('staff-owner'));
    expect(owner.getByText(/they become the owner when they press Accept and add their card\./)).toBeTruthy();
    expect(owner.getByText("Cora Lim pays for the plan from then on, with their own card. You won't be charged again.")).toBeTruthy();
  });

  it('a gym with no paid plan says nothing about a card', async () => {
    orgService.getStaff.mockResolvedValue(staffAs([OWNER, CORA]));
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    fireEvent.click(panel.getByRole('button', { name: 'Make owner' }));
    const owner = within(panel.getByTestId('staff-owner'));
    expect(owner.getByText(/they become the owner when they press Accept\./)).toBeTruthy();
    expect(owner.queryByText(/pays for the plan/)).toBeNull();
  });

  it("while they add their card, the wait says so and Cancel request is still there", async () => {
    orgService.getStaff.mockResolvedValue(staffAs([OWNER, { ...CORA, ownerRequest: { expiresAt: UNTIL, addingCard: true } }], { cardNeeded: true }));
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    expect(panel.getByText("Cora Lim accepted and is adding their card. Iron House moves to them once it's saved.")).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Cancel request' })).toBeTruthy();
  });

  it("a plan that stops a hand-over says the server's reason, and Make owner cannot be pressed", async () => {
    const note = 'A payment is overdue, so the owner can\'t be changed until it\'s paid.';
    orgService.getStaff.mockResolvedValue(staffAs([OWNER, CORA], { paidPlan: true, paidPlanNote: note }));
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    expect(panel.getByText(note)).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Make owner' }).disabled).toBe(true);
  });
});

describe('the co-owner asked, on Overview, for a gym paying through Paddle', () => {
  const REQUEST = { id: '22222222-2222-4222-8222-222222222222', ownerName: 'Kd Owner', expiresAt: UNTIL, cardNeeded: true };
  const CARD = { environment: 'sandbox', clientToken: 'test_x', transactionId: 'txn_' + 'a'.repeat(26), email: 'cora@example.com' };
  const draw = () => {
    const onAccepted = vi.fn();
    render(<CoOwnerRequest kind="owner" gymId={ORG.id} gymName="Iron House" onAccepted={onAccepted} />);
    return onAccepted;
  };
  /** Accept, then Paddle's window: hand back what the window would tell the page. */
  const acceptToWindow = async () => {
    orgService.getMyOwnerRequest.mockResolvedValue({ data: { request: REQUEST } });
    orgService.answerOwnerRequest.mockResolvedValue({ data: { status: 'card_needed', card: CARD } });
    let onEvent = null;
    openPaddleCheckout.mockImplementation(async (opts) => {
      onEvent = opts.onEvent;
    });
    const onAccepted = draw();
    const box = within(await screen.findByTestId('owner-request'));
    fireEvent.click(box.getByRole('button', { name: 'Accept and add your card' }));
    await waitFor(() => expect(openPaddleCheckout).toHaveBeenCalledTimes(1));
    return { onAccepted, box, fire: (event) => act(() => onEvent(event)) };
  };

  it('is told they pay from now on, and is never called the owner when the window closes without a card', async () => {
    const { onAccepted, box, fire } = await acceptToWindow();
    expect(box.getByText(/you pay for the plan from now on with your own card\. Kd Owner stays on as a co-owner and won't be charged again\./)).toBeTruthy();
    expect(openPaddleCheckout.mock.calls[0][0]).toMatchObject({ transactionId: CARD.transactionId, email: CARD.email });
    await fire({ type: 'closed' });
    expect(await screen.findByText("Your card wasn't saved, so nothing has changed. Press Accept and add your card to try again.")).toBeTruthy();
    expect(screen.queryByText(/You're now the owner/)).toBeNull();
    expect(orgService.ownerCardSaved).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
    expect(box.getByRole('button', { name: 'Accept and add your card' }).disabled).toBe(false);
  });

  it('a saved card is the owner only once the server says so', async () => {
    orgService.ownerCardSaved.mockResolvedValueOnce({ data: { status: 'waiting' } }).mockResolvedValueOnce({ data: { status: 'accepted' } });
    const { onAccepted, fire } = await acceptToWindow();
    await fire({ type: 'completed', transactionId: CARD.transactionId });
    // Paddle closes its window after the card is saved: that is not "not saved".
    await fire({ type: 'closed' });
    expect(screen.queryByText(/Your card wasn't saved/)).toBeNull();
    expect(await screen.findByText("You're now the owner of Iron House. Your card pays for the plan from now on.", undefined, { timeout: 5000 })).toBeTruthy();
    expect(orgService.ownerCardSaved).toHaveBeenCalledWith(ORG.id, REQUEST.id);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("a request that ended while the card was saved says the server's sentence, not that they are the owner", async () => {
    orgService.ownerCardSaved.mockRejectedValue({ response: { status: 409, data: { error: 'request_gone', message: 'This request has ended.', requestId: 'r' } } });
    const { onAccepted, fire } = await acceptToWindow();
    await fire({ type: 'completed', transactionId: CARD.transactionId });
    expect(await screen.findByText('This request has ended.')).toBeTruthy();
    expect(screen.queryByText(/You're now the owner/)).toBeNull();
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
