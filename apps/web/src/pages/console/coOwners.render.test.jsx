// Co-owners (ROADMAP 4b-i): Make co-owner on a person of Members → Staff, and the asked
// person's Accept or Decline on Overview.
//
// The first tests are the job's worst thing on the screen: a button that offers owner
// powers to somebody, drawn for a person who may not give them, or a box that does not
// say who is being asked and what they will be able to do.
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
      updateStaffRole: vi.fn(),
      removeStaff: vi.fn(),
      askCoOwner: vi.fn(),
      cancelCoOwnerRequest: vi.fn(),
      getMyCoOwnerRequest: vi.fn(),
      answerCoOwnerRequest: vi.fn(),
    },
  };
});
vi.mock('../../api/staffActivityApi', () => ({ staffActivityService: { list: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }) }));

const { orgService } = await import('../../api/orgsApi');
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
const person = (over) => ({ email: null, since: '2026-08-20T09:00:00.000Z', isYou: false, isMember: false, coOwner: false, coOwnerRequest: null, ...over });
const OWNER = person({ userId: 'u1', displayName: 'Kd Owner', role: 'owner' });
const RITA = person({ userId: 'u2', displayName: 'Rita Sen', role: 'manager' });
const CORA = person({ userId: 'u3', displayName: 'Cora Lim', role: 'owner', coOwner: true });
const ASKED = { ...RITA, coOwnerRequest: { expiresAt: '2026-10-23T09:00:00.000Z' } };
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
/** The list as somebody reads it: `you` is the row that is theirs. */
const staffAs = (you, list) => list.map((p) => ({ ...p, isYou: p.userId === you }));

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
  orgService.getStaff.mockResolvedValue({ data: { staff: staffAs('u1', [OWNER, CORA, RITA]) } });
  orgService.getStaffInvites.mockResolvedValue({ data: { invites: [] } });
  orgService.getStaffRoles.mockResolvedValue({ data: { roles: [] } });
  orgService.askCoOwner.mockResolvedValue({ data: { request: { userId: 'u2', expiresAt: ASKED.coOwnerRequest.expiresAt }, emailed: true } });
  orgService.cancelCoOwnerRequest.mockResolvedValue({ data: { status: 'cancelled' } });
});
afterEach(() => cleanup());

describe('owner powers are offered only by the owner, and the box says who and what', () => {
  it('a co-owner reading the Staff tab is offered no Make co-owner, and cannot change the owner or another co-owner', async () => {
    const DAN = person({ userId: 'u4', displayName: 'Dan Roy', role: 'owner', coOwner: true });
    orgService.getStaff.mockResolvedValue({ data: { staff: staffAs('u3', [OWNER, CORA, DAN, RITA]) } });
    drawStaff();
    let panel = await openPerson('u2', 'Rita Sen');
    expect(panel.queryByRole('button', { name: 'Make co-owner' })).toBeNull();
    expect(panel.getByRole('button', { name: 'Remove from staff' })).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: /close/i }));

    panel = await openPerson('u4', 'Dan Roy');
    expect(panel.getByText('Only the owner can change or remove a co-owner.')).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Remove from staff' })).toBeNull();
    expect(panel.queryByRole('button', { name: /^Make / })).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: /close/i }));

    panel = await openPerson('u1', 'Kd Owner');
    expect(panel.queryByRole('button', { name: 'Remove from staff' })).toBeNull();
    expect(panel.queryByRole('button', { name: /^Make / })).toBeNull();
  });

  it('the owner presses Make co-owner and is asked first, by name, with what changes and what stays', async () => {
    drawStaff();
    const panel = await openPerson('u2', 'Rita Sen');
    fireEvent.click(panel.getByRole('button', { name: 'Make co-owner' }));
    expect(orgService.askCoOwner).not.toHaveBeenCalled();
    expect(
      panel.getByText(
        "Ask Rita Sen to be a co-owner of Iron House? We'll email them, and they become a co-owner when they press Accept. They'll be able to manage staff, billing and settings. You stay the owner, and only you can add or remove co-owners.",
      ),
    ).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Cancel' }));
    expect(panel.getByRole('button', { name: 'Make co-owner' })).toBeTruthy();
    expect(orgService.askCoOwner).not.toHaveBeenCalled();
  });

  it('the owner\'s own row and a co-owner\'s offer no Make co-owner', async () => {
    drawStaff();
    let panel = await openPerson('u1', 'Kd Owner');
    expect(panel.queryByRole('button', { name: 'Make co-owner' })).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: /close/i }));
    panel = await openPerson('u3', 'Cora Lim');
    expect(panel.queryByRole('button', { name: 'Make co-owner' })).toBeNull();
  });
});

