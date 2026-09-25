// Invite from the list (ROADMAP 5b-ii): the Invite box, and Invite, Send again, Share
// and Add and invite on a person's page.
//
// THE WORST THING THIS SCREEN COULD DO: email people the gym did not choose — a press
// that sends other words than the box showed, or a number the box never showed, or a
// box that says "on the way" when the server invited nobody. So the first tests: the
// press carries exactly the words and count on screen; a list that changed meanwhile
// invites nobody and shows the new count; and under-18s are said as left out.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MEMBER_INVITE_WORDS, memberInvitePreviewSchema, memberListEntryDetailSchema, memberListViewSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getInvitePreview: vi.fn(),
      pressInvite: vi.fn(),
      inviteMemberListEntry: vi.fn(),
      resendMemberListInvite: vi.fn(),
      getMemberListEntry: vi.fn(),
      addMemberListEntry: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListInvite = (await import('./MemberListInvite')).default;
const MemberListPerson = (await import('./MemberListPerson')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', it: 'gym' };
const IRON = { name: 'Iron House', slug: 'iron-house' };
const NONE = { noEmail: 0, underAge: 0, inApp: 0, alreadyInvited: 0, unsubscribed: 0, bounced: 0, refused: 0, sharedAddress: 0 };
const FILTERS = { records: 'current', app: 'all', status: ['Active'], membershipType: [], paymentStatus: [], query: '' };

const preview = (over = {}) => memberInvitePreviewSchema.parse({ version: 7, reach: 2, skipped: NONE, blocked: null, ...over });
const previewAnswer = (p) => ({ data: { preview: p } });
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

const LIST = memberListViewSchema.parse({
  hasList: true,
  version: 3,
  lastConfirmedAt: '2026-09-20T10:00:00.000Z',
  counts: { entries: 1, inApp: 0, canBeInvited: 1, noEmail: 0, former: 0 },
  statuses: [{ label: 'Active', count: 1, inApp: 0, canBeInvited: 1 }],
  membershipTypes: [],
  paymentStatuses: [],
  fields: [],
});

function person(over = {}) {
  return memberListEntryDetailSchema.parse({
    entryId: ADA,
    fullName: 'Ada Lovelace',
    email: 'ada@members.example',
    phone: null,
    memberNumber: null,
    status: 'Active',
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    endsOnKind: null,
    paymentStatus: null,
    dateOfBirth: null,
    formerAt: null,
    source: 'upload',
    inApp: false,
    invitation: null,
    extra: [],
    handEdited: [],
    members: [],
    ...over,
  });
}
const invitation = (email, over = {}) => ({
  state: 'pending',
  invitedAt: '2026-09-24T10:00:00.000Z',
  email,
  sentAgain: 0,
  waitingSince: null,
  notMeAt: null,
  ...over,
});
const wentEmail = { state: 'sent', reason: null, at: '2026-09-24T10:01:00.000Z', result: 'delivered' };

let onSent;
let onClose;
let onChanged;

beforeEach(() => {
  onSent = vi.fn();
  onClose = vi.fn();
  onChanged = vi.fn();
  for (const fn of Object.values(orgService)) fn.mockReset();
});
afterEach(() => cleanup());

function openInvite(p, filters = FILTERS) {
  orgService.getInvitePreview.mockResolvedValue(previewAnswer(p));
  return render(
    <MemoryRouter>
      <MemberListInvite gymId={GYM} gym={IRON} filters={filters} words={WORDS} readOnly={false} preview={null} onSent={onSent} onClose={onClose} />
    </MemoryRouter>,
  );
}
const box = () => within(screen.getByTestId('invite-box'));
const tick = () => fireEvent.click(box().getByLabelText('I have permission to email these members.'));

describe('the worst thing: nobody the gym did not choose is emailed', () => {
  it('the press carries exactly the words on screen and the number shown', async () => {
    openInvite(preview());
    orgService.pressInvite.mockResolvedValue({ data: { invited: { queued: 2, skipped: NONE, version: 7 } } });
    const send = await box().findByRole('button', { name: 'Send 2 invitations' });
    expect(send.disabled).toBe(true);
    tick();
    expect(send.disabled).toBe(false);
    expect(box().getByTestId('invite-who').textContent).toBe('Status: Active');
    expect(orgService.getInvitePreview).toHaveBeenCalledWith(GYM, 'status=Active');
    fireEvent.click(send);
    await waitFor(() => expect(orgService.pressInvite).toHaveBeenCalledTimes(1));
    expect(orgService.pressInvite).toHaveBeenCalledWith(GYM, { status: ['Active'], version: 7, expectedCount: 2, permissionConfirmed: true });
  });

  it('a list that changed meanwhile invites nobody, says so, and shows the new number to send', async () => {
    openInvite(preview());
    orgService.pressInvite.mockRejectedValueOnce(
      refusal(409, { error: 'invite_changed', message: MEMBER_INVITE_WORDS.invite_changed, preview: preview({ version: 8, reach: 1 }) }),
    );
    const button = await box().findByRole('button', { name: 'Send 2 invitations' });
    tick();
    fireEvent.click(button);
    expect(await box().findByText(MEMBER_INVITE_WORDS.invite_changed)).toBeTruthy();
    expect(box().getByTestId('invite-reach').textContent).toBe('1');
    expect(box().queryByText(/on the way/)).toBeNull();
    expect(onSent).not.toHaveBeenCalled();

    orgService.pressInvite.mockResolvedValue({ data: { invited: { queued: 1, skipped: NONE, version: 8 } } });
    fireEvent.click(box().getByRole('button', { name: 'Send 1 invitation' }));
    await waitFor(() => expect(orgService.pressInvite).toHaveBeenLastCalledWith(GYM, { status: ['Active'], version: 8, expectedCount: 1, permissionConfirmed: true }));
  });

  it('says how many are left out for being under 18, and why each of the rest is', async () => {
    openInvite(preview({ skipped: { ...NONE, noEmail: 12, underAge: 3, alreadyInvited: 1 } }));
    const left = within(await box().findByTestId('invite-left-out'));
    expect(left.getByText('3 are under 18 by the date of birth on your list')).toBeTruthy();
    expect(left.getByText('12 have no email address')).toBeTruthy();
    expect(left.getByText('1 was invited before')).toBeTruthy();
  });

  it('with nobody to reach, nothing can be sent', async () => {
    openInvite(preview({ reach: 0, skipped: { ...NONE, underAge: 1 } }));
    expect(await box().findByText('Nobody here is waiting for an invitation.')).toBeTruthy();
    expect(box().getByRole('button', { name: 'Send 0 invitations' }).disabled).toBe(true);
  });
});

describe('the Invite box', () => {
  it('a gym with no postal address is sent to Settings and cannot send', async () => {
    openInvite(preview({ blocked: 'no_postal_address' }));
    expect(await box().findByText(/Add your gym's postal address in Settings first/)).toBeTruthy();
    expect(box().getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe('/console/iron-house/settings');
    expect(box().getByRole('button', { name: 'Send 2 invitations' }).disabled).toBe(true);
  });

  it('says when the search or the app filter does not choose who is invited', async () => {
    openInvite(preview(), { ...FILTERS, status: [], query: 'ada' });
    expect(await box().findByText('Everyone on your list')).toBeTruthy();
    expect(box().getByText(/The search and the app filter don't/)).toBeTruthy();
  });

  it('afterwards: how many are on the way, and the words and link to share', async () => {
    openInvite(preview());
    orgService.pressInvite.mockResolvedValue({ data: { invited: { queued: 2, skipped: NONE, version: 7 } } });
    const button = await box().findByRole('button', { name: 'Send 2 invitations' });
    tick();
    fireEvent.click(button);
    expect(await box().findByText('2 invitations are on the way.')).toBeTruthy();
    expect(onSent).toHaveBeenCalledTimes(1);
    const words = box().getByLabelText("The invitation's words").value;
    expect(words).toContain('Iron House has invited you to AI Home Gym');
    expect(words).toContain(`${window.location.origin}/join/iron-house`);
    expect(words).toContain('sign in with the email address Iron House has for you');
  });
});

function openPerson(p) {
  orgService.getMemberListEntry.mockResolvedValue({ data: { entry: p } });
  return render(
    <MemberListPerson gymId={GYM} gym={IRON} entryId={p.entryId} list={LIST} words={WORDS} readOnly={false} onClose={onClose} onChanged={onChanged} />,
  );
}
const page = () => within(screen.getAllByRole('dialog')[0]);

describe("a person's page", () => {
  it('invites somebody never invited, and shows the invitation the server wrote', async () => {
    openPerson(person());
    orgService.inviteMemberListEntry.mockResolvedValue({
      data: { invite: { outcome: 'queued', invitation: invitation({ state: 'queued', reason: null, at: '2026-09-25T10:00:00.000Z', result: null }) } },
    });
    fireEvent.click(await page().findByRole('button', { name: 'Invite' }));
    expect(await page().findByText('Invited. The email goes out within a few minutes.')).toBeTruthy();
    expect(orgService.inviteMemberListEntry).toHaveBeenCalledWith(GYM, ADA);
    expect(page().getByText('Invited · email waiting to go')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('says why somebody the list says is under 18 cannot be invited, with nothing to press', async () => {
    openPerson(person({ dateOfBirth: '2010-03-14' }));
    expect((await page().findByTestId('under-age-note')).textContent).toBe(MEMBER_INVITE_WORDS.under_age);
    expect(page().getByText('Under 18')).toBeTruthy();
    expect(page().queryByRole('button', { name: 'Invite' })).toBeNull();
    expect(page().queryByRole('button', { name: 'Send again' })).toBeNull();
  });

  it("shows the server's refusal when the gym's own day says under 18", async () => {
    openPerson(person());
    orgService.inviteMemberListEntry.mockRejectedValue(refusal(409, { error: 'under_age', message: MEMBER_INVITE_WORDS.under_age }));
    fireEvent.click(await page().findByRole('button', { name: 'Invite' }));
    expect(await page().findByText(MEMBER_INVITE_WORDS.under_age)).toBeTruthy();
    expect(page().queryByText(/Invited\./)).toBeNull();
  });

  it('Send again asks first, names the address and the limit, then sends for this person', async () => {
    openPerson(person({ invitation: invitation(wentEmail) }));
    fireEvent.click(await page().findByRole('button', { name: 'Send again' }));
    const confirm = within(page().getByTestId('confirm-again'));
    expect(confirm.getByText(/It goes to ada@members\.example/)).toBeTruthy();
    expect(confirm.getByText(/3 times in 30 days/)).toBeTruthy();
    orgService.resendMemberListInvite.mockResolvedValue({ data: { invite: { outcome: 'queued', invitation: invitation(wentEmail, { sentAgain: 1 }) } } });
    fireEvent.click(confirm.getByRole('button', { name: 'Send again' }));
    expect(await page().findByText('Invitation sent again. It goes out within a few minutes.')).toBeTruthy();
    expect(orgService.resendMemberListInvite).toHaveBeenCalledWith(GYM, ADA);
    expect(orgService.inviteMemberListEntry).not.toHaveBeenCalled();
  });

  it('offers nothing to send for somebody already in the app', async () => {
    openPerson(person({ inApp: true }));
    await page().findByText('Uses the app');
    expect(page().queryByRole('button', { name: 'Invite' })).toBeNull();
    expect(page().queryByRole('button', { name: 'Send again' })).toBeNull();
  });

  it("Share the invitation gives the words with this person's own address", async () => {
    openPerson(person({ invitation: invitation(wentEmail) }));
    fireEvent.click(await page().findByRole('button', { name: /^More/ }));
    fireEvent.click(await page().findByRole('menuitem', { name: /^Share the invitation/ }));
    expect(page().getByLabelText("The invitation's words").value).toContain('sign in with this email address, ada@members.example');
  });
});

describe('Add and invite', () => {
  const addBox = () => {
    // The page reads the new record once it is added.
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: person({ fullName: 'Cy Walker', email: 'cy@members.example' }) } });
    return render(
      <MemberListPerson gymId={GYM} gym={IRON} entryId={null} list={LIST} words={WORDS} readOnly={false} onClose={onClose} onChanged={onChanged} />,
    );
  };
  const fill = () => {
    fireEvent.change(page().getByLabelText('Name'), { target: { value: 'Cy Walker' } });
    fireEvent.change(page().getByLabelText('Email'), { target: { value: 'cy@members.example' } });
  };
  const added = (invite) => ({
    data: { outcome: 'added', entry: person({ fullName: 'Cy Walker', email: 'cy@members.example' }), version: 4, ...(invite ? { invite } : {}) },
  });

  it('adds and invites in one request, and says both', async () => {
    addBox();
    fill();
    orgService.addMemberListEntry.mockResolvedValue(
      added({ outcome: 'queued', invitation: invitation({ state: 'queued', reason: null, at: '2026-09-25T10:00:00.000Z', result: null }) }),
    );
    fireEvent.click(page().getByRole('button', { name: 'Add and invite' }));
    expect(await page().findByText('Added to your list. Invited. The email goes out within a few minutes.')).toBeTruthy();
    expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Cy Walker', email: 'cy@members.example', invite: true });
  });

  it('Status takes a word the list has never used, and says so under the box', async () => {
    addBox();
    fill();
    const status = page().getByLabelText('Status');
    const hint = document.getElementById(status.getAttribute('aria-describedby'));
    expect(hint.textContent).toBe('Pick one of your words, or type a new one.');
    fireEvent.change(status, { target: { value: 'Paused' } });
    orgService.addMemberListEntry.mockResolvedValue(added(null));
    fireEvent.click(page().getByRole('button', { name: 'Add member' }));
    await waitFor(() =>
      expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Cy Walker', email: 'cy@members.example', status: 'Paused' }),
    );
  });

  it('Add alone invites nobody', async () => {
    addBox();
    fill();
    orgService.addMemberListEntry.mockResolvedValue(added(null));
    fireEvent.click(page().getByRole('button', { name: 'Add member' }));
    expect(await page().findByText('Added to your list.')).toBeTruthy();
    expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Cy Walker', email: 'cy@members.example' });
  });
});
