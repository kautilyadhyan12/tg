// Invite from the list (ROADMAP 5b-ii, 5b-v-a-i): Invite's page, and Invite, Send again,
// Share and Add and invite on a person's page.
//
// THE WORST THING THIS SCREEN COULD DO: email people the gym did not choose — a press
// that sends other words than the page showed, or a number the page never showed, or
// people listed as getting an email who are not the ones the press reaches, or a page
// that says "on the way" when the server invited nobody. So the first tests: the press
// and both lists carry exactly the words on screen; a list that changed meanwhile invites
// nobody and shows the new people; and everyone left out is shown with their reason.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  MEMBER_INVITE_WORDS,
  memberInvitePeopleSchema,
  memberInvitePreviewSchema,
  memberListEntryDetailSchema,
  memberListViewSchema,
} from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getInvitePreview: vi.fn(),
      getInvitePeople: vi.fn(),
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
  appWords: [],
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
    app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
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

let ids = 0;
/** One person on Invite's lists, as the server gives them. */
const invitee = (fullName, over = {}) => ({
  entryId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(++ids).padStart(12, '0')}`,
  fullName,
  email: `${fullName.split(' ')[0].toLowerCase()}@members.example`,
  status: 'Active',
  membershipType: 'Gold',
  reason: 'reach',
  turns18On: null,
  sameAddressAs: null,
  app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
  ...over,
});
const peopleAnswer = (people, over = {}) => ({
  data: { page: memberInvitePeopleSchema.parse({ total: people.length, people, cursor: null, ...over }) },
});
const ARJUN = invitee('Arjun Shah');
const AVA = invitee('Ava Thompson');

/** Invite's page over these words; each list answers with its own people. */
function openInvite(p, filters = FILTERS, { reach = [AVA, ARJUN], leftOut = [] } = {}) {
  orgService.getInvitePreview.mockResolvedValue(previewAnswer(p));
  orgService.getInvitePeople.mockImplementation((_gym, query) =>
    Promise.resolve(new URLSearchParams(query).get('group') === 'left_out' ? peopleAnswer(leftOut) : peopleAnswer(reach)),
  );
  return render(
    <MemoryRouter>
      <MemberListInvite gymId={GYM} gym={IRON} list={LIST} filters={filters} words={WORDS} readOnly={false} preview={null} onSent={onSent} onClose={onClose} />
    </MemoryRouter>,
  );
}
const box = () => within(screen.getByTestId('invite-box'));
const tick = () => fireEvent.click(box().getByRole('checkbox', { name: "These are Iron House's members, and I have permission to email them." }));
const rows = () => box().queryAllByTestId('invite-row');
const whyOf = (name) => {
  const row = rows().find((r) => r.textContent.includes(name));
  if (row === undefined) throw new Error(`${name} is not on the page`);
  return within(row).getByTestId('invite-why').textContent;
};

describe('the worst thing: nobody the gym did not choose is emailed', () => {
  it('the press and both lists carry exactly the words on screen, and the number shown', async () => {
    openInvite(preview());
    orgService.pressInvite.mockResolvedValue({ data: { invited: { queued: 2, skipped: NONE, version: 7 } } });
    const send = await box().findByRole('button', { name: 'Send 2 invitations' });
    expect(send.disabled).toBe(true);
    tick();
    expect(send.disabled).toBe(false);
    expect(box().getByTestId('invite-who').textContent).toBe('Filtered by Status: Active');
    expect(orgService.getInvitePreview).toHaveBeenCalledWith(GYM, 'status=Active');
    // The people shown are the ones these same words reach, with where each email goes.
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0].textContent).toContain('Ava Thompson');
    expect(rows()[1].textContent).toContain('Arjun Shah');
    expect(orgService.getInvitePeople).toHaveBeenCalledWith(GYM, 'status=Active&group=reach');
    expect(whyOf('Ava Thompson')).toBe('ava@members.example');
    fireEvent.click(box().getByRole('tab', { name: 'Not included 0' }));
    await waitFor(() => expect(orgService.getInvitePeople).toHaveBeenCalledWith(GYM, 'status=Active&group=left_out'));
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
    await waitFor(() => expect(rows()).toHaveLength(2));
    orgService.getInvitePeople.mockResolvedValue(peopleAnswer([AVA]));
    tick();
    fireEvent.click(button);
    expect(await box().findByText(MEMBER_INVITE_WORDS.invite_changed)).toBeTruthy();
    expect(box().getByTestId('invite-summary').textContent).toBe('1 member will receive an invitation email');
    expect(box().queryByText(/being sent/)).toBeNull();
    expect(onSent).not.toHaveBeenCalled();
    // The people are read again for the new group.
    await waitFor(() => expect(rows()).toHaveLength(1));

    // The tick was for the old group: it is asked again for the new one.
    expect(box().getByRole('checkbox', { name: "These are Iron House's members, and I have permission to email them." }).getAttribute('aria-checked')).toBe('false');
    expect(box().getByRole('button', { name: 'Send 1 invitation' }).disabled).toBe(true);
    tick();
    orgService.pressInvite.mockResolvedValue({ data: { invited: { queued: 1, skipped: NONE, version: 8 } } });
    fireEvent.click(box().getByRole('button', { name: 'Send 1 invitation' }));
    await waitFor(() => expect(orgService.pressInvite).toHaveBeenLastCalledWith(GYM, { status: ['Active'], version: 8, expectedCount: 1, permissionConfirmed: true }));
  });

  it("the numbers add up: how many of the people it looked at get an email, and how many don't (Kd, 2026-09-27)", async () => {
    openInvite(preview({ reach: 20, skipped: { ...NONE, noEmail: 12, underAge: 3, alreadyInvited: 2 } }), { ...FILTERS, status: [] });
    expect((await box().findByTestId('invite-summary')).textContent).toBe('20 of 37 members will receive an invitation email · 17 not included');
    // Never "Everyone on your list" over a smaller number, and no "Filtered by" without a filter.
    expect(box().queryByText(/Everyone on your list/)).toBeNull();
    expect(box().queryByTestId('invite-who')).toBeNull();
    expect(box().getByRole('tab', { name: 'Recipients 20' }).getAttribute('aria-selected')).toBe('true');
    expect(box().getByRole('tab', { name: 'Not included 17' })).toBeTruthy();
  });

  it('shows everyone left out with their own reason, in the words their own row uses, and what to do', async () => {
    const leftOut = [
      invitee('Priya Shah', { email: 'arjun@members.example', reason: 'alreadyInvited', sameAddressAs: 'Arjun Shah' }),
      invitee('Liam Hughes', { email: null, reason: 'noEmail', app: { word: 'not_in_app', tone: 'grey', at: null, line: 'No email address', lineTone: 'plain' } }),
      invitee('Mia Rossi', { reason: 'underAge', turns18On: '2030-03-14', app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Under 18', lineTone: 'plain' } }),
      invitee('Olivia Bennett', { reason: 'inApp', app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' } }),
      invitee('Mark Bennett', {
        email: 'olivia@members.example',
        reason: 'inApp',
        app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Olivia Bennett uses the app with this email address.', lineTone: 'plain' },
      }),
      invitee('Sofia Alvarez', { reason: 'alreadyInvited', app: { word: 'invited', tone: 'grey', at: '2026-09-24T10:01:00.000Z', line: 'Invitation sent', lineTone: 'plain' } }),
      invitee('Ben Cole', { reason: 'alreadyInvited', app: { word: 'not_in_app', tone: 'grey', at: '2026-09-26T10:00:00.000Z', line: 'Removed from app', lineTone: 'plain' } }),
      invitee('Ravi Kumar', { email: 'info@kumar.example', reason: 'sharedAddress' }),
      invitee('Zara Ahmed', { reason: 'unsubscribed' }),
    ];
    openInvite(preview({ reach: 2, skipped: { ...NONE, alreadyInvited: 3, noEmail: 1, underAge: 1, inApp: 2, sharedAddress: 1, unsubscribed: 1 } }), FILTERS, { leftOut });
    fireEvent.click(await box().findByRole('tab', { name: 'Not included 9' }));
    await waitFor(() => expect(rows()).toHaveLength(9));
    expect(whyOf('Priya Shah')).toBe('Shares an email address with Arjun Shah, who is being invitedAdd a separate email address to invite them.');
    expect(whyOf('Liam Hughes')).toBe('No email addressAdd an email address to invite them.');
    expect(whyOf('Mia Rossi')).toBe('Under 18 (can be invited from 14 Mar 2030)If the date of birth is incorrect, update it on their page.');
    expect(whyOf('Olivia Bennett')).toBe('Already in the app');
    expect(whyOf('Mark Bennett')).toBe('Olivia Bennett uses the app with this email address.Add a separate email address to invite them.');
    expect(whyOf('Sofia Alvarez')).toMatch(/^Invitation sent · 24 Sep( 2026)?To resend, open their page\.$/);
    expect(whyOf('Ben Cole')).toMatch(/^Removed from app · 26 Sep( 2026)?$/);
    expect(whyOf('Ravi Kumar')).toBe("Shared email address (such as info@)Add the member's own email address to invite them.");
    expect(whyOf('Zara Ahmed')).toBe('Unsubscribed from your emails');
    // Each row still says who it is: the name, and the email it has.
    expect(rows()[0].textContent).toContain('arjun@members.example');
  });

  it('with nobody to reach, nothing can be sent', async () => {
    openInvite(preview({ reach: 0, skipped: { ...NONE, underAge: 1 } }), FILTERS, { reach: [] });
    expect((await box().findByTestId('invite-summary')).textContent).toBe('No members to invite · 1 not included');
    // With nobody to invite, the page opens on the people not included, with their reasons.
    expect(box().getByRole('tab', { name: 'Not included 1' }).getAttribute('aria-selected')).toBe('true');
    expect(box().getByRole('button', { name: 'Send 0 invitations' }).disabled).toBe(true);
  });
});

describe("Invite's page", () => {
  it('a gym with no postal address is sent to Settings and cannot send', async () => {
    openInvite(preview({ blocked: 'no_postal_address' }));
    expect(await box().findByText(/Add your gym's postal address in Settings/)).toBeTruthy();
    expect(box().getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe('/console/iron-house/settings');
    expect(box().getByRole('button', { name: 'Send 2 invitations' }).disabled).toBe(true);
  });

  it('says when the search or the app filter does not choose who is invited', async () => {
    openInvite(preview(), { ...FILTERS, status: [], query: 'ada' });
    expect((await box().findByTestId('invite-summary')).textContent).toBe('All 2 members will receive an invitation email');
    expect(box().getByText(/Search and App filters don't apply/)).toBeTruthy();
    await waitFor(() => expect(orgService.getInvitePeople).toHaveBeenCalledWith(GYM, 'group=reach'));
  });

  it('brings the next hundred with Load more, after the ones already shown', async () => {
    openInvite(preview({ reach: 3 }));
    orgService.getInvitePeople.mockResolvedValueOnce(peopleAnswer([AVA, ARJUN], { total: 3, cursor: 100 }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    const rest = invitee('Zoe Park');
    orgService.getInvitePeople.mockResolvedValueOnce(peopleAnswer([rest], { total: 3, cursor: null }));
    fireEvent.click(box().getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(orgService.getInvitePeople).toHaveBeenLastCalledWith(GYM, 'status=Active&group=reach&cursor=100');
    expect(rows()[2].textContent).toContain('Zoe Park');
    expect(box().queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it("a row opens that person's page over Invite's", async () => {
    openInvite(preview());
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: person({ entryId: AVA.entryId, fullName: 'Ava Thompson', email: AVA.email }) } });
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(rows()[0]);
    await waitFor(() => expect(orgService.getMemberListEntry).toHaveBeenCalledWith(GYM, AVA.entryId));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
  });

  it('afterwards: how many are on the way, and the words and link to share', async () => {
    openInvite(preview());
    orgService.pressInvite.mockResolvedValue({ data: { invited: { queued: 2, skipped: NONE, version: 7 } } });
    const button = await box().findByRole('button', { name: 'Send 2 invitations' });
    tick();
    fireEvent.click(button);
    expect(await box().findByText('2 invitations are being sent.')).toBeTruthy();
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
    const button = await page().findByRole('button', { name: 'Invite' });
    // Read again after the press, the person carries the server's App word for it.
    const queued = invitation({ state: 'queued', reason: null, at: '2026-09-25T10:00:00.000Z', result: null });
    orgService.getMemberListEntry.mockResolvedValue({
      data: { entry: person({ invitation: queued, app: { word: 'invited', tone: 'grey', at: '2026-09-25T10:00:00.000Z', line: null, lineTone: 'plain' } }) },
    });
    fireEvent.click(button);
    expect(await page().findByText('Invitation sent. It will arrive within a few minutes.')).toBeTruthy();
    expect(orgService.inviteMemberListEntry).toHaveBeenCalledWith(GYM, ADA);
    expect(await page().findByText('Invited')).toBeTruthy();
    expect(page().queryByText('Not in the app')).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it('says why somebody the list says is under 18 cannot be invited, with nothing to press', async () => {
    openPerson(person({ dateOfBirth: '2010-03-14', app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Under 18', lineTone: 'plain' } }));
    expect((await page().findByTestId('under-age-note')).textContent).toBe(MEMBER_INVITE_WORDS.under_age);
    // When they can be, and what to do if the date is wrong (Kd, 2026-09-27).
    expect(page().getByTestId('under-age-when').textContent).toBe(
      'They can be invited from 14 March 2028, when they turn 18. If the date of birth is incorrect, select Edit to update it.',
    );
    expect(page().getByText('Under 18')).toBeTruthy();
    expect(page().queryByRole('button', { name: 'Invite' })).toBeNull();
    expect(page().queryByRole('button', { name: 'Send again' })).toBeNull();
  });

  it('a child at a parent\'s invited address, or one corrected after inviting, is offered nothing to send or share', async () => {
    // The invitation hangs on the address, so the child's page carries the parent's.
    openPerson(person({ dateOfBirth: '2010-03-14', invitation: invitation(wentEmail), app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Under 18', lineTone: 'plain' } }));
    expect((await page().findByTestId('under-age-note')).textContent).toBe(MEMBER_INVITE_WORDS.under_age);
    expect(page().getByText('Under 18')).toBeTruthy();
    expect(page().queryByText(/^Invited/)).toBeNull();
    expect(page().queryByRole('button', { name: 'Send again' })).toBeNull();
    fireEvent.click(page().getByRole('button', { name: /^More/ }));
    expect(page().queryByRole('menuitem', { name: /^Share the invitation/ })).toBeNull();
    expect(page().getByRole('menuitem', { name: /^Remove$/ })).toBeTruthy();
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
    expect(await page().findByText('Invitation resent. It will arrive within a few minutes.')).toBeTruthy();
    expect(orgService.resendMemberListInvite).toHaveBeenCalledWith(GYM, ADA);
    expect(orgService.inviteMemberListEntry).not.toHaveBeenCalled();
  });

  it('offers nothing to send for somebody already in the app', async () => {
    openPerson(person({ inApp: true, app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' } }));
    await page().findByText('In the app');
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
    expect(await page().findByText('Member added. Invitation sent. It will arrive within a few minutes.')).toBeTruthy();
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
    expect(await page().findByText('Member added.')).toBeTruthy();
    expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Cy Walker', email: 'cy@members.example' });
  });
});