describe('Make co-owner', () => {
  it('Send request asks the server for that person, says it in the panel, and the row says they were asked', async () => {
    drawStaff();
    const panel = await openPerson('u2', 'Rita Sen');
    fireEvent.click(panel.getByRole('button', { name: 'Make co-owner' }));
    orgService.getStaff.mockResolvedValue({ data: { staff: staffAs('u1', [OWNER, CORA, ASKED]) } });
    fireEvent.click(panel.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(orgService.askCoOwner).toHaveBeenCalledWith(ORG.id, 'u2'));
    expect(await panel.findByText("Request sent. We've emailed Rita Sen; they accept it on the Overview when they open the console.")).toBeTruthy();
    expect(panel.getByText(/You asked Rita Sen to be a co-owner\. Waiting for them to accept\. The request ends on/)).toBeTruthy();
    expect(within(screen.getByTestId('staff-tab-u2')).getByText('Asked to be co-owner')).toBeTruthy();
  });

  it('an email that did not go is said, and the request still waits', async () => {
    orgService.askCoOwner.mockResolvedValue({ data: { request: { userId: 'u2', expiresAt: ASKED.coOwnerRequest.expiresAt }, emailed: false } });
    drawStaff();
    const panel = await openPerson('u2', 'Rita Sen');
    fireEvent.click(panel.getByRole('button', { name: 'Make co-owner' }));
    fireEvent.click(panel.getByRole('button', { name: 'Send request' }));
    expect(await panel.findByText("Request sent, but we couldn't email Rita Sen. They'll see it on the Overview when they open the console.")).toBeTruthy();
  });

  it("a refusal is the server's sentence, in the Co-owner part", async () => {
    orgService.askCoOwner.mockRejectedValue(apiError(409, 'already_requested', "You've already asked them. The request is waiting for their answer."));
    drawStaff();
    const panel = await openPerson('u2', 'Rita Sen');
    fireEvent.click(panel.getByRole('button', { name: 'Make co-owner' }));
    fireEvent.click(panel.getByRole('button', { name: 'Send request' }));
    const part = within(await panel.findByTestId('staff-co-owner'));
    expect(await part.findByText("You've already asked them. The request is waiting for their answer.")).toBeTruthy();
  });

  it('Cancel request takes it back and says so', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: staffAs('u1', [OWNER, ASKED]) } });
    drawStaff();
    const panel = await openPerson('u2', 'Rita Sen');
    orgService.getStaff.mockResolvedValue({ data: { staff: staffAs('u1', [OWNER, RITA]) } });
    fireEvent.click(panel.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(orgService.cancelCoOwnerRequest).toHaveBeenCalledWith(ORG.id, 'u2'));
    expect(await panel.findByText("Request cancelled. Rita Sen can't accept it any more.")).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Make co-owner' })).toBeTruthy();
  });

  it('the owner can make a co-owner a manager, saying they stop being a co-owner, and remove them', async () => {
    drawStaff();
    const panel = await openPerson('u3', 'Cora Lim');
    expect(panel.getAllByText('Co-owner').length).toBeGreaterThan(0);
    expect(panel.getByRole('button', { name: 'Remove from staff' })).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Make manager' }));
    expect(panel.getByText('Make Cora Lim a manager? They stop being a co-owner, and their permissions become the defaults for the new role.')).toBeTruthy();
  });

  it('the Staff list tags a co-owner as one and the owner as the owner', async () => {
    drawStaff();
    expect(within(await screen.findByTestId('staff-tab-u3')).getByText('Co-owner')).toBeTruthy();
    expect(within(screen.getByTestId('staff-tab-u1')).getByText('Owner')).toBeTruthy();
  });
});

describe("the person asked, on Overview", () => {
  const REQUEST = { id: '22222222-2222-4222-8222-222222222222', ownerName: 'Kd Owner', expiresAt: '2026-10-23T09:00:00.000Z' };
  const draw = (onAccepted = vi.fn()) => {
    render(<CoOwnerRequest gymId={ORG.id} gymName="Iron House" onAccepted={onAccepted} />);
    return onAccepted;
  };

  it('draws nothing when no request waits, or when it cannot be read', async () => {
    orgService.getMyCoOwnerRequest.mockResolvedValue({ data: { request: null } });
    draw();
    await waitFor(() => expect(orgService.getMyCoOwnerRequest).toHaveBeenCalledWith(ORG.id));
    expect(screen.queryByTestId('co-owner-request')).toBeNull();
    cleanup();
    orgService.getMyCoOwnerRequest.mockRejectedValue(apiError(500, 'internal', 'x'));
    draw();
    await waitFor(() => expect(orgService.getMyCoOwnerRequest).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('co-owner-request')).toBeNull();
  });

  it('names who asked and what a co-owner can do; Accept says it in place and reads the gym again', async () => {
    orgService.getMyCoOwnerRequest.mockResolvedValue({ data: { request: REQUEST } });
    orgService.answerCoOwnerRequest.mockResolvedValue({ data: { status: 'accepted' } });
    const onAccepted = draw();
    const box = within(await screen.findByTestId('co-owner-request'));
    expect(box.getByText('Be a co-owner of Iron House')).toBeTruthy();
    expect(box.getByText('Kd Owner asked you to be a co-owner.')).toBeTruthy();
    expect(box.getByText(/A co-owner can do everything in the console, including staff, billing and settings, except add, change or remove co-owners\./)).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText("You're now a co-owner of Iron House.")).toBeTruthy();
    expect(orgService.answerCoOwnerRequest).toHaveBeenCalledWith(ORG.id, REQUEST.id, true);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it('Decline says the owner can ask again, and changes nothing else', async () => {
    orgService.getMyCoOwnerRequest.mockResolvedValue({ data: { request: REQUEST } });
    orgService.answerCoOwnerRequest.mockResolvedValue({ data: { status: 'declined' } });
    const onAccepted = draw();
    fireEvent.click(within(await screen.findByTestId('co-owner-request')).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('You said no. Kd Owner can ask you again.')).toBeTruthy();
    expect(orgService.answerCoOwnerRequest).toHaveBeenCalledWith(ORG.id, REQUEST.id, false);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("an answer the server refuses is its sentence, and the buttons stay", async () => {
    orgService.getMyCoOwnerRequest.mockResolvedValue({ data: { request: REQUEST } });
    orgService.answerCoOwnerRequest.mockRejectedValue(apiError(409, 'request_gone', 'This request has ended. Ask the owner to send it again if you still want to be a co-owner.'));
    draw();
    const box = within(await screen.findByTestId('co-owner-request'));
    fireEvent.click(box.getByRole('button', { name: 'Accept' }));
    expect(await box.findByRole('alert')).toBeTruthy();
    expect(box.getByText('This request has ended. Ask the owner to send it again if you still want to be a co-owner.')).toBeTruthy();
    expect(box.getByRole('button', { name: 'Accept' })).toBeTruthy();
  });
});
